import { describe, expect, it } from "vitest";
import {
  CLASSIC_ATOM_ORDER,
  CLASSIC_ATOM_RECTS,
  DEFAULT_DASHBOARD_PRESET,
  GRID_COLS,
  classicAtomGrid,
  constraintsForKind,
  defaultAtomGrid,
  deriveLayout,
  emptyCellCount,
  hasOverlap,
  holeCount,
  sortItems,
  tileKind,
  validateGrid,
  type GridItem,
} from "./dashboardGrid";
import { ATOMS, atomDef } from "./dashboardLayout";
import { CATALOG_SETS, atomBundle, setBundle } from "./dashboardCatalog";
import {
  applyClassicPreset,
  classicPanelGrid,
  classicPanelSet,
  defaultPanelGrid,
  defaultPanelSet,
  panelIdForAtom,
  resetToPreset,
  sanitizePanel,
} from "./dashboardModel";
import {
  classicLayout,
  dashboardTemplate,
  defaultLayout,
  layoutConstraints,
  parseLayout,
  parseWorkspace,
  presetLayout,
  saveActiveBoard,
  type CustomPanel,
} from "./dashboardBuilder";

const t = (k: string) => k;
const classicSet = CATALOG_SETS.find((s) => s.id === "classic")!;
const cons = (id: string) => constraintsForKind(tileKind(id));
const colsOf = (g: GridItem[]) => g.map((i) => ({ ...i }));
const custom = (id: string): CustomPanel => ({ id, title: "mine", kind: "metric", metrics: ["cpu"], code: "", url: "", text: "" });

describe("classic 2.6 tiles", () => {
  it("are catalog widgets of the 'classic' category outside the modern default dashboard", () => {
    const classic = ATOMS.filter((a) => a.group === "classic");
    expect(classic).toHaveLength(10);
    for (const a of classic) {
      expect(a.kind).toBe("widget");
      expect(a.extra).toBe(true);
      expect(a.title).toMatch(/^pages\.index\.dashAtom_classic_/);
      expect(a.desc).toMatch(/^pages\.index\.dashAtomDesc_classic_/);
      const c = cons(a.id);
      expect(a.w).toBeGreaterThanOrEqual(c.minW);
      expect(a.h).toBeGreaterThanOrEqual(c.minH);
      expect(atomBundle(a.id)!.panels[0].widget).toBe(a.id);
    }
    expect(defaultPanelSet().panels.some((p) => p.preset?.startsWith("classic_"))).toBe(false);
    expect(defaultPanelGrid().some((g) => g.id.includes("classic"))).toBe(false);
  });

  it("set 'classic' builds all tiles with unique ids and valid panels", () => {
    const b = setBundle(classicSet, t);
    expect(b.panels.map((p) => p.preset)).toEqual(CLASSIC_ATOM_ORDER);
    expect(new Set(b.panels.map((p) => p.id)).size).toBe(b.panels.length);
    expect(b.rects).toHaveLength(b.panels.length);
    for (const p of b.panels) expect(sanitizePanel(p)).not.toBeNull();
    expect(hasOverlap(b.rects)).toBe(false);
    expect(emptyCellCount(b.rects)).toBe(0);
    // the set follows the arrangement of the board
    const byPreset = new Map(b.panels.map((p) => [p.preset!, b.rects.find((r) => r.id === p.id)!]));
    for (const [atom, x, y, w, h] of CLASSIC_ATOM_RECTS) expect(byPreset.get(atom)).toMatchObject({ x, y, w, h });
  });

  it("arrangement: resources on top, four 3-column cards of equal height in one row, the rest full width", () => {
    const g = classicAtomGrid();
    const at = (id: string) => g.find((i) => i.id === id)!;
    expect(at("classic_resources")).toMatchObject({ x: 0, y: 0, w: 12 });
    const row = ["classic_logs", "classic_cores", "classic_backup", "classic_uptime"].map(at);
    expect(row.map((i) => i.w)).toEqual([3, 3, 3, 3]);
    expect(new Set(row.map((i) => i.y)).size).toBe(1);
    expect(new Set(row.map((i) => i.h)).size).toBe(1);
    expect(row.map((i) => i.x)).toEqual([0, 3, 6, 9]);
    expect(sortItems(g).map((i) => i.id)).toEqual([...CLASSIC_ATOM_ORDER]);
    for (const id of CLASSIC_ATOM_ORDER.slice(5)) expect(at(id).w).toBe(12);
  });

  it("has no overlaps and no holes at 12 / 6 / 1 columns", () => {
    const base = classicPanelGrid();
    const layout = classicLayout();
    const c = layoutConstraints(layout);
    expect(validateGrid(colsOf(base), 12, c)).toBe(true);
    expect(hasOverlap(base)).toBe(false);
    expect(holeCount(base, 12)).toBe(0);
    expect(emptyCellCount(base, 12)).toBe(0);
    const md = deriveLayout(base, "md", c);
    expect(hasOverlap(md)).toBe(false);
    expect(holeCount(md, 6)).toBe(0);
    const phone = (id: string) => {
      const def = atomDef(layout.panels.find((p) => p.id === id)?.widget ?? "");
      return def?.group === "classic" ? { full: true, rows: def.phoneRows } : undefined;
    };
    const sm = deriveLayout(base, "sm", c, { boardWidth: 360, phone });
    expect(hasOverlap(sm)).toBe(false);
    expect(holeCount(sm, 12)).toBe(0);
    // one column in the reading order of the desktop board
    for (const i of sm.filter((x) => phone(x.id))) expect(i).toMatchObject({ x: 0, w: GRID_COLS });
    expect(sortItems(sm).map((i) => i.id)).toEqual(sortItems(base).map((i) => i.id));
  });

  it("subsets (hidden by permissions) stay hole free", () => {
    for (const ids of [CLASSIC_ATOM_ORDER.filter((i) => i !== "classic_logs"), CLASSIC_ATOM_ORDER.filter((i) => i !== "classic_logs" && i !== "classic_backup"), ["classic_network"]]) {
      const g = classicAtomGrid(ids);
      expect(g.map((i) => i.id).sort()).toEqual([...ids].sort());
      expect(hasOverlap(g)).toBe(false);
      expect(holeCount(g, 12)).toBe(0);
      expect(emptyCellCount(g, 12)).toBe(0);
    }
  });
});

