import { describe, expect, it } from "vitest";
import { dashboardTemplate, defaultLayout, emptyLayout, layoutConstraints, parseLayout, parseWorkspace, saveActiveBoard } from "./dashboardBuilder";
import { DASHBOARD_WIDGET_ORDER } from "./dashboardLayout";
import { GRID_VERSION, emptyCellCount, hasOverlap, validateGrid } from "./dashboardGrid";
import { panelIdForAtom } from "./dashboardModel";

const pid = panelIdForAtom;
const atoms = [...DASHBOARD_WIDGET_ORDER] as string[];
const v1 = (extra: Record<string, unknown> = {}) => ({ version: 1, order: [...atoms], tiles: {}, panels: [], ...extra });

describe("parseLayout: one tile model (grid v4)", () => {
  it("turns a pre-grid layout (order + tiles) into ordinary panels", () => {
    const raw = JSON.stringify({
      version: 1,
      order: ["net_speed", "resources", "logs", "uptime"],
      tiles: { net_speed: { width: 4, height: 5, view: "default", title: "Speed" } },
      panels: [],
    });
    const l = parseLayout(raw, ["net_speed", "resources", "logs", "uptime"]);
    expect(l.gridVersion).toBe(GRID_VERSION);
    expect(l.grid!.every((g) => g.id.startsWith("custom-"))).toBe(true);
    expect(l.panels.map((p) => p.id)).toContain(pid("cpu_gauge"));
    expect(l.panels.find((p) => p.id === pid("net_up"))).toMatchObject({ kind: "metric", metrics: ["network.up"], preset: "net_up" });
    expect(l.panels.find((p) => p.id === pid("logs"))).toMatchObject({ kind: "widget", widget: "logs" });
    expect(validateGrid(l.grid!, 12, layoutConstraints(l))).toBe(true);
  });

  it("only the enabled built-in widgets become panels; custom panels and their sizes survive", () => {
    const raw = JSON.stringify({
      version: 1,
      order: ["custom-a", ...atoms],
      tiles: { "custom-a": { width: 3, height: 3, view: "stat" }, cpu_gauge: { title: "My CPU", color: "#ff0000", view: "default" }, net_up: { view: "area" } },
      panels: [{ id: "custom-a", title: "A", kind: "metric", metrics: ["cpu"] }],
    });
    const l = parseLayout(raw, ["cpu_gauge", "net_up", "logs"]);
    expect(l.panels.map((p) => p.id).sort()).toEqual(["custom-a", pid("cpu_gauge"), pid("logs"), pid("net_up")].sort());
    expect(l.tiles[pid("cpu_gauge")]).toMatchObject({ title: "My CPU", color: "#ff0000", view: "gauge" });
    expect(l.tiles[pid("net_up")].view).toBe("area");
    expect(l.panels.find((p) => p.id === "custom-a")!.title).toBe("A");
    expect(l.grid!.find((i) => i.id === "custom-a")).toMatchObject({ w: 3 });
    expect(hasOverlap(l.grid!)).toBe(false);
  });

  it("keeps the slots of a v3 (atom) layout when the atoms become panels", () => {
    const grid = [
      { id: "cpu_gauge", x: 0, y: 0, w: 3, h: 4 },
      { id: "ram_gauge", x: 3, y: 0, w: 3, h: 4 },
      { id: "disk_gauge", x: 6, y: 0, w: 3, h: 4 },
    ];
    const l = parseLayout(JSON.stringify(v1({ gridVersion: 3, grid })), ["cpu_gauge", "ram_gauge", "disk_gauge"]);
    expect(l.grid).toEqual([
      { id: pid("cpu_gauge"), x: 0, y: 0, w: 3, h: 4 },
      { id: pid("ram_gauge"), x: 3, y: 0, w: 3, h: 4 },
      { id: pid("disk_gauge"), x: 6, y: 0, w: 3, h: 4 },
    ]);
  });

  it("is idempotent: parsing the result again changes nothing", () => {
    const once = parseLayout(JSON.stringify(v1()));
    const twice = parseLayout(JSON.stringify(once));
    expect(twice).toEqual(once);
    expect(parseLayout(JSON.stringify(defaultLayout()))).toEqual(defaultLayout());
  });

  it("the default layout is the default dashboard: every atom once, no holes", () => {
    const l = defaultLayout();
    expect(l.panels.length).toBe(atoms.length);
    expect(emptyCellCount(l.grid!)).toBe(0);
    expect(l.grid!.map((g) => g.id).sort()).toEqual(l.panels.map((p) => p.id).sort());
  });

  it("ignores a broken grid and still yields a valid layout", () => {
    for (const grid of ["nope", [], [null, 1], [{ id: "logs", x: "a" }], { a: 1 }]) {
      for (const gridVersion of [1, 3, 4]) {
        const l = parseLayout(JSON.stringify(v1({ gridVersion, grid })));
        expect(validateGrid(l.grid!)).toBe(true);
        if (gridVersion !== 4) expect(l.panels.length).toBeGreaterThan(0);
      }
    }
  });

  it("never throws on garbage and returns the default layout", () => {
    for (const raw of [null, "", "{", "[]", "null", '{"version":2}', '{"version":1,"order":5}', '{"version":1,"order":[],"gridVersion":4,"grid":[[]]}']) {
      const l = parseLayout(raw);
      expect(l.gridVersion).toBe(GRID_VERSION);
      expect(validateGrid(l.grid ?? [])).toBe(true);
    }
  });

  it("drops unknown widgets and bad panel ids, caps the number of panels", () => {
    const panels = [
      { id: "custom-ok", kind: "widget", widget: "logs" },
      { id: "custom-bad", kind: "widget", widget: "nope" },
      { id: "custom-metric-widget", kind: "widget", widget: "cpu_gauge" },
      { id: "bad id", kind: "metric" },
      ...Array.from({ length: 300 }, (_, i) => ({ id: "custom-m" + i, kind: "metric", metrics: ["cpu"] })),
    ];
    const l = parseLayout(JSON.stringify({ version: 1, order: [], tiles: {}, panels, gridVersion: 4, grid: [] }));
    expect(l.panels.find((p) => p.id === "custom-ok")).toMatchObject({ widget: "logs" });
    expect(l.panels.some((p) => p.id === "custom-bad" || p.id === "custom-metric-widget" || p.id === "bad id")).toBe(false);
    expect(l.panels.length).toBeLessThanOrEqual(120);
  });
});

