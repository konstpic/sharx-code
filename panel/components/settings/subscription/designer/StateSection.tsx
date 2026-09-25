"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { applyStates } from "@/lib/subLayout/behavior";
import { evalCondition, type Ctx } from "@/lib/subLayout/template";
import type { LNode, NodeAction, OnClick, StateRule, Style } from "@/lib/subLayout/types";
import type { D } from "./i18n";
import { Note } from "./InspectorSections";
import { Check, ColorInput, Num, Pick, Row, Section, SmallBtn, TplField } from "./ui";

type Patch = { states?: StateRule[] | undefined; refresh?: number | undefined; onClick?: OnClick | undefined };

const ACTIONS: { id: NodeAction; label: string }[] = [
  { id: "none", label: "Nothing" },
  { id: "link", label: "Open a link" },
  { id: "copy", label: "Copy text" },
  { id: "scroll-to", label: "Scroll to an element" },
  { id: "toggle", label: "Toggle a state" },
  { id: "toggle-visibility", label: "Show / hide an element" },
  { id: "set-state", label: "Set a state" },
];

function RuleEditor({ rule, ctx, lang, d, onChange, onRemove }: { rule: StateRule; ctx: Ctx; lang: string; d: D; onChange: (r: StateRule) => void; onRemove: () => void }) {
  const on = useMemo(() => {
    const c = evalCondition(rule.when, ctx, { lang });
    return { value: c.value && !c.error, error: c.error };
  }, [rule.when, ctx, lang]);
  const st = rule.style;
  const setStyle = (patch: Partial<Style>) => {
    const next = { ...st, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange({ ...rule, style: next as Style });
  };
  const [json, setJson] = useState<string | null>(null);
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--border)] p-2">
      <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-1">
        <TplField value={rule.when} onChange={(v) => onChange({ ...rule, when: v })} mono placeholder="user.percentUsed > 80" ariaLabel={d("st.when", "When")} />
        <SmallBtn title={d("st.remove", "Remove rule")} onClick={onRemove}><Trash2 size={14} /></SmallBtn>
      </div>
      <div className={`text-[11px] ${on.error ? "text-red-400" : on.value ? "text-emerald-400" : "text-[var(--fg-subtle)]"}`}>{on.error ? on.error : on.value ? d("st.active", "Active now (preview data)") : d("st.inactive", "Not active now")}</div>
      <Row label={d("st.bg", "Fill")}><ColorInput value={st.bg} onChange={(v) => setStyle({ bg: v })} allowGradient /></Row>
      <Row label={d("st.color", "Text")}><ColorInput value={st.color} onChange={(v) => setStyle({ color: v })} placeholder="inherit" /></Row>
      <Row label={d("st.border", "Border")}><ColorInput value={st.border?.color} onChange={(v) => setStyle({ border: v ? { w: st.border?.w ?? 1, color: v, style: st.border?.style } : undefined })} /></Row>
      <Row label={d("st.opacity", "Opacity")}><Num value={st.opacity === undefined ? undefined : Math.round(st.opacity * 100)} min={0} max={100} unit="%" placeholder="—" onChange={(n) => setStyle({ opacity: n === undefined ? undefined : n / 100 })} /></Row>
      <Row label={d("st.scale", "Rotate")}><Num value={st.rotate} unit="°" placeholder="—" onChange={(n) => setStyle({ rotate: n })} /></Row>
      <details className="text-[11px] text-[var(--fg-muted)]">
        <summary className="cursor-pointer">{d("st.advanced", "Any style properties (JSON)")}</summary>
        <TplField
          value={json ?? JSON.stringify(st)}
          onChange={(v) => {
            setJson(v);
            try {
              const o = JSON.parse(v);
              if (o && typeof o === "object" && !Array.isArray(o)) onChange({ ...rule, style: o as Style });
            } catch {
              /* keep typing */
            }
          }}
          multiline
          rows={3}
          mono
          ariaLabel="JSON"
        />
      </details>
    </div>
  );
}

