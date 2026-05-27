"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Loader2 } from "lucide-react";

type Props = {
  referenceId: string;
  /** True when the viewer has an authed session — if not, we route to
   *  /auth/sign-in with `next=` pointing back to this trip. */
  isAuthed: boolean;
  /** Pathname to come back to after sign-in. */
  returnPath: string;
};

export function MakeItMineCta({ referenceId, isAuthed, returnPath }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    if (!isAuthed) {
      router.push(`/auth/sign-in?next=${encodeURIComponent(returnPath)}`);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/trips/fork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference_id: referenceId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `fork_failed (${res.status})`);
        }
        const { id } = (await res.json()) as { id: string };
        router.push(`/trips/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <div className="absolute top-[22px] right-[80px] z-20 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="group flex items-center gap-2 h-10 px-4 rounded-[6px] bg-amber text-bg-base font-sans text-sm font-medium shadow-lg hover:scale-[1.02] active:scale-[0.99] transition-transform disabled:opacity-70 disabled:hover:scale-100"
      >
        {pending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Bookmark className="w-4 h-4" />
        )}
        Make it mine
      </button>
      {error && (
        <p className="font-mono text-[11px] bg-bg-panel/95 text-red-400 px-3 py-1.5 rounded shadow max-w-[280px]">
          {error}
        </p>
      )}
    </div>
  );
}
