"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StreamFormState } from "@/lib/inboundDefaults";
import {
  defaultFinalmaskSettings,
  finalmaskTypeDef,
  finalmaskTypesForSide,
  fmSupportedInLink,
  validateFinalmask,
  type FMItem,
  type FinalmaskField,
  type FinalmaskIssue,
  type FinalmaskSide,
  type FinalmaskState,
} from "@/lib/finalmaskDefaults";
import { Button, IconButton, Input, PillTag, SelectNative, Switch, Textarea } from "@/components/ui";

type Props = {
  streamForm: Pick<StreamFormState, "finalmaskTcp" | "finalmaskUdp" | "finalmaskQuicParams">;
  setStreamFormField: <K extends keyof StreamFormState>(
    key: K,
    value: StreamFormState[K],
  ) => void;
  idPrefix: string;
  disabled?: boolean;
};

const labelCls = "mb-1.5 block text-xs font-medium text-[var(--fg-muted)]";
const hintCls = "mt-1 text-[11px] text-[var(--fg-subtle)]";
const errCls = "mt-1 text-[11px] text-red-400";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function splitList(text: string): string[] {
  return text
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Textarea that commits a JSON value only while it parses (keeps drafts). */
function JsonField({
  value,
  placeholder,
  onCommit,
  disabled,
  expected = "any",
}: {
  value: unknown;
  placeholder?: string;
  onCommit: (parsed: unknown) => void;
  disabled?: boolean;
  expected?: "object" | "array" | "any";
}) {
  const { t } = useTranslation();
  const external = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(external);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft((prev) => {
      try {
        const parsed: unknown = JSON.parse(prev);
        if (JSON.stringify(parsed) === JSON.stringify(value)) return prev;
      } catch {
        /* fall through to external */
      }
      return external;
    });
    setError(null);
  }, [external, value]);

  const apply = (text: string) => {
    setDraft(text);
    if (!text.trim()) {
      setError(null);
      onCommit(expected === "array" ? [] : {});
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError(t("finalmask.invalidJson", { defaultValue: "Invalid JSON — not saved until it parses." }));
      return;
    }
    if (expected === "object" && !isPlainObject(parsed)) {
      setError(t("finalmask.expectedObject", { defaultValue: "Expected a JSON object." }));
      return;
    }
    if (expected === "array" && !Array.isArray(parsed)) {
      setError(t("finalmask.expectedArray", { defaultValue: "Expected a JSON array." }));
      return;
    }
    setError(null);
    onCommit(parsed);
  };

  return (
    <>
      <Textarea
        className="min-h-[64px] font-mono text-xs"
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        onChange={(e) => apply(e.target.value)}
      />
      {error ? <p className={errCls}>{error}</p> : null}
    </>
  );
}

/** Comma/newline separated list field backed by a drafts buffer. */
function ListField({
  value,
  placeholder,
  onCommit,
  disabled,
}: {
  value: unknown[];
  placeholder?: string;
  onCommit: (list: string[]) => void;
  disabled?: boolean;
}) {
  const joined = value.map((v) => String(v)).join(", ");
  const [draft, setDraft] = useState(joined);
  useEffect(() => {
    setDraft((prev) => (splitList(prev).join("\u0000") === splitList(joined).join("\u0000") ? prev : joined));
  }, [joined]);
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(splitList(e.target.value));
      }}
    />
  );
}

function FieldControl({
  field,
  settings,
  disabled,
  onPatch,
}: {
  field: FinalmaskField;
  settings: Record<string, unknown>;
  disabled?: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const value = settings[field.name];
  const common = { disabled };

  if (field.kind === "bool") {
    return (
      <Switch
        checked={value === true}
        onChange={(next) => onPatch({ [field.name]: next })}
        ariaLabel={field.label}
      />
    );
  }
  if (field.kind === "enum") {
    return (
      <SelectNative
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(e) => onPatch({ [field.name]: e.target.value })}
      >
        {(field.options ?? []).map((opt) => (
          <option key={opt || "__default"} value={opt}>
            {opt === "" ? t("finalmask.defaultOption", { defaultValue: "default" }) : opt}
          </option>
        ))}
      </SelectNative>
    );
  }
  if (field.kind === "number") {
    return (
      <Input
        type="number"
        value={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
        placeholder={field.placeholder}
        {...common}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw.trim() === "") {
            onPatch({ [field.name]: undefined });
            return;
          }
          const n = Number(raw);
          onPatch({ [field.name]: Number.isFinite(n) ? n : raw });
        }}
      />
    );
  }
  if (field.kind === "list") {
    return (
      <ListField
        value={Array.isArray(value) ? value : []}
        placeholder={field.placeholder}
        disabled={disabled}
        onCommit={(list) => onPatch({ [field.name]: list })}
      />
    );
  }
  if (field.kind === "json") {
    return (
      <JsonField
        value={value}
        placeholder={field.placeholder}
        disabled={disabled}
        expected={Array.isArray(value) ? "array" : isPlainObject(value) ? "object" : "any"}
        onCommit={(parsed) => onPatch({ [field.name]: parsed })}
      />
    );
  }
  return (
    <Input
      value={typeof value === "string" ? value : ""}
      placeholder={field.placeholder}
      {...common}
      onChange={(e) => onPatch({ [field.name]: e.target.value })}
    />
  );
}

