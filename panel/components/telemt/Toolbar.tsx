"use client";

import { Bell, BellOff, ClipboardCopy, History, Pause, Play, RefreshCw, Search } from "lucide-react";
import { POLL_OPTIONS, formatAge, freshness, type Filter, type GroupBy, type Overall, type SortMode, type Source, type Summary } from "@/lib/telemtDc";
import { StateIcon } from "./StateBadge";
import type { Td } from "./useTd";

const btn =
  "inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--fg-subtle)] hover:bg-[var(--surface)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50";
const sel = "h-7 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 text-[11px] text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";

const overallStyle: Record<Overall, string> = {
  ok: "text-emerald-400",
  degraded: "text-amber-400",
  down: "text-red-400",
  empty: "text-[var(--fg-subtle)]",
};

export function overallText(td: Td, s: Summary): string {
  switch (s.overall) {
    case "ok":
      return td("overall.ok", "All {{n}} DCs available", { n: s.totalDcs });
    case "down":
      return td("overall.down", "{{n}} DC down", { n: s.down }) + (s.degraded ? `, ${td("overall.degradedN", "{{n}} degraded", { n: s.degraded })}` : "");
    case "degraded":
      return s.degraded > 0
        ? td("overall.degraded", "{{n}} DC degraded", { n: s.degraded })
        : td("overall.attention", "{{n}} instance(s) need attention", { n: s.unavailableInstances + s.sourcesWithErrors });
    default:
      return td("overall.empty", "No Telemt instances");
  }
}

export function overallState(s: Summary) {
  return s.overall === "ok" ? "up" : s.overall === "down" ? "down" : s.overall === "degraded" ? "degraded" : "unknown";
}