/** Data and behavior of a node: conditional styles, refresh interval, click behavior. */
export function StateSection({ node, ctx, lang, d, onPatch }: { node: LNode; ctx: Ctx; lang: string; d: D; onPatch: (p: Patch, key: string) => void }) {
  const rules = node.states ?? [];
  const oc: OnClick = node.onClick ?? { action: "none" };
  const setRules = (next: StateRule[]) => onPatch({ states: next.length ? next : undefined }, `${node.id}:states`);
  const setOc = (patch: Partial<OnClick>) => {
    const next = { ...oc, ...patch };
    onPatch({ onClick: next.action === "none" ? undefined : next }, `${node.id}:onclick:${Object.keys(patch).join(",")}`);
  };
  const matched = useMemo(() => applyStates(node.style, rules, ctx, { lang }).matched, [node.style, rules, ctx, lang]);
  const isButton = node.type === "button";
  const key = oc.value?.trim() ?? "";

  return (
    <Section title={d("sec.behavior", "Data & behavior")} defaultOpen={!!(rules.length || node.refresh || node.onClick)}>
      <div className="space-y-1.5">
        <div className="text-[11.5px] font-medium text-[var(--fg-muted)]">{d("st.title", "Style by condition")}</div>
        <Note>{d("st.hint", "Each rule whose expression is true is merged over the style, in order (the last one wins). Example: user.percentUsed > 80 → red fill.")}</Note>
        {rules.map((r, i) => (
          <RuleEditor key={i} rule={r} ctx={ctx} lang={lang} d={d} onChange={(nr) => setRules(rules.map((x, j) => (j === i ? nr : x)))} onRemove={() => setRules(rules.filter((_, j) => j !== i))} />
        ))}
        <SmallBtn title={d("st.add", "Add a rule")} onClick={() => setRules([...rules, { when: "", style: {} }])}>
          <Plus size={14} /> {d("st.add", "Add a rule")}
        </SmallBtn>
        {rules.length ? <div className="text-[11px] text-[var(--fg-subtle)]">{d("st.matched", "%{n} of %{m} rules match now", { n: matched, m: rules.length })}</div> : null}
      </div>

      <Row label={d("st.refresh", "Refresh")} hint={d("st.refreshHint", "Re-render this element every N seconds, for values that depend on the time (now | ago, countdowns). 0 = off.")}>
        <Num value={node.refresh} min={0} max={3600} unit="s" placeholder="0" onChange={(n) => onPatch({ refresh: n && n > 0 ? n : undefined }, `${node.id}:refresh`)} />
      </Row>

      {!isButton ? (
        <div className="space-y-1.5">
          <Row label={d("st.onClick", "On click")}>
            <Pick value={oc.action} onChange={(v) => setOc({ action: v })} options={ACTIONS.map((a) => ({ id: a.id, label: d(`st.a.${a.id}`, a.label) }))} />
          </Row>
          {oc.action !== "none" ? (
            <>
              <Row label={oc.action === "link" ? "URL" : oc.action === "copy" ? d("st.text", "Text") : oc.action === "scroll-to" || oc.action === "toggle-visibility" ? d("st.nodeId", "Element id") : d("st.key", "State key")}>
                <TplField value={oc.value ?? ""} onChange={(v) => setOc({ value: v })} mono={oc.action !== "link" && oc.action !== "copy"} placeholder={oc.action === "link" ? "https://…" : oc.action === "copy" ? "{{ subscription.url }}" : oc.action === "scroll-to" || oc.action === "toggle-visibility" ? "n1abc23" : "faq1"} ariaLabel={d("st.key", "State key")} />
              </Row>
              {oc.action === "set-state" ? (
                <Row label={d("st.to", "Value")} hint={d("st.toHint", "Empty toggles; true / false or any text")}>
                  <TplField value={oc.to ?? ""} onChange={(v) => setOc({ to: v })} placeholder={d("st.toggle", "toggle")} ariaLabel={d("st.to", "Value")} />
                </Row>
              ) : null}
              {oc.action === "link" ? <Check checked={oc.newTab === true} onChange={(v) => setOc({ newTab: v || undefined })} label={d("c.newTab", "Open in a new tab")} /> : null}
              {(oc.action === "toggle" || oc.action === "set-state") && key ? <Note>{d("st.stateHint", "Use ‹‹ state.%{k} ›› in “Show only if” of any element or in a condition rule.", { k: key })}</Note> : null}
              {oc.action === "toggle-visibility" ? <Note>{d("st.hideHint", "The element with this id is hidden after the first click and shown after the second. Its id is shown at the top of the inspector.")}</Note> : null}
            </>
          ) : null}
        </div>
      ) : (
        <Note>{d("st.buttonHint", "Buttons have their own action (Content). Choose “Toggle a state” there to drive state.<key>.")}</Note>
      )}
    </Section>
  );
}
