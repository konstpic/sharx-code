"use client";

import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui";
import type { SharxBranding, SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";

type Props = {
  config: SharxSubpageConfigV2;
  onChange: (next: SharxSubpageConfigV2) => void;
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
