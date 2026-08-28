/**
 * Atlas Obscura description markdown → plain text converter.
 *
 * Motivation. The `about` field in Atlas Obscura's manually-supplied
 * per-state datasets (landed on TEST by PR #309 and #311) is
 * markdown-flavoured — inline links, italic, occasional bold — and the
 * web client renders tile descriptions as text nodes (via `{description}`
 * in JSX, never `dangerouslySetInnerHTML` and no markdown library), so
 * the markdown syntax appeared literally on the rendered tile:
 * `[Portland](https://…)` instead of just `Portland`.
 *
 * Scope of AO markdown, measured on the 2,858 TEST descriptions
 * (2026-08-27, data/scripts/atlas-oddities-markdown-sample.ts):
 *   inline_link          1424   [text](url)
 *   italic_underscore     527   _italic_
 *   bold                   14   **bold**
 *   blockquote              2   > line
 *   unordered_list          1   *   item
 *   horizontal_rule         1   ---
 *   image                   1   ![alt](url)
 * Not observed: heading, italic-star, ordered_list, inline code, fenced
 * code, autolink, strikethrough, footnote ref, HTML tag, escaped char.
 *
 * Decision: strip to plain text. That matches how existing sources'
 * descriptions render today — NPS/RIDB descriptions currently ship with
 * raw HTML fragments (`<p>`, `<em>`, `<br>`) that also render literally
 * as text, so a broader "render markdown/HTML for tiles" change is out
 * of scope. Stripping AO to plain text lands the AO tiles in the same
 * text-node rendering path as everything else, without introducing a
 * new rendering pipeline.
 *
 * NOT SCOPE: NPS/RIDB HTML tags rendering literally is the same class of
 * issue on a different corpus; flagged separately in
 * `docs/decisions/2026-08-27-ao-description-plain-text.md` and BACKLOG,
 * not fixed here.
 *
 * The converter is intentionally minimal — no `remark`, no `micromark`,
 * no dep added. The observed markdown surface is small enough that a
 * regex chain is both readable and precise. If the surface widens (a
 * new AO dump introduces headings or code blocks), this file gets a new
 * rule; the tests will lock the delta.
 */

/**
 * Convert AO markdown-flavoured description text to plain text.
 *
 * Rules, applied in order:
 *   1. Images `![alt](url)` → `alt` (drop the URL, keep alt text)
 *   2. Inline links `[text](url)` → `text` (drop the URL)
 *   3. Bold `**text**` → `text`
 *   4. Underscore italic `_text_` → `text` (word boundaries; won't touch
 *      snake_case tokens like `_id`)
 *   5. Blockquote line `> text` → `text` (strip leading `> `)
 *   6. Unordered list `* text` / `- text` / `+ text` → `text` (strip
 *      leading marker + whitespace; two-space indent variants included)
 *   7. Horizontal rule `---` / `___` / `***` (alone on a line) → drop
 *      the line
 *
 * Preserved: real newlines, double newlines (paragraph breaks), plain
 * URLs (not part of a link syntax), curly punctuation, non-ASCII glyphs.
 *
 * Idempotent — running the converter on already-clean text is a no-op.
 */
export function convertAoMarkdown(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;

  let out = input;

  // 1. Images — must come before inline links since `![alt](url)` also
  //    matches the link pattern.
  out = out.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // 2. Inline links `[text](url)` → `text`.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  // 3. Bold `**text**` → `text` (non-greedy, don't cross newlines).
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "$1");

  // 3b. Stray runs of 2+ asterisks (e.g. `****text****` — one measured
  //     case: the Lola Montez quote at atlasobscura:home-of-lola-montez).
  //     After rule 3, any remaining `**+` sequence is emphasis-marker
  //     leftover, not prose content.
  out = out.replace(/\*{2,}/g, "");

  // 4. Underscore italic `_text_` → `text`. Guards against snake_case:
  //    the underscore must be at a word boundary (start of string, or
  //    after whitespace / punctuation), and the closing underscore must
  //    be followed by whitespace / punctuation / end of string.
  out = out.replace(
    /(^|[\s(\[{"'])_([^_\n]+)_(?=[\s.,!?;:)\]}'"]|$)/g,
    "$1$2",
  );

  // 5. Blockquote `> text` → `text`. Strip only the leading `> ` on a
  //    line (or `>` at line start); trailing content is untouched.
  out = out.replace(/(^|\n)> ?/g, "$1");

  // 6. Unordered list marker at line start: `- `, `* `, `+ ` — accept
  //    up to 4 spaces of leading indent (common in AO CSVs which use
  //    `*   ` with wide spacing).
  out = out.replace(/(^|\n) {0,4}[-*+]\s+/g, "$1");

  // 7. Horizontal rule alone on a line: `---`, `___`, or `***` (>= 3),
  //    optional surrounding whitespace. Drop the entire line.
  out = out.replace(/(^|\n)\s*([-_*])\2{2,}\s*(?=\n|$)/g, "$1");

  return out;
}

/** Returns true if the string contains any of the markdown patterns the
 *  converter handles — used by the ingest script's idempotence guard
 *  and by the sample-corpus stats. */
export function looksLikeAoMarkdown(input: string): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  return (
    /!\[[^\]]*\]\([^)]+\)/.test(input) ||
    /\[[^\]]+\]\([^)]+\)/.test(input) ||
    /\*\*[^*\n]+\*\*/.test(input) ||
    /(^|[\s(\[{"'])_[^_\n]+_(?=[\s.,!?;:)\]}'"]|$)/.test(input) ||
    /(^|\n)> ?/.test(input) ||
    /(^|\n) {0,4}[-*+]\s+/.test(input) ||
    /(^|\n)\s*([-_*])\2{2,}\s*(?=\n|$)/.test(input)
  );
}
