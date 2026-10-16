import { describe, expect, it } from "vitest";
import {
  GRID_COLS,
  GRID_VERSION,
  LEGACY_V1_ORDER,
  compact,
  constraintsForKind,
  defaultAtomGrid,
  defaultGridKeeping,
  deriveLayout,
  hasOverlap,
  autoArrange,
  emptyCellCount,
  fillGaps,
  holeCount,
  isLegacyDefaultGrid,
  loadSavedGrid,
  migrateGridToAtoms,
  reconcile,
  reflow,
  tileKind,
  validateGrid,
  type GridItem,
} from "./dashboardGrid";
import { ATOMS, DASHBOARD_WIDGET_ORDER, LEGACY_WIDGET_SPLIT, expandLegacyWidgetIds, parseDashboardWidgets } from "./dashboardLayout";
import { defaultLayout, parseLayout } from "./dashboardBuilder";

const cons = (id: string) => constraintsForKind(tileKind(id));
const r = (id: string, x: number, y: number, w: number, h: number): GridItem => ({ id, x, y, w, h });
const atomIds = DASHBOARD_WIDGET_ORDER as readonly string[];

/** The "Monitoring" board measured on the live panel (1494 px board, 42 px per row): v1 composite tiles. */
const LIVE_V1: GridItem[] = [
  r("resources", 0, 0, 6, 10), r("backup", 6, 0, 4, 6), r("logs", 0, 10, 4, 6), r("core_versions", 4, 10, 4, 7),
  r("uptime", 0, 17, 6, 6), r("users_online", 6, 17, 6, 5), r("user_agent", 6, 22, 6, 9), r("database", 0, 23, 6, 7),
  r("net_speed", 0, 30, 6, 7), r("net_traffic", 6, 31, 6, 6), r("net_sockets", 0, 37, 6, 6), r("server_ip", 6, 37, 6, 5),
  r("panel_runtime", 6, 42, 6, 6), r("telemt_dc", 0, 48, 12, 4), r("cpu_history", 0, 52, 6, 8), r("memory_history", 6, 52, 6, 8),
];

describe("default atom dashboard", () => {
  it("contains every atom exactly once, valid, hole-free", () => {
    const g = defaultAtomGrid();
    expect(g.map((i) => i.id).sort()).toEqual([...atomIds].sort());
    expect(validateGrid(g, GRID_COLS, cons)).toBe(true);
    expect(holeCount(g)).toBe(0);
    expect(defaultLayout().grid).toEqual(g.map((i) => ({ ...i, id: "custom-" + i.id.replace(/_/g, "-") })));
  });

  it("stays hole-free for every subset that hides a few tiles (reconcile)", () => {
    for (const hide of [["nodes_availability"], ["logs", "backup_export", "core_controls"], ["xray_uptime", "nodes_cores", "telemt_dc"]]) {
      const ids = atomIds.filter((id) => !hide.includes(id));
      const shown = reconcile(defaultAtomGrid(), ids, { defaultSize: () => ({ w: 3, h: 4 }), constraints: cons });
      expect(hasOverlap(shown)).toBe(false);
      expect(shown.map((i) => i.id)).toEqual(ids);
      // compacted: nothing can float up
      expect(compact(shown, GRID_COLS, cons)).toEqual(shown);
    }
  });

  it("the first screen holds the KPI strip: four 3x4 gauges on top", () => {
    const g = defaultAtomGrid();
    for (const id of ["cpu_gauge", "ram_gauge", "disk_gauge", "swap_gauge"]) expect(g.find((i) => i.id === id)).toMatchObject({ y: 0, w: 3, h: 4 });
  });

  it("derived 6 column and 1 column layouts have no holes and no overlaps", () => {
    const g = defaultAtomGrid();
    const md = deriveLayout(g, "md", cons);
    expect(md.every((i) => i.x + i.w <= 6)).toBe(true);
    expect(hasOverlap(md)).toBe(false);
    expect(holeCount(md, 6)).toBe(0);
    expect(md.map((i) => i.id).sort()).toEqual(g.map((i) => i.id).sort());
    const sm = deriveLayout(g, "sm", cons);
    expect(sm.every((i) => (i.w === 6 && (i.x === 0 || i.x === 6)) || (i.w === 12 && i.x === 0))).toBe(true);
    expect(hasOverlap(sm)).toBe(false);
    expect(emptyCellCount(sm)).toBe(0);
    // reading order of the desktop layout is kept
    const order = [...g].sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.id);
    expect([...sm].sort((a, b) => a.y - b.y).map((i) => i.id)).toEqual(order);
  });

  it("every atom has an i18n title and description, a size within its kind and a unique id", () => {
    expect(new Set(ATOMS.map((a) => a.id)).size).toBe(ATOMS.length);
    for (const a of ATOMS) {
      expect(a.title).toMatch(/^pages\.index\.dashAtom_/);
      expect(a.desc).toMatch(/^pages\.index\.dashAtomDesc_/);
      const c = cons(a.id);
      expect(a.w).toBeGreaterThanOrEqual(c.minW);
      expect(a.h).toBeGreaterThanOrEqual(c.minH);
    }
  });
});

