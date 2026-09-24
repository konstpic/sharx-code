"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { loadTone, type NodeLoad } from "@/lib/nodeLoad";

const TONE_COLOR = { ok: "#22c55e", warn: "#f59e0b", high: "#ef4444" } as const;

function last(a: number[]): number | null {
  return a.length ? a[a.length - 1] : null;
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const id = useId().replace(/[:]/g, "");
  const data = points.slice(-40);
  if (data.length < 2) return <div className="h-8 w-full rounded panel-inset-strong" aria-hidden />;
  const w = 100;
  const h = 28;
  const step = w / (data.length - 1);
  const xy = data.map((v, i) => `${(i * step).toFixed(2)},${(h - (Math.max(0, Math.min(100, v)) / 100) * (h - 2) - 1).toFixed(2)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${xy.join(" ")} ${w},${h}`} fill={`url(#${id})`} />
      <polyline points={xy.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Bar({ label, value }: { label: string; value: number | null }) {
  const pct = value ?? 0;
  const color = TONE_COLOR[loadTone(pct)];
  return (
    <div className="flex items-center gap-2 text-[10px] text-[var(--fg-muted)]">
      <span className="w-9 shrink-0 uppercase tracking-wide">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
        <span className="block h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="w-8 shrink-0 text-right font-mono">{value == null ? "—" : `${Math.round(value)}%`}</span>
    </div>
  );
}

/** CPU sparkline plus RAM and disk bars for one node tile. */
export function NodeLoadBlock({ load }: { load?: NodeLoad }) {
  const { t } = useTranslation();
  const cpu = load ? last(load.cpu) : null;
  const color = TONE_COLOR[loadTone(cpu ?? 0)];
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] panel-inset p-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--fg-muted)]">
        <span>{t("pages.nodes.loadCpu", { defaultValue: "CPU" })}</span>
        <span className="font-mono text-xs font-semibold normal-case" style={{ color }}>
          {cpu == null ? "—" : `${Math.round(cpu)}%`}
        </span>
      </div>
      <Sparkline points={load?.cpu ?? []} color={color} />
      <Bar label={t("pages.nodes.loadRam", { defaultValue: "RAM" })} value={load ? last(load.mem) : null} />
      <Bar label={t("pages.nodes.loadDisk", { defaultValue: "Disk" })} value={load ? last(load.disk) : null} />
    </div>
  );
}
