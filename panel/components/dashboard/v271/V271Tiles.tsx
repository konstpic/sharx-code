"use client";
/**
 * v2.7.1 dashboard tiles (logs, core versions, backup, uptime, users online, panel process, database, user agents).
 * JSX and classes are copied from the v2.7.1 `WidgetTiles.tsx`; the props the page used to pass come from the AtomEnv.
 */
import { ArrowUpRight, Clock, Cpu, Database, Download, Gauge, History, Layers, MemoryStick, Power, RefreshCw, Server, SlidersHorizontal, Users, Wrench, CloudUpload } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { LiveDot, RingGauge, Sparkline, loadColor } from "@/components/dashboard/viz";
import { formatSecond, sizeFormat } from "@/lib/format";
import { linkP } from "@/lib/paths";
import { Cell, Count, Head, V271Root, pillBtn, useHistory } from "./parts";
import type { ReactNode } from "react";

export function V271Logs({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  return (
    <V271Root className="justify-between gap-4 p-5">
      <Head
        icon={<History size={18} />}
        color="#38bdf8"
        title={t("pages.index.logs")}
        sub={t("pages.index.logsCardSubtitle", { defaultValue: "Panel actions and events (nodes and balancers have their own logs)" })}
      />
      <button type="button" onClick={env.act.openLogs} className={pillBtn}>
        {t("pages.index.logsOpen", { defaultValue: "Open the journal" })}
        <ArrowUpRight size={14} />
      </button>
    </V271Root>
  );
}

type CoreInfo = { version?: string; mismatch?: boolean } | undefined | null;

export function V271CoreVersions({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st, multi } = env;
  const canOperate = env.can.xrayOperate;
  const local = !multi;
  const xrayRunning = multi ? undefined : st.xray?.state === "running";
  const telemtRunning = multi ? undefined : st.telemt?.state === "running";
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
    <V271Root className="gap-3 p-5">
      <Head icon={<Wrench size={18} />} color="var(--accent)" title={t("pages.index.coreVersionSwitch")} />
      <div className="space-y-2">
        {row("Xray", env.installedXray, xrayRunning, "var(--accent)")}
        {row(t("pages.index.telemtShort"), env.installedTelemt, telemtRunning, "#a78bfa")}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {canOperate ? (
          <button type="button" onClick={env.act.openVersions} className={`${pillBtn} flex-1`}>
            {t("pages.index.coreVersionSwitch")}
          </button>
        ) : null}
        {local && canOperate ? (
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t("pages.index.stopTelemt")} title={t("pages.index.stopTelemt")} disabled={!telemtRunning} onClick={env.act.stopTelemt} className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[var(--fg)] disabled:opacity-40">
              <Power size={14} />
            </button>
            <button type="button" aria-label={t("pages.index.stopXray")} title={t("pages.index.stopXray")} onClick={env.act.stopXray} className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[#ef4444]">
              <Power size={14} />
            </button>
            <button type="button" aria-label={t("pages.index.restartXray")} title={t("pages.index.restartXray")} onClick={env.act.restartXray} className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[var(--fg)]">
              <RefreshCw size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </V271Root>
  );
}

export function V271Backup({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { exportDb, importDb, openConfig } = env.act;
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
    <V271Root className="gap-3 p-5">
      <Head icon={<Server size={18} />} color="#22c55e" title={t("pages.index.backup")} sub={t("pages.index.backupCardSubtitle", { defaultValue: "Download or restore the database" })} />
      <div className="grid grid-cols-2 gap-2.5">
        {big(<Download size={18} />, t("pages.index.exportDatabase"), exportDb, "#22c55e")}
        {big(<CloudUpload size={18} />, t("pages.index.importDatabase"), importDb, "#f59e0b")}
      </div>
      <button type="button" onClick={openConfig} className="mt-auto inline-flex items-center gap-1.5 self-end text-[11px] text-[var(--fg-subtle)] transition hover:text-[var(--fg)]">
        <SlidersHorizontal size={12} />
        {t("pages.index.config")}
      </button>
    </V271Root>
  );
}

export function V271Uptime({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st, multi } = env;
  const nx = st.nodesXray;
  const nodes = multi && nx && nx.total > 0 ? { running: nx.running, total: nx.total } : undefined;
  const xray = multi ? undefined : st.appStats?.uptime || 0;
  return (
    <V271Root>
      <Head icon={<Clock size={18} />} color="#f59e0b" title={t("pages.index.operationHours")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Cell icon={<Layers size={11} />} label={t("pages.index.panelUptimeLabel")} value={formatSecond(st.panelUptime ?? 0)} color="#38bdf8" />
        <Cell icon={<Server size={11} />} label={t("pages.index.osLabel")} value={formatSecond(st.uptime)} color="#a78bfa" />
        {xray !== undefined ? <Cell icon={<Cpu size={11} />} label={t("pages.index.xrayUptimeLabel")} value={formatSecond(xray)} color="#22c55e" /> : null}
        {nodes && nodes.total > 0 ? (
          <Cell icon={<Cpu size={11} />} label={t("pages.index.nodesCoresRunning", { defaultValue: "Node cores" })} value={`${nodes.running} / ${nodes.total}`} color={nodes.running === nodes.total ? "#22c55e" : "#f59e0b"} />
        ) : null}
      </div>
    </V271Root>
  );
}

export function V271UsersOnline({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const value = env.st.usersOnline ?? 0;
  const hist = useHistory(value, 40);
  return (
    <V271Root className="relative gap-0 overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <Head icon={<Users size={18} />} color="#22c55e" title={t("pages.index.usersOnline")} />
        <LiveDot label={t("pages.builder.live", { defaultValue: "live" })} />
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <p className="bg-clip-text font-mono text-6xl font-semibold leading-none tracking-tight tabular-nums text-transparent" style={{ backgroundImage: "linear-gradient(180deg, #4ade80, color-mix(in oklab, #22c55e 40%, var(--fg)))" }}>
          <Count value={value} />
        </p>
        <Link href={linkP("panel/clients")} className="mb-1 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
          {t("menu.clients")}
          <ArrowUpRight size={13} />
        </Link>
      </div>
      <p className="mt-2 text-[11px] text-[var(--fg-subtle)]">{t("pages.index.usersOnlineHint")}</p>
      {hist.length > 1 ? <Sparkline points={hist} color="#22c55e" height={44} className="mt-3" minSpan={4} /> : null}
    </V271Root>
  );
}

export function V271PanelRuntime({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st, cpuGhz } = env;
  return (
    <V271Root>
      <Head icon={<Cpu size={18} />} color="#38bdf8" title={t("pages.index.panelProcessTitle")} sub={t("pages.index.panelProcessDesc")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Cell icon={<Cpu size={11} />} label={t("pages.index.logicalProcessors")} value={String(st.logicalPro ?? st.cpuCores ?? "—")} color="#38bdf8" />
        <Cell icon={<Gauge size={11} />} label={t("pages.index.frequency")} value={cpuGhz} color="#f59e0b" />
        <Cell icon={<Layers size={11} />} label={t("pages.index.threads")} value={String(st.appStats?.threads ?? "—")} color="#a78bfa" />
        <Cell icon={<MemoryStick size={11} />} label={t("pages.index.panelProcessHeap")} value={sizeFormat(st.appStats?.mem ?? 0)} color="#22c55e" />
      </div>
    </V271Root>
  );
}

export function V271Database({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const db = env.st.database;
  const open = db?.openConns ?? 0;
  const max = db?.maxOpenConns ?? 0;
  const pct = max > 0 ? (open / max) * 100 : 0;
  return (
    <V271Root>
      <Head icon={<Database size={18} />} color="#a78bfa" title={t("pages.index.database")} />
      <div className="v271-split grid items-center gap-4">
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
    </V271Root>
  );
}

export function V271UserAgent({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const parts = env.userAgents;
  const total = parts.reduce((a, p) => a + p.count, 0);
  const r = 46;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <V271Root>
      <Head
        icon={<Users size={18} />}
        color="#3b82f6"
        title={t("pages.clients.hwidUserAgentShareTitle", { defaultValue: "User-Agent distribution by HWID" })}
        sub={t("pages.index.hwidUserAgentDashboardHint", { defaultValue: "Overall share of registered devices across all clients." })}
      />
      {parts.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
      ) : (
        <div className="v271-split grid items-center gap-4">
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
          <div className="max-h-40 space-y-2.5 overflow-auto pr-1">
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
    </V271Root>
  );
}
