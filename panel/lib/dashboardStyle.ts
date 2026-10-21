/**
 * Tile styling model (dashboard grid): `TileSettings.style`.
 *
 * Contract
 * - `style` is OPTIONAL and SPARSE: it stores only fields that differ from DEFAULT_STYLE (or that differ from the
 *   active preset, see `normalizeStyle`). A tile without `style` looks exactly like before this feature existed:
 *   `frameStyle(undefined)` is empty, so no CSS variable, attribute or class is added to the tile.
 * - Effective value of a field = DEFAULT_STYLE < STYLE_PRESETS[style.preset] < explicit field of `style`.
 * - Every stored value is validated and clamped by `normalizeStyle`; garbage falls back to the default (the field is dropped).
 * - Pure functions only, relative imports only (unit tested in dashboardStyle.test.ts).
 *
 * Where fields apply
 * - FRAME level (every tile kind, through GridTile): preset, bg, blur, border, radius, shadow, padding, accentGlow,
 *   accent / accent2 / hue (re-points the tile's `--accent`), labelColor, labelScale, uppercaseLabel, labelPos, trackColor,
 *   hideOnMobile. Classic / v2.7.1 composites keep their inner look; only their outer frame follows.
 * - VALUE level (metric tiles: CustomMetricPanel + viz.tsx): valueColor, colorMode, levelColors, invertThresholds,
 *   valueScale, valueFont, valueWeight, align, icon*, unit/prefix/suffix/abbreviate/thousands, showDelta, hideWhenZero,
 *   emptyText, spark, gauge, barHeight, grid, onClick, pulseOnCrit, countUp.
 */

/* ------------------------------------------------------------------ enums */

