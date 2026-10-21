"use client";
/**
 * Built-in dashboard tiles ("atoms"): one metric or one control per tile (see lib/dashboardLayout.ts).
 * Metric-backed atoms are rendered by CustomMetricPanel (so every one of them can take any look: number,
 * gauge, bar, sparkline ...), the others are small purpose-built components. Every atom follows the tile
 * body contract of useTileBox.ts: fills the box, scales with it, hides secondary info, never clips.
 */
import {
  ArrowLeftRight, ArrowDown, ArrowUp, ArrowUpRight, Activity, Clock, Cpu, CloudDownload, CloudUpload, Database, Download, Eye, EyeOff,
  AlertTriangle, Copy, Gauge, Globe, HardDrive, History, Layers, MemoryStick, Network, Power, Radio, RefreshCw, Server, SlidersHorizontal, Users, Wrench,
  type LucideIcon,
} from "lucide-react";
import { TelemtDcStatusCard } from "@/components/TelemtDcStatusCard";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { useToast } from "@/components/ui";
import { useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CustomMetricPanel } from "@/components/dashboard/CustomMetricPanel";
import { TelemtDcDots, TelemtDcSummary } from "@/components/telemt/Atoms";
import { ClassicWidget } from "@/components/dashboard/classic";
import { V271Widget } from "@/components/dashboard/v271";
import { ResourceTileChart } from "@/components/dashboard/ResourceTileChart";
import { AtomFrame, FitText, TileHeader, useRoom } from "@/components/dashboard/AtomParts";
import { SegmentBar } from "@/components/dashboard/viz";
import { useElementBox, useTileBox } from "@/components/dashboard/useTileBox";
import type { CustomPanel, TileSettings } from "@/lib/dashboardBuilder";
import type { DashboardMetric } from "@/lib/dashboardMetrics";
import { atomDef } from "@/lib/dashboardLayout";
import { safeLinkUrl } from "@/lib/dashboardStyle";
import { GridContext } from "./gridContext";
import { sizeFormat } from "@/lib/format";

export type StatusData = {
  cpu: number;
  cpuCores: number;
  logicalPro?: number;
  cpuSpeedMhz?: number;
  mem: { current: number; total: number };
  disk: { current: number; total: number };
  swap: { current: number; total: number };
  loads: number[];
  netIO: { up: number; down: number };
  netTraffic: { sent: number; recv: number };
  publicIP: { ipv4: string; ipv6: string };
  tcpCount: number;
  udpCount: number;
  uptime: number;
  appStats: { threads: number; mem: number; uptime: number };
  panelUptime: number;
  panelVersion?: string;
  xray: { state: string; errorMsg: string; version: string };
  nodes?: { online: number; total: number };
  nodesXray?: { total: number; running: number; stopped: number; error: number; unknown: number };
  telemt?: { state: string; count: number; errorMsg?: string; version?: string };
  nodesTelemt?: { total: number; running: number; stopped: number; unknown: number };
  database: { size: number; tables: number; totalRows: number; openConns: number; idleConns: number; maxOpenConns: number; maxIdleConns: number };
  usersOnline?: number;
};

type CoreInfo = { version: string; mismatch: boolean } | null;
type Series = { points: { ts: number; value: number }[] }[];
export type UserAgentPart = { label: string; color: string; percentLabel: string; percentRaw: number; count: number };

/** Everything an atom may need; built once per render by DashboardPage. */
export type AtomEnv = {
  metrics: DashboardMetric[];
  st: StatusData;
  multi: boolean;
  ipv6Enabled: boolean;
  revealIp: boolean;
  toggleIp: () => void;
  can: { logs: boolean; xrayOperate: boolean; backup: boolean };
  installedXray: CoreInfo;
  installedTelemt: CoreInfo;
  cpuGhz: string;
  cpuSeries: Series;
  memSeries: Series;
  userAgents: UserAgentPart[];
  act: {
    openLogs: () => void;
    openVersions: () => void;
    stopXray: () => void;
    restartXray: () => void;
    stopTelemt: () => void;
    exportDb: () => void;
    importDb: () => void;
    openConfig: () => void;
    openCpu: () => void;
    openMem: () => void;
  };
};