describe("legacy widget ids are groups of atoms", () => {
  it("expands composites to their atoms, keeping order and unknown ids", () => {
    expect(expandLegacyWidgetIds(["resources", "logs", "weird"])).toEqual([...LEGACY_WIDGET_SPLIT.resources, "logs", "weird"]);
    expect(expandLegacyWidgetIds(["quick_actions"])).toContain("backup_import");
    expect(expandLegacyWidgetIds(["network"])).toContain("server_ip");
    expect(expandLegacyWidgetIds([1, null, "net_speed", "net_speed"])).toEqual(["net_up", "net_down"]);
    for (const atoms of Object.values(LEGACY_WIDGET_SPLIT)) for (const a of atoms) expect(atomIds).toContain(a);
  });

  it("an old enabledWidgets value turns into the atoms in canonical order", () => {
    expect(parseDashboardWidgets(JSON.stringify(["net_traffic", "resources"]))).toEqual(atomIds.filter((id) => [...LEGACY_WIDGET_SPLIT.resources, "net_total_sent", "net_total_received"].includes(id)));
    expect(parseDashboardWidgets("garbage")).toEqual(atomIds);
    expect(parseDashboardWidgets(JSON.stringify(["nope"]))).toEqual(atomIds);
  });
});

describe("migration of saved grids (v1 composite tiles -> atoms)", () => {
  const ids = [...atomIds, "custom-a", "custom-b"];

  it("an untouched v1 default becomes the new default; custom panels stay on top", () => {
    const old: GridItem[] = [];
    // build the former default exactly like the old engine did
    const sizes: Record<string, [number, number]> = { resources: [12, 12], logs: [4, 6], core_versions: [4, 7], backup: [4, 6], uptime: [6, 6], users_online: [6, 5], user_agent: [6, 9], database: [6, 7], net_speed: [6, 7], net_traffic: [6, 6], net_sockets: [6, 6], server_ip: [6, 5], panel_runtime: [6, 6], telemt_dc: [12, 8], cpu_history: [6, 8], memory_history: [6, 8] };
    for (const id of LEGACY_V1_ORDER) {
      const [w, h] = sizes[id];
      let at = { x: 0, y: 0 };
      outer: for (let y = 0; y < 100; y++) for (let x = 0; x + w <= 12; x++) if (!old.some((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y)) { at = { x, y }; break outer; }
      old.push({ id, w, h, ...at });
    }
    expect(isLegacyDefaultGrid(old)).toBe(true);
    const out = migrateGridToAtoms(old, cons);
    expect(out).toEqual(defaultAtomGrid());
    const withCustom = migrateGridToAtoms([...old.map((i) => ({ ...i, y: i.y + 4 })), r("custom-a", 0, 0, 3, 4)], cons);
    expect(withCustom.find((i) => i.id === "custom-a")).toMatchObject({ x: 0, y: 0, w: 3, h: 4 });
    expect(withCustom.find((i) => i.id === "cpu_gauge")!.y).toBe(4);
    expect(hasOverlap(withCustom)).toBe(false);
  });

  it("the live 'Monitoring' board: customised composites are replaced by atoms, no holes, no overlaps", () => {
    expect(holeCount(LIVE_V1)).toBeGreaterThan(0); // the problem we are fixing
    const out = migrateGridToAtoms(LIVE_V1, cons);
    expect(out.some((i) => i.id in LEGACY_WIDGET_SPLIT)).toBe(false);
    expect(hasOverlap(out)).toBe(false);
    expect(holeCount(out)).toBe(0);
    expect(validateGrid(out, GRID_COLS, cons)).toBe(true);
    for (const g of ["resources", "backup", "uptime", "database", "net_speed", "net_traffic", "net_sockets", "panel_runtime", "core_versions"]) for (const a of LEGACY_WIDGET_SPLIT[g]) expect(out.some((i) => i.id === a)).toBe(true);
    for (const same of ["logs", "users_online", "user_agent", "server_ip", "telemt_dc", "cpu_history", "memory_history"]) expect(out.filter((i) => i.id === same)).toHaveLength(1);
    expect(out.find((i) => i.id === "telemt_dc")).toMatchObject({ x: 0, w: 12 });
  });

  it("is idempotent and stable", () => {
    const once = migrateGridToAtoms(LIVE_V1, cons);
    expect(migrateGridToAtoms(once, cons)).toEqual(once);
    const def = defaultAtomGrid();
    expect(migrateGridToAtoms(def, cons)).toEqual(def);
  });

  it("replaces a composite in place: atoms stay inside the old slot columns and custom panels keep their size", () => {
    const v1 = [r("custom-a", 0, 0, 6, 8), r("resources", 6, 0, 6, 8), r("logs", 0, 8, 6, 6), r("users_online", 6, 8, 6, 6)];
    const out = migrateGridToAtoms(v1, cons);
    for (const a of LEGACY_WIDGET_SPLIT.resources) {
      const it = out.find((i) => i.id === a)!;
      expect(it.x).toBeGreaterThanOrEqual(6);
      expect(it.y).toBeLessThan(8);
    }
    expect(out.find((i) => i.id === "custom-a")).toMatchObject({ x: 0, y: 0, w: 6, h: 8 });
    expect(out.find((i) => i.id === "logs")).toBeTruthy();
    expect(hasOverlap(out)).toBe(false);
  });

  it("goes through loadSavedGrid for v1 grids, v2 grids and the pre-grid model", () => {
    const v1 = loadSavedGrid({ gridVersion: 1, grid: LIVE_V1 }, { ids, constraints: cons })!;
    expect(v1.some((i) => i.id === "cpu_gauge")).toBe(true);
    expect(holeCount(v1)).toBe(0);
    const v2 = loadSavedGrid({ gridVersion: GRID_VERSION, grid: [r("cpu_gauge", 0, 9, 3, 4), r("ram_gauge", 0, 30, 3, 4)] }, { ids, constraints: cons })!;
    expect(v2).toEqual([r("cpu_gauge", 0, 0, 3, 4), r("ram_gauge", 0, 4, 3, 4)]);
    const legacy = loadSavedGrid({ order: ["resources", "logs"], tiles: {} }, { ids, constraints: cons })!;
    expect(legacy.some((i) => i.id === "load_average")).toBe(true);
    expect(hasOverlap(legacy)).toBe(false);
  });

  it("never throws on corrupt input", () => {
    const junk: unknown[] = [null, undefined, 5, "x", {}, [], [null, 1, "a"], [{ id: 5 }], [{ id: "resources", x: "a" }], [{ id: "resources", x: NaN, y: 0, w: 0, h: 0 }]];
    for (const j of junk) {
      expect(() => migrateGridToAtoms(j as never, cons)).not.toThrow();
      expect(() => loadSavedGrid(j, { ids, constraints: cons })).not.toThrow();
      expect(() => loadSavedGrid({ gridVersion: 1, grid: j }, { ids, constraints: cons })).not.toThrow();
    }
    for (const raw of ['{"version":1,"order":[],"grid":[[]]}', '{"version":1,"order":["resources"],"gridVersion":1,"grid":[{"id":"resources","x":99,"y":-3,"w":99,"h":0}]}']) {
      const l = parseLayout(raw);
      expect(validateGrid(l.grid!)).toBe(true);
    }
  });
});

describe("normalisation of loaded layouts", () => {
  it("the live coordinates: after reconcile (as the board does) there are no holes and the order is stable", () => {
    const migrated = migrateGridToAtoms(LIVE_V1, cons);
    const visible = atomIds.filter((id) => !["nodes_availability", "core_controls"].includes(id));
    const shown = reconcile(migrated, visible, { defaultSize: () => ({ w: 3, h: 4 }), constraints: cons });
    expect(hasOverlap(shown)).toBe(false);
    expect(compact(shown, GRID_COLS, cons)).toEqual(shown);
    const again = reconcile(shown, visible, { defaultSize: () => ({ w: 3, h: 4 }), constraints: cons });
    expect(again).toEqual(shown);
    const md = deriveLayout(shown, "md", cons);
    expect(holeCount(md, 6)).toBe(0);
    expect(hasOverlap(md)).toBe(false);
  });

  it("reflow is hole-free, overlap-free, order preserving and idempotent (fuzz)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let round = 0; round < 60; round++) {
      const n = 3 + Math.floor(rnd() * 14);
      const items: GridItem[] = [];
      for (let i = 0; i < n; i++) {
        const w = 2 + Math.floor(rnd() * 8);
        const it = { id: `t${i}`, w, h: 3 + Math.floor(rnd() * 6), x: Math.floor(rnd() * (13 - w)), y: Math.floor(rnd() * 30) };
        items.push(it);
      }
      for (const cols of [12, 6]) {
        const out = reflow(compact(items), cols, undefined, 12);
        expect(hasOverlap(out)).toBe(false);
        expect(out.every((i) => i.x >= 0 && i.x + i.w <= cols)).toBe(true);
        expect(holeCount(out, cols)).toBe(0);
        expect(out.map((i) => i.id).sort()).toEqual(items.map((i) => i.id).sort());
        const reading = [...compact(items)].sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.id);
        expect([...out].sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.id)).toEqual(reading);
      }
    }
  });

  it("parseLayout normalises a v2 layout with overlaps and gaps", () => {
    const raw = JSON.stringify({
      version: 1, order: [...atomIds], tiles: {}, panels: [], gridVersion: 3,
      grid: [r("cpu_gauge", 0, 0, 3, 4), r("ram_gauge", 1, 1, 3, 4), r("disk_gauge", 6, 50, 3, 4)],
    });
    const l = parseLayout(raw, ["cpu_gauge", "ram_gauge", "disk_gauge"]);
    expect(l.gridVersion).toBe(4);
    expect(validateGrid(l.grid!)).toBe(true);
    expect(compact(l.grid!)).toEqual(l.grid);
    expect(l.panels.map((p) => p.preset).sort()).toEqual(["cpu_gauge", "disk_gauge", "ram_gauge"]);
  });

  it("defaultGridKeeping offsets the atoms below custom panels", () => {
    const g = defaultGridKeeping([r("custom-a", 0, 0, 6, 5)], cons);
    expect(g.find((i) => i.id === "custom-a")).toMatchObject({ y: 0, h: 5 });
    expect(Math.min(...g.filter((i) => i.id !== "custom-a").map((i) => i.y))).toBe(5);
    expect(hasOverlap(g)).toBe(false);
  });
});

