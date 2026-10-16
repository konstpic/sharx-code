"use client";

import { Fragment } from "react";
import { dcKind, dcLabel, formatAge, groupByDc, rttSeries, type DCRow, type FlatRow, type Group, type History, type Tracker } from "@/lib/telemtDc";
import { Bar, DcDetail, dcKindText, ipText, stateText } from "./DcDetail";
import { InstanceDetails, InstanceHeader, UnavailableNotice } from "./InstanceMeta";
import { Sparkline } from "./Sparkline";
import { StateIcon, stateBox } from "./StateBadge";
import type { Td } from "./useTd";

export type ViewCtx = {
  td: Td;
  history: History;
  tracker: Tracker;
  flash: Set<string>;
  now: number;
  selected: string | null;
  onSelect: (key: string | null) => void;
};

const flashCls = "ring-2 ring-[var(--accent)] animate-pulse motion-reduce:animate-none";

function chipTip(td: Td, r: DCRow): string {
  return [
    `${dcLabel(r.dc)} (${dcKindText(td, r.dc).label}): ${stateText(td, r.state)}`,
    typeof r.rttMs === "number" ? `RTT: ${Math.round(r.rttMs)} ms` : "",
    r.endpoints > 0 ? `${td("endpoints", "Endpoints")}: ${r.availableEndpoints}/${r.endpoints}` : "",
    r.requiredWriters > 0 ? `${td("writers", "ME writers")}: ${r.aliveWriters}/${r.requiredWriters} (${Math.round(r.coveragePct)}%)` : "",
    r.load > 0 ? `${td("load", "Sessions")}: ${r.load}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ compact */

/** Compact tile body: one coloured dot per DC id (worst state across instances). */
export function CompactDots({ rows, ctx }: { rows: FlatRow[]; ctx: ViewCtx }) {
  const { td } = ctx;
  const groups = groupByDc(rows);
  const sel = groups.find((g) => g.rows.some((r) => r.key === ctx.selected));
  return (
    <div>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label={td("dcList", "Datacenters")}>
        {groups.map((g) => {
          const flashing = g.rows.some((r) => ctx.flash.has(r.key));
          const sel1 = sel?.dc === g.dc;
          return (
            <li key={g.dc}>
              <button
                type="button"
                onClick={() => ctx.onSelect(sel1 ? null : g.rows[0].key)}
                aria-pressed={sel1}
                aria-label={`${dcLabel(g.dc)}: ${stateText(td, g.state)}`}
                title={`${dcLabel(g.dc)}: ${stateText(td, g.state)}${g.rttMax != null ? ` · ${Math.round(g.rttMax)} ms` : ""}`}
                className={`inline-flex h-6 min-w-[2.25rem] items-center justify-center gap-1 rounded-md border px-1 text-[10px] font-semibold ${stateBox[g.state]} ${flashing ? flashCls : ""} ${sel1 ? "outline outline-1 outline-[var(--fg-subtle)]" : ""}`}
              >
                <StateIcon state={g.state} className="h-2.5 w-2.5" />
                {dcKind(g.dc) === "media" ? `m${-g.dc}` : g.dc === 203 ? "CDN" : g.dc}
              </button>
            </li>
          );
        })}
      </ul>
      {sel ? (
        <p className="mt-1.5 truncate text-[11px] text-[var(--fg-subtle)]">
          <span className="font-medium text-[var(--fg)]">{dcLabel(sel.dc)}</span> · {stateText(td, sel.state)}
          {sel.rttMax != null ? ` · ${Math.round(sel.rttMax)} ms` : ""}
          {sel.rows.length > 1 ? ` · ${sel.rows.length} ${td("instances", "instances")}` : ""}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ medium: chips */

function Chip({ fr, ctx, label }: { fr: FlatRow; ctx: ViewCtx; label: string }) {
  const { row } = fr;
  const open = ctx.selected === fr.key;
  const flashing = ctx.flash.has(fr.key);
  return (
    <button
      type="button"
      onClick={() => ctx.onSelect(open ? null : fr.key)}
      aria-expanded={open}
      title={chipTip(ctx.td, row)}
      className={`flex min-w-[78px] flex-col items-center rounded-lg border px-2.5 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${stateBox[row.state]} ${open ? "outline outline-1 outline-[var(--fg-subtle)]" : ""} ${flashing ? flashCls : ""}`}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        <StateIcon state={row.state} className="h-3 w-3" />
        <span className="max-w-[110px] truncate">{label}</span>
      </span>
      <span className="font-mono text-[10px] opacity-80">{typeof row.rttMs === "number" ? `${Math.round(row.rttMs)} ms` : "-"}</span>
      <span className="sr-only">{stateText(ctx.td, row.state)}</span>
    </button>
  );
}

export function ChipsView({ groups, ctx }: { groups: Group[]; ctx: ViewCtx }) {
  const { td } = ctx;
  return (
    <div className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2">
      {groups.map((g) => {
        const selRow = g.rows.find((r) => r.key === ctx.selected);
        return (
          <section key={g.id} className="min-w-0 rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/40 p-3" aria-label={g.inst ? g.inst.remark : dcLabel(g.dc ?? 0)}>
            {g.inst ? (
              <>
                <div className="mb-2">
                  <InstanceHeader inst={g.inst} source={g.source} td={td} showSource />
                </div>
                {g.inst.available ? (
                  <div className="flex flex-wrap gap-2">
                    {g.rows.map((r) => (
                      <Chip key={r.key} fr={r} ctx={ctx} label={dcLabel(r.row.dc)} />
                    ))}
                  </div>
                ) : (
                  <UnavailableNotice inst={g.inst} td={td} />
                )}
              </>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${stateBox[g.state]}`}>
                    <StateIcon state={g.state} className="h-3 w-3" />
                    {dcLabel(g.dc ?? 0)}
                  </span>
                  <span className="text-[11px] text-[var(--fg-subtle)]" title={dcKindText(td, g.dc ?? 0).tip}>
                    {dcKindText(td, g.dc ?? 0).label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.rows.map((r) => (
                    <Chip key={r.key} fr={r} ctx={ctx} label={r.inst.remark} />
                  ))}
                </div>
              </>
            )}
            {selRow ? (
              <div className="mt-2.5">
                <DcDetail row={selRow.row} inst={selRow.inst} samples={ctx.history[selRow.key]} since={ctx.tracker[selRow.key]?.since} now={ctx.now} td={td} />
              </div>
            ) : null}
            {g.inst ? <InstanceDetails inst={g.inst} now={ctx.now} td={td} /> : null}
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ large: table */

