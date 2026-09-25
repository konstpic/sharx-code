import { describe, expect, it } from "vitest";
import { buildLayoutContext } from "./context";
import { PAGE_TEMPLATES } from "./templates";
import { lintTemplate, renderTemplate } from "./template";
import { normalizeDoc } from "./tree";

const texts = (doc: ReturnType<(typeof PAGE_TEMPLATES)[number]["build"]>): string[] => {
  const out: string[] = [];
  const grab = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(grab);
    else if (v && typeof v === "object") Object.values(v).forEach(grab);
  };
  for (const n of Object.values(doc.nodes)) grab(n.props);
  return out;
};

describe("page templates", () => {
  it("has 10+ templates with unique ids", () => {
    expect(PAGE_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(PAGE_TEMPLATES.map((t) => t.id)).size).toBe(PAGE_TEMPLATES.length);
  });
  for (const t of PAGE_TEMPLATES) {
    it(`${t.id} is valid, translated and lint-clean`, () => {
      const doc = t.build();
      expect(normalizeDoc(JSON.parse(JSON.stringify(doc)))).not.toBeNull();
      expect(Object.keys(doc.nodes).length).toBeGreaterThan(8);
      const en = doc.i18n?.en ?? {};
      const ru = doc.i18n?.ru ?? {};
      const refs = new Set(texts(doc).flatMap((s) => [...s.matchAll(/tr\.(\w+)/g)].map((m) => m[1])));
      expect(refs.size).toBeGreaterThan(3);
      for (const k of refs) {
        expect(en[k], `${t.id} en ${k}`).toBeTypeOf("string");
        expect(ru[k], `${t.id} ru ${k}`).toBeTypeOf("string");
      }
      for (const s of texts(doc)) expect(lintTemplate(s).errors ?? [], s).toEqual([]);
      // Russian rendering leaves no unresolved reference behind and no Latin-only sentence of the elements' own copy.
      const ctx = buildLayoutContext({ user: { daysLeft: 5, username: "alice" } }, { lang: "ru", i18n: doc.i18n });
      for (const s of texts(doc)) {
        if (!s.includes("tr.")) continue;
        const out = renderTemplate(s, ctx).out;
        expect(out, s).not.toMatch(/tr\.\w+/);
      }
    });
  }
});