describe("classic board template and presets", () => {
  it("template 'classic' is a valid board marked classic", () => {
    const b = dashboardTemplate("classic", t);
    expect(b.preset).toBe("classic");
    expect(b.name).toBe("pages.builder.templateClassic");
    expect(b.layout.panels).toHaveLength(CLASSIC_ATOM_ORDER.length);
    expect(new Set(b.layout.panels.map((p) => p.id)).size).toBe(b.layout.panels.length);
    const c = layoutConstraints(b.layout);
    expect(validateGrid(b.layout.grid!, 12, c)).toBe(true);
    expect(emptyCellCount(b.layout.grid!, 12)).toBe(0);
    const again = parseLayout(JSON.stringify(b.layout));
    expect(again.panels.map((p) => p.id)).toEqual(b.layout.panels.map((p) => p.id));
    expect(again.grid).toEqual(b.layout.grid);
  });

  it("an empty saved state starts from the default preset (classic) and never touches saved boards", () => {
    expect(DEFAULT_DASHBOARD_PRESET).toBe("classic");
    for (const raw of [null, "", "not json", "{}", "[]"]) {
      const w = parseWorkspace(raw, []);
      expect(w.boards).toHaveLength(1);
      expect(w.boards[0].preset).toBe(DEFAULT_DASHBOARD_PRESET);
      expect(w.boards[0].layout.panels.map((p) => p.preset)).toEqual(CLASSIC_ATOM_ORDER);
    }
    // a board saved before the preset existed stays exactly as it is
    const modern = parseWorkspace(JSON.stringify(defaultLayout()), []);
    expect(modern.boards[0].preset).toBeUndefined();
    expect(modern.boards[0].layout.panels.map((p) => p.id)).toEqual(defaultLayout().panels.map((p) => p.id));
    const saved = JSON.stringify({ version: 2, activeId: "b", boards: [{ id: "b", name: "Mine", layout: defaultLayout(), enabled: [] }] });
    const ws = parseWorkspace(saved, []);
    expect(ws.boards[0].preset).toBeUndefined();
    expect(ws.boards[0].layout.grid).toEqual(defaultLayout().grid);
  });

  it("the preset marker survives saving and loading", () => {
    const w = parseWorkspace(null, []);
    const back = parseWorkspace(JSON.stringify(saveActiveBoard(w, w.boards[0].layout)), []);
    expect(back.boards[0].preset).toBe("classic");
    const m = { ...w, boards: [{ ...w.boards[0], preset: "modern" as const, layout: defaultLayout() }] };
    expect(parseWorkspace(JSON.stringify(m), []).boards[0].preset).toBe("modern");
    const junk = JSON.stringify({ ...m, boards: [{ ...m.boards[0], preset: "weird" }] });
    expect(parseWorkspace(junk, []).boards[0].preset).toBeUndefined();
  });

  it("reset keeps the preset of the board", () => {
    const layout = classicLayout();
    const scrambled = layout.grid!.map((g, i) => ({ ...g, x: 0, y: 1000 + i * 10, w: 12, h: 3 }));
    const reset = resetToPreset("classic", layout.panels, layout.tiles, scrambled, layoutConstraints(layout));
    expect(reset.map((i) => ({ ...i })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(classicPanelGrid().sort((a, b) => a.id.localeCompare(b.id)));
    // modern / unmarked boards still reset to the modern default, never to the classic one
    const modern = defaultLayout();
    const back = resetToPreset(undefined, modern.panels, modern.tiles, modern.grid!.map((g) => ({ ...g, x: 0, w: 12 })), layoutConstraints(modern));
    expect(back).toEqual(modern.grid);
    expect(resetToPreset("modern", modern.panels, modern.tiles, [], layoutConstraints(modern))).toEqual(modern.grid);
  });

  it("reset of a classic board with removed tiles and own tiles: classic block hole free, own tiles below", () => {
    const set = classicPanelSet();
    const panels = [...set.panels.filter((p) => p.preset !== "classic_logs"), custom("custom-own-1")];
    const tiles = { ...set.tiles, "custom-own-1": { width: 3, height: 4, view: "stat", title: "" } };
    const layout = { ...classicLayout(), panels, tiles };
    const g = resetToPreset("classic", panels, tiles, [], layoutConstraints(layout));
    expect(g).toHaveLength(panels.length);
    expect(hasOverlap(g)).toBe(false);
    expect(holeCount(g, 12)).toBe(0);
    const own = g.find((i) => i.id === "custom-own-1")!;
    const blockBottom = Math.max(...g.filter((i) => i.id !== own.id).map((i) => i.y + i.h));
    expect(own.y).toBeGreaterThanOrEqual(blockBottom);
  });

  it("'Classic view 2.6' replaces catalog tiles, keeps the user's own tiles below", () => {
    const modern = defaultLayout();
    const mine = custom("custom-own-1");
    const layout = { ...modern, panels: [...modern.panels, mine], tiles: { ...modern.tiles, [mine.id]: { width: 3, height: 4, view: "stat", title: "x" } } };
    const next = applyClassicPreset(layout, layoutConstraints);
    expect(next.panels.map((p) => p.id)).toEqual([...classicPanelSet().panels.map((p) => p.id), "custom-own-1"]);
    expect(next.tiles["custom-own-1"].title).toBe("x");
    expect(next.order).toEqual(next.panels.map((p) => p.id));
    expect(hasOverlap(next.grid!)).toBe(false);
    expect(holeCount(next.grid!, 12)).toBe(0);
    const block = next.grid!.filter((i) => i.id !== "custom-own-1");
    expect(next.grid!.find((i) => i.id === "custom-own-1")!.y).toBeGreaterThanOrEqual(Math.max(...block.map((i) => i.y + i.h)));
    // the same stable ids as the default classic layout
    expect(next.panels.map((p) => p.id)).toContain(panelIdForAtom("classic_resources"));
    // idempotent
    expect(applyClassicPreset(next, layoutConstraints).grid).toEqual(next.grid);
  });

  it("presetLayout maps presets to their layouts and the modern default is unchanged", () => {
    expect(presetLayout("classic").panels.map((p) => p.preset)).toEqual(CLASSIC_ATOM_ORDER);
    expect(presetLayout("modern")).toEqual(defaultLayout());
    expect(defaultAtomGrid().some((g) => g.id.startsWith("classic_"))).toBe(false);
  });
});
