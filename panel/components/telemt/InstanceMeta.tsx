"use client";

import { AlertCircle, ExternalLink } from "lucide-react";
import { formatAge, reasonInfo, type Instance, type Source } from "@/lib/telemtDc";
import { linkP } from "@/lib/paths";
import type { Td } from "./useTd";

export function reasonText(td: Td, reason: string | undefined) {
  const r = reasonInfo(reason);
  const title = {
    api_disabled: td("reason.api_disabled", "Control API is disabled for this inbound."),
    feature_disabled: td("reason.feature_disabled", "Minimal runtime stats are disabled (server.api.minimal_runtime_enabled)."),
    source_unavailable: td("reason.source_unavailable", "Telemt has no DC snapshot yet (Middle-End pool is still starting)."),
    unreachable: td("reason.unreachable", "Telemt API unreachable."),
    other: td("reason.generic", "Telemt reported: {{reason}}", { reason }),
  }[r.code as "api_disabled"];
  const hint = {
    api_disabled: td("hint.api_disabled", "Enable the control API in the Telemt parameters of this inbound (server.api.enabled) and restart it."),
    feature_disabled: td("hint.feature_disabled", "Set server.api.minimal_runtime_enabled = true in the Telemt parameters to get ME/DC statistics."),
    source_unavailable: td("hint.source_unavailable", "Wait a minute after (re)start; if it persists check the Telemt log of this inbound."),
    unreachable: td("hint.unreachable", "Check that the API listen address is enabled in the Telemt parameters, the inbound is running and its log has no errors."),
    other: td("hint.generic", "Check the Telemt log of this inbound."),
  }[r.code as "api_disabled"];
  return { code: r.code, level: r.level, title, hint };
}

/** Error / reason chip with a human readable explanation and the next step. */
export function UnavailableNotice({ inst, td }: { inst: Instance; td: Td }) {
  const r = reasonText(td, inst.reason);
  const tone = r.level === "error" ? "border-red-500/30 bg-red-500/5 text-red-400" : r.level === "warn" ? "border-amber-500/30 bg-amber-500/5 text-amber-400" : "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-subtle)]";
  return (
    <div className={`flex gap-2 rounded-lg border p-2.5 text-xs ${tone}`} role="status">
      <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">
          <span className="mr-1.5 rounded border border-current/40 px-1 py-px font-mono text-[10px]">{inst.reason || "unreachable"}</span>
          {r.title}
        </p>
        <p className="mt-0.5 text-[var(--fg-subtle)]">{r.hint}</p>
        {inst.detail ? <p className="mt-0.5 break-all font-mono text-[10px] text-[var(--fg-subtle)]">{inst.detail}</p> : null}
      </div>
    </div>
  );
}

/** Title line of an instance: remark, tag, port, ME badge, upstream health, open-inbound link. */
export function InstanceHeader({ inst, source, td, showSource }: { inst: Instance; source?: Source; td: Td; showSource?: boolean }) {
  const up = inst.upstreams;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="truncate text-sm font-medium text-[var(--fg)]" title={inst.remark}>
        {inst.remark}
      </span>
      <span className="font-mono text-[11px] text-[var(--fg-subtle)]" title={td("tagTip", "Inbound tag")}>
        {inst.tag}
      </span>
      <span className="font-mono text-[11px] text-[var(--fg-subtle)]">:{inst.port || "-"}</span>
      {showSource && source ? (
        <span className="rounded border border-[var(--border)] px-1.5 py-px text-[10px] text-[var(--fg-subtle)]">{source.kind === "panel" ? td("panel", "panel") : source.name}</span>
      ) : null}
      <span
        className={`rounded border px-1.5 py-px text-[10px] ${inst.meEnabled ? "border-emerald-500/30 text-emerald-400" : "border-[var(--border)] text-[var(--fg-subtle)]"}`}
        title={inst.meEnabled ? td("meOnTip", "Middle-End proxy is enabled: traffic goes through Telegram's ME servers.") : td("meOffTip", "Middle-End is off: Telemt connects to Telegram DCs directly.")}
      >
        {inst.meEnabled ? "Middle-End" : td("direct", "Direct")}
      </span>
      {up ? (
        <span
          className={`rounded border px-1.5 py-px text-[10px] ${up.unhealthy > 0 ? "border-amber-500/40 text-amber-400" : "border-[var(--border)] text-[var(--fg-subtle)]"}`}
          title={td("upstreamsTip", "Upstream routes: healthy / configured")}
        >
          {td("upstreams", "upstreams")} {up.healthy}/{up.configured}
          {up.unhealthy > 0 ? ` (${up.unhealthy} ${td("unhealthy", "unhealthy")})` : ""}
        </span>
      ) : null}
      {inst.inboundId ? (
        <a
          href={linkP("panel/inbounds")}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--fg-subtle)] hover:text-[var(--fg)]"
          title={td("openInbound", "Open inbounds (inbound #{{id}})", { id: inst.inboundId })}
        >
          <ExternalLink aria-hidden className="h-3 w-3" />
          <span className="sr-only">{td("openInbound", "Open inbounds (inbound #{{id}})", { id: inst.inboundId })}</span>
        </a>
      ) : null}
    </div>
  );
}

