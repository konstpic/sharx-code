import { collect, plain, tx, txExpr } from "./i18nCollect";
import { subtreeFromSpec, type Spec } from "./presets";
import type { Subtree } from "./tree";
import type { LNode } from "./types";

/** Shared building blocks for the catalog files (colors, surfaces, text and scene helpers). */
export const MUTED = "var(--sub-fg-muted, #8b949e)";
export const ACCENT = "var(--sub-accent, #22d3ee)";
export const L = (lang: "en" | "ru", en: string, ru: string) => tx(lang, en, ru);
/** Same as L for a filter argument such as plural(...). */
export const LP = (lang: "en" | "ru", en: string, ru: string) => txExpr(lang, en, ru);
export type S = LNode["style"];
export const T = (text: string, style: S = {}, tag: "p" | "h2" | "h3" = "p"): Spec => ["text", { name: plain(text).slice(0, 24), props: { text, tag }, style }];
export const surface: S = { mode: "stack", dir: "column", gap: 12, pad: 20, w: "fill", bg: "var(--sub-surface, rgba(255,255,255,.04))", border: { w: 1, color: "var(--sub-border, rgba(255,255,255,.1))" }, radius: 20, shadow: "0 18px 40px -24px rgba(0,0,0,.5)", blur: 16 };
export const glass: S = { ...surface, bg: "color-mix(in oklab, var(--sub-bg-elevated, #1c2128) 55%, transparent)", blur: 16, radius: 22, shadow: "0 10px 40px rgba(0,0,0,.25)" };
export const gradient: S = { mode: "stack", dir: "column", gap: 10, pad: 24, w: "fill", radius: 22, bg: `linear-gradient(135deg, color-mix(in oklab, ${ACCENT} 30%, transparent), color-mix(in oklab, var(--sub-accent-ambient, #9775fa) 26%, transparent))`, border: { w: 1, color: "var(--sub-border, rgba(255,255,255,.12))" } };
export const build = (s: Spec): Subtree => subtreeFromSpec(s);

export type SA = { id: string; label: string; icon: string; x: number; y: number; tone?: string };
export const sceneItem = (l: "en" | "ru", name: string, props: Record<string, unknown>): Subtree => build(["scene", { name, props: { autoplay: true, loop: true, stepMs: 2600, height: 240, showCaption: true, showControls: true, ...props }, style: { w: "fill" } }]);
export const A = (id: string, en: string, ru: string, icon: string, x: number, y: number, tone?: string, l: "en" | "ru" = "en"): SA => ({ id, label: L(l, en, ru), icon, x, y, ...(tone ? { tone } : {}) });

/** Builds an element in collect mode: texts become `{{ tr.key }}` and travel with the subtree as its dictionary. */
export function buildWithI18n(fn: (l: "en" | "ru") => Subtree): Subtree {
  const { result, i18n } = collect(() => fn("en"));
  return { ...result, i18n };
}