/** Whether an atom has anything to show right now (permissions, single / multi node mode). A hidden atom takes no slot. */
export function isAtomVisible(id: string, env: AtomEnv): boolean {
  const { st, multi, can } = env;
  switch (id) {
    case "nodes_availability":
      return multi && (st.nodes?.total ?? 0) > 0;
    case "xray_uptime":
      return !multi;
    case "nodes_cores":
      return multi && (st.nodesXray?.total ?? 0) > 0;
    case "core_update":
      return can.xrayOperate;
    case "core_controls":
      return !multi && can.xrayOperate;
    case "logs":
    case "classic_logs":
    case "v271_logs":
      return can.logs;
    case "classic_backup":
    case "v271_backup":
    case "backup_export":
    case "backup_import":
    case "backup_config":
      return can.backup;
    default:
      return true;
  }
}

const synthetic = (id: string, label: string, text: string, extra: Partial<DashboardMetric> = {}): DashboardMetric => ({
  id,
  label,
  group: "",
  value: 1,
  unit: "status",
  states: { 1: text },
  ...extra,
});

const ICONS: Record<string, LucideIcon> = {
  Activity, ArrowDown, ArrowLeftRight, ArrowUp, Clock, Cpu, CloudDownload, CloudUpload, Database, Download, Gauge, Globe, HardDrive, History,
  Layers, MemoryStick, Network, Power, Radio, RefreshCw, Server, SlidersHorizontal, Users, Wrench,
};
export function atomIcon(name: string): LucideIcon {
  return ICONS[name] ?? Gauge;
}

/* ------------------------------------------------------------------ small components */

function iconPx(w: number, h: number) {
  return Math.max(16, Math.min(56, Math.round(Math.min(w || 120, h || 120) * 0.3)));
}

/** A tile that is one big button. */
function ActionTile({ icon: Icon, color, label, onClick }: { icon: LucideIcon; color: string; label: string; onClick: () => void }) {
  const { width, height } = useTileBox();
  const showLabel = height === 0 || height >= 92;
  return (
    <AtomFrame>
      <TileHeader icon={<Icon size={13} />} color={color} />
      <button
        type="button"
        onClick={onClick}
        className="group flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-[3cqmin] overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--accent)_30%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] px-2 text-[var(--fg)] transition hover:bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
        aria-label={label}
        title={label}
      >
        <span className="grid shrink-0 place-items-center transition group-hover:scale-110" style={{ color }}>
          <Icon size={iconPx(width, height)} />
        </span>
        {showLabel ? (
          <span className="line-clamp-2 max-w-full text-center font-semibold leading-tight" style={{ fontSize: "clamp(11px, 5cqmin, 16px)" }}>
            {label}
          </span>
        ) : null}
      </button>
    </AtomFrame>
  );
}

function RunningDot({ running }: { running: boolean | undefined }) {
  return (
    <span className="relative flex size-2.5 shrink-0" aria-hidden>
      {running ? <span className="dash-ping absolute inline-flex size-full rounded-full opacity-60" style={{ background: "#22c55e" }} /> : null}
      <span className="relative inline-flex size-2.5 rounded-full" style={{ background: running === undefined ? "var(--fg-subtle)" : running ? "#22c55e" : "#ef4444" }} />
    </span>
  );
}

function VersionTile({ icon: Icon, color, info, running }: { icon: LucideIcon; color: string; info: CoreInfo; running: boolean | undefined }) {
  const { t } = useTranslation();
  const { width, height } = useTileBox();
  const warn = t("pages.index.coreVersionMismatch", { defaultValue: "Nodes are not all on the same version — check Nodes" });
  const roomy = height >= 104 && width >= 190;
  const badge =
    info?.mismatch && !roomy ? (
      <span title={warn} aria-label={warn} role="img" className="grid shrink-0 place-items-center text-[#f59e0b]">
        <AlertTriangle size={14} />
      </span>
    ) : null;
  return (
    <AtomFrame>
      <TileHeader
        icon={<Icon size={13} />}
        color={color}
        right={
          <span className="flex items-center gap-1.5">
            {badge}
            <RunningDot running={running} />
          </span>
        }
      />
      <FitText text={info?.version || "—"} color={color} />
      {info?.mismatch && roomy ? (
        <p className="line-clamp-2 shrink-0 text-center leading-snug text-[#f59e0b]" style={{ fontSize: "clamp(9px, 3.2cqmin, 12px)" }} title={warn}>
          {warn}
        </p>
      ) : null}
    </AtomFrame>
  );
}

