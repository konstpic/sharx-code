"use client";

import { CoreVersionHint } from "@/components/xray/outbound/CoreVersionHint";
import { Field, FieldGrid, JsonArea, NumberField, SelectField, TextField, type Tr } from "@/components/xray/configurator/fields";
import { getPath, isRec, strAt, type Path, type Rec } from "@/lib/jsonPath";
import {
  XDRIVE_NUMERIC_FIELDS,
  XDRIVE_SERVICES,
  XDRIVE_TEMPLATE_EXAMPLE,
  defaultXdriveSettings,
  describeXdriveIssue,
  validateXdriveSettings,
  type XdriveService,
} from "@/lib/xrayXdrive";

const DRIVE_SECRET_LABELS = ["ClientID", "ClientSecret", "RefreshToken"];

/** `streamSettings.xdriveSettings` for network "xdrive" (Xray >= 26.9.30). */
export function XdriveFields({
  raw,
  readOnly,
  tr,
  set,
}: {
  raw: Rec;
  readOnly: boolean;
  tr: Tr;
  set: (p: Path, v: unknown) => void;
}) {
  const base: Path = ["streamSettings", "xdriveSettings"];
  const at = (k: string): Path => [...base, k];
  const settings = getPath(raw, base);
  const service = strAt(raw, at("service"), "Google Drive");
  const secrets = Array.isArray(getPath(raw, at("secrets"))) ? (getPath(raw, at("secrets")) as unknown[]).map((s) => (typeof s === "string" ? s : "")) : [];
  const issues = isRec(settings) ? validateXdriveSettings(settings) : [];

  const changeService = (next: string) => {
    const d = defaultXdriveSettings(next as XdriveService);
    const cur = isRec(settings) ? settings : {};
    set(base, { ...cur, service: next, secrets: d.secrets, template: d.template });
  };

  return (
    <div className="space-y-3">
      <CoreVersionHint feature="xdrive" tr={tr} />
      <FieldGrid>
        <Field label="service" hint={tr("xdService", "Storage backend that carries the traffic.")}>
          <SelectField
            value={service}
            disabled={readOnly}
            onChange={changeService}
            options={XDRIVE_SERVICES.filter((s) => s !== "local" || service === "local").map((v) => ({ value: v }))}
          />
        </Field>
        <Field label="remoteFolder" hint={tr("xdFolder", "Folder on the storage; client and server must use the same one.")}>
          <TextField mono value={strAt(raw, at("remoteFolder"))} disabled={readOnly} placeholder="xray" onChange={(v) => set(at("remoteFolder"), v)} />
        </Field>
      </FieldGrid>

      {service === "Google Drive" ? (
        <FieldGrid>
          {DRIVE_SECRET_LABELS.map((label, i) => (
            <Field key={label} label={`secrets[${i}] — ${label}`} wide={i === 2}>
              <TextField
                mono
                value={secrets[i] ?? ""}
                disabled={readOnly}
                onChange={(v) => {
                  const next = [secrets[0] ?? "", secrets[1] ?? "", secrets[2] ?? ""];
                  next[i] = v;
                  set(at("secrets"), next);
                }}
              />
            </Field>
          ))}
        </FieldGrid>
      ) : null}

      {service === "template" ? (
        <Field
          label="template"
          wide
          hint={tr("xdTemplate", "put / get / delete / list operations plus auth (none, static, basic, oauth2). URLs may use {folder}, {name}, {secret0}…")}
        >
          <JsonArea value={getPath(raw, at("template")) ?? XDRIVE_TEMPLATE_EXAMPLE} disabled={readOnly} rows={12} onCommit={(v) => set(at("template"), v)} />
        </Field>
      ) : null}

      <details>
        <summary className="cursor-pointer text-xs font-medium text-[var(--accent)]">{tr("xdTuning", "Tuning (optional, 0 = default)")}</summary>
        <div className="mt-2">
          <FieldGrid>
            {XDRIVE_NUMERIC_FIELDS.map(({ key, def }) => (
              <Field key={key} label={key} hint={`${tr("xdDefault", "Default")}: ${def}`}>
                <NumberField value={getPath(raw, at(key))} min={0} disabled={readOnly} onChange={(v) => set(at(key), v)} />
              </Field>
            ))}
          </FieldGrid>
        </div>
      </details>

      {issues.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] text-amber-400">
          {issues.map((i, k) => (
            <li key={k}>{describeXdriveIssue(i)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