export function TableView({ groups, ctx, inlineDetail = true }: { groups: Group[]; ctx: ViewCtx; inlineDetail?: boolean }) {
  const { td } = ctx;
  const th = "sticky top-0 z-[1] bg-[var(--bg-elevated)] px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]";
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <section key={g.id} className="min-w-0 rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/30" aria-label={g.inst ? g.inst.remark : dcLabel(g.dc ?? 0)}>
          <div className="border-b border-[var(--border)]/60 px-3 py-2">
            {g.inst ? (
              <InstanceHeader inst={g.inst} source={g.source} td={td} showSource />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${stateBox[g.state]}`}>
                  <StateIcon state={g.state} className="h-3 w-3" />
                  {dcLabel(g.dc ?? 0)}
                </span>
                <span className="text-[11px] text-[var(--fg-subtle)]" title={dcKindText(td, g.dc ?? 0).tip}>
                  {dcKindText(td, g.dc ?? 0).label}
                </span>
              </div>
            )}
          </div>
          {g.inst && !g.inst.available ? (
            <div className="p-3">
              <UnavailableNotice inst={g.inst} td={td} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={th}>{g.inst ? "DC" : td("instance", "Instance")}</th>
                    <th className={th}>{td("stateCol", "State")}</th>
                    <th className={th}>RTT</th>
                    <th className={th}>{td("endpoints", "Endpoints")}</th>
                    <th className={th}>{td("writers", "ME writers")}</th>
                    <th className={th}>{td("coverage", "Coverage")}</th>
                    <th className={th}>{td("load", "Sessions")}</th>
                    <th className={th}>{td("ipPref", "IP family")}</th>
                    <th className={th}>{td("source.label", "Source")}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((fr) => {
                    const r = fr.row;
                    const open = ctx.selected === fr.key;
                    const since = ctx.tracker[fr.key]?.since;
                    const flashing = ctx.flash.has(fr.key);
                    return (
                      <Fragment key={fr.key}>
                        <tr className={`border-t border-[var(--border)]/40 hover:bg-[var(--bg-elevated)]/60 ${open && !inlineDetail ? "bg-[var(--bg-elevated)]/70" : ""} ${flashing ? flashCls : ""}`}>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              onClick={() => ctx.onSelect(open ? null : fr.key)}
                              aria-expanded={open}
                              className="rounded text-left font-medium text-[var(--fg)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                              title={dcKindText(td, r.dc).tip}
                            >
                              {g.inst ? dcLabel(r.dc) : fr.inst.remark}
                              {g.inst ? <span className="ml-1.5 text-[10px] font-normal text-[var(--fg-subtle)]">{dcKindText(td, r.dc).label}</span> : null}
                            </button>
                          </td>
                          <td className="px-2 py-1">
                            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${stateBox[r.state]}`}>
                              <StateIcon state={r.state} className="h-3 w-3" />
                              {stateText(td, r.state)}
                            </span>
                            {since ? <span className="ml-1.5 text-[10px] text-[var(--fg-subtle)]">{formatAge((ctx.now - since) / 1000)}</span> : null}
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-2">
                              <span className="w-14 font-mono">{typeof r.rttMs === "number" ? `${Math.round(r.rttMs)} ms` : "-"}</span>
                              <Sparkline values={rttSeries(ctx.history[fr.key])} state={r.state} width={72} height={16} />
                            </div>
                          </td>
                          <td className="px-2 py-1 font-mono">{r.endpoints > 0 ? `${r.availableEndpoints}/${r.endpoints}` : "-"}</td>
                          <td className="min-w-[96px] px-2 py-1.5">
                            {r.requiredWriters > 0 ? (
                              <div>
                                <span className="font-mono">
                                  {r.aliveWriters}/{r.requiredWriters}
                                </span>
                                <Bar value={r.aliveWriters} max={r.requiredWriters} state={r.state} label={td("writers", "ME writers")} />
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-2 py-1 font-mono">{r.requiredWriters > 0 ? `${Math.round(r.coveragePct)}%` : "-"}</td>
                          <td className="px-2 py-1 font-mono">{r.load}</td>
                          <td className="px-2 py-1">{r.ipPreference && r.ipPreference !== "unknown" ? ipText(td, r.ipPreference) : "-"}</td>
                          <td className="px-2 py-1">{r.source === "me" ? "ME" : r.source === "upstream" ? td("source.upstreamShort", "upstream") : "-"}</td>
                        </tr>
                        {open && inlineDetail ? (
                          <tr>
                            <td colSpan={9} className="px-2 pb-2">
                              <DcDetail row={r} inst={fr.inst} samples={ctx.history[fr.key]} since={since} now={ctx.now} td={td} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {g.inst ? (
            <div className="px-3 pb-2">
              <InstanceDetails inst={g.inst} now={ctx.now} td={td} />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

