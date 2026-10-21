import { describe, expect, it } from "vitest";
import {
  DEFAULT_DASHBOARD_PRESET,
  GRID_COLS,
  V271_ATOM_ORDER,
  V271_ATOM_RECTS,
  constraintsForKind,
  deriveLayout,
  emptyCellCount,
  hasOverlap,
  holeCount,
  isDashboardPreset,
  sortItems,
  tileKind,
  v271AtomGrid,
  validateGrid,
  type GridItem,
} from "./dashboardGrid";
import { ATOMS, atomDef } from "./dashboardLayout";
import { CATALOG_CATEGORIES, CATALOG_SETS, V271_ROWS, atomBundle, setBundle } from "./dashboardCatalog";
import { applyV271Preset, classicPanelSet, defaultPanelGrid, defaultPanelSet, panelIdForAtom, resetToPreset, sanitizePanel, v271PanelGrid, v271PanelSet } from "./dashboardModel";
import { classicLayout, dashboardTemplate, defaultLayout, layoutConstraints, parseLayout, parseWorkspace, presetLayout, saveActiveBoard, v271Layout, type CustomPanel } from "./dashboardBuilder";

const t = (k: string) => k;
const v271Set = CATALOG_SETS.find((s) => s.id === "v271")!;
const cons = (id: string) => constraintsForKind(tileKind(id));
const colsOf = (g: GridItem[]) => g.map((i) => ({ ...i }));
const custom = (id: string): CustomPanel => ({ id, title: "mine", kind: "metric", metrics: ["cpu"], code: "", url: "", text: "" });
const byId = (g: GridItem[]) => [...g].sort((a, b) => a.id.localeCompare(b.id));

/** Rows of the board as lists of [atom, columns], ordered by y then x. */
const rowsOf = (g: readonly GridItem[]) => {
  const rows = new Map<number, GridItem[]>();
  for (const i of sortItems(g)) rows.set(i.y, [...(rows.get(i.y) ?? []), i]);
  return [...rows.values()].map((r) => r.map((i) => [i.id, i.w] as const));
};

