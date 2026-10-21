"use client";
/**
 * Building blocks of the dashboard tiles. Every block lives inside the tile body contract
 * (see useTileBox.ts): the tile gives a definite width and height, blocks fill it, scale with it,
 * and drop secondary information instead of being clipped.
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { RingGauge, Sparkline, type SparkOptions } from "@/components/dashboard/viz";
import { useElementBox, useTileBox } from "./useTileBox";

/**
 * Root of a tile widget: fills the body, never overflows, padding scales with the tile (and with the tile style's padding).
 * `onActivate` makes the whole tile a button (tile style "click action").
 */
export function AtomFrame({ children, className = "", style, gap = "clamp(2px, 2cqmin, 8px)", onActivate, label }: { children: ReactNode; className?: string; style?: CSSProperties; gap?: string; onActivate?: () => void; label?: string }) {
  return (
    <div
      data-atom
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${onActivate ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" : ""} ${className}`}
      style={{ padding: "calc(clamp(6px, 4cqmin, 14px) * var(--tile-pad-k, 1))", gap, ...style }}
      {...(onActivate
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": label,
            onClick: onActivate,
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onActivate();
              }
            },
          }
        : {})}
    >
      {children}
    </div>
  );
}

/**
 * Compact one-line heading of a tile in view mode. Renders nothing while the tile chrome already shows
 * the title (edit mode title bar) or when the user switched the title off, so a title is never shown twice.
 */
export function TileHeader({ icon, color = "var(--accent)", right, label, iconPos = "left" }: { icon?: ReactNode; color?: string; right?: ReactNode; label?: string; iconPos?: "left" | "right" | "top" }) {
  const { hideTitle, title, height } = useTileBox();
  const text = label ?? title;
  if (hideTitle || !text || (height > 0 && height < 56)) return right ? <div className="flex shrink-0 justify-end">{right}</div> : null;
  const iconEl = icon ? (
    <span className="grid shrink-0 place-items-center" style={{ color }} aria-hidden>
      {icon}
    </span>
  ) : null;
  return (
    <div className={`tile-header flex min-w-0 shrink-0 ${iconPos === "top" ? "flex-col items-start gap-0.5" : "items-center gap-1.5"}`} style={{ fontSize: "calc(clamp(10px, 3.6cqmin, 13px) * var(--tile-label-scale, 1))" }}>
      {iconPos === "top" ? iconEl : null}
      <div className="flex w-full min-w-0 items-center gap-1.5">
        {iconPos === "left" ? iconEl : null}
        <h3 className="min-w-0 flex-1 truncate font-medium leading-tight text-[var(--fg-muted)]" style={{ color: "var(--tile-label-color, var(--fg-muted))" }} title={text}>
          {text}
        </h3>
        {iconPos === "right" ? iconEl : null}
        {right}
      </div>
    </div>
  );
}

