import { describe, expect, it } from "vitest";
import { animVars, applyStdCss, coerceParam, normalizeParams, normalizeValues, paramCssVars, paramValues, stdAnimParams, withParams } from "./params";
import type { ParamDef } from "./types";

const num: ParamDef = { key: "speed", label: "Speed", type: "range", default: 2, min: 0.5, max: 5, unit: "s" };

describe("normalizeParams", () => {
  it("drops bad keys, duplicates and unknown types", () => {
    const out = normalizeParams([{ key: "a b", label: "x", type: "text", default: "" }, { key: "ok", type: "nope", default: 1 }, { key: "ok", type: "text", default: "dup" }, null, 5]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "ok", type: "text", label: "ok" });
  });
  it("keeps ranges, units, groups and options", () => {
    const [p] = normalizeParams([{ key: "n", label: "N", type: "select", default: "a", min: 1, unit: "px", group: "G", options: [{ value: "a", label: "A" }, { value: 2 }, { nope: 1 }] }]);
    expect(p).toMatchObject({ min: 1, unit: "px", group: "G", options: [{ value: "a", label: "A" }, { value: "2", label: "2" }] });
  });
  it("rejects non-arrays and an unsafe unit", () => {
    expect(normalizeParams("x")).toEqual([]);
    expect(normalizeParams([{ key: "n", type: "number", default: 1, unit: "px;x" }])[0].unit).toBeUndefined();
  });
});

describe("values", () => {
  it("normalizeValues keeps primitives under safe keys", () => {
    expect(normalizeValues({ a: 1, b: "x", c: true, d: {}, "bad key": 1 })).toEqual({ a: 1, b: "x", c: true });
  });
  it("coerces to the type and clamps", () => {
    expect(coerceParam(num, "9")).toBe(5);
    expect(coerceParam(num, "abc")).toBe(2);
    expect(coerceParam({ key: "t", label: "t", type: "toggle", default: false }, "true")).toBe(true);
    expect(coerceParam({ key: "s", label: "s", type: "select", default: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }, "zzz")).toBe("a");
  });
  it("paramValues falls back to defaults", () => {
    expect(paramValues([num], {})).toEqual({ speed: 2 });
    expect(paramValues([num], { speed: 3 })).toEqual({ speed: 3 });
  });
});

describe("paramCssVars", () => {
  it("adds units, turns toggles into 1/0 and drops unsafe text", () => {
    const vars = paramCssVars(
      [num, { key: "on", label: "on", type: "toggle", default: true }, { key: "c", label: "c", type: "color", default: "url(x)" }, { key: "col", label: "col", type: "color", default: "var(--sub-accent,#22d3ee)" }],
      { speed: 3.5 },
    );
    expect(vars).toEqual({ "--p-speed": "3.5s", "--p-on": "1", "--p-col": "var(--sub-accent,#22d3ee)" });
  });
});

describe("standard animation params", () => {
  it("has the standard keys with per-item defaults", () => {
    const p = stdAnimParams({ dur: 18, easing: "linear", iter: "infinite", trigger: true, secondary: "#fff" });
    expect(p.map((x) => x.key)).toEqual(["dur", "delay", "easing", "dir", "iter", "trigger", "accent", "secondary"]);
    expect(p.find((x) => x.key === "dur")?.default).toBe(18);
    expect(p.find((x) => x.key === "dur")?.unit).toBe("s");
    expect(p.find((x) => x.key === "easing")?.options?.some((o) => o.value === "linear")).toBe(true);
  });
  it("adds a custom default easing to the options and honors omit", () => {
    const p = stdAnimParams({ easing: "steps(24)", omit: ["dir", "iter"] });
    expect(p.find((x) => x.key === "easing")?.options?.some((o) => o.value === "steps(24)")).toBe(true);
    expect(p.some((x) => x.key === "dir" || x.key === "iter")).toBe(false);
  });
  it("produces CSS vars that pass the sanitizer", () => {
    const vars = paramCssVars(stdAnimParams({ dur: 4 }), {});
    expect(vars["--p-dur"]).toBe("4s");
    expect(vars["--p-iter"]).toBe("infinite");
    expect(vars["--p-easing"]).toBe("ease");
  });
  it("applyStdCss prefixes defaults and trigger rules", () => {
    const out = applyStdCss(".a{color:red}");
    expect(out.startsWith(":host{--p-delay:0s")).toBe(true);
    expect(out).toContain('data-ptrig="hover"');
    expect(out.endsWith(".a{color:red}")).toBe(true);
  });
  it("animVars builds the shorthand with fallbacks", () => {
    expect(animVars("18s", "linear")).toBe("var(--p-dur,18s) var(--p-easing,linear) var(--p-delay,0s) var(--p-iter,infinite) var(--p-dir,normal)");
  });
  it("withParams overrides by key", () => {
    const base = stdAnimParams();
    const out = withParams(base, { key: "dur", label: "Speed", type: "number", default: 9 });
    expect(out.find((p) => p.key === "dur")?.default).toBe(9);
    expect(out).toHaveLength(base.length);
  });
});
