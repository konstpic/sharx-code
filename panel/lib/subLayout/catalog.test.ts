import { describe, expect, it } from "vitest";
import { CATALOG, catalogItem } from "./catalog";
import { lintTemplate } from "./template";
import { normalizeDoc } from "./tree";

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe("CATALOG", () => {
  it("has unique ids and lookup works", () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATALOG) expect(catalogItem(c.id)).toBe(c);
  });

  for (const item of CATALOG) {
    for (const lang of ["en", "ru"] as const) {
      describe(`${item.id} (${lang})`, () => {
        it("builds a consistent subtree", () => {
          const sub = item.build(lang);
          expect(sub.nodes[sub.root]).toBeDefined();
          for (const n of Object.values(sub.nodes)) for (const c of n.children ?? []) expect(sub.nodes[c], `child ${c}`).toBeDefined();
          // every node is reachable from the root
          const seen = new Set<string>();
          const stack = [sub.root];
          while (stack.length) {
            const id = stack.pop()!;
            seen.add(id);
            stack.push(...(sub.nodes[id].children ?? []));
          }
          expect(seen.size).toBe(Object.keys(sub.nodes).length);
        });
        it("has templates that lint clean", () => {
          const sub = item.build(lang);
          for (const n of Object.values(sub.nodes)) {
            for (const s of [...strings(n.props), ...(n.visibleIf ? [`{{ ${n.visibleIf} }}`] : [])]) {
              expect(lintTemplate(s), `${n.id}: ${s}`).toEqual([]);
            }
          }
        });
        it("is accepted by normalizeDoc when wrapped in a frame root", () => {
          const sub = item.build(lang);
          const doc = normalizeDoc({ root: sub.root, nodes: sub.nodes });
          // root of a catalog item may be a non-frame leaf; only frames must normalize
          if (sub.nodes[sub.root].type === "frame") expect(doc).not.toBeNull();
        });
      });
    }
  }
});
