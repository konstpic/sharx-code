"use client";
import type { CSSProperties } from "react";
import { frameProps } from "../frameProps";
import type { TileStyle } from "@/lib/dashboardStyle";

/** A miniature tile drawn with the real frame CSS of `style` (the presets row and "my styles"). */
export function StyleSwatch({ style, accent = "var(--accent)" }: { style?: TileStyle; accent?: string }) {
  const f = frameProps(style, undefined);
  return (
    <span
      {...f.attrs}
      className="dashboard-tile pointer-events-none relative block h-12 w-full overflow-hidden rounded-xl border border-[var(--border)]"
      style={{ ...(f.vars as CSSProperties), ["--swatch" as string]: accent }}
      aria-hidden
    >
      <span className="absolute left-2 top-1.5 block h-1 w-8 rounded-full bg-[var(--tile-label-color,var(--fg-muted))] opacity-60" />
      <span className="absolute left-2 top-4 block h-3 w-12 rounded-sm" style={{ background: "var(--accent)" }} />
      <svg viewBox="0 0 60 14" className="absolute bottom-1 left-2 right-2 h-3 w-[calc(100%-1rem)]" preserveAspectRatio="none">
        <path d="M0 11 C10 3 16 12 26 6 S44 8 60 1" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}
