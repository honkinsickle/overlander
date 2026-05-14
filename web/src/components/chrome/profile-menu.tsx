"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { signOut } from "@/app/auth/actions";

type Props = {
  /** Signed-in user, if any. */
  user: { name: string; avatarUrl: string | null } | null;
};

/** Bottom of the vertical nav. Shows the user's initial avatar →
 *  dropdown with a sign-out Server Action; or a sign-in link when
 *  there's no session. */
export function ProfileMenu({ user }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (!user) {
    return (
      <Link
        href="/auth/sign-in"
        className="flex flex-col items-center gap-1 text-text-primary hover:text-amber transition-colors"
      >
        <div className="w-10 h-10 flex items-center justify-center rounded">
          <LogIn className="w-5 h-5" />
        </div>
        <span className="font-sans text-[11px]">Sign in</span>
      </Link>
    );
  }

  const initial = user.name?.charAt(0)?.toUpperCase() || "?";

  return (
    <div ref={rootRef} className="relative flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="w-10 h-10 rounded-full bg-amber text-bg-base font-display text-base flex items-center justify-center hover:opacity-90 transition-opacity overflow-hidden"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          initial
        )}
      </button>
      <span className="font-sans text-[11px] text-text-primary">Account</span>

      {open && (
        <div className="absolute bottom-full left-full mb-2 ml-2 w-56 bg-bg-panel border border-border-subtle rounded shadow-lg p-3 flex flex-col gap-2 z-50">
          <div className="px-1 pb-2 border-b border-border-subtle">
            <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-text-secondary">
              Signed in as
            </p>
            <p className="font-sans text-sm text-text-primary truncate">
              {user.name}
            </p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-text-primary hover:bg-bg-nav-btn font-sans text-sm text-left"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
