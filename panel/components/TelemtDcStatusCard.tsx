"use client";

import { Globe2, SlidersHorizontal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
  pickTelemtMode,
  type TelemtMode,
  type Filter,
  type GroupBy,
  type SortMode,
} from "@/lib/telemtDc";
import { EventLog } from "@/components/telemt/EventLog";
import { stateText } from "@/components/telemt/DcDetail";
import { StateIcon } from "@/components/telemt/StateBadge";
import { Controls, FilterBar, SummaryLine, overallState, overallText } from "@/components/telemt/Toolbar";
import { ChipsView, CompactDots, TableView, type ViewCtx } from "@/components/telemt/Views";
import { useTd } from "@/components/telemt/useTd";
import { useTelemtDc } from "@/components/telemt/useTelemtDc";
import { useCardBox } from "@/components/telemt/useCardBox";
import { DcDetail } from "@/components/telemt/DcDetail";

/**
 * Telegram datacenter availability as seen by every running Telemt instance (panel and nodes).
 * Adapts to its container: compact (summary line + DC dots), medium (chip grid) and large
 * (table with sparklines). Data comes from GET api/inbounds/telemtDcStatus.
 */
export function TelemtDcStatusCard() {
  const td = useTd();
  const box = useCardBox();
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortMode>("severity");
  const [groupBy, setGroupBy] = useState<GroupBy>("node");
  const [selected, setSelected] = useState<string | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const formatNotice = useCallback(
    (t: { dc: number | null; instanceLabel: string; sourceName: string }) => ({
      title: td("notifyTitle", "Telegram DC down"),
      body: `${t.dc == null ? td("events.instance", "instance") : dcLabel(t.dc)} - ${t.instanceLabel} (${t.sourceName})`,
    }),
    [td],
  );
  const d = useTelemtDc(formatNotice);

  const [mode, setMode] = useState<TelemtMode>("medium");
  const nextMode = pickTelemtMode(box.width, box.height, mode);
  if (nextMode !== mode) setMode(nextMode);
  const sources = d.sources;
  const summary = useMemo(() => summarize(sources ?? []), [sources]);
  const filtered = useMemo(() => filterSources(sources ?? [], filter), [sources, filter]);
  const groups = useMemo(() => buildGroups(filtered, mode === "medium" ? "node" : groupBy, sort), [filtered, groupBy, sort, mode]);
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
      <div ref={box.ref} aria-live="polite" className="sr-only">
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
      minimal={compact || (mode === "medium" && box.width < 520)}
    />
  );

  const wide = mode === "wide";
  // Filters need room: hidden on short tiles, collapsible elsewhere (open by default only from "large").
  const canFilter = !compact && box.height >= 300;
  const showFilters = canFilter && (filtersOpen ?? (mode === "large" || wide));
  const tiny = box.height > 0 && box.height < 150;
  const selFlat = selected ? flat.find((r) => r.key === selected) : undefined;
  const nodeErrors = filtered.filter((s) => s.error || s.stale);
  const eventsBlock = (
    <section className="rounded-xl border border-[var(--border)]/80 p-3" aria-label={td("events.title", "Events")}>
      <h4 className="mb-1.5 text-xs font-semibold text-[var(--fg)]">{td("events.heading", "Recent state changes")}</h4>
      <EventLog events={d.events} td={td} />
    </section>
  );

  const body = compact ? (
    <CompactDots rows={flat} ctx={ctx} />
  ) : groups.length === 0 ? (
    <p className="text-xs text-[var(--fg-subtle)]">{td("noMatches", "Nothing matches the filter.")}</p>
  ) : mode === "medium" ? (
    <ChipsView groups={groups} ctx={ctx} />
  ) : (
    <TableView groups={groups} ctx={ctx} inlineDetail={!wide} />
  );

  // Root: pinned to the measured tile body height (no reliance on an ancestor CSS height), scrolls inside.
  return (
    <div ref={box.ref} style={box.style} className="@container flex h-full min-h-0 w-full min-w-0 flex-col">
      <Surface padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={`flex min-h-0 flex-1 flex-col ${compact ? "gap-2 p-3" : "gap-3 p-4"}`}>
          <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              {compact || box.hideTitle ? null : <IconTile icon={Globe2} tone="accent" size="sm" />}
              <div className="min-w-0 flex-1">
                {compact || box.hideTitle ? null : (
                  <h3 className="mb-1 text-sm font-semibold text-[var(--fg)]">{td("title", "Telegram DC availability (Telemt)")}</h3>
                )}
                {tiny ? (
                  <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${summary.overall === "ok" ? "text-emerald-400" : summary.overall === "down" ? "text-red-400" : "text-amber-400"}`}>
                    <StateIcon state={overallState(summary)} className="h-4 w-4" />
                    {overallText(td, summary)}
                  </span>
                ) : (
                  <SummaryLine summary={summary} td={td} lastOkAt={d.lastOkAt} now={d.now} poll={d.poll} error={d.error} paused={d.paused} compact={compact} />
                )}
              </div>
            </div>
            {controls}
          </header>

          {canFilter ? (
            <div className="flex shrink-0 items-start gap-1.5">
              <button
                type="button"
                onClick={() => setFiltersOpen(!showFilters)}
                aria-pressed={showFilters}
                aria-label={td("search", "Search tag, remark, node")}
                title={td("search", "Search tag, remark, node")}
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[var(--fg-subtle)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${showFilters ? "border-[var(--accent)] text-[var(--fg)]" : "border-[var(--border)]"}`}
              >
                <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
              </button>
              {showFilters ? <div className="min-w-0 flex-1 overflow-x-auto"><FilterBar td={td} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} groupBy={groupBy} setGroupBy={setGroupBy} sources={sources} /></div> : null}
            </div>
          ) : null}

          {/* content is top-aligned and keeps natural row height; only this area scrolls */}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]" tabIndex={-1}>
            {nodeErrors.length ? (
              <ul className="mb-2 space-y-1">
                {nodeErrors.map((s) => (
                  <li key={`${s.kind}-${s.nodeId}`} className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1 text-xs text-red-400">
                    <span className="font-medium">{s.name}</span>: {s.error}
                    {s.stale ? ` - ${td("staleData", "showing last known data")}` : ""}
                    <span className="block text-[10px] text-[var(--fg-subtle)]">{td("hint.nodeError", "Check that the node is online and its agent is up to date; the other nodes are unaffected.")}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {wide ? (
              <div className="grid items-start gap-3" style={{ gridTemplateColumns: "minmax(0,1.7fr) minmax(280px,1fr)" }}>
                <div className="min-w-0">{body}</div>
                <aside className="sticky top-0 min-w-0 space-y-3">
                  {selFlat ? (
                    <DcDetail row={selFlat.row} inst={selFlat.inst} samples={d.history[selFlat.key]} since={d.tracker[selFlat.key]?.since} now={d.now} td={td} />
                  ) : (
                    <p className="rounded-xl border border-dashed border-[var(--border)] p-3 text-xs text-[var(--fg-subtle)]">{td("pickDc", "Select a DC row to see its details.")}</p>
                  )}
                  {eventsBlock}
                </aside>
              </div>
            ) : (
              <>
                {body}
                {!compact && eventsOpen ? <div className="mt-3">{eventsBlock}</div> : null}
              </>
            )}
          </div>

          {!compact && mode !== "medium" ? (
            <p className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--fg-subtle)]">
              <span>{td("legendRtt", "ms = latency from this server to the DC")}</span>
              <span>{td("legendMedia", "DC<n> media = media datacenter, DC203 CDN = CDN cluster")}</span>
              {copied ? <span className="text-emerald-400">{copied}</span> : null}
            </p>
          ) : copied ? (
            <p className="shrink-0 text-[11px] text-emerald-400">{copied}</p>
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

export { TelemtDcSummary, TelemtDcDots } from "@/components/telemt/Atoms";
