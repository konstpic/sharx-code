"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton, Input, SelectNative, Switch } from "@/components/ui";
import {
  defaultResponseRules,
  type ResponseHeaderDelivery,
  type ResponseRules,
  type SharxSubpageConfigV2,
} from "@/lib/sharxSubpageConfig";

type Props = {
  config: SharxSubpageConfigV2;
  onChange: (next: SharxSubpageConfigV2) => void;
};

const DELIVERY_OPTIONS: ResponseHeaderDelivery[] = ["header", "body", "both", "none"];

function deliveryLabel(t: (key: string, opts?: { defaultValue?: string }) => string, opt: ResponseHeaderDelivery) {
  const defaults: Record<ResponseHeaderDelivery, string> = {
    header: "HTTP header",
    body: "Body comment",
    both: "Header + body",
    none: "Disabled",
  };
  return t(`subBuilder.responseRules.extraHeaderDelivery.${opt}`, { defaultValue: defaults[opt] });
}

function DeliverySelect({
  value,
  onChange,
}: {
  value: ResponseHeaderDelivery;
  onChange: (v: ResponseHeaderDelivery) => void;
}) {
  const { t } = useTranslation();
  return (
    <SelectNative
      value={value}
      onChange={(e) => onChange(e.target.value as ResponseHeaderDelivery)}
      aria-label={t("subBuilder.responseRules.deliveryLabel", {
        defaultValue: "Delivery method",
      })}
    >
      {DELIVERY_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {deliveryLabel(t, opt)}
        </option>
      ))}
    </SelectNative>
  );
}