describe("workspaces", () => {
  it("migrates boards with their own enabled lists; enabled is empty afterwards", () => {
    const ws = parseWorkspace(
      JSON.stringify({
        version: 2,
        activeId: "b",
        telemtDc: true,
        boards: [
          { id: "a", name: "A", enabled: ["resources"], layout: v1() },
          { id: "b", name: "B", enabled: ["logs"], layout: v1() },
        ],
      }),
      [],
    );
    expect(ws.boards.every((b) => b.enabled.length === 0)).toBe(true);
    expect(ws.boards[0].layout.panels.map((p) => p.preset).sort()).toEqual(["cpu_gauge", "disk_gauge", "load_average", "nodes_availability", "ram_gauge", "swap_gauge"]);
    expect(ws.boards[1].layout.panels.map((p) => p.widget)).toEqual(["logs"]);
    expect(ws.activeId).toBe("b");
    expect(ws.boards[0].layout.grid!.length).toBe(6);
  });

  it("seeds the Telemt DC tile once for boards saved before it existed", () => {
    const old = parseWorkspace(JSON.stringify({ version: 2, activeId: "a", boards: [{ id: "a", name: "A", enabled: ["logs"], layout: v1() }] }), []);
    expect(old.boards[0].layout.panels.some((p) => p.widget === "telemt_dc")).toBe(true);
    const done = parseWorkspace(JSON.stringify({ version: 2, activeId: "a", telemtDc: true, boards: [{ id: "a", name: "A", enabled: ["logs"], layout: v1() }] }), []);
    expect(done.boards[0].layout.panels.some((p) => p.widget === "telemt_dc")).toBe(false);
  });

  it("migrates the pre-workspace single layout and is stable through save and load", () => {
    const first = parseWorkspace(JSON.stringify(v1()), atoms);
    const saved = JSON.stringify(saveActiveBoard(first, first.boards[0].layout));
    const second = parseWorkspace(saved, []);
    expect(second.boards[0].layout).toEqual(first.boards[0].layout);
    expect(second.boards[0].layout.panels.length).toBeGreaterThanOrEqual(atoms.length - 1);
  });

  it("keeps \"mine\" and survives corrupt input", () => {
    const mine = [{ id: "m1", name: "N", kind: "tile", bundle: { panels: [{ id: "custom-x", kind: "metric", metrics: ["cpu"] }], tiles: {}, rects: [{ id: "custom-x", x: 0, y: 0, w: 3, h: 4 }] } }, null, 5, { id: 1 }];
    const ws = parseWorkspace(JSON.stringify({ version: 2, activeId: "a", telemtDc: true, mine, boards: [{ id: "a", name: "A", layout: emptyLayout() }] }), []);
    expect(ws.mine).toHaveLength(1);
    for (const raw of [null, "", "{", "[]", '{"version":2,"boards":5}', '{"version":2,"boards":[null,{"id":1}]}']) {
      const w = parseWorkspace(raw, atoms);
      expect(w.boards.length).toBeGreaterThan(0);
      expect(validateGrid(w.boards[0].layout.grid ?? [])).toBe(true);
    }
  });
});

describe("dashboardTemplate", () => {
  const t = (k: string) => k;
  it("builds every template from catalog tiles, hole-free", () => {
    for (const kind of ["monitoring", "network", "minimal", "nodes", "balancers"]) {
      const b = dashboardTemplate(kind, t, { nodes: [{ id: 1, name: "n" }], balancers: [{ id: 2, name: "b" }] });
      expect(b.layout.gridVersion).toBe(GRID_VERSION);
      expect(b.layout.panels.length).toBeGreaterThan(0);
      expect(b.layout.grid!.length).toBe(b.layout.panels.length);
      expect(hasOverlap(b.layout.grid!)).toBe(false);
      expect(emptyCellCount(b.layout.grid!)).toBe(0);
      expect(b.enabled).toEqual([]);
    }
  });
});
