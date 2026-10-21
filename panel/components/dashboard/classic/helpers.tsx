"use client";
/**
 * Helpers of the classic (v2.6) dashboard widgets, copied from the v2.6.0 DashboardPage:
 * metricColor, pct, the count-up numbers and the multi-series sparkline. `ClassicRoot` is the body of a classic tile:
 * the tile around it is the card (see `.dashboard-tile[data-classic]` in globals.css), the v2.6 `Surface` padding
 * stays, and the body scrolls inside the tile when the content is taller than the tile.
 */
import { useMemo, type ReactNode } from "react";
import { Reveal } from "@/components/ui";
import { sizeFormat, toFixed } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";

export function metricColor(percent: number, accent: string) {
  if (percent < 80) return accent;
  if (percent < 90) return "#f59e0b";
  return "#ef4444";
}

export function pct(cur: number, tot: number) {
  if (!tot) return 0;
  return Number(toFixed((cur / tot) * 100, 2));
}

export function CountSize({ value }: { value: number }) {
  const v = useCountUp(value, { duration: 700, decimals: 0 });
  return <>{sizeFormat(v)}</>;
}

export function CountNumber({ value }: { value: number }) {
  const v = useCountUp(value, { duration: 700, decimals: 0 });
  return <>{Math.round(v)}</>;
}

/** The colour of the RAM sparkline / legend in v2.6. */
export const RAM_SPARK_COLOR = "#a78bfa";

const SPARK_W = 200;
const SPARK_H = 36;

const RESOURCE_CHART_COLORS = ["#34d399", "#fbbf24", "#f472b6", "#818cf8", "#fb923c", "#2dd4bf", "#c084fc", "#f87171"];

export type ClassicSeries = { key: string; name: string; points: { ts: number; value: number }[] };

/** The panel-host history of the current page (points only) as the named series v2.6 drew. */
export function toClassicSeries(series: readonly { points: { ts: number; value: number }[] }[]): ClassicSeries[] {
  return series.map((s, i) => ({ key: i === 0 ? "panel" : "panel" + i, name: "Panel", points: s.points }));
}

export function paletteStrokeForSeries(s: { key: string }, accent: string, index: number) {
  if (s.key === "panel") return accent;
  return RESOURCE_CHART_COLORS[index % RESOURCE_CHART_COLORS.length];
}

/** Sparkline overlay: multiple metrics on one time scale (milliseconds). */
export function MultiResourceSparkline({
  accent,
  series,
}: {
  accent: string;
  series: ClassicSeries[];
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

/** Body of a classic tile: v2.6 card padding, fade-in, scrolls inside the tile when it is taller than the tile. */
export function ClassicRoot({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Reveal className={`classic-tile p-5 ${className}`}>{children}</Reveal>;
}
