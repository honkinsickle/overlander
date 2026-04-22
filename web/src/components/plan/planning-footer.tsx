import Link from "next/link";

/**
 * Back / Continue footer actions for step pages.
 *
 * If `continueHref` is provided, Continue is a plain Link (used for stubs
 * and steps without server-side save). Otherwise it's a `<button type="submit">`
 * that submits the surrounding form — the step's server action decides what
 * to do on Continue.
 */
export function NavFooter({
  backHref,
  continueHref,
  disableContinue,
}: {
  /** Optional — hides the Back button if omitted (e.g. step 1). */
  backHref?: string;
  /** Optional — if omitted, renders a submit button instead. */
  continueHref?: string;
  disableContinue?: boolean;
}) {
  return (
    <>
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex items-center h-10 px-5 rounded-full border border-border-mid text-text-primary hover:bg-bg-card font-sans font-semibold text-sm tracking-wide"
        >
          BACK
        </Link>
      ) : (
        <span />
      )}
      {continueHref ? (
        <Link
          href={continueHref}
          className="inline-flex items-center h-10 px-5 rounded-full bg-button-primary hover:bg-button-primary-hover border border-button-primary-border text-text-primary font-sans font-semibold text-sm tracking-wide"
        >
          CONTINUE
        </Link>
      ) : (
        <button
          type="submit"
          disabled={disableContinue}
          className="inline-flex items-center h-10 px-5 rounded-full bg-button-primary hover:bg-button-primary-hover border border-button-primary-border text-text-primary font-sans font-semibold text-sm tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
        >
          CONTINUE
        </button>
      )}
    </>
  );
}

/**
 * Skip-style footer for optional steps (Interests etc.).
 * Shows a counter chip on the left and a Skip link on the right.
 */
export function SkipFooter({
  counter,
  counterNumber,
  sublabel,
  skipHref,
}: {
  counter: string;
  counterNumber: number;
  sublabel?: string;
  skipHref: string;
}) {
  return (
    <div className="w-full flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className="w-6 h-6 flex items-center justify-center rounded-full bg-amber text-[#2A1F10] font-sans font-bold text-xs"
          aria-hidden
        >
          {counterNumber}
        </span>
        <span className="font-sans text-sm text-text-primary">{counter}</span>
        {sublabel && (
          <span className="section-label text-[11px] text-text-muted">
            · {sublabel}
          </span>
        )}
      </div>
      <Link
        href={skipHref}
        className="font-sans font-semibold text-sm text-input-border-focus hover:underline"
      >
        Skip
      </Link>
    </div>
  );
}
