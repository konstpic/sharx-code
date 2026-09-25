"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { coerceParam, isParamKey, paramValues, PARAM_TYPES } from "@/lib/subLayout/params";
import type { ParamDef, ParamType, ParamValue } from "@/lib/subLayout/types";
import type { D } from "./i18n";
import { Note } from "./InspectorSections";
import { Check, ColorInput, Num, Pick, Row, Section, Slide, SmallBtn, TplField } from "./ui";

const FONTS = ["system-ui", "Inter, sans-serif", "Georgia, serif", "ui-monospace, monospace", "'Courier New', monospace", "cursive"];
const STD_LABELS: Record<string, string> = { dur: "Duration", delay: "Delay", easing: "Easing", dir: "Direction", iter: "Repeat", trigger: "Start", accent: "Accent color", secondary: "Second color", size: "Size" };

type Props = {
  nodeId: string;
  params: ParamDef[];
  values: Record<string, ParamValue>;
  d: D;
  /** Persists params and / or values. */
  onChange: (patch: { params?: ParamDef[]; values?: Record<string, ParamValue> }, key: string) => void;
};

function ParamControl({ p, value, onChange, d }: { p: ParamDef; value: ParamValue; onChange: (v: ParamValue) => void; d: D }) {
  switch (p.type) {
    case "range":
      return <Slide value={Number(value)} min={p.min ?? 0} max={p.max ?? 100} step={p.step ?? 1} unit={p.unit} onChange={(n) => onChange(n ?? Number(p.default))} ariaLabel={p.label} />;
    case "number":
      return <Num value={Number(value)} min={p.min} max={p.max} step={p.step ?? 1} unit={p.unit} onChange={(n) => onChange(n ?? Number(p.default))} ariaLabel={p.label} />;
    case "color":
      return <ColorInput value={String(value)} onChange={(v) => onChange(v ?? String(p.default))} placeholder={String(p.default)} />;
    case "toggle":
      return <Check checked={value === true} onChange={onChange} label={value === true ? d("pr.on", "On") : d("pr.off", "Off")} />;
    case "select":
      return <Pick value={String(value)} onChange={onChange} options={(p.options ?? []).map((o) => ({ id: o.value, label: o.label }))} />;
    case "font":
      return (
        <>
          <TplField value={String(value)} onChange={onChange} placeholder="Inter, sans-serif" ariaLabel={p.label} />
          <datalist id={`fonts-${p.key}`}>{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
        </>
      );
    default:
      return <TplField value={String(value)} onChange={onChange} ariaLabel={p.label} />;
  }
}

const optsToText = (o: ParamDef["options"]) => (o ?? []).map((x) => (x.label === x.value ? x.value : `${x.value}: ${x.label}`)).join("\n");
const textToOpts = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      return i > 0 ? { value: l.slice(0, i).trim(), label: l.slice(i + 1).trim() || l.slice(0, i).trim() } : { value: l, label: l };
    });

function ParamEditor({ p, onChange, onRemove, d, taken }: { p: ParamDef; onChange: (p: ParamDef) => void; onRemove: () => void; d: D; taken: boolean }) {
  const [key, setKey] = useState(p.key);
  const numeric = p.type === "number" || p.type === "range";
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--border)] p-2">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] gap-1">
        <TplField value={key} onChange={(v) => { setKey(v); if (isParamKey(v) && !taken) onChange({ ...p, key: v }); }} mono placeholder="key" ariaLabel={d("pr.key", "Key")} />
        <TplField value={p.label} onChange={(v) => onChange({ ...p, label: v })} placeholder={d("pr.label", "Label")} ariaLabel={d("pr.label", "Label")} />
        <SmallBtn title={d("pr.remove", "Remove parameter")} onClick={onRemove}><Trash2 size={14} /></SmallBtn>
      </div>
      {!isParamKey(key) ? <div className="text-[11px] text-amber-400">{d("pr.keyBad", "Key: letters, digits and _, starting with a letter.")}</div> : null}
      <div className="grid grid-cols-2 gap-1">
        <Pick
          value={p.type}
          onChange={(t) => onChange({ ...p, type: t as ParamType, default: coerceParam({ ...p, type: t as ParamType }, p.default) })}
          options={PARAM_TYPES.map((t) => ({ id: t, label: d(`pr.t.${t}`, t) }))}
        />
        <TplField value={p.group ?? ""} onChange={(v) => onChange({ ...p, group: v || undefined })} placeholder={d("pr.group", "Group")} ariaLabel={d("pr.group", "Group")} />
      </div>
      <Row label={d("pr.default", "Default")}>
        <ParamControl p={p} value={coerceParam(p, p.default)} onChange={(v) => onChange({ ...p, default: v })} d={d} />
      </Row>
      {numeric ? (
        <div className="grid grid-cols-4 gap-1">
          <Num value={p.min} placeholder="min" onChange={(n) => onChange({ ...p, min: n })} ariaLabel="min" />
          <Num value={p.max} placeholder="max" onChange={(n) => onChange({ ...p, max: n })} ariaLabel="max" />
          <Num value={p.step} placeholder="step" min={0} step={0.05} onChange={(n) => onChange({ ...p, step: n && n > 0 ? n : undefined })} ariaLabel="step" />
          <TplField value={p.unit ?? ""} onChange={(v) => onChange({ ...p, unit: /^[a-z%]{0,4}$/i.test(v) && v ? v : undefined })} placeholder="unit" ariaLabel="unit" />
        </div>
      ) : null}
      {p.type === "select" ? (
        <div className="space-y-1">
          <div className="text-[11px] text-[var(--fg-subtle)]">{d("pr.options", "Options, one per line: value or value: label")}</div>
          <TplField value={optsToText(p.options)} onChange={(v) => onChange({ ...p, options: textToOpts(v) })} multiline rows={3} mono ariaLabel={d("pr.options", "Options")} />
        </div>
      ) : null}
    </div>
  );
}

