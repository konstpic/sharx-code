import { describe, expect, it } from "vitest";
import {
  CATALOG_CATEGORIES,
  CATALOG_ENTRIES,
  CATALOG_SETS,
  CATALOG_TILES,
  atomBundle,
  makeMyEntry,
  metricBundle,
  metricCategory,
  parseMine,
  rowsBundle,
  setBundle,
  setRows,
  templateRows,
} from "./dashboardCatalog";
import { ATOMS } from "./dashboardLayout";
import { emptyCellCount, hasOverlap, removeAndFill, validateGrid, constraintsForKind, tileKind, compact, type GridItem } from "./dashboardGrid";
import { MAX_PANELS, insertBundle, resetToDefault, panelIdForAtom, type TileBundle } from "./dashboardModel";
import { defaultLayout, layoutConstraints, parseLayout, type DashboardLayout } from "./dashboardBuilder";

const t = (k: string) => k;
const layoutOf = (b: TileBundle): DashboardLayout => ({ version: 1, order: b.panels.map((p) => p.id), panels: b.panels, tiles: b.tiles, gridVersion: 4, grid: b.rects });
let seq = 0;
const newId = () => "custom-n" + seq++;

describe("tile catalog", () => {
  it("has unique ids, i18n keys and a known category for every entry", () => {
    const ids = CATALOG_ENTRIES.map((e) => e.kind + ":" + e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(CATALOG_CATEGORIES.map((c) => c.id));
    for (const e of CATALOG_ENTRIES) {
      expect(cats.has(e.category)).toBe(true);
      expect(e.title).toMatch(/^pages\./);
      expect(e.desc).toMatch(/^pages\./);
    }
    expect(CATALOG_TILES.length).toBe(ATOMS.length + 4);
    expect(CATALOG_SETS.map((s) => s.id)).toEqual(expect.arrayContaining(["resources", "network", "database", "uptime", "cores", "backup", "telemt", "nodes", "balancers"]));
  });

  it("every tile entry builds a valid panel within its kind's size limits", () => {
    for (const e of CATALOG_TILES) {
      if (!e.atom) continue;
      const b = atomBundle(e.atom)!;
      expect(b.panels).toHaveLength(1);
      const p = b.panels[0];
      expect(p.kind === "metric" ? p.metrics.length > 0 : p.widget === e.atom).toBe(true);
      const c = constraintsForKind(tileKind(p.id, b.tiles[p.id].view, p.kind, p.widget));
      const r = b.rects[0];
      expect(r.w).toBeGreaterThanOrEqual(c.minW);
      expect(r.h).toBeGreaterThanOrEqual(c.minH);
      expect(r.w).toBeLessThanOrEqual(c.maxW);
    }
    const m = metricBundle("cpu", "CPU", "gauge", "#fff", 4, 6, 100);
    expect(m.panels[0]).toMatchObject({ kind: "metric", metrics: ["cpu"] });
  });

  it("every set is built from rows of exactly 12 columns with equal heights: no empty cells", () => {
    for (const s of CATALOG_SETS) {
      for (const n of [0, 1, 4]) {
        const nodes = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: "N" + i }));
        const rows = setRows(s, t, { nodes, balancers: nodes });
        expect(rows.every((r) => r.tiles.reduce((a, x) => a + x.w, 0) === 12)).toBe(true);
        const b = setBundle(s, t, { nodes, balancers: nodes });
        expect(hasOverlap(b.rects)).toBe(false);
        expect(emptyCellCount(b.rects)).toBe(0);
        expect(new Set(b.panels.map((p) => p.id)).size).toBe(b.panels.length);
        expect(b.rects.length).toBe(b.panels.length);
        expect(validateGrid(compact(b.rects, 12, layoutConstraints(layoutOf(b))), 12)).toBe(true);
      }
    }
  });

  it("node templates for N = 0..9: aggregate rows plus one 12 column row of six tiles per node", () => {
    for (let n = 0; n <= 9; n++) {
      const nodes = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: "ES-" + (i + 1) }));
      const tpl = templateRows("nodes", t, { nodes })!;
      const b = rowsBundle(tpl.rows);
      expect(emptyCellCount(b.rects)).toBe(0);
      expect(b.panels.length).toBe(8 + 6 * n);
      expect(b.panels.length).toBeLessThanOrEqual(MAX_PANELS);
      if (n) {
        expect(b.panels.some((p) => p.title === "ES-1 · pages.builder.metric.cpu")).toBe(true);
        expect(b.panels.filter((p) => p.metrics[0].startsWith("node:1:")).length).toBe(6);
      }
      const bal = rowsBundle(templateRows("balancers", t, { balancers: nodes })!.rows);
      expect(emptyCellCount(bal.rects)).toBe(0);
      expect(bal.panels.length).toBe(6 + 6 * n);
    }
  });

  it("categorises metrics", () => {
    expect(metricCategory("cpu")).toBe("resources");
    expect(metricCategory("load.5")).toBe("resources");
    expect(metricCategory("cpu.cores")).toBe("system");
    expect(metricCategory("network.up")).toBe("network");
    expect(metricCategory("db.size")).toBe("database");
    expect(metricCategory("node:5:cpu")).toBe("nodes");
    expect(metricCategory("nodes.online")).toBe("nodes");
    expect(metricCategory("balancer:2:status")).toBe("balancers");
    expect(metricCategory("telemt.running")).toBe("telemt");
    expect(metricCategory("clients.online")).toBe("clients");
    expect(metricCategory("weird")).toBe("system");
  });
});

