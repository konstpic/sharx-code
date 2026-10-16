import { describe, expect, it } from "vitest";
import {
  GRID_COLS,
  addItem,
  breakpointForWidth,
  bottomOf,
  collides,
  compact,
  constraintsForKind,
  defaultBuiltinGrid,
  defaultGrid,
  deriveLayout,
  effectiveConstraints,
  fitItem,
  firstFit,
  hasOverlap,
  legacyHeightToRows,
  legacyToGrid,
  moveItem,
  parseGrid,
  parseGridState,
  reconcile,
  removeItem,
  resizeItem,
  resizeRect,
  serializeGrid,
  tileKind,
  validateGrid,
  type ConstraintsOf,
  type GridConstraints,
  type GridItem,
} from "./dashboardGrid";
import { DASHBOARD_WIDGET_ORDER } from "./dashboardLayout";

const it0 = (id: string, x: number, y: number, w: number, h: number): GridItem => ({ id, x, y, w, h });
const byId = (items: GridItem[], id: string) => items.find((i) => i.id === id)!;

/** Deterministic PRNG so fuzz failures are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomLayout(rand: () => number, n: number, cons: ConstraintsOf): GridItem[] {
  const raw: GridItem[] = [];
  for (let i = 0; i < n; i++)
    raw.push({ id: `t${i}`, x: Math.floor(rand() * 14) - 1, y: Math.floor(rand() * 12), w: 1 + Math.floor(rand() * 13), h: 1 + Math.floor(rand() * 10) });
  return compact(raw, GRID_COLS, cons);
}

const consOf: ConstraintsOf = (id) => {
  const n = Number(id.slice(1)) % 3;
  if (n === 0) return constraintsForKind("stat");
  if (n === 1) return constraintsForKind("chart");
  return constraintsForKind("table");
};

describe("basics", () => {
  it("detects collisions on shared area only", () => {
    expect(collides(it0("a", 0, 0, 4, 4), it0("b", 3, 3, 4, 4))).toBe(true);
    expect(collides(it0("a", 0, 0, 4, 4), it0("b", 4, 0, 4, 4))).toBe(false);
    expect(collides(it0("a", 0, 0, 4, 4), it0("b", 0, 4, 4, 4))).toBe(false);
    expect(collides(it0("a", 0, 0, 4, 4), it0("a", 0, 0, 4, 4))).toBe(false);
  });

  it("fitItem clamps into the grid and size limits", () => {
    const c: GridConstraints = { minW: 2, minH: 2, maxW: 6, maxH: 8 };
    expect(fitItem(it0("a", 11, -3, 1, 1), c)).toEqual(it0("a", 10, 0, 2, 2));
    expect(fitItem(it0("a", 0, 0, 20, 20), c)).toEqual(it0("a", 0, 0, 6, 8));
    expect(fitItem(it0("a", 1.4, 2.6, 3.2, 3.7), c)).toEqual(it0("a", 1, 3, 3, 4));
    expect(fitItem({ id: "a", x: NaN, y: Infinity, w: NaN, h: 3 }, c).x).toBe(0);
  });

  it("effectiveConstraints keeps min <= max <= cols", () => {
    expect(effectiveConstraints({ minW: 9, minH: 2, maxW: 3, maxH: 1 }, 6)).toEqual({ minW: 6, minH: 2, maxW: 6, maxH: 2 });
  });

  it("firstFit scans rows like dense flow", () => {
    const items = [it0("a", 0, 0, 8, 4), it0("b", 8, 0, 2, 2)];
    expect(firstFit(items, 4, 2)).toEqual({ x: 8, y: 2 });
    expect(firstFit(items, 2, 2)).toEqual({ x: 10, y: 0 });
    expect(firstFit(items, 12, 1)).toEqual({ x: 0, y: 4 });
    expect(firstFit([], 3, 3)).toEqual({ x: 0, y: 0 });
  });
});

describe("compact", () => {
  it("floats tiles up and keeps columns independent", () => {
    const out = compact([it0("a", 0, 5, 4, 2), it0("b", 6, 9, 4, 2), it0("c", 0, 20, 4, 2)]);
    expect(byId(out, "a").y).toBe(0);
    expect(byId(out, "b").y).toBe(0);
    expect(byId(out, "c").y).toBe(2);
  });

  it("resolves overlaps by pushing the later tile down", () => {
    const out = compact([it0("a", 0, 0, 6, 4), it0("b", 3, 1, 6, 4)]);
    expect(hasOverlap(out)).toBe(false);
    expect(byId(out, "a").y).toBe(0);
    expect(byId(out, "b").y).toBe(4);
  });

  it("is idempotent and keeps the order of the input array", () => {
    const rand = rng(7);
    for (let i = 0; i < 100; i++) {
      const raw = Array.from({ length: 12 }, (_, k) => it0(`t${k}`, Math.floor(rand() * 12), Math.floor(rand() * 30), 1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)));
      const once = compact(raw);
      expect(compact(once)).toEqual(once);
      expect(once.map((x) => x.id)).toEqual(raw.map((x) => x.id));
    }
  });
});

describe("moveItem", () => {
  const base = [it0("a", 0, 0, 6, 4), it0("b", 6, 0, 6, 4), it0("c", 0, 4, 12, 4)];

  it("moves into free space and compacts the hole", () => {
    const out = moveItem(base, "c", 0, 30);
    expect(byId(out, "c").y).toBe(4);
    expect(hasOverlap(out)).toBe(false);
  });

  it("pushes the tile underneath down when dropped on top of it", () => {
    const out = moveItem(base, "b", 0, 0);
    expect(byId(out, "b")).toMatchObject({ x: 0, y: 0 });
    expect(byId(out, "a").y).toBeGreaterThanOrEqual(4);
    expect(hasOverlap(out)).toBe(false);
  });

  it("swaps neighbours when dragged downwards past them", () => {
    const col = [it0("a", 0, 0, 12, 3), it0("b", 0, 3, 12, 3), it0("c", 0, 6, 12, 3)];
    const out = moveItem(col, "a", 0, 3);
    expect(byId(out, "b").y).toBe(0);
    expect(byId(out, "a").y).toBe(3);
    expect(byId(out, "c").y).toBe(6);
  });

  it("clamps x to the right edge and y to the top", () => {
    const out = moveItem(base, "a", 99, -5);
    expect(byId(out, "a").x).toBe(6);
    expect(byId(out, "a").y).toBe(0);
  });

  it("returns a copy for unknown ids and does not mutate the input", () => {
    const frozen = base.map((i) => Object.freeze({ ...i }));
    const out = moveItem(frozen, "zzz", 1, 1);
    expect(out).toEqual(base);
    moveItem(frozen, "a", 3, 3);
    expect(frozen).toEqual(base);
  });

  it("is deterministic from the same start layout (preview recomputation)", () => {
    expect(moveItem(base, "a", 4, 5)).toEqual(moveItem(base, "a", 4, 5));
  });
});

describe("resize", () => {
  const cons = (): GridConstraints => ({ minW: 2, minH: 2, maxW: 8, maxH: 6 });
  const start = it0("a", 4, 4, 4, 4);

  it("east / south grow and clamp to max and grid edge", () => {
    expect(resizeRect(start, "e", 2, 0, cons())).toMatchObject({ x: 4, w: 6, h: 4 });
    expect(resizeRect(start, "e", 20, 0, cons())).toMatchObject({ w: 8 });
    expect(resizeRect(it0("a", 8, 0, 3, 3), "e", 9, 0, cons())).toMatchObject({ w: 4 });
    expect(resizeRect(start, "s", 0, 99, cons())).toMatchObject({ h: 6 });
  });

  it("west / north keep the opposite edge anchored", () => {
    const r = resizeRect(start, "w", -2, 0, cons());
    expect(r).toMatchObject({ x: 2, w: 6 });
    expect(r.x + r.w).toBe(8);
    const n = resizeRect(start, "n", 0, 3, cons());
    expect(n.y + n.h).toBe(8);
    expect(n.h).toBe(2);
    expect(resizeRect(start, "w", -99, 0, cons()).x).toBe(0);
    expect(resizeRect(start, "n", 0, -99, cons()).y).toBeGreaterThanOrEqual(0);
  });

  it("respects the minimum size on every handle", () => {
    for (const h of ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const) {
      const r = resizeRect(start, h, h.includes("w") ? 99 : -99, h.includes("n") ? 99 : -99, cons());
      expect(r.w).toBeGreaterThanOrEqual(2);
      expect(r.h).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the aspect ratio when locked", () => {
    const r = resizeRect(it0("a", 0, 0, 4, 2), "se", 4, 0, { minW: 1, minH: 1, maxW: 12, maxH: 20 }, GRID_COLS, true);
    expect(r.w / r.h).toBeCloseTo(2, 5);
    const e = resizeRect(it0("a", 0, 0, 4, 2), "e", 2, 0, { minW: 1, minH: 1, maxW: 12, maxH: 20 }, GRID_COLS, true);
    expect(e).toMatchObject({ w: 6, h: 3 });
  });

  it("resizeItem pushes neighbours and never overlaps", () => {
    const items = [it0("a", 0, 0, 6, 4), it0("b", 6, 0, 6, 4), it0("c", 0, 4, 6, 4)];
    const out = resizeItem(items, "a", { x: 0, y: 0, w: 12, h: 6 });
    expect(byId(out, "a")).toMatchObject({ w: 12, h: 6 });
    expect(hasOverlap(out)).toBe(false);
    expect(byId(out, "b").y).toBeGreaterThanOrEqual(6);
  });

  it("shrinking lets tiles below float up", () => {
    const items = [it0("a", 0, 0, 6, 8), it0("b", 0, 8, 6, 3)];
    const out = resizeItem(items, "a", { x: 0, y: 0, w: 6, h: 4 });
    expect(byId(out, "b").y).toBe(4);
  });

  it("resizeItem enforces constraints even for sloppy rects", () => {
    const c: ConstraintsOf = () => ({ minW: 3, minH: 3, maxW: 6, maxH: 6 });
    const out = resizeItem([it0("a", 0, 0, 4, 4)], "a", { x: 0, y: 0, w: 1, h: 99 }, c);
    expect(out[0]).toMatchObject({ w: 3, h: 6 });
  });
});

describe("add / remove / reconcile", () => {
  it("addItem pushes others away", () => {
    const out = addItem([it0("a", 0, 0, 12, 4)], it0("n", 0, 0, 6, 3));
    expect(byId(out, "n")).toMatchObject({ x: 0, y: 0 });
    expect(byId(out, "a").y).toBe(3);
    expect(hasOverlap(out)).toBe(false);
  });

  it("removeItem compacts", () => {
    const out = removeItem([it0("a", 0, 0, 12, 4), it0("b", 0, 4, 12, 4)], "a");
    expect(out).toEqual([it0("b", 0, 0, 12, 4)]);
  });

  it("reconcile keeps stored positions, drops hidden/unknown ids and places missing ones", () => {
    const stored = [it0("a", 0, 0, 6, 4), it0("gone", 6, 0, 6, 4), it0("b", 6, 0, 6, 4), it0("a", 3, 3, 3, 3)];
    const out = reconcile(stored, ["a", "b", "new"], { defaultSize: () => ({ w: 6, h: 4 }) });
    expect(out.map((i) => i.id)).toEqual(["a", "b", "new"]);
    expect(byId(out, "a")).toMatchObject({ x: 0, y: 0 });
    expect(byId(out, "new")).toMatchObject({ x: 0, y: 4 });
    expect(hasOverlap(out)).toBe(false);
  });

  it("reconcile puts 'top' tiles first and applies new constraints to stored tiles", () => {
    const cons: ConstraintsOf = (id) => (id === "a" ? { minW: 6, minH: 5, maxW: 12, maxH: 20 } : { minW: 1, minH: 1, maxW: 12, maxH: 20 });
    const out = reconcile([it0("a", 0, 0, 2, 2)], ["a", "custom-1"], { defaultSize: () => ({ w: 3, h: 3 }), constraints: cons, top: (id) => id.startsWith("custom-") });
    expect(byId(out, "custom-1")).toMatchObject({ x: 0, y: 0 });
    expect(byId(out, "a")).toMatchObject({ w: 6, h: 5 });
    expect(hasOverlap(out)).toBe(false);
  });

  it("reconcile of an empty store equals flowing the defaults", () => {
    const out = reconcile(undefined, ["logs", "backup", "uptime"], { defaultSize: () => ({ w: 4, h: 4 }) });
    expect(out.map((i) => [i.x, i.y])).toEqual([
      [0, 0],
      [4, 0],
      [8, 0],
    ]);
  });
});

describe("breakpoints", () => {
  const desk = [it0("a", 0, 0, 8, 4), it0("b", 8, 0, 4, 4), it0("c", 0, 4, 2, 2), it0("d", 2, 4, 5, 3), it0("e", 0, 7, 12, 3)];

  it("maps widths to breakpoints", () => {
    expect(breakpointForWidth(320)).toBe("sm");
    expect(breakpointForWidth(640)).toBe("sm");
    expect(breakpointForWidth(641)).toBe("md");
    expect(breakpointForWidth(900)).toBe("lg");
  });

  it("phone: one column of full-width tiles ordered by y then x", () => {
    const out = deriveLayout(desk, "sm");
    expect(out.every((i) => i.x === 0 && i.w === 12)).toBe(true);
    expect(hasOverlap(out)).toBe(false);
    const order = [...out].sort((p, q) => p.y - q.y).map((i) => i.id);
    expect(order).toEqual(["a", "b", "c", "d", "e"]);
    expect(deriveLayout(desk, "sm")).toEqual(out);
  });

  it("tablet: 6 columns, no overlap, in bounds, stable", () => {
    const out = deriveLayout(desk, "md");
    expect(validateGrid(out, 6)).toBe(true);
    expect(deriveLayout(desk, "md")).toEqual(out);
    expect(byId(out, "e").w).toBe(6);
  });

  it("desktop derivation is an identity copy", () => {
    const out = deriveLayout(desk, "lg");
    expect(out).toEqual(desk);
    expect(out[0]).not.toBe(desk[0]);
  });

  it("fuzz: derived layouts are always valid", () => {
    const rand = rng(99);
    for (let i = 0; i < 60; i++) {
      const lay = randomLayout(rand, 3 + Math.floor(rand() * 14), consOf);
      expect(validateGrid(deriveLayout(lay, "md"), 6)).toBe(true);
      const sm = deriveLayout(lay, "sm");
      expect(hasOverlap(sm)).toBe(false);
      expect(sm.every((x) => x.w === 12 && x.x === 0)).toBe(true);
    }
  });
});

describe("serialize / parse / validate", () => {
  it("round-trips through JSON with an explicit gridVersion", () => {
    const g = [it0("a", 0, 0, 6, 4), it0("b", 6, 0, 6, 4)];
    const s = serializeGrid(g);
    expect(s.gridVersion).toBe(1);
    expect(parseGridState(JSON.parse(JSON.stringify(s)))).toEqual(g);
  });

  it("rejects a missing or foreign gridVersion", () => {
    expect(parseGridState({ grid: [it0("a", 0, 0, 2, 2)] })).toBeNull();
    expect(parseGridState({ gridVersion: 2, grid: [it0("a", 0, 0, 2, 2)] })).toBeNull();
  });

  it("survives corrupt input without throwing", () => {
    const bad: unknown[] = [null, undefined, 5, "x", {}, [], [null, 1, "a", [], {}], [{ id: 1 }], [{ id: "a", x: "1", y: 0, w: 2, h: 2 }], [{ id: "a", x: 0, y: 0, w: 0, h: 2 }], [{ id: "a", x: NaN, y: 0, w: 2, h: 2 }], { gridVersion: 1, grid: "nope" }, { gridVersion: 1, grid: [{}] }];
    for (const raw of bad) {
      expect(() => parseGrid(raw)).not.toThrow();
      expect(parseGrid(raw)).toBeNull();
      expect(() => parseGridState(raw)).not.toThrow();
    }
  });

  it("sanitises numbers, duplicates and unknown ids but keeps valid entries", () => {
    const raw = [
      { id: "a", x: 1.4, y: -2, w: 99, h: 2.6 },
      { id: "a", x: 0, y: 0, w: 2, h: 2 },
      { id: "zzz", x: 0, y: 0, w: 2, h: 2 },
      { id: "b", x: 11, y: 3, w: 4, h: 4 },
      "junk",
    ];
    const out = parseGrid(raw, { ids: ["a", "b"] })!;
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
    expect(out[0]).toEqual(it0("a", 0, 0, 12, 3));
    expect(out[1]).toEqual(it0("b", 8, 3, 4, 4));
  });

  it("caps absurd input sizes", () => {
    const raw = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, x: 0, y: i, w: 1, h: 1 }));
    expect(parseGrid(raw)!.length).toBeLessThanOrEqual(200);
  });

  it("validateGrid flags overlap, bounds, fractions, duplicates and constraint violations", () => {
    expect(validateGrid([it0("a", 0, 0, 6, 4), it0("b", 6, 0, 6, 4)])).toBe(true);
    expect(validateGrid([it0("a", 0, 0, 6, 4), it0("b", 5, 0, 6, 4)])).toBe(false);
    expect(validateGrid([it0("a", 8, 0, 6, 4)])).toBe(false);
    expect(validateGrid([it0("a", 0.5, 0, 6, 4)])).toBe(false);
    expect(validateGrid([it0("a", 0, 0, 2, 2), it0("a", 4, 0, 2, 2)])).toBe(false);
    expect(validateGrid([it0("a", 0, 0, 1, 1)], 12, () => ({ minW: 2, minH: 2, maxW: 4, maxH: 4 }))).toBe(false);
  });
});

describe("legacy conversion", () => {
  const ids = [...DASHBOARD_WIDGET_ORDER];

  it("heights convert by pixel height", () => {
    expect(legacyHeightToRows(3)).toBe(4);
    expect(legacyHeightToRows(5)).toBe(7);
    expect(legacyHeightToRows(11)).toBe(15);
  });

  it("an empty legacy layout yields the default dashboard: wide resources on top, three cards in a row", () => {
    const g = legacyToGrid({ order: [...ids], tiles: {} }, ids);
    expect(g.map((i) => i.id)).toEqual(ids);
    expect(byId(g, "resources")).toMatchObject({ x: 0, y: 0, w: 12 });
    const row = ["logs", "core_versions", "backup"].map((id) => byId(g, id));
    expect(row.map((i) => i.x)).toEqual([0, 4, 8]);
    expect(new Set(row.map((i) => i.y)).size).toBe(1);
    expect(validateGrid(g)).toBe(true);
    expect(g).toEqual(defaultBuiltinGrid());
  });

  it("keeps the old order and the old widths of customised tiles", () => {
    const legacy = {
      order: ["net_speed", "resources", "logs"],
      tiles: { net_speed: { width: 4, height: 5 }, resources: { width: 8, height: 8 }, logs: { width: 12, height: 3 } },
    };
    const g = legacyToGrid(legacy, ["resources", "logs", "net_speed"]);
    expect(g.map((i) => i.id)).toEqual(["net_speed", "resources", "logs"]);
    expect(byId(g, "net_speed")).toMatchObject({ x: 0, y: 0, w: 4, h: 7 });
    expect(byId(g, "resources")).toMatchObject({ x: 4, y: 0, w: 8 });
    expect(byId(g, "logs").w).toBe(12);
    expect(validateGrid(g)).toBe(true);
  });

  it("dense flow fills holes like the old CSS grid", () => {
    const legacy = {
      order: ["a", "b", "c"],
      tiles: { a: { width: 8, height: 3 }, b: { width: 8, height: 3 }, c: { width: 4, height: 3 } },
    };
    const g = legacyToGrid(legacy, ["a", "b", "c"]);
    expect(byId(g, "c")).toMatchObject({ x: 8, y: 0 });
  });

  it("includes custom panels and appends ids missing from the old order", () => {
    const g = legacyToGrid({ order: ["custom-1", "logs"], tiles: { "custom-1": { width: 3, height: 3 } } }, ["logs", "custom-1", "custom-2", "uptime"]);
    expect(g.map((i) => i.id)).toEqual(["custom-1", "logs", "custom-2", "uptime"]);
    expect(byId(g, "custom-1")).toMatchObject({ w: 3, h: 4 });
    expect(validateGrid(g)).toBe(true);
  });

  it("applies constraints during conversion (stat min 2x2)", () => {
    const g = legacyToGrid({ order: ["custom-1"], tiles: { "custom-1": { width: 1, height: 1 } } }, ["custom-1"], () => constraintsForKind("chart"));
    expect(g[0].w).toBeGreaterThanOrEqual(4);
    expect(g[0].h).toBeGreaterThanOrEqual(4);
  });

  it("falls back to defaults on corrupt legacy data", () => {
    const corrupt: unknown[] = [null, undefined, {}, { order: "x", tiles: 5 }, { order: [1, null, {}], tiles: { logs: null, uptime: "q", backup: { width: "wide", height: NaN } } }, { order: ["logs"], tiles: { logs: { width: 1e9, height: -4 } } }];
    for (const c of corrupt) {
      const g = legacyToGrid(c as never, ["logs", "uptime", "backup"]);
      expect(g).toHaveLength(3);
      expect(validateGrid(g)).toBe(true);
    }
  });

  it("covers every built-in widget in the default grid", () => {
    expect(defaultGrid(ids).map((i) => i.id)).toEqual(ids);
  });
});

describe("tile kinds", () => {
  it("assigns the documented minimum sizes", () => {
    expect(constraintsForKind(tileKind("custom-1", "stat", "metric"))).toMatchObject({ minW: 2, minH: 2 });
    expect(constraintsForKind(tileKind("custom-1", "area", "metric"))).toMatchObject({ minW: 4, minH: 4 });
    expect(constraintsForKind(tileKind("custom-1", "table", "metric"))).toMatchObject({ minW: 4, minH: 3 });
    expect(tileKind("custom-1", "default", "html")).toBe("content");
    expect(tileKind("cpu_history")).toBe("chart");
    expect(tileKind("cpu_history", "stat")).toBe("stat");
    expect(tileKind("resources")).toBe("resources");
    expect(tileKind("logs")).toBe("widget");
  });
});

describe("fuzz: engine invariants", () => {
  it("random moves keep layouts valid, bounded, within constraints and idempotent", { timeout: 60000 }, () => {
    const rand = rng(2024);
    for (let round = 0; round < 80; round++) {
      let lay = randomLayout(rand, 2 + Math.floor(rand() * 16), consOf);
      expect(validateGrid(lay, GRID_COLS, consOf)).toBe(true);
      for (let step = 0; step < 25; step++) {
        const pick = lay[Math.floor(rand() * lay.length)];
        const op = rand();
        if (op < 0.5) {
          lay = moveItem(lay, pick.id, Math.floor(rand() * 16) - 2, Math.floor(rand() * 40) - 3, consOf);
        } else if (op < 0.9) {
          const handle = (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const)[Math.floor(rand() * 8)];
          const rect = resizeRect(pick, handle, Math.floor(rand() * 20) - 10, Math.floor(rand() * 20) - 10, consOf(pick.id), GRID_COLS, rand() < 0.3);
          lay = resizeItem(lay, pick.id, rect, consOf);
        } else {
          const nid = `n${round}_${step}`;
          lay = addItem(lay, { id: nid, x: Math.floor(rand() * 12), y: Math.floor(rand() * 10), w: 1 + Math.floor(rand() * 12), h: 1 + Math.floor(rand() * 8) }, (id) => (id === nid ? constraintsForKind("widget") : consOf(id)));
        }
        const cons2: ConstraintsOf = (id) => (id.startsWith("n") ? constraintsForKind("widget") : consOf(id));
        // Plain booleans: deep expect() on every step dominates the runtime otherwise.
        const ok = validateGrid(lay, GRID_COLS, cons2) && JSON.stringify(compact(lay, GRID_COLS, cons2)) === JSON.stringify(lay) && bottomOf(lay) < 2000;
        if (!ok) throw new Error(`invariant broken at round ${round} step ${step}: ${JSON.stringify(lay)}`);
      }
    }
  });

  it("removing tiles keeps layouts valid", () => {
    const rand = rng(5);
    for (let r = 0; r < 40; r++) {
      let lay = randomLayout(rand, 12, consOf);
      while (lay.length) {
        lay = removeItem(lay, lay[Math.floor(rand() * lay.length)].id, consOf);
        expect(validateGrid(lay, GRID_COLS, consOf)).toBe(true);
      }
    }
  });

  it("reconcile of arbitrary garbage always yields a valid layout for the requested ids", () => {
    const rand = rng(31);
    for (let r = 0; r < 60; r++) {
      const stored = Array.from({ length: 10 }, () => ({ id: `t${Math.floor(rand() * 12)}`, x: Math.floor(rand() * 30) - 5, y: Math.floor(rand() * 30) - 5, w: Math.floor(rand() * 20) - 2, h: Math.floor(rand() * 20) - 2 }));
      const clean = parseGrid(stored) ?? [];
      const ids = Array.from({ length: 1 + Math.floor(rand() * 12) }, (_, i) => `t${i}`);
      const out = reconcile(clean, ids, { defaultSize: () => ({ w: 1 + Math.floor(rand() * 6), h: 1 + Math.floor(rand() * 6) }), constraints: consOf });
      expect(out.map((i) => i.id)).toEqual(ids);
      expect(validateGrid(out, GRID_COLS, consOf)).toBe(true);
    }
  });
});
