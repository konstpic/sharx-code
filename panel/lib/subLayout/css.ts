import type { CSSProperties } from "react";
import { BLEND_MODES, MOBILE_BREAKPOINT, type FilterSet, type LNode, type LayoutDoc, type NodeType, type ShadowItem, type Size, type Style } from "./types";

/**
 * Style → CSS. Values come from a stored document, so everything that ends up in generated CSS text goes through
 * {@link safeCssValue}; inline React styles are escaped by React itself but use the same filter.
 */

const BAD_VALUE = /[;{}<>\\]|url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding/i;

export function safeCssValue(v: string): string {
  const s = String(v).trim();
  if (!s || s.length > 300 || BAD_VALUE.test(s)) return "";
  return s;
}

/** A background image: http(s) or a data:image URL only. */
export function safeImageUrl(u: string): string {
  const s = String(u).trim();
  if (/^https?:\/\/[^\s"'()<>\\]+$/i.test(s) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);base64,[A-Za-z0-9+/=]+$/i.test(s) || /^\/[^\s"'()<>\\]*$/.test(s)) return s;
  return "";
}

const px = (n: number) => `${n}px`;
const fin = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** A list of shadows as a box-shadow value (colors are filtered; numbers are clamped). */
export function shadowsToCss(list: ShadowItem[] | undefined): string {
  if (!Array.isArray(list)) return "";
  return list
    .slice(0, 8)
    .map((s) => {
      if (!s || typeof s !== "object") return "";
      const c = safeCssValue(String(s.color ?? "")) || "rgba(0,0,0,.35)";
      const num = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, fin(v)));
      return `${s.inset ? "inset " : ""}${px(num(s.x, -500, 500))} ${px(num(s.y, -500, 500))} ${px(num(s.blur, 0, 500))} ${px(num(s.spread, -500, 500))} ${c}`;
    })
    .filter(Boolean)
    .join(", ");
}

/** The `filter` object as a CSS filter list (only set, non-neutral functions). */
export function filterToCss(f: FilterSet | undefined): string {
  if (!f || typeof f !== "object") return "";
  const out: string[] = [];
  const add = (name: string, v: unknown, neutral: number, unit: string, lo: number, hi: number) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v === neutral) return;
    out.push(`${name}(${Math.min(hi, Math.max(lo, v))}${unit})`);
  };
  add("blur", f.blur, 0, "px", 0, 100);
  add("brightness", f.brightness, 100, "%", 0, 300);
  add("contrast", f.contrast, 100, "%", 0, 300);
  add("saturate", f.saturate, 100, "%", 0, 300);
  add("hue-rotate", f.hue, 0, "deg", -360, 360);
  add("grayscale", f.grayscale, 0, "%", 0, 100);
  return out.join(" ");
}

