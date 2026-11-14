"use client";

import { AlertCircle, Braces, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  getJsonTemplateFieldPath,
  getJsonTemplateMonacoSchemaBundle,
} from "@/lib/jsonTemplateMonacoSchemas";
import {
  defaultJsonTemplates,
  type JsonTemplates,
  type SharxSubpageConfigV2,
} from "@/lib/sharxSubpageConfig";
import { MonacoJsonEditor } from "@/components/ui/MonacoJsonEditor";
import type { MonacoJsonSchemaEntry } from "@/lib/monacoJson";

type Props = {
  config: SharxSubpageConfigV2;
  onChange: (next: SharxSubpageConfigV2) => void;
};

type FieldKey = keyof JsonTemplates;

type FieldMeta = {
  key: FieldKey;
  labelKey: string;
  labelDefault: string;
  hintKey: string;
  hintDefault: string;
  placeholder: string;
};

const FIELDS: FieldMeta[] = [
  {
    key: "fragment",
    labelKey: "subBuilder.jsonTemplates.fragment",
    labelDefault: "Fragment",
    hintKey: "subBuilder.jsonTemplates.fragmentHint",
    hintDefault:
      "Stream-settings fragmenter (xray). Left empty = no fragmentation injected into JSON sub.",
    placeholder: '{ "packets": "tlshello", "length": "100-200", "interval": "10-20" }',
  },
  {
    key: "mux",
    labelKey: "subBuilder.jsonTemplates.mux",
    labelDefault: "Mux",
    hintKey: "subBuilder.jsonTemplates.muxHint",
    hintDefault: "Per-outbound Mux settings merged into the JSON subscription.",
    placeholder: '{ "enabled": false, "concurrency": 8 }',
  },
  {
    key: "noises",
    labelKey: "subBuilder.jsonTemplates.noises",
    labelDefault: "Noises",
    hintKey: "subBuilder.jsonTemplates.noisesHint",
    hintDefault: "Array of noise settings injected alongside fragments.",
    placeholder: '[{ "type": "rand", "packet": "1-3", "delay": "10-20" }]',
  },
  {
    key: "rules",
    labelKey: "subBuilder.jsonTemplates.rules",
    labelDefault: "Rules",
    hintKey: "subBuilder.jsonTemplates.rulesHint",
    hintDefault: "Extra routing rules prepended to the routing section of JSON sub.",
    placeholder: '[{ "type": "field", "outboundTag": "direct", "domain": ["geosite:private"] }]',
  },
  {
    key: "finalMask",
    labelKey: "subBuilder.jsonTemplates.finalMask",
    labelDefault: "Default masks",
    hintKey: "subBuilder.jsonTemplates.finalMaskHint",
    hintDefault:
      "streamSettings.finalmask applied to JSON-subscription outbounds when the inbound does not define that side. Inbound masks win; sides the inbound transport cannot carry are dropped.",
    placeholder:
      '{ "tcp": [{ "type": "fragment", "settings": { "packets": "tlshello", "lengths": ["100-200"], "delays": ["1-2"] } }], "quicParams": { "congestion": "bbr" } }',
  },
];

export function JsonTemplatesEditor({ config, onChange }: Props) {
  const { t } = useTranslation();
  const templates: JsonTemplates =
    config.jsonTemplates ?? defaultJsonTemplates();

  const set = (patch: Partial<JsonTemplates>) =>
    onChange({ ...config, jsonTemplates: { ...templates, ...patch } });

  const templateSchemaBundle = useMemo(
    () =>
      getJsonTemplateMonacoSchemaBundle((key: FieldKey) => {
        const f = FIELDS.find((x) => x.key === key)!;
        return t(f.hintKey, { defaultValue: f.hintDefault });
      }),
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      {FIELDS.map((f) => (
        <JsonField
          key={f.key}
          fieldKey={f.key}
          label={t(f.labelKey, { defaultValue: f.labelDefault })}
          hint={t(f.hintKey, { defaultValue: f.hintDefault })}
          placeholder={f.placeholder}
          value={templates[f.key]}
          onChange={(v) => set({ [f.key]: v } as Partial<JsonTemplates>)}
          schemaBundle={templateSchemaBundle}
        />
      ))}
    </div>
  );
}

function JsonField({
  fieldKey,
  label,
  hint,
  placeholder,
  value,
  onChange,
  schemaBundle,
}: {
  fieldKey: FieldKey;
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (next: string) => void;
  schemaBundle: MonacoJsonSchemaEntry[];
}) {
  const { t } = useTranslation();
  const trimmed = value.trim();
  const validity = useMemo<
    { state: "empty" | "valid" | "invalid"; error?: string }
  >(() => {
    if (!trimmed) return { state: "empty" };
    try {
      JSON.parse(trimmed);
      return { state: "valid" };
    } catch (err) {
      return {
        state: "invalid",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [trimmed]);

  const borderClass =
    validity.state === "invalid"
      ? "border-[color-mix(in_oklab,var(--danger)_55%,var(--border))] focus-within:border-[var(--danger)]"
      : validity.state === "valid"
        ? "border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] focus-within:border-[var(--accent)]"
        : "border-[var(--border)] focus-within:border-[var(--accent)]";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
          <Braces size={12} aria-hidden />
          {label}
        </div>
        {validity.state === "valid" ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)]">
            <CheckCircle2 size={12} aria-hidden />
            {t("subBuilder.jsonTemplates.valid", { defaultValue: "Valid JSON" })}
          </span>
        ) : validity.state === "invalid" ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--danger)]">
            <AlertCircle size={12} aria-hidden />
            {t("subBuilder.jsonTemplates.invalid", { defaultValue: "Invalid JSON" })}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--fg-subtle)]">
            {t("subBuilder.jsonTemplates.empty", { defaultValue: "Optional" })}
          </span>
        )}
      </div>
      <div
        className={`min-h-[140px] overflow-hidden rounded-xl border transition-colors ${borderClass}`}
      >
        <MonacoJsonEditor
          path={getJsonTemplateFieldPath(fieldKey)}
          value={value}
          onChange={onChange}
          height={140}
          readOnly={false}
          schemaBundle={schemaBundle}
        />
      </div>
      {hint ? (
        <p className="text-[11px] text-[var(--fg-subtle)]">{hint}</p>
      ) : null}
      {placeholder ? (
        <p className="text-[10px] text-[var(--fg-subtle)]/90">
          <span className="font-medium text-[var(--fg-muted)]">JSON example:</span> {placeholder}
        </p>
      ) : null}
      {validity.state === "invalid" && validity.error ? (
        <p className="text-[11px] text-[var(--danger)]">{validity.error}</p>
      ) : null}
    </div>
  );
}
