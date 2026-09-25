"use client";

import { Check as CheckIcon } from "lucide-react";
import shell from "@/components/sub/subscription-shell.module.css";
import type { SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";
import { SUB_PAGE_COLOR_PRESET_IDS, resolveSubPageColorPreset } from "@/lib/subPageColorPreset";
import type { D } from "./i18n";
import { ColorInput, Row, Seg } from "./ui";

const NAMES: Record<string, [string, string]> = {
  web: ["SharX Web", "SharX Web"],
  default: ["Default", "По умолчанию"],
  midnight: ["Midnight", "Полночь"],
  ember: ["Ember", "Угли"],
  boreal: ["Boreal", "Северное сияние"],
  xuiClassic: ["SharX Classic", "SharX Classic"],
  starWars: ["Star Wars", "Star Wars"],
  vision: ["Liquid glass", "Жидкое стекло"],
  helloKitty: ["Hello Kitty", "Hello Kitty"],
  barbie: ["Barbie", "Barbie"],
  neon: ["Neon", "Неон"],
  sunset: ["Sunset", "Закат"],
};

type Props = { config: SharxSubpageConfigV2; onChange: (c: SharxSubpageConfigV2) => void; d: D; lang: string };

function Mini({ id }: { id: string }) {
  return (
    <div className={shell.root} data-color-preset={id} style={{ minHeight: 0, height: 74, background: "var(--sub-bg)", color: "var(--sub-fg)", overflow: "hidden", borderRadius: 10, position: "relative", pointerEvents: "none" }} aria-hidden>
      <div style={{ padding: 8, display: "grid", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--sub-accent)" }} />
          <span style={{ height: 4, width: 44, borderRadius: 4, background: "var(--sub-fg-muted)", opacity: 0.6 }} />
        </div>
        <div style={{ borderRadius: 8, padding: 6, background: "var(--sub-surface, rgba(255,255,255,.06))", border: "1px solid var(--sub-border)" }}>
          <div style={{ height: 5, width: "60%", borderRadius: 4, background: "var(--sub-fg-strong, var(--sub-fg))" }} />
          <div style={{ height: 4, width: "85%", borderRadius: 4, background: "var(--sub-fg-muted)", opacity: 0.6, marginTop: 4 }} />
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          <span style={{ height: 10, width: 34, borderRadius: 6, background: "var(--sub-accent)" }} />
          <span style={{ height: 10, width: 22, borderRadius: 6, background: "var(--sub-accent-ambient, var(--sub-accent))", opacity: 0.8 }} />
        </div>
      </div>
    </div>
  );
}

export function StylesPanel({ config, onChange, d, lang }: Props) {
  const current = resolveSubPageColorPreset(config.colorPreset);
  const branding = (config.branding ?? {}) as Record<string, unknown>;
  const setBranding = (patch: Record<string, unknown>) => onChange({ ...config, branding: { ...branding, ...patch } } as SharxSubpageConfigV2);
  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("st.palette", "Palette")}</div>
        <div className="grid grid-cols-2 gap-2">
          {SUB_PAGE_COLOR_PRESET_IDS.map((id) => (
            <button key={id} type="button" onClick={() => onChange({ ...config, colorPreset: id })} aria-pressed={current === id} className={`overflow-hidden rounded-xl border p-1.5 text-left transition-colors ${current === id ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]" : "border-[var(--border)] hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]"}`}>
              <Mini id={id} />
              <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11.5px] font-medium">
                <span className="truncate">{(NAMES[id] ?? [id, id])[lang === "ru" ? 1 : 0]}</span>
                {current === id ? <CheckIcon size={13} className="text-[var(--accent)]" /> : null}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("st.mode", "Appearance")}</div>
        <Seg value={(config.theme as string) ?? "system"} onChange={(v) => onChange({ ...config, theme: v } as SharxSubpageConfigV2)} items={[{ id: "system", label: d("st.system", "Auto") }, { id: "light", label: d("st.light", "Light") }, { id: "dark", label: d("st.dark", "Dark") }]} />
      </div>
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("st.background", "Background")}</div>
        <Seg value={(branding.background as string) === "plain" ? "plain" : "animated"} onChange={(v) => setBranding({ background: v })} items={[{ id: "animated", label: d("st.bgAnimated", "Animated") }, { id: "plain", label: d("st.bgPlain", "Plain") }]} />
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-[var(--fg-muted)]">
          <input type="checkbox" checked={branding.decorations !== false} disabled={(branding.background as string) === "plain"} onChange={(e) => setBranding({ decorations: e.target.checked })} />
          {d("st.decor", "Palette decorations (bows, sparkles, grid)")}
        </label>
      </div>
      <div className="space-y-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("st.override", "Override colors")}</div>
        <Row label={d("st.accent", "Accent")}>
          <ColorInput value={(branding.accentColor as string) || undefined} onChange={(v) => setBranding({ accentColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
        <Row label={d("st.bg", "Background")}>
          <ColorInput value={(branding.bgColor as string) || undefined} onChange={(v) => setBranding({ bgColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
        <Row label={d("st.text", "Text")}>
          <ColorInput value={(branding.fgColor as string) || undefined} onChange={(v) => setBranding({ fgColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
        <Row label={d("st.ambient", "Accent 2")}>
          <ColorInput value={(branding.accentAmbientColor as string) || undefined} onChange={(v) => setBranding({ accentAmbientColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
        <Row label={d("st.bgElevated", "Panels")}>
          <ColorInput value={(branding.bgElevatedColor as string) || undefined} onChange={(v) => setBranding({ bgElevatedColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
        <Row label={d("st.fgMuted", "Muted text")}>
          <ColorInput value={(branding.fgMutedColor as string) || undefined} onChange={(v) => setBranding({ fgMutedColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
        <Row label={d("st.border", "Border")}>
          <ColorInput value={(branding.borderColor as string) || undefined} onChange={(v) => setBranding({ borderColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
        <Row label={d("st.success", "Success")}>
          <ColorInput value={(branding.successColor as string) || undefined} onChange={(v) => setBranding({ successColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
        <Row label={d("st.danger", "Danger")}>
          <ColorInput value={(branding.dangerColor as string) || undefined} onChange={(v) => setBranding({ dangerColor: v ?? "" })} placeholder={d("st.fromPalette", "from palette")} />
        </Row>
      </div>
    </div>
  );
}
