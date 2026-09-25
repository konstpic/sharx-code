import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG, buildCatalogItem } from "../catalog";
import { PAGE_TEMPLATES } from "../templates";
import { catalogLocaleFile } from "./index";

const LANGS = ["uk", "es", "tr", "pt", "id", "vi", "zh", "tw", "ja", "ar", "fa"];
const load = (l: string): Record<string, string> => JSON.parse(readFileSync(new URL(`./${l}.json`, import.meta.url), "utf8"));

describe("bundled catalog texts", () => {
  const keys = new Set<string>();
  for (const c of CATALOG) for (const k of Object.keys(buildCatalogItem(c).i18n?.en ?? {})) keys.add(k);
  for (const t of PAGE_TEMPLATES) for (const k of Object.keys(t.build().i18n?.en ?? {})) keys.add(k);

  for (const l of LANGS) {
    it(`${l} covers every catalog and template text with intact expressions`, () => {
      const d = load(l);
      const en = JSON.parse(readFileSync(new URL("./_source.json", import.meta.url), "utf8")).en as Record<string, string>;
      for (const k of keys) {
        expect(d[k], `${l}:${k}`).toBeTypeOf("string");
        const ex = (en[k].match(/\{\{[^}]*\}\}/g) ?? []).sort();
        expect((d[k].match(/\{\{[^}]*\}\}/g) ?? []).sort(), `${l}:${k} expressions`).toEqual(ex);
      }
    });
  }

  it("maps page languages to files", () => {
    expect(catalogLocaleFile("zh-TW")).toBe("tw");
    expect(catalogLocaleFile("zh-CN")).toBe("zh");
    expect(catalogLocaleFile("uk")).toBe("uk");
    expect(catalogLocaleFile("en")).toBeNull();
    expect(catalogLocaleFile("ru")).toBeNull();
  });
});
