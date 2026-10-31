import { describe, it, expect } from "vitest";
import {
  freshAgent,
  meshEdges,
  meshTransits,
  linkMetric,
  radialLayout,
  type MeshView,
} from "./model";
const inventory = {
  n1: { host: "1", overlay: "10.0.0.1", role: "entry", rw_node: "1" },
  n2: { host: "2", overlay: "10.0.0.2", role: "exit", rw_node: "2" },
  n3: { host: "3", overlay: "10.0.0.3", role: "exit", rw_node: "3" },
};
function view(): MeshView {
  return {
    snapshot_at: 100,
    enrolled: inventory,
    topology: {
      nodes: [
        { name: "n1", agent_age: 1 },
        { name: "n2", agent_age: 2 },
        { name: "n3", agent_age: 3 },
      ],
    },
    overlay: {
      obs: {
        n1: { n2: { ok: true, rtt: 0, loss: 0 } },
        n2: { n1: { ok: true, rtt: 5, loss: 0 } },
      },
      route: { n1: { n2: "n3" } },
    },
  };
}
describe("mesh map observation semantics", () => {
  it("requires both directions and fresh reports; missing is unknown", () => {
    const v = view();
    expect(meshEdges(v, 100).map((e) => e.state)).toEqual([
      "healthy",
      "unknown",
      "unknown",
    ]);
    v.overlay!.obs.n2.n1.ok = false;
    expect(meshEdges(v, 100)[0].state).toBe("asymmetric");
    v.overlay!.obs.n1.n2.ok = false;
    expect(meshEdges(v, 100)[0].state).toBe("down");
    expect(meshEdges(v, 160)[0].state).toBe("unknown");
  });
  it("ages reports even when polling stops", () => {
    expect(freshAgent(view(), "n1", 158)).toBe(true);
    expect(freshAgent(view(), "n1", 159)).toBe(false);
  });
  it("does not invent zero metrics", () => {
    expect(linkMetric()).toBe("—");
    expect(linkMetric({ ok: true })).toBe("— · —");
    expect(linkMetric({ ok: true, rtt: 0, loss: 0 })).toBe("0.0 ms · 0%");
  });
  it("formats RTT using the selected language and unit", () => {
    expect(linkMetric({ ok: true, rtt: 1.25, loss: 0.1 }, "мс", "ru")).toBe(
      "1,3 мс · 10%",
    );
  });
  it("shows only real intermediate nodes, ignoring direct and stale routes", () => {
    const v = view();
    expect(meshTransits(v, 100)).toEqual([{ from: "n1", to: "n2", via: "n3" }]);
    v.overlay!.route.n1.n2 = "n2";
    expect(meshTransits(v, 100)).toEqual([]);
    v.overlay!.route.n1.n2 = "missing";
    expect(meshTransits(v, 100)).toEqual([]);
    expect(meshTransits(view(), 170)).toEqual([]);
  });
});

it("places exits on a radial arc with stable coordinates and centered singletons", () => {
  const layout = radialLayout(inventory, Object.keys(inventory));
  expect(layout.positions.n1.x).toBe(14);
  expect(layout.positions.n2.y).toBeLessThan(layout.positions.n1.y);
  expect(layout.positions.n3.y).toBeGreaterThan(layout.positions.n1.y);
  expect(layout.positions.n2.x).toBeCloseTo(layout.positions.n3.x);
  expect(radialLayout(inventory, ["n1"]).positions.n1).toEqual({
    x: 50,
    y: 240,
  });
  expect(radialLayout(inventory, []).positions).toEqual({});
  const allExits = radialLayout(
    { ...inventory, n1: { ...inventory.n1, role: "exit" } },
    Object.keys(inventory),
  );
  expect(
    new Set(Object.values(allExits.positions).map((p) => `${p.x}:${p.y}`)).size,
  ).toBe(3);
  expect(
    Object.values(allExits.positions).every(
      (p) => p.x >= 10 && p.x <= 90 && p.y >= 70 && p.y <= allExits.height - 70,
    ),
  ).toBe(true);
});

it("keeps nine role-grouped nodes compact and separated", () => {
  const nodes = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `n${i + 1}`,
      { ...inventory.n1, role: i < 2 ? "entry" : "exit" },
    ]),
  );
  const layout = radialLayout(nodes, Object.keys(nodes));
  expect(layout.height).toBeLessThanOrEqual(600);
  const points = Object.values(layout.positions);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      expect(
        Math.hypot((points[i].x - points[j].x) * 10, points[i].y - points[j].y),
      ).toBeGreaterThan(70);
  const large = Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [
      `n${i + 1}`,
      { ...inventory.n1, role: i < 2 ? "entry" : "exit" },
    ]),
  );
  const ring = Object.values(radialLayout(large, Object.keys(large)).positions);
  for (let i = 0; i < ring.length; i++)
    for (let j = i + 1; j < ring.length; j++)
      expect(
        Math.hypot((ring[i].x - ring[j].x) * 10, ring[i].y - ring[j].y),
      ).toBeGreaterThan(70);
});
