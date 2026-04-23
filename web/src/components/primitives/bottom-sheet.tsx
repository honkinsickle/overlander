"use client";

import * as React from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export type BottomSheetProps = {
  /** Controlled open state. Omit to use trigger-driven uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the sheet (optional if controlled). */
  trigger?: React.ReactNode;
  title: string;
  subtitle?: string;
  /** Max height as a CSS value. Default 80vh. */
  maxHeight?: string;
  children?: React.ReactNode;
  className?: string;
};

/**
 * Bottom sheet built on vaul (via shadcn Drawer).
 * Rises from the bottom, grabber, top rounded, dark --bg-panel.
 * Used for "More options" overnight list and similar list-over-map UIs.
 */
export function BottomSheet({
  open,
  onOpenChange,
  trigger,
  title,
  subtitle,
  maxHeight,
  children,
  className,
}: BottomSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {trigger && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}
      <DrawerContent
        className={cn(
          "bg-bg-panel border-border-subtle text-text-primary",
          className,
        )}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <header className="flex items-start justify-between gap-3 px-5 pt-2 pb-3 text-left">
          <div className="flex flex-col gap-1">
            <DrawerTitle className="font-sans text-xl font-bold leading-tight text-text-primary">
              {title}
            </DrawerTitle>
            {subtitle && (
              <DrawerDescription className="section-label text-[11px] tracking-[0.04em] text-text-muted">
                {subtitle}
              </DrawerDescription>
            )}
          </div>
          <DrawerClose
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-card shrink-0"
          >
            ✕
          </DrawerClose>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
