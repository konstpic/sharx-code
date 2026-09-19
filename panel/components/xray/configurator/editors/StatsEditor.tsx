"use client";

import { BarChart3 } from "lucide-react";
import { useMemo } from "react";
import { makeTr, type SectionEditorProps } from "../fields";

export function StatsEditor({ t }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
        <BarChart3 size={18} />
      </div>
      <div className="space-y-1 text-sm">
        <div className="font-medium text-[var(--fg)]">{tr("statsOn", "Traffic statistics are enabled")}</div>
        <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
          {tr(
            "statsBody",
            "This section has no options: its presence turns statistics on. Which counters are collected (per user, per inbound, per outbound) is set in the Policy section. Remove the section to disable statistics entirely.",
          )}
        </p>
      </div>
    </div>
  );
}