/** Typography overrides of a value (tile style): `scale` multiplies the auto-fit size but never exceeds what fits the box. */
export type TextFx = { scale?: number; font?: "default" | "mono" | "sans" | "heading"; weight?: number };
const FONT_W = { default: 0.56, sans: 0.56, mono: 0.62, heading: 0.6 } as const;
const fxStyle = (fx?: TextFx): CSSProperties => ({
  ...(fx?.font === "heading" ? { fontFamily: "var(--font-heading, inherit)" } : fx?.font === "sans" ? { fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)" } : fx?.font === "mono" ? { fontFamily: "var(--font-mono, ui-monospace, monospace)" } : {}),
  ...(fx?.weight && fx.weight !== 600 ? { fontWeight: fx.weight } : {}),
});

/** Text that always fits its box: the font size is derived from the measured space and the text length. */
export function FitText({
  text,
  unit,
  color,
  minPx = 11,
  maxPx = 150,
  align = "center",
  gradient = false,
  grow = 1,
  fx,
}: {
  grow?: number;
  text: string;
  unit?: string;
  color?: string;
  minPx?: number;
  maxPx?: number;
  align?: "center" | "start" | "end";
  gradient?: boolean;
  fx?: TextFx;
}) {
  const { ref, width, height } = useElementBox();
  const chars = Math.max(1, text.length + (unit ? unit.length * 0.5 + 0.2 : 0));
  const fit = width > 0 && height > 0 ? Math.min(height * 0.9, width / (chars * FONT_W[fx?.font ?? "default"])) : 16;
  const base = Math.max(minPx, Math.min(maxPx, fit));
  const scale = fx?.scale ?? 1;
  // scale < 1 shrinks the auto size; scale > 1 grows it only as far as the box allows (never clips).
  const size = scale === 1 ? base : Math.max(8, Math.min(Math.max(base, fit), base * scale));
  return (
    <div ref={ref} style={{ flex: `${grow} 1 0%` }} className={`flex min-h-0 min-w-0 items-center overflow-hidden ${align === "center" ? "justify-center" : align === "end" ? "justify-end" : "justify-start"}`}>
      <span
        className={`whitespace-nowrap font-semibold tabular-nums tracking-tight ${gradient ? "bg-clip-text text-transparent" : ""}`}
        style={{
          fontSize: size,
          lineHeight: 1,
          color: gradient ? undefined : (color ?? "var(--fg)"),
          backgroundImage: gradient && color ? `linear-gradient(180deg, ${color}, color-mix(in oklab, ${color} 45%, var(--fg)))` : undefined,
          ...fxStyle(fx),
        }}
      >
        {text}
        {unit ? <span className="ml-[0.12em] font-medium text-[var(--fg-subtle)]" style={{ fontSize: "0.42em" }}>{unit}</span> : null}
      </span>
    </div>
  );
}

/** Single line of secondary text under a value: ellipsis, never wraps. */
export function Hint({ children, color, align }: { children: ReactNode; color?: string; align?: "left" | "center" | "right" }) {
  return (
    <p className="min-w-0 shrink-0 truncate text-center font-mono text-[var(--fg-muted)]" style={{ fontSize: "clamp(9px, 3.2cqmin, 12px)", color, textAlign: align }}>
      {children}
    </p>
  );
}

/** Ring options of the tile style (arc length, caps, ticks, track colour). */
export type RingOptions = { arc?: number; roundCaps?: boolean; ticks?: boolean; track?: string };

/** Ring gauge scaled to the free space of its flex parent; the value is written into the ring. */
export function FitGauge({
  fraction,
  text,
  color,
  sweep = 270,
  unit,
  grow = 1,
  strokeRatio = 0.085,
  fx,
  ring,
}: {
  grow?: number;
  strokeRatio?: number;
  /** 0..1 */
  fraction: number;
  text: string;
  color: string;
  sweep?: 270 | 360;
  unit?: string;
  fx?: TextFx & { color?: string };
  ring?: RingOptions;
}) {
  const { ref, width, height } = useElementBox();
  const size = Math.max(0, Math.floor(Math.min(width, height)) - 6); // keep stroke + glow inside the tile
  const chars = Math.max(1, text.length + (unit ? 0.6 : 0));
  const base = size > 0 ? Math.max(9, Math.min(size * 0.26, (size * 0.6) / (chars * 0.6))) : 12;
  const scale = fx?.scale ?? 1;
  const font = scale === 1 || size <= 0 ? base : Math.max(8, Math.min(Math.max(base, (size * 0.7) / (chars * (FONT_W[fx?.font ?? "default"] + 0.04))), base * scale));
  return (
    <div ref={ref} style={{ flex: `${grow} 1 0%` }} className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
      {size >= 28 ? (
        <RingGauge
          value={fraction}
          max={1}
          size={size}
          stroke={Math.max(4, Math.round(size * strokeRatio))}
          sweep={ring?.arc ?? sweep}
          color={color}
          roundCaps={ring?.roundCaps}
          ticks={ring?.ticks}
          track={ring?.track}
          center={
            <span className="font-semibold leading-none tabular-nums text-[var(--fg)]" style={{ fontSize: font, ...(fx?.color ? { color: fx.color } : {}), ...fxStyle(fx) }}>
              {text}
              {unit ? <span className="text-[var(--fg-subtle)]" style={{ fontSize: "0.55em" }}>{unit}</span> : null}
            </span>
          }
        />
      ) : null}
    </div>
  );
}

/** Sparkline that takes the height it is given (and hides itself when there is nothing to draw or no room). */
export function smoothSeries(points: readonly number[], window: number): number[] {
  if (window < 2 || points.length < 3) return [...points];
  const half = Math.floor(window / 2);
  return points.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
      sum += points[j];
      n++;
    }
    return sum / n;
  });
}

export function FitSpark({ points: raw, color, minSpan = 0, grow = 1, smooth = 3, opts }: { points: number[]; color: string; minSpan?: number; grow?: number; smooth?: number; opts?: SparkOptions & { show?: boolean; window?: number } }) {
  const { ref, height } = useElementBox();
  const { show, window: win, ...spark } = opts ?? {};
  const windowed = win && win < raw.length ? raw.slice(-win) : raw;
  const points = smoothSeries(windowed, smooth);
  if (show === false) return null;
  return (
    <div ref={ref} style={{ flex: `${grow} 1 0%` }} className="min-h-0 min-w-0 overflow-hidden">
      {height >= 16 && points.length > 1 ? <Sparkline points={points} color={color} height={Math.floor(height)} minSpan={minSpan} {...spark} /> : null}
    </div>
  );
}

/** Pixel thresholds used by widgets to decide what still fits. */
export function useRoom() {
  const { width, height } = useTileBox();
  return {
    width,
    height,
    /** a secondary line fits */
    hint: height >= 104,
    /** a sparkline fits */
    spark: height >= 110 && width >= 120,
    /** a list / detail block fits */
    list: height >= 150,
    wide: width >= height * 1.7 && width >= 220,
  };
}
