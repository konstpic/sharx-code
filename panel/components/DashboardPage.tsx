"use client";

import {
  Activity,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CircleStop,
  Clock,
  CloudDownload,
  CloudUpload,
  Cpu,
  Database,
  Download,
  Globe,
  History,
  LayoutDashboard,
  LayoutGrid,
  Network,
  Play,
  Power,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson, api } from "@/lib/api";
import { formatSecond, sizeFormat, toFixed } from "@/lib/format";
import { usePanelWebSocket } from "@/lib/panelWebSocket";
import { linkP, panel, p } from "@/lib/paths";
import { usePanelAccentColor } from "@/lib/panelTheme";
import { CoreVersionCards } from "@/components/dashboard/CoreVersionCards";
import { PageScaffold, PageHeader, SectionHelpModal, Surface } from "@/components/panel";
import {
  AlertBanner,
  Button,
  CheckboxField,
  ConfirmDialog,
  IconButton,
  IconTile,
  Input,
  LinearProgress,
  Modal,
  PillTag,
  Reveal,
  SelectNative,
  Spinner,
  Stagger,
  StaggerItem,
  StatBlock,
  useToast,
} from "@/components/ui";
import { useCountUp } from "@/lib/useCountUp";
import { useLogStream, type LogEntry } from "@/lib/useLogStream";
import {
  DASHBOARD_WIDGET_I18N,
  DASHBOARD_WIDGET_ORDER,
  type DashboardWidgetId,
  encodeDashboardWidgets,
  parseDashboardWidgets,
  toggleDashboardWidget,
} from "@/lib/dashboardLayout";
import { getUiPref, setUiPref } from "@/lib/uiPrefs";
import { FixedSizeList } from "react-window";

type StatusData = {
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
  database: {
    size: number;
    tables: number;
    totalRows: number;
    openConns: number;
    idleConns: number;
    maxOpenConns: number;
    maxIdleConns: number;
  };
  usersOnline?: number;
};

type UnifiedLogEntry = LogEntry;

function metricColor(percent: number, accent: string) {
  if (percent < 80) return accent;
  if (percent < 90) return "#f59e0b";
  return "#ef4444";
}

function pct(cur: number, tot: number) {
  if (!tot) return 0;
  return Number(toFixed((cur / tot) * 100, 2));
}

function CountSize({ value }: { value: number }) {
  const v = useCountUp(value, { duration: 700, decimals: 0 });
  return <>{sizeFormat(v)}</>;
}

function CountNumber({ value }: { value: number }) {
  const v = useCountUp(value, { duration: 700, decimals: 0 });
  return <>{Math.round(v)}</>;
}

/** Picks the most common non-empty version across a set of nodes and flags whether they agree.
 * Cores are rolled out centrally (install/installOnNodes push one version to the whole fleet),
 * so the version that matters is what the DB says is actually deployed on each node — not a
 * live query of the panel host's own process, which in multi-node mode usually isn't running
 * Xray/Telemt at all and would just read "Unknown" regardless of what the fleet is on. */
function installedVersionSummary(
  versions: (string | undefined)[],
): { version: string; mismatch: boolean } | null {
  const counts = new Map<string, number>();
  for (const raw of versions) {
    const v = (raw || "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = "";
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return { version: best, mismatch: counts.size > 1 };
}

const SPARK_W = 200;
const SPARK_H = 36;
const HISTORY_W = 840;
const HISTORY_H = 220;
const HISTORY_PAD_L = 40;
const HISTORY_PAD_R = 40;
const HISTORY_PAD_T = 20;
const HISTORY_PAD_B = 20;

type ResourceHistoryPoint = {
  value: number;
  ts: number;
};

type DashboardClientHwid = {
  userAgent?: string;
};

type DashboardClientRow = {
  hwids?: DashboardClientHwid[];
};

function toUnixMs(ts: number) {
  // API may return unix seconds for historical points.
  return ts > 0 && ts < 1_000_000_000_000 ? ts * 1000 : ts;
}

const RESOURCE_CHART_COLORS = [
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#818cf8",
  "#fb923c",
  "#2dd4bf",
  "#c084fc",
  "#f87171",
];

type DashboardMetricSeries = {
  key: string;
  name: string;
  nodeId?: number;
  points: ResourceHistoryPoint[];
};

/** Dashboard shows panel host only; per-node charts live on the Nodes page. */
function panelOnlySeries(series: DashboardMetricSeries[]): DashboardMetricSeries[] {
  return series.filter((s) => s.key === "panel");
}

/** Parse `{ series: [...] }` CPU/mem history API; supports legacy bare point array from older panels. */
function parseResourceHistoryEnvelope(obj: unknown, metric: "cpu" | "mem"): DashboardMetricSeries[] {
  if (Array.isArray(obj)) {
    const points: ResourceHistoryPoint[] = (obj as { t?: number; time?: number; cpu?: number; mem?: number }[]).map(
      (raw) => {
        const ts = Number(raw?.t ?? raw?.time ?? 0);
        const vRaw =
          metric === "cpu" ? Number(raw?.cpu ?? (raw as { v?: number }).v) : Number(raw?.mem ?? (raw as { v?: number }).v);
        const v = Number.isFinite(vRaw) ? Math.max(0, Math.min(100, vRaw)) : 0;
        return { value: v, ts: toUnixMs(ts) };
      }
    );
    return [{ key: "panel", name: "Panel", points }];
  }
  if (!obj || typeof obj !== "object") return [];
  const ser = (obj as { series?: unknown }).series;
  if (!Array.isArray(ser)) return [];
  return ser
    .map((row): DashboardMetricSeries | null => {
      if (!row || typeof row !== "object") return null;
      const r = row as {
        key?: string;
        name?: string;
        nodeId?: number;
        points?: unknown;
      };
      const key = String(r.key ?? "unknown");
      const name = String(r.name ?? key);
      const ptsRaw = Array.isArray(r.points) ? r.points : [];
      const points: ResourceHistoryPoint[] = ptsRaw.map((p) => {
        const raw = p as { t?: number; time?: number; cpu?: number; mem?: number; v?: number };
        const ts = Number(raw?.t ?? raw?.time ?? 0);
        const vRaw =
          metric === "cpu" ? Number(raw?.cpu ?? raw?.v) : Number(raw?.mem ?? raw?.v);
        const v = Number.isFinite(vRaw) ? Math.max(0, Math.min(100, vRaw)) : 0;
        return { value: v, ts: toUnixMs(ts) };
      });
      return { key, name, nodeId: r.nodeId, points };
    })
    .filter((x): x is DashboardMetricSeries => x != null);
}

function paletteStrokeForSeries(s: DashboardMetricSeries, accent: string, index: number) {
  if (s.key === "panel") return accent;
  return RESOURCE_CHART_COLORS[index % RESOURCE_CHART_COLORS.length];
}

/** Sparkline overlay: multiple metrics on one time scale (milliseconds). */
function MultiResourceSparkline({
  accent,
  series,
}: {
  accent: string;
  series: DashboardMetricSeries[];
}) {
  const trimmed = useMemo(() => series.map((s) => ({ ...s, points: s.points.slice(-48) })), [series]);
  const bounds = useMemo(() => {
    let tMin = Number.POSITIVE_INFINITY;
    let tMax = Number.NEGATIVE_INFINITY;
    for (const s of trimmed) {
      for (const p of s.points) {
        if (p.ts < tMin) tMin = p.ts;
        if (p.ts > tMax) tMax = p.ts;
      }
    }
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin === tMax) {
      return { tMin: 0, tMax: 1 };
    }
    return { tMin, tMax };
  }, [trimmed]);

  const empty = trimmed.every((s) => s.points.length < 2);
  if (empty) {
    return <div className="h-9 w-full rounded-md bg-[var(--border)]/20" aria-hidden />;
  }

  const { tMin, tMax } = bounds;
  const span = Math.max(1, tMax - tMin);

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="h-9 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      {trimmed.map((s, i) => {
        const stroke = paletteStrokeForSeries(s, accent, i);
        if (s.points.length < 2) return null;
        const pts = s.points
          .map((p0) => {
            const nx = ((p0.ts - tMin) / span) * (SPARK_W - 2) + 1;
            const ny = SPARK_H - 1 - (Math.max(0, Math.min(100, p0.value)) / 100) * (SPARK_H - 2);
            return `${nx},${ny}`;
          })
          .join(" ");
        return (
          <polyline
            key={s.key}
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pts}
            vectorEffect="non-scaling-stroke"
            opacity="0.92"
          />
        );
      })}
    </svg>
  );
}

