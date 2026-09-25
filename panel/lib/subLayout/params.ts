import { safeCssValue } from "./css";
import type { ParamDef, ParamType, ParamValue } from "./types";

/**
 * Parameters of custom-code (html) elements. Each param becomes (1) a template variable `{{ p.key }}` and (2) a CSS
 * custom property `--p-<key>` on the shadow host, so CSS can read `var(--p-speed)`.
 */

export const PARAM_TYPES: ParamType[] = ["number", "range", "color", "select", "toggle", "text", "font"];
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export function isParamKey(k: string): boolean {
  return KEY.test(k);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Coerces a stored value to what the param type expects. */
export function coerceParam(def: ParamDef, v: unknown): ParamValue {
  switch (def.type) {
    case "number":
    case "range": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      const x = Number.isFinite(n) ? n : Number(def.default) || 0;
      return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, x));
    }
    case "toggle":
      return typeof v === "boolean" ? v : v === "true" || v === 1 || v === "1" ? true : v === "false" || v === 0 || v === "0" ? false : Boolean(def.default);
    case "select": {
      const s = v === undefined || v === null ? String(def.default) : String(v);
      const opts = def.options ?? [];
      return opts.length === 0 || opts.some((o) => o.value === s) ? s : String(def.default);
    }
    default:
      return v === undefined || v === null ? String(def.default) : String(v).slice(0, 300);
  }
}

/** Validates untrusted params (saved JSON / import). Bad entries are dropped, keys are unique. */
export function normalizeParams(raw: unknown): ParamDef[] {
  if (!Array.isArray(raw)) return [];
  const out: ParamDef[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, 60)) {
    if (!isObj(r) || typeof r.key !== "string" || !KEY.test(r.key) || seen.has(r.key)) continue;
    const type = (PARAM_TYPES as string[]).includes(String(r.type)) ? (r.type as ParamType) : "text";
    const def: ParamDef = { key: r.key, label: typeof r.label === "string" && r.label ? r.label.slice(0, 80) : r.key, type, default: "" };
    const dv = r.default;
    def.default = typeof dv === "number" || typeof dv === "boolean" || typeof dv === "string" ? dv : type === "toggle" ? false : type === "number" || type === "range" ? 0 : "";
    const min = finite(r.min);
    const max = finite(r.max);
    const step = finite(r.step);
    if (min !== undefined) def.min = min;
    if (max !== undefined) def.max = max;
    if (step !== undefined && step > 0) def.step = step;
    if (typeof r.unit === "string" && /^[a-z%]{0,4}$/i.test(r.unit) && r.unit) def.unit = r.unit;
    if (typeof r.group === "string" && r.group.trim()) def.group = r.group.trim().slice(0, 40);
    if (Array.isArray(r.options)) {
      const opts = r.options
        .filter((o): o is Record<string, unknown> => isObj(o) && (typeof o.value === "string" || typeof o.value === "number"))
        .map((o) => ({ value: String(o.value), label: typeof o.label === "string" && o.label ? o.label : String(o.value) }))
        .slice(0, 40);
      if (opts.length) def.options = opts;
    }
    seen.add(def.key);
    out.push(def);
  }
  return out;
}

/** Validates the stored values map (only known primitive values under safe keys). */
export function normalizeValues(raw: unknown): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (KEY.test(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) out[k] = typeof v === "string" ? v.slice(0, 300) : v;
  return out;
}

/** The effective value of every param (stored value or default), coerced. */
export function paramValues(params: ParamDef[] | undefined, values: Record<string, unknown> | undefined): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of params ?? []) out[p.key] = coerceParam(p, values?.[p.key] ?? p.default);
  return out;
}

/** CSS custom properties `--p-<key>` (numbers get their unit, toggles are 1 / 0). Unsafe text values are dropped. */
export function paramCssVars(params: ParamDef[] | undefined, values: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const eff = paramValues(params, values);
  for (const p of params ?? []) {
    const v = eff[p.key];
    let s: string;
    if (p.type === "toggle") s = v ? "1" : "0";
    else if (typeof v === "number") s = `${v}${p.unit ?? ""}`;
    else s = safeCssValue(String(v)) || "";
    if (s !== "") out[`--p-${p.key}`] = s;
  }
  return out;
}

// ------------------------------------------------------------------------------------
// Standard animation parameters
// ------------------------------------------------------------------------------------

