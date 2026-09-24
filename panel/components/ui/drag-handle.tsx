"use client";

import { GripVertical } from "lucide-react";
import type { HTMLAttributes } from "react";

/** Grip icon that starts a drag when the list supports manual ordering (dimmed and inert otherwise). */
export function DragHandle({
  enabled,
  label,
  disabledHint,
  className = "",
  ...rest
}: {
  enabled: boolean;
  label: string;
  disabledHint?: string;
  className?: string;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...(enabled ? rest : {})}
      role="img"
      aria-label={label}
      title={enabled ? label : disabledHint ?? label}
      onClick={(e) => e.stopPropagation()}
      className={`inline-grid size-6 shrink-0 place-items-center rounded-md text-[var(--fg-subtle)] transition ${
        enabled ? "cursor-grab hover:bg-[color-mix(in_oklab,var(--fg)_9%,transparent)] hover:text-[var(--fg)] active:cursor-grabbing" : "cursor-not-allowed opacity-35"
      } ${className}`}
    >
      <GripVertical size={16} aria-hidden />
    </span>
  );
}
