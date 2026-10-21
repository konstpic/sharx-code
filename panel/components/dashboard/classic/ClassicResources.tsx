"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicResources
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile, LinearProgress } from "@/components/ui";
import { usePanelAccentColor } from "@/lib/panelTheme";
import { sizeFormat, toFixed } from "@/lib/format";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot, MultiResourceSparkline, RAM_SPARK_COLOR, metricColor, paletteStrokeForSeries, pct, toClassicSeries } from "./helpers";

export function ClassicResources({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const accent = usePanelAccentColor();
  const { st, multi } = env;
  const cpuP = st.cpu;
  const memP = pct(st.mem.current, st.mem.total);
  const dskP = pct(st.disk.current, st.disk.total);
  const swP = pct(st.swap.current, st.swap.total);
  const nOn = st.nodes?.online ?? 0;
  const nTot = st.nodes?.total ?? 0;
  const nP = nTot ? Number(toFixed((nOn / nTot) * 100, 2)) : 0;
  const ramSparkColor = RAM_SPARK_COLOR;
  const cpuPreviewSeries = toClassicSeries(env.cpuSeries);
  const memPreviewSeries = toClassicSeries(env.memSeries);
  const cpuPreviewLegend = cpuPreviewSeries.map((s, i) => ({ key: s.key, name: s.key === "panel" ? t("pages.index.resourceSeriesPanel") : s.name, stroke: paletteStrokeForSeries(s, accent, i) }));
  const memPreviewLegend = memPreviewSeries.map((s, i) => ({ key: s.key, name: s.key === "panel" ? t("pages.index.resourceSeriesPanel") : s.name, stroke: paletteStrokeForSeries(s, ramSparkColor, i) }));
  const openCpu = env.act.openCpu;
  const openMem = env.act.openMem;
  return (
    <ClassicRoot>
      <div className="mb-3 flex items-center justify-center gap-2.5">
        <IconTile icon={Activity} tone="accent" size="sm" />
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
          {t("pages.index.systemLoad")} · {t("pages.index.resources")}
        </p>
      </div>
      <div className="cl-res grid gap-3 text-sm text-[var(--fg-muted)]">
        <button
          type="button"
          onClick={openCpu}
          title={t("pages.index.cpuHistory")}
          className="group rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/50 p-2.5 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
        >
          <LinearProgress percent={cpuP} strokeColor={metricColor(cpuP, accent)} />
          <p className="mt-1.5 text-center text-xs">
            <span className="text-[var(--fg)]">{t("pages.index.cpu")}</span>{" "}
            {st.cpuCores} {t("pages.index.cores")} · {toFixed(cpuP, 0)}%
          </p>
          <div className="mt-2 opacity-90 transition group-hover:opacity-100">
            <MultiResourceSparkline accent={accent} series={cpuPreviewSeries} />
          </div>
          {cpuPreviewLegend.length > 1 ? (
            <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 px-1">
              {cpuPreviewLegend.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex max-w-[9rem] items-center gap-1 text-[10px] text-[var(--fg-muted)]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.stroke }} />
                  <span className="truncate">{s.name}</span>
                </span>
              ))}
            </div>
          ) : null}
        </button>
        <button
          type="button"
          onClick={openMem}
          title={t("pages.index.memoryHistory")}
          className="group rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/50 p-2.5 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
        >
          <LinearProgress percent={memP} strokeColor={metricColor(memP, accent)} />
          <p className="mt-1.5 text-center text-xs">
            {t("pages.index.memory")} · {toFixed(memP, 0)}%
          </p>
          <p className="text-center text-[10px] opacity-80">
            {sizeFormat(st.mem.current)} / {sizeFormat(st.mem.total)}
          </p>
          <div className="mt-1 opacity-90 transition group-hover:opacity-100">
            <MultiResourceSparkline accent={ramSparkColor} series={memPreviewSeries} />
          </div>
          {memPreviewLegend.length > 1 ? (
            <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 px-1">
              {memPreviewLegend.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex max-w-[9rem] items-center gap-1 text-[10px] text-[var(--fg-muted)]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.stroke }} />
                  <span className="truncate">{s.name}</span>
                </span>
              ))}
            </div>
          ) : null}
        </button>
        <div className="rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/50 p-2.5 text-left">
          <LinearProgress percent={swP} strokeColor={metricColor(swP, accent)} />
          <p className="mt-1.5 text-center text-xs">
            {t("pages.index.swap")} · {toFixed(swP, 0)}%
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/50 p-2.5 text-left">
          <LinearProgress percent={dskP} strokeColor={metricColor(dskP, accent)} />
          <p className="mt-1.5 text-center text-xs">
            {t("pages.index.storage")} · {toFixed(dskP, 0)}%
          </p>
        </div>
      </div>
      {multi && nTot > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-3 text-center text-sm text-[var(--fg-muted)]">
          <LinearProgress
            percent={nP}
            strokeColor={metricColor(100 - nP, accent)}
          />
          <p className="mt-1">
            {t("pages.index.nodesAvailability")} {nOn} / {nTot}
          </p>
        </div>
      )}
      <div className="mt-3 border-t border-[var(--border)] pt-3 text-center text-xs text-[var(--fg-muted)]">
        <p className="font-medium text-[var(--fg-subtle)]">{t("pages.index.systemLoad")}</p>
        <p className="mt-1 font-mono text-[var(--fg)]">
          {st.loads?.map((l) => toFixed(l, 2)).join(" · ")}
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--fg-subtle)]">{t("pages.index.systemLoadDesc")}</p>
      </div>
    </ClassicRoot>
  );
}
