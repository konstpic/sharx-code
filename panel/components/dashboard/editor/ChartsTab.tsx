"use client";
import { useTranslation } from "react-i18next";
import { Choice, Section, Select, Slider, Toggle } from "./controls";
import type { TabProps } from "./types";

/** Tab "Графики": sparkline / chart series options, gauge ring options, bar height, chart grid. */
export function ChartsTab({ r, patch }: TabProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Section title={t("pages.builder.style.spark")} hint={t("pages.builder.style.sparkHint")}>
        <Toggle label={t("pages.builder.style.sparkShow")} checked={r.spark.show} onChange={(show) => patch({ spark: { show } })} />
        <Slider label={t("pages.builder.style.sparkWindow")} value={r.spark.window} min={10} max={300} step={10} def={300} unit={` ${t("pages.builder.style.points")}`} onChange={(window) => patch({ spark: { window } })} />
        <Choice
          label={t("pages.builder.style.curve")}
          value={r.spark.curve}
          options={[
            { id: "smooth", label: t("pages.builder.style.curveSmooth") },
            { id: "linear", label: t("pages.builder.style.curveLinear") },
            { id: "step", label: t("pages.builder.style.curveStep") },
          ]}
          onChange={(curve) => patch({ spark: { curve } })}
        />
        <Slider label={t("pages.builder.style.strokeWidth")} value={r.spark.strokeWidth} min={1} max={4} step={0.1} def={1.8} unit=" px" onChange={(strokeWidth) => patch({ spark: { strokeWidth } })} />
        <Toggle label={t("pages.builder.style.fill")} checked={r.spark.fill} onChange={(fill) => patch({ spark: { fill } })} />
        <Toggle label={t("pages.builder.style.markers")} checked={r.spark.markers} onChange={(markers) => patch({ spark: { markers } })} />
        <Toggle label={t("pages.builder.style.grid")} checked={r.grid} onChange={(grid) => patch({ grid })} />
      </Section>
      <Section title={t("pages.builder.style.gauge")} hint={t("pages.builder.style.gaugeHint")}>
        <Slider label={t("pages.builder.style.thickness")} value={r.gauge.thickness ?? 0} min={0} max={30} def={0} auto unit=" %" onChange={(v) => patch({ gauge: { thickness: v ? Math.max(4, v) : undefined } })} />
        <Select
          label={t("pages.builder.style.arc")}
          value={r.gauge.arc ?? 0}
          options={[
            { id: 0, label: t("pages.builder.style.auto") },
            { id: 180, label: "180°" },
            { id: 240, label: "240°" },
            { id: 270, label: "270°" },
            { id: 360, label: "360°" },
          ]}
          onChange={(arc) => patch({ gauge: { arc: arc || undefined } })}
        />
        <Toggle label={t("pages.builder.style.roundCaps")} checked={r.gauge.roundCaps} onChange={(roundCaps) => patch({ gauge: { roundCaps } })} />
        <Toggle label={t("pages.builder.style.ticks")} checked={r.gauge.ticks} onChange={(ticks) => patch({ gauge: { ticks } })} />
      </Section>
      <Section title={t("pages.builder.style.bars")}>
        <Slider label={t("pages.builder.style.barHeight")} value={r.barHeight ?? 0} min={0} max={40} def={0} auto unit=" px" onChange={(v) => patch({ barHeight: v ? Math.max(4, v) : undefined })} />
      </Section>
    </div>
  );
}
