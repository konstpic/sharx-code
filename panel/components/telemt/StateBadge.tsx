"use client";

import { AlertTriangle, CheckCircle2, HelpCircle, XCircle, type LucideIcon } from "lucide-react";
import type { DCState } from "@/lib/telemtDc";

export const stateBox: Record<DCState, string> = {
  up: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  degraded: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  down: "border-red-500/40 bg-red-500/10 text-red-400",
  unknown: "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-subtle)]",
};

export const stateDot: Record<DCState, string> = {
  up: "bg-emerald-400",
  degraded: "bg-amber-400",
  down: "bg-red-400",
  unknown: "bg-[var(--fg-subtle)]",
};

export const stateStroke: Record<DCState, string> = {
  up: "stroke-emerald-400",
  degraded: "stroke-amber-400",
  down: "stroke-red-400",
  unknown: "stroke-[var(--fg-subtle)]",
};

export const stateBar: Record<DCState, string> = {
  up: "bg-emerald-400",
  degraded: "bg-amber-400",
  down: "bg-red-400",
  unknown: "bg-[var(--fg-subtle)]",
};

const icons: Record<DCState, LucideIcon> = { up: CheckCircle2, degraded: AlertTriangle, down: XCircle, unknown: HelpCircle };

export function StateIcon({ state, className = "h-3.5 w-3.5" }: { state: DCState; className?: string }) {
  const I = icons[state];
  return <I aria-hidden className={className} />;
}

/** State is always shown as icon + (optionally) text, never by colour alone. */
export function StateBadge({ state, label, showText = true }: { state: DCState; label: string; showText?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${stateBox[state]}`} title={label}>
      <StateIcon state={state} className="h-3 w-3 shrink-0" />
      {showText ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}