describe("inserting tiles and sets", () => {
  it("a set is added as ordinary independent tiles below the existing ones, hole-free, with fresh ids", () => {
    const base = defaultLayout();
    const set = CATALOG_SETS.find((s) => s.id === "database")!;
    const out = insertBundle(base, setBundle(set), newId, layoutConstraints(base));
    expect(out.panels.length).toBe(base.panels.length + 4);
    const added = out.panels.slice(base.panels.length);
    expect(added.every((p) => !base.panels.some((b) => b.id === p.id))).toBe(true);
    expect(hasOverlap(out.grid!)).toBe(false);
    const bottom = Math.max(...base.grid!.map((g) => g.y + g.h));
    const addedRects = out.grid!.filter((g) => added.some((p) => p.id === g.id));
    expect(Math.min(...addedRects.map((g) => g.y))).toBeGreaterThanOrEqual(bottom);
    expect(emptyCellCount(out.grid!)).toBe(0);
  });

  it("a single tile goes into the first free slot; ids stay unique even when the generator repeats", () => {
    const base = parseLayout(JSON.stringify({ version: 1, order: [], tiles: {}, panels: [], gridVersion: 4, grid: [] }));
    const one = atomBundle("cpu_gauge")!;
    const a = insertBundle(base, one, () => "custom-same");
    const b = insertBundle(a, one, (() => { let n = 0; return () => (n++ < 3 ? "custom-same" : "custom-other"); })());
    expect(b.panels.map((p) => p.id)).toEqual(["custom-same", "custom-other"]);
    expect(b.grid!.find((g) => g.id === "custom-same")).toMatchObject({ x: 0, y: 0 });
    expect(hasOverlap(b.grid!)).toBe(false);
  });

  it("never exceeds the tile limit", () => {
    let l = defaultLayout();
    for (let i = 0; i < 20; i++) l = insertBundle(l, setBundle(CATALOG_SETS.find((s) => s.id === "overview")!), newId, layoutConstraints(l));
    expect(l.panels.length).toBeLessThanOrEqual(MAX_PANELS);
    expect(hasOverlap(l.grid!)).toBe(false);
  });
});

describe("reset layout", () => {
  it("returns the default dashboard to its default places and arranges other tiles below", () => {
    const base = defaultLayout();
    const scrambled = base.grid!.map((g, i) => ({ ...g, x: 0, y: i * 5 }));
    const custom = atomBundle("net_up")!;
    const withExtra = insertBundle({ ...base, grid: scrambled }, custom, newId);
    const out = resetToDefault(withExtra.panels, withExtra.tiles, withExtra.grid!, layoutConstraints(withExtra));
    for (const g of base.grid!) expect(out.find((o) => o.id === g.id)).toMatchObject({ x: g.x, y: g.y, w: g.w, h: g.h });
    expect(out.length).toBe(withExtra.panels.length);
    expect(hasOverlap(out)).toBe(false);
    expect(resetToDefault([], {}, [])).toEqual([]);
  });
});

