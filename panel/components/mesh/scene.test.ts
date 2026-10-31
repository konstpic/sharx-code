import { expect, it } from "vitest";
import { SCENES } from "../help/scenes";
it("explains direct-channel failure without taking healthy endpoints down", () => {
  const scene = SCENES.mesh;
  const actors = new Set(scene.actors.map((a) => a.id));
  for (const [a, b] of scene.links) {
    expect(actors.has(a)).toBe(true);
    expect(actors.has(b)).toBe(true);
  }
  for (const step of scene.steps) {
    for (const actor of [...step.show, ...(step.focus || [])])
      expect(actors.has(actor)).toBe(true);
    for (const flow of step.flows || []) {
      expect(step.show).toContain(flow.from);
      expect(step.show).toContain(flow.to);
      expect(
        step.brokenLinks?.some(
          ([a, b]) =>
            (a === flow.from && b === flow.to) ||
            (b === flow.from && a === flow.to),
        ),
      ).not.toBe(true);
    }
  }
  const failover = scene.steps.find((s) => s.brokenLinks?.length);
  expect(failover?.show).toEqual(
    expect.arrayContaining(["entry", "exit", "transit"]),
  );
  expect(failover?.down || []).toEqual([]);
  expect(failover?.flows?.map((f) => `${f.from}:${f.to}`)).toEqual([
    "entry:transit",
    "transit:exit",
  ]);
});
