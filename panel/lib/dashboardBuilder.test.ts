import { describe, expect, it } from "vitest";
import { defaultLayout, layoutConstraints, parseLayout, parseWorkspace } from "./dashboardBuilder";
import { DASHBOARD_WIDGET_ORDER } from "./dashboardLayout";
import { validateGrid } from "./dashboardGrid";

describe("parseLayout: grid migration", () => {
  it("converts a legacy layout (order + tiles) and stamps gridVersion", () => {
    const raw = JSON.stringify({
      version: 1,
      order: ["net_speed", "resources", ...DASHBOARD_WIDGET_ORDER.filter((x) => x !== "net_speed" && x !== "resources")],
      tiles: { net_speed: { width: 4, height: 5, view: "default", title: "Speed" } },
      panels: [],
    });
    const l = parseLayout(raw);
    expect(l.gridVersion).toBe(1);
    const g = l.grid!;
    expect(g.find((i) => i.id === "net_speed")).toMatchObject({ x: 0, y: 0, w: 4, h: 7 });
    expect(validateGrid(g, 12, layoutConstraints(l))).toBe(true);
    expect(l.tiles.net_speed.title).toBe("Speed");
    expect(l.order[0]).toBe("net_speed");
  });

  it("keeps custom panels and their sizes", () => {
    const raw = JSON.stringify({
      version: 1,
      order: ["custom-a", "logs"],
      tiles: { "custom-a": { width: 3, height: 3, view: "stat" } },
      panels: [{ id: "custom-a", title: "A", kind: "metric", metrics: ["cpu"] }],
    });
    const l = parseLayout(raw);
    expect(l.panels).toHaveLength(1);
    expect(l.grid!.find((i) => i.id === "custom-a")).toMatchObject({ w: 3, h: 4 });
  });

  it("round-trips a saved grid layout and fills in tiles missing from it", () => {
    const first = parseLayout(JSON.stringify({ version: 1, order: [...DASHBOARD_WIDGET_ORDER], tiles: {}, panels: [] }));
    const moved = { ...first, grid: first.grid!.map((i) => (i.id === "logs" ? { ...i, x: 0, y: 40 } : i)).filter((i) => i.id !== "uptime") };
    const back = parseLayout(JSON.stringify(moved));
    expect(back.grid!.find((i) => i.id === "logs")).toMatchObject({ x: 0, y: 40 });
    expect(back.grid!.some((i) => i.id === "uptime")).toBe(false);
  });

  it("ignores a broken grid and falls back to the legacy conversion", () => {
    for (const grid of ["nope", [], [null, 1], [{ id: "logs", x: "a" }], { a: 1 }]) {
      const l = parseLayout(JSON.stringify({ version: 1, gridVersion: 1, order: [...DASHBOARD_WIDGET_ORDER], tiles: {}, panels: [], grid }));
      expect(l.grid!.length).toBe(DASHBOARD_WIDGET_ORDER.length);
      expect(validateGrid(l.grid!)).toBe(true);
    }
    const unmarked = parseLayout(JSON.stringify({ version: 1, order: [...DASHBOARD_WIDGET_ORDER], tiles: {}, panels: [], grid: [{ id: "logs", x: 5, y: 5, w: 2, h: 2 }] }));
    expect(unmarked.grid!.find((i) => i.id === "logs")).not.toMatchObject({ x: 5, y: 5 });
    expect(validateGrid(unmarked.grid!)).toBe(true);
  });

  it("never throws on garbage and returns the default layout", () => {
    for (const raw of [null, "", "{", "[]", "null", '{"version":2}', '{"version":1,"order":5}', '{"version":1,"order":[],"gridVersion":1,"grid":[[]]}']) {
      const l = parseLayout(raw);
      expect(l.gridVersion).toBe(1);
      expect(validateGrid(l.grid ?? [])).toBe(true);
    }
    expect(defaultLayout().grid!.length).toBe(DASHBOARD_WIDGET_ORDER.length);
  });

  it("workspace boards carry their own grids", () => {
    const ws = parseWorkspace(JSON.stringify({ version: 2, activeId: "b", boards: [{ id: "b", name: "B", enabled: ["logs"], layout: { version: 1, order: ["logs"], tiles: {}, panels: [] } }] }), []);
    expect(ws.boards[0].layout.gridVersion).toBe(1);
    expect(ws.boards[0].layout.grid!.length).toBeGreaterThan(0);
  });
});