const num = (n?: number) => (typeof n === "number" ? n.toLocaleString() : "-");

/** Collapsible deep detail: ME pool, quality counters, upstream routes. Only shows what Telemt reported. */
export function InstanceDetails({ inst, now, td }: { inst: Instance; now: number; td: Td }) {
  const w = inst.writers;
  const p = inst.pool;
  const q = inst.meQuality;
  const u = inst.upstreams;
  if (!w && !p && !q && !(u && (u.items?.length || u.connectAttempts))) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none text-[var(--fg-subtle)] hover:text-[var(--fg)]">{td("moreDetails", "Pool, quality and upstream details")}</summary>
      <div className="mt-2 space-y-3">
        {w ? (
          <p className="font-mono text-[11px] text-[var(--fg-subtle)]" title={td("poolTip", "Middle-End writer pool of this Telemt instance")}>
            {td("pool.writers", "ME writers")}: {w.aliveNonDraining}/{w.total} {td("pool.alive", "alive")} · {w.healthy} {td("pool.healthy", "healthy")} · {w.degraded} {td("pool.degraded", "degraded")} · {w.draining} {td("pool.draining", "draining")} · {w.active} {td("pool.active", "active")}/{w.warm} {td("pool.warm", "warm")}
            {p ? ` · gen ${p.activeGeneration}${p.hardswapPending ? ` (${td("pool.hardswap", "hardswap pending")})` : ""}${p.refillInflight ? ` · ${td("refill", "refilling")} ${p.refillInflight}` : ""}` : ""}
          </p>
        ) : null}
        {q ? (
          <p className="font-mono text-[11px] text-[var(--fg-subtle)]" title={td("qualityTip", "Counters since Telemt start")}>
            {td("quality.reconnects", "ME reconnects")} {num(q.reconnectSuccess)}/{num(q.reconnectAttempts)} · {td("quality.drops", "route drops")}: {td("quality.queueFull", "queue full")} {num(q.dropQueueFull)}, {td("quality.noConn", "no conn")} {num(q.dropNoConn)}, {td("quality.closed", "closed")} {num(q.dropChannelClosed)} · KDF drift {num(q.kdfDrift)} · EOF {num(q.readerEof)}
          </p>
        ) : null}
        {u && u.connectAttempts ? (
          <p className="font-mono text-[11px] text-[var(--fg-subtle)]">
            {td("upstreamConnects", "Upstream connects")}: {num(u.connectSuccess)}/{num(u.connectAttempts)} ok · {num(u.connectFail)} {td("failed", "failed")}
          </p>
        ) : null}
        {u?.items && u.items.length > 0 ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[420px] text-left text-[11px]">
              <thead className="text-[10px] uppercase text-[var(--fg-subtle)]">
                <tr>
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="pr-2 font-medium">{td("route", "Route")}</th>
                  <th className="pr-2 font-medium">{td("address", "Address")}</th>
                  <th className="pr-2 font-medium">{td("health", "Health")}</th>
                  <th className="pr-2 font-medium">{td("latency", "Latency")}</th>
                  <th className="font-medium">{td("checked", "Checked")}</th>
                </tr>
              </thead>
              <tbody>
                {u.items.map((it) => (
                  <tr key={it.id} className="border-t border-[var(--border)]/50">
                    <td className="py-1 pr-2 font-mono">{it.id}</td>
                    <td className="pr-2">{it.routeKind}</td>
                    <td className="max-w-[160px] truncate pr-2 font-mono">{it.address || "-"}</td>
                    <td className={`pr-2 ${it.healthy ? "text-emerald-400" : "text-red-400"}`}>
                      {it.healthy ? td("healthy", "healthy") : `${td("unhealthy", "unhealthy")} (${it.fails})`}
                    </td>
                    <td className="pr-2 font-mono">{typeof it.latencyMs === "number" ? `${Math.round(it.latencyMs)} ms` : "-"}</td>
                    <td className="font-mono">{td("ago", "{{age}} ago", { age: formatAge(it.lastCheckAgeSecs) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {inst.snapshotAt ? (
          <p className="text-[10px] text-[var(--fg-subtle)]">{td("snapshotAge", "Telemt snapshot is {{age}} old", { age: formatAge(now / 1000 - inst.snapshotAt) })}</p>
        ) : null}
      </div>
    </details>
  );
}
