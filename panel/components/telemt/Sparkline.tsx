"use client";

import { sparklinePath, type DCState } from "@/lib/telemtDc";
import { stateStroke } from "./StateBadge";

/** Tiny RTT history chart; purely decorative (values are also printed next to it). */
export function Sparkline({ values, state, width = 96, height = 22, title }: { values: (number | null)[]; state: DCState; width?: number; height?: number; title?: string }) {
  const d = sparklinePath(values, width, height);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="max-w-full shrink-0" role="img" aria-label={title ?? "RTT history"}>
      {title ? <title>{title}</title> : null}
      <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-[var(--border)]" strokeWidth="1" />
      {d ? <path d={d} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={stateStroke[state]} /> : null}
    </svg>
  );
}