function CoreControlsTile({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { width, height } = useTileBox();
  const wide = width >= height * 1.3;
  const btn = (key: string, Icon: LucideIcon, label: string, onClick: () => void, tone: string, disabled = false) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-[var(--border)] px-1 text-[var(--fg-muted)] transition hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 disabled:opacity-40"
    >
      <Icon size={Math.max(14, Math.min(30, Math.round(Math.min(width, height) * 0.2)))} style={{ color: tone }} />
      {height >= 110 || wide ? <span className="max-w-full truncate" style={{ fontSize: "clamp(10px, 4cqmin, 13px)" }}>{label}</span> : null}
    </button>
  );
  return (
    <AtomFrame>
      <TileHeader icon={<Power size={13} />} color="#ef4444" />
      <div className={`flex min-h-0 flex-1 gap-[clamp(4px,2cqmin,8px)] ${wide ? "flex-row" : "flex-col"}`}>
        {btn("tm", Power, t("pages.index.stopTelemt"), env.act.stopTelemt, "#a78bfa", env.st.telemt?.state !== "running")}
        {btn("xs", Power, t("pages.index.stopXray"), env.act.stopXray, "#ef4444")}
        {btn("xr", RefreshCw, t("pages.index.restartXray"), env.act.restartXray, "#38bdf8")}
      </div>
    </AtomFrame>
  );
}

function AvailabilityTile({ online, total }: { online: number; total: number }) {
  const room = useRoom();
  const tone = online >= total ? "#22c55e" : online === 0 ? "#ef4444" : "#f59e0b";
  return (
    <AtomFrame>
      <TileHeader icon={<Server size={13} />} color={tone} />
      <FitText text={`${online} / ${total}`} color={tone} grow={3} />
      {room.hint ? <SegmentBar total={total} ok={online} /> : null}
    </AtomFrame>
  );
}

function HistoryTile({ series, kind, onOpen, color }: { series: Series; kind?: "line" | "area" | "bar"; onOpen: () => void; color: string }) {
  const { t } = useTranslation();
  return (
    <AtomFrame>
      <TileHeader
        icon={<Activity size={13} />}
        color={color}
        right={
          <button
            type="button"
            onClick={onOpen}
            aria-label={t("pages.builder.fullscreen")}
            title={t("pages.builder.fullscreen")}
            className="grid size-6 shrink-0 place-items-center rounded-md text-[var(--fg-subtle)] transition hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
          >
            <ArrowUpRight size={14} />
          </button>
        }
      />
      <ResourceTileChart series={series.map((s, i) => ({ key: "panel" + i, name: "Panel", stroke: color, points: s.points }))} kind={kind} />
    </AtomFrame>
  );
}