export const FRAME_PRESETS = ["default", "glass", "flat", "outline", "gradient", "neon", "soft", "contrast", "transparent"] as const;
export type FramePreset = (typeof FRAME_PRESETS)[number];
export const BG_MODES = ["default", "transparent", "solid", "gradient"] as const;
export type BgMode = (typeof BG_MODES)[number];
export const BORDER_STYLES = ["solid", "dashed", "dotted"] as const;
export const SHADOWS = ["default", "none", "sm", "md", "lg", "glow"] as const;
export type Shadow = (typeof SHADOWS)[number];
export const PADDINGS = ["compact", "normal", "roomy"] as const;
export const COLOR_MODES = ["thresholds", "fixed", "gradient-by-value"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export const VALUE_FONTS = ["default", "mono", "sans", "heading"] as const;
export const LABEL_POS = ["top", "bottom", "hidden"] as const;
export const ALIGNS = ["default", "left", "center", "right"] as const;
export const ICON_POS = ["left", "right", "top"] as const;
export const THOUSANDS = ["default", "none", "space", "comma"] as const;
export const CURVES = ["smooth", "linear", "step"] as const;
export const ARCS = [180, 240, 270, 360] as const;
export const CLICK_ACTIONS = ["none", "history", "link"] as const;
/** Colour references besides `#rrggbb`: resolved against the theme (so a preset works in every theme). */
export const COLOR_TOKENS = ["accent", "accent2", "surface", "elevated", "fg"] as const;
/** Curated lucide icon names a tile may show (mapped to components in components/dashboard/editor/icons.ts). */
export const STYLE_ICONS = [
  "activity", "gauge", "cpu", "memory-stick", "hard-drive", "database", "server", "network", "wifi", "globe", "users", "user",
  "arrow-up", "arrow-down", "arrow-up-down", "clock", "timer", "zap", "shield", "shield-check", "lock", "key", "bell", "alert-triangle",
  "check-circle", "heart-pulse", "thermometer", "bar-chart-3", "line-chart", "pie-chart", "layers", "box", "cloud", "download", "upload",
  "refresh-cw", "settings", "star", "flame", "radio",
] as const;

/* ------------------------------------------------------------------ types */

export type TileStyle = {
  preset?: FramePreset;
  bg?: { mode?: BgMode; color?: string; color2?: string; angle?: number; opacity?: number };
  blur?: number;
  border?: { show?: boolean; width?: number; style?: (typeof BORDER_STYLES)[number]; color?: string; opacity?: number };
  radius?: number;
  shadow?: Shadow;
  padding?: (typeof PADDINGS)[number];
  accentGlow?: boolean;
  accent?: string;
  hue?: number;
  accent2?: string;
  valueColor?: string;
  labelColor?: string;
  trackColor?: string;
  colorMode?: ColorMode;
  levelColors?: { ok?: string; warn?: string; crit?: string };
  valueScale?: number;
  labelScale?: number;
  valueFont?: (typeof VALUE_FONTS)[number];
  valueWeight?: number;
  labelPos?: (typeof LABEL_POS)[number];
  align?: (typeof ALIGNS)[number];
  uppercaseLabel?: boolean;
  showIcon?: boolean;
  icon?: string;
  iconPos?: (typeof ICON_POS)[number];
  unit?: string;
  prefix?: string;
  suffix?: string;
  abbreviate?: boolean;
  thousands?: (typeof THOUSANDS)[number];
  invertThresholds?: boolean;
  showDelta?: boolean;
  hideWhenZero?: boolean;
  emptyText?: string;
  spark?: { show?: boolean; window?: number; curve?: (typeof CURVES)[number]; fill?: boolean; strokeWidth?: number; markers?: boolean };
  gauge?: { thickness?: number; arc?: (typeof ARCS)[number]; roundCaps?: boolean; ticks?: boolean };
  barHeight?: number;
  grid?: boolean;
  onClick?: (typeof CLICK_ACTIONS)[number];
  url?: string;
  hideOnMobile?: boolean;
  pulseOnCrit?: boolean;
  countUp?: boolean;
};

/** Every field with its effective value (optional ones may stay undefined = "auto"). */
export type ResolvedStyle = {
  preset: FramePreset;
  bg: { mode: BgMode; color: string; color2: string; angle: number; opacity: number };
  blur: number;
  border: { show: boolean; width: number; style: (typeof BORDER_STYLES)[number]; color: string; opacity: number };
  radius: number;
  shadow: Shadow;
  padding: (typeof PADDINGS)[number];
  accentGlow: boolean;
  accent?: string;
  hue: number;
  accent2?: string;
  valueColor?: string;
  labelColor?: string;
  trackColor?: string;
  colorMode: ColorMode;
  levelColors: { ok?: string; warn: string; crit: string };
  valueScale: number;
  labelScale: number;
  valueFont: (typeof VALUE_FONTS)[number];
  valueWeight: number;
  labelPos: (typeof LABEL_POS)[number];
  align: (typeof ALIGNS)[number];
  uppercaseLabel: boolean;
  showIcon?: boolean;
  icon?: string;
  iconPos: (typeof ICON_POS)[number];
  unit: string;
  prefix: string;
  suffix: string;
  abbreviate: boolean;
  thousands: (typeof THOUSANDS)[number];
  invertThresholds: boolean;
  showDelta: boolean;
  hideWhenZero: boolean;
  emptyText: string;
  spark: { show: boolean; window: number; curve: (typeof CURVES)[number]; fill: boolean; strokeWidth: number; markers: boolean };
  gauge: { thickness?: number; arc?: (typeof ARCS)[number]; roundCaps: boolean; ticks: boolean };
  barHeight?: number;
  grid: boolean;
  onClick: (typeof CLICK_ACTIONS)[number];
  url: string;
  hideOnMobile: boolean;
  pulseOnCrit: boolean;
  countUp: boolean;
};

/* ------------------------------------------------------------------ field specs (validate + default) */

type Spec = { def: unknown; parse: (v: unknown) => unknown };
type Group = { [key: string]: Spec | Group };
const isSpec = (s: Spec | Group): s is Spec => typeof (s as Spec).parse === "function";

const HEX = /^#[0-9a-f]{6}$/i;
const num = (min: number, max: number, def: number | undefined, int = true): Spec => ({
  def,
  parse: (v) => (typeof v === "number" && Number.isFinite(v) ? (int ? Math.round(Math.max(min, Math.min(max, v))) : Math.round(Math.max(min, Math.min(max, v)) * 10) / 10) : undefined),
});
const bool = (def: boolean | undefined): Spec => ({ def, parse: (v) => (typeof v === "boolean" ? v : undefined) });
const oneOf = <T extends string | number>(list: readonly T[], def: T | undefined): Spec => ({ def, parse: (v) => (list.includes(v as T) ? v : undefined) });
const hex = (def: string | undefined): Spec => ({ def, parse: (v) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined) });
const colorRef = (def: string): Spec => ({ def, parse: (v) => (typeof v === "string" ? (HEX.test(v) ? v.toLowerCase() : (COLOR_TOKENS as readonly string[]).includes(v) ? v : undefined) : undefined) });
const borderColor = (): Spec => ({ def: "", parse: (v) => (v === "" ? "" : typeof v === "string" ? (HEX.test(v) ? v.toLowerCase() : (COLOR_TOKENS as readonly string[]).includes(v) ? v : undefined) : undefined) });
const text = (max: number): Spec => ({ def: "", parse: (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : undefined) });
const icon = (): Spec => ({ def: undefined, parse: (v) => ((STYLE_ICONS as readonly string[]).includes(v as string) ? v : undefined) });
const link = (): Spec => ({ def: "", parse: (v) => (typeof v === "string" ? (v === "" ? "" : safeLinkUrl(v)) : undefined) });