describe("v2.7.1 tiles", () => {
  it("are catalog widgets of the 'v271' category outside the modern default dashboard", () => {
    const own = ATOMS.filter((a) => a.group === "v271");
    expect(own).toHaveLength(15);
    for (const a of own) {
      expect(a.kind).toBe("widget");
      expect(a.extra).toBe(true);
      expect(a.title).toMatch(/^pages\.index\.dashAtom_v271_/);
      expect(a.desc).toMatch(/^pages\.index\.dashAtomDesc_v271_/);
      const c = cons(a.id);
      expect(a.w).toBeGreaterThanOrEqual(c.minW);
      expect(a.h).toBeGreaterThanOrEqual(c.minH);
      expect(a.phoneRows).toBeGreaterThanOrEqual(3);
      expect(atomBundle(a.id)!.panels[0].widget).toBe(a.id);
    }
    expect(CATALOG_CATEGORIES.some((c) => c.id === "v271" && c.title === "pages.builder.cat_v271")).toBe(true);
    expect(defaultPanelSet().panels.some((p) => p.preset?.startsWith("v271_"))).toBe(false);
    expect(defaultPanelGrid().some((g) => g.id.includes("v271"))).toBe(false);
  });

  it("set 'v271' builds all tiles with unique ids and valid panels", () => {
    const b = setBundle(v271Set, t);
    expect(b.panels.map((p) => p.preset)).toEqual(V271_ATOM_ORDER.slice().sort((a, c) => V271_ATOM_ORDER.indexOf(a) - V271_ATOM_ORDER.indexOf(c)));
    expect(b.panels).toHaveLength(16);
    expect(new Set(b.panels.map((p) => p.id)).size).toBe(b.panels.length);
    expect(b.rects).toHaveLength(b.panels.length);
    for (const p of b.panels) expect(sanitizePanel(p)).not.toBeNull();
    expect(hasOverlap(b.rects)).toBe(false);
    expect(emptyCellCount(b.rects)).toBe(0);
    expect(holeCount(b.rects)).toBe(0);
    // the set follows the arrangement of the board
    const byPreset = new Map(b.panels.map((p) => [p.preset!, b.rects.find((r) => r.id === p.id)!]));
    for (const [atom, x, y, w, h] of V271_ATOM_RECTS) expect(byPreset.get(atom)).toMatchObject({ x, y, w, h });
    expect(V271_ROWS.every((r) => r.tiles.reduce((a, x) => a + x.w, 0) === GRID_COLS)).toBe(true);
  });

  it("arrangement equals the dense flow of the 2.7.1 CSS grid (12 columns, spans 12 / 4 / 6)", () => {
    // 2.7.1: `grid-auto-flow: row dense`, widths by tile, tile heights fit the content (modelled as one row each).
    const ORDER = ["resources", "logs", "core_versions", "backup", "uptime", "users_online", "user_agent", "database", "net_speed", "net_traffic", "net_sockets", "server_ip", "panel_runtime", "telemt_dc", "cpu_history", "memory_history"];
    const width = (id: string) => (id === "resources" || id === "telemt_dc" ? 12 : id === "logs" || id === "core_versions" || id === "backup" ? 4 : 6);
    const taken = new Set<string>();
    const placed: { id: string; x: number; y: number; w: number }[] = [];
    for (const id of ORDER) {
      const w = width(id);
      for (let y = 0; ; y++) {
        let x = 0;
        for (; x + w <= GRID_COLS; x++) if (![...Array(w)].some((_, k) => taken.has(`${y},${x + k}`))) break;
        if (x + w > GRID_COLS) continue;
        for (let k = 0; k < w; k++) taken.add(`${y},${x + k}`);
        placed.push({ id, x, y, w });
        break;
      }
    }
    const atom = (id: string) => (id === "telemt_dc" ? id : "v271_" + id);
    const expected = new Map<number, [string, number][]>();
    for (const p of placed.sort((a, b) => a.y - b.y || a.x - b.x)) expected.set(p.y, [...(expected.get(p.y) ?? []), [atom(p.id), p.w]]);
    const dense = [...expected.values()];
    // 2.7.1 leaves the last tile alone in a half row; the board has no hole, so it takes the whole row
    expect(dense.at(-1)).toEqual([["v271_memory_history", 6]]);
    const widened = dense.map((r, i) => (i === dense.length - 1 ? r.map(([id]) => [id, 12] as const) : r));
    expect(rowsOf(v271AtomGrid())).toEqual(widened);
    expect(widened).toEqual([
      [["v271_resources", 12]],
      [["v271_logs", 4], ["v271_core_versions", 4], ["v271_backup", 4]],
      [["v271_uptime", 6], ["v271_users_online", 6]],
      [["v271_user_agent", 6], ["v271_database", 6]],
      [["v271_net_speed", 6], ["v271_net_traffic", 6]],
      [["v271_net_sockets", 6], ["v271_server_ip", 6]],
      [["v271_panel_runtime", 6], ["v271_cpu_history", 6]],
      [["telemt_dc", 12]],
      [["v271_memory_history", 12]],
    ]);
    // tiles of one row have the height of the row
    const g = v271AtomGrid();
    for (const y of new Set(g.map((i) => i.y))) expect(new Set(g.filter((i) => i.y === y).map((i) => i.h)).size).toBe(1);
  });

  it("has no overlaps and no holes at 12 / 6 / 1 columns", () => {
    const base = v271PanelGrid();
    const layout = v271Layout();
    const c = layoutConstraints(layout);
    expect(validateGrid(colsOf(base), 12, c)).toBe(true);
    expect(hasOverlap(base)).toBe(false);
    expect(holeCount(base, 12)).toBe(0);
    expect(emptyCellCount(base, 12)).toBe(0);
    const md = deriveLayout(base, "md", c);
    expect(hasOverlap(md)).toBe(false);
    expect(holeCount(md, 6)).toBe(0);
    expect(emptyCellCount(md, 6)).toBe(0);
    const phone = (id: string) => {
      const def = atomDef(layout.panels.find((p) => p.id === id)?.widget ?? "");
      return def?.group === "v271" || def?.group === "classic" ? { full: true, rows: def.phoneRows } : undefined;
    };
    const sm = deriveLayout(base, "sm", c, { boardWidth: 360, phone });
    expect(hasOverlap(sm)).toBe(false);
    expect(holeCount(sm, 12)).toBe(0);
    for (const i of sm.filter((x) => phone(x.id))) expect(i).toMatchObject({ x: 0, w: GRID_COLS });
    expect(sortItems(sm).map((i) => i.id)).toEqual(sortItems(base).map((i) => i.id));
  });

  it("subsets (hidden by permissions / node mode) stay hole free", () => {
    const without = (...drop: string[]) => V271_ATOM_ORDER.filter((i) => !drop.includes(i));
    for (const ids of [without("v271_logs"), without("v271_logs", "v271_backup"), without("v271_core_versions", "v271_users_online", "telemt_dc"), ["v271_server_ip"], ["v271_net_speed", "v271_server_ip", "telemt_dc"]]) {
      const g = v271AtomGrid(ids);
      expect(g.map((i) => i.id).sort()).toEqual([...ids].sort());
      expect(hasOverlap(g)).toBe(false);
      expect(holeCount(g, 12)).toBe(0);
      expect(emptyCellCount(g, 12)).toBe(0);
    }
  });
});

