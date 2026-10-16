"use client";
import { useId, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartLegend, ChartTooltip, SemiGauge, Segments, StatusPill, Tank, TrendChip, loadColor } from "@/components/dashboard/viz";
import { AtomFrame, FitGauge, FitSpark, FitText, Hint, TileHeader, useRoom } from "@/components/dashboard/AtomParts";
import { useElementBox } from "@/components/dashboard/useTileBox";
import { metricLevel, type DashboardMetric } from "@/lib/dashboardMetrics";
import type { TileSettings } from "@/lib/dashboardBuilder";
/** Every look a metric tile can take. Order = order in the picker. */
export const METRIC_VIEWS = ["stat", "hero", "spark", "line", "area", "bar", "gauge", "semi", "radial", "donut", "progress", "segments", "tank", "split", "status", "table"] as const;
export type MetricView = (typeof METRIC_VIEWS)[number];
/** Looks that show one metric as a fraction of a range (so they need a min/max). */
export const RANGE_VIEWS: readonly string[] = ["gauge", "semi", "radial", "donut", "progress", "segments", "tank", "split", "status"];
export { formatMetric } from "@/lib/dashboardMetrics";
import { formatMetric } from "@/lib/dashboardMetrics";

const SERIES_COLORS = ["#22c55e", "#f59e0b", "#38bdf8", "#a78bfa"];
const WARN = "#f59e0b";
const CRIT = "#ef4444";

