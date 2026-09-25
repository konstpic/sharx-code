import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clearTour, placeCard, readTour, shouldAutoStart, TOUR_KEY, taskDone, validateTour, writeTour, type TourSnapshot } from "./tourLogic";
import { TOUR_STEPS, TOUR_TEXT, TOUR_TRACKS } from "./tourSteps";

function mem(initial?: string) {
  const m = new Map<string, string>();
  if (initial !== undefined) m.set(TOUR_KEY, initial);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const snap: TourSnapshot = { left: "layers", device: "mobile", selKey: "", nodes: 3, grid: false, modal: null, bp: "base", enabled: false };

describe("tour definitions", () => {
  it("are valid", () => expect(validateTour(TOUR_STEPS, TOUR_TRACKS)).toEqual([]));
  it("detects broken tracks", () => {
    expect(validateTour(TOUR_STEPS, [{ id: "x", steps: ["nope"] }])).toHaveLength(1);
    expect(validateTour([{ id: "a", icon: "x" }, { id: "a", icon: "x" }], [])).toHaveLength(1);
  });
  it("has texts for every step and hands-on hint", () => {
    for (const s of TOUR_STEPS) {
      if (s.id === "welcome" || s.id) {
        expect(TOUR_TEXT[`tour.s.${s.id}.t`], s.id).toBeTruthy();
        expect(TOUR_TEXT[`tour.s.${s.id}.b`], s.id).toBeTruthy();
      }
      if (s.task) expect(TOUR_TEXT[`tour.s.${s.id}.h`], s.id).toBeTruthy();
    }
  });
  it("every text key exists in the en and ru translation files", () => {
    for (const f of ["translate.en_US.toml", "translate.ru_RU.toml"]) {
      const toml = readFileSync(new URL(`../../../../../../web/translation/${f}`, import.meta.url), "utf8");
      for (const k of Object.keys(TOUR_TEXT)) expect(toml.includes(`"${k}" = `), `${f}: ${k}`).toBe(true);
    }
  });
});

describe("taskDone", () => {
  it("detects each hands-on action", () => {
    expect(taskDone("device", snap, { ...snap, device: "desktop" })).toBe(true);
    expect(taskDone("device", snap, snap)).toBe(false);
    expect(taskDone("nodeAdded", snap, { ...snap, nodes: 4 })).toBe(true);
    expect(taskDone("nodeAdded", snap, { ...snap, nodes: 2 })).toBe(false);
    expect(taskDone("selection", snap, { ...snap, selKey: "a" })).toBe(true);
    expect(taskDone("selection", { ...snap, selKey: "a" }, { ...snap, selKey: "a" })).toBe(false);
    expect(taskDone("selection", { ...snap, selKey: "a" }, snap)).toBe(false);
    expect(taskDone("grid", snap, { ...snap, grid: true })).toBe(true);
    expect(taskDone("tab:add", snap, { ...snap, left: "add" })).toBe(true);
    expect(taskDone("modal:presets", snap, { ...snap, modal: "presets" })).toBe(true);
    expect(taskDone("modal:presets", snap, { ...snap, modal: "css" })).toBe(false);
  });
});

describe("persistence", () => {
  it("round-trips", () => {
    const s = mem();
    expect(writeTour({ done: false, dismissed: true, track: "quick", step: 3 }, s)).toBe(true);
    expect(readTour(s)).toEqual({ done: false, dismissed: true, track: "quick", step: 3 });
    clearTour(s);
    expect(readTour(s)).toEqual({ done: false, dismissed: false });
  });
  it("survives corrupt values", () => {
    for (const bad of ["{", "null", "42", '"x"', '{"done":"yes","track":5,"step":"a"}']) {
      const r = readTour(mem(bad));
      expect(r.done).toBe(false);
      expect(r.track).toBeUndefined();
    }
  });
  it("survives missing or throwing storage", () => {
    expect(readTour(null)).toEqual({ done: false, dismissed: false });
    expect(writeTour({ done: true, dismissed: true }, null)).toBe(false);
    const boom = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(readTour(boom)).toEqual({ done: false, dismissed: false });
    expect(writeTour({ done: true, dismissed: true }, boom)).toBe(false);
    expect(() => clearTour(boom)).not.toThrow();
    expect(shouldAutoStart(boom)).toBe(false);
  });
  it("auto-starts only on a clean first visit", () => {
    expect(shouldAutoStart(mem())).toBe(true);
    expect(shouldAutoStart(mem(JSON.stringify({ done: true, dismissed: true })))).toBe(false);
    expect(shouldAutoStart(mem(JSON.stringify({ done: false, dismissed: true })))).toBe(false);
    expect(shouldAutoStart(mem(JSON.stringify({ done: false, dismissed: false, track: "quick", step: 2 })))).toBe(false);
    expect(shouldAutoStart(null)).toBe(false);
  });
});

describe("placeCard", () => {
  const vp = { w: 1200, h: 800 };
  const card = { w: 340, h: 200 };
  it("centers without a target", () => expect(placeCard(null, card, vp)).toEqual({ x: 430, y: 300 }));
  it("goes below a toolbar button and stays inside", () => {
    const p = placeCard({ x: 1150, y: 8, w: 30, h: 32 }, card, vp);
    expect(p.y).toBeGreaterThan(40);
    expect(p.x + card.w).toBeLessThanOrEqual(vp.w - 12);
  });
  it("goes to the right of a left panel", () => {
    const p = placeCard({ x: 0, y: 48, w: 300, h: 700 }, card, vp);
    expect(p.x).toBeGreaterThanOrEqual(300);
  });
  it("falls back inside a huge target", () => {
    const p = placeCard({ x: 0, y: 0, w: 1200, h: 800 }, card, vp);
    expect(p.x).toBeGreaterThanOrEqual(12);
    expect(p.y + card.h).toBeLessThanOrEqual(vp.h - 12);
  });
});
