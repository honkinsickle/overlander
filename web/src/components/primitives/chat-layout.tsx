import * as React from "react";
import Link from "next/link";
import { ArrowLeft, PenSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatLayoutProps = {
  title: string;
  /** Small wide-tracked label under the title (Space Grotesk). */
  subtitle?: string;
  /** Route or callback for the close/back action. */
  closeHref?: string;
  onClose?: () => void;
  /** Optional right-side header slot (e.g. new-chat button). */
  headerAction?: React.ReactNode;
  /** The composer bar — typically contains an `.form-field` input + send button. */
  input: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

/**
 * Full-column takeover for Ask Autopilot and similar chat flows.
 * Vertical stack: fixed header (60h) + scrollable message area + pinned input bar.
 *
 * Route-based close (via closeHref) is preferred — closing the takeover unmounts
 * this subtree, so message draft state should be serialized somewhere persistent
 * (URL, local storage, server) rather than kept in layout state.
 */
export function ChatLayout({
  title,
  subtitle,
  closeHref,
  onClose,
  headerAction,
  input,
  children,
  className,
}: ChatLayoutProps) {
  return (
    <section className={cn("flex flex-col h-full bg-bg-panel", className)}>
      <header className="flex items-center justify-between h-[60px] px-4 border-b border-border-subtle shrink-0">
        <CloseAffordance closeHref={closeHref} onClose={onClose} />
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-sans text-sm font-semibold text-text-primary">
            {title}
          </span>
          {subtitle && (
            <span className="section-label text-[10px] tracking-[0.08em] text-text-muted">
              {subtitle}
            </span>
          )}
        </div>
        <div className="w-9 h-9 flex items-center justify-center">
          {headerAction ?? (
            <span aria-hidden className="w-9 h-9 block" />
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

      <div className="p-4 border-t border-border-subtle flex items-center gap-2.5 shrink-0">
        {input}
      </div>
    </section>
  );
}

function CloseAffordance({
  closeHref,
  onClose,
}: {
  closeHref?: string;
  onClose?: () => void;
}) {
  const className =
    "flex items-center justify-center w-9 h-9 rounded text-text-primary hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focus";
  if (closeHref) {
    return (
      <Link href={closeHref} aria-label="Close" className={className}>
        <ArrowLeft className="w-4 h-4" />
      </Link>
    );
  }
  if (onClose) {
    return (
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={className}
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
    );
  }
  return <span aria-hidden className="w-9 h-9" />;
}

/** New-chat pencil — common header action for ChatLayout. */
export function ChatLayoutNewChatAction({
  href,
  onClick,
}: {
  href?: string;
  onClick?: () => void;
}) {
  const className =
    "flex items-center justify-center w-9 h-9 rounded text-text-primary hover:bg-bg-card";
  if (href) {
    return (
      <Link href={href} aria-label="New chat" className={className}>
        <PenSquare className="w-4 h-4" />
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label="New chat"
      onClick={onClick}
      className={className}
    >
      <PenSquare className="w-4 h-4" />
    </button>
  );
}
