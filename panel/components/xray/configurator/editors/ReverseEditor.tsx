"use client";

import { useMemo } from "react";
import { isRecord } from "@/lib/xrayConfigSections";
import {
  AddButton,
  Card,
  EmptyNote,
  Field,
  FieldGrid,
  RowActions,
  TextField,
  makeTr,
  moveItem,
  useJsonObject,
  type SectionEditorProps,
  type Tr,
} from "../fields";

type Endpoint = Record<string, unknown>;

function EndpointList({
  kind,
  items,
  readOnly,
  tr,
  onChange,
}: {
  kind: "bridge" | "portal";
  items: Endpoint[];
  readOnly: boolean;
  tr: Tr;
  onChange: (next: Endpoint[]) => void;
}) {
  const title = kind === "bridge" ? tr("bridges", "Bridges") : tr("portals", "Portals");
  const hint =
    kind === "bridge"
      ? tr("bridgesHint", "Runs on the server behind NAT and dials out to the portal.")
      : tr("portalsHint", "Runs on the public server and accepts the bridge connection.");
  const update = (i: number, p: Endpoint) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-semibold text-[var(--fg)]">{title}</div>
        <p className="text-xs text-[var(--fg-subtle)]">{hint}</p>
      </div>
      {items.length === 0 ? <EmptyNote>{tr("none", "None")}</EmptyNote> : null}
      {items.map((it, i) => (
        <Card
          key={i}
          title={typeof it.tag === "string" && it.tag ? it.tag : `${title} ${i + 1}`}
          actions={
            <RowActions
              index={i}
              total={items.length}
              readOnly={readOnly}
              tr={tr}
              onMove={(to) => onChange(moveItem(items, i, to))}
              onRemove={() => onChange(items.filter((_, j) => j !== i))}
            />
          }
        >
          <FieldGrid>
            <Field label="tag">
              <TextField mono value={typeof it.tag === "string" ? it.tag : ""} disabled={readOnly} onChange={(v) => update(i, { tag: v })} />
            </Field>
            <Field label="domain" hint={tr("reverseDomainHint", "Virtual domain both sides use to find each other.")}>
              <TextField mono value={typeof it.domain === "string" ? it.domain : ""} disabled={readOnly} placeholder="reverse.internal" onChange={(v) => update(i, { domain: v })} />
            </Field>
          </FieldGrid>
        </Card>
      ))}
      <AddButton disabled={readOnly} onClick={() => onChange([...items, { tag: kind, domain: "" }])}>
        {kind === "bridge" ? tr("addBridge", "Add bridge") : tr("addPortal", "Add portal")}
      </AddButton>
    </div>
  );
}

export function ReverseEditor({ value, onChange, readOnly, t }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { obj, patch } = useJsonObject(value, onChange);
  const list = (k: string) => (Array.isArray(obj[k]) ? (obj[k] as unknown[]).map((x) => (isRecord(x) ? x : {})) : []);
  return (
    <div className="space-y-6">
      <EndpointList kind="bridge" items={list("bridges")} readOnly={readOnly} tr={tr} onChange={(next) => patch({ bridges: next })} />
      <EndpointList kind="portal" items={list("portals")} readOnly={readOnly} tr={tr} onChange={(next) => patch({ portals: next })} />
    </div>
  );
}
