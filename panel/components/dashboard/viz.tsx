"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useId, type ReactNode } from "react";

/** Colour for a utilisation percentage: accent while healthy, amber and red as it gets tight. */
export function loadColor(percent: number, accent = "var(--accent)") {
  if (percent < 75) return accent;
  if (percent < 90) return "#f59e0b";
  return "#ef4444";
}

export type SparkOptions = { curve?: "smooth" | "linear" | "step"; fill?: boolean; strokeWidth?: number; markers?: boolean };

/** Path through the points ('smooth' = monotone-ish bezier, the default look), plus the closed area path under it. */
function curve(points: number[], w: number, h: number, pad = 2, minSpan = 0, mode: "smooth" | "linear" | "step" = "smooth") {
  const n = points.length;
  if (n < 2) return { line: "", area: "", last: null as null | [number, number], dots: [] as [number, number][] };
  let lo = Math.min(...points);
  let hi = Math.max(...points);
  // A nearly flat series should look flat, not like a mountain range: keep a minimum visible range.
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const span = hi - lo || 1;
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - pad * 2);
  let d = `M${x(0).toFixed(2)},${y(points[0]).toFixed(2)}`;
  for (let i = 1; i < n; i++) {
    if (mode === "linear") d += ` L${x(i).toFixed(2)},${y(points[i]).toFixed(2)}`;
    else if (mode === "step") d += ` H${x(i).toFixed(2)} V${y(points[i]).toFixed(2)}`;
    else {
      const cx = (x(i - 1) + x(i)) / 2;
      d += ` C${cx.toFixed(2)},${y(points[i - 1]).toFixed(2)} ${cx.toFixed(2)},${y(points[i]).toFixed(2)} ${x(i).toFixed(2)},${y(points[i]).toFixed(2)}`;
    }
  }
  const area = `${d} L${w},${h} L0,${h} Z`;
  const stride = Math.max(1, Math.ceil(n / 40));
  const dots = points.map((v, i) => [x(i), y(v)] as [number, number]).filter((_, i) => i % stride === 0);
  return { line: d, area, last: [x(n - 1), y(points[n - 1])] as [number, number], dots };
}

