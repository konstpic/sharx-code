"use client";

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OnMount } from "@monaco-editor/react";
import { APP_CATALOG, subscriptionApps } from "@/lib/sharxSubpageConfig";
import { evalCondition, lintTemplate, renderTemplate, type Ctx } from "@/lib/subLayout/template";
import type { LNode, Size, Style } from "@/lib/subLayout/types";
import { ICON_NAMES, NodeIcon } from "@/components/sub/layout/icons";
import type { D } from "./i18n";
import { BorderFields, FillField, FilterFields, ShadowList } from "./StyleExtras";
import { BLEND_MODES } from "@/lib/subLayout/types";
import { Check, ColorInput, InsertContext, Num, Pick, Row, Section, Seg, Slide, TplField } from "./ui";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export type StyleEdit = {
  style: Style;
  set: (patch: Partial<Style>) => void;
  /** True when the parent is a `free` frame (x / y apply). */
  parentFree: boolean;
  bp: "base" | "mobile";
};

// ------------------------------------------------------------------------------------
// Template field with a live result underneath
// ------------------------------------------------------------------------------------

export function TplRow({ label, value, onChange, ctx, lang, multiline, rows, mono, placeholder, showResult = true }: { label: string; value: string; onChange: (v: string) => void; ctx: Ctx; lang: string; multiline?: boolean; rows?: number; mono?: boolean; placeholder?: string; showResult?: boolean }) {
  const lint = useMemo(() => lintTemplate(value), [value]);
  const res = useMemo(() => (showResult && value.includes("{{") ? renderTemplate(value, ctx, { lang }) : null), [value, ctx, lang, showResult]);
  return (
    <div className="space-y-1">
      <div className="text-[11.5px] text-[var(--fg-muted)]">{label}</div>
      <TplField value={value} onChange={onChange} multiline={multiline} rows={rows} mono={mono} placeholder={placeholder} ariaLabel={label} />
      {lint.length ? (
        <div className="text-[11px] text-red-400">{lint[0]}</div>
      ) : res ? (
        <div className={`truncate text-[11px] ${res.errors.length ? "text-amber-400" : "text-[var(--fg-subtle)]"}`} title={res.out}>
          {res.errors.length ? res.errors[0] : `→ ${res.out || "∅"}`}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------
// Sizes and spacing
// ------------------------------------------------------------------------------------

function sizeMode(v: Size | undefined): "auto" | "fill" | "fixed" {
  if (v === undefined || v === "auto" || v === "hug" || v === "") return "auto";
  if (v === "fill") return "fill";
  return "fixed";
}

function SizeField({ value, onChange, d }: { value: Size | undefined; onChange: (v: Size | undefined) => void; d: D }) {
  const mode = sizeMode(value);
  const unit = typeof value === "string" && /%$/.test(value) ? "%" : typeof value === "string" && /rem$/.test(value) ? "rem" : "px";
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : undefined;
  return (
    <div className="space-y-1">
      <Seg
        value={mode}
        onChange={(m) => {
          if (m === "auto") onChange(undefined);
          else if (m === "fill") onChange("fill");
          else onChange(typeof numeric === "number" && !Number.isNaN(numeric) ? value : 120);
        }}
        items={[
          { id: "auto", label: d("size.auto", "Auto") },
          { id: "fill", label: d("size.fill", "Fill") },
          { id: "fixed", label: d("size.fixed", "Fixed") },
        ]}
      />
      {mode === "fixed" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_64px] gap-1">
          <Num value={numeric === undefined || Number.isNaN(numeric) ? undefined : numeric} min={0} step={unit === "px" ? 1 : unit === "rem" ? 0.25 : 1} onChange={(n) => onChange(n === undefined ? undefined : unit === "px" ? n : `${n}${unit}`)} />
          <Pick value={unit} onChange={(u) => onChange(u === "px" ? (numeric ?? 120) : `${numeric ?? 50}${u}`)} options={[{ id: "px", label: "px" }, { id: "%", label: "%" }, { id: "rem", label: "rem" }]} />
        </div>
      ) : null}
    </div>
  );
}

function pad4(v: number | number[] | undefined): [number, number, number, number] {
  if (v === undefined) return [0, 0, 0, 0];
  if (typeof v === "number") return [v, v, v, v];
  const a = v.map((x) => Number(x) || 0);
  if (a.length === 1) return [a[0], a[0], a[0], a[0]];
  if (a.length === 2) return [a[0], a[1], a[0], a[1]];
  if (a.length === 3) return [a[0], a[1], a[2], a[1]];
  return [a[0], a[1], a[2], a[3]];
}

function SidesField({ value, onChange, labels }: { value: number | number[] | undefined; onChange: (v: number | number[] | undefined) => void; labels: [string, string, string, string] }) {
  const v = pad4(value);
  const set = (i: number, n: number | undefined) => {
    const next = [...v] as number[];
    next[i] = n ?? 0;
    onChange(next.every((x) => x === 0) ? undefined : next.every((x) => x === next[0]) ? next[0] : next);
  };
  return (
    <div className="grid grid-cols-2 gap-1">
      {labels.map((l, i) => (
        <Num key={l} value={v[i]} min={0} onChange={(n) => set(i, n)} ariaLabel={l} placeholder={l} unit={l} />
      ))}
    </div>
  );
}

const SHADOWS: { id: string; label: string; css: string }[] = [
  { id: "none", label: "None", css: "" },
  { id: "sm", label: "Small", css: "0 1px 3px rgba(0,0,0,.35)" },
  { id: "md", label: "Medium", css: "0 8px 24px rgba(0,0,0,.35)" },
  { id: "lg", label: "Large", css: "0 20px 50px rgba(0,0,0,.45)" },
  { id: "glow", label: "Glow", css: "0 0 24px color-mix(in oklab, var(--sub-accent, #22d3ee) 45%, transparent)" },
];

// ------------------------------------------------------------------------------------
// Style sections
// ------------------------------------------------------------------------------------

export function LayoutSection({ e, d }: { e: StyleEdit; d: D }) {
  const s = e.style;
  const mode = s.mode ?? "stack";
  return (
    <Section title={d("sec.layout", "Layout")}>
      <Seg value={mode} onChange={(m) => e.set({ mode: m })} items={[{ id: "stack", label: d("layout.stack", "Stack") }, { id: "grid", label: d("layout.grid", "Grid") }, { id: "free", label: d("layout.free", "Free") }]} />
      {mode === "stack" ? (
        <>
          <Row label={d("layout.dir", "Direction")}>
            <Seg
              value={s.dir ?? "column"}
              onChange={(v) => e.set({ dir: v })}
              items={[
                { id: "column", icon: <ArrowDown size={14} />, title: d("layout.column", "Vertical") },
                { id: "row", icon: <ArrowRight size={14} />, title: d("layout.row", "Horizontal") },
              ]}
            />
          </Row>
          <Row label={d("layout.wrap", "Wrap")}>
            <Check checked={!!s.wrap} onChange={(v) => e.set({ wrap: v || undefined })} label={d("layout.wrapItems", "Wrap items")} />
          </Row>
          <Row label={d("layout.justify", "Main axis")}>
            <Pick
              value={s.justify ?? "start"}
              onChange={(v) => e.set({ justify: v })}
              options={[
                { id: "start", label: d("j.start", "Start") },
                { id: "center", label: d("j.center", "Center") },
                { id: "end", label: d("j.end", "End") },
                { id: "between", label: d("j.between", "Space between") },
                { id: "around", label: d("j.around", "Space around") },
                { id: "evenly", label: d("j.evenly", "Space evenly") },
              ]}
            />
          </Row>
        </>
      ) : null}
      {mode === "grid" ? (
        <>
          <Row label={d("layout.cols", "Columns")}>
            <Num value={s.cols ?? 2} min={1} max={12} onChange={(n) => e.set({ cols: n, colMin: undefined })} />
          </Row>
          <Row label={d("layout.colMin", "Min column")} hint={d("layout.colMinHint", "Auto-fit columns of at least this width (overrides the column count)")}>
            <Num value={s.colMin} min={0} placeholder={d("layout.off", "off")} unit="px" onChange={(n) => e.set({ colMin: n })} />
          </Row>
        </>
      ) : null}
      {mode !== "free" ? (
        <>
          <Row label={d("layout.align", "Cross axis")}>
            <Pick
              value={s.align ?? "stretch"}
              onChange={(v) => e.set({ align: v })}
              options={[
                { id: "stretch", label: d("a.stretch", "Stretch") },
                { id: "start", label: d("a.start", "Start") },
                { id: "center", label: d("a.center", "Center") },
                { id: "end", label: d("a.end", "End") },
                { id: "baseline", label: d("a.baseline", "Baseline") },
              ]}
            />
          </Row>
          <Row label={d("layout.gap", "Gap")}>
            <Num value={s.gap} min={0} unit="px" placeholder="0" onChange={(n) => e.set({ gap: n })} />
          </Row>
        </>
      ) : (
        <p className="text-[11px] leading-snug text-[var(--fg-subtle)]">{d("layout.freeHint", "Children are placed by X / Y. Drag them on the canvas; the frame needs a fixed height.")}</p>
      )}
      <Row label={d("layout.padding", "Padding")}>
        <SidesField value={s.pad} onChange={(v) => e.set({ pad: v })} labels={["T", "R", "B", "L"]} />
      </Row>
    </Section>
  );
}

export function SizeSection({ e, d }: { e: StyleEdit; d: D; isBox?: boolean }) {
  const s = e.style;
  const [more, setMore] = useState(false);
  return (
    <Section title={d("sec.size", "Size & position")}>
      <Row label={d("size.width", "Width")}>
        <SizeField value={s.w} onChange={(v) => e.set({ w: v })} d={d} />
      </Row>
      <Row label={d("size.height", "Height")}>
        <SizeField value={s.h} onChange={(v) => e.set({ h: v })} d={d} />
      </Row>
      {e.parentFree ? (
        <Row label="X / Y">
          <div className="grid grid-cols-2 gap-1">
            <Num value={s.x ?? 0} unit="X" onChange={(n) => e.set({ x: n ?? 0 })} />
            <Num value={s.y ?? 0} unit="Y" onChange={(n) => e.set({ y: n ?? 0 })} />
          </div>
        </Row>
      ) : (
        <Row label={d("size.self", "Align self")}>
          <Pick
            value={s.self ?? "auto"}
            onChange={(v) => e.set({ self: v === "auto" ? undefined : v })}
            options={[
              { id: "auto", label: d("a.auto", "Auto") },
              { id: "start", label: d("a.start", "Start") },
              { id: "center", label: d("a.center", "Center") },
              { id: "end", label: d("a.end", "End") },
              { id: "stretch", label: d("a.stretch", "Stretch") },
            ]}
          />
        </Row>
      )}
      <Row label={d("size.layer", "Layer / angle")}>
        <div className="grid grid-cols-2 gap-1">
          <Num value={s.z} placeholder="z-index" onChange={(n) => e.set({ z: n })} ariaLabel="z-index" />
          <Num value={s.rotate} unit="°" placeholder="0" onChange={(n) => e.set({ rotate: n })} ariaLabel={d("size.rotate", "Rotation")} />
        </div>
      </Row>
      <button type="button" onClick={() => setMore((m) => !m)} className="text-[11px] text-[var(--accent)] hover:underline">
        {more ? d("size.less", "Fewer options") : d("size.more", "Margin, min / max, grow…")}
      </button>
      {more ? (
        <div className="space-y-2">
          <Row label={d("size.margin", "Margin")}>
            <SidesField value={s.mar} onChange={(v) => e.set({ mar: v })} labels={["T", "R", "B", "L"]} />
          </Row>
          <Row label="Min W / H">
            <div className="grid grid-cols-2 gap-1">
              <Num value={typeof s.minW === "number" ? s.minW : undefined} min={0} unit="W" onChange={(n) => e.set({ minW: n })} />
              <Num value={typeof s.minH === "number" ? s.minH : undefined} min={0} unit="H" onChange={(n) => e.set({ minH: n })} />
            </div>
          </Row>
          <Row label="Max W / H">
            <div className="grid grid-cols-2 gap-1">
              <Num value={typeof s.maxW === "number" ? s.maxW : undefined} min={0} unit="W" onChange={(n) => e.set({ maxW: n })} />
              <Num value={typeof s.maxH === "number" ? s.maxH : undefined} min={0} unit="H" onChange={(n) => e.set({ maxH: n })} />
            </div>
          </Row>
          <Row label={d("size.grow", "Grow")} hint={d("size.growHint", "Share the free space of a stack with the other growing children")}>
            <Num value={s.grow} min={0} max={10} placeholder="0" onChange={(n) => e.set({ grow: n })} />
          </Row>
          <Row label={d("size.aspect", "Aspect")}>
            <TplField value={s.aspect ?? ""} onChange={(v) => e.set({ aspect: v || undefined })} placeholder="16 / 9" />
          </Row>
        </div>
      ) : null}
    </Section>
  );
}

export function AppearanceSection({ e, d }: { e: StyleEdit; d: D }) {
  const s = e.style;
  const corners = Array.isArray(s.radius);
  const shadowId = s.shadows?.length ? "list" : (SHADOWS.find((x) => x.css === (s.shadow ?? ""))?.id ?? "custom");
  return (
    <Section title={d("sec.appearance", "Appearance")}>
      <Row label={d("ap.fill", "Fill")}>
        <FillField value={s.bg} onChange={(v) => e.set({ bg: v })} d={d} />
      </Row>
      <Row label={d("ap.image", "Image")}>
        <TplField value={s.bgImage ?? ""} onChange={(v) => e.set({ bgImage: v || undefined })} placeholder="https://…/bg.jpg" />
      </Row>
      {s.bgImage ? (
        <>
          <Row label={d("ap.imgFit", "Image fit")}>
            <Seg value={s.bgSize ?? "cover"} onChange={(v) => e.set({ bgSize: v === "cover" ? undefined : v })} items={[{ id: "cover", label: d("fit.cover", "Cover") }, { id: "contain", label: d("fit.contain", "Contain") }, { id: "auto", label: d("size.auto", "Auto") }]} />
          </Row>
          <Row label={d("ap.imgPos", "Position")}>
            <Pick
              value={s.bgPos ?? "center"}
              onChange={(v) => e.set({ bgPos: v === "center" ? undefined : v })}
              options={["center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"].map((p) => ({ id: p, label: d(`pos.${p.replace(" ", "-")}`, p) }))}
            />
          </Row>
          <Row label={d("ap.imgRepeat", "Repeat")}>
            <Pick value={s.bgRepeat ?? "no-repeat"} onChange={(v) => e.set({ bgRepeat: v === "no-repeat" ? undefined : v })} options={[{ id: "no-repeat", label: d("rep.no", "No repeat") }, { id: "repeat", label: d("rep.both", "Tile") }, { id: "repeat-x", label: d("rep.x", "Tile horizontally") }, { id: "repeat-y", label: d("rep.y", "Tile vertically") }]} />
          </Row>
        </>
      ) : null}
      <Row label={d("ap.border", "Border")}>
        <BorderFields style={s} onChange={(v) => e.set({ border: v })} d={d} />
      </Row>
      <Row label={d("ap.radius", "Radius")}>
        {corners ? (
          <div className="space-y-1">
            <SidesField value={s.radius} onChange={(v) => e.set({ radius: v })} labels={["↖", "↗", "↘", "↙"]} />
            <button type="button" className="text-[11px] text-[var(--accent)] hover:underline" onClick={() => e.set({ radius: Array.isArray(s.radius) ? s.radius[0] : undefined })}>
              {d("ap.oneRadius", "One value for all corners")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-1">
            <Num value={typeof s.radius === "number" ? s.radius : undefined} min={0} unit="px" placeholder="0" onChange={(n) => e.set({ radius: n })} />
            <button type="button" className="h-8 rounded-lg border border-[var(--border)] text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)]" title={d("ap.corners", "Each corner")} onClick={() => e.set({ radius: [Number(s.radius) || 0, Number(s.radius) || 0, Number(s.radius) || 1, Number(s.radius) || 0] })}>
              ⌜⌝
            </button>
          </div>
        )}
      </Row>
      <Row label={d("ap.shadow", "Shadow")}>
        <Pick
          value={shadowId}
          onChange={(id) => {
            if (id === "list") e.set({ shadows: s.shadows?.length ? s.shadows : [{ x: 0, y: 8, blur: 24, spread: 0, color: "rgba(0,0,0,.35)" }], shadow: undefined });
            else e.set({ shadow: SHADOWS.find((x) => x.id === id)?.css || undefined, shadows: undefined });
          }}
          options={[...SHADOWS.map((x) => ({ id: x.id, label: d(`sh.${x.id}`, x.label) })), { id: "list", label: d("sh.list", "Custom shadows…") }, ...(shadowId === "custom" ? [{ id: "custom", label: d("sh.custom", "Custom") }] : [])]}
        />
      </Row>
      {s.shadows?.length ? <ShadowList value={s.shadows} onChange={(v) => e.set({ shadows: v })} d={d} /> : null}
      <Row label={d("ap.opacity", "Opacity")}>
        <div className="flex items-center gap-2">
          <input type="range" min={0} max={100} value={Math.round((s.opacity ?? 1) * 100)} onChange={(ev) => e.set({ opacity: Number(ev.target.value) >= 100 ? undefined : Number(ev.target.value) / 100 })} className="h-1 w-full accent-[var(--accent)]" aria-label={d("ap.opacity", "Opacity")} />
          <span className="w-8 text-right text-[11px] text-[var(--fg-muted)]">{Math.round((s.opacity ?? 1) * 100)}</span>
        </div>
      </Row>
      <Row label={d("ap.blend", "Blend mode")}>
        <Pick value={s.blend ?? "normal"} onChange={(v) => e.set({ blend: v === "normal" ? undefined : v })} options={BLEND_MODES.map((b) => ({ id: b, label: d(`blend.${b}`, b) }))} />
      </Row>
      <Row label={d("ap.overflow", "Overflow")}>
        <Pick value={s.overflow ?? "visible"} onChange={(v) => e.set({ overflow: v === "visible" ? undefined : v })} options={[{ id: "visible", label: d("ov.visible", "Visible") }, { id: "hidden", label: d("ov.hidden", "Clip") }, { id: "auto", label: d("ov.auto", "Scroll") }]} />
      </Row>
      <Row label={d("ap.blur", "Blur behind")}>
        <Slide value={s.blur ?? 0} min={0} max={40} unit="px" onChange={(n) => e.set({ blur: n || undefined })} ariaLabel={d("ap.blur", "Blur behind")} />
      </Row>
      <details className="text-[11px] text-[var(--fg-muted)]" open={!!s.filter}>
        <summary className="cursor-pointer py-1">{d("ap.filters", "Filters")}</summary>
        <FilterFields value={s.filter} onChange={(v) => e.set({ filter: v })} d={d} />
      </details>
      <Row label={d("ap.cursor", "Cursor")}>
        <Pick value={s.cursor ?? "auto"} onChange={(v) => e.set({ cursor: v === "auto" ? undefined : v })} options={["auto", "pointer", "default", "text", "move", "grab", "not-allowed", "help", "crosshair"].map((c) => ({ id: c, label: c }))} />
      </Row>
      <div className="grid grid-cols-2 gap-x-2">
        <Check checked={s.pointer === "none"} onChange={(v) => e.set({ pointer: v ? "none" : undefined })} label={d("ap.noPointer", "Ignore clicks")} />
        <Check checked={s.visibility === "hidden"} onChange={(v) => e.set({ visibility: v ? "hidden" : undefined })} label={d("ap.invisible", "Invisible (keeps space)")} />
      </div>
    </Section>
  );
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export function TextSection({ e, d }: { e: StyleEdit; d: D }) {
  const s = e.style;
  return (
    <Section title={d("sec.text", "Text")}>
      <Row label={d("tx.font", "Font")}>
        <Pick
          value={["sans", "heading", "mono", "script"].includes(s.family ?? "sans") ? (s.family ?? "sans") : "custom"}
          onChange={(v) => e.set({ family: v === "sans" ? undefined : v === "custom" ? "Inter, sans-serif" : v })}
          options={[{ id: "sans", label: d("f.sans", "Page font") }, { id: "heading", label: d("f.heading", "Heading font") }, { id: "mono", label: d("f.mono", "Monospace") }, { id: "script", label: d("f.script", "Script") }, { id: "custom", label: d("f.custom", "Custom…") }]}
        />
      </Row>
      {s.family && !["sans", "heading", "mono", "script"].includes(s.family) ? (
        <Row label={d("tx.family", "Font family")} hint={d("tx.familyHint", "A CSS font-family list, e.g. Inter, sans-serif")}>
          <TplField value={s.family} onChange={(v) => e.set({ family: v || undefined })} mono placeholder="Inter, sans-serif" ariaLabel={d("tx.family", "Font family")} />
        </Row>
      ) : null}
      <Row label={d("tx.size", "Size / weight")}>
        <div className="grid grid-cols-2 gap-1">
          <Num value={s.fs} min={6} max={120} unit="px" placeholder="16" onChange={(n) => e.set({ fs: n })} />
          <Pick value={String(s.fw ?? 400)} onChange={(v) => e.set({ fw: Number(v) === 400 ? undefined : Number(v) })} options={WEIGHTS.map((w) => ({ id: String(w), label: String(w) }))} />
        </div>
      </Row>
      <Row label={d("tx.color", "Color")}>
        <ColorInput value={s.color} onChange={(v) => e.set({ color: v })} placeholder="inherit" />
      </Row>
      <Row label={d("tx.align", "Align")}>
        <Seg
          value={s.ta ?? "left"}
          onChange={(v) => e.set({ ta: v === "left" ? undefined : v })}
          items={[
            { id: "left", icon: <AlignLeft size={14} /> },
            { id: "center", icon: <AlignCenter size={14} /> },
            { id: "right", icon: <AlignRight size={14} /> },
            { id: "justify", icon: <AlignJustify size={14} />, title: d("tx.justify", "Justify") },
          ]}
        />
      </Row>
      <Row label={d("tx.spacing", "Line / letter")}>
        <div className="grid grid-cols-2 gap-1">
          <Num value={s.lh} min={0.8} max={3} step={0.05} placeholder="1.5" onChange={(n) => e.set({ lh: n })} />
          <Num value={s.ls} min={-2} max={20} step={0.1} unit="px" placeholder="0" onChange={(n) => e.set({ ls: n })} />
        </div>
      </Row>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <Check checked={!!s.upper} onChange={(v) => e.set({ upper: v || undefined })} label={d("tx.upper", "UPPERCASE")} />
        <Check checked={!!s.italic} onChange={(v) => e.set({ italic: v || undefined })} label={d("tx.italic", "Italic")} />
        <Check checked={!!s.underline} onChange={(v) => e.set({ underline: v || undefined })} label={d("tx.underline", "Underline")} />
        <Check checked={!!s.truncate} onChange={(v) => e.set({ truncate: v || undefined })} label={d("tx.truncate", "One line …")} />
        <Check checked={!!s.nowrap} onChange={(v) => e.set({ nowrap: v || undefined })} label={d("tx.nowrap", "No wrapping")} />
      </div>
      <Row label={d("tx.deco", "Decoration")}>
        <Pick value={s.deco ?? "none"} onChange={(v) => e.set({ deco: v === "none" ? undefined : v })} options={[{ id: "none", label: d("deco.none", "None") }, { id: "underline", label: d("deco.underline", "Underline") }, { id: "line-through", label: d("deco.strike", "Strikethrough") }, { id: "overline", label: d("deco.overline", "Overline") }]} />
      </Row>
      <Row label={d("tx.wrap", "Wrapping")}>
        <Pick value={s.tw ?? "wrap"} onChange={(v) => e.set({ tw: v === "wrap" ? undefined : v })} options={[{ id: "wrap", label: d("tw.wrap", "Normal") }, { id: "balance", label: d("tw.balance", "Balanced") }, { id: "pretty", label: d("tw.pretty", "Pretty") }]} />
      </Row>
      <Row label={d("tx.clamp", "Line clamp")} hint={d("tx.clampHint", "Cut the text after this many lines with an ellipsis")}>
        <Num value={s.clamp} min={0} max={20} placeholder={d("layout.off", "off")} onChange={(n) => e.set({ clamp: n && n > 0 ? n : undefined })} />
      </Row>
    </Section>
  );
}

export function VisibilitySection({ node, ctx, lang, onCond, onHide, d }: { node: LNode; ctx: Ctx; lang: string; onCond: (v: string) => void; onHide: (h: { mobile?: boolean; desktop?: boolean } | undefined) => void; d: D }) {
  const cond = useMemo(() => evalCondition(node.visibleIf, ctx, { lang }), [node.visibleIf, ctx, lang]);
  return (
    <Section title={d("sec.visibility", "Visibility")} defaultOpen={!!(node.visibleIf || node.hideOn)}>
      <div className="space-y-1">
        <div className="text-[11.5px] text-[var(--fg-muted)]">{d("vis.showIf", "Show only if")}</div>
        <TplField value={node.visibleIf ?? ""} onChange={onCond} placeholder="user.isActive && devices.count < devices.max" mono ariaLabel={d("vis.showIf", "Show only if")} />
        {node.visibleIf?.trim() ? (
          <div className={`text-[11px] ${cond.error ? "text-red-400" : cond.value ? "text-emerald-400" : "text-amber-400"}`}>
            {cond.error ? cond.error : cond.value ? d("vis.nowShown", "Now: shown (with the preview data)") : d("vis.nowHidden", "Now: hidden (with the preview data)")}
          </div>
        ) : (
          <div className="text-[11px] text-[var(--fg-subtle)]">{d("vis.hint", "An expression on the variables, e.g. user.isActive or devices.count > 0")}</div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-2">
        <Check checked={!!node.hideOn?.mobile} onChange={(v) => onHide({ mobile: v || undefined, desktop: node.hideOn?.desktop })} label={d("vis.hideMobile", "Hide on mobile")} />
        <Check checked={!!node.hideOn?.desktop} onChange={(v) => onHide({ desktop: v || undefined, mobile: node.hideOn?.mobile })} label={d("vis.hideDesktop", "Hide on desktop")} />
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------------------------
// Code editor (html / css / js) with variable insertion
// ------------------------------------------------------------------------------------

export function CodeEditor({ value, onChange, language, height = 220 }: { value: string; onChange: (v: string) => void; language: "html" | "css" | "javascript" | "json"; height?: number }) {
  const reg = useContext(InsertContext);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    const register = () => {
      reg.current = (text: string) => {
        const sel = editor.getSelection();
        if (!sel) return;
        editor.executeEdits("variable", [{ range: sel, text, forceMoveMarkers: true }]);
        editor.focus();
      };
    };
    editor.onDidFocusEditorText(register);
    register();
  };
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      <MonacoEditor
        height={height}
        language={language}
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={onMount}
        options={{ minimap: { enabled: false }, fontSize: 12, lineNumbers: "off", scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, folding: false, glyphMargin: false, renderLineHighlight: "none", padding: { top: 6, bottom: 6 } }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------
// Icon picker
// ------------------------------------------------------------------------------------

export function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1">
      {ICON_NAMES.map((n) => (
        <button key={n} type="button" title={n} onClick={() => onChange(n)} className={`grid size-8 place-items-center rounded-md ${n === value ? "bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] text-[var(--fg)]" : "text-[var(--fg-muted)] hover:bg-[var(--surface)] hover:text-[var(--fg)]"}`}>
          <NodeIcon name={n} size={16} />
        </button>
      ))}
    </div>
  );
}

export function AppPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const apps = subscriptionApps.filter((a) => a !== "custom" && APP_CATALOG[a]?.deepLinkTemplate);
  return <Pick value={value || apps[0]} onChange={onChange} options={apps.map((a) => ({ id: a, label: APP_CATALOG[a].label }))} />;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] px-2.5 py-2 text-[11px] leading-snug text-[var(--fg-muted)]">{children}</p>;
}

/** Re-render helper for uncontrolled bits that need the latest ctx. */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  useEffect(() => {
    r.current = v;
  });
  return r;
}
