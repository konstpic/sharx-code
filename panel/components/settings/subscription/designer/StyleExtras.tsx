"use client";

import { Plus, Trash2 } from "lucide-react";
import { buildGradient, defaultGradient, isGradient, parseGradient, type Grad } from "@/lib/subLayout/gradient";
import type { FilterSet, ShadowItem, Style } from "@/lib/subLayout/types";
import type { D } from "./i18n";
import { Check, ColorInput, Num, Pick, Row, Seg, Slide, SmallBtn, TplField } from "./ui";

/** Fill: solid color or a gradient with a small builder (2-3 stops and an angle). */
export function FillField({ value, onChange, d }: { value: string | undefined; onChange: (v: string | undefined) => void; d: D }) {
  const grad = isGradient(value);
  const g = parseGradient(value);
  const setG = (next: Grad) => onChange(buildGradient(next));
  return (
    <div className="space-y-1.5">
      <Seg
        value={grad ? "gradient" : "solid"}
        onChange={(m) => onChange(m === "gradient" ? buildGradient(defaultGradient(value)) : g ? g.stops[0].color : undefined)}
        items={[{ id: "solid", label: d("fill.solid", "Solid") }, { id: "gradient", label: d("fill.gradient", "Gradient") }]}
      />
      {!grad ? (
        <ColorInput value={value} onChange={onChange} />
      ) : g ? (
        <div className="space-y-1.5">
          <div className="h-5 rounded-md border border-[var(--border)]" style={{ background: value }} />
          <Slide value={g.angle} min={0} max={360} unit="°" onChange={(n) => setG({ ...g, angle: n ?? 0 })} ariaLabel={d("fill.angle", "Angle")} />
          {g.stops.map((s, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_64px_28px] items-center gap-1">
              <ColorInput value={s.color} onChange={(c) => setG({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, color: c ?? x.color } : x)) })} />
              <Num value={s.pos} min={0} max={100} unit="%" onChange={(n) => setG({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, pos: n ?? 0 } : x)) })} />
              {g.stops.length > 2 ? <SmallBtn title={d("fill.removeStop", "Remove stop")} onClick={() => setG({ ...g, stops: g.stops.filter((_, j) => j !== i) })}><Trash2 size={12} /></SmallBtn> : <span />}
            </div>
          ))}
          {g.stops.length < 3 ? (
            <SmallBtn title={d("fill.addStop", "Add a color stop")} onClick={() => setG({ ...g, stops: [...g.stops.slice(0, -1), { color: "#ffffff", pos: 50 }, g.stops[g.stops.length - 1]] })}>
              <Plus size={12} /> {d("fill.addStop", "Add a color stop")}
            </SmallBtn>
          ) : null}
        </div>
      ) : (
        <TplField value={value ?? ""} onChange={(v) => onChange(v || undefined)} mono ariaLabel={d("ap.fill", "Fill")} />
      )}
    </div>
  );
}

const NEW_SHADOW: ShadowItem = { x: 0, y: 8, blur: 24, spread: 0, color: "rgba(0,0,0,.35)" };

/** List of shadows: x, y, blur, spread, color, inset. */
export function ShadowList({ value, onChange, d }: { value: ShadowItem[] | undefined; onChange: (v: ShadowItem[] | undefined) => void; d: D }) {
  const list = value ?? [];
  const set = (i: number, patch: Partial<ShadowItem>) => onChange(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-1.5">
      {list.map((s, i) => (
        <div key={i} className="space-y-1 rounded-lg border border-[var(--border)] p-1.5">
          <div className="grid grid-cols-4 gap-1">
            <Num value={s.x} unit="x" onChange={(n) => set(i, { x: n ?? 0 })} ariaLabel="x" />
            <Num value={s.y} unit="y" onChange={(n) => set(i, { y: n ?? 0 })} ariaLabel="y" />
            <Num value={s.blur} min={0} unit="b" onChange={(n) => set(i, { blur: n ?? 0 })} ariaLabel={d("sh.blur", "Blur")} />
            <Num value={s.spread ?? 0} unit="s" onChange={(n) => set(i, { spread: n ?? 0 })} ariaLabel={d("sh.spread", "Spread")} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-1.5">
            <ColorInput value={s.color} onChange={(c) => set(i, { color: c ?? "rgba(0,0,0,.35)" })} />
            <Check checked={!!s.inset} onChange={(v) => set(i, { inset: v || undefined })} label={d("sh.inset", "Inset")} />
            <SmallBtn title={d("sh.remove", "Remove shadow")} onClick={() => onChange(list.length > 1 ? list.filter((_, j) => j !== i) : undefined)}><Trash2 size={12} /></SmallBtn>
          </div>
        </div>
      ))}
      {list.length < 6 ? (
        <SmallBtn title={d("sh.add", "Add a shadow")} onClick={() => onChange([...list, { ...NEW_SHADOW }])}>
          <Plus size={12} /> {d("sh.add", "Add a shadow")}
        </SmallBtn>
      ) : null}
    </div>
  );
}