/** Compact area sparkline with a gradient fill and a live end dot. */
export function Sparkline({
  points,
  color = "var(--accent)",
  height = 44,
  className = "",
  live = true,
  minSpan = 0,
  curve: mode = "smooth",
  fill = true,
  strokeWidth = 1.8,
  markers = false,
}: {
  points: number[];
  color?: string;
  height?: number;
  className?: string;
  live?: boolean;
  minSpan?: number;
} & SparkOptions) {
  const id = useId().replace(/:/g, "");
  const W = 200;
  const { line, area, last, dots } = curve(points, W, height, 2, minSpan, mode);
  if (!line) {
    // Not enough samples yet: a faint dashed baseline instead of an empty hole.
    return (
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className={`block w-full ${className}`} style={{ height }} aria-hidden>
        <line x1="0" y1={height * 0.65} x2={W} y2={height * 0.65} stroke={color} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className={`block w-full overflow-visible ${className}`} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? <path d={area} fill={`url(#g${id})`} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {markers
        ? dots.map(([cx, cy], i) => <path key={i} d={`M${cx.toFixed(2)},${cy.toFixed(2)}h0`} stroke={color} strokeWidth={strokeWidth + 3} strokeLinecap="round" vectorEffect="non-scaling-stroke" />)
        : null}
      {live && last ? (
        <g>
          <circle cx={last[0]} cy={last[1]} r="3.2" fill={color} opacity="0.25" className="dash-pulse" />
          <circle cx={last[0]} cy={last[1]} r="1.8" fill={color} />
        </g>
      ) : null}
    </svg>
  );
}

/** Radial gauge: gradient arc over a soft track, glow, centred value and caption. */
export function RingGauge({
  value,
  max = 100,
  size = 112,
  stroke = 10,
  color = "var(--accent)",
  center,
  caption,
  sweep = 270,
  roundCaps = true,
  ticks = false,
  track,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
  center?: ReactNode;
  caption?: ReactNode;
  /** 270 = speedometer dial, 360 = full ring; 180 / 240 are available through the tile style. */
  sweep?: number;
  roundCaps?: boolean;
  /** Tick marks (0 / 25 / 50 / 75 / 100 %) just inside the ring. */
  ticks?: boolean;
  /** Track colour override (tile style). */
  track?: string;
}) {
  const id = useId().replace(/:/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  // 270° dial with the opening at the bottom, so the value reads like a speedometer (or a full ring).
  const arc = c * (sweep / 360);
  const dash = arc * frac;
  const cap = roundCaps ? "round" : "butt";
  // The classic dials keep their CSS rotation; other arcs are rotated so the opening sits at the bottom.
  const classic = sweep === 270 || sweep === 360;
  const rot = sweep === 360 ? -90 : 90 + (360 - sweep) / 2;
  const tickAt = (f: number) => {
    const a = (f * sweep * Math.PI) / 180;
    const r1 = r - stroke / 2 - 2;
    const r2 = r1 - 4;
    return { x1: size / 2 + r1 * Math.cos(a), y1: size / 2 + r1 * Math.sin(a), x2: size / 2 + r2 * Math.cos(a), y2: size / 2 + r2 * Math.sin(a) };
  };
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={classic ? (sweep === 360 ? "-rotate-90" : "-rotate-[225deg]") : undefined} style={classic ? undefined : { transform: `rotate(${rot}deg)` }} aria-hidden>
        <defs>
          <linearGradient id={`rg${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={`color-mix(in oklab, ${color} 55%, white)`} />
          </linearGradient>
          <filter id={`gl${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track ?? "var(--tile-track, color-mix(in oklab, var(--fg) 9%, transparent))"} strokeWidth={stroke} strokeLinecap={cap} strokeDasharray={`${arc} ${c}`} />
        {ticks
          ? [0, 0.25, 0.5, 0.75, 1].filter((f) => sweep < 360 || f < 1).map((f) => <line key={f} {...tickAt(f)} stroke="var(--fg-subtle)" strokeWidth={1.5} strokeLinecap="round" />)
          : null}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#rg${id})`}
          strokeWidth={stroke}
          strokeLinecap={cap}
          strokeDasharray={`${dash} ${c}`}
          filter={`url(#gl${id})`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(.22,1,.36,1), stroke 0.4s" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {center}
        {caption ? <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--fg-subtle)]">{caption}</div> : null}
      </div>
    </div>
  );
}

/** Small up/down/flat change chip. */
export function TrendChip({ delta, suffix = "%", good = "down" }: { delta: number; suffix?: string; good?: "up" | "down" }) {
  const flat = Math.abs(delta) < 0.05;
  const up = delta > 0;
  const positive = flat ? null : good === "up" ? up : !up;
  const tone = flat ? "var(--fg-subtle)" : positive ? "#22c55e" : "#f59e0b";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums" style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}>
      <Icon size={11} strokeWidth={2.4} />
      {flat ? "0" : Math.abs(delta).toFixed(1)}
      {suffix}
    </span>
  );
}

/** Pulsing "live" dot with an optional label. */
export function LiveDot({ label, color = "#22c55e" }: { label?: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
      <span className="relative flex size-2">
        <span className="dash-ping absolute inline-flex size-full rounded-full opacity-60" style={{ background: color }} />
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
      </span>
      {label}
    </span>
  );
}

/** Segmented availability bar: one segment per item, filled by state. */
export function SegmentBar({ total, ok, warn = 0 }: { total: number; ok: number; warn?: number }) {
  const n = Math.max(1, Math.min(total, 24));
  return (
    <div className="flex gap-1" role="img" aria-label={`${ok}/${total}`}>
      {Array.from({ length: n }, (_, i) => {
        const state = i < ok ? "ok" : i < ok + warn ? "warn" : "down";
        const col = state === "ok" ? "#22c55e" : state === "warn" ? "#f59e0b" : "#ef4444";
        return <span key={i} className="h-2 flex-1 rounded-full" style={{ background: state === "ok" ? `linear-gradient(90deg, ${col}, color-mix(in oklab, ${col} 60%, white))` : col, opacity: state === "down" ? 0.55 : 1, boxShadow: state === "ok" ? `0 0 10px -2px ${col}` : "none" }} />;
      })}
    </div>
  );
}

/** Thin labelled meter (used for load averages and quotas). */
export function MiniMeter({ label, value, max, text, color = "var(--accent)" }: { label: string; value: number; max: number; text: string; color?: string }) {
  const f = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[10px] text-[var(--fg-subtle)]">
        <span>{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-[var(--fg)]">{text}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_9%,transparent)]">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${f * 100}%`, background: `linear-gradient(90deg, ${loadColor(f * 100, color)}, color-mix(in oklab, ${loadColor(f * 100, color)} 60%, white))` }} />
      </div>
    </div>
  );
}

/** Glass tooltip shared by the dashboard charts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ChartTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--bg-elevated)_90%,transparent)] px-3 py-2 text-xs shadow-2xl backdrop-blur-md">
      <div className="mb-1 text-[10px] text-[var(--fg-subtle)]">{new Date(Number(label)).toLocaleString()}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color ?? p.stroke }} />
          <span className="text-[var(--fg-muted)]">{p.name}</span>
          <span className="ml-auto pl-3 font-mono tabular-nums text-[var(--fg)]">{format ? format(p.value, p) : String(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Legend pills for multi-series charts. */
export function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
      {items.map((i) => (
        <span key={i.name} className="inline-flex max-w-[10rem] items-center gap-1.5 text-[10px] text-[var(--fg-muted)]">
          <span className="size-2 shrink-0 rounded-full" style={{ background: i.color, boxShadow: `0 0 8px ${i.color}` }} />
          <span className="truncate">{i.name}</span>
        </span>
      ))}
    </div>
  );
}

/** Half-ring gauge (180°): value in the centre, ends labelled by the caller. */
export function SemiGauge({ value, max = 100, width = 200, stroke = 14, color = "var(--accent)", center, roundCaps = true, track }: { value: number; max?: number; width?: number; stroke?: number; color?: string; center?: ReactNode; roundCaps?: boolean; track?: string }) {
  const id = useId().replace(/:/g, "");
  const r = (width - stroke) / 2;
  const c = Math.PI * r;
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const h = r + stroke / 2 + 2;
  const d = `M${stroke / 2},${r + stroke / 2} A${r},${r} 0 0 1 ${width - stroke / 2},${r + stroke / 2}`;
  return (
    <div className="relative" style={{ width, height: h }}>
      <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden className="overflow-visible">
        <defs>
          <linearGradient id={`sg${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={`color-mix(in oklab, ${color} 55%, white)`} />
          </linearGradient>
        </defs>
        <path d={d} fill="none" stroke={track ?? "var(--tile-track, color-mix(in oklab, var(--fg) 9%, transparent))"} strokeWidth={stroke} strokeLinecap={roundCaps ? "round" : "butt"} />
        <path
          d={d}
          fill="none"
          stroke={`url(#sg${id})`}
          strokeWidth={stroke}
          strokeLinecap={roundCaps ? "round" : "butt"}
          strokeDasharray={`${c * frac} ${c}`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(.22,1,.36,1)", filter: `drop-shadow(0 0 6px color-mix(in oklab, ${color} 55%, transparent))` }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">{center}</div>
    </div>
  );
}

/** LED-style segmented meter. */
export function Segments({ fraction, count = 20, color = "var(--accent)" }: { fraction: number; count?: number; color?: string }) {
  const on = Math.round(Math.max(0, Math.min(1, fraction)) * count);
  return (
    <div className="flex h-7 items-end gap-[3px]" role="img" aria-label={`${Math.round(fraction * 100)}%`}>
      {Array.from({ length: count }, (_, i) => {
        const lit = i < on;
        const col = loadColor((i / count) * 100, color);
        return <span key={i} className="flex-1 rounded-[3px] transition-all duration-500" style={{ height: `${40 + (i / count) * 60}%`, background: lit ? col : "var(--tile-track, color-mix(in oklab, var(--fg) 9%, transparent))", boxShadow: lit ? `0 0 8px -1px ${col}` : "none", opacity: lit ? 1 : 0.7 }} />;
      })}
    </div>
  );
}

/** Vertical tank with an animated surface. */
export function Tank({ fraction, color = "var(--accent)", height = 120, width = 56 }: { fraction: number; color?: string; height?: number; width?: number }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className="relative shrink-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]" style={{ width, height }} role="img" aria-label={`${Math.round(f * 100)}%`}>
      <div className="absolute inset-x-0 bottom-0 transition-[height] duration-1000" style={{ height: `${f * 100}%`, background: `linear-gradient(180deg, color-mix(in oklab, ${color} 70%, white), ${color})`, boxShadow: `0 -6px 18px -4px ${color}` }}>
        <div className="dash-wave absolute inset-x-0 -top-1.5 h-3 opacity-70" style={{ background: `radial-gradient(12px 6px at 12px 6px, color-mix(in oklab, ${color} 70%, white) 98%, transparent) 0 0 / 24px 12px repeat-x` }} />
      </div>
      {[0.25, 0.5, 0.75].map((m) => (
        <span key={m} className="absolute right-0 h-px w-2 bg-[color-mix(in_oklab,var(--fg)_30%,transparent)]" style={{ bottom: `${m * 100}%` }} />
      ))}
    </div>
  );
}

/** Traffic-light pill: ok / warning / critical (or unknown). */
export function StatusPill({ state, label }: { state: "ok" | "warn" | "crit" | "unknown"; label: string }) {
  const col = state === "ok" ? "#22c55e" : state === "warn" ? "#f59e0b" : state === "crit" ? "#ef4444" : "var(--fg-subtle)";
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold" style={{ color: col, background: `color-mix(in oklab, ${col} 15%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${col} 35%, transparent), 0 0 24px -6px ${col}` }}>
      <span className="relative flex size-2.5">
        {state !== "unknown" ? <span className="dash-ping absolute inline-flex size-full rounded-full opacity-60" style={{ background: col }} /> : null}
        <span className="relative inline-flex size-2.5 rounded-full" style={{ background: col }} />
      </span>
      {label}
    </span>
  );
}

/** "Change vs the previous sample" badge: a triangle and the absolute change (tile style `showDelta`). */
export function DeltaBadge({ delta, text, label }: { delta: number; text: string; label?: string }) {
  const flat = delta === 0;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[color-mix(in_oklab,var(--fg)_8%,transparent)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--fg-muted)]"
      title={label}
      aria-label={label ? `${label}: ${flat ? "" : delta > 0 ? "+" : "-"}${text}` : undefined}
    >
      <span aria-hidden>{flat ? "–" : delta > 0 ? "▲" : "▼"}</span>
      {text}
    </span>
  );
}
