"use client";
import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartLegend, ChartTooltip, RingGauge, SemiGauge, Segments, Sparkline, StatusPill, Tank, TrendChip, loadColor } from "@/components/dashboard/viz";
import type { DashboardMetric } from "@/lib/dashboardMetrics";
import type { TileSettings } from "@/lib/dashboardBuilder";
/** Every look a metric tile can take. Order = order in the picker. */
export const METRIC_VIEWS = ["stat", "hero", "spark", "line", "area", "bar", "gauge", "semi", "radial", "donut", "progress", "segments", "tank", "split", "status", "table"] as const;
export type MetricView = (typeof METRIC_VIEWS)[number];
/** Looks that show one metric as a fraction of a range (so they need a min/max). */
export const RANGE_VIEWS: readonly string[] = ["gauge", "semi", "radial", "donut", "progress", "segments", "tank", "split", "status"];
export { formatMetric } from "@/lib/dashboardMetrics";
import { formatMetric } from "@/lib/dashboardMetrics";

const SERIES_COLORS = ["#22c55e", "#f59e0b", "#38bdf8", "#a78bfa"];

/** Relative change between the first and last sample of a metric (null without enough history). */
function trend(m: DashboardMetric): number | null {
  const pts = m.points ?? [];
  if (pts.length < 2) return null;
  const a = pts[0].value;
  const b = pts[pts.length - 1].value;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

export function CustomMetricPanel({ metrics, settings }: { metrics: DashboardMetric[]; settings: TileSettings }) {
  const { t } = useTranslation();
  const uid = useId().replace(/:/g, "");
  const color = settings.color ?? "var(--accent)";
  const view = settings.view === "default" ? "stat" : settings.view;
  if (!metrics.length)
    return <div className="grid h-full place-items-center text-sm text-[var(--fg-muted)]">{t("pages.builder.selectMetric")}</div>;

  if (view === "table")
    return (
      <div className="overflow-auto p-3">
        <div className="divide-y divide-[color-mix(in_oklab,var(--fg)_8%,transparent)] rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--bg-elevated)_60%,transparent)]">
          {metrics.map((m, i) => (
            <div key={m.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: i === 0 ? color : SERIES_COLORS[i % 4], boxShadow: `0 0 8px ${i === 0 ? color : SERIES_COLORS[i % 4]}` }} />
              <span className="min-w-0 flex-1 truncate text-[var(--fg-muted)]">{m.label}</span>
              <span className="font-mono font-medium tabular-nums text-[var(--fg)]">{formatMetric(m, settings.precision)}</span>
            </div>
          ))}
        </div>
      </div>
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
      return <div className="grid h-full place-items-center p-4 text-center text-xs text-[var(--fg-muted)]">{t("pages.builder.awaitSamples")}</div>;
    const colorOf = (i: number) => (i === 0 ? color : SERIES_COLORS[i % 4]);
    const axis = { tickLine: false, axisLine: false, tick: { fontSize: 10, fill: "var(--fg-subtle)" } } as const;
    const fmt = (v: number, key?: string) => formatMetric({ ...(metrics.find((m) => m.id === key) ?? metrics[0]), value: Number(v) }, settings.precision);
    const grid = <CartesianGrid vertical={false} stroke="color-mix(in oklab, var(--fg) 9%, transparent)" strokeDasharray="2 6" />;
    const xAxis = (
      <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} minTickGap={56} tickFormatter={(v) => new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })} {...axis} />
    );
    const yAxis = (
      <YAxis
        width={56}
        tickFormatter={(v) => formatMetric({ ...metrics[0], value: v }, 0)}
        domain={settings.fixedScale ? [settings.min ?? 0, settings.max ?? 100] : metrics[0].unit === "percent" ? [0, 100] : ["auto", "auto"]}
        {...axis}
      />
    );
    const tooltip = <Tooltip cursor={{ stroke: "color-mix(in oklab, var(--fg) 25%, transparent)", strokeDasharray: "3 4" }} content={<ChartTooltip format={(v: number, p: { dataKey?: string }) => fmt(v, p?.dataKey)} />} />;
    const margin = { top: 8, right: 8, bottom: 0, left: 0 };
    return (
      <div className="flex h-full min-h-0 flex-col p-3">
        <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--fg-subtle)]">
          <span className="rounded-full bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] px-2 py-0.5 text-[var(--accent)]">
            {t(metrics.every((m) => m.history === "server") ? "pages.builder.serverHistory" : "pages.builder.sessionHistory")}
          </span>
          <span>
            {new Date(data[0].t).toLocaleTimeString()} – {new Date(data[data.length - 1].t).toLocaleTimeString()}
          </span>
        </div>
        <div className="min-h-[100px] flex-1">
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
        <ChartLegend items={metrics.map((m, i) => ({ name: m.label, color: colorOf(i) }))} />
      </div>
    );
  }

  if (view === "hero" || view === "spark") {
    const m = metrics[0];
    const delta = trend(m);
    const pts = (m.points ?? []).map((p) => p.value);
    return view === "hero" ? (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--fg-subtle)]">{m.label}</p>
        <p className="bg-clip-text font-mono text-[clamp(34px,5vw,64px)] font-semibold leading-none tracking-tight tabular-nums text-transparent" style={{ backgroundImage: `linear-gradient(180deg, ${color}, color-mix(in oklab, ${color} 45%, var(--fg)))` }}>
          {formatMetric(m, settings.precision)}
        </p>
        {delta != null ? <TrendChip delta={delta} good={m.unit === "percent" || m.unit === "load" ? "down" : "up"} /> : null}
      </div>
    ) : (
      <div className="relative flex h-full min-h-[110px] flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]" title={m.label}>{m.label}</p>
          <p className="shrink-0 font-mono text-xl font-semibold tabular-nums" style={{ color }}>{formatMetric(m, settings.precision)}</p>
        </div>
        <div className="mt-2 min-h-[56px] flex-1">
          {pts.length > 1 ? <Sparkline points={pts} color={color} height={96} className="h-full" minSpan={m.unit === "percent" ? 20 : 0} /> : <p className="grid h-full place-items-center text-xs text-[var(--fg-muted)]">{t("pages.builder.awaitSamples")}</p>}
        </div>
      </div>
    );
  }

  if (RANGE_VIEWS.includes(view)) {
    const metric = metrics[0];
    const min = settings.min ?? 0;
    const max = (settings.max ?? metric.max ?? 100) > min ? (settings.max ?? metric.max ?? 100) : min + 1;
    const fraction = metric.value == null ? 0 : Math.max(0, Math.min(1, (metric.value - min) / (max - min)));
    const tone = settings.color ? color : loadColor(fraction * 100);
    const text = formatMetric(metric, settings.precision);
    if (view === "semi") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
          <SemiGauge value={fraction} max={1} width={220} stroke={16} color={tone} center={<span className={`font-mono font-semibold leading-none tabular-nums text-[var(--fg)] ${text.length > 9 ? "text-xl" : "text-3xl"}`}>{text}</span>} />
          <p className="max-w-full truncate text-[11px] uppercase tracking-wider text-[var(--fg-subtle)]" title={metric.label}>{metric.label}</p>
          <div className="flex w-[220px] justify-between font-mono text-[10px] text-[var(--fg-subtle)]">
            <span>{min}</span>
            <span>{max}</span>
          </div>
        </div>
      );
    }
    if (view === "segments") {
      return (
        <div className="flex h-full flex-col justify-center gap-3 p-4">
          <div className="flex items-end justify-between gap-3">
            <span className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]" title={metric.label}>{metric.label}</span>
            <strong className="font-mono text-2xl font-semibold tabular-nums leading-none" style={{ color: tone }}>{text}</strong>
          </div>
          <Segments fraction={fraction} color={settings.color ? color : undefined} />
        </div>
      );
    }
    if (view === "tank") {
      return (
        <div className="flex h-full items-center justify-center gap-5 p-4">
          <Tank fraction={fraction} color={tone} height={132} width={62} />
          <div className="min-w-0">
            <p className="font-mono text-3xl font-semibold leading-none tabular-nums" style={{ color: tone }}>{text}</p>
            <p className="mt-2 line-clamp-2 text-[11px] uppercase tracking-wider text-[var(--fg-subtle)]">{metric.label}</p>
            <p className="mt-2 font-mono text-[10px] text-[var(--fg-subtle)]">{min} – {max}</p>
          </div>
        </div>
      );
    }
    if (view === "split") {
      const total = metric.max ?? max;
      const used = metric.value ?? 0;
      const free = Math.max(0, total - used);
      const fmtRaw = (v: number) => formatMetric({ ...metric, value: v }, settings.precision);
      return (
        <div className="flex h-full flex-col justify-center gap-3 p-4">
          <div className="flex items-end justify-between gap-3">
            <span className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]" title={metric.label}>{metric.label}</span>
            <strong className="font-mono text-2xl font-semibold tabular-nums leading-none" style={{ color: tone }}>{Math.round(fraction * 100)}%</strong>
          </div>
          <div className="flex h-4 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_9%,transparent)]">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${fraction * 100}%`, background: `linear-gradient(90deg, ${tone}, color-mix(in oklab, ${tone} 55%, white))`, boxShadow: `0 0 14px -2px ${tone}` }} />
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-[var(--fg-muted)]"><span className="size-2 rounded-full" style={{ background: tone }} />{fmtRaw(used)}</span>
            <span className="inline-flex items-center gap-1.5 text-[var(--fg-muted)]"><span className="size-2 rounded-full bg-[color-mix(in_oklab,var(--fg)_25%,transparent)]" />{fmtRaw(free)}</span>
          </div>
        </div>
      );
    }
    if (view === "status") {
      const pct = fraction * 100;
      const state = metric.value == null ? "unknown" : pct >= 90 ? "crit" : pct >= 75 ? "warn" : "ok";
      const label = t(`pages.builder.status${state[0].toUpperCase()}${state.slice(1)}`, { defaultValue: { ok: "Normal", warn: "Attention", crit: "Critical", unknown: "No data" }[state] });
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="max-w-full truncate text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--fg-subtle)]" title={metric.label}>{metric.label}</p>
          <StatusPill state={state} label={label} />
          <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--fg)]">{text}</p>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        {view === "progress" ? (
          <div className="w-full">
            <div className="mb-3 flex items-end justify-between gap-3">
              <span className="text-xs text-[var(--fg-muted)]">{metric.label}</span>
              <strong className="font-mono text-3xl font-semibold leading-none tabular-nums" style={{ color: tone }}>
                {text}
              </strong>
            </div>
            <div className="h-3.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_9%,transparent)]">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${fraction * 100}%`, background: `linear-gradient(90deg, ${tone}, color-mix(in oklab, ${tone} 55%, white))`, boxShadow: `0 0 16px -2px ${tone}` }}
              />
            </div>
          </div>
        ) : (
          <RingGauge
            value={fraction}
            max={1}
            size={view === "gauge" ? 168 : 160}
            stroke={view === "donut" ? 20 : 12}
            sweep={view === "gauge" ? 270 : 360}
            color={tone}
            center={
              <span className={`font-mono font-semibold leading-none tabular-nums text-[var(--fg)] ${text.length > 9 ? "text-lg" : "text-3xl"}`}>{text}</span>
            }
            caption={<span className="line-clamp-2 max-w-[8rem] normal-case tracking-normal">{metric.label}</span>}
          />
        )}
        <div className="flex w-full justify-between font-mono text-[10px] text-[var(--fg-subtle)]">
          <span>{min}</span>
          <span>{max}</span>
        </div>
      </div>
    );
  }

  // stat: KPI cards with the live value, change since the first sample and a sparkline when there is history
  return (
    <div className="grid h-full content-center gap-3 p-4" style={{ gridTemplateColumns: `repeat(${Math.min(metrics.length, 3)},minmax(0,1fr))` }}>
      {metrics.map((m, i) => {
        const delta = trend(m);
        const c = i === 0 ? color : SERIES_COLORS[i % 4];
        return (
          <div key={m.id} className="dash-card min-w-0 rounded-2xl border border-[var(--border)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]" title={m.label}>
                {m.label}
              </p>
              {delta != null ? <TrendChip delta={delta} good={m.unit === "percent" || m.unit === "load" ? "down" : "up"} /> : null}
            </div>
            <p className="mt-2 break-words font-mono text-[clamp(22px,2.6vw,38px)] font-semibold leading-none tracking-tight tabular-nums" style={{ color: c }}>
              {formatMetric(m, settings.precision)}
            </p>
            {m.points && m.points.length > 1 ? <Sparkline points={m.points.map((p) => p.value)} color={c} height={38} className="mt-3" minSpan={m.unit === "percent" ? 20 : 0} /> : null}
          </div>
        );
      })}
    </div>
  );
}