export function FinalmaskEditor({ streamForm, setStreamFormField, idPrefix, disabled = false }: Props) {
  const { t } = useTranslation();
  const state = useMemo<FinalmaskState>(
    () => ({
      finalmaskTcp: streamForm.finalmaskTcp,
      finalmaskUdp: streamForm.finalmaskUdp,
      finalmaskQuicParams: streamForm.finalmaskQuicParams,
    }),
    [streamForm.finalmaskTcp, streamForm.finalmaskUdp, streamForm.finalmaskQuicParams],
  );
  const issues = useMemo(() => validateFinalmask(state), [state]);
  const [addType, setAddType] = useState<Record<FinalmaskSide, string>>({
    tcp: "fragment",
    udp: "salamander",
  });
  const [advanced, setAdvanced] = useState<Record<string, boolean>>({});

  const setItems = (side: FinalmaskSide, items: FMItem[]) => {
    if (side === "tcp") setStreamFormField("finalmaskTcp", items);
    else setStreamFormField("finalmaskUdp", items);
  };

  const itemsFor = (side: FinalmaskSide) => (side === "tcp" ? state.finalmaskTcp : state.finalmaskUdp);

  const updateItem = (side: FinalmaskSide, index: number, item: FMItem) => {
    setItems(
      side,
      itemsFor(side).map((it, i) => (i === index ? item : it)),
    );
  };

  const patchSettings = (side: FinalmaskSide, index: number, patch: Record<string, unknown>) => {
    const item = itemsFor(side)[index];
    if (!item) return;
    const settings = { ...item.settings };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete settings[k];
      else settings[k] = v;
    }
    updateItem(side, index, { ...item, settings });
  };

  const addMask = (side: FinalmaskSide) => {
    const type = addType[side];
    setItems(side, [...itemsFor(side), { type, settings: defaultFinalmaskSettings(side, type) }]);
  };

  const removeMask = (side: FinalmaskSide, index: number) => {
    setItems(
      side,
      itemsFor(side).filter((_, i) => i !== index),
    );
  };

  const moveMask = (side: FinalmaskSide, index: number, dir: -1 | 1) => {
    const items = [...itemsFor(side)];
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    setItems(side, items);
  };

  const changeType = (side: FinalmaskSide, index: number, type: string) => {
    updateItem(side, index, { type, settings: defaultFinalmaskSettings(side, type) });
  };

  const issuesFor = (prefix: string) => issues.filter((is) => is.path.startsWith(prefix));

  const renderIssues = (list: FinalmaskIssue[]) =>
    list.length > 0 ? (
      <ul className="mt-1.5 space-y-0.5">
        {list.map((is, i) => (
          <li key={`${is.code}-${i}`} className={is.severity === "error" ? errCls : "mt-1 text-[11px] text-amber-400"}>
            {is.message}
          </li>
        ))}
      </ul>
    ) : null;

  const renderSide = (side: FinalmaskSide) => {
    const items = itemsFor(side);
    const defs = finalmaskTypesForSide(side);
    const sideLabel =
      side === "tcp"
        ? t("finalmask.tcp", { defaultValue: "TCP masks" })
        : t("finalmask.udp", { defaultValue: "UDP masks" });

    return (
      <div className="rounded-xl border border-[var(--border)] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
            {sideLabel}
          </div>
          <div className="flex items-center gap-2">
            <SelectNative
              className="h-9 w-auto min-w-[9rem] text-xs"
              value={addType[side]}
              disabled={disabled}
              onChange={(e) => setAddType((prev) => ({ ...prev, [side]: e.target.value }))}
              aria-label={t("finalmask.type", { defaultValue: "Type" })}
            >
              {defs.map((def) => (
                <option key={def.type} value={def.type}>
                  {def.label}
                </option>
              ))}
            </SelectNative>
            <Button variant="secondary" disabled={disabled} onClick={() => addMask(side)}>
              {t("finalmask.add", { defaultValue: "Add mask" })}
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-[var(--fg-subtle)]">
            {t("finalmask.empty", { defaultValue: "No masks in this layer." })}
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => {
              const def = finalmaskTypeDef(side, item.type);
              const key = `${side}:${index}:${item.type}`;
              const advKey = `${side}:${index}`;
              const linkOk = fmSupportedInLink(item.type, side);
              const itemIssues = issuesFor(`streamSettings.finalmask.${side}[${index}]`);
              return (
                <div
                  key={key}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] font-mono text-[var(--fg-subtle)]">#{index + 1}</span>
                    <PillTag tone={side === "tcp" ? "blue" : "green"}>{item.type || "?"}</PillTag>
                    {!linkOk ? (
                      <PillTag tone="amber">
                        {t("finalmask.jsonOnly", { defaultValue: "JSON subscription only" })}
                      </PillTag>
                    ) : null}
                    {def?.serverOnly ? (
                      <PillTag tone="neutral">
                        {t("finalmask.serverOnly", { defaultValue: "Server only" })}
                      </PillTag>
                    ) : null}
                    {def?.clientOnly ? (
                      <PillTag tone="rose">
                        {t("finalmask.clientOnly", { defaultValue: "Client only" })}
                      </PillTag>
                    ) : null}
                    <div className="ml-auto flex items-center gap-0.5">
                      <IconButton
                        label={t("moveUp", { defaultValue: "Move up" })}
                        disabled={disabled || index === 0}
                        onClick={() => moveMask(side, index, -1)}
                      >
                        <span aria-hidden>↑</span>
                      </IconButton>
                      <IconButton
                        label={t("moveDown", { defaultValue: "Move down" })}
                        disabled={disabled || index === items.length - 1}
                        onClick={() => moveMask(side, index, 1)}
                      >
                        <span aria-hidden>↓</span>
                      </IconButton>
                      <IconButton
                        label={t("delete", { defaultValue: "Delete" })}
                        disabled={disabled}
                        onClick={() => removeMask(side, index)}
                      >
                        <span aria-hidden>✕</span>
                      </IconButton>
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className={labelCls}>{t("finalmask.type", { defaultValue: "Type" })}</label>
                    <SelectNative
                      value={item.type}
                      disabled={disabled}
                      onChange={(e) => changeType(side, index, e.target.value)}
                    >
                      {defs.map((d) => (
                        <option key={d.type} value={d.type}>
                          {d.label}
                        </option>
                      ))}
                    </SelectNative>
                  </div>

                  {(def?.fields ?? []).length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(def?.fields ?? []).map((field) => (
                        <div key={field.name} className={field.kind === "json" ? "sm:col-span-2" : undefined}>
                          <label className={labelCls}>
                            {t(`finalmask.field.${field.name}`, { defaultValue: field.label })}
                            {field.required ? <span className="text-red-400"> *</span> : null}
                          </label>
                          <FieldControl
                            field={field}
                            settings={item.settings}
                            disabled={disabled}
                            onPatch={(patch) => patchSettings(side, index, patch)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {def?.hint ? <p className={hintCls}>{def.hint}</p> : null}

                  <div className="mt-2">
                    <Button
                      variant="link"
                      disabled={disabled}
                      onClick={() => setAdvanced((prev) => ({ ...prev, [advKey]: !prev[advKey] }))}
                    >
                      {advanced[advKey]
                        ? t("finalmask.hideAdvanced", { defaultValue: "Hide advanced JSON" })
                        : t("finalmask.advanced", { defaultValue: "Advanced JSON" })}
                    </Button>
                  </div>
                  {advanced[advKey] ? (
                    <div className="mt-2">
                      <JsonField
                        value={item.settings}
                        expected="object"
                        disabled={disabled}
                        onCommit={(parsed) =>
                          updateItem(side, index, {
                            ...item,
                            settings: isPlainObject(parsed) ? parsed : item.settings,
                          })
                        }
                      />
                      <p className={hintCls}>
                        {t("finalmask.advancedHint", {
                          defaultValue: "Full settings object; unknown keys are preserved.",
                        })}
                      </p>
                    </div>
                  ) : null}

                  {renderIssues(itemIssues)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const quicIssues = issues.filter((is) => is.path.startsWith("streamSettings.finalmask.quicParams"));

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-[var(--fg)]">
          {t("finalmask.title", { defaultValue: "Finalmask (transport masquerade)" })}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">
          {t("finalmask.hint", {
            defaultValue: "Layers are applied in array order: the first entry is the outermost layer.",
          })}
        </p>
        <p className="text-[11px] text-[var(--fg-subtle)]">
          {t("finalmask.orderHint", {
            defaultValue: "xicmp / udphop replace the socket and must be the last UDP entry.",
          })}
        </p>
      </div>

      {renderSide("tcp")}
      {renderSide("udp")}

      <div className="rounded-xl border border-[var(--border)] p-3">
        <label className={labelCls} htmlFor={`${idPrefix}-finalmask-quic`}>
          {t("finalmask.quicParams", { defaultValue: "QUIC params (JSON, optional)" })}
        </label>
        <Textarea
          id={`${idPrefix}-finalmask-quic`}
          className="min-h-[64px] font-mono text-xs"
          value={streamForm.finalmaskQuicParams}
          disabled={disabled}
          spellCheck={false}
          placeholder={'{\n  "congestion": "bbr"\n}'}
          onChange={(e) => setStreamFormField("finalmaskQuicParams", e.target.value)}
        />
        <p className={hintCls}>
          {t("finalmask.quicParamsHint", {
            defaultValue:
              "congestion: reno | bbr | brutal | force-brutal; bbrProfile: conservative | standard | aggressive.",
          })}
        </p>
        {renderIssues(quicIssues)}
      </div>
    </div>
  );
}