const SPEC: Group = {
  preset: oneOf(FRAME_PRESETS, "default"),
  bg: { mode: oneOf(BG_MODES, "default"), color: colorRef("#1e293b"), color2: colorRef("#334155"), angle: num(0, 360, 135), opacity: num(0, 100, 100) },
  blur: num(0, 24, 0),
  border: { show: bool(true), width: num(0, 6, 1), style: oneOf(BORDER_STYLES, "solid"), color: borderColor(), opacity: num(0, 100, 100) },
  radius: num(0, 32, 16),
  shadow: oneOf(SHADOWS, "default"),
  padding: oneOf(PADDINGS, "normal"),
  accentGlow: bool(false),
  accent: hex(undefined),
  hue: num(-180, 180, 0),
  accent2: hex(undefined),
  valueColor: hex(undefined),
  labelColor: hex(undefined),
  trackColor: hex(undefined),
  colorMode: oneOf(COLOR_MODES, "thresholds"),
  levelColors: { ok: hex(undefined), warn: hex("#f59e0b"), crit: hex("#ef4444") },
  valueScale: num(50, 300, 100),
  labelScale: num(60, 200, 100),
  valueFont: oneOf(VALUE_FONTS, "default"),
  valueWeight: num(400, 900, 600),
  labelPos: oneOf(LABEL_POS, "top"),
  align: oneOf(ALIGNS, "default"),
  uppercaseLabel: bool(false),
  showIcon: bool(undefined),
  icon: icon(),
  iconPos: oneOf(ICON_POS, "left"),
  unit: text(12),
  prefix: text(8),
  suffix: text(12),
  abbreviate: bool(false),
  thousands: oneOf(THOUSANDS, "default"),
  invertThresholds: bool(false),
  showDelta: bool(false),
  hideWhenZero: bool(false),
  emptyText: text(24),
  spark: { show: bool(true), window: num(10, 300, 300), curve: oneOf(CURVES, "smooth"), fill: bool(true), strokeWidth: num(1, 4, 1.8, false), markers: bool(false) },
  gauge: { thickness: num(4, 30, undefined), arc: oneOf(ARCS, undefined), roundCaps: bool(true), ticks: bool(false) },
  barHeight: num(4, 40, undefined),
  grid: bool(true),
  onClick: oneOf(CLICK_ACTIONS, "none"),
  url: link(),
  hideOnMobile: bool(false),
  pulseOnCrit: bool(false),
  countUp: bool(false),
};

const defaultsOf = (g: Group): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(g)) out[k] = isSpec(s) ? s.def : defaultsOf(s);
  return out;
};
/** Effective values with nothing customised (documented defaults; they equal today's look). */
export const DEFAULT_STYLE = defaultsOf(SPEC) as unknown as ResolvedStyle;