describe("removing a tile does not leave a hole", () => {
  const cons = undefined;
  const g = (id: string, x: number, y: number, w: number, h = 4): GridItem => ({ id, x, y, w, h });
  it("the left neighbour grows into the freed space (last tile of a row)", () => {
    const out = removeAndFill([g("a", 0, 0, 6), g("b", 6, 0, 6), g("c", 0, 4, 12)], "b", cons);
    expect(out.find((i) => i.id === "a")).toMatchObject({ x: 0, w: 12 });
    expect(emptyCellCount(out)).toBe(0);
  });
  it("a tile in the middle: the neighbour closes the gap; rows below are untouched", () => {
    const out = removeAndFill([g("a", 0, 0, 4), g("b", 4, 0, 4), g("c", 8, 0, 4), g("d", 0, 4, 6), g("e", 6, 4, 6)], "b", cons);
    expect(emptyCellCount(out)).toBe(0);
    expect(out.find((i) => i.id === "d")).toMatchObject({ x: 0, w: 6 });
    expect(out.find((i) => i.id === "e")).toMatchObject({ x: 6, w: 6 });
  });
  it("respects the neighbour's maximum width and lifts the tiles below instead", () => {
    const capped = (id: string) => ({ minW: 2, minH: 3, maxW: id === "a" ? 6 : 6, maxH: 40 });
    const out = removeAndFill([g("a", 0, 0, 6), g("b", 6, 0, 6), g("c", 0, 4, 6), g("d", 6, 4, 6)], "b", capped);
    expect(out.find((i) => i.id === "a")!.w).toBe(6);
    expect(hasOverlap(out)).toBe(false);
    expect(out.find((i) => i.id === "d")).toMatchObject({ y: 0 });
  });
  it("is safe for unknown ids and empty boards", () => {
    expect(removeAndFill([], "x")).toEqual([]);
    expect(removeAndFill([g("a", 0, 0, 12)], "zzz")).toEqual([g("a", 0, 0, 12)]);
  });
});

describe("\"Mine\"", () => {
  it("saves tiles and sets, relative to their top-left corner, and restores them", () => {
    const base = defaultLayout();
    const ids = [panelIdForAtom("cpu_gauge"), panelIdForAtom("ram_gauge")];
    const e = makeMyEntry("my-1", "  Pair  ", { panels: base.panels, tiles: base.tiles, grid: base.grid! }, ids)!;
    expect(e).toMatchObject({ kind: "set", name: "Pair" });
    expect(e.bundle.rects.map((r) => [r.x, r.y])).toEqual([[0, 0], [3, 0]]);
    const back = parseMine(JSON.parse(JSON.stringify([e])));
    expect(back).toEqual([e]);
    const one = makeMyEntry("my-2", "One", { panels: base.panels, tiles: base.tiles, grid: base.grid! }, [ids[1]])!;
    expect(one.kind).toBe("tile");
    expect(makeMyEntry("x", "n", { panels: [], tiles: {}, grid: [] })).toBeNull();
  });
  it("drops corrupt entries and never throws", () => {
    const junk: unknown[] = [null, 1, "a", {}, [], [null], [{ id: "a", name: "n" }], [{ id: "a", name: "n", bundle: { panels: "x", rects: [] } }], [{ id: "a", name: "n", bundle: { panels: [{ id: "bad" }], rects: [{ id: "bad", x: 0, y: 0, w: 1, h: 1 }] } }]];
    for (const j of junk) expect(() => parseMine(j)).not.toThrow();
    expect(parseMine(junk[8])).toEqual([]);
    expect(parseMine(Array.from({ length: 80 }, () => null))).toEqual([]);
  });
});

describe("reset layout leaves no avoidable holes", () => {
  it("custom tiles of equal height below the default block are arranged without gaps", () => {
    const base = defaultLayout();
    let l: DashboardLayout = { ...base, grid: base.grid!.map((g, i) => ({ ...g, x: 0, y: i * 5 })) };
    for (const w of [6, 6, 4, 4, 4, 6, 3]) {
      const b = metricBundle("cpu", "CPU", "stat", "#fff", w, 4);
      l = insertBundle(l, b, newId);
    }
    const out = resetToDefault(l.panels, l.tiles, l.grid!, layoutConstraints(l));
    expect(hasOverlap(out)).toBe(false);
    expect(emptyCellCount(out)).toBe(0);
    for (const g of base.grid!) expect(out.find((o) => o.id === g.id)).toMatchObject({ x: g.x, y: g.y });
  });
});
