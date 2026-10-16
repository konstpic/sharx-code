"use client";

import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpRight,
  Clock,
  Cpu,
  Database,
  Download,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  History,
  Layers,
  MemoryStick,
  Power,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Users,
  Wrench,
  CloudDownload,
  CloudUpload,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LiveDot, MiniMeter, RingGauge, Sparkline, loadColor } from "@/components/dashboard/viz";
import { formatSecond, sizeFormat } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";

/* ---------- shared bits ---------- */

/** Page-local rolling history of a live value (the status endpoint has no history for these). */
function useHistory(value: number, max = 48) {
  const [h, setH] = useState<number[]>([]);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(value) || last.current === value) return;
    last.current = value;
    setH((p) => [...p.slice(-(max - 1)), value]);
  }, [value, max]);
  return h;
}

function Count({ value, size }: { value: number; size?: boolean }) {
  const v = useCountUp(value, { duration: 700, decimals: 0 });
  return <>{size ? sizeFormat(v) : Math.round(v).toLocaleString()}</>;
}

/** Icon bubble used in every widget header. */
export function WidgetIcon({ icon, color = "var(--accent)", size = 36 }: { icon: ReactNode; color?: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl"
      style={{ width: size, height: size, color, background: `color-mix(in oklab, ${color} 15%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)` }}
    >
      {icon}
    </span>
  );
}

