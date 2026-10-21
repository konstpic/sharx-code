"use client";
import { useTranslation } from "react-i18next";
import { ColorField, Choice, Section, Slider, Toggle } from "./controls";
import { ACCENT_SWATCHES, type TabProps } from "./types";

/** Tab "Цвета": accent + hue shift, secondary accent, value / label / track colours, colour mode and level colours. */
export function ColorsTab({ r, patch, metric }: TabProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Section title={t("pages.builder.style.accent")} hint={t("pages.builder.style.accentHint")}>
        <ColorField label={t("pages.builder.color")} value={r.accent} swatches={ACCENT_SWATCHES} onChange={(accent) => patch({ accent })} />
        <Slider label={t("pages.builder.style.hue")} value={r.hue} min={-180} max={180} def={0} unit="°" onChange={(hue) => patch({ hue })} />
        <span
          aria-hidden
          className="block h-2 rounded-full"
          style={{ background: "linear-gradient(90deg, hsl(0 80% 60%), hsl(60 80% 60%), hsl(120 80% 60%), hsl(180 80% 60%), hsl(240 80% 60%), hsl(300 80% 60%), hsl(360 80% 60%))" }}
        />
        <ColorField label={t("pages.builder.style.accent2")} value={r.accent2} swatches={ACCENT_SWATCHES} onChange={(accent2) => patch({ accent2 })} />
      </Section>
      <Section title={t("pages.builder.style.textColors")}>
        {metric ? <ColorField label={t("pages.builder.style.valueColor")} value={r.valueColor} onChange={(valueColor) => patch({ valueColor })} /> : null}
        <ColorField label={t("pages.builder.style.labelColor")} value={r.labelColor} onChange={(labelColor) => patch({ labelColor })} />
        {metric ? <ColorField label={t("pages.builder.style.trackColor")} value={r.trackColor} onChange={(trackColor) => patch({ trackColor })} /> : null}
      </Section>
      {metric ? (
        <Section title={t("pages.builder.style.colorMode")} hint={t("pages.builder.style.colorModeHint")}>
          <Choice
            label={t("pages.builder.style.colorMode")}
            value={r.colorMode}
            options={[
              { id: "thresholds", label: t("pages.builder.style.modeThresholds") },
              { id: "fixed", label: t("pages.builder.style.modeFixed") },
              { id: "gradient-by-value", label: t("pages.builder.style.modeGradient") },
            ]}
            onChange={(colorMode) => patch({ colorMode })}
          />
          {r.colorMode !== "fixed" ? (
            <div className="space-y-3">
              <ColorField label={t("pages.builder.style.levelOk")} value={r.levelColors.ok} onChange={(ok) => patch({ levelColors: { ok } })} clearLabel={t("pages.builder.style.accent")} />
              <ColorField label={t("pages.builder.style.levelWarn")} value={r.levelColors.warn} fallback="#f59e0b" swatches={["#f59e0b", "#eab308", "#fb923c"]} onChange={(warn) => patch({ levelColors: { warn } })} clearLabel={t("pages.builder.style.defaultColor")} />
              <ColorField label={t("pages.builder.style.levelCrit")} value={r.levelColors.crit} fallback="#ef4444" swatches={["#ef4444", "#dc2626", "#f43f5e"]} onChange={(crit) => patch({ levelColors: { crit } })} clearLabel={t("pages.builder.style.defaultColor")} />
              <Toggle label={t("pages.builder.style.invertThresholds")} checked={r.invertThresholds} onChange={(invertThresholds) => patch({ invertThresholds })} hint={t("pages.builder.style.invertHint")} />
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
