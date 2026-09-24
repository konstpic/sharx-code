"use client";

import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { THEME_PALETTES } from "@/lib/themePalettes.generated";
import { PANEL_THEME_IDS, type PanelThemeId } from "@/lib/panelTheme";

/** A miniature panel drawn with the theme's real colors: navbar, sidebar, cards, accent button. */
function ThemePreview({ id }: { id: PanelThemeId }) {
  const p = THEME_PALETTES[id];
  if (!p) return null;
  const line = (w: string, color: string, h = 4) => (
    <span className="block rounded-full" style={{ width: w, height: h, background: color }} />
  );
  return (
    <div
      aria-hidden
      className="relative h-[92px] w-full overflow-hidden rounded-lg"
      style={{ background: p.bg, border: `1px solid ${p["border-strong"]}` }}
    >
      <div className="flex h-4 items-center gap-1 px-2" style={{ background: p["bg-elevated"], borderBottom: `1px solid ${p.border}` }}>
        <span className="size-1.5 rounded-full" style={{ background: p.accent }} />
        {line("22%", p["fg-muted"], 3)}
      </div>
      <div className="flex h-[calc(100%-1rem)]">
        <div className="flex w-[26%] flex-col gap-1.5 p-1.5" style={{ background: p["bg-elevated"], borderRight: `1px solid ${p.border}` }}>
          <span className="block h-2 rounded" style={{ background: p.accent, opacity: 0.9 }} />
          {line("80%", p["fg-muted"], 3)}
          {line("64%", p["fg-muted"], 3)}
          {line("72%", p["fg-muted"], 3)}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-1.5">
          <div className="rounded-md p-1.5" style={{ background: p["surface-strong"], border: `1px solid ${p.border}` }}>
            {line("55%", p.fg, 4)}
            <span className="mt-1 block" />
            {line("85%", p["fg-muted"], 3)}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="block h-3.5 w-9 rounded" style={{ background: p.accent }} />
            <span className="block h-3.5 w-6 rounded" style={{ background: p["accent-ambient"], opacity: 0.85 }} />
            <span className="block h-3.5 flex-1 rounded" style={{ background: p["surface-strong"], border: `1px solid ${p.border}` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeGallery({
  value,
  onChange,
}: {
  value: PanelThemeId;
  onChange: (id: PanelThemeId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t("pages.settings.panelTheme")} className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
      {PANEL_THEME_IDS.map((id) => {
        const selected = id === value;
        const p = THEME_PALETTES[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(id)}
            className={`group flex flex-col gap-2 rounded-xl border p-2 text-left transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              selected
                ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] shadow-[0_0_0_1px_var(--accent)]"
                : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]"
            }`}
          >
            <ThemePreview id={id} />
            <span className="flex items-center justify-between gap-2 px-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex shrink-0 -space-x-1">
                  {[p?.accent, p?.["accent-ambient"]].map((c, i) => (
                    <span key={i} className="size-3 rounded-full ring-1 ring-[var(--border)]" style={{ background: c }} />
                  ))}
                </span>
                <span className="truncate text-xs font-medium text-[var(--fg)]">
                  {t(`pages.settings.panelThemePreset.${id}`)}
                </span>
              </span>
              {selected ? <Check size={14} className="shrink-0 text-[var(--accent)]" aria-hidden /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