type MultiStrokeSeries = DashboardMetricSeries & { stroke: string };

function MultiSeriesResourceChart({
  series,
  hoverT,
  onHoverT,
  onLeave,
}: {
  series: MultiStrokeSeries[];
  hoverT: number | null;
  onHoverT: (t: number | null) => void;
  onLeave: () => void;
}) {
  const bounds = useMemo(() => {
    let tMin = Number.POSITIVE_INFINITY;
    let tMax = Number.NEGATIVE_INFINITY;
    for (const s of series) {
      for (const p of s.points) {
        if (p.ts < tMin) tMin = p.ts;
        if (p.ts > tMax) tMax = p.ts;
      }
    }
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || series.every((x) => x.points.length === 0)) {
      return null;
    }
    if (tMin === tMax) {
      tMax = tMin + 1;
    }
    return { tMin, tMax };
  }, [series]);

  const nonempty = series.filter((s) => s.points.length >= 2);
  if (!bounds || nonempty.length === 0) {
    return <div className="h-[220px] w-full rounded-lg bg-[var(--border)]/20" aria-hidden />;
  }

  const { tMin, tMax } = bounds;
  const span = tMax - tMin;
  const innerW = HISTORY_W - HISTORY_PAD_L - HISTORY_PAD_R;
  const innerH = HISTORY_H - HISTORY_PAD_T - HISTORY_PAD_B;

  const xForTs = (ts: number) => HISTORY_PAD_L + ((ts - tMin) / span) * innerW;
  const yForVal = (v: number) =>
    HISTORY_H - HISTORY_PAD_B - (Math.max(0, Math.min(100, v)) / 100) * innerH;

  const nearestPoint = (pts: ResourceHistoryPoint[], center: number): ResourceHistoryPoint | null => {
    if (!pts.length) return null;
    let best = pts[0];
    let bestD = Math.abs(pts[0].ts - center);
    for (const p of pts) {
      const d = Math.abs(p.ts - center);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };

  const tooltipRows = hoverT != null ? nonempty.map((s) => ({ s, pt: nearestPoint(s.points, hoverT) })) : [];
  const hoverX =
    hoverT != null ? Math.min(HISTORY_W - HISTORY_PAD_R, Math.max(HISTORY_PAD_L, xForTs(hoverT))) : null;

  return (
    <div className="relative min-h-[220px] w-full" onMouseLeave={onLeave}>
      <svg
        viewBox={`0 0 ${HISTORY_W} ${HISTORY_H}`}
        width="100%"
        height="220"
        preserveAspectRatio="xMidYMid meet"
        className="block max-h-[220px]"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / Math.max(1, rect.width)) * HISTORY_W - HISTORY_PAD_L;
          const tt = (rel / innerW) * span + tMin;
          if (rel < -2 || rel > innerW + 2) {
            onHoverT(null);
            return;
          }
          onHoverT(Number.isFinite(tt) ? tt : null);
        }}
      >
        {[0, 25, 50, 75, 100].map((v) => {
          const y = HISTORY_H - HISTORY_PAD_B - (v / 100) * innerH;
          return (
            <line
              key={v}
              x1={HISTORY_PAD_L}
              y1={y}
              x2={HISTORY_W - HISTORY_PAD_R}
              y2={y}
              stroke="var(--border)"
              strokeOpacity="0.35"
              strokeDasharray="4 5"
            />
          );
        })}
        {nonempty.map((s) => {
          const linePoints = s.points.map((p) => `${xForTs(p.ts)},${yForVal(p.value)}`).join(" ");
          return (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.stroke}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={linePoints}
            />
          );
        })}
        {hoverX != null && hoverT != null ? (
          <>
            <line
              x1={hoverX}
              y1={HISTORY_PAD_T}
              x2={hoverX}
              y2={HISTORY_H - HISTORY_PAD_B}
              stroke="var(--fg-muted)"
              strokeOpacity="0.45"
              strokeDasharray="4 5"
            />
            {tooltipRows.map(({ s, pt }) =>
              pt ? (
                <circle key={`${s.key}-dot`} cx={xForTs(pt.ts)} cy={yForVal(pt.value)} r={4} fill={s.stroke} />
              ) : null
            )}
          </>
        ) : null}
      </svg>
      {hoverT != null && tooltipRows.some((x) => x.pt) ? (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[min(92%,420px)] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]/96 px-2 py-1.5 text-xs shadow-lg backdrop-blur">
          <p className="mb-1 text-[var(--fg-muted)]">
            {new Date(Math.round(hoverT)).toLocaleString()}
          </p>
          <ul className="list-none space-y-0.5">
            {tooltipRows.map(({ s, pt }) =>
              pt ? (
                <li key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: s.stroke }} />
                    <span className="truncate font-medium text-[var(--fg)]">{s.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[var(--fg)]">{toFixed(pt.value, 1)}%</span>
                </li>
              ) : null
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const LOG_ROW_HEIGHT = 36;

type LogVirtualListProps = {
  logs: UnifiedLogEntry[];
  levelBadgeClass: (lvl: string) => string;
  listRef: React.RefObject<FixedSizeList | null>;
};

function LogVirtualList({ logs, levelBadgeClass, listRef }: LogVirtualListProps) {

  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const row = logs[index];
      if (!row) return null;
      return (
        <div
          style={style}
          className="grid grid-cols-[160px_84px_130px_1fr] gap-2 border-b border-[var(--border)]/50 px-3 font-mono text-xs text-[var(--fg-muted)] last:border-b-0"
        >
          <span className="flex items-center truncate">
            {new Date(row.ts || Date.now()).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <span className="flex items-center">
            <span
              className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${levelBadgeClass(row.level)}`}
            >
              {row.level}
            </span>
          </span>
          <span className="flex items-center truncate">
            {row.source === "node" && row.nodeName ? `node:${row.nodeName}` : row.source}
          </span>
          <span className="flex items-center whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[var(--fg)]">
            {row.message}
          </span>
        </div>
      );
    },
    [logs, levelBadgeClass]
  );

  return (
    <FixedSizeList
      ref={listRef}
      height={520}
      itemCount={logs.length}
      itemSize={LOG_ROW_HEIGHT}
      width="100%"
      overscanCount={10}
      className="font-mono text-xs"
    >
      {Row}
    </FixedSizeList>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const accent = usePanelAccentColor();
  const [loading, setLoading] = useState(true);
  const [spin, setSpin] = useState(false);
  const [st, setSt] = useState<StatusData | null>(null);
  const [showSec, setShowSec] = useState(false);
  const [dontSec, setDontSec] = useState(false);
  const [showIp, setShowIp] = useState(false);
  const [multi, setMulti] = useState(false);
  const [ipv6Enabled, setIpv6Enabled] = useState(false);
  const [verOpen, setVerOpen] = useState(false);
  const [verTab, setVerTab] = useState<"xray" | "telemt">("xray");
  const [verListXray, setVerListXray] = useState<string[]>([]);
  const [verListTelemt, setVerListTelemt] = useState<string[]>([]);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [pendingCore, setPendingCore] = useState<"xray" | "telemt">("xray");
  const [versionInstalling, setVersionInstalling] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configText, setConfigText] = useState("");
  const [cpuOpen, setCpuOpen] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [logLevel, setLogLevel] = useState("info");
  const [logSource, setLogSource] = useState("all");
  const [logSearch, setLogSearch] = useState("");
  const [logAuto, setLogAuto] = useState(true);
  const [logPaused, setLogPaused] = useState(false);
  const [logEntries, setLogEntries] = useState<UnifiedLogEntry[]>([]);
  const listRef = useRef<FixedSizeList | null>(null);

  const MAX_LOG_ENTRIES = 2000;
  const [cpuBucket, setCpuBucket] = useState(2);
  const [memBucket, setMemBucket] = useState(2);
  /** CPU history series (panel + nodes) for modal and preview. */
  const [cpuHistorySeries, setCpuHistorySeries] = useState<DashboardMetricSeries[]>([]);
  const [memHistorySeries, setMemHistorySeries] = useState<DashboardMetricSeries[]>([]);
  const [cpuPreviewSeries, setCpuPreviewSeries] = useState<DashboardMetricSeries[]>([]);
  const [memPreviewSeries, setMemPreviewSeries] = useState<DashboardMetricSeries[]>([]);
  const [cpuHoverT, setCpuHoverT] = useState<number | null>(null);
  const [memHoverT, setMemHoverT] = useState<number | null>(null);
  const [nodes, setNodes] = useState<
    { id: number; name: string; enable?: boolean; xrayVersion?: string; telemtVersion?: string }[]
  >([]);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [enabledWidgets, setEnabledWidgets] = useState<DashboardWidgetId[]>([...DASHBOARD_WIDGET_ORDER]);
  const [dashboardHwidUserAgentStats, setDashboardHwidUserAgentStats] = useState<
    { label: string; count: number; percentRaw: number; percentLabel: string }[]
  >([]);

  const ws = usePanelWebSocket();

  const onLogBatch = useCallback((batch: LogEntry[]) => {
    setLogEntries((prev) => {
      const next = [...batch.slice().reverse(), ...prev];
      return next.length > MAX_LOG_ENTRIES ? next.slice(0, MAX_LOG_ENTRIES) : next;
    });
  }, []);

  useLogStream({
    level: logLevel === "all" ? "debug" : logLevel,
    source: logSource,
    enabled: logsOpen && !logPaused,
    onBatch: onLogBatch,
  });


  useEffect(() => {
    void setUiPref("dashboardWidgets", encodeDashboardWidgets(enabledWidgets));
  }, [enabledWidgets]);

  useEffect(() => {
    (async () => {
      const hidden = (await getUiPref("hideSecAlert")) === "true";
      if (hidden) return;
      if (window.location.protocol !== "https:") setShowSec(true);
    })();
  }, []);

  const pull = useCallback(async () => {
    const msg = await getJson<StatusData>(panel("api/server/status"));
    if (msg.success && msg.obj) {
      setSt(msg.obj);
    }
  }, []);

  const pullDashboardHwidUserAgentStats = useCallback(async () => {
    const unknownLabel = t("pages.clients.hwidUserAgentUnknown", {
      defaultValue: "Unknown",
    });
    const r = await getJson<DashboardClientRow[]>(panel("client/list"));
    if (!r.success || !r.obj) {
      setDashboardHwidUserAgentStats([]);
      return;
    }
    const byUserAgent = new Map<string, number>();
    let total = 0;
    for (const client of r.obj) {
      const hwids = Array.isArray(client.hwids) ? client.hwids : [];
      for (const hwidRow of hwids) {
        const label = hwidRow.userAgent?.trim() ? hwidRow.userAgent.trim() : unknownLabel;
        byUserAgent.set(label, (byUserAgent.get(label) ?? 0) + 1);
        total += 1;
      }
    }
    const stats = Array.from(byUserAgent.entries())
      .map(([label, count]) => {
        const percentRaw = total > 0 ? (count / total) * 100 : 0;
        const percentRounded = Math.round(percentRaw * 10) / 10;
        const percentLabel = `${Number.isInteger(percentRounded) ? percentRounded.toFixed(0) : percentRounded.toFixed(1)}%`;
        return { label, count, percentRaw, percentLabel };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    setDashboardHwidUserAgentStats(stats);
  }, [t]);

  useEffect(() => {
    (async () => {
      try {
        await postJson(panel("setting/defaultSettings"));
        const s = await postJson<Record<string, unknown>>(panel("setting/all"));
        if (s.success && s.obj) {
          const settings = s.obj as { multiNodeMode?: boolean; enableIPv6?: boolean };
          setMulti(Boolean(settings.multiNodeMode));
          setIpv6Enabled(Boolean(settings.enableIPv6));
        }
        const widgetsRaw = await getUiPref("dashboardWidgets");
        setEnabledWidgets(parseDashboardWidgets(widgetsRaw));
      } catch {
        /* ignore */
      }
      await pull();
      await pullDashboardHwidUserAgentStats();
      setLoading(false);
    })();
  }, [pull, pullDashboardHwidUserAgentStats]);

  useEffect(() => {
    if (!ws) return;
    const onStatus = (payload: unknown) => {
      setSt(payload as StatusData);
    };
    const onXray = (payload: unknown) => {
      const pl = payload as { state: string; errorMsg: string };
      setSt((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          xray: {
            ...prev.xray,
            state: pl.state,
            errorMsg: pl.errorMsg || "",
          },
        };
      });
    };
    ws.on("status", onStatus);
    ws.on("xray_state", onXray);
    return () => {
      ws.off("status", onStatus);
      ws.off("xray_state", onXray);
    };
  }, [ws]);

  useEffect(() => {
    if (!multi) return;
    (async () => {
      const r = await getJson<
        { id: number; name: string; enable?: boolean; xrayVersion?: string; telemtVersion?: string }[]
      >(panel("node/list"));
      if (r.success && r.obj) {
        // Keep every node (install actions elsewhere push to all of them, enabled or not) —
        // only the version-aggregation below filters to enabled nodes.
        setNodes(
          (r.obj || []).map((n) => ({
            id: n.id,
            name: n.name || `Node ${n.id}`,
            enable: n.enable !== false,
            xrayVersion: n.xrayVersion || undefined,
            telemtVersion: n.telemtVersion || undefined,
          })),
        );
      }
    })();
  }, [multi]);

  useEffect(() => {
    const load = async () => {
      const r = await getJson<unknown>(panel("api/server/cpuHistory/2"));
      if (r.success && r.obj) {
        setCpuPreviewSeries(panelOnlySeries(parseResourceHistoryEnvelope(r.obj, "cpu")));
      }
      const mr = await getJson<unknown>(panel("api/server/memHistory/2"));
      if (mr.success && mr.obj) {
        setMemPreviewSeries(panelOnlySeries(parseResourceHistoryEnvelope(mr.obj, "mem")));
      }
    };
    void load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!cpuOpen) return;
    (async () => {
      setSpin(true);
      const r = await getJson<unknown>(panel(`api/server/cpuHistory/${cpuBucket}`));
      setSpin(false);
      if (r.success && r.obj) {
        setCpuHistorySeries(panelOnlySeries(parseResourceHistoryEnvelope(r.obj, "cpu")));
      }
    })();
  }, [cpuOpen, cpuBucket]);

  useEffect(() => {
    if (!memOpen) return;
    (async () => {
      setSpin(true);
      const r = await getJson<unknown>(panel(`api/server/memHistory/${memBucket}`));
      setSpin(false);
      if (r.success && r.obj) {
        setMemHistorySeries(panelOnlySeries(parseResourceHistoryEnvelope(r.obj, "mem")));
      }
    })();
  }, [memOpen, memBucket]);


  const dashboardHwidUserAgentPie = useMemo(() => {
    const palette = [
      "#3b82f6",
      "#8b5cf6",
      "#14b8a6",
      "#f59e0b",
      "#ef4444",
      "#10b981",
      "#06b6d4",
      "#a855f7",
      "#f97316",
      "#84cc16",
    ];
    let current = 0;
    const parts = dashboardHwidUserAgentStats.map((item, index) => {
      const start = current;
      current += item.percentRaw;
      return {
        ...item,
        color: palette[index % palette.length],
        start,
        end: current,
      };
    });
    const gradient =
      parts.length > 0
        ? `conic-gradient(${parts
            .map((part) => `${part.color} ${part.start}% ${part.end}%`)
            .join(", ")})`
        : "conic-gradient(var(--border) 0% 100%)";
    return { parts, gradient };
  }, [dashboardHwidUserAgentStats]);

  const levelRank = useCallback((lvl: string) => {
    const k = String(lvl || "").toLowerCase();
    if (k.startsWith("err") || k === "error") return 40;
    if (k.startsWith("warn") || k === "warning") return 30;
    if (k === "notice") return 25;
    if (k === "info") return 20;
    if (k === "debug") return 10;
    return 0;
  }, []);

  const levelBadgeClass = useCallback((lvl: string) => {
    const k = String(lvl || "").toLowerCase();
    if (k.startsWith("err") || k === "error") {
      return "status-pill status-pill--rose";
    }
    if (k.startsWith("warn") || k === "warning") {
      return "status-pill status-pill--amber";
    }
    if (k === "info" || k === "notice") {
      return "status-pill status-pill--blue";
    }
    if (k === "debug") {
      return "status-pill status-pill--neutral";
    }
    return "status-pill status-pill--neutral";
  }, []);

  const filteredLogs = useMemo(() => {
    return logEntries.filter((row) => {
      if (logSource !== "all" && row.source !== logSource) return false;
      if (logLevel !== "all" && levelRank(row.level) < levelRank(logLevel)) return false;
      if (!logSearch.trim()) return true;
      const q = logSearch.toLowerCase();
      return (
        row.message.toLowerCase().includes(q) ||
        row.level.toLowerCase().includes(q) ||
        (row.nodeName || "").toLowerCase().includes(q)
      );
    });
  }, [logEntries, logSource, logLevel, logSearch, levelRank]);

  useEffect(() => {
    if (!logsOpen || !logAuto) return;
    if (listRef.current && filteredLogs.length > 0) {
      listRef.current.scrollToItem(0);
    }
  }, [logsOpen, logAuto, filteredLogs.length]);

  const dashboardRamStroke = "#a78bfa";
  const cpuChartSeries = useMemo(
    () =>
      cpuHistorySeries.map((s, i) => ({
        ...s,
        name: s.key === "panel" ? t("pages.index.resourceSeriesPanel") : s.name,
        stroke: paletteStrokeForSeries(s, accent, i),
      })),
    [cpuHistorySeries, accent, t]
  );
  const memChartSeries = useMemo(
    () =>
      memHistorySeries.map((s, i) => ({
        ...s,
        name: s.key === "panel" ? t("pages.index.resourceSeriesPanel") : s.name,
        stroke: paletteStrokeForSeries(s, dashboardRamStroke, i),
      })),
    [memHistorySeries, t]
  );
  const cpuPreviewLegend = useMemo(
    () =>
      cpuPreviewSeries.map((s, i) => ({
        key: s.key,
        name: s.key === "panel" ? t("pages.index.resourceSeriesPanel") : s.name,
        stroke: paletteStrokeForSeries(s, accent, i),
      })),
    [cpuPreviewSeries, accent, t]
  );
  const memPreviewLegend = useMemo(
    () =>
      memPreviewSeries.map((s, i) => ({
        key: s.key,
        name: s.key === "panel" ? t("pages.index.resourceSeriesPanel") : s.name,
        stroke: paletteStrokeForSeries(s, dashboardRamStroke, i),
      })),
    [memPreviewSeries, t]
  );

  if (loading) {
    return (
      <PageScaffold>
        <PageHeader
          title={t("menu.dashboard")}
          accentTitle
          icon={LayoutDashboard}
          iconTone="accent"
          actions={
            <Button type="button" variant="secondary" className="!gap-2" disabled>
              <LayoutGrid size={16} />
              {t("pages.index.dashboardCustomize")}
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-hidden>
          <div className="h-72 animate-pulse rounded-2xl bg-[var(--surface)]/60 lg:col-span-8" />
          <div className="h-72 animate-pulse rounded-2xl bg-[var(--surface)]/50 lg:col-span-4" />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-[var(--border)]/30 bg-[var(--surface)]/40"
            />
          ))}
        </div>
      </PageScaffold>
    );
  }
  if (!st) {
    return (
      <PageScaffold>
        <AlertBanner type="error" title={t("noData")} />
      </PageScaffold>
    );
  }

  const cpuP = st.cpu;
  const memP = pct(st.mem.current, st.mem.total);
  const dskP = pct(st.disk.current, st.disk.total);
  const swP = pct(st.swap.current, st.swap.total);
  const nOn = st.nodes?.online ?? 0;
  const nTot = st.nodes?.total ?? 0;
  const nP = nTot ? Number(toFixed((nOn / nTot) * 100, 2)) : 0;
  const nx = st.nodesXray;
  // Installed core versions: multi-node reads what's actually recorded per node in the DB
  // (rolled out centrally), single-node keeps the live-detected panel host version.
  const installedXray = multi
    ? installedVersionSummary(nodes.filter((n) => n.enable !== false).map((n) => n.xrayVersion))
    : st.xray?.version
      ? { version: st.xray.version, mismatch: false }
      : null;
  const installedTelemt = multi
    ? installedVersionSummary(nodes.filter((n) => n.enable !== false).map((n) => n.telemtVersion))
    : st.telemt?.version
      ? { version: st.telemt.version, mismatch: false }
      : null;
  const trafficMax = Math.max(1, st.netIO.up, st.netIO.down, st.netTraffic.sent, st.netTraffic.recv);
  const ramSparkColor = dashboardRamStroke;
  const showResources = enabledWidgets.includes("resources");
  const showQuickActions = enabledWidgets.includes("quick_actions");
  const showUptime = enabledWidgets.includes("uptime");
  const showDatabase = enabledWidgets.includes("database");
  const showNetwork = enabledWidgets.includes("network");
  const showPanelRuntime = enabledWidgets.includes("panel_runtime");
  const showUsersOnline = enabledWidgets.includes("users_online");
  const showUserAgent = enabledWidgets.includes("user_agent");
  const cpuGhz = st.cpuSpeedMhz
    ? st.cpuSpeedMhz >= 1000
      ? `${toFixed(st.cpuSpeedMhz / 1000, 2)} GHz`
      : `${toFixed(st.cpuSpeedMhz, 0)} MHz`
    : "—";

  const stopX = async () => {
    setSpin(true);
    const r = await postJson(panel("api/server/stopXrayService"));
    setSpin(false);
    if (r.success) toast.success(t("success"));
  };
  const stopTelemtLocal = async () => {
    if (multi) return;
    setSpin(true);
    try {
      const r = await postJson(panel("api/server/stopTelemtService"));
      if (r.success) {
        toast.success(
          t("pages.index.telemtStopOk", { defaultValue: "Telemt stopped" }),
        );
        await pull();
      } else {
        toast.error((r as { msg?: string }).msg || t("fail"));
      }
    } finally {
      setSpin(false);
    }
  };
  const restartX = async () => {
    setSpin(true);
    const r = await postJson(panel("api/server/restartXrayService"));
    setSpin(false);
    if (r.success) toast.success(t("success"));
  };
  const openVer = async () => {
    setSpin(true);
    try {
      const [xr, tm] = await Promise.all([
        getJson<string[]>(panel("api/server/getXrayVersion")),
        getJson<string[]>(panel("api/server/getTelemtVersion")),
      ]);
      if (xr.success && xr.obj) setVerListXray(xr.obj);
      if (tm.success && tm.obj) setVerListTelemt(tm.obj);
      setVerTab("xray");
      setVerOpen(true);
    } finally {
      setSpin(false);
    }
  };

  const runInstallVersion = async () => {
    if (!pendingVersion) return;
    setVersionInstalling(true);
    setSpin(true);
    try {
      if (pendingCore === "xray") {
        await postJson(panel(`api/server/installXray/${pendingVersion}`));
        if (multi && nodes.length) {
          const ids = nodes.map((n) => n.id);
          await postJson(
            panel(`api/server/installXrayOnNodes/${pendingVersion}`),
            { nodeIds: ids },
            true,
          );
        }
      } else {
        if (multi) {
          if (!nodes.length) {
            toast.error(t("pages.index.nodesCoresNoEnabled"));
            return;
          }
          const ids = nodes.map((n) => n.id);
          await postJson(
            panel(`api/server/installTelemtOnNodes/${pendingVersion}`),
            { nodeIds: ids },
            true,
          );
        } else {
          await postJson(panel(`api/server/installTelemt/${pendingVersion}`));
        }
      }
      toast.success(t("success"));
      await pull();
    } catch {
      toast.error(t("fail"));
    } finally {
      setSpin(false);
      setVersionInstalling(false);
      setPendingVersion(null);
      setVerOpen(false);
    }
  };

  const normalizeHistoryEntry = (raw: unknown): UnifiedLogEntry | null => {
    if (!raw || typeof raw !== "object") return null;
    const e = raw as Record<string, unknown>;
    const message = String(e.message ?? e.msg ?? "").trim();
    if (!message) return null;
    const srcRaw = String(e.source ?? "panel").toLowerCase();
    const source: UnifiedLogEntry["source"] =
      srcRaw === "xray" || srcRaw === "node" ? srcRaw : "panel";
    const ts = Number(e.ts ?? e.tsUnixMs ?? Date.now());
    return {
      source,
      channel: e.channel ? String(e.channel) : undefined,
      level: String(e.level ?? "info").toLowerCase(),
      message,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      nodeId: e.nodeId !== undefined ? (e.nodeId as string | number) : undefined,
      nodeName: e.nodeName ? String(e.nodeName) : undefined,
    };
  };

  const openLogs = async () => {
    setSpin(true);
    try {
      const r = await getJson<unknown[]>(panel("api/server/logs/unified/0"));
      if (r.success) {
        const rows = Array.isArray(r.obj)
          ? r.obj
              .map((x) => normalizeHistoryEntry(x))
              .filter((x): x is UnifiedLogEntry => Boolean(x))
              .sort((a, b) => b.ts - a.ts)
              .slice(0, MAX_LOG_ENTRIES)
          : [];
        setLogEntries(rows);
        setLogPaused(false);
        setLogsOpen(true);
      } else {
        toast.error(r.msg || t("fail"));
      }
    } catch {
      toast.error(t("fail"));
    } finally {
      setSpin(false);
    }
  };
  const openConfig = async () => {
    setSpin(true);
    const r = await getJson<unknown>(panel("api/server/getConfigJson"));
    setSpin(false);
    if (r.success) {
      setConfigText(JSON.stringify(r.obj, null, 2));
      setConfigOpen(true);
    }
  };
  const openCpu = () => {
    setCpuOpen(true);
  };
  const openMem = () => {
    setMemOpen(true);
  };
  const exportDb = () => {
    if (typeof window === "undefined") return;
    window.location.href = p("panel/api/server/getDb");
  };
  const importDb = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".sql";
    inp.onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const fd = new FormData();
      fd.append("db", f);
      setBackupOpen(false);
      setSpin(true);
      const u = await api.post<{ success: boolean; msg: string }>(panel("api/server/importDB"), fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSpin(false);
      if (u.data.success) {
        setSpin(true);
        await postJson(panel("setting/restartPanel"));
        setTimeout(() => window.location.reload(), 5000);
      } else {
        toast.error(u.data.msg);
      }
    };
    inp.click();
  };

  return (
    <PageScaffold>
      <PageHeader
        title={t("menu.dashboard")}
        accentTitle
        icon={LayoutDashboard}
        iconTone="accent"
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setCustomizeOpen(true)} className="!gap-2">
              <LayoutGrid size={16} />
              {t("pages.index.dashboardCustomize")}
            </Button>
            <SectionHelpModal scene="welcome" titleKey="pages.index.welcomeTitle" paragraphKeys={["pages.index.welcomeText"]} />
          </>
        }
      />

      {spin && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--bg)]/40 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] px-8 py-6 shadow-2xl">
            <Spinner size={36} />
            <span className="text-sm text-[var(--fg-muted)]">{t("loading")}</span>
          </div>
        </div>
      )}

        {showSec && (
          <AlertBanner
            type="error"
            title={t("secAlertTitle")}
            onClose={() => {
              if (dontSec) {
                void setUiPref("hideSecAlert", "true");
              }
              setShowSec(false);
            }}
            description={
              <div>
                {t("secAlertSsl")}
                <div className="mt-3">
                  <CheckboxField
                    label={t("dontShowAgain")}
                    checked={dontSec}
                    onChange={(e) => setDontSec(e.target.checked)}
                  />
                </div>
              </div>
            }
            className="mb-4"
          />
        )}

        {showResources && (
        <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12" staggerChildren={0.06}>
          <StaggerItem className="lg:col-span-12">
            <Surface>
              <div className="mb-3 flex items-center justify-center gap-2.5">
                <IconTile icon={Activity} tone="accent" size="sm" />
                <p className="text-center text-xs font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                  {t("pages.index.systemLoad")} · {t("pages.index.resources")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-[var(--fg-muted)]">
                <button
                  type="button"
                  onClick={openCpu}
                  title={t("pages.index.cpuHistory")}
                  className="group rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/50 p-2.5 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                >
                  <LinearProgress percent={cpuP} strokeColor={metricColor(cpuP, accent)} />
                  <p className="mt-1.5 text-center text-xs">
                    <span className="text-[var(--fg)]">{t("pages.index.cpu")}</span>{" "}
                    {st.cpuCores} {t("pages.index.cores")} · {toFixed(cpuP, 0)}%
                  </p>
                  <div className="mt-2 opacity-90 transition group-hover:opacity-100">
                    <MultiResourceSparkline accent={accent} series={cpuPreviewSeries} />
                  </div>
                  {cpuPreviewLegend.length > 1 ? (
                    <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 px-1">
                      {cpuPreviewLegend.map((s) => (
                        <span
                          key={s.key}
                          className="inline-flex max-w-[9rem] items-center gap-1 text-[10px] text-[var(--fg-muted)]"
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.stroke }} />
                          <span className="truncate">{s.name}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={openMem}
                  title={t("pages.index.memoryHistory")}
                  className="group rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/50 p-2.5 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                >
                  <LinearProgress percent={memP} strokeColor={metricColor(memP, accent)} />
                  <p className="mt-1.5 text-center text-xs">
                    {t("pages.index.memory")} · {toFixed(memP, 0)}%
                  </p>
                  <p className="text-center text-[10px] opacity-80">
                    {sizeFormat(st.mem.current)} / {sizeFormat(st.mem.total)}
                  </p>
                  <div className="mt-1 opacity-90 transition group-hover:opacity-100">
                    <MultiResourceSparkline accent={ramSparkColor} series={memPreviewSeries} />
                  </div>
                  {memPreviewLegend.length > 1 ? (
                    <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 px-1">
                      {memPreviewLegend.map((s) => (
                        <span
                          key={s.key}
                          className="inline-flex max-w-[9rem] items-center gap-1 text-[10px] text-[var(--fg-muted)]"
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.stroke }} />
                          <span className="truncate">{s.name}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
                <div className="rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/50 p-2.5 text-left">
                  <LinearProgress percent={swP} strokeColor={metricColor(swP, accent)} />
                  <p className="mt-1.5 text-center text-xs">
                    {t("pages.index.swap")} · {toFixed(swP, 0)}%
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/50 p-2.5 text-left">
                  <LinearProgress percent={dskP} strokeColor={metricColor(dskP, accent)} />
                  <p className="mt-1.5 text-center text-xs">
                    {t("pages.index.storage")} · {toFixed(dskP, 0)}%
                  </p>
                </div>
              </div>
              {multi && nTot > 0 && (
                <div className="mt-3 border-t border-[var(--border)] pt-3 text-center text-sm text-[var(--fg-muted)]">
                  <LinearProgress
                    percent={nP}
                    strokeColor={metricColor(100 - nP, accent)}
                  />
                  <p className="mt-1">
                    {t("pages.index.nodesAvailability")} {nOn} / {nTot}
                  </p>
                </div>
              )}
              <div className="mt-3 border-t border-[var(--border)] pt-3 text-center text-xs text-[var(--fg-muted)]">
                <p className="font-medium text-[var(--fg-subtle)]">{t("pages.index.systemLoad")}</p>
                <p className="mt-1 font-mono text-[var(--fg)]">
                  {st.loads?.map((l) => toFixed(l, 2)).join(" · ")}
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--fg-subtle)]">{t("pages.index.systemLoadDesc")}</p>
              </div>
            </Surface>
          </StaggerItem>
        </Stagger>
        )}

        {(showQuickActions || showUptime) && (
        <Reveal className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {showQuickActions && (
          <Surface className="flex flex-col">
            <div className="flex items-center gap-2">
              <IconTile icon={History} tone="info" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.logs")}</h3>
            </div>
            <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
              {t("pages.index.logsCardSubtitle", { defaultValue: "Live panel, Xray & node logs" })}
            </p>
            <button
              type="button"
              onClick={openLogs}
              className="mt-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] py-2 text-center text-xs font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--surface-strong)]"
            >
              {t("pages.index.logs")}
            </button>
          </Surface>
          )}
          {showQuickActions && (
          <Surface className="flex flex-col">
            <div className="flex items-center gap-2">
              <IconTile icon={Wrench} tone="accent" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">
                {t("pages.index.coreVersionSwitch")}
              </h3>
            </div>
            <div className="mt-3 flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="text-xs text-[var(--fg-muted)]">Xray</span>
                <span className="flex items-center gap-1">
                  {installedXray?.mismatch ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-amber-400"
                      title={t("pages.index.coreVersionMismatch", {
                        defaultValue: "Nodes are not all on the same version — check Nodes",
                      })}
                    />
                  ) : null}
                  <span className="whitespace-nowrap rounded border border-[var(--border)] bg-[var(--surface-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent)]">
                    {installedXray?.version || "—"}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="text-xs text-[var(--fg-muted)]">{t("pages.index.telemtShort")}</span>
                <span className="flex items-center gap-1">
                  {installedTelemt?.mismatch ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-amber-400"
                      title={t("pages.index.coreVersionMismatch", {
                        defaultValue: "Nodes are not all on the same version — check Nodes",
                      })}
                    />
                  ) : null}
                  <span className="whitespace-nowrap rounded border border-[var(--border)] bg-[var(--surface-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-subtle)]">
                    {installedTelemt?.version || "—"}
                  </span>
                </span>
              </div>
            </div>
            {!multi ? (
              <div className="mt-2 flex justify-end gap-0 border-t border-[var(--border)]/80 pt-2">
                <IconButton
                  label={t("pages.index.stopTelemt")}
                  disabled={st.telemt?.state !== "running"}
                  onClick={stopTelemtLocal}
                >
                  <Power size={14} />
                </IconButton>
                <IconButton label={t("pages.index.stopXray")} onClick={stopX}>
                  <Power size={14} />
                </IconButton>
                <IconButton label={t("pages.index.restartXray")} onClick={restartX}>
                  <RefreshCw size={14} />
                </IconButton>
              </div>
            ) : null}
            <button
              type="button"
              onClick={openVer}
              className="mt-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] py-2 text-center text-xs font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--surface-strong)]"
            >
              {t("pages.index.coreVersionSwitch")}
            </button>
          </Surface>
          )}
          {showQuickActions && (
          <Surface className="flex flex-col">
            <div className="flex items-center gap-2">
              <IconTile icon={Server} tone="success" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.backup")}</h3>
            </div>
            <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
              {t("pages.index.backupCardSubtitle", {
                defaultValue: "Download or restore the database",
              })}
            </p>
            <div className="mt-3 flex-1 space-y-2">
              <button
                type="button"
                onClick={exportDb}
                className="group flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 transition-colors hover:border-[var(--accent)]/50"
              >
                <span className="text-[11px] font-medium text-[var(--fg-muted)] group-hover:text-[var(--fg)]">
                  {t("pages.index.exportDatabase")}
                </span>
                <Download size={14} className="shrink-0 text-[var(--fg-subtle)]" />
              </button>
              <button
                type="button"
                onClick={importDb}
                className="group flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 transition-colors hover:border-[var(--accent)]/50"
              >
                <span className="text-[11px] font-medium text-[var(--fg-muted)] group-hover:text-[var(--fg)]">
                  {t("pages.index.importDatabase")}
                </span>
                <CloudUpload size={14} className="shrink-0 text-[var(--fg-subtle)]" />
              </button>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={openConfig}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)] hover:underline"
              >
                <SlidersHorizontal size={12} />
                {t("pages.index.config")}
              </button>
            </div>
          </Surface>
          )}
          {showUptime && (
          <Surface>
            <div className="mb-2 flex items-center gap-2">
              <IconTile icon={Clock} tone="warning" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.operationHours")}</h3>
            </div>
            <div className="flex flex-col gap-2">
              <PillTag tone="blue">
                {t("pages.index.panelUptimeLabel")}: {formatSecond(st.panelUptime ?? 0)}
              </PillTag>
              <PillTag tone="blue">
                {t("pages.index.osLabel")}: {formatSecond(st.uptime)}
              </PillTag>
              {!multi && (
                <PillTag tone="green">
                  {t("pages.index.xrayUptimeLabel")}: {formatSecond(st.appStats?.uptime || 0)}
                </PillTag>
              )}
              {multi && nx && nx.total > 0 && (
                <PillTag tone="green">
                  {t("pages.index.nodesCoresRunningPill", { running: nx.running, total: nx.total })}
                </PillTag>
              )}
            </div>
          </Surface>
          )}
        </Reveal>
        )}

        {showUsersOnline && (
        <Reveal className="mt-4">
          <Surface>
            <div className="mb-2 flex items-center gap-2">
              <IconTile icon={Users} tone="success" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.usersOnline")}</h3>
            </div>
            <p className="mb-3 text-xs text-[var(--fg-muted)]">{t("pages.index.usersOnlineHint")}</p>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <StatBlock
                title={t("pages.index.usersOnline")}
                value={<CountNumber value={st.usersOnline ?? 0} />}
                prefix={<Users size={16} className="text-emerald-400/90" />}
              />
              <Link
                href={linkP("panel/clients/statistics")}
                className="shrink-0 text-xs font-medium text-[var(--accent)] hover:underline"
              >
                {t("pages.index.openClientStats")} →
              </Link>
            </div>
          </Surface>
        </Reveal>
        )}

        {showUserAgent && (
        <Reveal className="mt-4">
          <Surface>
            <div className="mb-2 flex items-center gap-2">
              <IconTile icon={Users} tone="info" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">
                {t("pages.clients.hwidUserAgentShareTitle", {
                  defaultValue: "User-Agent distribution by HWID",
                })}
              </h3>
            </div>
            <p className="mb-3 text-xs text-[var(--fg-muted)]">
              {t("pages.index.hwidUserAgentDashboardHint", {
                defaultValue: "Overall share of registered devices across all clients.",
              })}
            </p>
            {dashboardHwidUserAgentPie.parts.length === 0 ? (
              <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[auto,1fr] sm:items-start">
                <div className="mx-auto w-fit">
                  <div
                    className="relative h-40 w-40 rounded-full border border-[var(--border)]"
                    style={{ background: dashboardHwidUserAgentPie.gradient }}
                    aria-label={t("pages.clients.hwidUserAgentShareTitle", {
                      defaultValue: "User-Agent distribution by HWID",
                    })}
                  >
                    <div className="absolute inset-[22%] rounded-full bg-[var(--bg-elevated)]" />
                  </div>
                </div>
                <div className="max-h-48 space-y-2 overflow-auto pr-1">
                  {dashboardHwidUserAgentPie.parts.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate font-mono text-[var(--fg-muted)]">
                          {item.label}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-[var(--fg)]">
                        {item.percentLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Surface>
        </Reveal>
        )}

        {showDatabase && (
        <Reveal className="mt-4">
          <Surface>
            <div className="mb-3 flex items-center gap-2">
              <IconTile icon={Database} tone="neutral" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.database")}</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatBlock title={t("pages.index.dbSize")} value={sizeFormat(st.database?.size ?? 0)} />
              <StatBlock title={t("pages.index.dbTables")} value={String(st.database?.tables ?? 0)} />
              <StatBlock title={t("pages.index.dbRows")} value={String(st.database?.totalRows ?? 0)} />
              <StatBlock
                title={t("pages.index.dbConnections")}
                value={`${st.database?.openConns ?? 0} / ${st.database?.maxOpenConns ?? 0}`}
              />
            </div>
          </Surface>
        </Reveal>
        )}

        {showPanelRuntime && (
        <Reveal className="mt-4">
          <Surface>
            <div className="mb-3 flex items-center gap-2">
              <IconTile icon={Cpu} tone="info" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.panelProcessTitle")}</h3>
            </div>
            <p className="mb-3 text-xs text-[var(--fg-muted)]">{t("pages.index.panelProcessDesc")}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBlock
                title={t("pages.index.logicalProcessors")}
                value={String(st.logicalPro ?? st.cpuCores ?? "—")}
              />
              <StatBlock title={t("pages.index.frequency")} value={cpuGhz} />
              <StatBlock
                title={t("pages.index.threads")}
                value={String(st.appStats?.threads ?? "—")}
              />
              <StatBlock
                title={t("pages.index.panelProcessHeap")}
                value={sizeFormat(st.appStats?.mem ?? 0)}
              />
            </div>
          </Surface>
        </Reveal>
        )}

        {showNetwork && (
        <Reveal className="mt-4">
          <Surface>
            <div className="mb-4 flex items-center gap-2">
              <IconTile icon={Network} tone="info" size="sm" />
              <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.networkGroupTitle")}</h3>
            </div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
              {t("pages.index.netCurrentRates")}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Surface
                padding="sm"
                className="group relative overflow-hidden border-[var(--border)]/80 bg-gradient-to-b from-[var(--bg-elevated)]/95 via-[var(--surface)]/60 to-[var(--bg)]/50 shadow-sm transition duration-200 hover:shadow-md hover:ring-1 hover:ring-[var(--accent)]/25"
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-emerald-500/25 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100"
                  aria-hidden
                />
                <div className="relative">
                  <StatBlock
                    title={t("pages.index.upload")}
                    value={<CountSize value={st.netIO.up} />}
                    prefix={<ArrowUp size={16} className="text-emerald-400/90" />}
                    suffix="/s"
                  />
                </div>
                <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/35">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500/80 to-[var(--accent)] transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.max(4, (st.netIO.up / trafficMax) * 100)}%` }}
                  />
                </div>
              </Surface>
              <Surface
                padding="sm"
                className="group relative overflow-hidden border-[var(--border)]/80 bg-gradient-to-b from-[var(--bg-elevated)]/95 via-[var(--surface)]/60 to-[var(--bg)]/50 shadow-sm transition duration-200 hover:shadow-md hover:ring-1 hover:ring-sky-400/30"
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-sky-500/25 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100"
                  aria-hidden
                />
                <div className="relative">
                  <StatBlock
                    title={t("pages.index.download")}
                    value={<CountSize value={st.netIO.down} />}
                    prefix={<ArrowDown size={16} className="text-sky-400/90" />}
                    suffix="/s"
                  />
                </div>
                <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/35">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500/80 to-cyan-400/70 transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.max(4, (st.netIO.down / trafficMax) * 100)}%` }}
                  />
                </div>
              </Surface>
            </div>
            <p className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
              {t("pages.index.netCumulativeTraffic")}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2">
              <Surface
                padding="sm"
                className="group relative overflow-hidden border-[var(--border)]/80 bg-gradient-to-b from-[var(--bg-elevated)]/95 via-[var(--surface)]/60 to-[var(--bg)]/50 shadow-sm transition duration-200 hover:shadow-md hover:ring-1 hover:ring-amber-400/25"
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-amber-500/20 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100"
                  aria-hidden
                />
                <div className="relative">
                  <StatBlock
                    title={t("pages.index.sent")}
                    value={<CountSize value={st.netTraffic.sent} />}
                    prefix={<CloudUpload size={16} className="text-amber-400/90" />}
                  />
                </div>
                <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/35">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500/75 to-orange-500/60 transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.max(4, (st.netTraffic.sent / trafficMax) * 100)}%` }}
                  />
                </div>
              </Surface>
              <Surface
                padding="sm"
                className="group relative overflow-hidden border-[var(--border)]/80 bg-gradient-to-b from-[var(--bg-elevated)]/95 via-[var(--surface)]/60 to-[var(--bg)]/50 shadow-sm transition duration-200 hover:shadow-md hover:ring-1 hover:ring-violet-400/25"
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-violet-500/20 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100"
                  aria-hidden
                />
                <div className="relative">
                  <StatBlock
                    title={t("pages.index.received")}
                    value={<CountSize value={st.netTraffic.recv} />}
                    prefix={<CloudDownload size={16} className="text-violet-400/90" />}
                  />
                </div>
                <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/35">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500/75 to-fuchsia-500/55 transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.max(4, (st.netTraffic.recv / trafficMax) * 100)}%` }}
                  />
                </div>
              </Surface>
            </div>
            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                {t("pages.index.netSocketsTitle")}
              </p>
              <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                <Surface padding="sm">
                  <StatBlock
                    title={t("pages.index.statTCP")}
                    value={<CountNumber value={st.tcpCount} />}
                    prefix={<ArrowLeftRight size={16} className="text-[var(--accent)]" />}
                  />
                </Surface>
                <Surface padding="sm">
                  <StatBlock
                    title={t("pages.index.statUDP")}
                    value={<CountNumber value={st.udpCount} />}
                    prefix={<ArrowLeftRight size={16} className="text-[var(--accent)]" />}
                  />
                </Surface>
              </div>
            </div>
            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IconTile icon={Globe} tone="info" size="sm" />
                  <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.ipAddresses")}</h3>
                </div>
                <IconButton
                  label={t("pages.index.toggleIpVisibility")}
                  onClick={() => setShowIp((v) => !v)}
                >
                  <Globe size={16} />
                </IconButton>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatBlock
                  title={t("pages.index.statIPv4")}
                  value={showIp ? st.publicIP?.ipv4 : "****"}
                />
                {ipv6Enabled ? (
                  <StatBlock
                    title={t("pages.index.statIPv6")}
                    value={showIp ? st.publicIP?.ipv6 : "****"}
                  />
                ) : null}
              </div>
            </div>
          </Surface>
        </Reveal>
        )}

      <Modal
        open={verOpen}
        onClose={() => setVerOpen(false)}
        title={t("pages.index.coreVersionSwitch")}
        width={640}
      >
        <div className="mb-4 flex gap-2 border-b border-[var(--border)] pb-3">
          <Button
            type="button"
            variant={verTab === "xray" ? "primary" : "secondary"}
            onClick={() => setVerTab("xray")}
          >
            {t("pages.index.versionTabXray")}
          </Button>
          <Button
            type="button"
            variant={verTab === "telemt" ? "primary" : "secondary"}
            onClick={() => setVerTab("telemt")}
          >
            {t("pages.index.versionTabTelemt")}
          </Button>
        </div>
        <p className="mb-3 text-xs text-[var(--fg-muted)]">
          {verTab === "xray"
            ? t("pages.index.xraySwitchClick")
            : t("pages.index.telemtSwitchClick")}
        </p>
        <CoreVersionCards
          key={verTab}
          versions={verTab === "xray" ? verListXray : verListTelemt}
          installed={verTab === "xray" ? installedXray?.version : installedTelemt?.version}
          onPick={(v) => {
            setPendingCore(verTab);
            setPendingVersion(v);
            setVerOpen(false);
          }}
        />
      </Modal>

      <Modal
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
        title={
          <span className="flex items-center gap-2">
            {t("pages.index.logs")}
            {logPaused ? (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                {t("pages.index.logPaused", { defaultValue: "Paused" })}
              </span>
            ) : (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                {t("pages.index.logLive", { defaultValue: "Live" })}
              </span>
            )}
            <span className="text-xs font-normal text-[var(--fg-muted)]">
              {filteredLogs.length}{logEntries.length !== filteredLogs.length ? `/${logEntries.length}` : ""}
            </span>
          </span>
        }
        width="95vw"
        dialogClassName="!max-h-[90vh]"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SelectNative
            className="w-32"
            value={logLevel}
            onChange={(e) => setLogLevel(e.target.value)}
            title={t("pages.index.logLevel", { defaultValue: "Level" })}
          >
            {["all", "debug", "info", "notice", "warning", "error"].map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </SelectNative>
          <SelectNative
            className="w-28"
            value={logSource}
            onChange={(e) => setLogSource(e.target.value)}
            title={t("pages.index.logSource", { defaultValue: "Source" })}
          >
            <option value="all">{t("all")}</option>
            <option value="panel">panel</option>
            <option value="xray">xray</option>
            <option value="node">node</option>
          </SelectNative>
          <Input
            className="min-w-[160px] flex-1"
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            placeholder={t("search")}
          />
          <Button
            variant={logAuto ? "primary" : "secondary"}
            className="!gap-1.5"
            onClick={() => setLogAuto((v) => !v)}
            title={t("pages.index.toggleAutoScroll", { defaultValue: "Auto-scroll" })}
          >
            <ArrowDown size={14} />
            {t("pages.index.toggleAutoScroll", { defaultValue: "Auto" })}
          </Button>
          <Button
            variant={logPaused ? "primary" : "secondary"}
            className="!gap-1.5"
            onClick={() => setLogPaused((v) => !v)}
            title={logPaused ? t("pages.index.logResume", { defaultValue: "Resume" }) : t("pages.index.logPause", { defaultValue: "Pause" })}
          >
            {logPaused ? <Play size={14} /> : <CircleStop size={14} />}
            {logPaused ? t("pages.index.logResume", { defaultValue: "Resume" }) : t("pages.index.logPause", { defaultValue: "Pause" })}
          </Button>
          <Button
            variant="secondary"
            className="!gap-1.5"
            onClick={() => setLogEntries([])}
            title={t("pages.index.logClear", { defaultValue: "Clear" })}
          >
            <Trash2 size={14} />
            {t("pages.index.logClear", { defaultValue: "Clear" })}
          </Button>
          <Button
            variant="secondary"
            className="!gap-1.5"
            onClick={() => {
              const ndjson = filteredLogs
                .slice()
                .reverse()
                .map((r) => JSON.stringify(r))
                .join("\n");
              const blob = new Blob([ndjson], { type: "application/x-ndjson" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `logs-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            title={t("pages.index.logExport", { defaultValue: "Export .ndjson" })}
          >
            <Download size={14} />
            {t("pages.index.logExport", { defaultValue: "Export" })}
          </Button>
          <Button variant="secondary" className="!gap-1.5" onClick={openLogs}>
            <RefreshCw size={14} />
            {t("refresh")}
          </Button>
        </div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
          <div className="grid shrink-0 grid-cols-[160px_84px_130px_1fr] gap-2 border-b border-[var(--border)] bg-[var(--surface)]/95 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)] backdrop-blur supports-[backdrop-filter]:bg-[var(--surface)]/80">
            <span>{t("pages.index.logTime", { defaultValue: "Time" })}</span>
            <span>{t("pages.index.logLevel", { defaultValue: "Level" })}</span>
            <span>{t("pages.index.logSource", { defaultValue: "Source" })}</span>
            <span>{t("pages.index.logMessage", { defaultValue: "Message" })}</span>
          </div>
          {filteredLogs.length === 0 ? (
            <p className="px-3 py-4 text-sm text-[var(--fg-subtle)]">
              {t("pages.index.noLogs", { defaultValue: "No logs" })}
            </p>
          ) : (
            <LogVirtualList
              logs={filteredLogs}
              levelBadgeClass={levelBadgeClass}
              listRef={listRef}
            />
          )}
        </div>
      </Modal>

      <Modal
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        title={t("pages.index.backupTitle")}
      >
        <ul className="list-none space-y-3">
          <li>
            <Button variant="primary" className="!gap-2" onClick={exportDb}>
              <CloudDownload size={16} />
              {t("pages.index.exportDatabase")}
            </Button>
          </li>
          <li>
            <Button variant="primary" className="!gap-2" onClick={importDb}>
              <Server size={16} />
              {t("pages.index.importDatabase")}
            </Button>
          </li>
        </ul>
      </Modal>

      <Modal open={configOpen} onClose={() => setConfigOpen(false)} title="config.json" width={800}>
        <pre className="max-h-[500px] overflow-auto text-xs text-[var(--fg-muted)]">{configText}</pre>
      </Modal>

      <Modal
        open={cpuOpen}
        onClose={() => {
          setCpuOpen(false);
          setCpuHoverT(null);
        }}
        title={t("pages.index.cpuHistory")}
        width={900}
      >
        <SelectNative
          className="mb-3 w-full sm:w-48"
          value={String(cpuBucket)}
          onChange={(e) => {
            setCpuBucket(Number(e.target.value));
            setCpuHoverT(null);
          }}
        >
          {[
            { value: 2, label: "2m" },
            { value: 30, label: "30m" },
            { value: 60, label: "1h" },
            { value: 120, label: "2h" },
            { value: 180, label: "3h" },
            { value: 300, label: "5h" },
          ].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectNative>
        {cpuChartSeries.length > 1 ? (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {cpuChartSeries.map((s) => (
              <span key={s.key} className="inline-flex max-w-[220px] items-center gap-2 text-[var(--fg-muted)]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.stroke }} />
                <span className="truncate font-medium text-[var(--fg)]">{s.name}</span>
              </span>
            ))}
          </div>
        ) : null}
        <MultiSeriesResourceChart
          series={cpuChartSeries}
          hoverT={cpuHoverT}
          onHoverT={setCpuHoverT}
          onLeave={() => setCpuHoverT(null)}
        />
      </Modal>

      <Modal
        open={memOpen}
        onClose={() => {
          setMemOpen(false);
          setMemHoverT(null);
        }}
        title={t("pages.index.memoryHistory")}
        width={900}
      >
        <SelectNative
          className="mb-3 w-full sm:w-48"
          value={String(memBucket)}
          onChange={(e) => {
            setMemBucket(Number(e.target.value));
            setMemHoverT(null);
          }}
        >
          {[
            { value: 2, label: "2m" },
            { value: 30, label: "30m" },
            { value: 60, label: "1h" },
            { value: 120, label: "2h" },
            { value: 180, label: "3h" },
            { value: 300, label: "5h" },
          ].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectNative>
        {memChartSeries.length > 1 ? (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {memChartSeries.map((s) => (
              <span key={s.key} className="inline-flex max-w-[220px] items-center gap-2 text-[var(--fg-muted)]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.stroke }} />
                <span className="truncate font-medium text-[var(--fg)]">{s.name}</span>
              </span>
            ))}
          </div>
        ) : null}
        <MultiSeriesResourceChart
          series={memChartSeries}
          hoverT={memHoverT}
          onHoverT={setMemHoverT}
          onLeave={() => setMemHoverT(null)}
        />
      </Modal>

      <Modal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        title={t("pages.index.dashboardCustomize")}
        width={480}
      >
        <p className="mb-4 text-sm leading-relaxed text-[var(--fg-muted)]">
          {t("pages.index.dashboardCustomizeDesc")}
        </p>
        <ul className="list-none space-y-3">
          {DASHBOARD_WIDGET_ORDER.map((id) => (
            <li key={id}>
              <CheckboxField
                id={`dash-widget-${id}`}
                label={t(DASHBOARD_WIDGET_I18N[id])}
                checked={enabledWidgets.includes(id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setEnabledWidgets((prev) => {
                      const next = new Set([...prev, id]);
                      return DASHBOARD_WIDGET_ORDER.filter((w) => next.has(w));
                    });
                  } else {
                    setEnabledWidgets((prev) => toggleDashboardWidget(id, new Set(prev)));
                  }
                }}
              />
            </li>
          ))}
        </ul>
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEnabledWidgets([...DASHBOARD_WIDGET_ORDER])}
          >
            {t("pages.index.dashboardResetLayout")}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingVersion != null}
        title={
          pendingCore === "telemt"
            ? t("pages.index.telemtSwitchVersionDialog")
            : t("pages.index.xraySwitchVersionDialog")
        }
        description={
          pendingVersion
            ? (pendingCore === "telemt"
                ? t("pages.index.telemtSwitchVersionDialogDesc")
                : t("pages.index.xraySwitchVersionDialogDesc")
              ).replace("#version#", pendingVersion)
            : undefined
        }
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        onCancel={() => setPendingVersion(null)}
        onConfirm={runInstallVersion}
        loading={versionInstalling}
      />
    </PageScaffold>
  );
}