/** Headline: overall health + counts by source + freshness. */
export function SummaryLine({ summary, td, lastOkAt, now, poll, error, paused, compact }: { summary: Summary; td: Td; lastOkAt: number | null; now: number; poll: number; error: string | null; paused: boolean; compact?: boolean }) {
  const age = lastOkAt ? (now - lastOkAt) / 1000 : null;
  const fr = age == null ? "stale" : paused ? "aging" : freshness(age, poll);
  const frCls = fr === "fresh" ? "bg-emerald-400" : fr === "aging" ? "bg-amber-400" : "bg-red-400";
  const frText = fr === "fresh" ? td("fresh.fresh", "fresh") : fr === "aging" ? td("fresh.aging", "getting old") : td("fresh.stale", "stale");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${overallStyle[summary.overall]}`}>
        <StateIcon state={overallState(summary)} className="h-4 w-4" />
        {overallText(td, summary)}
      </span>
      {!compact && summary.totalDcs > 0 ? (
        <span className="font-mono text-[11px] text-[var(--fg-subtle)]" title={td("countsTip", "DC rows by state across all instances")}>
          {summary.up} {td("state.up", "available")} · {summary.degraded} {td("state.degraded", "degraded")} · {summary.down} {td("state.down", "unavailable")}
          {summary.unknown ? ` · ${summary.unknown} ${td("state.unknown", "unknown")}` : ""}
        </span>
      ) : null}
      {!compact && summary.bySource.length > 0 ? (
        <span className="text-[11px] text-[var(--fg-subtle)]" title={summary.bySource.map((b) => `${b.name}: ${b.up}/${b.degraded}/${b.down}`).join("\n")}>
          {summary.panelSources > 0 ? `${td("panel", "panel")} ${summary.panelSources}` : ""}
          {summary.panelSources > 0 && summary.nodeSources > 0 ? " · " : ""}
          {summary.nodeSources > 0 ? `${td("nodes", "nodes")} ${summary.nodeSources}` : ""}
          {summary.sourcesWithErrors > 0 ? ` · ${summary.sourcesWithErrors} ${td("withErrors", "with errors")}` : ""}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--fg-subtle)]" title={td("freshTip", "Age of the last successful poll")}>
        <span aria-hidden className={`h-2 w-2 rounded-full ${frCls}`} />
        {age == null ? td("noUpdate", "no data yet") : `${td("updated", "updated {{age}} ago", { age: formatAge(age) })} · ${frText}`}
        {paused ? ` · ${td("pausedLabel", "paused")}` : ""}
        {error ? <span className="text-red-400"> · {td("fetchError", "refresh failed")}</span> : null}
      </span>
    </div>
  );
}

export type ControlsProps = {
  td: Td;
  busy: boolean;
  paused: boolean;
  setPaused: (v: boolean) => void;
  refresh: () => void;
  poll: number;
  setPoll: (s: number) => void;
  notify: boolean;
  setNotify: (on: boolean) => void;
  notifyDenied: boolean;
  onCopy: (kind: "text" | "json") => void;
  eventsOpen: boolean;
  eventsCount: number;
  toggleEvents: () => void;
  minimal?: boolean;
};

export function Controls(p: ControlsProps) {
  const { td } = p;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={btn} onClick={p.refresh} title={td("refreshNow", "Refresh now")} aria-label={td("refreshNow", "Refresh now")}>
        <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${p.busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
      </button>
      <button type="button" className={btn} onClick={() => p.setPaused(!p.paused)} aria-pressed={p.paused} title={p.paused ? td("resume", "Resume auto-refresh") : td("pause", "Pause auto-refresh")} aria-label={p.paused ? td("resume", "Resume auto-refresh") : td("pause", "Pause auto-refresh")}>
        {p.paused ? <Play aria-hidden className="h-3.5 w-3.5" /> : <Pause aria-hidden className="h-3.5 w-3.5" />}
      </button>
      {p.minimal ? null : (
        <>
          <label className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-subtle)]">
            <span className="sr-only sm:not-sr-only">{td("interval", "Every")}</span>
            <select className={sel} value={p.poll} onChange={(e) => p.setPoll(Number(e.target.value))} aria-label={td("pollInterval", "Refresh interval")}>
              {POLL_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s} s
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`${btn} ${p.notify ? "border-[var(--accent)] text-[var(--fg)]" : ""}`}
            onClick={() => p.setNotify(!p.notify)}
            aria-pressed={p.notify}
            title={p.notifyDenied ? td("notifyDenied", "Notifications are blocked in the browser settings") : td("notifyTip", "Browser notification when a DC goes from up to down")}
          >
            {p.notify ? <Bell aria-hidden className="h-3.5 w-3.5" /> : <BellOff aria-hidden className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{td("notify", "Alerts")}</span>
          </button>
          <button type="button" className={btn} onClick={() => p.onCopy("text")} title={td("copyText", "Copy diagnostic summary (text)")}>
            <ClipboardCopy aria-hidden className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{td("copy", "Copy")}</span>
          </button>
          <button type="button" className={btn} onClick={() => p.onCopy("json")} title={td("copyJson", "Copy diagnostic data (JSON)")}>
            JSON
          </button>
          <button type="button" className={`${btn} ${p.eventsOpen ? "border-[var(--accent)] text-[var(--fg)]" : ""}`} onClick={p.toggleEvents} aria-expanded={p.eventsOpen}>
            <History aria-hidden className="h-3.5 w-3.5" />
            {td("events.title", "Events")} {p.eventsCount > 0 ? `(${p.eventsCount})` : ""}
          </button>
        </>
      )}
    </div>
  );
}

export function FilterBar({ td, filter, setFilter, sort, setSort, groupBy, setGroupBy, sources }: { td: Td; filter: Filter; setFilter: (f: Filter) => void; sort: SortMode; setSort: (s: SortMode) => void; groupBy: GroupBy; setGroupBy: (g: GroupBy) => void; sources: Source[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--fg-subtle)]" />
        <input
          type="search"
          value={filter.search}
          onChange={(e) => setFilter({ ...filter, search: e.target.value })}
          placeholder={td("search", "Search tag, remark, node")}
          aria-label={td("search", "Search tag, remark, node")}
          className={`${sel} w-40 pl-6`}
        />
      </label>
      <label className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-subtle)]">
        <input type="checkbox" checked={filter.problemsOnly} onChange={(e) => setFilter({ ...filter, problemsOnly: e.target.checked })} />
        {td("problemsOnly", "Problems only")}
      </label>
      {sources.length > 1 ? (
        <select className={sel} value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })} aria-label={td("filterSource", "Node")}>
          <option value="all">{td("allNodes", "All nodes")}</option>
          {sources.map((s) => (
            <option key={`${s.kind}-${s.nodeId}`} value={`${s.kind}-${s.nodeId}`}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
      <select className={sel} value={sort} onChange={(e) => setSort(e.target.value as SortMode)} aria-label={td("sort.label", "Sort")}>
        <option value="severity">{td("sort.severity", "Sort: problems first")}</option>
        <option value="rtt">{td("sort.rtt", "Sort: RTT")}</option>
        <option value="load">{td("sort.load", "Sort: sessions")}</option>
        <option value="dc">{td("sort.dc", "Sort: DC / name")}</option>
      </select>
      <div role="group" aria-label={td("group.label", "Group by")} className="inline-flex overflow-hidden rounded-md border border-[var(--border)]">
        {(["node", "dc"] as const).map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={groupBy === g}
            onClick={() => setGroupBy(g)}
            className={`h-7 px-2 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${groupBy === g ? "bg-[var(--surface)] text-[var(--fg)]" : "text-[var(--fg-subtle)] hover:text-[var(--fg)]"}`}
          >
            {g === "node" ? td("group.node", "By node") : td("group.dc", "By DC")}
          </button>
        ))}
      </div>
    </div>
  );
}
