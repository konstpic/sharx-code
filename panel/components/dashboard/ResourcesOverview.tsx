"use client";

import { Activity, Cpu, HardDrive, MemoryStick, Server, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LiveDot, MiniMeter, RingGauge, SegmentBar, Sparkline, loadColor } from "@/components/dashboard/viz";
import { sizeFormat } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";

type Gauge = {
  percent: number;
  /** Secondary line, e.g. "2.1 GB / 3.8 GB". */
  detail?: string;
  series?: number[];
  color?: string;
  onOpen?: () => void;
  title?: string;
};

function Pct({ value }: { value: number }) {
  const v = useCountUp(value, { duration: 700, decimals: 0 });
  return (
    <span className="text-[26px] font-semibold leading-none tabular-nums tracking-tight text-[var(--fg)]">
      {Math.round(v)}
      <span className="ml-0.5 text-[13px] font-medium text-[var(--fg-subtle)]">%</span>
    </span>
  );
}

function GaugeCard({ icon, name, gauge, accent }: { icon: ReactNode; name: ReactNode; gauge: Gauge; accent: string }) {
  const color = loadColor(gauge.percent, gauge.color ?? accent);
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
          <span className="grid size-5 place-items-center rounded-md" style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}>
            {icon}
          </span>
          {name}
        </span>
      </div>
      <div className="mt-1 flex justify-center">
        <RingGauge value={gauge.percent} size={108} stroke={9} color={color} center={<Pct value={gauge.percent} />} />
      </div>
      <p className="dash-secondary -mt-3 min-h-[1rem] text-center font-mono text-[11px] text-[var(--fg-muted)]">{gauge.detail ?? " "}</p>
      {gauge.series && gauge.series.length > 1 ? <Sparkline points={gauge.series} color={color} height={34} className="dash-secondary mt-2" minSpan={20} /> : <div className="dash-secondary mt-2 h-[34px]" />}
    </>
  );
  const cls =
    "dash-card group relative flex h-full min-w-0 flex-col rounded-2xl border border-[var(--border)] p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40";
  return gauge.onOpen ? (
    <button type="button" onClick={gauge.onOpen} title={gauge.title} className={`${cls} hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export type ResourcesOverviewProps = {
  accent: string;
  cpu: Gauge & { cores: number };
  mem: Gauge;
  disk: Gauge;
  swap: Gauge;
  loads?: number[];
  nodes?: { online: number; total: number } | null;
};

/** Modern replacement for the old progress-bar block: four dial gauges, availability and load averages. */
export function ResourcesOverview({ accent, cpu, mem, disk, swap, loads, nodes }: ResourcesOverviewProps) {
  const { t } = useTranslation();
  const cores = Math.max(1, cpu.cores);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-xl text-[var(--accent)]" style={{ background: "color-mix(in oklab, var(--accent) 14%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--accent) 30%, transparent)" }}>
            <Activity size={16} />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.systemLoad")}</p>
            <p className="dash-secondary text-[11px] text-[var(--fg-subtle)]">{t("pages.index.resources")}</p>
          </div>
        </div>
        <LiveDot label={t("pages.builder.live", { defaultValue: "live" })} />
      </div>

      <div className="dash-gauges grid min-h-0 flex-1 gap-3">
        <GaugeCard icon={<Cpu size={12} />} name={`${t("pages.index.cpu")} · ${cpu.cores}`} gauge={{ ...cpu, detail: cpu.detail ?? `${cpu.cores} ${t("pages.index.cores")}` }} accent={accent} />
        <GaugeCard icon={<MemoryStick size={12} />} name={t("pages.index.memory")} gauge={mem} accent={accent} />
        <GaugeCard icon={<HardDrive size={12} />} name={t("pages.index.storage")} gauge={disk} accent={accent} />
        <GaugeCard icon={<Layers size={12} />} name={t("pages.index.swap")} gauge={swap} accent={accent} />
      </div>

      <div className={`dash-secondary grid gap-3 ${nodes && nodes.total > 0 ? "dash-pair" : ""}`}>
        {nodes && nodes.total > 0 ? (
          <div className="dash-card rounded-2xl border border-[var(--border)] p-3">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-1.5 font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                <Server size={12} />
                {t("pages.index.nodesAvailability")}
              </span>
              <span className="font-mono text-sm tabular-nums text-[var(--fg)]">
                {nodes.online}
                <span className="text-[var(--fg-subtle)]"> / {nodes.total}</span>
              </span>
            </div>
            <SegmentBar total={nodes.total} ok={nodes.online} />
          </div>
        ) : null}
        {loads && loads.length >= 3 ? (
          <div className="dash-card rounded-2xl border border-[var(--border)] p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]" title={t("pages.index.systemLoadDesc")}>
              {t("pages.index.systemLoad")}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[1, 5, 15].map((m, i) => (
                <MiniMeter key={m} label={`${m} ${t("pages.builder.minShort", { defaultValue: "min" })}`} value={loads[i]} max={cores} text={loads[i].toFixed(2)} color={accent} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { sizeFormat };
