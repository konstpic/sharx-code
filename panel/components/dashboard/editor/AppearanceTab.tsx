"use client";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { FRAME_PRESETS, type FramePreset, type MyStyle, type TileStyle } from "@/lib/dashboardStyle";
import { ColorField, Choice, Section, Select, Slider, Toggle } from "./controls";
import { StyleSwatch } from "./StyleSwatch";
import type { TabProps } from "./types";

type Props = TabProps & {
  presetOf: FramePreset;
  myStyles: MyStyle[];
  onPreset: (p: FramePreset) => void;
  onApplyMine: (s: MyStyle) => void;
  onDeleteMine: (id: string) => void;
};

/** Tab "Оформление": preset row with live miniatures, my styles, background, blur, border, radius, shadow, padding, glow. */
export function AppearanceTab({ r, patch, myStyles, onPreset, onApplyMine, onDeleteMine, presetOf }: Props) {
  const { t } = useTranslation();
  const chip = (key: string, label: string, style: TileStyle | undefined, on: boolean, onClick: () => void, extra?: ReactNode) => (
    <div key={key} className="relative">
      <button
        type="button"
        aria-pressed={on}
        onClick={onClick}
        className={`block w-full space-y-1 rounded-xl border p-1.5 text-center transition ${on ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]" : "border-[var(--border)] hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]"}`}
      >
        <StyleSwatch style={style} />
        <span className={`block truncate text-[11px] ${on ? "font-semibold text-[var(--fg)]" : "text-[var(--fg-muted)]"}`}>{label}</span>
      </button>
      {extra}
    </div>
  );
  return (
    <div className="space-y-4">
      <Section title={t("pages.builder.style.presets")} hint={t("pages.builder.style.presetsHint")}>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("pages.builder.style.presets")}>
          {FRAME_PRESETS.map((p) => chip(p, t(`pages.builder.style.preset_${p}`), p === "default" ? undefined : { preset: p }, presetOf === p, () => onPreset(p)))}
        </div>
        {myStyles.length ? (
          <>
            <p className="pt-1 text-xs text-[var(--fg-muted)]">{t("pages.builder.style.myStyles")}</p>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("pages.builder.style.myStyles")}>
              {myStyles.map((m) =>
                chip(
                  m.id,
                  m.name,
                  m.style,
                  false,
                  () => onApplyMine(m),
                  <button
                    type="button"
                    onClick={() => onDeleteMine(m.id)}
                    aria-label={`${t("pages.builder.style.deleteMine")}: ${m.name}`}
                    title={`${t("pages.builder.style.deleteMine")}: ${m.name}`}
                    className="absolute right-1 top-1 z-10 grid size-5 place-items-center rounded-md bg-[var(--bg-elevated)] text-[var(--fg-subtle)] opacity-80 hover:text-[var(--danger,#ef4444)] focus-visible:opacity-100"
                  >
                    <Trash2 size={11} />
                  </button>,
                ),
              )}
            </div>
          </>
        ) : null}
      </Section>
      <Section title={t("pages.builder.style.background")}>
        <Choice
          label={t("pages.builder.style.background")}
          value={r.bg.mode}
          options={[
            { id: "default", label: t("pages.builder.style.bgDefault") },
            { id: "transparent", label: t("pages.builder.style.bgTransparent") },
            { id: "solid", label: t("pages.builder.style.bgSolid") },
            { id: "gradient", label: t("pages.builder.style.bgGradient") },
          ]}
          onChange={(mode) => patch({ bg: { mode } })}
        />
        {r.bg.mode === "solid" || r.bg.mode === "gradient" ? (
          <>
            <ColorField label={t("pages.builder.style.bgColor")} value={r.bg.color.startsWith("#") ? r.bg.color : undefined} fallback="#1e293b" clearLabel={t("pages.builder.style.themeColor")} onChange={(color) => patch({ bg: { color: color ?? "surface" } })} />
            {r.bg.mode === "gradient" ? (
              <>
                <ColorField label={t("pages.builder.style.bgColor2")} value={r.bg.color2.startsWith("#") ? r.bg.color2 : undefined} fallback="#334155" clearLabel={t("pages.builder.style.themeColor")} onChange={(color2) => patch({ bg: { color2: color2 ?? "surface" } })} />
                <Slider label={t("pages.builder.style.angle")} value={r.bg.angle} min={0} max={360} step={5} def={135} unit="°" onChange={(angle) => patch({ bg: { angle } })} />
              </>
            ) : null}
            <Slider label={t("pages.builder.style.opacity")} value={r.bg.opacity} min={0} max={100} def={100} unit=" %" onChange={(opacity) => patch({ bg: { opacity } })} />
          </>
        ) : null}
        <Slider label={t("pages.builder.style.blur")} value={r.blur} min={0} max={24} def={0} unit=" px" onChange={(blur) => patch({ blur })} />
      </Section>
      <Section title={t("pages.builder.style.border")}>
        <Toggle label={t("pages.builder.style.borderShow")} checked={r.border.show} onChange={(show) => patch({ border: { show } })} />
        {r.border.show ? (
          <>
            <Slider label={t("pages.builder.style.borderWidth")} value={r.border.width} min={0} max={6} def={1} unit=" px" onChange={(width) => patch({ border: { width } })} />
            <Select
              label={t("pages.builder.style.borderStyle")}
              value={r.border.style}
              options={[
                { id: "solid", label: t("pages.builder.style.solid") },
                { id: "dashed", label: t("pages.builder.style.dashed") },
                { id: "dotted", label: t("pages.builder.style.dotted") },
              ]}
              onChange={(style) => patch({ border: { style } })}
            />
            <ColorField label={t("pages.builder.style.borderColor")} value={r.border.color.startsWith("#") ? r.border.color : undefined} fallback="#64748b" onChange={(color) => patch({ border: { color: color ?? "" } })} />
            <Slider label={t("pages.builder.style.opacity")} value={r.border.opacity} min={0} max={100} def={100} unit=" %" onChange={(opacity) => patch({ border: { opacity } })} />
          </>
        ) : null}
      </Section>
      <Section title={t("pages.builder.style.shape")}>
        <Slider label={t("pages.builder.style.radius")} value={r.radius} min={0} max={32} def={16} unit=" px" onChange={(radius) => patch({ radius })} />
        <Select
          label={t("pages.builder.style.shadow")}
          value={r.shadow}
          options={[
            { id: "default", label: t("pages.builder.style.shadowDefault") },
            { id: "none", label: t("pages.builder.style.shadowNone") },
            { id: "sm", label: t("pages.builder.style.shadowSm") },
            { id: "md", label: t("pages.builder.style.shadowMd") },
            { id: "lg", label: t("pages.builder.style.shadowLg") },
            { id: "glow", label: t("pages.builder.style.shadowGlow") },
          ]}
          onChange={(shadow) => patch({ shadow })}
        />
        <Choice
          label={t("pages.builder.style.padding")}
          value={r.padding}
          options={[
            { id: "compact", label: t("pages.builder.style.padCompact") },
            { id: "normal", label: t("pages.builder.style.padNormal") },
            { id: "roomy", label: t("pages.builder.style.padRoomy") },
          ]}
          onChange={(padding) => patch({ padding })}
        />
        <Toggle label={t("pages.builder.style.accentGlow")} checked={r.accentGlow} onChange={(accentGlow) => patch({ accentGlow })} />
      </Section>
    </div>
  );
}
