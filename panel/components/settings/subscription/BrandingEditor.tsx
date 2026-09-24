"use client";

import { useTranslation } from "react-i18next";
import { Input, SelectNative } from "@/components/ui";
import { SubPagePresetGallery } from "@/components/settings/subscription/SubPagePresetGallery";
import type { SharxBranding, SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";

type Props = {
  config: SharxSubpageConfigV2;
  onChange: (next: SharxSubpageConfigV2) => void;
};

const accentPresets = [
  "#22d3ee",
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fb923c",
  "#f87171",
];

type PaletteFieldKey =
  | "accentColor"
  | "accentAmbientColor"
  | "bgColor"
  | "bgElevatedColor"
  | "fgColor"
  | "fgMutedColor"
  | "borderColor"
  | "successColor"
  | "dangerColor";

type PaletteField = {
  key: PaletteFieldKey;
  label: string;
  defaultValue: string;
};

export function BrandingEditor({ config, onChange }: Props) {
  const { t } = useTranslation();

  const setBranding = (patch: Partial<SharxBranding>) =>
    onChange({ ...config, branding: { ...config.branding, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <Field
        label={t("subBuilder.branding.title", { defaultValue: "Page title" })}
      >
        <Input
          value={config.branding.title}
          onChange={(e) => setBranding({ title: e.target.value })}
          placeholder="Subscription"
        />
      </Field>

      <Field
        label={t("subBuilder.branding.logoUrl", { defaultValue: "Logo URL" })}
        hint={t("subBuilder.branding.logoUrlHint", {
          defaultValue: "Leave empty to use the built-in icon.",
        })}
      >
        <Input
          value={config.branding.logoUrl}
          onChange={(e) => setBranding({ logoUrl: e.target.value })}
          placeholder="https://example.com/logo.svg"
          type="url"
        />
      </Field>

      <Field
        label={t("subBuilder.branding.brandText", { defaultValue: "Brand tagline" })}
      >
        <Input
          value={config.branding.brandText}
          onChange={(e) => setBranding({ brandText: e.target.value })}
          placeholder="Secure VPN • Stay private"
        />
      </Field>

      <Field
        label={t("subBuilder.branding.supportUrl", { defaultValue: "Support URL" })}
        hint={t("subBuilder.branding.supportUrlHint", {
          defaultValue: "Telegram, Discord, VK or a generic link.",
        })}
      >
        <Input
          value={config.branding.supportUrl}
          onChange={(e) => setBranding({ supportUrl: e.target.value })}
          placeholder="https://t.me/your_channel"
          type="url"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t("subBuilder.branding.accentColor", { defaultValue: "Accent color" })}
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={config.branding.accentColor || "#22d3ee"}
              onChange={(e) => setBranding({ accentColor: e.target.value })}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border border-[var(--border)] bg-transparent"
              aria-label={t("subBuilder.branding.accentColor", {
                defaultValue: "Accent color",
              })}
            />
            <Input
              value={config.branding.accentColor || ""}
              onChange={(e) => setBranding({ accentColor: e.target.value })}
              placeholder="#22d3ee"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {accentPresets.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Preset ${c}`}
                onClick={() => setBranding({ accentColor: c })}
                className="size-6 rounded-full border border-[var(--border)] transition-transform hover:scale-110"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>

        <Field label={t("subBuilder.branding.theme", { defaultValue: "Theme" })}>
          <SelectNative
            value={config.theme}
            onChange={(e) => onChange({ ...config, theme: e.target.value })}
          >
            <option value="system">
              {t("subBuilder.branding.themeSystem", { defaultValue: "System" })}
            </option>
            <option value="dark">
              {t("subBuilder.branding.themeDark", { defaultValue: "Dark" })}
            </option>
            <option value="light">
              {t("subBuilder.branding.themeLight", { defaultValue: "Light" })}
            </option>
          </SelectNative>
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
            {t("subBuilder.branding.colorPreset", { defaultValue: "Color palette" })}
          </div>
          <SubPagePresetGallery
            value={config.colorPreset}
            onChange={(id) => onChange({ ...config, colorPreset: id })}
          />
          <p className="mt-1.5 text-[11px] text-[var(--fg-subtle)]">
            {t("subBuilder.branding.colorPresetHint", {
              defaultValue:
                "Same presets as the panel appearance. Applies to dark style; light mode keeps the standard light shell.",
            })}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
          {t("subBuilder.branding.palette", { defaultValue: "Palette fine-tuning" })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([
            {
              key: "accentAmbientColor",
              label: t("subBuilder.branding.accentAmbient", {
                defaultValue: "Accent ambient",
              }),
              defaultValue: "#9775fa",
            },
            {
              key: "bgColor",
              label: t("subBuilder.branding.bg", { defaultValue: "Background" }),
              defaultValue: "#0d1117",
            },
            {
              key: "bgElevatedColor",
              label: t("subBuilder.branding.bgElevated", {
                defaultValue: "Background elevated",
              }),
              defaultValue: "#161b22",
            },
            {
              key: "fgColor",
              label: t("subBuilder.branding.fg", { defaultValue: "Foreground" }),
              defaultValue: "#c9d1d9",
            },
            {
              key: "fgMutedColor",
              label: t("subBuilder.branding.fgMuted", { defaultValue: "Foreground muted" }),
              defaultValue: "#8b949e",
            },
            {
              key: "borderColor",
              label: t("subBuilder.branding.border", { defaultValue: "Border" }),
              defaultValue: "rgba(255,255,255,0.08)",
            },
            {
              key: "successColor",
              label: t("subBuilder.branding.success", { defaultValue: "Success" }),
              defaultValue: "#34d399",
            },
            {
              key: "dangerColor",
              label: t("subBuilder.branding.danger", { defaultValue: "Danger" }),
              defaultValue: "#f87171",
            },
          ] as PaletteField[]).map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-[var(--fg-subtle)]">
                {f.label}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.branding[f.key] || f.defaultValue}
                  onChange={(e) => setBranding({ [f.key]: e.target.value })}
                  className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent"
                  aria-label={f.label}
                />
                <Input
                  value={config.branding[f.key] || ""}
                  onChange={(e) => setBranding({ [f.key]: e.target.value })}
                  placeholder={f.defaultValue}
                />
              </div>
            </label>
          ))}
        </div>
      </div>

      <Field
        label={t("subBuilder.branding.locales", { defaultValue: "Locales (comma-separated)" })}
      >
        <Input
          value={config.locales.join(", ")}
          onChange={(e) =>
            onChange({
              ...config,
              locales: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            })
          }
          placeholder="en, ru"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
        {label}
      </div>
      {children}
      {hint ? (
        <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">{hint}</p>
      ) : null}
    </label>
  );
}
