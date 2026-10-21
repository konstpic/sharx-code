"use client";
/**
 * v2.7.1 dashboard tile: system load and resources (four dial gauges, node availability, load averages).
 * JSX and classes are copied from the v2.7.1 `ResourcesOverview`; the data comes from the AtomEnv of the page.
 * The gauge grid follows the TILE width (`.dash-gauges`, `.dash-pair`), not the viewport, so it also fits a narrow tile.
 */
import { Activity, Cpu, HardDrive, Layers, MemoryStick, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LiveDot, MiniMeter, RingGauge, SegmentBar, Sparkline, loadColor } from "@/components/dashboard/viz";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { pct, RAM_SPARK_COLOR } from "@/components/dashboard/classic/helpers";
import { sizeFormat } from "@/lib/format";
import { usePanelAccentColor } from "@/lib/panelTheme";
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
      <p className="-mt-3 min-h-[1rem] text-center font-mono text-[11px] text-[var(--fg-muted)]">{gauge.detail ?? " "}</p>
      {gauge.series && gauge.series.length > 1 ? <Sparkline points={gauge.series} color={color} height={34} className="mt-2" minSpan={20} /> : <div className="mt-2 h-[34px]" />}
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

export function V271Resources({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const accent = usePanelAccentColor();
  const { st, multi } = env;
  const cores = Math.max(1, st.cpuCores);
  const cpu: Gauge = {
    percent: st.cpu,
    detail: `${st.cpuCores} ${t("pages.index.cores")}`,
    series: (env.cpuSeries[0]?.points ?? []).map((q) => q.value),
    onOpen: env.act.openCpu,
    title: t("pages.index.cpuHistory"),
  };
  const mem: Gauge = {
    percent: pct(st.mem.current, st.mem.total),
    detail: `${sizeFormat(st.mem.current)} / ${sizeFormat(st.mem.total)}`,
    series: (env.memSeries[0]?.points ?? []).map((q) => q.value),
    color: RAM_SPARK_COLOR,
    onOpen: env.act.openMem,
    title: t("pages.index.memoryHistory"),
  };
  const disk: Gauge = { percent: pct(st.disk.current, st.disk.total), detail: `${sizeFormat(st.disk.current)} / ${sizeFormat(st.disk.total)}` };
  const swap: Gauge = { percent: pct(st.swap.current, st.swap.total), detail: `${sizeFormat(st.swap.current)} / ${sizeFormat(st.swap.total)}` };
  const nOn = st.nodes?.online ?? 0;
  const nTot = st.nodes?.total ?? 0;
  const nodes = multi && nTot > 0 ? { online: nOn, total: nTot } : null;
  const loads = st.loads;
  return (
    <div className="v271-tile flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-xl text-[var(--accent)]" style={{ background: "color-mix(in oklab, var(--accent) 14%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--accent) 30%, transparent)" }}>
            <Activity size={16} />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.systemLoad")}</p>
            <p className="text-[11px] text-[var(--fg-subtle)]">{t("pages.index.resources")}</p>
          </div>
        </div>
        <LiveDot label={t("pages.builder.live", { defaultValue: "live" })} />
      </div>

      <div className="dash-gauges grid min-h-0 flex-1 gap-3">
        <GaugeCard icon={<Cpu size={12} />} name={`${t("pages.index.cpu")} · ${st.cpuCores}`} gauge={cpu} accent={accent} />
        <GaugeCard icon={<MemoryStick size={12} />} name={t("pages.index.memory")} gauge={mem} accent={accent} />
        <GaugeCard icon={<HardDrive size={12} />} name={t("pages.index.storage")} gauge={disk} accent={accent} />
        <GaugeCard icon={<Layers size={12} />} name={t("pages.index.swap")} gauge={swap} accent={accent} />
      </div>

      <div className={nodes ? "dash-pair grid gap-3" : "grid gap-3"}>
        {nodes ? (
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
