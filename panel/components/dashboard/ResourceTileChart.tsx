"use client";
import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLegend, ChartTooltip } from "@/components/dashboard/viz";
import { useTileBox } from "@/components/dashboard/useTileBox";

const PALETTE = ["#22c55e", "#f59e0b", "#38bdf8", "#a78bfa", "#f472b6"];

/** History chart for the resource tiles: gradient fills, quiet grid, glass tooltip. */
export function ResourceTileChart({
  series,
  kind = "line",
}: {
  kind?: "line" | "area" | "bar";
  series: {
    key: string;
    name: string;
    stroke?: string;
    points: { ts: number; value: number }[];
  }[];
}) {
  const uid = useId().replace(/:/g, "");
  const { width, height } = useTileBox();
  // Small tiles: no time axis / legend, narrower value axis (nothing may be squeezed or clipped).
  const small = (height > 0 && height < 190) || (width > 0 && width < 260);
  const points = new Map<number, Record<string, number>>();
  for (const s of series)
    for (const p of s.points) {
      const row = points.get(p.ts) ?? { t: p.ts };
      row[s.key] = p.value;
      points.set(p.ts, row);
    }
  const data = [...points.values()].sort((a, b) => a.t - b.t);
  const colorOf = (s: (typeof series)[number], i: number) => s.stroke ?? PALETTE[i % PALETTE.length];
  const axis = {
    stroke: "transparent",
    tickLine: false,
    axisLine: false,
    tick: { fontSize: 10, fill: "var(--fg-subtle)" },
  } as const;
  const common = (
    <>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={s.key} id={`${uid}${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorOf(s, i)} stopOpacity={kind === "area" ? 0.5 : 0.28} />
            <stop offset="100%" stopColor={colorOf(s, i)} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      <CartesianGrid vertical={false} stroke="color-mix(in oklab, var(--fg) 9%, transparent)" strokeDasharray="2 6" />
      {small ? (
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
      ) : (
        <XAxis
          dataKey="t"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(n) => new Date(n).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          minTickGap={48}
          {...axis}
        />
      )}
      <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(n) => `${n}%`} width={small ? 32 : 38} {...axis} />
      <Tooltip cursor={{ stroke: "color-mix(in oklab, var(--fg) 25%, transparent)", strokeDasharray: "3 4" }} content={<ChartTooltip format={(v: number) => `${Number(v).toFixed(1)}%`} />} />
    </>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" role="img" aria-label="Resource history">
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
              {common}
              {series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.name} fill={colorOf(s, i)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
              {common}
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={colorOf(s, i)}
                  strokeWidth={2}
                  fill={`url(#${uid}${s.key})`}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
        </div>
      </div>
      {small ? null : <ChartLegend items={series.map((s, i) => ({ name: s.name, color: colorOf(s, i) }))} />}
    </div>
  );
}
