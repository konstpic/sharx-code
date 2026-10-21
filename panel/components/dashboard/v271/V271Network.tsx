"use client";
/**
 * v2.7.1 dashboard tiles of the network group (speed, cumulative traffic, sockets, server IP) and the two history charts.
 * JSX and classes are copied from the v2.7.1 `WidgetTiles.tsx` / `DashboardPage`; the data comes from the AtomEnv.
 */
import { ArrowDown, ArrowLeftRight, ArrowUp, CloudDownload, CloudUpload, Eye, EyeOff, Globe } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ResourceTileChart } from "@/components/dashboard/ResourceTileChart";
import { LiveDot, MiniMeter, Sparkline } from "@/components/dashboard/viz";
import { RAM_SPARK_COLOR } from "@/components/dashboard/classic/helpers";
import { sizeFormat } from "@/lib/format";
import { usePanelAccentColor } from "@/lib/panelTheme";
import { Cell, Count, Head, V271Root, useHistory } from "./parts";

function RateCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: number; color: string }) {
  const hist = useHistory(value, 48);
  const peak = Math.max(0, ...hist);
  return (
    <div className="dash-card relative min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] p-3.5">
      <div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full opacity-60 blur-2xl" style={{ background: `radial-gradient(circle, color-mix(in oklab, ${color} 45%, transparent), transparent 70%)` }} aria-hidden />
      <div className="relative flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
          <span style={{ color }}>{icon}</span>
          {label}
        </span>
        <span className="font-mono text-[10px] text-[var(--fg-subtle)]">↑ {sizeFormat(peak)}/s</span>
      </div>
      <p className="relative mt-2 font-mono text-[26px] font-semibold leading-none tracking-tight tabular-nums text-[var(--fg)]">
        <Count value={value} size />
        <span className="ml-0.5 text-xs font-medium text-[var(--fg-subtle)]">/s</span>
      </p>
      <div className="relative mt-3">
        <Sparkline points={hist} color={color} height={44} minSpan={Math.max(1, peak * 0.2)} />
      </div>
    </div>
  );
}

export function V271NetSpeed({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { up, down } = env.st.netIO;
  return (
    <V271Root>
      <Head icon={<ArrowLeftRight size={18} />} color="#38bdf8" title={t("pages.index.netCurrentRates")} right={<LiveDot label={t("pages.builder.live", { defaultValue: "live" })} />} />
      <div className="dash-pair grid gap-2.5">
        <RateCard icon={<ArrowUp size={12} />} label={t("pages.index.upload")} value={up} color="#22c55e" />
        <RateCard icon={<ArrowDown size={12} />} label={t("pages.index.download")} value={down} color="#38bdf8" />
      </div>
    </V271Root>
  );
}

export function V271NetTraffic({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { sent, recv } = env.st.netTraffic;
  const total = Math.max(1, sent + recv);
  const sentPct = (sent / total) * 100;
  return (
    <V271Root>
      <Head icon={<CloudDownload size={18} />} color="#a78bfa" title={t("pages.index.netCumulativeTraffic")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Cell icon={<CloudUpload size={11} />} label={t("pages.index.sent")} value={<Count value={sent} size />} color="#f59e0b" hint={`${sentPct.toFixed(0)}%`} />
        <Cell icon={<CloudDownload size={11} />} label={t("pages.index.received")} value={<Count value={recv} size />} color="#a78bfa" hint={`${(100 - sentPct).toFixed(0)}%`} />
      </div>
      <div className="mt-auto flex h-2.5 shrink-0 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_9%,transparent)]" role="img" aria-label={`${sentPct.toFixed(0)}% / ${(100 - sentPct).toFixed(0)}%`}>
        <div className="h-full transition-[width] duration-700" style={{ width: `${sentPct}%`, background: "linear-gradient(90deg,#f59e0b,#fb923c)", boxShadow: "0 0 12px -2px #f59e0b" }} />
        <div className="h-full flex-1" style={{ background: "linear-gradient(90deg,#8b5cf6,#c084fc)" }} />
      </div>
    </V271Root>
  );
}

export function V271NetSockets({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const tcp = env.st.tcpCount;
  const udp = env.st.udpCount;
  const total = Math.max(1, tcp + udp);
  return (
    <V271Root>
      <Head icon={<ArrowLeftRight size={18} />} color="#14b8a6" title={t("pages.index.netSocketsTitle")} />
      <div className="grid grid-cols-2 gap-2.5">
        <Cell icon={<ArrowLeftRight size={11} />} label={t("pages.index.statTCP")} value={<Count value={tcp} />} color="#14b8a6" hint={`${((tcp / total) * 100).toFixed(0)}%`} />
        <Cell icon={<ArrowLeftRight size={11} />} label={t("pages.index.statUDP")} value={<Count value={udp} />} color="#f472b6" hint={`${((udp / total) * 100).toFixed(0)}%`} />
      </div>
      <div className="mt-auto space-y-2">
        <MiniMeter label="TCP" value={tcp} max={total} text={String(tcp)} color="#14b8a6" />
        <MiniMeter label="UDP" value={udp} max={total} text={String(udp)} color="#f472b6" />
      </div>
    </V271Root>
  );
}

export function V271ServerIp({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st, ipv6Enabled: showV6, revealIp: revealed, toggleIp } = env;
  const row = (label: string, v?: string) => (
    <div className="dash-card flex items-center gap-3 rounded-2xl border border-[var(--border)] px-3.5 py-2.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">{label}</span>
      <span className="ml-auto truncate font-mono text-sm text-[var(--fg)]">{revealed ? v || "—" : "••••••••"}</span>
    </div>
  );
  return (
    <V271Root className="gap-3 p-5">
      <Head
        icon={<Globe size={18} />}
        color="#38bdf8"
        title={t("pages.index.ipAddresses")}
        right={
          <button type="button" onClick={toggleIp} aria-label={t("pages.index.toggleIpVisibility")} title={t("pages.index.toggleIpVisibility")} className="grid size-9 place-items-center rounded-xl border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[var(--fg)]">
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        }
      />
      <div className="space-y-2">
        {row(t("pages.index.statIPv4"), st.publicIP?.ipv4)}
        {showV6 ? row(t("pages.index.statIPv6"), st.publicIP?.ipv6) : null}
      </div>
    </V271Root>
  );
}

/** The CPU / memory history tile of v2.7.1: a heading and the area-less line chart, nothing else. */
function V271History({ env, ram }: { env: AtomEnv; ram: boolean }) {
  const { t } = useTranslation();
  const accent = usePanelAccentColor();
  const series = (ram ? env.memSeries : env.cpuSeries).map((s, i) => ({ key: "panel" + i, name: t("pages.index.resourceSeriesPanel"), stroke: ram ? RAM_SPARK_COLOR : accent, points: s.points }));
  return (
    <V271Root className="p-5">
      <h3 className="mb-3 shrink-0 text-sm font-semibold text-[var(--fg)]">{ram ? t("pages.index.memoryHistory") : t("pages.index.cpuHistory")}</h3>
      <div className="flex min-h-0 flex-1 flex-col">
        <ResourceTileChart series={series} />
      </div>
    </V271Root>
  );
}

export const V271CpuHistory = ({ env }: { env: AtomEnv }) => <V271History env={env} ram={false} />;
export const V271MemoryHistory = ({ env }: { env: AtomEnv }) => <V271History env={env} ram />;
