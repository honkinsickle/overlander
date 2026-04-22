/**
 * Matches the visual shape of DetailCard so the map column doesn't jump
 * layout when the real card arrives. Uses --bg-card neutral fills with a
 * subtle pulse animation.
 */
export function DetailCardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex flex-col bg-bg-panel border border-border-subtle rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.7)] overflow-hidden"
    >
      <div className="relative flex items-end h-44 p-4 bg-bg-card">
        <div className="h-6 w-20 rounded-full bg-white/5 animate-pulse" />
      </div>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
        <div className="h-6 w-3/4 rounded bg-white/5 animate-pulse" />
        <div className="h-4 w-1/2 rounded bg-white/5 animate-pulse" />
        <div className="h-10 w-full rounded bg-white/5 animate-pulse" />
        <div className="flex gap-2">
          <div className="flex-1 h-14 rounded-[10px] bg-bg-card animate-pulse" />
          <div className="flex-1 h-14 rounded-[10px] bg-bg-card animate-pulse" />
          <div className="flex-1 h-14 rounded-[10px] bg-bg-card animate-pulse" />
        </div>
        <div className="h-10 w-full rounded bg-white/5 animate-pulse" />
      </div>
    </div>
  );
}

export function DetailCardErrorState({
  title,
  message,
  onDismiss,
  onRetry,
}: {
  title: string;
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 px-5 py-5 bg-bg-panel border border-input-error/30 rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.7)]"
    >
      <div className="section-label text-input-error text-xs">{title}</div>
      <p className="text-sm text-text-muted">{message}</p>
      {(onDismiss || onRetry) && (
        <div className="flex gap-2 pt-1">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1.5 rounded bg-button-primary hover:bg-button-primary-hover border border-button-primary-border text-sm font-semibold text-text-primary"
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 rounded bg-bg-card border border-border-subtle text-sm text-text-primary"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