/* ------------------------------------------------------------------ presets */

/**
 * Frame presets, pure data (board presets and "my styles" can reference them). Colours use theme tokens, so every
 * preset follows the active theme. What they look like:
 *  - glass       translucent surface, 14px backdrop blur, hairline light border, medium shadow, larger radius.
 *  - flat        solid surface, no shadow, thin border, small radius (calm, dense boards).
 *  - outline     transparent inside, 2px border in the accent colour, no shadow.
 *  - gradient    diagonal accent-to-surface gradient fill, soft border, large radius.
 *  - neon        dark card with a 1px accent border and an accent glow (halo) around it.
 *  - soft        very round (28px), borderless, vertical accent-tinted fade and a large soft shadow.
 *  - contrast    elevated solid card, 2px foreground-coloured border, heavy value weight (accessibility / projectors).
 *  - transparent no fill, no border, no shadow: the value floats directly on the page background.
 */
export const STYLE_PRESETS: Record<Exclude<FramePreset, "default">, TileStyle> = {
  glass: { bg: { mode: "solid", color: "surface", opacity: 55 }, blur: 14, border: { show: true, width: 1, color: "fg", opacity: 16 }, radius: 20, shadow: "md" },
  flat: { bg: { mode: "solid", color: "surface", opacity: 100 }, shadow: "none", border: { show: true, width: 1 }, radius: 8 },
  outline: { bg: { mode: "transparent" }, border: { show: true, width: 2, color: "accent" }, shadow: "none" },
  gradient: { bg: { mode: "gradient", color: "accent", color2: "surface", angle: 135, opacity: 30 }, border: { show: true, width: 1, color: "accent", opacity: 35 }, radius: 24, shadow: "sm" },
  neon: { bg: { mode: "solid", color: "surface", opacity: 100 }, border: { show: true, width: 1, color: "accent" }, shadow: "glow", accentGlow: true, radius: 14 },
  soft: { bg: { mode: "gradient", color: "accent", color2: "surface", angle: 180, opacity: 18 }, border: { show: false }, radius: 28, shadow: "lg" },
  contrast: { bg: { mode: "solid", color: "elevated", opacity: 100 }, border: { show: true, width: 2, color: "fg" }, shadow: "none", valueWeight: 800 },
  transparent: { bg: { mode: "transparent" }, border: { show: false }, shadow: "none" },
};

/* ------------------------------------------------------------------ normalize / compact / resolve */

const same = (a: unknown, b: unknown) => a === b;

function parseGroup(raw: unknown, g: Group, ref: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(g)) {
    const r2 = ref?.[k];
    if (isSpec(s)) {
      const p = s.parse(r[k]);
      if (p === undefined) continue;
      // Kept when it differs from what applies without it: the preset's value if the preset sets one, else the default.
      const baseline = ref && k in ref ? ref[k] : s.def;
      if (!same(p, baseline)) out[k] = p;
    } else {
      const sub = parseGroup(r[k], s, r2 && typeof r2 === "object" ? (r2 as Record<string, unknown>) : undefined);
      if (sub) out[k] = sub;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Validates a stored / edited style and returns it in its compact form: unknown keys, invalid values and values
 * equal to the default are dropped; numbers are clamped. `undefined` when nothing is left (= default look).
 */
export function normalizeStyle(raw: unknown): TileStyle | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const preset = SPEC.preset as Spec;
  const p = preset.parse((raw as Record<string, unknown>).preset) as FramePreset | undefined;
  const ref = p && p !== "default" ? (STYLE_PRESETS[p] as Record<string, unknown>) : undefined;
  const out = parseGroup(raw, SPEC, ref);
  return out ? (out as TileStyle) : undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function deepMerge(base: Record<string, unknown>, over: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  if (!over) return out;
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k] as Record<string, unknown>, v) : isObj(v) ? deepMerge({}, v) : v;
  }
  return out;
}

