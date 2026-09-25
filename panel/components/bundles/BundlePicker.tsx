"use client";

import { Check } from "lucide-react";

export type BundlePickerOption = { id: number; name: string; clientCount?: number };

/** A strict, scrollable multi-select list: click a row to toggle it, selected rows are highlighted. */
export function BundlePicker({
  options,
  selected,
  onToggle,
  label,
  countLabel,
  className = "",
}: {
  options: BundlePickerOption[];
  selected: Record<number, boolean>;
  onToggle: (id: number) => void;
  label: string;
  countLabel?: (n: number) => string;
  className?: string;
}) {
  return (
    <div
      role="listbox"
      aria-multiselectable
      aria-label={label}
      className={`max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 ${className}`}
    >
      {options.map((o) => {
        const on = !!selected[o.id];
        return (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={on}
            onClick={() => onToggle(o.id)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              on
                ? "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--fg)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_40%,transparent)]"
                : "text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]"
            }`}
          >
            <span
              className={`grid size-4 shrink-0 place-items-center rounded border ${
                on ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg,#fff)]" : "border-[var(--border)]"
              }`}
              aria-hidden
            >
              {on ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
            {o.clientCount != null && countLabel ? (
              <span className="shrink-0 text-xs text-[var(--fg-subtle)]">{countLabel(o.clientCount)}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
