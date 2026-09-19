"use client";

import { useMemo } from "react";
import { isRecord } from "@/lib/xrayConfigSections";
import {
  AddButton,
  Card,
  EmptyNote,
  Field,
  FieldGrid,
  NumberField,
  RowActions,
  TextField,
  makeTr,
  moveItem,
  useJsonArray,
  type SectionEditorProps,
} from "../fields";

export function FakeDnsEditor({ value, onChange, readOnly, t }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { arr, set } = useJsonArray(value, onChange);
  const pools = arr.map((p) => (isRecord(p) ? p : {}));
  const update = (i: number, p: Record<string, unknown>) => {
    const next = pools.map((x) => ({ ...x }));
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) delete next[i]![k];
      else next[i]![k] = v;
    }
    set(next);
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--fg-subtle)]">
        {tr("fakednsHint", "FakeDNS answers with addresses from these pools so the core can route by domain without a real lookup. It also needs a DNS server entry with the address \"fakedns\".")}
      </p>
      {pools.length === 0 ? <EmptyNote>{tr("fakednsEmpty", "No pools yet.")}</EmptyNote> : null}
      {pools.map((p, i) => (
        <Card
          key={i}
          title={`${tr("pool", "Pool")} ${i + 1}`}
          actions={
            <RowActions
              index={i}
              total={pools.length}
              readOnly={readOnly}
              tr={tr}
              onMove={(to) => set(moveItem(pools, i, to))}
              onRemove={() => set(pools.filter((_, j) => j !== i))}
            />
          }
        >
          <FieldGrid>
            <Field label="ipPool" hint={tr("ipPoolHint", "CIDR block, e.g. 198.18.0.0/15 (IPv4) or fc00::/18 (IPv6).")}>
              <TextField mono value={typeof p.ipPool === "string" ? p.ipPool : ""} disabled={readOnly} placeholder="198.18.0.0/15" onChange={(v) => update(i, { ipPool: v })} />
            </Field>
            <Field label="poolSize" hint={tr("poolSizeHint", "How many domain → IP mappings to keep.")}>
              <NumberField value={p.poolSize} min={1} disabled={readOnly} onChange={(v) => update(i, { poolSize: v })} />
            </Field>
          </FieldGrid>
        </Card>
      ))}
      <AddButton disabled={readOnly} onClick={() => set([...pools, { ipPool: "198.18.0.0/15", poolSize: 65535 }])}>
        {tr("addPool", "Add pool")}
      </AddButton>
    </div>
  );
}