/** Effective style: defaults < preset < explicit fields. Accepts raw input (it is normalized first). */
export function resolveStyle(style?: unknown): ResolvedStyle {
  const s = normalizeStyle(style);
  const preset = s?.preset && s.preset !== "default" ? (STYLE_PRESETS[s.preset] as Record<string, unknown>) : undefined;
  return deepMerge(deepMerge(DEFAULT_STYLE as unknown as Record<string, unknown>, preset), s as Record<string, unknown> | undefined) as unknown as ResolvedStyle;
}

export const isDefaultStyle = (style?: unknown): boolean => normalizeStyle(style) === undefined;

/** Overlay `over` on `base` (both sparse), result normalized. */
export function mergeStyle(base: TileStyle | undefined, over: TileStyle | undefined): TileStyle | undefined {
  return normalizeStyle(deepMerge((base ?? {}) as Record<string, unknown>, over as Record<string, unknown> | undefined));
}

/** Sets one top-level field (or clears it with `undefined`) and returns the normalized style. Used by the editor. */
export function patchStyle(style: TileStyle | undefined, patch: Partial<Record<keyof TileStyle, unknown>>): TileStyle | undefined {
  const next: Record<string, unknown> = { ...(style ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else if (isObj(v) && isObj(next[k])) next[k] = { ...(next[k] as Record<string, unknown>), ...v };
    else next[k] = v;
  }
  return normalizeStyle(next);
}

/* ------------------------------------------------------------------ colours / hue */

type RGB = [number, number, number];
const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c: RGB) => "#" + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");

/** Rotates the hue of `#rrggbb` by `deg` degrees (HSL; saturation and lightness stay). Invalid input is returned unchanged. */
export function shiftHue(color: string, deg: number): string {
  if (!HEX.test(color) || !Number.isFinite(deg)) return color;
  const [r, g, b] = hexToRgb(color).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return color.toLowerCase();
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + deg) % 360;
  if (h < 0) h += 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const rgb: RGB = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector] as RGB;
  return toHex(rgb.map((v) => (v + m) * 255) as RGB);
}

/** CSS colour for a reference: `#rrggbb` as is, a token against the theme variables. */
export function colorCss(ref: string): string {
  switch (ref) {
    case "accent":
      return "var(--accent)";
    case "accent2":
      return "var(--tile-accent2, var(--accent))";
    case "surface":
      return "var(--surface)";
    case "elevated":
      return "var(--bg-elevated)";
    case "fg":
      return "var(--fg)";
    default:
      return ref;
  }
}
const withOpacity = (css: string, opacity: number) => (opacity >= 100 ? css : `color-mix(in srgb, ${css} ${opacity}%, transparent)`);

/** The tile accent as a colour: explicit style accent, else the legacy tile colour, hue-shifted when it is a hex. */
export function resolveAccent(style: unknown, legacyColor?: string): string | undefined {
  const r = resolveStyle(style);
  const base = r.accent ?? (legacyColor && HEX.test(legacyColor) ? legacyColor : undefined);
  if (!base) return undefined;
  return r.hue ? shiftHue(base, r.hue) : base;
}

/** Colour of a value by `colorMode`. `level` comes from thresholds; `fraction` (0..1) drives the gradient mode. */
export function valueTone(r: Pick<ResolvedStyle, "colorMode" | "levelColors">, base: string, level: "ok" | "warn" | "crit" | null, fraction: number | null, auto?: string): string {
  const ok = r.levelColors.ok ?? base;
  if (r.colorMode === "fixed") return base;
  if (r.colorMode === "gradient-by-value") {
    const f = fraction == null || !Number.isFinite(fraction) ? 0 : Math.max(0, Math.min(1, fraction));
    if (f <= 0.5) return f === 0 ? ok : `color-mix(in oklab, ${r.levelColors.warn} ${Math.round(f * 200)}%, ${ok})`;
    return f >= 1 ? r.levelColors.crit : `color-mix(in oklab, ${r.levelColors.crit} ${Math.round((f - 0.5) * 200)}%, ${r.levelColors.warn})`;
  }
  if (level === "crit") return r.levelColors.crit;
  if (level === "warn") return r.levelColors.warn;
  if (level === "ok" && r.levelColors.ok) return r.levelColors.ok;
  return auto ?? base;
}

