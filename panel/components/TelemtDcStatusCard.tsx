"use client";

import { Globe2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconTile } from "@/components/ui";
import { Surface } from "@/components/panel";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import {
  EMPTY_FILTER,
  buildGroups,
  dcLabel,
  diagnosticJson,
  diagnosticText,
  filterSources,
  flatten,
  isUpToDown,
  summarize,
  viewModeFor,
  type Filter,
  type GroupBy,
  type SortMode,
  type ViewMode,
} from "@/lib/telemtDc";
import { EventLog } from "@/components/telemt/EventLog";
import { stateText } from "@/components/telemt/DcDetail";
import { Controls, FilterBar, SummaryLine } from "@/components/telemt/Toolbar";
import { ChipsView, CompactDots, TableView, type ViewCtx } from "@/components/telemt/Views";
import { useTd } from "@/components/telemt/useTd";
import { useTelemtDc } from "@/components/telemt/useTelemtDc";

/** Observes the element's box so the card can pick a layout for ANY tile size. */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number, h: number) => setBox((b) => (Math.abs(b.w - w) < 1 && Math.abs(b.h - h) < 1 ? b : { w, h }));
    apply(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) apply(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

/**
 * Telegram datacenter availability as seen by every running Telemt instance (panel and nodes).
 * Adapts to its container: compact (summary line + DC dots), medium (chip grid) and large
 * (table with sparklines). Data comes from GET api/inbounds/telemtDcStatus.
 */
export function TelemtDcStatusCard() {
  const td = useTd();
  const [ref, box] = useBox<HTMLDivElement>();
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortMode>("severity");
  const [groupBy, setGroupBy] = useState<GroupBy>("node");
  const [selected, setSelected] = useState<string | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const formatNotice = useCallback(
    (t: { dc: number | null; instanceLabel: string; sourceName: string }) => ({
      title: td("notifyTitle", "Telegram DC down"),
      body: `${t.dc == null ? td("events.instance", "instance") : dcLabel(t.dc)} - ${t.instanceLabel} (${t.sourceName})`,
    }),
    [td],
  );
  const d = useTelemtDc(formatNotice);

  const mode: ViewMode = box.w === 0 ? "medium" : viewModeFor(box.w, box.h);
  const sources = d.sources;
  const summary = useMemo(() => summarize(sources ?? []), [sources]);
  const filtered = useMemo(() => filterSources(sources ?? [], filter), [sources, filter]);
  const groups = useMemo(() => buildGroups(filtered, groupBy, sort), [filtered, groupBy, sort]);
  const flat = useMemo(() => flatten(filtered), [filtered]);

  const ctx: ViewCtx = {
    td,
    history: d.history,
    tracker: d.tracker,
    flash: d.flash,
    now: d.now,
    selected,
    onSelect: setSelected,
  };

  const copy = useCallback(
    async (kind: "text" | "json") => {
      const data = sources ?? [];
      try {
        await copyTextToClipboard(kind === "json" ? diagnosticJson(data, Date.now()) : diagnosticText(data, Date.now()));
        setCopied(td("copied", "Diagnostics copied"));
      } catch {
        setCopied(td("copyFailed", "Copy failed"));
      }
      window.setTimeout(() => setCopied(null), 2500);
    },
    [sources, td],
  );

  // Screen-reader announcement of worsening / recovering transitions (polite live region).
  const announce = useMemo(() => {
    const list = d.lastBatch.list.slice(0, 4);
    return list
      .map((t) => `${t.dc == null ? td("events.instance", "instance") : dcLabel(t.dc)} ${t.instanceLabel}: ${stateText(td, t.from)} > ${stateText(td, t.to)}${isUpToDown(t) ? "!" : ""}`)
      .join("; ");
  }, [d.lastBatch, td]);

  const empty = !sources || (sources.length === 0);
  // Nothing to show before the first answer and when no Telemt exists (same as before: hide the widget).
  if (empty) {
    return (
      <div ref={ref} aria-live="polite" className="sr-only">
        {d.error ? td("fetchError", "refresh failed") : ""}
      </div>
    );
  }

  const compact = mode === "compact";
  const controls = (
    <Controls
      td={td}
      busy={d.busy}
      paused={d.paused}
      setPaused={d.setPaused}
      refresh={() => void d.refresh()}
      poll={d.poll}
      setPoll={d.setPoll}
      notify={d.notify}
      setNotify={(on) => void d.setNotify(on)}
      notifyDenied={d.notifyDenied}
      onCopy={(k) => void copy(k)}
      eventsOpen={eventsOpen}
      eventsCount={d.events.length}
      toggleEvents={() => setEventsOpen((v) => !v)}
      minimal={compact || mode === "medium" && box.w < 520}
    />
  );

  return (
    <div ref={ref} className="@container h-full min-h-0 w-full min-w-0">
      <Surface padding="none" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className={`flex min-h-0 flex-1 flex-col ${compact ? "gap-2 p-3" : "gap-3 p-4"}`}>
          <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              {compact ? null : <IconTile icon={Globe2} tone="accent" size="sm" />}
              <div className="min-w-0 flex-1">
                {compact ? null : (
                  <h3 className="mb-1 text-sm font-semibold text-[var(--fg)]">{td("title", "Telegram DC availability (Telemt)")}</h3>
                )}
                <SummaryLine summary={summary} td={td} lastOkAt={d.lastOkAt} now={d.now} poll={d.poll} error={d.error} paused={d.paused} compact={compact} />
              </div>
            </div>
            {controls}
          </header>

          {!compact ? (
            <FilterBar td={td} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} groupBy={groupBy} setGroupBy={setGroupBy} sources={sources} />
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto" tabIndex={-1}>
            {/* per-source problems (slow / unreachable node, stale data) */}
            {filtered.some((s) => s.error || s.stale) ? (
              <ul className="mb-2 space-y-1">
                {filtered
                  .filter((s) => s.error || s.stale)
                  .map((s) => (
                    <li key={`${s.kind}-${s.nodeId}`} className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1 text-xs text-red-400">
                      <span className="font-medium">{s.name}</span>: {s.error}
                      {s.stale ? ` - ${td("staleData", "showing last known data")}` : ""}
                      <span className="block text-[10px] text-[var(--fg-subtle)]">{td("hint.nodeError", "Check that the node is online and its agent is up to date; the other nodes are unaffected.")}</span>
                    </li>
                  ))}
              </ul>
            ) : null}

            {compact ? (
              <CompactDots rows={flat} ctx={ctx} />
            ) : groups.length === 0 ? (
              <p className="text-xs text-[var(--fg-subtle)]">{td("noMatches", "Nothing matches the filter.")}</p>
            ) : mode === "medium" ? (
              <ChipsView groups={groups} ctx={ctx} />
            ) : (
              <TableView groups={groups} ctx={ctx} />
            )}

            {!compact && eventsOpen ? (
              <section className="mt-3 rounded-xl border border-[var(--border)]/80 p-3" aria-label={td("events.title", "Events")}>
                <h4 className="mb-1.5 text-xs font-semibold text-[var(--fg)]">{td("events.heading", "Recent state changes")}</h4>
                <EventLog events={d.events} td={td} />
              </section>
            ) : null}
          </div>

          {!compact ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--fg-subtle)]">
              <span>{td("legendRtt", "ms = latency from this server to the DC")}</span>
              <span>{td("legendMedia", "DC<n> media = media datacenter, DC203 CDN = CDN cluster")}</span>
              {copied ? <span className="text-emerald-400">{copied}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="sr-only" aria-live="polite" role="status">
          {announce}
          {copied}
        </div>
      </Surface>
    </div>
  );
}
