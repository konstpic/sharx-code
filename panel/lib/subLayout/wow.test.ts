import { describe, expect, it } from "vitest";
import { normalizeDoc, walk } from "./tree";
import { defaultV2 } from "../sharxSubpageConfig";
import { defaultLayout, isPristineDefault, wowDoc } from "./wow";

describe("wowDoc", () => {
  for (const lang of ["en", "ru"]) {
    it(`builds a valid layout (${lang})`, () => {
      const doc = wowDoc(lang);
      expect(normalizeDoc(JSON.parse(JSON.stringify(doc)))).not.toBeNull();
      expect(doc.enabled).toBe(false);
      let n = 0;
      walk(doc, () => {
        n++;
      });
      expect(n).toBe(Object.keys(doc.nodes).length);
      expect(n).toBeGreaterThan(30);
    });
  }
});

describe("isPristineDefault", () => {
  it("is true for the stock config, also with fresh block ids", () => {
    expect(isPristineDefault(defaultV2())).toBe(true);
    expect(isPristineDefault(defaultV2())).toBe(true);
  });
  it("is false once a layout exists or blocks are edited", () => {
    const c = defaultV2();
    expect(isPristineDefault({ ...c, layout: { version: 1 } })).toBe(false);
    const edited = { ...c, blocks: c.blocks.slice(1) };
    expect(isPristineDefault(edited)).toBe(false);
    expect(isPristineDefault(null)).toBe(false);
  });
  it("defaultLayout is enabled", () => {
    expect(defaultLayout("ru").enabled).toBe(true);
  });
});
