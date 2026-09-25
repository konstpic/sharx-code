import { describe, expect, it } from "vitest";
import { duplicateNode, extractSubtree, insertNode, insertSubtree, moveNode, newDoc, newNode, normalizeDoc, parentOf, removeNode, reidSubtree, shiftNode, subtreeIds, placeBeside, placeBesideSubtree, unwrapFrame, updateNode, wrapInFrame, wrapInRow } from "./tree";

function sample() {
  let d = newDoc();
  const a = newNode("frame", { name: "A" });
  const b = newNode("frame", { name: "B" });
  const t1 = newNode("text", { name: "t1" });
  const t2 = newNode("text", { name: "t2" });
  const t3 = newNode("text", { name: "t3" });
  d = insertNode(d, d.root, 0, a);
  d = insertNode(d, d.root, 1, b);
  d = insertNode(d, a.id, 0, t1);
  d = insertNode(d, a.id, 1, t2);
  d = insertNode(d, b.id, 0, t3);
  return { d, a, b, t1, t2, t3 };
}
const names = (d: ReturnType<typeof newDoc>, id: string) => (d.nodes[id].children ?? []).map((c) => d.nodes[c].name);

describe("insert and move", () => {
  it("inserts at an index and refuses leaves as parents", () => {
    const { d, a, t1 } = sample();
    expect(names(d, a.id)).toEqual(["t1", "t2"]);
    const x = newNode("text", { name: "x" });
    expect(insertNode(d, t1.id, 0, x)).toBe(d);
  });
  it("moves between parents", () => {
    const { d, a, b, t1 } = sample();
    const m = moveNode(d, t1.id, b.id, 0);
    expect(names(m, a.id)).toEqual(["t2"]);
    expect(names(m, b.id)).toEqual(["t1", "t3"]);
    expect(parentOf(m, t1.id)).toBe(b.id);
  });
  it("moves inside one parent with the index counted before the move", () => {
    const { d, a, t1 } = sample();
    expect(names(moveNode(d, t1.id, a.id, 2), a.id)).toEqual(["t2", "t1"]); // to the end
    expect(names(moveNode(d, t1.id, a.id, 0), a.id)).toEqual(["t1", "t2"]);
    expect(names(shiftNode(d, t1.id, 1), a.id)).toEqual(["t2", "t1"]);
    expect(names(shiftNode(d, t1.id, -1), a.id)).toEqual(["t1", "t2"]);
  });
  it("never creates cycles or moves the root", () => {
    const { d, a, t1 } = sample();
    const inner = newNode("frame", { name: "inner" });
    const d2 = insertNode(d, a.id, 0, inner);
    expect(moveNode(d2, a.id, inner.id, 0)).toBe(d2);
    expect(moveNode(d2, a.id, a.id, 0)).toBe(d2);
    expect(moveNode(d2, d2.root, a.id, 0)).toBe(d2);
    expect(moveNode(d2, a.id, t1.id, 0)).toBe(d2); // a leaf cannot take children
  });
});

describe("remove, duplicate, wrap", () => {
  it("removes a whole subtree", () => {
    const { d, a, t1, t2 } = sample();
    const r = removeNode(d, a.id);
    expect(r.nodes[a.id]).toBeUndefined();
    expect(r.nodes[t1.id]).toBeUndefined();
    expect(r.nodes[t2.id]).toBeUndefined();
    expect(removeNode(d, d.root)).toBe(d);
  });
  it("duplicates with fresh ids right after the original", () => {
    const { d, a } = sample();
    const r = duplicateNode(d, a.id);
    expect(r).toBeTruthy();
    const dd = r!.doc;
    expect(dd.nodes[r!.id].name).toBe("A copy");
    expect(dd.nodes[dd.root].children![1]).toBe(r!.id);
    const ids = subtreeIds(dd, r!.id);
    expect(ids).toHaveLength(3);
    expect(ids.every((i) => !subtreeIds(d, a.id).includes(i))).toBe(true);
  });
  it("wraps siblings into a frame and unwraps back", () => {
    const { d, a, t1, t2 } = sample();
    const w = wrapInFrame(d, [t1.id, t2.id]);
    expect(w).toBeTruthy();
    expect(names(w!.doc, a.id)).toEqual(["Group"]);
    expect(names(w!.doc, w!.id)).toEqual(["t1", "t2"]);
    const u = unwrapFrame(w!.doc, w!.id);
    expect(names(u, a.id)).toEqual(["t1", "t2"]);
    expect(u.nodes[w!.id]).toBeUndefined();
  });
  it("re-ids a subtree consistently", () => {
    const { d, a } = sample();
    const sub = reidSubtree(extractSubtree(d, a.id));
    const d2 = insertSubtree(d, d.root, 0, sub);
    expect(subtreeIds(d2, sub.root)).toHaveLength(3);
    expect(Object.keys(d2.nodes)).toHaveLength(Object.keys(d.nodes).length + 3);
  });
});

