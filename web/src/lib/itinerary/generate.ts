/**
 * Stage-1 generation call (spec §8.2, the [LLM] block).
 *
 * A single grounded pass: the adapted Master Prompt is the system prompt, the
 * engine facts are the user turn, and the model returns the STRUCTURED
 * Section-C itinerary (never prose) constrained by ITINERARY_OUTPUT_SCHEMA.
 * The audit (Stage 2) grounds the facts afterward.
 *
 * REAL call, gated on ANTHROPIC_API_KEY. The Anthropic SDK is imported
 * lazily so the fact-precompute path (facts.ts) runs even before the SDK is
 * installed — `generateItinerary` throws a clear, actionable error until
 * both the key and the SDK are present.
 */

import type { EngineFacts, GenerationInput } from "./facts";
import { SYSTEM_PROMPT, buildFactsMessage } from "./master-prompt";
import { ITINERARY_OUTPUT_SCHEMA, type ItineraryOutput } from "./schema";

const MODEL = "claude-opus-4-8";

export class ItineraryGenerationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "missing_key"
      | "missing_sdk"
      | "refusal"
      | "bad_output"
      | "api_error",
  ) {
    super(message);
    this.name = "ItineraryGenerationError";
  }
}

/** True when a real generation can run (key present). The SDK presence is
 *  checked lazily at call time. */
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type GenerationResult = {
  itinerary: ItineraryOutput;
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * Run one grounded generation pass. Streams (the reasoning IS the product,
 * and the output is large) and returns the parsed, schema-valid itinerary.
 */
export async function generateItinerary(
  input: GenerationInput,
  facts: EngineFacts,
  /** Optional constraint appended to the user turn — used by the Tier-3
   *  regen loop to feed structural violations back to the model. */
  regenFeedback?: string,
): Promise<GenerationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ItineraryGenerationError(
      "ANTHROPIC_API_KEY is not set — add it to web/.env.local to run generation.",
      "missing_key",
    );
  }

  // Dynamic import via a non-literal specifier so the module isn't a static
  // build dependency — the fact-precompute path runs before the SDK is
  // installed, and this file typechecks either way. `any` here is deliberate:
  // typing against @anthropic-ai/sdk would make it a static dep. Once the SDK
  // is installed the real client is constructed and used below.
  const sdkSpecifier = "@anthropic-ai/sdk";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Anthropic: any;
  try {
    Anthropic = (await import(sdkSpecifier)).default;
  } catch {
    throw new ItineraryGenerationError(
      "@anthropic-ai/sdk is not installed — run `npm install -w web @anthropic-ai/sdk`.",
      "missing_sdk",
    );
  }

  const client = new Anthropic();
  const userMessage = regenFeedback
    ? `${buildFactsMessage(input, facts)}\n\n---\nREGENERATION — the previous attempt violated hard constraints. Fix these and regenerate the FULL itinerary:\n${regenFeedback}`
    : buildFactsMessage(input, facts);

  let message;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        // Constrain the response to the Section-C contract.
        format: {
          type: "json_schema",
          schema: ITINERARY_OUTPUT_SCHEMA,
        },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    throw new ItineraryGenerationError(
      `Anthropic API error: ${err instanceof Error ? err.message : String(err)}`,
      "api_error",
    );
  }

  if (message.stop_reason === "refusal") {
    throw new ItineraryGenerationError(
      "Model declined to generate the itinerary (refusal).",
      "refusal",
    );
  }

  const textBlock = message.content.find(
    (b: { type: string }) => b.type === "text",
  );
  if (!textBlock || textBlock.type !== "text") {
    throw new ItineraryGenerationError(
      "Generation returned no text block to parse.",
      "bad_output",
    );
  }

  let itinerary: ItineraryOutput;
  try {
    itinerary = JSON.parse(textBlock.text) as ItineraryOutput;
  } catch {
    throw new ItineraryGenerationError(
      "Generation output was not valid JSON.",
      "bad_output",
    );
  }

  return {
    itinerary,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}

/** Tier-3 regen budget: how many times to regenerate when the audit finds a
 *  structural violation (leg over cap / anchor off date) before giving up. */
export const REGEN_BUDGET = 2;

export type GenerateAndAuditResult = {
  audited: import("./schema").ItineraryOutput;
  report: import("./audit").AuditReport;
  regenAttempts: number;
  /** Set when the structural tier couldn't be satisfied within the budget —
   *  surface this honestly rather than shipping a plan that violates a hard
   *  constraint. */
  unresolved: import("./audit").StructuralIssue[] | null;
  /** Per-day routes from the final audit — feed bakeGeneratedDays (no re-route). */
  dayRoutes: import("./audit").DayRoute[];
};

/**
 * The wired path (spec §8.2): generate → audit → bounded Tier-3 regen.
 * Returns the AUDITED itinerary; the caller persists/renders THIS, never the
 * raw LLM output.
 */
export async function generateAndAudit(
  input: GenerationInput,
  facts: EngineFacts,
): Promise<GenerateAndAuditResult> {
  const { auditItinerary } = await import("./audit");

  let output = (await generateItinerary(input, facts)).itinerary;
  let outcome = await auditItinerary(input, facts, output);
  let attempts = 0;

  while (outcome.structural.length > 0 && attempts < REGEN_BUDGET) {
    attempts++;
    const feedback = outcome.structural
      .map((s) =>
        s.kind === "leg-over-cap"
          ? `- Day ${s.day}: leg is ${s.measuredMi} mi, over the ${s.capMi} mi/day cap. Re-split so no driving day exceeds the cap.`
          : `- FIXED anchor "${s.anchor}" must land on ${s.expectedDate} (was ${s.actualDate ?? "unplaced"}). Adjust the schedule to honor it.`,
      )
      .join("\n");
    output = (await generateItinerary(input, facts, feedback)).itinerary;
    outcome = await auditItinerary(input, facts, output);
  }

  return {
    audited: outcome.audited,
    report: outcome.report,
    regenAttempts: attempts,
    unresolved: outcome.structural.length > 0 ? outcome.structural : null,
    dayRoutes: outcome.dayRoutes,
  };
}
