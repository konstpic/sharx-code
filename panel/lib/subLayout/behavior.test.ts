import { describe, expect, it } from "vitest";
import { applyStates, hideKey, nextState, stateForAction } from "./behavior";
import { buildGradient, isGradient, parseGradient } from "./gradient";
import { insertNode, newDoc, newNode, normalizeDoc } from "./tree";

describe("applyStates", () => {
  const scope = { user: { percentUsed: 90 }, state: { open: true } };
  it("merges every matching rule in order (later wins)", () => {
    const r = applyStates({ bg: "#000", opacity: 1 }, [
      { when: "user.percentUsed > 80", style: { bg: "red", color: "#fff" } },
      { when: "user.percentUsed > 95", style: { bg: "blue" } },
      { when: "state.open", style: { bg: "green" } },
    ], scope);
    expect(r.style).toEqual({ bg: "green", opacity: 1, color: "#fff" });
    expect(r.matched).toBe(2);
  });
  it("broken or empty expressions never match", () => {
    expect(applyStates({}, [{ when: "", style: { bg: "x" } }, { when: "((", style: { bg: "y" } }], scope).matched).toBe(0);
  });
  it("returns the same style object without rules", () => {
    const base = { bg: "#000" };
    expect(applyStates(base, undefined, scope).style).toBe(base);
  });
});

describe("page state", () => {
  it("toggles and sets", () => {
    let s = nextState({}, "faq", undefined);
    expect(s).toEqual({ faq: true });
    s = nextState(s, "faq", "");
    expect(s).toEqual({ faq: false });
    expect(nextState(s, "tab", "b")).toEqual({ faq: false, tab: "b" });
    expect(nextState(s, "x", "true")).toEqual({ faq: false, x: true });
    expect(nextState(s, "bad key", "1")).toBe(s);
  });
  it("maps actions to state changes", () => {
    expect(stateForAction({}, { action: "toggle", value: "a" })).toEqual({ a: true });
    expect(stateForAction({}, { action: "toggle-visibility", value: "n1" })).toEqual({ [hideKey("n1")]: true });
    expect(stateForAction({}, { action: "link", value: "https://x.io" })).toBeNull();
  });
});

describe("normalizeDoc keeps behavior fields", () => {
  it("validates motion, states, refresh and onClick", () => {
    const doc = newDoc();
    const t = newNode("text", { style: {} });
    const withT = insertNode(doc, doc.root, 0, t);
    withT.nodes[t.id] = {
      ...withT.nodes[t.id],
      motion: { preset: "fade", duration: 300 },
      states: [{ when: "user.isActive", style: { bg: "red" } }],
      refresh: 5,
      onClick: { action: "toggle", value: "faq" },
    };
    const n = normalizeDoc(JSON.parse(JSON.stringify(withT)));
    expect(n?.nodes[t.id]).toMatchObject({ motion: { preset: "fade", duration: 300 }, states: [{ when: "user.isActive", style: { bg: "red" } }], refresh: 5, onClick: { action: "toggle", value: "faq" } });
  });
  it("drops invalid motion, states, refresh and onClick", () => {
    const doc = newDoc();
    const t = newNode("text", { style: {} });
    const raw = JSON.parse(JSON.stringify(insertNode(doc, doc.root, 0, t)));
    Object.assign(raw.nodes[t.id], { motion: { preset: "boom" }, states: [{ when: "", style: {} }, "x"], refresh: -3, onClick: { action: "rm -rf" } });
    const n = normalizeDoc(raw);
    expect(n?.nodes[t.id].motion).toBeUndefined();
    expect(n?.nodes[t.id].states).toBeUndefined();
    expect(n?.nodes[t.id].refresh).toBeUndefined();
    expect(n?.nodes[t.id].onClick).toBeUndefined();
  });
  it("normalizes html params and values", () => {
    const doc = newDoc();
    const h = newNode("html", { style: {} });
    const raw = JSON.parse(JSON.stringify(insertNode(doc, doc.root, 0, h)));
    Object.assign(raw.nodes[h.id].props, { params: [{ key: "ok", type: "number", default: 1 }, { key: "bad key", type: "text" }], values: { ok: 2, evil: {} } });
    const n = normalizeDoc(raw);
    expect(n?.nodes[h.id].props.params).toHaveLength(1);
    expect(n?.nodes[h.id].props.values).toEqual({ ok: 2 });
  });
});

describe("gradient", () => {
  it("round-trips a simple linear gradient", () => {
    const g = parseGradient("linear-gradient(135deg, var(--sub-accent, #22d3ee) 0%, #fff 60%, rgba(0,0,0,.5) 100%)");
    expect(g?.stops).toHaveLength(3);
    expect(g?.stops[0].color).toBe("var(--sub-accent, #22d3ee)");
    expect(buildGradient(g!)).toBe("linear-gradient(135deg, var(--sub-accent, #22d3ee) 0%, #fff 60%, rgba(0,0,0,.5) 100%)");
  });
  it("detects gradients and rejects complex ones", () => {
    expect(isGradient("radial-gradient(#fff,#000)")).toBe(true);
    expect(isGradient("#fff")).toBe(false);
    expect(parseGradient("radial-gradient(#fff,#000)")).toBeNull();
    expect(parseGradient("linear-gradient(90deg,#000,#111,#222,#333)")).toBeNull();
  });
});
