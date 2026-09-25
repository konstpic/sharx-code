import { describe, expect, it } from "vitest";
import { activeStepIndexes, nextPosition, readScene, stepDuration } from "./scene";

describe("readScene extended props", () => {
  it("applies defaults and clamps", () => {
    const sc = readScene({ speed: 99, flowDots: 20, actorSize: 5, transition: "nope", loop: false, tones: { rose: "#f00", green: "url(x)" } });
    expect(sc).toMatchObject({ speed: 4, flowDots: 5, actorSize: 28, transition: "scale", loopMode: "once", loop: false, start: "load", lineStyle: "dashed", actorShape: "rounded" });
    expect(sc.tones).toEqual({ rose: "#f00" });
  });
  it("keeps per-step ms and conditions", () => {
    const sc = readScene({ steps: [{ caption: "a", show: [], ms: 5000, condition: "user.isActive" }, { caption: "b", show: [], ms: 10, condition: "  " }] });
    expect(sc.steps[0]).toMatchObject({ ms: 5000, condition: "user.isActive" });
    expect(sc.steps[1].ms).toBeUndefined();
    expect(sc.steps[1].condition).toBeUndefined();
  });
});

describe("scene helpers", () => {
  it("skips steps whose condition is false", () => {
    const steps = [{ caption: "", show: [] }, { caption: "", show: [], condition: "x" }, { caption: "", show: [], condition: "y" }];
    expect(activeStepIndexes(steps, (c) => c === "y")).toEqual([0, 2]);
  });
  it("step duration uses the override and the speed", () => {
    expect(stepDuration({ caption: "", show: [], ms: 4000 }, 2600, 2)).toBe(2000);
    expect(stepDuration(undefined, 2600, 1)).toBe(2600);
  });
  it("advances in loop, once and ping-pong modes", () => {
    expect(nextPosition(0, 1, 3, "loop")).toEqual({ pos: 1, dir: 1, done: false });
    expect(nextPosition(2, 1, 3, "loop")).toEqual({ pos: 0, dir: 1, done: false });
    expect(nextPosition(2, 1, 3, "once")).toEqual({ pos: 2, dir: 1, done: true });
    expect(nextPosition(2, 1, 3, "ping-pong")).toEqual({ pos: 1, dir: -1, done: false });
    expect(nextPosition(0, -1, 3, "ping-pong")).toEqual({ pos: 1, dir: 1, done: false });
    expect(nextPosition(0, 1, 1, "loop").pos).toBe(0);
  });
});
