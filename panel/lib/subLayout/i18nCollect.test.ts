import { describe, expect, it } from "vitest";
import { CATALOG, buildCatalogItem } from "./catalog";
import { buildLayoutContext } from "./context";
import { collect, dictFor, mergeDict, tx } from "./i18nCollect";
import { presetDocI18n } from "./presets";
import { lintTemplate, renderTemplate } from "./template";
import { insertSubtree, newDoc, normalizeDoc, newNode } from "./tree";
import { wowDoc } from "./wow";

const refs = (json: string): string[] => [...json.matchAll(/tr\.(\w+)/g)].map((m) => m[1]);

describe("collect mode", () => {
  it("returns plain text outside and references inside", () => {
    expect(tx("ru", "Hello", "Привет")).toBe("Hello".replace("Hello", "Привет"));
    const { result, i18n } = collect(() => tx("en", "Hello", "Привет"));
    expect(result).toMatch(/^\{\{ tr\.t\w+ \}\}$/);
    const key = /tr\.(\w+)/.exec(result)![1];
    expect(i18n.en[key]).toBe("Hello");
    expect(i18n.ru[key]).toBe("Привет");
  });

  it("every catalog item builds with a complete dictionary", () => {
    for (const c of CATALOG) {
      const sub = buildCatalogItem(c);
      const dict = sub.i18n ?? {};
      for (const k of refs(JSON.stringify(sub.nodes))) {
        expect(dict.en?.[k], `${c.id}: ${k} in en`).toBeTypeOf("string");
        expect(dict.ru?.[k], `${c.id}: ${k} in ru`).toBeTypeOf("string");
      }
    }
  });

  it("texts resolve per language through the context", () => {
    const sub = buildCatalogItem(CATALOG.find((c) => c.id === "cta-connect")!);
    let doc = newDoc();
    doc = insertSubtree(doc, doc.root, 0, sub);
    const text = Object.values(doc.nodes).find((n) => n.type === "text" && String(n.props.text).includes("tr."))!;
    const en = renderTemplate(String(text.props.text), buildLayoutContext({}, { lang: "en", i18n: doc.i18n })).out;
    const ru = renderTemplate(String(text.props.text), buildLayoutContext({}, { lang: "ru", i18n: doc.i18n })).out;
    expect(en).not.toBe(ru);
    expect(/[а-яё]/i.test(ru)).toBe(true);
    expect(lintTemplate(String(text.props.text)).errors ?? []).toEqual([]);
  });

  it("a language without its own texts falls back to English", () => {
    expect(dictFor({ en: { a: "x" }, ru: { a: "и" } }, "uk").a).toBe("x");
    expect(dictFor({ en: { a: "x" }, ru: { a: "и" } }, "ru-RU").a).toBe("и");
  });

  it("dictionaries merge and survive normalizeDoc", () => {
    expect(mergeDict({ en: { a: "1" } }, { en: { b: "2" }, ru: { a: "и" } })).toEqual({ en: { a: "1", b: "2" }, ru: { a: "и" } });
    const doc = wowDoc("en");
    const back = normalizeDoc(JSON.parse(JSON.stringify(doc)))!;
    expect(Object.keys(back.i18n?.ru ?? {}).length).toBeGreaterThan(20);
    const n = newNode("text");
    expect(insertSubtree(newDoc(), newDoc().root, 0, { root: n.id, nodes: { [n.id]: n }, i18n: { en: { z: "1" } } }).i18n).toBeUndefined();
  });

  it("presets carry a dictionary too", () => {
    for (const id of ["profile", "minimal", "dashboard"] as const) {
      const doc = presetDocI18n(id);
      for (const k of refs(JSON.stringify(doc.nodes))) expect(doc.i18n?.ru?.[k], `${id}:${k}`).toBeTypeOf("string");
    }
  });
});