/** Relative change between the first and last sample of a metric (null without enough history). */
function trend(m: DashboardMetric): number | null {
  const pts = m.points ?? [];
  if (pts.length < 2) return null;
  const a = pts[0].value;
  const b = pts[pts.length - 1].value;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

/** Colour of a value: the metric's thresholds win (warn / crit), otherwise the tile colour. */
function levelColor(m: DashboardMetric, base: string): string {
  const lv = metricLevel(m);
  return lv === "crit" ? CRIT : lv === "warn" ? WARN : base;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-0 flex-1 place-items-center p-2 text-center text-xs text-[var(--fg-muted)]">{children}</div>;
}

/** Thin horizontal bar whose thickness follows the tile. */
function Bar2({ fraction, tone }: { fraction: number; tone: string }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_9%,transparent)]" style={{ height: "clamp(6px, 9cqh, 22px)" }}>
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${fraction * 100}%`, background: `linear-gradient(90deg, ${tone}, color-mix(in oklab, ${tone} 55%, white))`, boxShadow: `0 0 14px -2px ${tone}` }}
      />
    </div>
  );
}

/** Half ring scaled to the free box. */
function FitSemi({ fraction, text, tone }: { fraction: number; text: string; tone: string }) {
  const { ref, width, height } = useElementBox();
  const w = Math.max(0, Math.floor(Math.min(width, (height - 4) * 2)));
  return (
    <div ref={ref} style={{ flex: "3 1 0%" }} className="flex min-h-0 min-w-0 items-end justify-center overflow-hidden">
      {w >= 56 ? (
        <SemiGauge
          value={fraction}
          max={1}
          width={w}
          stroke={Math.max(6, Math.round(w * 0.09))}
          color={tone}
          center={
            <span className="font-semibold leading-none tabular-nums text-[var(--fg)]" style={{ fontSize: Math.max(10, Math.min(w * 0.2, (w * 0.6) / (Math.max(1, text.length) * 0.6))) }}>
              {text}
            </span>
          }
        />
      ) : null}
    </div>
  );
}

/** Vertical tank next to the value. */
function FitTank({ fraction, tone, text, min, max }: { fraction: number; tone: string; text: string; min: number; max: number }) {
  const { ref, width, height } = useElementBox();
  const th = Math.max(0, Math.floor(height));
  const tw = Math.max(18, Math.min(Math.round(th * 0.45), Math.floor(width * 0.4)));
  return (
    <div ref={ref} style={{ flex: "1 1 0%" }} className="flex min-h-0 min-w-0 items-center justify-center gap-[4cqmin] overflow-hidden">
      {th >= 40 ? <Tank fraction={fraction} color={tone} height={th} width={tw} /> : null}
      <div className="min-w-0">
        <p className="truncate font-semibold leading-none tabular-nums" style={{ color: tone, fontSize: Math.max(12, Math.min(th * 0.3, (width - tw) / (Math.max(1, text.length) * 0.65))) }}>
          {text}
        </p>
        <p className="mt-1 truncate font-mono text-[10px] text-[var(--fg-subtle)]">
          {min} – {max}
        </p>
      </div>
    </div>
  );
}

/**
 * Renders one or more dashboard metrics in the look chosen in the tile settings. Everything scales with the
 * tile (see useTileBox.ts): the value is fitted to its box, rings / bars follow the free space, secondary
 * info (change chip, sparkline, detail, min/max) appears only when there is room for it.
 * `detail` is an optional secondary line, e.g. "2.1 GB / 3.8 GB" or "5 / 20 connections".
 */
export function CustomMetricPanel({ metrics: rawMetrics, settings, detail, icon }: { metrics: DashboardMetric[]; settings: TileSettings; detail?: string; icon?: ReactNode }) {
  const { t } = useTranslation();
  // Tile-level warn / crit levels override the thresholds of the metric.
  const metrics = rawMetrics.map((m) => (settings.warn !== undefined && settings.crit !== undefined ? { ...m, thresholds: { warn: settings.warn, crit: settings.crit, invert: m.thresholds?.invert } } : m));
  const uid = useId().replace(/:/g, "");
  const room = useRoom();
  const color = settings.color ?? "var(--accent)";
  const view = settings.view === "default" ? "stat" : settings.view;
  const head = <TileHeader icon={icon} color={color} />;
  if (!metrics.length)
    return (
      <AtomFrame>
        {head}
        <Centered>{t("pages.builder.selectMetric")}</Centered>
      </AtomFrame>
    );

  if (view === "table")
    return (
      <AtomFrame>
        {head}
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--bg-elevated)_60%,transparent)]">
          <div className="divide-y divide-[color-mix(in_oklab,var(--fg)_8%,transparent)]">
            {metrics.map((m, i) => (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="size-2 shrink-0 rounded-full" style={{ background: i === 0 ? color : SERIES_COLORS[i % 4], boxShadow: `0 0 8px ${i === 0 ? color : SERIES_COLORS[i % 4]}` }} />
                <span className="min-w-0 flex-1 truncate text-[var(--fg-muted)]">{m.label}</span>
                <span className="font-mono font-medium tabular-nums" style={{ color: levelColor(m, "var(--fg)") }}>
                  {formatMetric(m, settings.precision)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </AtomFrame>
    );

  if (["line", "area", "bar"].includes(view)) {
    const points = new Map<number, Record<string, number>>();
    for (const m of metrics)
      for (const p of m.points ?? []) {
        const row = points.get(p.ts) ?? { t: p.ts };
        row[m.id] = p.value;
        points.set(p.ts, row);
      }
    const data = [...points.values()].sort((a, b) => a.t - b.t);
    if (data.length < 2)
      return (
        <AtomFrame>
          {head}
          <Centered>{t("pages.builder.awaitSamples")}</Centered>
        </AtomFrame>
      );
    const compactChart = room.height < 210 || room.width < 260;
    const colorOf = (i: number) => (i === 0 ? color : SERIES_COLORS[i % 4]);
    const axis = { tickLine: false, axisLine: false, tick: { fontSize: 10, fill: "var(--fg-subtle)" } } as const;
    const fmt = (v: number, key?: string) => formatMetric({ ...(metrics.find((m) => m.id === key) ?? metrics[0]), value: Number(v) }, settings.precision);
    const grid = <CartesianGrid vertical={false} stroke="color-mix(in oklab, var(--fg) 9%, transparent)" strokeDasharray="2 6" />;
    const xAxis = compactChart ? (
      <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
    ) : (
      <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} minTickGap={56} tickFormatter={(v) => new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })} {...axis} />
    );
    const yAxis = (
      <YAxis
        width={room.width < 260 ? 40 : 56}
        tickFormatter={(v) => formatMetric({ ...metrics[0], value: v }, 0)}
        domain={settings.fixedScale ? [settings.min ?? 0, settings.max ?? 100] : metrics[0].unit === "percent" ? [0, 100] : ["auto", "auto"]}
        {...axis}
      />
    );
    const tooltip = <Tooltip cursor={{ stroke: "color-mix(in oklab, var(--fg) 25%, transparent)", strokeDasharray: "3 4" }} content={<ChartTooltip format={(v: number, p: { dataKey?: string }) => fmt(v, p?.dataKey)} />} />;
    const margin = { top: 6, right: 6, bottom: 0, left: 0 };
    return (
      <AtomFrame>
        {head}
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <ResponsiveContainer width="100%" height="100%">
              {view === "bar" ? (
                <BarChart data={data} margin={margin}>
                  {grid}
                  {xAxis}
                  {yAxis}
                  {tooltip}
                  {metrics.map((m, i) => (
                    <Bar key={m.id} dataKey={m.id} name={m.label} fill={colorOf(i)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  ))}
                </BarChart>
              ) : view === "area" ? (
                <AreaChart data={data} margin={margin}>
                  <defs>
                    {metrics.map((m, i) => (
                      <linearGradient key={m.id} id={`${uid}${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colorOf(i)} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={colorOf(i)} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  {grid}
                  {xAxis}
                  {yAxis}
                  {tooltip}
                  {metrics.map((m, i) => (
                    <Area key={m.id} type="monotone" dataKey={m.id} name={m.label} stroke={colorOf(i)} strokeWidth={2} fill={`url(#${uid}${i})`} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
                  ))}
                </AreaChart>
              ) : (
                <LineChart data={data} margin={margin}>
                  {grid}
                  {xAxis}
                  {yAxis}
                  {tooltip}
                  {metrics.map((m, i) => (
                    <Line key={m.id} type="monotone" dataKey={m.id} name={m.label} stroke={colorOf(i)} strokeWidth={2.2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
        {!compactChart ? <ChartLegend items={metrics.map((m, i) => ({ name: m.label, color: colorOf(i) }))} /> : null}
      </AtomFrame>
    );
  }

  if (RANGE_VIEWS.includes(view)) {
    const metric = metrics[0];
    const min = settings.min ?? 0;
    const max = (settings.max ?? metric.max ?? 100) > min ? (settings.max ?? metric.max ?? 100) : min + 1;
    const fraction = metric.value == null ? 0 : Math.max(0, Math.min(1, (metric.value - min) / (max - min)));
    const level = metricLevel(metric);
    const tone = level === "crit" ? CRIT : level === "warn" ? WARN : settings.color ? color : loadColor(fraction * 100);
    const text = formatMetric(metric, settings.precision);
    const sub = detail ? <Hint>{detail}</Hint> : null;
    const range = room.list ? (
      <div className="flex shrink-0 justify-between font-mono text-[10px] text-[var(--fg-subtle)]">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    ) : null;
    if (view === "semi")
      return (
        <AtomFrame>
          {head}
          <FitSemi fraction={fraction} text={text} tone={tone} />
          {room.hint ? sub : null}
          {range}
        </AtomFrame>
      );
    if (view === "segments")
      return (
        <AtomFrame>
          {head}
          <FitText text={text} color={tone} grow={2} />
          <Segments fraction={fraction} color={settings.color ? color : undefined} />
          {room.hint ? sub : null}
        </AtomFrame>
      );
    if (view === "tank")
      return (
        <AtomFrame>
          {head}
          <FitTank fraction={fraction} tone={tone} text={text} min={min} max={max} />
          {room.hint ? sub : null}
        </AtomFrame>
      );
    if (view === "split") {
      const total = metric.max ?? max;
      const used = metric.value ?? 0;
      const fmtRaw = (v: number) => formatMetric({ ...metric, value: v }, settings.precision);
      return (
        <AtomFrame>
          {head}
          <FitText text={`${Math.round(fraction * 100)}%`} color={tone} grow={2} />
          <Bar2 fraction={fraction} tone={tone} />
          {room.hint ? (
            <div className="flex shrink-0 justify-between gap-2 text-[11px] text-[var(--fg-muted)]">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ background: tone }} />
                <span className="truncate">{fmtRaw(used)}</span>
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full bg-[color-mix(in_oklab,var(--fg)_25%,transparent)]" />
                <span className="truncate">{fmtRaw(Math.max(0, total - used))}</span>
              </span>
            </div>
          ) : null}
        </AtomFrame>
      );
    }
    if (view === "status") {
      const pct = fraction * 100;
      const state = metric.value == null ? "unknown" : level === "crit" || pct >= 90 ? "crit" : level === "warn" || pct >= 75 ? "warn" : "ok";
      const label = t(`pages.builder.status${state[0].toUpperCase()}${state.slice(1)}`, { defaultValue: { ok: "Normal", warn: "Attention", crit: "Critical", unknown: "No data" }[state] });
      return (
        <AtomFrame>
          {head}
          <FitText text={text} grow={2} />
          <div className="flex shrink-0 justify-center">
            <StatusPill state={state} label={label} />
          </div>
        </AtomFrame>
      );
    }
    if (view === "progress")
      return (
        <AtomFrame>
          {head}
          <FitText text={text} color={tone} grow={2} align="start" />
          <Bar2 fraction={fraction} tone={tone} />
          {room.hint ? sub : null}
          {range}
        </AtomFrame>
      );
    // gauge (270 degree dial), radial and donut (full rings)
    return (
      <AtomFrame>
        {head}
        <FitGauge fraction={fraction} text={text} color={tone} sweep={view === "gauge" ? 270 : 360} strokeRatio={view === "donut" ? 0.17 : view === "gauge" ? 0.085 : 0.11} />
        {room.hint ? sub : null}
        {range}
      </AtomFrame>
    );
  }

  if (view === "hero" || view === "spark" || (view === "stat" && metrics.length === 1)) {
    const m = metrics[0];
    const delta = trend(m);
    const tone = levelColor(m, color);
    const pts = (m.points ?? []).map((p) => p.value);
    const chip = delta != null && room.hint ? <TrendChip delta={delta} good={m.unit === "percent" || m.unit === "load" ? "down" : "up"} /> : null;
    return (
      <AtomFrame>
        <TileHeader icon={icon} color={color} right={chip} />
        <FitText text={formatMetric(m, settings.precision)} color={tone} grow={2} gradient={view === "hero"} />
        {detail && room.hint && !(view !== "hero" && room.spark) ? <Hint>{detail}</Hint> : null}
        {view !== "hero" && room.spark ? <FitSpark points={pts} color={tone} grow={1} minSpan={m.unit === "percent" ? 20 : 0} smooth={m.unit === "speed" ? 7 : 3} /> : null}
      </AtomFrame>
    );
  }

  // stat with several metrics: cards in a grid that follows the width
  const cols = Math.max(1, Math.min(metrics.length, 3, Math.floor((room.width || 360) / 72) || 1));
  return (
    <AtomFrame>
      {head}
      <div className="grid min-h-0 flex-1 gap-[clamp(4px,2cqmin,10px)]" style={{ gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gridAutoRows: "minmax(0,1fr)" }}>
        {metrics.map((m, i) => {
          const c = levelColor(m, i === 0 ? color : SERIES_COLORS[i % 4]);
          return (
            <div key={m.id} className="dash-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] p-[clamp(4px,2cqmin,10px)]">
              <p className="shrink-0 truncate text-[10px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]" title={m.label}>
                {m.label}
              </p>
              <FitText text={formatMetric(m, settings.precision)} color={c} />
            </div>
          );
        })}
      </div>
    </AtomFrame>
  );
}
