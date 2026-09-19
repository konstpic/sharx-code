"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { stringList } from "@/lib/xrayConfigSections";
import { Field, FieldGrid, TextField, ToggleChip, makeTr, useJsonObject, type SectionEditorProps } from "../fields";

const SERVICES = ["HandlerService", "LoggerService", "StatsService", "ReflectionService", "RoutingService", "ObservatoryService"];

export function ApiEditor({ value, onChange, readOnly, t }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { obj, patch } = useJsonObject(value, onChange);
  const services = stringList(obj.services);
  const extras = services.filter((s) => !SERVICES.includes(s));
  const tag = typeof obj.tag === "string" ? obj.tag : "";

  const toggle = (name: string) => {
    const set = new Set(services);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    const ordered = [...SERVICES.filter((s) => set.has(s)), ...extras.filter((s) => set.has(s))];
    patch({ services: ordered });
  };

  return (
    <div className="space-y-3">
      <FieldGrid>
        <Field label={tr("apiTag", "API tag")} hint={tr("apiTagHint", "Must match the API inbound and the routing rule that sends it to the api outbound.")}>
          <TextField value={tag} mono disabled={readOnly} onChange={(v) => patch({ tag: v })} />
        </Field>
        <Field label={tr("apiListen", "Listen address")} hint={tr("apiListenHint", "Optional. Leave empty to use the API inbound instead.")}>
          <TextField
            value={typeof obj.listen === "string" ? obj.listen : ""}
            mono
            disabled={readOnly}
            placeholder="127.0.0.1:62789"
            onChange={(v) => patch({ listen: v === "" ? undefined : v })}
          />
        </Field>
      </FieldGrid>
      {tag !== "" && tag !== "api" ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {tr("apiTagWarn", "The panel talks to Xray through the tag \"api\". Changing it can break traffic statistics.")}
        </div>
      ) : null}
      <Field label={tr("apiServices", "Enabled services")} hint={tr("apiServicesHint", "Handler, Logger and Stats are what the panel needs.")} wide>
        <div className="flex flex-wrap gap-1.5">
          {SERVICES.map((s) => (
            <ToggleChip key={s} active={services.includes(s)} disabled={readOnly} onClick={() => toggle(s)}>
              {s}
            </ToggleChip>
          ))}
          {extras.map((s) => (
            <ToggleChip key={s} active disabled={readOnly} onClick={() => toggle(s)}>
              {s}
            </ToggleChip>
          ))}
        </div>
      </Field>
    </div>
  );
}