describe("default layout has no empty cells", () => {
  const full = () => defaultAtomGrid();

  it("0 empty cells on 12 / 6 / 1 columns", () => {
    const g = full();
    expect(emptyCellCount(g, 12)).toBe(0);
    expect(emptyCellCount(deriveLayout(g, "md", cons), 6)).toBe(0);
    const sm = deriveLayout(g, "sm", cons);
    expect(emptyCellCount(sm.map((i) => ({ ...i, w: 1 })), 1)).toBe(0);
    expect(g.find((i) => i.id === "telemt_dc")).toMatchObject({ x: 0, w: 12, h: 12 });
  });

  it("telemt visible / hidden and any enabled subset stay gap-free (12, 6 and 1 columns)", () => {
    const subsets: string[][] = [
      atomIds.filter((id) => id !== "telemt_dc"),
      atomIds.filter((id) => !["nodes_availability", "nodes_cores"].includes(id)),
      atomIds.filter((id) => !["logs", "backup_export", "backup_import", "backup_config", "core_controls", "core_update"].includes(id)),
      atomIds.filter((_, i) => i % 2 === 0),
      atomIds.filter((_, i) => i % 3 !== 0),
      [...atomIds.slice(0, 5)],
    ];
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 40; i++) subsets.push(atomIds.filter(() => rnd() > 0.45));
    for (const ids of subsets) {
      if (!ids.length) continue;
      const g = defaultAtomGrid(ids);
      expect(g.map((x) => x.id).sort()).toEqual([...ids].sort());
      expect(hasOverlap(g)).toBe(false);
      expect(validateGrid(g, GRID_COLS, cons)).toBe(true);
      // a lone tile can be capped by its maximum width; otherwise every row is full
      if (g.every((x) => cons(x.id).maxW >= 12)) expect(emptyCellCount(g, 12)).toBe(0);
      const md = deriveLayout(g, "md", cons);
      expect(hasOverlap(md)).toBe(false);
      expect(emptyCellCount(md, 6)).toBe(0);
    }
  });

  it("telemt_dc cannot be smaller than 12x7 (6x5 or more on tablet)", () => {
    const c = cons("telemt_dc");
    expect(c.minW).toBe(12);
    expect(c.minH).toBeGreaterThanOrEqual(7);
    const small = compact([r("telemt_dc", 0, 0, 12, 4)], 12, cons);
    expect(small[0].h).toBe(7);
    const md = deriveLayout(small, "md", cons);
    expect(md[0].w).toBe(6);
    expect(md[0].h).toBeGreaterThanOrEqual(5);
  });
});

