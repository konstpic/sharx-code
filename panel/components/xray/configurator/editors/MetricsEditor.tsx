"use client";

import { useMemo } from "react";
import { Field, FieldGrid, TextField, makeTr, useJsonObject, type SectionEditorProps } from "../fields";

export function MetricsEditor({ value, onChange, readOnly, t }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { obj, patch } = useJsonObject(value, onChange);
  const str = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : "");
  return (
    <FieldGrid>
      <Field label={tr("metricsTag", "Metrics tag")} hint={tr("metricsTagHint", "Inbound tag used to expose the metrics endpoint.")}>
        <TextField value={str("tag")} mono disabled={readOnly} onChange={(v) => patch({ tag: v })} />
      </Field>
      <Field label={tr("metricsListen", "Listen address")} hint={tr("metricsListenHint", "Bind to loopback unless you protect the port.")}>
        <TextField value={str("listen")} mono disabled={readOnly} placeholder="127.0.0.1:11111" onChange={(v) => patch({ listen: v === "" ? undefined : v })} />
      </Field>
    </FieldGrid>
  );
}