export function ResponseRulesEditor({ config, onChange }: Props) {
  const { t } = useTranslation();
  const rules: ResponseRules = config.responseRules ?? defaultResponseRules();

  const set = (patch: Partial<ResponseRules>) =>
    onChange({ ...config, responseRules: { ...rules, ...patch } });

  const setHeader = (
    idx: number,
    patch: Partial<{ key: string; value: string; delivery: ResponseHeaderDelivery }>,
  ) => {
    const next = rules.extraHeaders.map((h, i) => (i === idx ? { ...h, ...patch } : h));
    set({ extraHeaders: next });
  };

  const addHeader = () =>
    set({
      extraHeaders: [...rules.extraHeaders, { key: "", value: "", delivery: "header" }],
    });

  const removeHeader = (idx: number) =>
    set({ extraHeaders: rules.extraHeaders.filter((_, i) => i !== idx) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--fg)]">
            {t("subBuilder.responseRules.mtProtoToggle", {
              defaultValue: "MTProto on subscription page",
            })}
          </div>
          <p className="mt-1 text-xs text-[var(--fg-subtle)]">
            {t("subBuilder.responseRules.mtProtoToggleHint", {
              defaultValue:
                "When the subscription includes Telegram MTProto (Telemt) links, show a helper next to the installation guide with tg:// open, QR, and copy — same idea as connection keys.",
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium text-[var(--fg-muted)]">
            {t("subBuilder.responseRules.mtProtoToggleLabel", { defaultValue: "Show MTProto block" })}
          </span>
          <Switch
            checked={rules.mtProtoEnabled !== false}
            onChange={(on) => set({ mtProtoEnabled: on })}
          />
        </div>
      </div>

      <ParamRow
        label={t("subBuilder.responseRules.profileTitle", { defaultValue: "Profile title" })}
        hint={t("subBuilder.responseRules.profileTitleHint", {
          defaultValue: "Sent as Profile-Title (base64). Happ allows up to 25 chars.",
        })}
        delivery={rules.profileTitleDelivery ?? "header"}
        onDeliveryChange={(delivery) => set({ profileTitleDelivery: delivery })}
      >
        <Input
          value={rules.profileTitle}
          onChange={(e) => set({ profileTitle: e.target.value })}
          placeholder={t("subBuilder.responseRules.profileTitlePlaceholder")}
          maxLength={200}
        />
      </ParamRow>

      <ParamRow
        label={t("subBuilder.responseRules.updateInterval", {
          defaultValue: "Profile update interval (hours)",
        })}
        delivery={rules.profileUpdateIntervalDelivery ?? "header"}
        onDeliveryChange={(delivery) => set({ profileUpdateIntervalDelivery: delivery })}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={rules.profileUpdateInterval}
          onChange={(e) =>
            set({
              profileUpdateInterval: Math.max(0, parseInt(e.target.value || "0", 10) || 0),
            })
          }
          placeholder={t("subBuilder.responseRules.updateIntervalPlaceholder")}
        />
      </ParamRow>

      <ParamRow
        label={t("subBuilder.responseRules.announce", { defaultValue: "Announce message" })}
        hint={t("subBuilder.responseRules.announceHint", {
          defaultValue:
            "Shown in-app (max 200 chars). Panel sends base64 in the subscription header. Clients can override per-user.",
        })}
        delivery={rules.announceDelivery ?? "header"}
        onDeliveryChange={(delivery) => set({ announceDelivery: delivery })}
      >
        <textarea
          className="min-h-[72px] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
          value={rules.announce}
          onChange={(e) => set({ announce: e.target.value })}
          placeholder={t("subBuilder.responseRules.announcePlaceholder")}
          maxLength={200}
        />
        <p className="mt-1 text-[10px] text-[var(--fg-subtle)]">
          {rules.announce.length}/200
        </p>
      </ParamRow>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ParamRow
          label={t("subBuilder.responseRules.supportUrl", { defaultValue: "Support URL" })}
          hint={t("subBuilder.responseRules.supportUrlHint", {
            defaultValue: "Support-Url. Empty to omit.",
          })}
          delivery={rules.supportUrlDelivery ?? "header"}
          onDeliveryChange={(delivery) => set({ supportUrlDelivery: delivery })}
        >
          <Input
            value={rules.supportUrl}
            onChange={(e) => set({ supportUrl: e.target.value })}
            placeholder={t("subBuilder.responseRules.supportUrlPlaceholder")}
            type="url"
          />
        </ParamRow>

        <ParamRow
          label={t("subBuilder.responseRules.profileWebPageUrl", {
            defaultValue: "Profile web page URL",
          })}
          hint={t("subBuilder.responseRules.profileWebPageUrlHint", {
            defaultValue: "Profile-Web-Page-Url, shown as a link in some clients.",
          })}
          delivery={rules.profileWebPageUrlDelivery ?? "header"}
          onDeliveryChange={(delivery) => set({ profileWebPageUrlDelivery: delivery })}
        >
          <Input
            value={rules.profileWebPageUrl}
            onChange={(e) => set({ profileWebPageUrl: e.target.value })}
            placeholder={t("subBuilder.responseRules.profileWebPageUrlPlaceholder")}
            type="url"
          />
        </ParamRow>
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--fg)]">
              {t("subBuilder.responseRules.extraHeaders", {
                defaultValue: "Extra parameters",
              })}
            </div>
            <p className="text-[11px] text-[var(--fg-subtle)]">
              {t("subBuilder.responseRules.extraHeadersHint", {
                defaultValue:
                  "Happ/V2RayTun meta parameters (e.g. Hide-Settings). Choose HTTP header, body comment (#key: value), both, or disabled.",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={addHeader}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs font-medium text-[var(--fg)] transition-colors hover:border-[var(--accent)]"
          >
            <Plus size={14} />
            {t("subBuilder.responseRules.addHeader", { defaultValue: "Add parameter" })}
          </button>
        </div>

        {rules.extraHeaders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs text-[var(--fg-subtle)]">
            {t("subBuilder.responseRules.extraHeadersEmpty", {
              defaultValue: "No extra parameters configured.",
            })}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.extraHeaders.map((h, i) => (
              <li
                key={i}
                className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_auto]"
              >
                <Input
                  value={h.key}
                  onChange={(e) => setHeader(i, { key: e.target.value })}
                  placeholder={t("subBuilder.responseRules.extraHeaderKeyPlaceholder")}
                />
                <Input
                  value={h.value}
                  onChange={(e) => setHeader(i, { value: e.target.value })}
                  placeholder={t("subBuilder.responseRules.extraHeaderValuePlaceholder")}
                />
                <DeliverySelect
                  value={h.delivery ?? "header"}
                  onChange={(delivery) => setHeader(i, { delivery })}
                />
                <IconButton
                  label={t("delete", { defaultValue: "Delete" })}
                  onClick={() => removeHeader(i)}
                >
                  <Trash2 size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ParamRow({
  label,
  hint,
  delivery,
  onDeliveryChange,
  children,
}: {
  label: string;
  hint?: string;
  delivery: ResponseHeaderDelivery;
  onDeliveryChange: (v: ResponseHeaderDelivery) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <label className="block rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
          {label}
        </div>
        <div className="flex min-w-[9rem] items-center gap-2">
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--fg-subtle)]">
            {t("subBuilder.responseRules.deliveryLabel", { defaultValue: "Delivery" })}
          </span>
          <DeliverySelect value={delivery} onChange={onDeliveryChange} />
        </div>
      </div>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">{hint}</p> : null}
    </label>
  );
}
