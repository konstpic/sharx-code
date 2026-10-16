"use client";

import { useMemo, useState } from "react";
import { Surface } from "@/components/panel";
import { flatten, formatAge, freshness, summarize } from "@/lib/telemtDc";
import { StateIcon, stateBox } from "./StateBadge";
import { SummaryLine, overallState, overallText } from "./Toolbar";
import { CompactDots } from "./Views";
import { useCardBox } from "./useCardBox";
import { useTd } from "./useTd";
import { useTelemtDc } from "./useTelemtDc";

const tone = { ok: "text-emerald-400", degraded: "text-amber-400", down: "text-red-400", empty: "text-[var(--fg-subtle)]" } as const;

/**
 * Atomic tile: overall DC health + counts + freshness (fits 2x2 .. 4x3). Shares the page-wide poller.
 */
export function TelemtDcSummary() {
  const td = useTd();
  const box = useCardBox();
  const d = useTelemtDc();
  const sources = d.sources;
  const s = useMemo(() => summarize(sources ?? []), [sources]);
  if (!sources || sources.length === 0) return <div ref={box.ref} className="sr-only" aria-live="polite" />;
  const age = d.lastOkAt ? (d.now - d.lastOkAt) / 1000 : null;
  const fr = age == null ? "stale" : d.paused ? "aging" : freshness(age, d.poll);
  const frCls = fr === "fresh" ? "bg-emerald-400" : fr === "aging" ? "bg-amber-400" : "bg-red-400";
  const small = box.width > 0 && (box.width < 200 || (box.height > 0 && box.height < 110));
  const stats: { n: number; state: "up" | "degraded" | "down" | "unknown"; label: string }[] = [
    { n: s.up, state: "up", label: td("state.up", "available") },
    { n: s.degraded, state: "degraded", label: td("state.degraded", "degraded") },
    { n: s.down, state: "down", label: td("state.down", "unavailable") },
    { n: s.unknown, state: "unknown", label: td("state.unknown", "unknown") },
  ];
  return (
    <div ref={box.ref} style={box.style} className="@container flex h-full min-h-0 w-full min-w-0 flex-col">
      <Surface padding="none" className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-auto p-3">
        <div className={`flex items-center gap-2 font-semibold ${tone[s.overall]} ${small ? "text-sm" : "text-base @sm:text-lg"}`}>
          <StateIcon state={overallState(s)} className={small ? "h-4 w-4 shrink-0" : "h-5 w-5 shrink-0"} />
          <span className="min-w-0">{overallText(td, s)}</span>
        </div>
        {small ? null : (
          <ul className="flex flex-wrap gap-1.5" aria-label={td("countsTip", "DC rows by state across all instances")}>
            {stats
              .filter((x) => x.n > 0 || x.state !== "unknown")
              .map((x) => (
                <li key={x.state} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${stateBox[x.state]}`}>
                  <StateIcon state={x.state} className="h-3 w-3" />
                  <span className="font-mono">{x.n}</span>
                  <span className="hidden @[14rem]:inline">{x.label}</span>
                </li>
              ))}
          </ul>
        )}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--fg-subtle)]" title={td("freshTip", "Age of the last successful poll")}>
          <span aria-hidden className={`h-2 w-2 rounded-full ${frCls}`} />
          {age == null ? td("noUpdate", "no data yet") : td("updated", "updated {{age}} ago", { age: formatAge(age) })}
          {d.paused ? ` · ${td("pausedLabel", "paused")}` : ""}
          {d.error ? <span className="text-red-400"> · {td("fetchError", "refresh failed")}</span> : null}
        </span>
      </Surface>
    </div>
  );
}

/** Atomic tile: the DC dot strip (fits 4x2). Click a dot to see its state; shares the page-wide poller. */
export function TelemtDcDots() {
  const td = useTd();
  const box = useCardBox();
  const d = useTelemtDc();
  const [selected, setSelected] = useState<string | null>(null);
  const sources = d.sources;
  const summary = useMemo(() => summarize(sources ?? []), [sources]);
  const flat = useMemo(() => flatten(sources ?? []), [sources]);
  if (!sources || sources.length === 0) return <div ref={box.ref} className="sr-only" aria-live="polite" />;
  return (
    <div ref={box.ref} style={box.style} className="@container flex h-full min-h-0 w-full min-w-0 flex-col">
      <Surface padding="none" className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
        <SummaryLine summary={summary} td={td} lastOkAt={d.lastOkAt} now={d.now} poll={d.poll} error={d.error} paused={d.paused} compact />
        <CompactDots rows={flat} ctx={{ td, history: d.history, tracker: d.tracker, flash: d.flash, now: d.now, selected, onSelect: setSelected }} />
      </Surface>
    </div>
  );
}
