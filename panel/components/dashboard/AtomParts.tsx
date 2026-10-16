"use client";
/**
 * Building blocks of the dashboard tiles. Every block lives inside the tile body contract
 * (see useTileBox.ts): the tile gives a definite width and height, blocks fill it, scale with it,
 * and drop secondary information instead of being clipped.
 */
import type { CSSProperties, ReactNode } from "react";
import { RingGauge, Sparkline } from "@/components/dashboard/viz";
import { useElementBox, useTileBox } from "./useTileBox";

/** Root of a tile widget: fills the body, never overflows, padding scales with the tile. */
export function AtomFrame({ children, className = "", style, gap = "clamp(2px, 2cqmin, 8px)" }: { children: ReactNode; className?: string; style?: CSSProperties; gap?: string }) {
  return (
    <div data-atom className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${className}`} style={{ padding: "clamp(6px, 4cqmin, 14px)", gap, ...style }}>
      {children}
    </div>
  );
}

/**
 * Compact one-line heading of a tile in view mode. Renders nothing while the tile chrome already shows
 * the title (edit mode title bar) or when the user switched the title off, so a title is never shown twice.
 */
export function TileHeader({ icon, color = "var(--accent)", right, label }: { icon?: ReactNode; color?: string; right?: ReactNode; label?: string }) {
  const { hideTitle, title, height } = useTileBox();
  const text = label ?? title;
  if (hideTitle || !text || (height > 0 && height < 56)) return right ? <div className="flex shrink-0 justify-end">{right}</div> : null;
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1.5" style={{ fontSize: "clamp(10px, 3.6cqmin, 13px)" }}>
      {icon ? (
        <span className="grid shrink-0 place-items-center" style={{ color }} aria-hidden>
          {icon}
        </span>
      ) : null}
      <h3 className="min-w-0 flex-1 truncate font-medium leading-tight text-[var(--fg-muted)]" title={text}>
        {text}
      </h3>
      {right}
    </div>
  );
}

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
}: {
  grow?: number;
  text: string;
  unit?: string;
  color?: string;
  minPx?: number;
  maxPx?: number;
  align?: "center" | "start";
  gradient?: boolean;
}) {
  const { ref, width, height } = useElementBox();
  const chars = Math.max(1, text.length + (unit ? unit.length * 0.5 + 0.2 : 0));
  const fit = width > 0 && height > 0 ? Math.min(height * 0.9, width / (chars * 0.56)) : 16;
  const size = Math.max(minPx, Math.min(maxPx, fit));
  return (
    <div ref={ref} style={{ flex: `${grow} 1 0%` }} className={`flex min-h-0 min-w-0 items-center overflow-hidden ${align === "center" ? "justify-center" : "justify-start"}`}>
      <span
        className={`whitespace-nowrap font-semibold tabular-nums tracking-tight ${gradient ? "bg-clip-text text-transparent" : ""}`}
        style={{
          fontSize: size,
          lineHeight: 1,
          color: gradient ? undefined : (color ?? "var(--fg)"),
          backgroundImage: gradient && color ? `linear-gradient(180deg, ${color}, color-mix(in oklab, ${color} 45%, var(--fg)))` : undefined,
        }}
      >
        {text}
        {unit ? <span className="ml-[0.12em] font-medium text-[var(--fg-subtle)]" style={{ fontSize: "0.42em" }}>{unit}</span> : null}
      </span>
    </div>
  );
}

/** Single line of secondary text under a value: ellipsis, never wraps. */
export function Hint({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <p className="min-w-0 shrink-0 truncate text-center font-mono text-[var(--fg-muted)]" style={{ fontSize: "clamp(9px, 3.2cqmin, 12px)", color }}>
      {children}
    </p>
  );
}

/** Ring gauge scaled to the free space of its flex parent; the value is written into the ring. */
export function FitGauge({
  fraction,
  text,
  color,
  sweep = 270,
  unit,
  grow = 1,
  strokeRatio = 0.085,
}: {
  grow?: number;
  strokeRatio?: number;
  /** 0..1 */
  fraction: number;
  text: string;
  color: string;
  sweep?: 270 | 360;
  unit?: string;
}) {
  const { ref, width, height } = useElementBox();
  const size = Math.max(0, Math.floor(Math.min(width, height)) - 6); // keep stroke + glow inside the tile
  const font = size > 0 ? Math.max(9, Math.min(size * 0.26, (size * 0.6) / (Math.max(1, text.length + (unit ? 0.6 : 0)) * 0.6))) : 12;
  return (
    <div ref={ref} style={{ flex: `${grow} 1 0%` }} className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
      {size >= 28 ? (
        <RingGauge
          value={fraction}
          max={1}
          size={size}
          stroke={Math.max(4, Math.round(size * strokeRatio))}
          sweep={sweep}
          color={color}
          center={
            <span className="font-semibold leading-none tabular-nums text-[var(--fg)]" style={{ fontSize: font }}>
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

export function FitSpark({ points: raw, color, minSpan = 0, grow = 1, smooth = 3 }: { points: number[]; color: string; minSpan?: number; grow?: number; smooth?: number }) {
  const { ref, height } = useElementBox();
  const points = smoothSeries(raw, smooth);
  return (
    <div ref={ref} style={{ flex: `${grow} 1 0%` }} className="min-h-0 min-w-0 overflow-hidden">
      {height >= 16 && points.length > 1 ? <Sparkline points={points} color={color} height={Math.floor(height)} minSpan={minSpan} /> : null}
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