function Head({ icon, color, title, sub, right }: { icon: ReactNode; color?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <WidgetIcon icon={icon} color={color} />
      <div className="min-w-0 flex-1 leading-tight">
        <h3 className="truncate text-sm font-semibold text-[var(--fg)]">{title}</h3>
        {sub ? <p className="dash-secondary mt-0.5 line-clamp-2 text-[11px] text-[var(--fg-subtle)]">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

function Cell({ icon, label, value, color = "var(--accent)", hint }: { icon: ReactNode; label: ReactNode; value: ReactNode; color?: string; hint?: ReactNode }) {
  return (
    <div className="dash-card min-w-0 rounded-2xl border border-[var(--border)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
        <span style={{ color }}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-2 break-words font-mono text-xl font-semibold leading-none tracking-tight tabular-nums text-[var(--fg)]">{value}</p>
      {hint ? <p className="dash-secondary mt-1.5 text-[10px] text-[var(--fg-subtle)]">{hint}</p> : null}
    </div>
  );
}

const pillBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--accent)_40%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-4 py-2 text-xs font-semibold text-[var(--fg)] transition hover:bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] disabled:opacity-50";

/* ---------- logs / core versions / backup (three separate tiles) ---------- */

export function LogsWidget({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col justify-between gap-4 p-5">
      <Head
        icon={<History size={18} />}
        color="#38bdf8"
        title={t("pages.index.logs")}
        sub={t("pages.index.logsCardSubtitle", { defaultValue: "Panel actions and events (nodes and balancers have their own logs)" })}
      />
      <button type="button" onClick={onOpen} className={pillBtn}>
        {t("pages.index.logsOpen", { defaultValue: "Open the journal" })}
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
}

type CoreInfo = { version?: string; mismatch?: boolean } | undefined | null;

export function CoreVersionsWidget({
  xray,
  telemt,
  xrayRunning,
  telemtRunning,
  canOperate,
  local,
  onStopTelemt,
  onStopXray,
  onRestartXray,
  onSwitch,
}: {
  xray: CoreInfo;
  telemt: CoreInfo;
  xrayRunning?: boolean;
  telemtRunning?: boolean;
  canOperate: boolean;
  /** Standalone panel: the cores run here and can be stopped/restarted. */
  local: boolean;
  onStopTelemt: () => void;
  onStopXray: () => void;
  onRestartXray: () => void;
  onSwitch: () => void;
}) {
  const { t } = useTranslation();
  const row = (name: string, info: CoreInfo, running: boolean | undefined, color: string) => (
    <div className="dash-card flex items-center gap-3 rounded-2xl border border-[var(--border)] px-3.5 py-2.5">
      <span className="relative flex size-2.5 shrink-0">
        {running ? <span className="dash-ping absolute inline-flex size-full rounded-full opacity-60" style={{ background: "#22c55e" }} /> : null}
        <span className="relative inline-flex size-2.5 rounded-full" style={{ background: running === undefined ? "var(--fg-subtle)" : running ? "#22c55e" : "#ef4444" }} />
      </span>
      <span className="text-sm font-medium text-[var(--fg)]">{name}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {info?.mismatch ? (
          <span
            className="rounded-full bg-[color-mix(in_oklab,#f59e0b_18%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[#f59e0b]"
            title={t("pages.index.coreVersionMismatch", { defaultValue: "Nodes are not all on the same version — check Nodes" })}
          >
            ≠
          </span>
        ) : null}
        <span className="rounded-lg px-2 py-1 font-mono text-xs font-semibold" style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}>
          {info?.version || "—"}
        </span>
      </span>
    </div>
  );
  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <Head icon={<Wrench size={18} />} color="var(--accent)" title={t("pages.index.coreVersionSwitch")} />
      <div className="space-y-2">
        {row("Xray", xray, xrayRunning, "var(--accent)")}
        {row(t("pages.index.telemtShort"), telemt, telemtRunning, "#a78bfa")}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {canOperate ? (
          <button type="button" onClick={onSwitch} className={`${pillBtn} flex-1`}>
            {t("pages.index.coreVersionSwitch")}
          </button>
        ) : null}
        {local && canOperate ? (
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t("pages.index.stopTelemt")} title={t("pages.index.stopTelemt")} disabled={!telemtRunning} onClick={onStopTelemt} className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[var(--fg)] disabled:opacity-40">
              <Power size={14} />
            </button>
            <button type="button" aria-label={t("pages.index.stopXray")} title={t("pages.index.stopXray")} onClick={onStopXray} className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[#ef4444]">
              <Power size={14} />
            </button>
            <button type="button" aria-label={t("pages.index.restartXray")} title={t("pages.index.restartXray")} onClick={onRestartXray} className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[var(--fg)]">
              <RefreshCw size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function BackupWidget({ onExport, onImport, onConfig }: { onExport: () => void; onImport: () => void; onConfig: () => void }) {
  const { t } = useTranslation();
  const big = (icon: ReactNode, label: string, onClick: () => void, color: string) => (
    <button
      type="button"
      onClick={onClick}
      className="dash-card group flex flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--border)] px-3 py-4 text-center transition hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]"
    >
      <span className="grid size-10 place-items-center rounded-xl transition group-hover:scale-110" style={{ color, background: `color-mix(in oklab, ${color} 15%, transparent)` }}>
        {icon}
      </span>
      <span className="text-xs font-medium text-[var(--fg)]">{label}</span>
    </button>
  );
  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <Head icon={<Server size={18} />} color="#22c55e" title={t("pages.index.backup")} sub={t("pages.index.backupCardSubtitle", { defaultValue: "Download or restore the database" })} />
      <div className="grid grid-cols-2 gap-2.5">
        {big(<Download size={18} />, t("pages.index.exportDatabase"), onExport, "#22c55e")}
        {big(<CloudUpload size={18} />, t("pages.index.importDatabase"), onImport, "#f59e0b")}
      </div>
      <button type="button" onClick={onConfig} className="mt-auto inline-flex items-center gap-1.5 self-end text-[11px] text-[var(--fg-subtle)] transition hover:text-[var(--fg)]">
        <SlidersHorizontal size={12} />
        {t("pages.index.config")}
      </button>
    </div>
  );
}

/* ---------- uptime / users / runtime / database ---------- */

export function UptimeWidget({ panel, os, xray, nodes }: { panel: number; os: number; xray?: number; nodes?: { running: number; total: number } }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <Head icon={<Clock size={18} />} color="#f59e0b" title={t("pages.index.operationHours")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Cell icon={<Layers size={11} />} label={t("pages.index.panelUptimeLabel")} value={formatSecond(panel)} color="#38bdf8" />
        <Cell icon={<Server size={11} />} label={t("pages.index.osLabel")} value={formatSecond(os)} color="#a78bfa" />
        {xray !== undefined ? <Cell icon={<Cpu size={11} />} label={t("pages.index.xrayUptimeLabel")} value={formatSecond(xray)} color="#22c55e" /> : null}
        {nodes && nodes.total > 0 ? (
          <Cell icon={<Cpu size={11} />} label={t("pages.index.nodesCoresRunning", { defaultValue: "Node cores" })} value={`${nodes.running} / ${nodes.total}`} color={nodes.running === nodes.total ? "#22c55e" : "#f59e0b"} />
        ) : null}
      </div>
    </div>
  );
}

export function UsersOnlineWidget({ value, href }: { value: number; href: string }) {
  const { t } = useTranslation();
  const hist = useHistory(value, 40);
  return (
    <div className="relative flex h-full flex-col overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <Head icon={<Users size={18} />} color="#22c55e" title={t("pages.index.usersOnline")} />
        <LiveDot label={t("pages.builder.live", { defaultValue: "live" })} />
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <p className="bg-clip-text font-mono text-6xl font-semibold leading-none tracking-tight tabular-nums text-transparent" style={{ backgroundImage: "linear-gradient(180deg, #4ade80, color-mix(in oklab, #22c55e 40%, var(--fg)))" }}>
          <Count value={value} />
        </p>
        <Link href={href} className="mb-1 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
          {t("menu.clients")}
          <ArrowUpRight size={13} />
        </Link>
      </div>
      <p className="mt-2 text-[11px] text-[var(--fg-subtle)]">{t("pages.index.usersOnlineHint")}</p>
      {hist.length > 1 ? <Sparkline points={hist} color="#22c55e" height={44} className="mt-3" minSpan={4} /> : null}
    </div>
  );
}

export function RuntimeWidget({ cores, freq, threads, heap }: { cores: string; freq: string; threads: string; heap: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <Head icon={<Cpu size={18} />} color="#38bdf8" title={t("pages.index.panelProcessTitle")} sub={t("pages.index.panelProcessDesc")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Cell icon={<Cpu size={11} />} label={t("pages.index.logicalProcessors")} value={cores} color="#38bdf8" />
        <Cell icon={<Gauge size={11} />} label={t("pages.index.frequency")} value={freq} color="#f59e0b" />
        <Cell icon={<Layers size={11} />} label={t("pages.index.threads")} value={threads} color="#a78bfa" />
        <Cell icon={<MemoryStick size={11} />} label={t("pages.index.panelProcessHeap")} value={sizeFormat(heap)} color="#22c55e" />
      </div>
    </div>
  );
}

export function DatabaseWidget({ db }: { db?: { size: number; tables: number; totalRows: number; openConns: number; maxOpenConns: number; idleConns: number } }) {
  const { t } = useTranslation();
  const open = db?.openConns ?? 0;
  const max = db?.maxOpenConns ?? 0;
  const pct = max > 0 ? (open / max) * 100 : 0;
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <Head icon={<Database size={18} />} color="#a78bfa" title={t("pages.index.database")} />
      <div className="grid items-center gap-4 sm:grid-cols-[auto,1fr]">
        <div className="mx-auto">
          <RingGauge
            value={pct}
            size={112}
            stroke={10}
            color={loadColor(pct, "#a78bfa")}
            center={
              <span className="font-mono text-xl font-semibold tabular-nums text-[var(--fg)]">
                {open}
                <span className="text-xs text-[var(--fg-subtle)]"> / {max}</span>
              </span>
            }
            caption={t("pages.index.dbConnections")}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Cell icon={<Database size={11} />} label={t("pages.index.dbSize")} value={sizeFormat(db?.size ?? 0)} color="#a78bfa" />
          <Cell icon={<Layers size={11} />} label={t("pages.index.dbTables")} value={String(db?.tables ?? 0)} color="#38bdf8" />
          <Cell icon={<Server size={11} />} label={t("pages.index.dbRows")} value={(db?.totalRows ?? 0).toLocaleString()} color="#22c55e" />
        </div>
      </div>
    </div>
  );
}

/* ---------- network (four independent tiles) ---------- */

function RateCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: number; color: string }) {
  const hist = useHistory(value, 48);
  const peak = Math.max(0, ...hist);
  return (
    <div className="dash-card relative min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] p-3.5">
      <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full opacity-60 blur-2xl" style={{ background: `radial-gradient(circle, color-mix(in oklab, ${color} 45%, transparent), transparent 70%)` }} aria-hidden />
      <div className="relative flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
          <span style={{ color }}>{icon}</span>
          {label}
        </span>
        <span className="font-mono text-[10px] text-[var(--fg-subtle)]">↑ {sizeFormat(peak)}/s</span>
      </div>
      <p className="relative mt-2 font-mono text-[26px] font-semibold leading-none tracking-tight tabular-nums text-[var(--fg)]">
        <Count value={value} size />
        <span className="ml-0.5 text-xs font-medium text-[var(--fg-subtle)]">/s</span>
      </p>
      <div className="relative mt-3">
        <Sparkline points={hist} color={color} height={44} minSpan={Math.max(1, peak * 0.2)} />
      </div>
    </div>
  );
}

export function NetSpeedWidget({ up, down }: { up: number; down: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <Head icon={<ArrowLeftRight size={18} />} color="#38bdf8" title={t("pages.index.netCurrentRates")} right={<LiveDot label={t("pages.builder.live", { defaultValue: "live" })} />} />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <RateCard icon={<ArrowUp size={12} />} label={t("pages.index.upload")} value={up} color="#22c55e" />
        <RateCard icon={<ArrowDown size={12} />} label={t("pages.index.download")} value={down} color="#38bdf8" />
      </div>
    </div>
  );
}

export function NetTrafficWidget({ sent, recv }: { sent: number; recv: number }) {
  const { t } = useTranslation();
  const total = Math.max(1, sent + recv);
  const sentPct = (sent / total) * 100;
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <Head icon={<CloudDownload size={18} />} color="#a78bfa" title={t("pages.index.netCumulativeTraffic")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Cell icon={<CloudUpload size={11} />} label={t("pages.index.sent")} value={<Count value={sent} size />} color="#f59e0b" hint={`${sentPct.toFixed(0)}%`} />
        <Cell icon={<CloudDownload size={11} />} label={t("pages.index.received")} value={<Count value={recv} size />} color="#a78bfa" hint={`${(100 - sentPct).toFixed(0)}%`} />
      </div>
      <div className="mt-auto flex h-2.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_9%,transparent)]" role="img" aria-label={`${sentPct.toFixed(0)}% / ${(100 - sentPct).toFixed(0)}%`}>
        <div className="h-full transition-[width] duration-700" style={{ width: `${sentPct}%`, background: "linear-gradient(90deg,#f59e0b,#fb923c)", boxShadow: "0 0 12px -2px #f59e0b" }} />
        <div className="h-full flex-1" style={{ background: "linear-gradient(90deg,#8b5cf6,#c084fc)" }} />
      </div>
    </div>
  );
}

export function NetSocketsWidget({ tcp, udp }: { tcp: number; udp: number }) {
  const { t } = useTranslation();
  const total = Math.max(1, tcp + udp);
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <Head icon={<ArrowLeftRight size={18} />} color="#14b8a6" title={t("pages.index.netSocketsTitle")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Cell icon={<ArrowLeftRight size={11} />} label={t("pages.index.statTCP")} value={<Count value={tcp} />} color="#14b8a6" hint={`${((tcp / total) * 100).toFixed(0)}%`} />
        <Cell icon={<ArrowLeftRight size={11} />} label={t("pages.index.statUDP")} value={<Count value={udp} />} color="#f472b6" hint={`${((udp / total) * 100).toFixed(0)}%`} />
      </div>
      <div className="mt-auto space-y-2">
        <MiniMeter label="TCP" value={tcp} max={total} text={String(tcp)} color="#14b8a6" />
        <MiniMeter label="UDP" value={udp} max={total} text={String(udp)} color="#f472b6" />
      </div>
    </div>
  );
}

export function ServerIpWidget({ ipv4, ipv6, showV6, revealed, onToggle }: { ipv4?: string; ipv6?: string; showV6: boolean; revealed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const row = (label: string, v?: string) => (
    <div className="dash-card flex items-center gap-3 rounded-2xl border border-[var(--border)] px-3.5 py-2.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">{label}</span>
      <span className="ml-auto truncate font-mono text-sm text-[var(--fg)]">{revealed ? v || "—" : "••••••••"}</span>
    </div>
  );
  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <Head
        icon={<Globe size={18} />}
        color="#38bdf8"
        title={t("pages.index.ipAddresses")}
        right={
          <button type="button" onClick={onToggle} aria-label={t("pages.index.toggleIpVisibility")} title={t("pages.index.toggleIpVisibility")} className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[var(--fg)]">
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        }
      />
      <div className="space-y-2">
        {row(t("pages.index.statIPv4"), ipv4)}
        {showV6 ? row(t("pages.index.statIPv6"), ipv6) : null}
      </div>
    </div>
  );
}

/* ---------- user-agent share ---------- */

export function UserAgentWidget({ parts }: { parts: { label: string; color: string; percentLabel: string; percentRaw: number; count: number }[] }) {
  const { t } = useTranslation();
  const total = parts.reduce((a, p) => a + p.count, 0);
  const r = 46;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <Head
        icon={<Users size={18} />}
        color="#3b82f6"
        title={t("pages.clients.hwidUserAgentShareTitle", { defaultValue: "User-Agent distribution by HWID" })}
        sub={t("pages.index.hwidUserAgentDashboardHint", { defaultValue: "Overall share of registered devices across all clients." })}
      />
      {parts.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
      ) : (
        <div className="grid items-center gap-4 sm:grid-cols-[auto,1fr]">
          <div className="relative mx-auto size-40">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
              <circle cx="60" cy="60" r={r} fill="none" stroke="color-mix(in oklab, var(--fg) 8%, transparent)" strokeWidth="14" />
              {parts.map((p) => {
                const len = (p.percentRaw / 100) * c;
                const off = (acc / 100) * c;
                acc += p.percentRaw;
                return <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-off} strokeLinecap="butt" style={{ filter: `drop-shadow(0 0 4px ${p.color}66)` }} />;
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-2xl font-semibold tabular-nums text-[var(--fg)]">{total.toLocaleString()}</span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--fg-subtle)]">{t("pages.clients.hwidShort", { defaultValue: "devices" })}</span>
            </div>
          </div>
          <div className="max-h-48 space-y-2.5 overflow-auto pr-1">
            {parts.map((p) => (
              <div key={p.label} className="min-w-0">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}88` }} aria-hidden />
                    <span className="truncate font-mono text-[var(--fg-muted)]">{p.label}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-[var(--fg)]">{p.percentLabel}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_8%,transparent)]">
                  <div className="h-full rounded-full" style={{ width: `${p.percentRaw}%`, background: p.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