describe("v2.7.1 board template and presets", () => {
  it("template 'v271' is a valid board marked v271", () => {
    const b = dashboardTemplate("v271", t);
    expect(b.preset).toBe("v271");
    expect(b.name).toBe("pages.builder.templateV271");
    expect(b.layout.panels).toHaveLength(V271_ATOM_ORDER.length);
    expect(new Set(b.layout.panels.map((p) => p.id)).size).toBe(b.layout.panels.length);
    const c = layoutConstraints(b.layout);
    expect(validateGrid(b.layout.grid!, 12, c)).toBe(true);
    expect(emptyCellCount(b.layout.grid!, 12)).toBe(0);
    const again = parseLayout(JSON.stringify(b.layout));
    expect(again.panels.map((p) => p.id)).toEqual(b.layout.panels.map((p) => p.id));
    expect(again.grid).toEqual(b.layout.grid);
  });

  it("the default preset is unchanged and the 'v271' marker survives saving and loading", () => {
    expect(DEFAULT_DASHBOARD_PRESET).toBe("classic");
    expect(isDashboardPreset("v271")).toBe(true);
    expect(isDashboardPreset("v27")).toBe(false);
    const w = parseWorkspace(null, []);
    expect(w.boards[0].preset).toBe("classic");
    const ws = { ...w, boards: [{ ...w.boards[0], preset: "v271" as const, layout: v271Layout() }] };
    const back = parseWorkspace(JSON.stringify(saveActiveBoard(ws, ws.boards[0].layout)), []);
    expect(back.boards[0].preset).toBe("v271");
    expect(back.boards[0].layout.panels.map((p) => p.preset)).toEqual(V271_ATOM_ORDER);
    expect(back.boards[0].layout.grid).toEqual(v271Layout().grid);
  });

  it("reset restores the preset of the board: classic, v271 or modern", () => {
    const layout = v271Layout();
    const scrambled = layout.grid!.map((g, i) => ({ ...g, x: 0, y: 1000 + i * 10, w: 12, h: 3 }));
    const reset = resetToPreset("v271", layout.panels, layout.tiles, scrambled, layoutConstraints(layout));
    expect(byId(reset.map((i) => ({ ...i })))).toEqual(byId(v271PanelGrid()));
    // the other presets never turn into the v2.7.1 one and back
    const classic = classicLayout();
    expect(byId(resetToPreset("classic", classic.panels, classic.tiles, [], layoutConstraints(classic)).map((i) => ({ ...i })))).toEqual(byId(classic.grid!.map((i) => ({ ...i }))));
    const modern = defaultLayout();
    expect(resetToPreset("modern", modern.panels, modern.tiles, [], layoutConstraints(modern))).toEqual(modern.grid);
    expect(resetToPreset(undefined, modern.panels, modern.tiles, [], layoutConstraints(modern))).toEqual(modern.grid);
  });

  it("reset of a v271 board with removed tiles and own tiles: block hole free, own tiles below", () => {
    const set = v271PanelSet();
    const panels = [...set.panels.filter((p) => p.preset !== "v271_logs"), custom("custom-own-1")];
    const tiles = { ...set.tiles, "custom-own-1": { width: 3, height: 4, view: "stat", title: "" } };
    const layout = { ...v271Layout(), panels, tiles };
    const g = resetToPreset("v271", panels, tiles, [], layoutConstraints(layout));
    expect(g).toHaveLength(panels.length);
    expect(hasOverlap(g)).toBe(false);
    expect(holeCount(g, 12)).toBe(0);
    const own = g.find((i) => i.id === "custom-own-1")!;
    expect(own.y).toBeGreaterThanOrEqual(Math.max(...g.filter((i) => i.id !== own.id).map((i) => i.y + i.h)));
  });

  it("'View 2.7.1' replaces catalog tiles (also the classic ones), keeps the user's own tiles below", () => {
    const classic = classicLayout();
    const mine = custom("custom-own-1");
    const layout = { ...classic, panels: [...classic.panels, mine], tiles: { ...classic.tiles, [mine.id]: { width: 3, height: 4, view: "stat", title: "x" } } };
    const next = applyV271Preset(layout, layoutConstraints);
    expect(next.panels.map((p) => p.id)).toEqual([...v271PanelSet().panels.map((p) => p.id), "custom-own-1"]);
    expect(next.panels.some((p) => classicPanelSet().panels.some((c) => c.id === p.id && c.id !== panelIdForAtom("telemt_dc")))).toBe(false);
    expect(next.tiles["custom-own-1"].title).toBe("x");
    expect(next.order).toEqual(next.panels.map((p) => p.id));
    expect(hasOverlap(next.grid!)).toBe(false);
    expect(holeCount(next.grid!, 12)).toBe(0);
    const block = next.grid!.filter((i) => i.id !== "custom-own-1");
    expect(next.grid!.find((i) => i.id === "custom-own-1")!.y).toBeGreaterThanOrEqual(Math.max(...block.map((i) => i.y + i.h)));
    expect(applyV271Preset(next, layoutConstraints).grid).toEqual(next.grid);
  });

  it("presetLayout maps presets to their layouts", () => {
    expect(presetLayout("v271").panels.map((p) => p.preset)).toEqual(V271_ATOM_ORDER);
    expect(presetLayout("classic").panels.map((p) => p.id)).toEqual(classicLayout().panels.map((p) => p.id));
    expect(presetLayout("modern")).toEqual(defaultLayout());
  });
});
