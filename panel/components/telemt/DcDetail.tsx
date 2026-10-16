"use client";

import type { ReactNode } from "react";
import { dcKind, dcLabel, formatAge, rttSeries, rttStats, type DCRow, type Instance, type Sample } from "@/lib/telemtDc";
import { Sparkline } from "./Sparkline";
import { StateBadge, stateBar } from "./StateBadge";
import type { Td } from "./useTd";

export function stateText(td: Td, s: DCRow["state"]): string {
  switch (s) {
    case "up":
      return td("state.up", "available");
    case "degraded":
      return td("state.degraded", "degraded");
    case "down":
      return td("state.down", "unavailable");
    default:
      return td("state.unknown", "unknown");
  }
}

export function dcKindText(td: Td, dc: number): { label: string; tip: string } {
  switch (dcKind(dc)) {
    case "media":
      return { label: td("kind.media", "media DC"), tip: td("kind.mediaTip", "Negative ids are Telegram media datacenters (photos, videos, files). They are separate from the main DC with the same number.") };
    case "cdn":
      return { label: td("kind.cdn", "CDN DC"), tip: td("kind.cdnTip", "DC 203 is the Telegram CDN / non-standard cluster used for some downloads.") };
    case "standard":
      return { label: td("kind.standard", "standard DC"), tip: td("kind.standardTip", "Main Telegram datacenters 1-5 that carry messages and API calls.") };
    default:
      return { label: td("kind.misc", "other DC"), tip: td("kind.miscTip", "A non-standard datacenter id reported by Telemt.") };
  }
}

export function Bar({ value, max, state, label }: { value: number; max: number; state: DCRow["state"]; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
      <div className={`h-full rounded-full transition-[width] motion-reduce:transition-none ${stateBar[state]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Field({ label, tip, children, wide }: { label: string; tip?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`} title={tip}>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--fg-subtle)]">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-xs text-[var(--fg)]">{children}</dd>
    </div>
  );
}

const ms = (v?: number) => (typeof v === "number" ? `${Math.round(v)} ms` : "-");