/** CSS filter functions as sliders. */
export function FilterFields({ value, onChange, d }: { value: FilterSet | undefined; onChange: (v: FilterSet | undefined) => void; d: D }) {
  const f = value ?? {};
  const set = (patch: Partial<FilterSet>) => {
    const next = { ...f, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? (next as FilterSet) : undefined);
  };
  const rows: { k: keyof FilterSet; label: string; min: number; max: number; neutral: number; unit: string }[] = [
    { k: "blur", label: d("fl.blur", "Blur"), min: 0, max: 40, neutral: 0, unit: "px" },
    { k: "brightness", label: d("fl.brightness", "Brightness"), min: 0, max: 300, neutral: 100, unit: "%" },
    { k: "contrast", label: d("fl.contrast", "Contrast"), min: 0, max: 300, neutral: 100, unit: "%" },
    { k: "saturate", label: d("fl.saturate", "Saturation"), min: 0, max: 300, neutral: 100, unit: "%" },
    { k: "hue", label: d("fl.hue", "Hue rotate"), min: -180, max: 180, neutral: 0, unit: "°" },
    { k: "grayscale", label: d("fl.grayscale", "Grayscale"), min: 0, max: 100, neutral: 0, unit: "%" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <Row key={r.k} label={r.label}>
          <Slide value={f[r.k] ?? r.neutral} min={r.min} max={r.max} unit={r.unit} onChange={(n) => set({ [r.k]: n === undefined || n === r.neutral ? undefined : n })} ariaLabel={r.label} />
        </Row>
      ))}
    </div>
  );
}

/** Border: width (all sides or per side), style, color. */
export function BorderFields({ style, onChange, d }: { style: Style; onChange: (v: Style["border"]) => void; d: D }) {
  const b = style.border;
  const per = !!b?.sides;
  const sides = b?.sides ?? [b?.w ?? 0, b?.w ?? 0, b?.w ?? 0, b?.w ?? 0];
  const base = { color: b?.color ?? "var(--sub-border)", style: b?.style };
  const setSides = (i: number, n: number | undefined) => {
    const next = [...sides];
    next[i] = n ?? 0;
    onChange(next.every((x) => x === 0) ? undefined : { ...base, w: Math.max(...next), sides: next });
  };
  return (
    <div className="space-y-1.5">
      {per ? (
        <div className="grid grid-cols-4 gap-1">
          {(["T", "R", "B", "L"] as const).map((l, i) => (
            <Num key={l} value={sides[i]} min={0} unit={l} onChange={(n) => setSides(i, n)} ariaLabel={l} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-1">
          <Num value={b?.w} min={0} unit="px" placeholder="0" onChange={(n) => onChange(n ? { ...base, w: n } : undefined)} />
          <ColorInput value={b?.color} onChange={(c) => onChange({ ...base, w: b?.w ?? 1, color: c ?? "var(--sub-border)" })} placeholder="color" />
        </div>
      )}
      {per ? <ColorInput value={b?.color} onChange={(c) => onChange({ ...base, w: b?.w ?? 1, sides, color: c ?? "var(--sub-border)" })} placeholder="color" /> : null}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Pick value={b?.style ?? "solid"} onChange={(v) => b && onChange({ ...b, style: v === "solid" ? undefined : v })} options={[{ id: "solid", label: d("bd.solid", "Solid") }, { id: "dashed", label: d("bd.dashed", "Dashed") }, { id: "dotted", label: d("bd.dotted", "Dotted") }]} />
        <Check checked={per} onChange={(v) => onChange(b || v ? (v ? { ...base, w: b?.w ?? 1, sides: [b?.w ?? 1, b?.w ?? 1, b?.w ?? 1, b?.w ?? 1] } : { ...base, w: b?.w ?? 1 }) : undefined)} label={d("bd.perSide", "Per side")} />
      </div>
    </div>
  );
}
