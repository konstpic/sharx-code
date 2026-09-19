"use client";

import { useMemo } from "react";
import { isRecord } from "@/lib/xrayConfigSections";
import {
  AddButton,
  Card,
  EmptyNote,
  Field,
  FieldGrid,
  MiniBtn,
  NumberField,
  ToggleRow,
  makeTr,
  useJsonObject,
  type SectionEditorProps,
} from "../fields";
import { Trash2 } from "lucide-react";

const SYSTEM_KEYS = ["statsInboundUplink", "statsInboundDownlink", "statsOutboundUplink", "statsOutboundDownlink"] as const;
const LEVEL_BOOLS = ["statsUserUplink", "statsUserDownlink", "statsUserOnline"] as const;
const LEVEL_NUMS = ["handshake", "connIdle", "uplinkOnly", "downlinkOnly", "bufferSize"] as const;

export function PolicyEditor({ value, onChange, readOnly, t }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { obj, patch } = useJsonObject(value, onChange);
  const system = isRecord(obj.system) ? obj.system : {};
  const levels = isRecord(obj.levels) ? obj.levels : {};
  const levelIds = Object.keys(levels).sort((a, b) => Number(a) - Number(b));

  const setSystem = (k: string, v: boolean) => patch({ system: { ...system, [k]: v } });
  const setLevel = (id: string, p: Record<string, unknown>) => {
    const cur = isRecord(levels[id]) ? (levels[id] as Record<string, unknown>) : {};
    const next: Record<string, unknown> = { ...cur };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    patch({ levels: { ...levels, [id]: next } });
  };
  const addLevel = () => {
    let n = 0;
    while (String(n) in levels) n++;
    patch({ levels: { ...levels, [String(n)]: { statsUserUplink: true, statsUserDownlink: true } } });
  };
  const removeLevel = (id: string) => {
    const next = { ...levels };
    delete next[id];
    patch({ levels: next });
  };

  const sysLabel: Record<(typeof SYSTEM_KEYS)[number], string> = {
    statsInboundUplink: tr("statsInboundUplink", "Inbound upload"),
    statsInboundDownlink: tr("statsInboundDownlink", "Inbound download"),
    statsOutboundUplink: tr("statsOutboundUplink", "Outbound upload"),
    statsOutboundDownlink: tr("statsOutboundDownlink", "Outbound download"),
  };
  const boolLabel: Record<(typeof LEVEL_BOOLS)[number], string> = {
    statsUserUplink: tr("statsUserUplink", "Count user upload"),
    statsUserDownlink: tr("statsUserDownlink", "Count user download"),
    statsUserOnline: tr("statsUserOnline", "Track online users"),
  };
  const numLabel: Record<(typeof LEVEL_NUMS)[number], string> = {
    handshake: tr("handshake", "Handshake timeout, s"),
    connIdle: tr("connIdle", "Idle connection timeout, s"),
    uplinkOnly: tr("uplinkOnly", "Close after uplink-only, s"),
    downlinkOnly: tr("downlinkOnly", "Close after downlink-only, s"),
    bufferSize: tr("bufferSize", "Buffer per connection, KB"),
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-semibold text-[var(--fg)]">{tr("policySystem", "System-wide counters")}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {SYSTEM_KEYS.map((k) => (
            <ToggleRow key={k} label={sysLabel[k]} checked={system[k] === true} disabled={readOnly} onChange={(v) => setSystem(k, v)} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <div className="text-sm font-semibold text-[var(--fg)]">{tr("policyLevels", "User levels")}</div>
          <p className="text-xs text-[var(--fg-subtle)]">{tr("policyLevelsHint", "Every user belongs to a level (0 by default). Limits and counters are set per level.")}</p>
        </div>
        {levelIds.length === 0 ? <EmptyNote>{tr("policyNoLevels", "No levels defined — Xray defaults apply.")}</EmptyNote> : null}
        {levelIds.map((id) => {
          const lv = isRecord(levels[id]) ? (levels[id] as Record<string, unknown>) : {};
          return (
            <Card
              key={id}
              title={`${tr("level", "Level")} ${id}`}
              actions={
                <MiniBtn label={tr("remove", "Remove")} danger disabled={readOnly} onClick={() => removeLevel(id)}>
                  <Trash2 size={15} />
                </MiniBtn>
              }
            >
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  {LEVEL_BOOLS.map((k) => (
                    <ToggleRow key={k} label={boolLabel[k]} checked={lv[k] === true} disabled={readOnly} onChange={(v) => setLevel(id, { [k]: v })} />
                  ))}
                </div>
                <FieldGrid>
                  {LEVEL_NUMS.map((k) => (
                    <Field key={k} label={numLabel[k]}>
                      <NumberField value={lv[k]} min={0} disabled={readOnly} onChange={(v) => setLevel(id, { [k]: v })} />
                    </Field>
                  ))}
                </FieldGrid>
              </div>
            </Card>
          );
        })}
        <AddButton disabled={readOnly} onClick={addLevel}>
          {tr("addLevel", "Add level")}
        </AddButton>
      </div>
    </div>
  );
}
