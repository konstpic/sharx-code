import { defaultV2 } from "../sharxSubpageConfig";
import { CATALOG } from "./catalog";
import { collect } from "./i18nCollect";
import { insertSubtree, newDoc, newNode, reidSubtree, type Subtree } from "./tree";
import type { LNode, LayoutDoc } from "./types";

const item = (id: string, lang: "en" | "ru"): Subtree => {
  const c = CATALOG.find((x) => x.id === id);
  if (!c) throw new Error(`catalog item ${id} missing`);
  return reidSubtree(c.build(lang));
};

/** The showcase layout: hero, live rings and status, devices, animated connection, one-tap connect, guide, support. */
export function wowDoc(_lang: string = "en"): LayoutDoc {
  const { result, i18n } = collect(() => buildWow());
  return { ...result, i18n };
}

function buildWow(): LayoutDoc {
  const l: "en" | "ru" = "en";
  let doc = newDoc({ name: "Page", style: { mode: "stack", dir: "column", gap: 0, pad: 0, w: "fill" } });
  const header = newNode("header", { name: "Header" });
  doc = insertSubtree(doc, doc.root, 0, { root: header.id, nodes: { [header.id]: header } });
  const content = newNode("frame", { name: "Content", style: { mode: "stack", dir: "column", gap: 18, pad: [24, 16, 56, 16], w: "fill", maxW: 760, self: "center" } });
  doc = insertSubtree(doc, doc.root, 1, { root: content.id, nodes: { [content.id]: content } });
  const add = (sub: Subtree, parent = content.id) => {
    const n = doc.nodes[parent]?.children?.length ?? 0;
    doc = insertSubtree(doc, parent, n, sub);
  };
  const frame = (name: string, style: LNode["style"]): Subtree => {
    const f = newNode("frame", { name, style });
    return { root: f.id, nodes: { [f.id]: f } };
  };

  add(item("greeting", l));
  const top = frame("Ring and status", { mode: "grid", colMin: 230, gap: 14, w: "fill", pad: 0 });
  add(top);
  add(item("traffic-ring", l), top.root);
  const col = frame("Status column", { mode: "stack", dir: "column", gap: 14, w: "fill", pad: 0 });
  add(col, top.root);
  add(item("status-live", l), col.root);
  add(item("days-left", l), col.root);
  add(item("low-traffic", l));
  add(item("stat-trio", l));
  add(item("devices-tiles", l));
  add(item("scene-connect", l));
  add(item("cta-connect", l));
  add(item("step-timeline", l));
  add(item("copy-link", l));
  add(item("support-card", l));
  add(item("footer", l));
  return { ...doc, enabled: false, vars: { tg: "", notice: "" } };
}

const stripIds = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stripIds) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== "id").map(([k, x]) => [k, stripIds(x)])) : v;

let pristineKey: string | null = null;

/**
 * True for a page config nobody has customized: no saved layout and the stock block list. Such pages show the showcase
 * layout by default; as soon as an admin edits the blocks or saves a layout (even a disabled one) the classic page stays.
 */
export function isPristineDefault(cfg: unknown): boolean {
  const c = cfg as { layout?: unknown; blocks?: unknown } | null;
  if (!c || c.layout) return false;
  if (!Array.isArray(c.blocks)) return false;
  try {
    pristineKey ??= JSON.stringify(stripIds(defaultV2().blocks));
    return JSON.stringify(stripIds(c.blocks)) === pristineKey;
  } catch {
    return false;
  }
}

/** The layout a page shows when the config is pristine (enabled, in the visitor's language). */
export function defaultLayout(lang: string): LayoutDoc {
  return { ...wowDoc(lang), enabled: true };
}