describe("update", () => {
  it("merges style and props and deletes undefined keys", () => {
    const { d, t1 } = sample();
    const u = updateNode(d, t1.id, { style: { fs: 30, color: "#fff" }, props: { text: "x" } });
    expect(u.nodes[t1.id].style.fs).toBe(30);
    expect(u.nodes[t1.id].props.text).toBe("x");
    const u2 = updateNode(u, t1.id, { style: { color: undefined } });
    expect("color" in u2.nodes[t1.id].style).toBe(false);
    const u3 = updateNode(u2, t1.id, { mobile: { fs: 20 } });
    expect(u3.nodes[t1.id].mobile).toEqual({ fs: 20 });
    expect(updateNode(u3, t1.id, { mobile: null }).nodes[t1.id].mobile).toBeUndefined();
  });
});

describe("normalizeDoc", () => {
  it("drops unknown types, dangling ids, cycles and orphans", () => {
    const { d, a } = sample();
    const raw = JSON.parse(JSON.stringify(d));
    raw.nodes[a.id].children.push("ghost");
    raw.nodes[a.id].children.push(d.root); // cycle
    raw.nodes.orphan = { id: "orphan", type: "text", style: {}, props: {} };
    raw.nodes.bad = { id: "bad", type: "rocket", style: {}, props: {} };
    raw.nodes[d.root].children.push("bad");
    const n = normalizeDoc(raw)!;
    expect(n).toBeTruthy();
    expect(n.nodes.orphan).toBeUndefined();
    expect(n.nodes.bad).toBeUndefined();
    expect(n.nodes[a.id].children).toHaveLength(2);
    expect(normalizeDoc({})).toBe(null);
    expect(normalizeDoc({ root: "x", nodes: { x: { type: "text" } } })).toBe(null); // the root must be a frame
  });
});

describe("side by side", () => {
  it("wrapInRow makes an equal-width row where the first node was", () => {
    const { d, a, b } = sample();
    const r = wrapInRow(d, [b.id, a.id])!;
    const row = r.doc.nodes[r.id];
    expect(r.doc.nodes[d.root].children).toEqual([r.id]);
    expect(row.children).toEqual([a.id, b.id]);
    expect(row.style.dir).toBe("row");
    expect(row.mobile?.dir).toBe("column");
    expect(r.doc.nodes[a.id].style).toMatchObject({ grow: 1, w: "auto" });
  });
  it("wrapInRow refuses the root and mixed parents", () => {
    const { d, t1, t3 } = sample();
    expect(wrapInRow(d, [d.root])).toBeNull();
    expect(wrapInRow(d, [t1.id, t3.id])).toBeNull();
  });
  it("placeBeside wraps target and moved into a new row", () => {
    const { d, a, t1, t3 } = sample();
    const n = placeBeside(d, t1.id, t3.id, "right");
    const rowId = parentOf(n, t1.id)!;
    expect(rowId).not.toBe(a.id);
    expect(n.nodes[rowId].children).toEqual([t1.id, t3.id]);
    expect(parentOf(n, rowId)).toBe(a.id);
    expect(names(n, a.id)).toEqual(["Row", "t2"]);
    const l = placeBeside(d, t1.id, t3.id, "left");
    expect(names(l, parentOf(l, t1.id)!)).toEqual(["t3", "t1"]);
  });
  it("placeBeside inserts into an existing row without a wrapper", () => {
    const { d, t1, t2, t3 } = sample();
    const r = wrapInRow(d, [t1.id, t2.id])!;
    const n = placeBeside(r.doc, t2.id, t3.id, "left");
    expect(names(n, r.id)).toEqual(["t1", "t3", "t2"]);
    expect(Object.keys(n.nodes).length).toBe(Object.keys(r.doc.nodes).length);
  });
  it("placeBeside is cycle safe and never touches the root", () => {
    const { d, a, t1 } = sample();
    expect(placeBeside(d, t1.id, a.id, "left")).toBe(d);
    expect(placeBeside(d, d.root, t1.id, "left")).toBe(d);
    expect(placeBeside(d, a.id, d.root, "left")).toBe(d);
    expect(placeBeside(d, t1.id, t1.id, "left")).toBe(d);
  });
  it("placeBesideSubtree adds a new node beside the target", () => {
    const { d, a, t1 } = sample();
    const x = newNode("text", { name: "x" });
    const n = placeBesideSubtree(d, t1.id, { root: x.id, nodes: { [x.id]: x } }, "right");
    const row = parentOf(n, t1.id)!;
    expect(names(n, row)).toEqual(["t1", "x"]);
    expect(parentOf(n, row)).toBe(a.id);
  });
});
