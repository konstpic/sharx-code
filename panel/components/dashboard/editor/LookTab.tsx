"use client";
import { useTranslation } from "react-i18next";
import { CheckboxField } from "@/components/ui";
import { RANGE_VIEWS } from "@/components/dashboard/CustomMetricPanel";
import { ViewPicker } from "../ViewPicker";
import type { TileSettings } from "@/lib/dashboardBuilder";
import { Section, Slider, Toggle } from "./controls";
import type { TabProps } from "./types";

const CHART_VIEWS = ["line", "area", "bar"];

/** Tab "Вид": the 16 looks and the options that belong to the chosen look. */
export function LookTab({ settings, onSettings, mixed, r, patch }: TabProps & { settings: TileSettings; onSettings: (p: Partial<TileSettings>) => void; mixed: boolean }) {
  const { t } = useTranslation();
  const view = settings.view;
  return (
    <div className="space-y-4">
      <ViewPicker value={view} onChange={(v) => onSettings({ view: v })} color={r.accent ?? settings.color} />
      {mixed && CHART_VIEWS.includes(view) ? <p className="text-xs text-[var(--danger)]">{t("pages.builder.sameUnits")}</p> : null}
      {CHART_VIEWS.includes(view) ? (
        <Section title={t("pages.builder.style.lookOptions")}>
          <CheckboxField label={t("pages.builder.fixedScale")} checked={settings.fixedScale === true} onChange={(e) => onSettings({ fixedScale: e.target.checked })} />
          <Toggle label={t("pages.builder.style.grid")} checked={r.grid} onChange={(grid) => patch({ grid })} />
        </Section>
      ) : null}
      {["progress", "split"].includes(view) ? (
        <Section title={t("pages.builder.style.lookOptions")}>
          <Slider label={t("pages.builder.style.barHeight")} value={r.barHeight ?? 0} min={0} max={40} def={0} auto unit=" px" onChange={(v) => patch({ barHeight: v ? Math.max(4, v) : undefined })} />
        </Section>
      ) : null}
      {["gauge", "radial", "donut", "semi"].includes(view) ? (
        <Section title={t("pages.builder.style.lookOptions")} hint={t("pages.builder.style.moreInCharts")}>
          <Slider label={t("pages.builder.style.thickness")} value={r.gauge.thickness ?? 0} min={0} max={30} def={0} auto unit=" %" onChange={(v) => patch({ gauge: { thickness: v ? Math.max(4, v) : undefined } })} />
        </Section>
      ) : null}
      {RANGE_VIEWS.includes(view) ? <p className="text-[11px] text-[var(--fg-subtle)]">{t("pages.builder.style.rangeHint")}</p> : null}
    </div>
  );
}
