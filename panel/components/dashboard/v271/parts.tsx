"use client";
/**
 * Shared bits of the v2.7.1 dashboard tiles, copied from the v2.7.1 `WidgetTiles.tsx`: the icon bubble, the header,
 * the stat cell, the pill button, the page-local history and the count-up number. Used by every `V271*` tile.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { sizeFormat } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";

/** Page-local rolling history of a live value (the status endpoint has no history for these). */
export function useHistory(value: number, max = 48) {
  const [h, setH] = useState<number[]>([]);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(value) || last.current === value) return;
    last.current = value;
    setH((p) => [...p.slice(-(max - 1)), value]);
  }, [value, max]);
  return h;
}

export function Count({ value, size }: { value: number; size?: boolean }) {
  const v = useCountUp(value, { duration: 700, decimals: 0 });
  return <>{size ? sizeFormat(v) : Math.round(v).toLocaleString()}</>;
}

/** Icon bubble used in every tile header. */
export function WidgetIcon({ icon, color = "var(--accent)", size = 36 }: { icon: ReactNode; color?: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl"
      style={{ width: size, height: size, color, background: `color-mix(in oklab, ${color} 15%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)` }}
    >
      {icon}
    </span>
  );
}

export function Head({ icon, color, title, sub, right }: { icon: ReactNode; color?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <WidgetIcon icon={icon} color={color} />
      <div className="min-w-0 flex-1 leading-tight">
        <h3 className="truncate text-sm font-semibold text-[var(--fg)]">{title}</h3>
        {sub ? <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--fg-subtle)]">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Cell({ icon, label, value, color = "var(--accent)", hint }: { icon: ReactNode; label: ReactNode; value: ReactNode; color?: string; hint?: ReactNode }) {
  return (
    <div className="dash-card min-w-0 rounded-2xl border border-[var(--border)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
        <span style={{ color }}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-2 break-words font-mono text-xl font-semibold leading-none tracking-tight tabular-nums text-[var(--fg)]">{value}</p>
      {hint ? <p className="mt-1.5 text-[10px] text-[var(--fg-subtle)]">{hint}</p> : null}
    </div>
  );
}

export const pillBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--accent)_40%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-4 py-2 text-xs font-semibold text-[var(--fg)] transition hover:bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] disabled:opacity-50";

/**
 * Body of a v2.7.1 tile: the composite fills the tile (the tile of 2.7.1 stretched it the same way) and scrolls inside
 * when its content is taller than the tile, so nothing is ever clipped.
 */
export function V271Root({ children, className = "gap-4 p-5" }: { children: ReactNode; className?: string }) {
  return <div className={`v271-tile flex h-full min-h-0 flex-col ${className}`}>{children}</div>;
}