function sides(v: number | number[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return px(v);
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const a = v.map((x) => px(Number(x) || 0));
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} ${a[1]}`;
  if (a.length === 3) return `${a[0]} ${a[1]} ${a[2]}`;
  return `${a[0]} ${a[1]} ${a[2]} ${a[3]}`;
}

function len(v: Size | undefined): string | undefined {
  if (v === undefined || v === "" || v === "auto" || v === "hug") return undefined;
  if (typeof v === "number") return px(v);
  const s = safeCssValue(v);
  if (!s) return undefined;
  return /^-?\d+(\.\d+)?$/.test(s) ? px(Number(s)) : s;
}

const ALIGN: Record<string, string> = { start: "flex-start", end: "flex-end", center: "center", stretch: "stretch", baseline: "baseline" };
const JUSTIFY: Record<string, string> = { start: "flex-start", end: "flex-end", center: "center", between: "space-between", around: "space-around", evenly: "space-evenly" };

const FONT: Record<string, string> = {
  sans: "inherit",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  heading: 'var(--font-heading, inherit)',
  script: 'var(--font-script, cursive)',
};

export type ParentInfo = { mode: "stack" | "grid" | "free" | "none"; dir: "row" | "column" };

export const ROOT_PARENT: ParentInfo = { mode: "none", dir: "column" };

export function parentInfoOf(parent: LNode | null | undefined): ParentInfo {
  if (!parent) return ROOT_PARENT;
  const st = parent.style;
  const mode = st.mode ?? (parent.type === "frame" || parent.type === "repeat" ? "stack" : "stack");
  return { mode, dir: st.dir ?? "column" };
}

/** Whether nodes of this type lay out children. */
function isBox(t: NodeType): boolean {
  return t === "frame" || t === "repeat";
}

export function styleToCss(style: Style, type: NodeType, parent: ParentInfo): CSSProperties {
  const css: CSSProperties = {};
  const box = isBox(type);

  // ---- own layout
  if (box) {
    const mode = style.mode ?? "stack";
    if (mode === "stack") {
      css.display = "flex";
      css.flexDirection = style.dir ?? "column";
      if (style.wrap) css.flexWrap = "wrap";
      if (style.align) css.alignItems = ALIGN[style.align];
      if (style.justify) css.justifyContent = JUSTIFY[style.justify];
      if (style.gap !== undefined) css.gap = px(style.gap);
    } else if (mode === "grid") {
      css.display = "grid";
      if (style.colMin && style.colMin > 0) css.gridTemplateColumns = `repeat(auto-fit, minmax(${px(style.colMin)}, 1fr))`;
      else css.gridTemplateColumns = `repeat(${Math.max(1, Math.round(style.cols ?? 2))}, minmax(0, 1fr))`;
      if (style.align) css.alignItems = ALIGN[style.align];
      if (style.gap !== undefined) css.gap = px(style.gap);
    } else {
      css.position = "relative";
      if (style.h === undefined || style.h === "auto" || style.h === "hug") css.minHeight = px(160);
    }
    const p = sides(style.pad);
    if (p) css.padding = p;
  } else {
    const p = sides(style.pad);
    if (p) css.padding = p;
  }

  // ---- size as a child
  const w = style.w;
  const h = style.h;
  if (w === "fill") {
    if (parent.mode === "stack" && parent.dir === "row") {
      css.flexGrow = 1;
      css.flexBasis = 0;
      css.minWidth = 0;
    } else if (parent.mode === "stack" && style.maxW === undefined) {
      css.alignSelf = "stretch";
    } else {
      css.width = "100%";
    }
  } else {
    const v = len(w);
    if (v) css.width = v;
  }
  if (h === "fill") {
    if (parent.mode === "stack" && parent.dir === "column") {
      css.flexGrow = 1;
      css.flexBasis = 0;
      css.minHeight = 0;
    } else if (parent.mode === "stack") {
      css.alignSelf = "stretch";
    } else {
      css.height = "100%";
    }
  } else {
    const v = len(h);
    if (v) css.height = v;
  }
  const minW = len(style.minW);
  if (minW) css.minWidth = minW;
  const maxW = len(style.maxW);
  if (maxW) css.maxWidth = maxW;
  const minH = len(style.minH);
  if (minH) css.minHeight = minH;
  const maxH = len(style.maxH);
  if (maxH) css.maxHeight = maxH;
  if (style.grow !== undefined && style.grow > 0) {
    css.flexGrow = style.grow;
    if (css.flexBasis === undefined) css.flexBasis = 0;
    css.minWidth = css.minWidth ?? 0;
  }
  if (style.aspect) {
    const a = safeCssValue(style.aspect);
    if (a) css.aspectRatio = a;
  }
  const m = sides(style.mar);
  if (m) css.margin = m;
  if (style.self) {
    // A block that fills its parent up to a max width is centred with auto margins; otherwise align-self does it.
    if (style.self === "center" && (css.width === "100%" || parent.mode === "none")) {
      css.marginLeft = "auto";
      css.marginRight = "auto";
    } else if (style.self !== "auto") css.alignSelf = ALIGN[style.self];
  }

  // ---- free position
  if (parent.mode === "free") {
    css.position = "absolute";
    css.left = px(style.x ?? 0);
    css.top = px(style.y ?? 0);
  }
  if (style.z !== undefined && Number.isFinite(style.z)) css.zIndex = Math.round(style.z);
  if (style.rotate) css.transform = `rotate(${Number(style.rotate) || 0}deg)`;

  // ---- appearance
  if (style.bg) {
    const c = safeCssValue(style.bg);
    if (c) css.background = c;
  }
  if (style.bgImage) {
    const u = safeImageUrl(style.bgImage);
    if (u) {
      css.backgroundImage = css.background ? `url("${u}"), ${String(css.background)}` : `url("${u}")`;
      css.backgroundSize = style.bgSize ?? "cover";
      css.backgroundPosition = (style.bgPos && safeCssValue(style.bgPos)) || "center";
      css.backgroundRepeat = style.bgRepeat && ["no-repeat", "repeat", "repeat-x", "repeat-y"].includes(style.bgRepeat) ? style.bgRepeat : "no-repeat";
      delete css.background;
    }
  }
  if (style.border && style.border.w > 0) {
    const c = safeCssValue(style.border.color) || "currentColor";
    css.border = `${px(style.border.w)} ${style.border.style ?? "solid"} ${c}`;
  }
  if (style.border && Array.isArray(style.border.sides) && style.border.sides.length) {
    const a = style.border.sides.map((x) => Math.max(0, fin(x)));
    const [t, r = t, b = t, l = r] = a;
    const c = safeCssValue(style.border.color) || "currentColor";
    delete css.border;
    css.borderStyle = ["solid", "dashed", "dotted"].includes(style.border.style ?? "solid") ? (style.border.style ?? "solid") : "solid";
    css.borderColor = c;
    css.borderWidth = `${px(t)} ${px(r)} ${px(b)} ${px(l)}`;
  }
  const r = sides(style.radius);
  if (r) css.borderRadius = r;
  const shList = shadowsToCss(style.shadows);
  if (shList) css.boxShadow = shList;
  else if (style.shadow) {
    const sh = safeCssValue(style.shadow);
    if (sh) css.boxShadow = sh;
  }
  if (style.blend && style.blend !== "normal" && BLEND_MODES.includes(style.blend)) css.mixBlendMode = style.blend;
  const fl = filterToCss(style.filter);
  if (fl) css.filter = fl;
  if (style.pointer === "none") css.pointerEvents = "none";
  if (style.visibility === "hidden") css.visibility = "hidden";
  if (style.opacity !== undefined) css.opacity = Math.max(0, Math.min(1, style.opacity));
  if (style.overflow) css.overflow = style.overflow;
  if (style.blur && style.blur > 0) {
    css.backdropFilter = `blur(${px(style.blur)})`;
    (css as Record<string, unknown>).WebkitBackdropFilter = `blur(${px(style.blur)})`;
  }

  // ---- text
  if (style.fs) css.fontSize = px(style.fs);
  if (style.fw) css.fontWeight = style.fw;
  if (style.color) {
    const c = safeCssValue(style.color);
    if (c) css.color = c;
  }
  if (style.ta) css.textAlign = style.ta;
  if (style.lh) css.lineHeight = style.lh;
  if (style.ls) css.letterSpacing = px(style.ls);
  if (style.family) {
    const f = FONT[style.family] ?? safeCssValue(style.family);
    if (f) css.fontFamily = f;
  }
  if (style.upper) css.textTransform = "uppercase";
  if (style.italic) css.fontStyle = "italic";
  if (style.underline) css.textDecoration = "underline";
  if (style.deco && ["none", "underline", "line-through", "overline"].includes(style.deco)) css.textDecoration = style.deco;
  if (style.nowrap) css.whiteSpace = "nowrap";
  if (style.tw && ["wrap", "balance", "pretty"].includes(style.tw)) (css as Record<string, unknown>).textWrap = style.tw;
  if (style.clamp && style.clamp > 0) {
    css.display = "-webkit-box";
    (css as Record<string, unknown>).WebkitLineClamp = Math.round(Math.min(20, style.clamp));
    (css as Record<string, unknown>).WebkitBoxOrient = "vertical";
    css.overflow = "hidden";
    css.whiteSpace = "normal";
  }
  if (style.truncate) {
    css.whiteSpace = "nowrap";
    css.overflow = "hidden";
    css.textOverflow = "ellipsis";
  }
  if (style.cursor) {
    const c = safeCssValue(style.cursor);
    if (c) css.cursor = c;
  }
  return css;
}

function kebab(k: string): string {
  return k.startsWith("Webkit") ? "-webkit" + kebab(k.slice(6)) : k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

/** CSS declarations for `css`, each marked !important (used inside container queries to beat inline styles). */
export function declarations(css: CSSProperties): string {
  return Object.entries(css)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const val = typeof v === "number" && !/^(flexGrow|flexShrink|opacity|zIndex|lineHeight|fontWeight|order|aspectRatio|WebkitLineClamp)$/.test(k) ? `${v}px` : String(v);
      return `${kebab(k)}:${safeCssValue(val)} !important`;
    })
    .filter((d) => !d.startsWith(":") && !d.includes(":  !important"))
    .join(";");
}

export function cssClass(id: string): string {
  return "ln-" + id.replace(/[^A-Za-z0-9_-]/g, "_");
}

export const LAYOUT_CONTAINER = "sublyt";

/**
 * The responsive part of a document: mobile style overrides and "hide on mobile / desktop" flags as container queries on
 * the page container (so the designer's mobile frame and a real phone behave the same).
 */
export function responsiveCss(doc: LayoutDoc, parents: Map<string, LNode | null>): string {
  const mobile: string[] = [];
  const desktop: string[] = [];
  for (const n of Object.values(doc.nodes)) {
    const cls = "." + cssClass(n.id);
    const parent = parents.get(n.id) ?? null;
    if (n.mobile && Object.keys(n.mobile).length) {
      const pi = parentInfoOf(parent);
      const base = styleToCss(n.style, n.type, pi);
      const merged = styleToCss({ ...n.style, ...n.mobile }, n.type, pi);
      const diff: CSSProperties = {};
      for (const [k, v] of Object.entries(merged)) if ((base as Record<string, unknown>)[k] !== v) (diff as Record<string, unknown>)[k] = v;
      const d = declarations(diff);
      if (d) mobile.push(`${cls}{${d}}`);
    }
    if (n.hideOn?.mobile) mobile.push(`${cls}{display:none !important}`);
    if (n.hideOn?.desktop) desktop.push(`${cls}{display:none !important}`);
  }
  let out = "";
  if (mobile.length) out += `@container ${LAYOUT_CONTAINER} (max-width: ${MOBILE_BREAKPOINT}px){${mobile.join("")}}`;
  if (desktop.length) out += `@container ${LAYOUT_CONTAINER} (min-width: ${MOBILE_BREAKPOINT + 1}px){${desktop.join("")}}`;
  return out;
}
