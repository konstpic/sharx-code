"use client";

import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { THEME_PALETTES, type ThemePalette } from "@/lib/themePalettes.generated";
import { SUB_PAGE_COLOR_PRESET_IDS, type SubPageColorPresetId } from "@/lib/subPageColorPreset";

const EXTRA_PALETTES: Record<string, ThemePalette> = {
  neon: { bg: "#07060f", "bg-elevated": "#100d22", "surface-strong": "rgba(28,22,66,.85)", border: "rgba(0,255,213,.1)", "border-strong": "rgba(0,255,213,.22)", fg: "#d9d6ff", "fg-muted": "#8d89c4", accent: "#00ffd5", "accent-ambient": "#ff2bd6" },
  sunset: { bg: "#1b0f14", "bg-elevated": "#2a151b", "surface-strong": "rgba(255,110,80,.22)", border: "rgba(255,150,90,.1)", "border-strong": "rgba(255,150,90,.22)", fg: "#ffe9dc", "fg-muted": "#e0a992", accent: "#ff8a4c", "accent-ambient": "#ff4d8d" },
};
const palette = (id: string) => THEME_PALETTES[id] ?? EXTRA_PALETTES[id];

/** A miniature customer-facing subscription page drawn with the preset's real colors. */
function SubPagePreview({ id }: { id: SubPageColorPresetId }) {
  const p = palette(id);
  if (!p) return null;
  const bar = (w: string, c: string, h = 3) => (
    <span className="block rounded-full" style={{ width: w, height: h, background: c }} />
  );
  return (
    <div
      aria-hidden
      className="relative h-[124px] w-full overflow-hidden rounded-lg px-2 py-1.5"
      style={{ background: p.bg, border: `1px solid ${p["border-strong"]}` }}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-3.5 rounded-full" style={{ background: `linear-gradient(135deg, ${p.accent}, ${p["accent-ambient"]})` }} />
        <div className="flex flex-1 flex-col gap-1">
          {bar("46%", p.fg, 3)}
          {bar("30%", p["fg-muted"], 2)}
        </div>
        <span className="h-2.5 w-6 rounded-full" style={{ background: p["surface-strong"], border: `1px solid ${p.border}` }} />
      </div>
      <div className="mt-2 rounded-md p-1.5" style={{ background: p["surface-strong"], border: `1px solid ${p.border}` }}>
        <div className="flex items-center justify-between">
          {bar("34%", p.fg, 3)}
          <span className="rounded-full px-1 text-[6px] font-semibold leading-3" style={{ background: p.accent, color: p.bg }}>
            active
          </span>
        </div>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full" style={{ background: p.border }}>
          <span className="block h-full w-[62%] rounded-full" style={{ background: `linear-gradient(90deg, ${p.accent}, ${p["accent-ambient"]})` }} />
        </span>
        <div className="mt-1 flex justify-between">
          {bar("22%", p["fg-muted"], 2)}
          {bar("18%", p["fg-muted"], 2)}
        </div>
      </div>
      <span className="mt-2 flex h-4 items-center justify-center rounded-md" style={{ background: p.accent }}>
        <span className="block rounded-full" style={{ width: "30%", height: 3, background: p.bg, opacity: 0.85 }} />
      </span>
      <div className="mt-1.5 flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-3 flex-1 rounded" style={{ background: p["bg-elevated"], border: `1px solid ${p.border}` }} />
        ))}
      </div>
    </div>
  );
}

export function SubPagePresetGallery({
  value,
  onChange,
}: {
  value: SubPageColorPresetId;
  onChange: (id: SubPageColorPresetId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t("subBuilder.branding.colorPreset", { defaultValue: "Color palette" })}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
    >
      {SUB_PAGE_COLOR_PRESET_IDS.map((id) => {
        const selected = id === value;
        const p = palette(id);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(id)}
            className={`flex flex-col gap-2 rounded-xl border p-2 text-left transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              selected
                ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] shadow-[0_0_0_1px_var(--accent)]"
                : "border-[var(--border)] panel-inset hover:border-[var(--border-strong)]"
            }`}
          >
            <SubPagePreview id={id} />
            <span className="flex items-center justify-between gap-2 px-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex shrink-0 -space-x-1">
                  {[p?.accent, p?.["accent-ambient"]].map((c, i) => (
                    <span key={i} className="size-3 rounded-full ring-1 ring-[var(--border)]" style={{ background: c }} />
                  ))}
                </span>
                <span className="truncate text-xs font-medium text-[var(--fg)]">{t(`pages.settings.panelThemePreset.${id}`, { defaultValue: id })}</span>
              </span>
              {selected ? <Check size={14} className="shrink-0 text-[var(--accent)]" aria-hidden /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
