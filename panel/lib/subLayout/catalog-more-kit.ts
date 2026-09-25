import type { CatalogCategory, CatalogItem } from "./catalog";
import { build, L } from "./catalog-kit";
import type { Spec } from "./presets";

export const RM = "@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important}}";
export const AC = "var(--sub-accent,#22d3ee)";
export const AM = "var(--sub-accent-ambient,#9775fa)";
export const BD = "var(--sub-border,rgba(255,255,255,.12))";
export const SF = "var(--sub-surface,rgba(255,255,255,.05))";
export const FG = "var(--sub-fg,#c9d1d9)";
export const FS = "var(--sub-fg-strong,#fff)";
export const FM = "var(--sub-fg-muted,#8b949e)";
export const OK = "var(--sub-success,#3fb950)";
export const BAD = "var(--sub-danger,#f85149)";
export const WARN = "var(--sub-warning,#d29922)";

/** Card base shared by the custom-code elements: `.c` is the card, `.b` a filled accent button, `.o` an outline button. */
export const CARD = `.c{position:relative;overflow:hidden;box-sizing:border-box;padding:20px;border-radius:22px;border:1px solid ${BD};background:${SF};color:${FG};display:grid;gap:12px}.c h3,.c h4,.c p{margin:0}.c h3{font-size:18px;color:${FS}}.c small,.m{color:${FM};font-size:13px}.c b{color:${FS}}.b,.o{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 18px;border-radius:12px;font-weight:600;font-size:14px;text-decoration:none;box-sizing:border-box}.b{background:${AC};color:#04141a}.o{border:1px solid ${BD};color:${FS}}.bar{height:10px;border-radius:99px;background:${BD};overflow:hidden}.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,${AC},${AM})}.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.t{padding:14px;border-radius:16px;border:1px solid ${BD};background:color-mix(in oklab,${SF} 60%,transparent);display:grid;gap:4px}.t b{font-size:20px}`;

export type Group = { id: string; cat: CatalogCategory };

/** Custom-code element. `html` gets the page language so every visible text goes through L(). */
export const mk = (id: string, cat: CatalogCategory, en: [string, string], ru: [string, string], html: (l: "en" | "ru") => string, css: string, style: Record<string, unknown> = { w: "fill" }): CatalogItem => ({
  id, cat, icon: "html", en, ru,
  build: (l) => build(["html", { name: en[0], props: { html: html(l), css: CARD + css + RM }, style } as never]),
});

/** Element assembled from native nodes (buttons, QR) so copy/QR actions work. */
export const mkSpec = (id: string, cat: CatalogCategory, icon: CatalogItem["icon"], en: [string, string], ru: [string, string], spec: (l: "en" | "ru") => Spec): CatalogItem => ({
  id, cat, icon, en, ru, build: (l) => build(spec(l)),
});

export { L };