export function ParamsSection({ nodeId, params, values, d, onChange }: Props) {
  const eff = useMemo(() => paramValues(params, values), [params, values]);
  const groups = useMemo(() => {
    const m = new Map<string, ParamDef[]>();
    for (const p of params) m.set(p.group ?? "", [...(m.get(p.group ?? "") ?? []), p]);
    return [...m.entries()];
  }, [params]);
  const [editing, setEditing] = useState(false);
  const setParams = (next: ParamDef[]) => onChange({ params: next }, `${nodeId}:params`);
  const label = (p: ParamDef) => (STD_LABELS[p.key] === p.label ? d(`pr.std.${p.key}`, p.label) : p.label);

  return (
    <Section title={d("sec.params", "Parameters")} defaultOpen={params.length > 0}>
      {params.length === 0 ? <Note>{d("pr.hint", "Add parameters to turn this code into a configurable widget. Use ‹‹ p.key ›› in the HTML and var(--p-key) in the CSS.")}</Note> : null}
      {groups.map(([g, list]) => (
        <div key={g} className="space-y-2">
          {g ? <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{g === "Animation" ? d("pr.g.animation", g) : g === "Colors" ? d("pr.g.colors", g) : g === "Look" ? d("pr.g.look", g) : g}</div> : null}
          {list.map((p) => (
            <Row key={p.key} label={label(p)} hint={`p.${p.key} / --p-${p.key}`}>
              <ParamControl p={p} value={eff[p.key]} onChange={(v) => onChange({ values: { ...values, [p.key]: v } }, `${nodeId}:pv:${p.key}`)} d={d} />
            </Row>
          ))}
        </div>
      ))}
      {params.length > 0 ? (
        <div className="flex gap-1.5">
          <SmallBtn title={d("pr.reset", "Reset values")} onClick={() => onChange({ values: {} }, `${nodeId}:pv`)}>{d("pr.reset", "Reset values")}</SmallBtn>
        </div>
      ) : null}
      <button type="button" onClick={() => setEditing((e) => !e)} className="text-[11px] text-[var(--accent)] hover:underline">
        {editing ? d("pr.hideEdit", "Hide the parameter editor") : d("pr.edit", "Edit parameters…")}
      </button>
      {editing ? (
        <div className="space-y-2">
          {params.map((p, i) => (
            <ParamEditor key={i} p={p} d={d} taken={params.some((q, j) => j !== i && q.key === p.key)} onChange={(np) => setParams(params.map((q, j) => (j === i ? np : q)))} onRemove={() => setParams(params.filter((_, j) => j !== i))} />
          ))}
          <SmallBtn
            title={d("pr.add", "Add a parameter")}
            onClick={() => {
              let n = params.length + 1;
              while (params.some((q) => q.key === `param${n}`)) n++;
              setParams([...params, { key: `param${n}`, label: `Param ${n}`, type: "number", default: 1, min: 0, max: 10, step: 0.1 }]);
            }}
          >
            <Plus size={14} /> {d("pr.add", "Add a parameter")}
          </SmallBtn>
        </div>
      ) : null}
      {params.length > 0 ? (
        <details className="text-[11px] text-[var(--fg-muted)]">
          <summary className="cursor-pointer">{d("pr.raw", "Raw values")}</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-[var(--bg-elevated)] p-2 text-[10.5px]">{JSON.stringify(eff, null, 2)}</pre>
        </details>
      ) : null}
    </Section>
  );
}