describe("auto-arrange and the v2 -> v3 upgrade", () => {
  const holey = [r("a", 0, 0, 3, 4), r("b", 6, 0, 3, 4), r("c", 0, 4, 12, 4), r("d", 3, 8, 3, 4), r("e", 0, 12, 3, 4), r("f", 9, 0, 3, 4)];

  it("keeps sizes, never overlaps, fills the gaps and does not add empty cells", () => {
    expect(emptyCellCount(holey)).toBeGreaterThan(0);
    const out = autoArrange(holey);
    expect(hasOverlap(out)).toBe(false);
    for (const i of holey) {
      const o = out.find((x) => x.id === i.id)!;
      expect(o.h).toBe(i.h);
      expect(o.w).toBeGreaterThanOrEqual(i.w);
    }
    expect(emptyCellCount(out)).toBeLessThan(emptyCellCount(holey));
    expect(holeCount(out)).toBe(0);
  });

  it("is safe on junk and empty input and applies minimum sizes", () => {
    expect(autoArrange([])).toEqual([]);
    const out = autoArrange([r("telemt_dc", 0, 0, 12, 4), r("cpu_gauge", 0, 4, 3, 1)], cons);
    expect(out.find((i) => i.id === "telemt_dc")!.h).toBe(7);
    expect(out.find((i) => i.id === "cpu_gauge")!.h).toBeGreaterThanOrEqual(3);
    expect(hasOverlap(out)).toBe(false);
    expect(() => autoArrange([null, 5, { id: 1 }] as never)).not.toThrow();
  });

  it("a saved v2 layout is arranged once with the new minimum sizes, a v3 layout only normalised", () => {
    const ids = [...atomIds];
    const grid = [r("cpu_gauge", 0, 0, 3, 4), r("ram_gauge", 6, 0, 3, 4), r("telemt_dc", 0, 4, 12, 4), r("logs", 3, 8, 3, 4), r("backup_export", 9, 8, 3, 4)];
    const v2 = loadSavedGrid({ gridVersion: 2, grid }, { ids, constraints: cons })!;
    expect(v2.find((i) => i.id === "telemt_dc")!.h).toBe(7);
    expect(hasOverlap(v2)).toBe(false);
    expect(holeCount(v2)).toBe(0);
    const v3 = loadSavedGrid({ gridVersion: GRID_VERSION, grid }, { ids, constraints: cons })!;
    expect(v3.find((i) => i.id === "telemt_dc")!.h).toBe(7);
    expect(v3.find((i) => i.id === "ram_gauge")).toMatchObject({ x: 6 }); // positions are not rearranged
  });
});

