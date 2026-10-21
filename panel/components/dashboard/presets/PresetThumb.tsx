"use client";
import { useMemo } from "react";
import type { CustomPanel, TileSettings } from "@/lib/dashboardBuilder";
import { tileKind } from "@/lib/dashboardGrid";
import type { TileRect } from "@/lib/dashboardModel";
import { colorCss, resolveAccent, resolveStyle } from "@/lib/dashboardStyle";

const Y = 0.4; // a grid row is about 0.4 of a column wide on screen
const MAX_ROWS = 30;

type Props = { panels: CustomPanel[]; tiles: Record<string, TileSettings>; rects: TileRect[] };

/** Schematic of a board: its real tile rectangles, drawn with the frame, colour and kind of every tile. No live data. */
export function PresetThumb({ panels, tiles, rects }: Props) {
  const rows = Math.min(MAX_ROWS, Math.max(2, ...rects.map((r) => r.y + r.h)));
  const items = useMemo(
    () =>
      rects.map((r) => {
        const p = panels.find((x) => x.id === r.id);
        const tile = tiles[r.id];
        const s = resolveStyle(tile?.style);
        const accent = resolveAccent(tile?.style, tile?.color) ?? "var(--accent)";
        return { r, kind: tileKind(r.id, tile?.view, p?.kind, p?.widget), s, accent, view: tile?.view ?? "" };
      }),
    [panels, tiles, rects],
  );
  return (
    <svg viewBox={`0 0 12 ${rows * Y}`} preserveAspectRatio="xMidYMin meet" className="h-full w-full p-2" aria-hidden role="presentation">
      {items.map(({ r, kind, s, accent, view }) => {
        if (r.y >= rows) return null;
        const x = r.x + 0.06;
        const y = r.y * Y + 0.03;
        const w = Math.max(0.2, r.w - 0.12);
        const h = Math.max(0.12, r.h * Y - 0.06);
        const fillCss = s.bg.mode === "transparent" ? "none" : s.bg.mode === "default" ? "var(--surface)" : colorCss(s.bg.color);
        const fillOpacity = s.bg.mode === "default" ? 1 : s.bg.mode === "gradient" ? Math.min(0.6, s.bg.opacity / 100 + 0.2) : s.bg.opacity / 100;
        const stroke = s.border.show ? (s.border.color ? colorCss(s.border.color) : "var(--border)") : "none";
        const rx = Math.min(0.45, (s.radius / 32) * 0.45 + 0.05);
        const glow = s.shadow === "glow" || s.accentGlow;
        const cx = x + w / 2;
        const cy = y + h / 2;
        return (
          <g key={r.id} style={glow ? { filter: `drop-shadow(0 0 0.18px ${accent})` } : undefined}>
            <rect x={x} y={y} width={w} height={h} rx={rx} fill={fillCss} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={s.border.width * 0.045} strokeOpacity={s.border.opacity / 100} />
            {s.bg.mode === "gradient" ? <rect x={x} y={y} width={w} height={h} rx={rx} fill={accent} opacity={0.14} /> : null}
            {kind === "viz" || view === "gauge" ? (
              <circle cx={cx} cy={cy} r={Math.max(0.1, Math.min(w, h) * 0.28)} fill="none" stroke={accent} strokeWidth={0.12} strokeDasharray="1.2 0.7" strokeLinecap="round" />
            ) : kind === "chart" ? (
              <polyline points={`${x + w * 0.1},${y + h * 0.7} ${x + w * 0.3},${y + h * 0.5} ${x + w * 0.5},${y + h * 0.6} ${x + w * 0.7},${y + h * 0.3} ${x + w * 0.9},${y + h * 0.4}`} fill="none" stroke={accent} strokeWidth={0.1} strokeLinecap="round" strokeLinejoin="round" />
            ) : kind === "stat" || kind === "action" ? (
              <>
                <rect x={x + w * 0.15} y={cy - h * 0.05} width={w * 0.45} height={Math.min(0.28, h * 0.22)} rx={0.08} fill={accent} opacity={0.9} />
                <rect x={x + w * 0.15} y={y + h * 0.18} width={w * 0.28} height={0.07} rx={0.035} fill="var(--fg-muted)" opacity={0.6} />
              </>
            ) : (
              [0.28, 0.5, 0.72].map((f) => <rect key={f} x={x + w * 0.1} y={y + h * f} width={w * (f === 0.5 ? 0.6 : 0.8)} height={0.07} rx={0.035} fill={kind === "telemt" ? accent : "var(--fg-muted)"} opacity={0.55} />)
            )}
          </g>
        );
      })}
    </svg>
  );
}