/** Full detail of one DC row on one instance. */
export function DcDetail({ row, inst, samples, since, now, td }: { row: DCRow; inst: Instance; samples?: Sample[]; since?: number; now: number; td: Td }) {
  const kind = dcKindText(td, row.dc);
  const series = rttSeries(samples);
  const stats = rttStats(series);
  const src = row.source === "me" ? td("source.me", "Middle-End") : row.source === "upstream" ? td("source.upstream", "Upstream") : "-";
  const srcTip =
    row.source === "me"
      ? td("source.meTip", "State comes from Telemt's Middle-End pool: endpoints and writers connected to Telegram's proxy servers.")
      : td("source.upstreamTip", "State comes from direct upstream connect probes (no Middle-End data for this DC).");
  const ip = row.ipPreference && row.ipPreference !== "unknown" ? row.ipPreference : "";
  return (
    <div className="rounded-lg border border-[var(--border)]/80 bg-[var(--bg)]/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--fg)]">{dcLabel(row.dc)}</span>
        <StateBadge state={row.state} label={stateText(td, row.state)} />
        <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-subtle)]" title={kind.tip}>
          {kind.label}
        </span>
        {since ? (
          <span className="text-[11px] text-[var(--fg-subtle)]" title={td("sinceTip", "Time in the current state, measured by this browser's polls")}>
            {td("since", "for {{age}}", { age: formatAge((now - since) / 1000) })}
          </span>
        ) : null}
        <span className="ml-auto truncate text-[11px] text-[var(--fg-subtle)]">{inst.remark}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 @md:grid-cols-3">
        <Field label={td("rtt", "RTT")} tip={td("rttTip", "Round-trip time from this server to the DC (Middle-End RTT, else best upstream connect latency).")} wide>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-sm">{ms(row.rttMs)}</span>
            <Sparkline values={series} state={row.state} title={td("rttHistory", "RTT over the last polls")} />
            {stats ? (
              <span className="font-mono text-[10px] text-[var(--fg-subtle)]">
                min {Math.round(stats.min)} · avg {Math.round(stats.avg)} · max {Math.round(stats.max)}
              </span>
            ) : null}
          </div>
        </Field>
        <Field label={td("endpoints", "Endpoints")} tip={td("endpointsTip", "Middle-End endpoints of this DC that are currently reachable / total.")}>
          {row.endpoints > 0 ? (
            <>
              <span className="font-mono">
                {row.availableEndpoints}/{row.endpoints}
              </span>
              <Bar value={row.availableEndpoints} max={row.endpoints} state={row.state} label={td("endpoints", "Endpoints")} />
            </>
          ) : (
            "-"
          )}
        </Field>
        <Field label={td("writers", "ME writers")} tip={td("writersTip", "Middle-End writer connections alive / required. Fewer than required means reduced capacity (degraded); none means the DC is down.")}>
          {row.requiredWriters > 0 ? (
            <>
              <span className="font-mono">
                {row.aliveWriters}/{row.requiredWriters}
              </span>
              <Bar value={row.aliveWriters} max={row.requiredWriters} state={row.state} label={td("writers", "ME writers")} />
            </>
          ) : (
            "-"
          )}
        </Field>
        <Field label={td("coverage", "Coverage")} tip={td("coverageTip", "alive writers / required writers.")}>
          <span className="font-mono">{row.requiredWriters > 0 ? `${Math.round(row.coveragePct)}%` : "-"}</span>
        </Field>
        <Field label={td("load", "Sessions")} tip={td("loadTip", "Client sessions currently bound to this DC.")}>
          <span className="font-mono">{row.load}</span>
        </Field>
        <Field label={td("ipPref", "IP family")} tip={td("ipPrefTip", "Which IP family reaches this DC: prefer_v4, prefer_v6, both_work or unavailable.")}>
          <span className="font-mono">{ip ? ipText(td, ip) : "-"}</span>
        </Field>
        <Field label={td("source.label", "Source")} tip={srcTip}>
          {src}
        </Field>
        {row.availablePct != null && row.endpoints > 0 ? (
          <Field label={td("availablePct", "Endpoints available")} tip={td("availablePctTip", "available endpoints / total endpoints (state turns degraded below 50%).")}>
            <span className="font-mono">{Math.round(row.availablePct)}%</span>
          </Field>
        ) : null}
        {row.floorTarget != null ? (
          <Field label={td("floor", "Writer floor")} tip={td("floorTip", "Telemt's writer floor policy for this DC: min / target / max. 'capped' means the target was limited by active limits.")}>
            <span className="font-mono">
              {row.floorMin ?? "-"} / {row.floorTarget} / {row.floorMax ?? "-"}
            </span>
            {row.floorCapped ? <span className="ml-1 text-amber-400">({td("capped", "capped")})</span> : null}
          </Field>
        ) : null}
        {row.refillInflight ? (
          <Field label={td("refill", "Refilling")} tip={td("refillTip", "Endpoint connections being re-established right now.")}>
            <span className="font-mono">{row.refillInflight}</span>
          </Field>
        ) : null}
        {row.upstreamRttMs != null ? (
          <Field label={td("upstreamRtt", "Upstream RTT")} tip={td("upstreamRttTip", "Best per-DC upstream connect latency (EMA).")}>
            <span className="font-mono">{ms(row.upstreamRttMs)}</span>
          </Field>
        ) : null}
        {row.upstreamReachable != null || row.upstreamUnreachable != null ? (
          <Field label={td("upstreamReach", "Upstreams reaching")} tip={td("upstreamReachTip", "Healthy upstreams that can / cannot reach this DC.")}>
            <span className="font-mono">
              {row.upstreamReachable ?? 0} ok · {row.upstreamUnreachable ?? 0} {td("unreachableShort", "no route")}
            </span>
          </Field>
        ) : null}
        {row.slowConnectFails ? (
          <Field label={td("slowFails", "Slow failed connects")} tip={td("slowFailsTip", "Failed upstream connects that took longer than 1 second.")}>
            <span className="font-mono">{row.slowConnectFails}</span>
          </Field>
        ) : null}
      </dl>
      {row.endpointList && row.endpointList.length > 0 ? (
        <details className="mt-2.5 text-xs">
          <summary className="cursor-pointer select-none text-[var(--fg-subtle)] hover:text-[var(--fg)]">
            {td("endpointList", "Endpoint list ({{n}})", { n: row.endpointList.length })}
          </summary>
          <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-auto font-mono text-[11px]">
            {row.endpointList.map((e) => (
              <li key={e.endpoint} className="flex justify-between gap-3">
                <span className="truncate">{e.endpoint}</span>
                <span className={e.activeWriters > 0 ? "text-emerald-400" : "text-[var(--fg-subtle)]"}>
                  {e.activeWriters} {td("writersShort", "writers")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ipText(td: Td, ip: string): string {
  switch (ip) {
    case "prefer_v4":
      return "IPv4";
    case "prefer_v6":
      return "IPv6";
    case "both_work":
      return td("ip.both", "IPv4 + IPv6");
    case "unavailable":
      return td("ip.unavailable", "unreachable");
    default:
      return ip;
  }
}
