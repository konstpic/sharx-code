"use client";

import { useMemo } from "react";
import { Field, FieldGrid, SelectField, TextField, ToggleRow, makeTr, useJsonObject, type SectionEditorProps } from "../fields";

const LEVELS = ["debug", "info", "warning", "error", "none"];
const MASKS = ["", "quarter", "half", "full"];

function PathField({
  label,
  hint,
  value,
  readOnly,
  onChange,
  tr,
}: {
  label: string;
  hint: string;
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  tr: ReturnType<typeof makeTr>;
}) {
  const mode = value === "none" ? "none" : value === "" ? "stdout" : "file";
  return (
    <Field label={label} hint={hint} wide>
      <div className="flex flex-wrap gap-2">
        <div className="w-44">
          <SelectField
            value={mode}
            disabled={readOnly}
            onChange={(m) => onChange(m === "none" ? "none" : m === "stdout" ? "" : "/var/log/xray/file.log")}
            options={[
              { value: "none", label: tr("logOff", "Disabled") },
              { value: "stdout", label: tr("logStdout", "Console (stdout)") },
              { value: "file", label: tr("logFile", "File") },
            ]}
          />
        </div>
        {mode === "file" ? (
          <div className="min-w-[14rem] flex-1">
            <TextField value={value} mono disabled={readOnly} onChange={onChange} placeholder="/var/log/xray/access.log" />
          </div>
        ) : null}
      </div>
    </Field>
  );
}

export function LogEditor({ value, onChange, readOnly, t }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { obj, patch } = useJsonObject(value, onChange);
  const str = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : "");
  return (
    <div className="space-y-3">
      <FieldGrid>
        <Field label={tr("logLevel", "Log level")} hint={tr("logLevelHint", "warning is the usual production choice; debug is very verbose.")}>
          <SelectField
            value={str("loglevel") || "warning"}
            disabled={readOnly}
            onChange={(v) => patch({ loglevel: v })}
            options={LEVELS.map((l) => ({ value: l }))}
          />
        </Field>
        <Field label={tr("maskAddress", "Mask addresses in logs")} hint={tr("maskAddressHint", "Hide part of client IPs in log lines.")}>
          <SelectField
            value={str("maskAddress")}
            disabled={readOnly}
            onChange={(v) => patch({ maskAddress: v === "" ? undefined : v })}
            options={MASKS.map((m) => ({ value: m, label: m === "" ? tr("maskOff", "Off") : m }))}
          />
        </Field>
        <PathField
          label={tr("accessLog", "Access log")}
          hint={tr("accessLogHint", "Every connection. Disable it unless you need it — it grows fast.")}
          value={str("access")}
          readOnly={readOnly}
          tr={tr}
          onChange={(v) => patch({ access: v })}
        />
        <PathField
          label={tr("errorLog", "Error log")}
          hint={tr("errorLogHint", "Errors and warnings of the core itself.")}
          value={str("error")}
          readOnly={readOnly}
          tr={tr}
          onChange={(v) => patch({ error: v })}
        />
      </FieldGrid>
      <ToggleRow
        label={tr("dnsLog", "Log DNS queries")}
        hint={tr("dnsLogHint", "Writes every DNS lookup to the access log.")}
        checked={obj.dnsLog === true}
        disabled={readOnly}
        onChange={(v) => patch({ dnsLog: v })}
      />
    </div>
  );
}