describe("auto-arrange closes horizontal gaps", () => {
  // Saved "Monitoring" board (v3 after the first packing) described by the coordinator: two 2-column holes.
  it("fillGaps widens the neighbour of a 2 column gap", () => {
    const g = [r("a", 0, 0, 4, 4), r("b", 6, 0, 6, 4), r("c", 0, 4, 12, 4)];
    const out = fillGaps(g, cons);
    expect(emptyCellCount(out)).toBe(0);
    expect(out.find((i) => i.id === "a")!.w).toBe(6);
    expect(out.map((i) => i.h)).toEqual(g.map((i) => i.h));
    expect(hasOverlap(out)).toBe(false);
  });

  it("respects the maximum width of the neighbour and falls back to the other side", () => {
    const capped = (id: string) => (id === "a" ? { minW: 2, minH: 3, maxW: 4, maxH: 40 } : { minW: 2, minH: 3, maxW: 12, maxH: 40 });
    const out = fillGaps([r("a", 0, 0, 4, 4), r("b", 6, 0, 6, 4)], capped);
    expect(out.find((i) => i.id === "a")!.w).toBe(4);
    expect(emptyCellCount(out)).toBe(0);
    expect(out.find((i) => i.id === "b")).toMatchObject({ x: 4, w: 8 });
  });

  it("the live Monitoring board ends up with 0 empty cells", () => {
    const migrated = migrateGridToAtoms(LIVE_V1, cons);
    const arranged = autoArrange(migrated, cons);
    expect(hasOverlap(arranged)).toBe(false);
    expect(holeCount(arranged)).toBe(0);
    expect(emptyCellCount(arranged)).toBe(0);
    const v2 = loadSavedGrid({ gridVersion: 2, grid: migrated }, { ids: atomIds, constraints: cons })!;
    expect(emptyCellCount(v2)).toBe(0);
    expect(v2.find((i) => i.id === "telemt_dc")!.h).toBeGreaterThanOrEqual(7);
  });

  it("200 random sets: equal heights give 0 empty cells, mixed heights are never worse than compaction", () => {
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(rnd() * 14);
      const mixed = round % 2 === 1;
      const items: GridItem[] = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, x: 0, y: i * 10, w: 2 + Math.floor(rnd() * 7), h: mixed ? [4, 6, 8][Math.floor(rnd() * 3)] : 4 }));
      const out = autoArrange(items);
      expect(hasOverlap(out)).toBe(false);
      expect(out.every((i) => i.x >= 0 && i.x + i.w <= 12)).toBe(true);
      expect(out.map((i) => i.h)).toEqual(items.map((i) => i.h));
      if (!mixed) {
        expect(holeCount(out)).toBe(0);
        expect(emptyCellCount(out)).toBe(0);
      } else {
        // heights differ and are not changed: never worse than plain compaction
        expect(emptyCellCount(out)).toBeLessThanOrEqual(emptyCellCount(compact(items)));
      }
    }
  });
});

describe("phone layout limits tall tiles", () => {
  it("telemt_dc <= 6 rows and user_agent <= 8 rows, even below their minimum height", () => {
    const items = [r("telemt_dc", 0, 0, 12, 12), r("user_agent", 0, 12, 6, 12), r("cpu_gauge", 6, 12, 3, 4)];
    const cap = (id: string) => (id === "telemt_dc" ? 6 : id === "user_agent" ? 8 : undefined);
    const out = deriveLayout(items, "sm", cons, { boardWidth: 360, maxRows: cap });
    expect(out.find((i) => i.id === "telemt_dc")!.h).toBeLessThanOrEqual(6);
    expect(out.find((i) => i.id === "user_agent")!.h).toBeLessThanOrEqual(8);
    expect(hasOverlap(out)).toBe(false);
    expect(emptyCellCount(out)).toBe(0);
  });
});