/* ------------------------------------------------------------------ frame -> CSS */

const SHADOW_CSS: Record<Exclude<Shadow, "default">, string> = {
  none: "0 0 0 0 transparent",
  sm: "0 1px 2px rgba(0,0,0,.25)",
  md: "0 8px 20px -10px rgba(0,0,0,.5)",
  lg: "0 24px 48px -18px rgba(0,0,0,.65)",
  glow: "0 0 24px -4px color-mix(in oklab, var(--accent) 60%, transparent)",
};
const PAD_K = { compact: 0.6, normal: 1, roomy: 1.5 } as const;

export type FrameCss = {
  /** CSS custom properties for the tile root. */
  vars: Record<string, string>;
  /** Space-separated feature tokens for `data-ts` (CSS rules in globals.css select on them). */
  tokens: string;
  /** Extra data attributes (label position). */
  attrs: Record<string, string>;
};
export const EMPTY_FRAME_CSS: FrameCss = Object.freeze({ vars: Object.freeze({}), tokens: "", attrs: Object.freeze({}) }) as FrameCss;

/**
 * Frame-level style of a tile as CSS variables + feature tokens. Returns EMPTY_FRAME_CSS (nothing added to the tile)
 * for a default style, which is what keeps existing boards pixel-identical.
 */
export function frameStyle(style: unknown, legacyColor?: string): FrameCss {
  const s = normalizeStyle(style);
  if (!s) return EMPTY_FRAME_CSS;
  const r = resolveStyle(s);
  const D = DEFAULT_STYLE;
  const vars: Record<string, string> = {};
  const tokens: string[] = [];
  const attrs: Record<string, string> = {};
  if (r.bg.mode !== "default") {
    const a = withOpacity(colorCss(r.bg.color), r.bg.opacity);
    vars["--tile-bg"] = r.bg.mode === "transparent" ? "transparent" : r.bg.mode === "solid" ? a : `linear-gradient(${r.bg.angle}deg, ${a}, ${withOpacity(colorCss(r.bg.color2), r.bg.opacity)})`;
    tokens.push("bg");
  }
  if (r.blur > 0) {
    vars["--tile-blur"] = `${r.blur}px`;
    tokens.push("blur");
  }
  const b = r.border;
  if (!b.show || b.width !== D.border.width || b.style !== D.border.style || b.color !== D.border.color || b.opacity !== D.border.opacity) {
    vars["--tile-border-w"] = b.show ? `${b.width}px` : "0px";
    vars["--tile-border-style"] = b.style;
    if (b.color || b.opacity < 100) vars["--tile-border-c"] = withOpacity(b.color ? colorCss(b.color) : "var(--border)", b.opacity);
    tokens.push("border");
  }
  if (r.radius !== D.radius) {
    vars["--tile-radius"] = `${r.radius}px`;
    tokens.push("radius");
  }
  if (r.shadow !== "default") {
    vars["--tile-shadow"] = SHADOW_CSS[r.shadow];
    tokens.push("shadow");
  }
  if (r.accentGlow) {
    vars["--tile-glow"] = "0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent), 0 0 28px -6px color-mix(in oklab, var(--accent) 55%, transparent)";
    tokens.push("glow");
  }
  if (r.padding !== "normal") vars["--tile-pad-k"] = String(PAD_K[r.padding]);
  // The tile root re-points `--accent` only for an explicit accent or a hue shift; the legacy tile colour alone changes nothing here.
  const accent = r.accent || r.hue ? resolveAccent(s, legacyColor) : undefined;
  if (accent) {
    vars["--accent"] = accent;
    tokens.push("accent");
  } else if (r.hue) {
    vars["--tile-hue"] = String(r.hue);
    tokens.push("hue");
  }
  if (r.accent2) vars["--tile-accent2"] = r.accent2;
  if (r.labelColor) vars["--tile-label-color"] = r.labelColor;
  if (r.labelScale !== D.labelScale) vars["--tile-label-scale"] = String(r.labelScale / 100);
  if (r.uppercaseLabel) tokens.push("upper");
  if (r.trackColor) vars["--tile-track"] = r.trackColor;
  if (r.labelPos !== "top") attrs["data-label-pos"] = r.labelPos;
  return { vars, tokens: tokens.join(" "), attrs };
}

