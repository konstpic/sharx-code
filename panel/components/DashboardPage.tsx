"use client";
import { useDashboardMetricsData } from '@/lib/useDashboardMetricsData';
import {DashboardBuilder} from '@/components/dashboard/GridBoard';
import {DashboardTile} from '@/components/dashboard/GridTile';
import {MetricContent,WidgetContent,isAtomVisible,type AtomEnv,type StatusData} from '@/components/dashboard/BuiltinAtoms';
import {atomDef} from '@/lib/dashboardLayout';
import {applyClassicPreset,applyV271Preset,insertBundle,panelDefaultSize,type TileBundle} from '@/lib/dashboardModel';
import {MY_PRESETS_LIMIT,addMyPreset,applyPresetStyle,makeMyPreset,myPresetBoard,presetBoard,replaceWithMyPreset,replaceWithPreset,resetBoardToPreset,type PresetCtx} from '@/lib/dashboardPresets';
import type {PresetSource} from '@/components/dashboard/presets/PresetGallery';
import {makeMyEntry,type MyEntry} from '@/lib/dashboardCatalog';
import {presetLayout,emptyLayout,defaultTile,layoutConstraints,parseWorkspace,saveActiveBoard,dashboardTemplate,type DashboardWorkspace,type DashboardLayout} from '@/lib/dashboardBuilder';

import {DashboardComposer,type PanelDraft} from '@/components/dashboard/DashboardComposer';
import {applyAppearanceToTiles,MY_STYLES_LIMIT} from '@/lib/dashboardStyle';
import {CustomContentPanel} from '@/components/dashboard/CustomContentPanel';
import {dashboardMetrics,type DashboardMetric,type MetricPoint} from '@/lib/dashboardMetrics';
import {autoArrange,removeAndFill,DEFAULT_DASHBOARD_PRESET,GRID_VERSION} from '@/lib/dashboardGrid';
import {
  CloudDownload,
  LayoutDashboard,
  LayoutGrid,
  Server,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson, api } from "@/lib/api";