function IpTile({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { ref, width, height } = useElementBox();
  const toast = useToast();
  const v4 = env.st.publicIP?.ipv4 || "";
  const v6 = env.ipv6Enabled ? env.st.publicIP?.ipv6 || "" : "";
  const mask = (v: string) => (env.revealIp ? v || "—" : "•".repeat(Math.max(6, Math.min(v.length || 10, 15))));
  const iconBtn = (label: string, onClick: () => void, icon: ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-6 shrink-0 place-items-center rounded-md text-[var(--fg-muted)] transition hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
    >
      {icon}
    </button>
  );
  const copy = async (text: string) => {
    if (!text) return;
    try {
      await copyTextToClipboard(text);
      toast.success(t("copied", { defaultValue: "Copied" }));
    } catch {
      /* clipboard unavailable */
    }
  };
  const showV6 = Boolean(v6) && height >= 90;
  const f4 = Math.max(12, Math.min(height * (showV6 ? 0.42 : 0.62), width / (Math.max(7, mask(v4).length) * 0.6), 64));
  const f6 = Math.max(10, Math.min(height * 0.2, width / (Math.max(10, mask(v6).length) * 0.6), 26));
  const label = (s: string) => <span className="text-[0.6em] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">{s}</span>;
  return (
    <AtomFrame>
      <TileHeader
        icon={<Globe size={13} />}
        color="#38bdf8"
        right={
          <span className="flex items-center gap-0.5">
            {iconBtn(t("pages.index.copyIp", { defaultValue: "Copy IP" }), () => void copy(v4), <Copy size={13} />)}
            {iconBtn(t("pages.index.toggleIpVisibility"), env.toggleIp, env.revealIp ? <EyeOff size={14} /> : <Eye size={14} />)}
          </span>
        }
      />
      <div ref={ref} className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-[1cqmin] overflow-hidden text-center">
        {height >= 64 ? label("IPv4") : null}
        <span className="max-w-full whitespace-nowrap font-mono font-semibold tabular-nums text-[var(--fg)]" style={{ fontSize: f4, lineHeight: 1.1 }}>
          {mask(v4)}
        </span>
        {showV6 ? (
          <>
            {label("IPv6")}
            <span className="max-w-full truncate whitespace-nowrap font-mono tabular-nums text-[var(--fg-muted)]" style={{ fontSize: f6, lineHeight: 1.2 }} title={env.revealIp ? v6 : undefined}>
              {mask(v6)}
            </span>
          </>
        ) : null}
      </div>
    </AtomFrame>
  );
}

function UserAgentTile({ parts }: { parts: UserAgentPart[] }) {
  const { t } = useTranslation();
  const { ref, width, height } = useElementBox();
  const total = parts.reduce((a, p) => a + p.count, 0);
  const showList = width >= 250;
  const d = Math.max(0, Math.floor(Math.min(showList ? width * 0.45 : width, height)));
  const r = 46;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <AtomFrame>
      <TileHeader icon={<Users size={13} />} color="#3b82f6" />
      {parts.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center text-center text-xs text-[var(--fg-muted)]">{t("noData")}</div>
      ) : (
        <div ref={ref} className="flex min-h-0 min-w-0 flex-1 items-center gap-[3cqmin] overflow-hidden">
          {d >= 40 ? (
            <div className="relative shrink-0" style={{ width: d, height: d }}>
              <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
                <circle cx="60" cy="60" r={r} fill="none" stroke="color-mix(in oklab, var(--fg) 8%, transparent)" strokeWidth="14" />
                {parts.map((p) => {
                  const len = (p.percentRaw / 100) * c;
                  const off = (acc / 100) * c;
                  acc += p.percentRaw;
                  return <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-off} strokeLinecap="butt" />;
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono font-semibold tabular-nums text-[var(--fg)]" style={{ fontSize: Math.max(10, d * 0.2) }}>
                  {total.toLocaleString()}
                </span>
                {d >= 110 ? <span className="text-[10px] uppercase tracking-wider text-[var(--fg-subtle)]">{t("pages.clients.hwidShort", { defaultValue: "devices" })}</span> : null}
              </div>
            </div>
          ) : null}
          {showList || d < 40 ? (
            <div className="h-full min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {parts.map((p) => (
                <div key={p.label} className="min-w-0">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                      <span className="truncate font-mono text-[var(--fg-muted)]" title={p.label}>{p.label}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--fg)]">{p.percentLabel}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_8%,transparent)]">
                    <div className="h-full rounded-full" style={{ width: `${p.percentRaw}%`, background: p.color }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </AtomFrame>
  );
}

/* ------------------------------------------------------------------ atom -> tile */

const MIN_LABEL_IDS: Record<string, number> = { "load.1": 1, "load.5": 5, "load.15": 15 };

/** Secondary line under a single metric's value ("2.1 GB / 3.8 GB", "5 / 20", "8 cores"). */
export function metricDetail(metricId: string | undefined, st: StatusData, t: (k: string) => string): string | undefined {
  const size = (x: { current: number; total: number }) => `${sizeFormat(x.current)} / ${sizeFormat(x.total)}`;
  switch (metricId) {
    case "cpu":
      return `${st.cpuCores} ${t("pages.index.cores")}`;
    case "mem.percent":
      return size(st.mem);
    case "disk.percent":
      return size(st.disk);
    case "swap.percent":
      return size(st.swap);
    case "db.connections":
      return `${st.database?.openConns ?? 0} / ${st.database?.maxOpenConns ?? 0}`;
    default:
      return undefined;
  }
}

/** The metric tile: the panel's metrics in the look chosen in its settings. Same renderer for presets and custom tiles. */
export function MetricContent({ panel, settings, env, preview = false }: { panel: CustomPanel; settings: TileSettings; env: AtomEnv; preview?: boolean }) {
  const { t } = useTranslation();
  const editing = useContext(GridContext)?.editing ?? false;
  const selected = panel.metrics
    .map((id) => env.metrics.find((m) => m.id === id))
    .filter((m): m is DashboardMetric => m != null)
    .map((m) => (MIN_LABEL_IDS[m.id] ? { ...m, label: `${MIN_LABEL_IDS[m.id]} ${t("pages.builder.minShort")}` } : m));
  const def = panel.preset ? atomDef(panel.preset) : undefined;
  const Icon = def ? atomIcon(def.icon) : undefined;
  // Tile style "click action": open the CPU / memory history, or follow a same-origin / http(s) link. Off in previews.
  const style = settings.style;
  const first = panel.metrics[0] ?? "";
  const onActivate = preview || editing
    ? undefined
    : style?.onClick === "link" && style.url
      ? () => {
          const url = safeLinkUrl(style.url ?? "");
          if (!url) return;
          if (url.startsWith("/")) window.location.assign(url);
          else window.open(url, "_blank", "noopener,noreferrer");
        }
      : style?.onClick === "history" && (first.startsWith("cpu") || first.startsWith("mem"))
        ? first.startsWith("cpu")
          ? env.act.openCpu
          : env.act.openMem
        : undefined;
  return (
    <CustomMetricPanel
      metrics={selected}
      settings={{ ...settings, color: settings.color ?? def?.color }}
      detail={panel.metrics.length === 1 ? metricDetail(panel.metrics[0], env.st, t) : undefined}
      icon={Icon ? <Icon size={13} /> : undefined}
      onActivate={onActivate}
      activateLabel={style?.onClick === "history" ? t("pages.builder.style.openHistory") : style?.url}
    />
  );
}

/** Purpose-built tiles (everything that is not a metric look). Returns the content, the caller wraps it in a tile. */
export function WidgetContent({ widget, env }: { widget: string; env: AtomEnv }) {
  const { t } = useTranslation();
  const def = atomDef(widget);
  const { st } = env;
  if (!def) return null;
  if (def.group === "classic") return <ClassicWidget widget={widget} env={env} />;
  if (def.group === "v271") return <V271Widget widget={widget} env={env} />;
  const Icon = atomIcon(def.icon);
  const icon = <Icon size={13} />;
  const stat = (id: string, value: number, unit: DashboardMetric["unit"], text: string, color: string, extra: Partial<DashboardMetric> = {}) => (
    <CustomMetricPanel metrics={[synthetic(id, t(def.title), text, { value, unit, ...extra })]} settings={{ width: 3, height: 4, view: "stat", title: "", color }} icon={icon} />
  );
  switch (widget) {
    case "xray_uptime":
      return stat("xray.uptime", st.appStats?.uptime ?? 0, "seconds", "", def.color, { states: undefined });
    case "nodes_cores": {
      const nx = st.nodesXray ?? { running: 0, total: 0 };
      return stat("nodes.cores", nx.running, "status", `${nx.running} / ${nx.total}`, nx.running === nx.total ? "#22c55e" : "#f59e0b", { max: nx.total });
    }
    case "panel_frequency":
      return stat("cpu.frequency.text", 1, "status", env.cpuGhz, def.color);
    case "nodes_availability":
      return <AvailabilityTile online={st.nodes?.online ?? 0} total={st.nodes?.total ?? 0} />;
    case "cpu_history":
    case "memory_history": {
      const cpu = widget === "cpu_history";
      return <HistoryTile series={cpu ? env.cpuSeries : env.memSeries} onOpen={cpu ? env.act.openCpu : env.act.openMem} color={cpu ? "var(--accent)" : "#a78bfa"} />;
    }
    case "xray_version":
      return <VersionTile icon={Wrench} color="var(--accent)" info={env.installedXray} running={env.multi ? undefined : st.xray?.state === "running"} />;
    case "telemt_version":
      return <VersionTile icon={Wrench} color="#a78bfa" info={env.installedTelemt} running={env.multi ? undefined : st.telemt?.state === "running"} />;
    case "core_update":
      return <ActionTile icon={RefreshCw} color={def.color} label={t("pages.index.coreVersionSwitch")} onClick={env.act.openVersions} />;
    case "core_controls":
      return <CoreControlsTile env={env} />;
    case "logs":
      return <ActionTile icon={History} color={def.color} label={t("pages.index.logsOpen", { defaultValue: "Open the journal" })} onClick={env.act.openLogs} />;
    case "backup_export":
      return <ActionTile icon={Download} color={def.color} label={t("pages.index.exportDatabase")} onClick={env.act.exportDb} />;
    case "backup_import":
      return <ActionTile icon={CloudUpload} color={def.color} label={t("pages.index.importDatabase")} onClick={env.act.importDb} />;
    case "backup_config":
      return <ActionTile icon={SlidersHorizontal} color={def.color} label={t("pages.index.config")} onClick={env.act.openConfig} />;
    case "server_ip":
      return <IpTile env={env} />;
    case "user_agent":
      return <UserAgentTile parts={env.userAgents} />;
    case "telemt_dc":
      return <TelemtDcStatusCard />;
    case "telemt_dc_summary":
      return <TelemtDcSummary />;
    case "telemt_dc_dots":
      return <TelemtDcDots />;
    default:
      return null;
  }
}