/* ------------------------------------------------------------------ numbers */

export type NumberFormat = { decimals?: number; abbreviate?: boolean; thousands?: ResolvedStyle["thousands"]; prefix?: string; suffix?: string; unit?: string };
const ABBR = [
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
] as const;

/** Locale-safe number text: `thousands` default follows the locale, 'none' / 'space' (NBSP) / 'comma' force the grouping. */
export function formatStyledNumber(n: number, f: NumberFormat = {}, locale?: string): string {
  if (!Number.isFinite(n)) return "—";
  const d = Math.max(0, Math.min(6, Math.round(f.decimals ?? 1)));
  let v = n;
  let tail = "";
  if (f.abbreviate) {
    for (const [limit, sym] of ABBR) {
      if (Math.abs(n) >= limit) {
        v = n / limit;
        tail = sym;
        break;
      }
    }
  }
  const g = f.thousands ?? "default";
  let body: string;
  try {
    if (g === "default") body = new Intl.NumberFormat(locale, { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);
    else {
      const parts = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: d, minimumFractionDigits: 0 }).formatToParts(v);
      const sep = g === "space" ? " " : g === "comma" ? "," : "";
      body = parts
        .map((p) => (p.type === "integer" && sep ? p.value.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : p.value))
        .join("");
    }
  } catch {
    body = v.toFixed(d);
  }
  return `${f.prefix ?? ""}${body}${tail}${f.unit ?? ""}${f.suffix ?? ""}`;
}

/** Units whose text is a plain number (+ optional % sign): the style may reformat them. Others keep their own formatter. */
const PLAIN_UNITS = ["count", "percent", "load"];

/**
 * Final value text of a metric tile. `base` is the standard text (formatMetric). Prefix / suffix wrap every unit; the
 * number options (abbreviate, thousands, decimals, unit) reformat plain numeric units only (bytes, speed, time and
 * status values have their own formatters and are left as they are).
 */
export function styledValueText(m: { value: number | null; unit: string }, base: string, r: ResolvedStyle, precision: number, locale?: string): string {
  if (m.value == null) return r.emptyText || base;
  if (m.value === 0 && r.hideWhenZero) return r.emptyText;
  const customNumber = r.abbreviate || r.thousands !== "default" || r.unit !== "";
  if (PLAIN_UNITS.includes(m.unit) && customNumber) {
    const unit = r.unit !== "" ? r.unit : m.unit === "percent" ? "%" : "";
    return formatStyledNumber(m.value, { decimals: m.unit === "count" && !r.abbreviate ? 0 : precision, abbreviate: r.abbreviate, thousands: r.thousands, prefix: r.prefix, suffix: r.suffix, unit }, locale);
  }
  return `${r.prefix}${base}${r.suffix}`;
}

/* ------------------------------------------------------------------ misc helpers */