import { toFixed } from "@/lib/format";
import { usePanelWebSocket } from "@/lib/panelWebSocket";
import { panel, p } from "@/lib/paths";
import { useCan } from "@/lib/rbac";
import { usePanelAccentColor } from "@/lib/panelTheme";
import { CoreVersionCards } from "@/components/dashboard/CoreVersionCards";
import { PageScaffold, PageHeader, SectionHelpModal } from "@/components/panel";
import {
  AlertBanner,
  Button,
  CheckboxField,
  ConfirmDialog,
  Modal,
  SelectNative,
  Spinner,
  useToast,
} from "@/components/ui";
import { EntityLogsModal } from "@/components/EntityLogsModal";
import {
  DASHBOARD_WIDGET_ORDER,
  parseDashboardWidgets,
} from "@/lib/dashboardLayout";
import { getUiPref, setUiPref } from "@/lib/uiPrefs";

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
  enable?:boolean; up?:number; down?:number; allTime?:number;
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
function parseResourceHistoryEnvelope(obj: unknown, metric: "cpu" | "mem" | "disk"): DashboardMetricSeries[] {
  if (Array.isArray(obj)) {
    const points: ResourceHistoryPoint[] = (obj as { t?: number; time?: number; cpu?: number; mem?: number; disk?:number }[]).map(
      (raw) => {
        const ts = Number(raw?.t ?? raw?.time ?? 0);
        const vRaw =
          Number(raw?.[metric] ?? (raw as { v?: number }).v);
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
        const raw = p as { t?: number; time?: number; cpu?: number; mem?: number; disk?:number; v?: number };
        const ts = Number(raw?.t ?? raw?.time ?? 0);
        const vRaw =
          Number(raw?.[metric] ?? raw?.v);
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

/** Node / balancer lists for the overview templates, taken from the per-entity metrics (`node:<id>:status`, `balancer:<id>:...`). */
function entityListsFromMetrics(metrics: DashboardMetric[]) {
  const pick = (prefix: string) => {
    const seen = new Map<number, string>();
    for (const m of metrics) {
      const hit = new RegExp("^" + prefix + ":(\\d+):").exec(m.id);
      if (hit && !seen.has(Number(hit[1]))) seen.set(Number(hit[1]), String(m.label ?? "").split(" · ")[0] || hit[1]);
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  };
  return { nodes: pick("node"), balancers: pick("balancer") };
}

export function DashboardPage() {
  const { t } = useTranslation();
  const canLogs = useCan("logs:read");
  const canXrayOperate = useCan("xray:operate");
  const canBackup = useCan("system:backup");
  const toast = useToast();
  const accent = usePanelAccentColor();
  const [loading, setLoading] = useState(true);
  const [spin, setSpin] = useState(false);
  const [st, setSt] = useState<StatusData | null>(null);
  const [showSec, setShowSec] = useState(false);
  const [dontSec, setDontSec] = useState(false);
  /** Server IP tile: shown by default; hiding is remembered per browser. */
  const [showIp, setShowIp] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("dashboardHideIp") === "1") setShowIp(false);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleIp = () =>
    setShowIp((v) => {
      try {
        window.localStorage.setItem("dashboardHideIp", v ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
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
  const [workspace,setWorkspace]=useState<DashboardWorkspace>(()=>parseWorkspace(null,[...DASHBOARD_WIDGET_ORDER]));
  const [panelDraft,setPanelDraft]=useState<PanelDraft|null>(null);
  const [resourceMetrics,setResourceMetrics]=useState<DashboardMetric[]>([]);
  const [clientMetrics,setClientMetrics]=useState<DashboardMetric[]>([]);
  const [samples,setSamples]=useState<Record<string,MetricPoint[]>>({});
  const [layout, setLayout] = useState<DashboardLayout>(()=>presetLayout(DEFAULT_DASHBOARD_PRESET));
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [layoutSaved, setLayoutSaved] = useState(true);
  const [dashboardHwidUserAgentStats, setDashboardHwidUserAgentStats] = useState<
    { label: string; count: number; percentRaw: number; percentLabel: string }[]
  >([]);

  const ws = usePanelWebSocket();

  useEffect(() => {
    if(!layoutReady) return;
    setLayoutSaved(false);
    const timer=setTimeout(()=>{void setUiPref("dashboardLayout",JSON.stringify(saveActiveBoard(workspace,layout))).then(setLayoutSaved)},500);
    return ()=>clearTimeout(timer);
  }, [layout,layoutReady,workspace]);

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
      setDashboardHwidUserAgentStats([]);setClientMetrics([]);
      return;
    }
    const group=t('pages.builder.groupClients');
    const observedAt=Date.now();
    setClientMetrics([{id:'clients.total',label:t('pages.builder.clientsTotal'),group,value:r.obj.length,unit:'count'},{id:'clients.enabled',label:t('pages.builder.clientsEnabled'),group,value:r.obj.filter(c=>c.enable).length,unit:'count'},{id:'clients.traffic',label:t('pages.builder.clientsTraffic'),group,value:r.obj.reduce((sum,c)=>sum+Number(c.up??0)+Number(c.down??0),0),unit:'bytes'},{id:'clients.allTime',label:t('pages.builder.clientsLifetime'),group,value:r.obj.reduce((sum,c)=>sum+Number(c.allTime??0),0),unit:'bytes'}].map(metric=>({...metric,unit:metric.unit as DashboardMetric['unit'],updatedAt:observedAt})));
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
        const storedLayout = await getUiPref("dashboardLayout");
        let enabled:string[]=parseDashboardWidgets(widgetsRaw);
        if(!storedLayout)enabled=[...new Set([...enabled,"telemt_dc"])];
        const restored=parseWorkspace(storedLayout,enabled);
        setWorkspace(restored);
        const active=restored.boards.find(b=>b.id===restored.activeId)!;
        setLayout(active.layout);
        setLayoutReady(true);
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
      const responses=await Promise.allSettled(['cpu','mem','disk'].map(metric=>getJson<unknown>(panel(`api/server/${metric}History/2`))));
      const metrics:DashboardMetric[]=[];
      responses.forEach((response,i)=>{
       if(response.status!=='fulfilled'||!response.value.success||!response.value.obj)return;
       const metric=(['cpu','mem','disk'] as const)[i];const series=parseResourceHistoryEnvelope(response.value.obj,metric);
       if(metric==='cpu')setCpuPreviewSeries(panelOnlySeries(series));if(metric==='mem')setMemPreviewSeries(panelOnlySeries(series));
       for(const row of series){const last=row.points[row.points.length-1];metrics.push({id:row.key==='panel'?metric==='cpu'?'cpu':metric+'.percent':`node.${row.nodeId??row.key}.${metric}`,label:row.key==='panel'?t(metric==='cpu'?'pages.index.cpu':metric==='mem'?'pages.index.memory':'pages.index.storage'):`${row.name} · ${t(metric==='cpu'?'pages.index.cpu':metric==='mem'?'pages.index.memory':'pages.index.storage')}`,group:t(row.key==='panel'?'pages.builder.groupResources':'pages.builder.groupNodes'),value:last?.value??null,unit:'percent',history:'server',max:100,points:row.points,updatedAt:last?.ts})}
      });setResourceMetrics(metrics);
    };
    void load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, [t]);

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
  const needsClientMetrics=layout.panels.some(panel=>panel.metrics.some(id=>id.startsWith('clients.')&&id!=='clients.online'));
  useEffect(()=>{if(!needsClientMetrics)return;void pullDashboardHwidUserAgentStats();const timer=window.setInterval(()=>void pullDashboardHwidUserAgentStats(),30000);return()=>window.clearInterval(timer)},[needsClientMetrics,pullDashboardHwidUserAgentStats]);
  useEffect(()=>{if(!st)return;const now=Date.now();setSamples(prev=>{
   const next={...prev};
   for(const m of dashboardMetrics(st,t))if(m.value!=null){const old=prev[m.id]??[];if(!old.length||now-old[old.length-1].ts>=5000)next[m.id]=[...old.slice(-119),{ts:now,value:m.value}]}
   for(const m of clientMetrics)if(m.value!=null&&m.updatedAt){const old=prev[m.id]??[];if(old.at(-1)?.ts!==m.updatedAt)next[m.id]=[...old.slice(-119),{ts:m.updatedAt,value:m.value}]}
   return next;
  })},[st,t,clientMetrics]);
  const baseMetrics=useMemo(()=>{
   if(!st)return [];
   const base:DashboardMetric[]=[...dashboardMetrics(st,t),...clientMetrics].map(m=>({...m,history:'session' as const,points:samples[m.id]??[],updatedAt:samples[m.id]?.at(-1)?.ts}));
   for(const m of resourceMetrics){const index=base.findIndex(x=>x.id===m.id);if(index>=0)base[index]={...base[index],points:m.points,history:m.history,updatedAt:m.updatedAt};else base.push(m)}return base;
  },[st,t,clientMetrics,samples,resourceMetrics]);
  const extraMetrics=useDashboardMetricsData(t,layout.panels.flatMap(p=>p.metrics),baseMetrics.map(m=>m.id));
  const metrics=useMemo(()=>[...baseMetrics,...extraMetrics],[baseMetrics,extraMetrics]);
  const selectBoard=(id:string)=>{const next=saveActiveBoard(workspace,layout);const board=next.boards.find(b=>b.id===id);if(!board)return;setWorkspace({...next,activeId:id});setLayout(board.layout)};
  const addBoard=(board:DashboardWorkspace['boards'][number])=>{if(workspace.boards.length>=12)return;const next=saveActiveBoard(workspace,layout);setWorkspace({...next,activeId:board.id,boards:[...next.boards,board]});setLayout(board.layout)};
  const newTileId=()=>'custom-'+crypto.randomUUID().slice(0,8);
  const savePanel=(draft:PanelDraft)=>{
   setLayout(l=>{
    if(!draft.isNew)return {...l,panels:l.panels.map(p=>p.id===draft.panel.id?draft.panel:p),tiles:{...l.tiles,[draft.panel.id]:draft.settings}};
    const size=panelDefaultSize(draft.panel,draft.settings);
    return insertBundle(l,{panels:[draft.panel],tiles:{[draft.panel.id]:draft.settings},rects:[{id:draft.panel.id,x:0,y:0,w:size.w,h:size.h}]},()=>draft.panel.id,layoutConstraints(l));
   });
   setPanelDraft(null);
  };
  const addBundle=(bundle:TileBundle)=>setLayout(l=>insertBundle(l,bundle,newTileId,layoutConstraints(l)));
  const saveMine=(entry:MyEntry|null)=>{if(entry)setWorkspace(w=>({...w,mine:[...(w.mine??[]),entry].slice(-50)}))};

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
              {t(layoutEditing?"pages.builder.done":"pages.index.dashboardCustomize")}
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

  const openLogs = () => setLogsOpen(true);
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

  const atomEnv: AtomEnv = {
    metrics,
    st,
    multi,
    ipv6Enabled,
    revealIp: showIp,
    toggleIp,
    can: { logs: canLogs, xrayOperate: canXrayOperate, backup: canBackup },
    installedXray,
    installedTelemt,
    cpuGhz,
    cpuSeries: cpuPreviewSeries,
    memSeries: memPreviewSeries,
    userAgents: dashboardHwidUserAgentPie.parts,
    act: { openLogs, openVersions: openVer, stopXray: stopX, restartXray: restartX, stopTelemt: stopTelemtLocal, exportDb, importDb, openConfig, openCpu, openMem },
  };
  /** Tiles that have something to show now (permissions, single / multi node mode); a hidden tile takes no slot. */
  const visiblePanels = layout.panels.filter((p) => p.kind !== "widget" || isAtomVisible(p.widget ?? "", atomEnv));
  const visibleIds = new Set(visiblePanels.map((p) => p.id));
  /** What the board presets are built from: live node / balancer lists, permissions, the translator. */
  const presetCtx: PresetCtx = { ...entityListsFromMetrics(extraMetrics), t, can: { logs: canLogs, backup: canBackup, xrayOperate: canXrayOperate } };
  /** Restore the default places and sizes of the tiles (default dashboard tiles as a hole-free block). */
  const activePreset = workspace.boards.find((b) => b.id === workspace.activeId)?.preset;
  const resetLayout = () =>
    setLayout((l) => {
      const cons = layoutConstraints(l);
      const panels = l.panels.filter((p) => visibleIds.has(p.id));
      return { ...l, gridVersion: GRID_VERSION, grid: resetBoardToPreset(activePreset, panels, l.tiles, l.grid ?? [], presetCtx, cons) };
    });
  /** "Classic view 2.6": the catalog tiles of this board become the classic v2.6 set, the user's own tiles stay below it. */
  const classicView = () => {
    setLayout((l) => applyClassicPreset(l, layoutConstraints));
    setWorkspace((w) => ({ ...w, boards: w.boards.map((b) => (b.id === w.activeId ? { ...b, preset: "classic" as const } : b)) }));
  };
  /** "View 2.7.1": the catalog tiles of this board become the v2.7.1 dashboard, the user's own tiles stay below it. */
  const v271View = () => {
    setLayout((l) => applyV271Preset(l, layoutConstraints));
    setWorkspace((w) => ({ ...w, boards: w.boards.map((b) => (b.id === w.activeId ? { ...b, preset: "v271" as const } : b)) }));
  };
  /** Gallery: a new board from a preset (registry or "Mine"). */
  const presetCreate = (src: PresetSource) =>
    addBoard(src.kind === "preset" ? presetBoard(src.entry, presetCtx, t(src.entry.nameKey), 'board-' + crypto.randomUUID()) : myPresetBoard(src.preset, presetCtx, 'board-' + crypto.randomUUID()));
  /** Gallery: the catalog / preset tiles of the current board become the preset; the user's own tiles stay below it. */
  const presetReplace = (src: PresetSource) => {
    setLayout((l) => (src.kind === "preset" ? replaceWithPreset(l, src.entry, presetCtx) : replaceWithMyPreset(l, src.preset, presetCtx)));
    setWorkspace((w) => ({ ...w, boards: w.boards.map((b) => { if (b.id !== w.activeId) return b; const { preset: _old, ...rest } = b; void _old; return src.kind === "preset" ? { ...rest, preset: src.entry.marker } : rest; }) }));
  };
  /** Save the board that is on screen as a preset of the user (per-node rows become templates). */
  const saveCurrentPreset = (name: string, desc: string): boolean => {
    const mp = makeMyPreset('mp-' + crypto.randomUUID().slice(0, 8), name, desc, { panels: visiblePanels, tiles: layout.tiles, grid: layout.grid ?? [] }, presetCtx);
    if (!mp || (workspace.myPresets?.length ?? 0) >= MY_PRESETS_LIMIT) return false;
    setWorkspace((w) => ({ ...w, myPresets: addMyPreset(w.myPresets ?? [], mp) }));
    return true;
  };
  /** Auto-arrange: same sizes, reading order, holes filled. */
  const arrangeLayout = () =>
    setLayout((l) => {
      const cons = layoutConstraints(l);
      return { ...l, gridVersion: GRID_VERSION, grid: autoArrange((l.grid ?? []).filter((i) => visibleIds.has(i.id)), cons) };
    });
  /** Remove a tile; neighbours in its row grow into the freed space so no hole is left. */
  const removeTile = (id: string) =>
    setLayout((l) => {
      const cons = layoutConstraints(l);
      return {
        ...l,
        panels: l.panels.filter((p) => p.id !== id),
        order: l.order.filter((p) => p !== id),
        tiles: Object.fromEntries(Object.entries(l.tiles).filter(([key]) => key !== id)),
        grid: removeAndFill((l.grid ?? []).filter((i) => visibleIds.has(i.id) || i.id === id), id, cons),
      };
    });
  const saveTileToMine = (id: string) => {
    const p = layout.panels.find((x) => x.id === id);
    if (!p) return;
    const def = atomDef(p.widget ?? p.preset ?? "");
    saveMine(makeMyEntry('my-' + crypto.randomUUID().slice(0, 8), p.title || (def ? t(def.title) : t('pages.builder.' + p.kind)), { panels: layout.panels, tiles: layout.tiles, grid: layout.grid ?? [] }, [id]));
    toast.success(t('pages.builder.savedToCatalog'));
  };
  const saveBoardToMine = (name: string) => {
    saveMine(makeMyEntry('my-' + crypto.randomUUID().slice(0, 8), name, { panels: visiblePanels, tiles: layout.tiles, grid: layout.grid ?? [] }));
    toast.success(t('pages.builder.savedToCatalog'));
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
            <Button type="button" variant="secondary" onClick={() => { if(layoutEditing) void setUiPref("dashboardLayout",JSON.stringify(saveActiveBoard(workspace,layout))).then(setLayoutSaved); setLayoutEditing(v=>!v); }} className="!gap-2">
              <LayoutGrid size={16} />
              {t(layoutEditing?"pages.builder.done":"pages.index.dashboardCustomize")}
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

        <DashboardComposer workspace={workspace} editing={layoutEditing} metrics={metrics} layout={layout} draft={panelDraft} onDraft={setPanelDraft} onSave={savePanel} onSwitch={selectBoard}
         onNew={()=>addBoard({id:'board-'+crypto.randomUUID(),name:t('pages.builder.newDashboard'),layout:emptyLayout(),enabled:[]})}
         onDuplicate={()=>addBoard({id:'board-'+crypto.randomUUID(),name:(workspace.boards.find(b=>b.id===workspace.activeId)?.name??'Dashboard')+' · '+t('pages.builder.copy'),layout:structuredClone(layout),enabled:[],...(activePreset?{preset:activePreset}:{})})}
         onRename={name=>setWorkspace(w=>({...w,boards:w.boards.map(b=>b.id===w.activeId?{...b,name}:b)}))}
         onRemove={()=>{if(workspace.boards.length<2)return;const remaining=workspace.boards.filter(b=>b.id!==workspace.activeId);setWorkspace({...workspace,boards:remaining,activeId:remaining[0].id});setLayout(remaining[0].layout)}}
         onReset={resetLayout} onClassic={classicView} onV271={v271View} onArrange={arrangeLayout} onTemplate={kind=>addBoard(dashboardTemplate(kind,t,entityListsFromMetrics(extraMetrics)))} saved={layoutSaved}
         env={atomEnv} mine={workspace.mine??[]} nodeLists={entityListsFromMetrics(extraMetrics)} onAdd={addBundle} onSaveBoard={saveBoardToMine} onDeleteMine={id=>setWorkspace(w=>({...w,mine:(w.mine??[]).filter(m=>m.id!==id)}))}
         myStyles={workspace.myStyles??[]} onMyStyles={list=>setWorkspace(w=>({...w,myStyles:list.slice(0,MY_STYLES_LIMIT)}))}
         onApplyStyle={(ids,style)=>setLayout(l=>({...l,tiles:applyAppearanceToTiles(l.tiles,style,ids??undefined)}))}
         presetCtx={presetCtx} myPresets={workspace.myPresets??[]} onMyPresets={list=>setWorkspace(w=>({...w,myPresets:list.slice(0,MY_PRESETS_LIMIT)}))}
         onPresetCreate={presetCreate} onPresetReplace={presetReplace} onPresetLook={entry=>setLayout(l=>applyPresetStyle(l,entry))} onSaveCurrentPreset={saveCurrentPreset}/>
        <DashboardBuilder layout={layout} setLayout={setLayout} editing={layoutEditing} hide={removeTile} onSaveTile={saveTileToMine}>
        {visiblePanels.map(custom=>{
          const selected=metrics.filter(m=>custom.metrics.includes(m.id));
          const settings=layout.tiles[custom.id]??defaultTile(custom.id);
          const def=atomDef(custom.widget??custom.preset??'');
          const label=custom.title||(def?t(def.title):selected[0]?.label)||t('pages.builder.'+custom.kind);
          return <DashboardTile key={custom.id} id={custom.id} label={label} classic={def?.group==='classic'} onEdit={()=>setPanelDraft({panel:structuredClone(custom),settings:{...settings},isNew:false})}>
            {custom.kind==='metric'?<MetricContent panel={custom} settings={settings} env={atomEnv}/>:custom.kind==='widget'&&custom.widget?<WidgetContent widget={custom.widget} env={atomEnv}/>:<CustomContentPanel panel={custom} metrics={selected}/>}
          </DashboardTile>})}
        </DashboardBuilder>

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

      <EntityLogsModal
        open={logsOpen}
        entityType="panel"
        entityId={0}
        title={t("pages.index.logs")}
        onClose={() => setLogsOpen(false)}
      />

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

