import { describe, expect, it } from "vitest";
import { isEntrance, motionClass, motionCss, motionKey, motionSheet, normalizeMotion, resolveMotion, safeEasing, safeKeyframes, staggerVars } from "./motion";
import { MOTION_PRESETS } from "./types";

describe("safeEasing", () => {
  it("accepts named, spring, cubic-bezier and steps", () => {
    expect(safeEasing("ease-in")).toBe("ease-in");
    expect(safeEasing("spring")).toContain("cubic-bezier");
    expect(safeEasing("cubic-bezier(.4, 0, .2, 1)")).toBe("cubic-bezier(.4,0,.2,1)");
    expect(safeEasing("steps(8, end)")).toBe("steps(8,end)");
  });
  it("rejects anything else", () => {
    for (const bad of ["cubic-bezier(1,2)", "ease; color:red", "url(x)", 5, undefined]) expect(safeEasing(bad)).toBeUndefined();
  });
});

describe("safeKeyframes", () => {
  it("keeps balanced keyframe bodies", () => {
    expect(safeKeyframes("from{opacity:0}to{opacity:1}")).toBe("from{opacity:0}to{opacity:1}");
  });
  it("drops at-rules, urls, markup and unbalanced braces", () => {
    expect(safeKeyframes("@import 'x';from{a:b}")).not.toContain("@");
    expect(safeKeyframes("@media x{from{a:b}}")).toBe("");
    for (const bad of ["from{background:url(x)}", "from{a:b}}", "from{a:b", "</style>from{a:b}", "nothing"]) expect(safeKeyframes(bad)).toBe("");
  });
});

describe("resolveMotion", () => {
  it("entrances play once and keep the end state; loops repeat", () => {
    expect(resolveMotion({ preset: "fade" })).toMatchObject({ iterations: 1, fillMode: "both", trigger: "load" });
    expect(resolveMotion({ preset: "pulse" })).toMatchObject({ iterations: "infinite", fillMode: "none" });
    expect(isEntrance("slide-up")).toBe(true);
    expect(isEntrance("spin")).toBe(false);
  });
  it("clamps numbers and validates enums", () => {
    const r = resolveMotion({ preset: "fade", duration: -5, delay: 1e9, intensity: 500, direction: "x" as never, trigger: "nope" as never });
    expect(r).toMatchObject({ duration: 1, delay: 60000, intensity: 100, direction: "normal", trigger: "load" });
  });
});

describe("normalizeMotion", () => {
  it("returns undefined for junk and unknown presets", () => {
    for (const bad of [null, "x", [], {}, { preset: "explode" }]) expect(normalizeMotion(bad)).toBeUndefined();
  });
  it("keeps valid fields and drops invalid ones", () => {
    const m = normalizeMotion({ preset: "slide-up", duration: 800, easing: "spring", iterations: "infinite", trigger: "visible", repeat: true, junk: 1, delay: "x", direction: "bad" });
    expect(m).toEqual({ preset: "slide-up", duration: 800, easing: "spring", iterations: "infinite", trigger: "visible", repeat: true });
  });
  it("filters custom keyframes", () => {
    expect(normalizeMotion({ preset: "custom", customKeyframes: "from{a:b}to{c:d}" })?.customKeyframes).toBe("from{a:b}to{c:d}");
    expect(normalizeMotion({ preset: "custom", customKeyframes: "@import 'x'" })?.customKeyframes).toBeUndefined();
    expect(normalizeMotion({ preset: "fade", customKeyframes: "from{a:b}" })?.customKeyframes).toBeUndefined();
  });
});

describe("motion css", () => {
  it("has a keyframes body for every preset except none", () => {
    for (const p of MOTION_PRESETS) {
      const css = motionCss({ preset: p, customKeyframes: "from{opacity:0}to{opacity:1}" }).css;
      if (p === "none") expect(css).toBe("");
      else expect(css, p).toContain("@keyframes lmk-");
    }
  });
  it("the same look shares one key; different looks do not", () => {
    expect(motionKey({ preset: "fade" })).toBe(motionKey({ preset: "fade", duration: 600 }));
    expect(motionKey({ preset: "fade" })).not.toBe(motionKey({ preset: "fade", duration: 900 }));
  });
  it("deduplicates in the sheet", () => {
    const one = motionSheet([{ preset: "fade" }]);
    expect(motionSheet([{ preset: "fade" }, { preset: "fade" }, { preset: "none" }])).toBe(one);
  });
  it("trigger shapes the rules", () => {
    expect(motionCss({ preset: "fade", trigger: "hover" }).css).toContain(":hover{animation:");
    expect(motionCss({ preset: "fade", trigger: "focus" }).css).toContain(":focus-within{");
    const vis = motionCss({ preset: "fade", trigger: "visible" }).css;
    expect(vis).toContain("animation-play-state:paused");
    expect(vis).toContain('[data-motion="active"]');
    expect(motionCss({ preset: "fade", trigger: "scroll-progress" }).css).toContain("animation-timeline:view()");
    expect(motionCss({ preset: "fade", playState: "paused" }).css).toContain("paused!important");
  });
  it("uses stagger variables in the delay", () => {
    expect(motionCss({ preset: "fade", delay: 100 }).css).toContain("calc(100ms + var(--lm-i,0) * var(--lm-st,0ms))");
  });
  it("classes carry the trigger", () => {
    expect(motionClass({ preset: "fade", trigger: "visible", repeat: true })).toMatch(/^lm lm-\w+ lm-t-visible lm-rep$/);
  });
  it("stagger vars come only from a staggering parent", () => {
    expect(staggerVars({ preset: "fade", stagger: 80 }, 2)).toEqual({ "--lm-i": 2, "--lm-st": "80ms" });
    expect(staggerVars({ preset: "fade" }, 2)).toBeUndefined();
    expect(staggerVars(undefined, 1)).toBeUndefined();
  });
});
