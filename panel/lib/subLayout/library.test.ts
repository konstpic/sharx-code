import { describe, expect, it } from "vitest";
import { exportLibrary, importLibrary, itemFromDoc, itemFromSelection, mergeLibraries, parseLibrary, serializeLibrary, sizeStatus, subtreeFromItem, docFromItem, tombstone, touch, type Library } from "./library";
import { insertNode, insertSubtree, newDoc, newNode } from "./tree";

function sample() {
  let d = newDoc();
  const a = newNode("frame", { name: "A" });
  const t1 = newNode("text", { name: "t1", props: { text: "{{ tr.k1 }}" } });
  const t2 = newNode("text", { name: "t2", props: { text: "plain" } });
  d = insertNode(d, d.root, 0, a);
  d = insertNode(d, a.id, 0, t1);
  d = insertNode(d, d.root, 1, t2);
  d = { ...d, i18n: { en: { k1: "Hello", k2: "Unused" }, ru: { k1: "Привет", k2: "Не нужно" } } };
  return { d, a, t1, t2 };
}

describe("library items", () => {
  it("round trips and prunes i18n to referenced keys", () => {
    const { d, a } = sample();
    const it = itemFromSelection(d, [a.id], "Card", { tags: ["x", " y ", "x"] })!;
    expect(it.tags).toEqual(["x", "y"]);
    expect(it.subtree?.i18n).toEqual({ en: { k1: "Hello" }, ru: { k1: "Привет" } });
    const lib = parseLibrary(serializeLibrary({ version: 1, items: [it] }));
    expect(lib.items).toHaveLength(1);
    expect(lib.items[0].subtree?.root).toBe(a.id);
  });
  it("wraps several selected nodes in a frame; no i18n when unreferenced", () => {
    const { d, a, t2 } = sample();
    const it = itemFromSelection(d, [a.id, t2.id], "Both")!;
    const root = it.subtree!.nodes[it.subtree!.root];
    expect(root.type).toBe("frame");
    expect(root.children).toEqual([a.id, t2.id]);
    const only = itemFromSelection(d, [t2.id], "P")!;
    expect(only.subtree?.i18n).toBeUndefined();
  });
  it("gives fresh ids on every insertion and carries i18n", () => {
    const { d, a } = sample();
    const it = itemFromSelection(d, [a.id], "Card")!;
    const s1 = subtreeFromItem(it);
    const s2 = subtreeFromItem(it);
    expect(s1.root).not.toBe(s2.root);
    expect(s1.root).not.toBe(a.id);
    expect(s1.i18n?.en?.k1).toBe("Hello");
    const out = insertSubtree(newDoc(), newDoc().root, 0, s1);
    expect(Object.keys(out.nodes).length).toBeGreaterThan(0);
  });
  it("templates keep doc, palette, branding subset", () => {
    const { d } = sample();
    const it = itemFromDoc(d, "neon", { title: "T", background: "plain", accentColor: "#fff" }, "Page");
    expect(it.doc?.enabled).toBe(false);
    expect(it.branding).toEqual({ background: "plain", accentColor: "#fff" });
    const back = docFromItem(parseLibrary(serializeLibrary({ version: 1, items: [it] })).items[0]);
    expect(back.root).not.toBe(d.root);
    expect(back.i18n?.en?.k2).toBe("Unused");
  });
});

describe("merge", () => {
  const mk = (id: string, updatedAt: number, revision = 1, name = id) => ({ id, kind: "element" as const, name, tags: [], createdAt: 1, updatedAt, revision, subtree: { root: "r", nodes: { r: { id: "r", type: "text" } as never } } });
  it("newer wins, union otherwise", () => {
    const a: Library = { version: 1, items: [mk("a", 10, 1, "old"), mk("b", 5)] };
    const b: Library = { version: 1, items: [mk("a", 20, 2, "new"), mk("c", 1)] };
    const m = mergeLibraries(a, b, 100);
    expect(m.items.map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
    expect(m.items.find((i) => i.id === "a")?.name).toBe("new");
  });
  it("tombstones propagate deletions and expire after 30 days", () => {
    const it = mk("a", 10);
    const dead = tombstone(it, 20);
    const m = mergeLibraries({ version: 1, items: [dead] }, { version: 1, items: [it] }, 30);
    expect(m.items[0].deleted).toBe(true);
    const later = mergeLibraries({ version: 1, items: [dead] }, { version: 1, items: [] }, 20 + 31 * 86400000);
    expect(later.items).toHaveLength(0);
  });
  it("touch bumps revision and updatedAt", () => {
    const it = mk("a", 10);
    const t = touch(it, { name: "x" }, 5);
    expect(t.revision).toBe(2);
    expect(t.updatedAt).toBeGreaterThan(10);
  });
});

describe("parse / import", () => {
  it("survives garbage", () => {
    for (const g of ["", "nope", "null", "[]", '{"items":5}', '{"items":[1,null,{"id":"x"},{"id":"y","kind":"element","subtree":{}}]}']) {
      expect(parseLibrary(g).items).toEqual([]);
    }
    expect(parseLibrary(undefined).version).toBe(1);
  });
  it("imports a library file or a single item, renaming colliding ids", () => {
    const { d, a } = sample();
    const it = itemFromSelection(d, [a.id], "Card")!;
    const file = exportLibrary([it, { ...it, id: "gone", deleted: true }]);
    const r = importLibrary(file, [it.id]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].id).not.toBe(it.id);
    expect(importLibrary(JSON.stringify(it)).items[0].id).toBe(it.id);
    expect(importLibrary("garbage").items).toEqual([]);
  });
  it("size guard", () => {
    expect(sizeStatus("{}")).toBe("ok");
    expect(sizeStatus("x".repeat(7 * 1024 * 1024))).toBe("refuse");
  });
});