export type StdAnimOptions = {
  /** Default duration in seconds. */
  dur?: number;
  delay?: number;
  easing?: string;
  dir?: string;
  /** "infinite" or a number as text. */
  iter?: string;
  /** Duration slider range. */
  durMin?: number;
  durMax?: number;
  /** Add the trigger param (load | visible | hover). */
  trigger?: boolean;
  /** Skip these standard keys. */
  omit?: string[];
  /** Colors: default accent / secondary (CSS values). Set to false to skip. */
  accent?: string | false;
  secondary?: string | false;
  /** Add "size / intensity" (0.5-2, default 1). */
  size?: boolean;
};

export const STD_EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out", "cubic-bezier(.34,1.56,.64,1)"];

/** The standard set: speed (duration), delay, easing, direction, loop count, colors, size and trigger. */
export function stdAnimParams(o: StdAnimOptions = {}): ParamDef[] {
  const dur = o.dur ?? 2;
  const list: ParamDef[] = [
    { key: "dur", label: "Duration", type: "range", default: dur, min: o.durMin ?? Math.min(0.2, dur), max: o.durMax ?? Math.max(10, dur * 3), step: 0.1, unit: "s", group: "Animation" },
    { key: "delay", label: "Delay", type: "range", default: o.delay ?? 0, min: 0, max: 10, step: 0.1, unit: "s", group: "Animation" },
    {
      key: "easing",
      label: "Easing",
      type: "select",
      default: o.easing ?? "ease",
      options: [...new Set([...STD_EASINGS, o.easing ?? "ease"])].map((v) => ({ value: v, label: v === "cubic-bezier(.34,1.56,.64,1)" ? "spring" : v })),
      group: "Animation",
    },
    {
      key: "dir",
      label: "Direction",
      type: "select",
      default: o.dir ?? "normal",
      options: ["normal", "reverse", "alternate", "alternate-reverse"].map((v) => ({ value: v, label: v })),
      group: "Animation",
    },
    {
      key: "iter",
      label: "Repeat",
      type: "select",
      default: o.iter ?? "infinite",
      options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "5", label: "5" }, { value: "infinite", label: "loop" }],
      group: "Animation",
    },
  ];
  if (o.trigger) {
    list.push({ key: "trigger", label: "Start", type: "select", default: "load", options: [{ value: "load", label: "on load" }, { value: "visible", label: "when visible" }, { value: "hover", label: "on hover" }], group: "Animation" });
  }
  if (o.accent !== false) list.push({ key: "accent", label: "Accent color", type: "color", default: o.accent ?? "var(--sub-accent,#22d3ee)", group: "Colors" });
  if (o.secondary !== false && o.secondary !== undefined) list.push({ key: "secondary", label: "Second color", type: "color", default: o.secondary, group: "Colors" });
  if (o.size) list.push({ key: "size", label: "Size", type: "range", default: 1, min: 0.5, max: 2, step: 0.05, group: "Look" });
  const omit = new Set(o.omit ?? []);
  return list.filter((p) => !omit.has(p.key));
}

/** Overrides defaults of a param list by key (used by catalog items with their own colors / counts). */
export function withParams(base: ParamDef[], ...extra: ParamDef[]): ParamDef[] {
  const map = new Map(base.map((p) => [p.key, p]));
  for (const e of extra) map.set(e.key, e);
  return [...map.values()];
}

/**
 * Prefix for catalog CSS: defines the animation shorthand variables with defaults and the `trigger` behavior
 * (`data-ptrig="hover"|"visible"` on the host pauses animations until hover / visibility).
 * Use in CSS as `animation: k var(--p-dur,2s) var(--p-easing,ease) var(--p-delay,0s) var(--p-iter,infinite) var(--p-dir,normal)`.
 */
export function applyStdCss(css: string): string {
  return (
    `:host{--p-delay:0s;--p-easing:ease;--p-dir:normal;--p-iter:infinite}` +
    `:host([data-ptrig="hover"]) *{animation-play-state:paused!important}` +
    `:host([data-ptrig="hover"]:hover) *{animation-play-state:running!important}` +
    `:host([data-ptrig="visible"]:not([data-motion="active"])) *{animation-play-state:paused!important}` +
    css
  );
}

/** The shorthand used by upgraded catalog CSS, with a per-item default duration/easing/iteration. */
export function animVars(dur: string, easing = "ease", iter = "infinite", dir = "normal", delay = "0s"): string {
  return `var(--p-dur,${dur}) var(--p-easing,${easing}) var(--p-delay,${delay}) var(--p-iter,${iter}) var(--p-dir,${dir})`;
}
