import { CATALOG } from "./catalog";
import { collect } from "./i18nCollect";
import { insertSubtree, newDoc, newNode, reidSubtree, type Subtree } from "./tree";
import type { LNode, LayoutDoc } from "./types";
import type { SubPageColorPresetId } from "../subPageColorPreset";

/** Whole-page templates: a layout plus the palette it was designed for. Every text follows the page language. */
export type PageTemplate = {
  id: string;
  en: [string, string];
  ru: [string, string];
  palette: SubPageColorPresetId;
  build: () => LayoutDoc;
};

type Style = LNode["style"];

export class Page {
  doc: LayoutDoc;
  content: string;
  vars: Record<string, string> = { tg: "", notice: "" };
  constructor(maxW = 760, gap = 18) {
    this.doc = newDoc({ name: "Page", style: { mode: "stack", dir: "column", gap: 0, pad: 0, w: "fill" } });
    const header = newNode("header", { name: "Header" });
    this.doc = insertSubtree(this.doc, this.doc.root, 0, { root: header.id, nodes: { [header.id]: header } });
    this.content = this.frame(this.doc.root, "Content", { mode: "stack", dir: "column", gap, pad: [24, 16, 56, 16], w: "fill", maxW, self: "center" });
  }
  frame(parent: string, name: string, style: Style): string {
    const f = newNode("frame", { name, style });
    this.doc = insertSubtree(this.doc, parent, this.doc.nodes[parent]?.children?.length ?? 0, { root: f.id, nodes: { [f.id]: f } });
    return f.id;
  }
  add(id: string, parent = this.content): this {
    const c = CATALOG.find((x) => x.id === id);
    if (!c) throw new Error(`catalog item ${id} missing`);
    const sub: Subtree = reidSubtree(c.build("en"));
    this.doc = insertSubtree(this.doc, parent, this.doc.nodes[parent]?.children?.length ?? 0, sub);
    return this;
  }
  grid(cols: number, name = "Grid"): string {
    return this.frame(this.content, name, { mode: "grid", colMin: cols, gap: 14, w: "fill", pad: 0 });
  }
  column(parent: string, name = "Column"): string {
    return this.frame(parent, name, { mode: "stack", dir: "column", gap: 14, w: "fill", pad: 0 });
  }
  done(vars: Record<string, string> = this.vars): LayoutDoc {
    return { ...this.doc, enabled: false, vars };
  }
}

export const tpl = (id: string, en: [string, string], ru: [string, string], palette: SubPageColorPresetId, fn: (p: Page) => void, maxW = 760): PageTemplate => ({
  id,
  en,
  ru,
  palette,
  build: () => {
    const { result, i18n } = collect(() => {
      const p = new Page(maxW);
      fn(p);
      return p.done();
    });
    return { ...result, i18n };
  },
});

