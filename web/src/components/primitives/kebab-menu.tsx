"use client";

import * as React from "react";
import { MoreVertical } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type KebabMenuItem = {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  onSelect?: () => void;
  /** Render a divider above this item. */
  dividerBefore?: boolean;
};

export type KebabMenuProps = {
  items: KebabMenuItem[];
  /** Accessible label for the trigger button (e.g. "Day options"). */
  triggerLabel: string;
  className?: string;
};

/**
 * Kebab (⋮) menu built on shadcn Popover.
 * Trigger: 36×36 button, --bg-nav-btn surface, --border-subtle.
 * Content: --bg-panel surface, 10px radius, 6px outer padding.
 */
export function KebabMenu({ items, triggerLabel, className }: KebabMenuProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={triggerLabel}
        className={cn(
          "flex items-center justify-center w-9 h-9 rounded border border-[rgba(167,204,253,0.12)] text-text-primary shrink-0",
          "hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focus",
          className,
        )}
      >
        <MoreVertical className="w-4 h-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 bg-bg-panel border border-border-subtle rounded-[10px] p-1.5 ring-0 shadow-[0_16px_32px_rgba(0,0,0,0.5)]"
      >
        <ul className="flex flex-col" role="menu">
          {items.map((item) => (
            <React.Fragment key={item.id}>
              {item.dividerBefore && (
                <li
                  role="separator"
                  className="my-1 h-px bg-border-subtle"
                />
              )}
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={item.onSelect}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded text-left text-sm font-sans",
                    item.danger
                      ? "text-input-error hover:bg-input-error/10"
                      : "text-text-primary hover:bg-bg-card",
                  )}
                >
                  {item.icon && (
                    <item.icon
                      className={cn(
                        "w-4 h-4 shrink-0",
                        item.danger ? "text-input-error" : "text-text-muted",
                      )}
                    />
                  )}
                  <span className="flex-1">{item.label}</span>
                </button>
              </li>
            </React.Fragment>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