/** `/path` (same origin) or an absolute http(s) URL; anything else (javascript:, data:, //host) is rejected. */
export function safeLinkUrl(url: string, max = 500): string | undefined {
  const u = url.trim();
  if (!u || u.length > max || /[\u0000-\u001f\u007f\s]/.test(u)) return undefined;
  if (u.startsWith("/") && !u.startsWith("//") && !u.includes("\\")) return u;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

/** Ease-out interpolation for the count-up animation; `t` in 0..1. */
export function countUpValue(from: number, to: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return from + (to - from) * (1 - Math.pow(1 - k, 3));
}

/** Absolute change between the last two samples (null without two finite samples). */
export function lastDelta(points: readonly { value: number }[] | undefined): number | null {
  if (!points || points.length < 2) return null;
  const a = points[points.length - 2].value;
  const b = points[points.length - 1].value;
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

/* ------------------------------------------------------------------ copy / paste / apply to many */

/** Field groups copied between tiles. Data (numbers, charts, behaviour) is never part of "frame + colour + typography". */
export const STYLE_GROUPS = {
  frame: ["preset", "bg", "blur", "border", "radius", "shadow", "padding", "accentGlow"],
  color: ["accent", "hue", "accent2", "valueColor", "labelColor", "trackColor", "colorMode", "levelColors"],
  typography: ["valueScale", "labelScale", "valueFont", "valueWeight", "labelPos", "align", "uppercaseLabel", "showIcon", "icon", "iconPos"],
} as const satisfies Record<string, readonly (keyof TileStyle)[]>;
export const APPEARANCE_KEYS: readonly (keyof TileStyle)[] = [...STYLE_GROUPS.frame, ...STYLE_GROUPS.color, ...STYLE_GROUPS.typography];

/** The part of a style listed in `keys`. */
export function pickStyle(style: TileStyle | undefined, keys: readonly (keyof TileStyle)[] = APPEARANCE_KEYS): TileStyle | undefined {
  if (!style) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (style[k] !== undefined) out[k] = structuredCloneSafe(style[k]);
  return normalizeStyle(out);
}
const structuredCloneSafe = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

type TileLike = { style?: TileStyle; color?: string };
/**
 * "Paste style": the target gets the appearance (frame + colour + typography) of `clip`; its own data options
 * (numbers, charts, behaviour) stay. The tile's legacy `color` follows the accent.
 */
export function applyAppearance<T extends TileLike>(target: T, clip: TileStyle | undefined): T {
  const keep = pickStyle(target.style, (Object.keys(SPEC) as (keyof TileStyle)[]).filter((k) => !APPEARANCE_KEYS.includes(k)));
  const style = mergeStyle(keep, pickStyle(clip));
  const accent = style?.accent;
  const next: T = { ...target };
  if (style) next.style = style;
  else delete next.style;
  if (accent) next.color = accent;
  return next;
}

/** "Apply to all tiles of the board" / "to the selected": appearance of `clip` onto the tiles `ids` (default: all). */
export function applyAppearanceToTiles<T extends TileLike>(tiles: Record<string, T>, clip: TileStyle | undefined, ids?: readonly string[]): Record<string, T> {
  const out: Record<string, T> = { ...tiles };
  for (const id of ids ?? Object.keys(tiles)) if (out[id]) out[id] = applyAppearance(out[id], clip);
  return out;
}

/** Clears every style field of a tile (and keeps its data settings). */
export function resetAppearance<T extends TileLike>(tile: T): T {
  const next: T = { ...tile };
  delete next.style;
  return next;
}

/* session clipboard (de)serialization; the storage itself lives in components/dashboard/editor/styleStore.ts */
export const parseStyleClip = (raw: string | null): TileStyle | undefined => {
  try {
    return raw ? normalizeStyle(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
};

/* ------------------------------------------------------------------ named styles ("my styles") */

export const MY_STYLES_LIMIT = 24;
export type MyStyle = { id: string; name: string; style: TileStyle };

export function parseMyStyles(raw: unknown): MyStyle[] {
  if (!Array.isArray(raw)) return [];
  const out: MyStyle[] = [];
  for (const e of raw) {
    if (out.length >= MY_STYLES_LIMIT) break;
    if (!isObj(e) || typeof e.id !== "string" || typeof e.name !== "string") continue;
    const style = normalizeStyle(e.style);
    const id = e.id.slice(0, 40);
    if (!style || out.some((x) => x.id === id)) continue;
    out.push({ id, name: e.name.trim().slice(0, 40) || "Style", style });
  }
  return out;
}

/** Adds (or replaces by name) a named style; returns the same list when the limit is reached. */
export function addMyStyle(list: readonly MyStyle[], name: string, style: TileStyle | undefined, id: string): MyStyle[] {
  const s = pickStyle(style);
  const n = name.trim().slice(0, 40);
  if (!s || !n) return [...list];
  const i = list.findIndex((x) => x.name === n);
  if (i >= 0) return list.map((x, j) => (j === i ? { ...x, style: s } : x));
  if (list.length >= MY_STYLES_LIMIT) return [...list];
  return [...list, { id: id.slice(0, 40), name: n, style: s }];
}
