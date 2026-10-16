import { describe, expect, it } from "vitest";
import {
  appendEvents,
  detectTransitions,
  dcKind,
  dcLabel,
  filterSources,
  flatten,
  formatAge,
  freshness,
  groupByDc,
  instanceKey,
  isUpToDown,
  isWorse,
  normalizePoll,
  parseHistory,
  pushRing,
  reasonInfo,
  recordPoll,
  rowSeverity,
  rttStats,
  serializeHistory,
  sortFlat,
  sparklinePath,
  summarize,
  viewModeFor,
  pickTelemtMode,
  EMPTY_FILTER,
  type DCRow,
  type DCState,
  type Instance,
  type Source,
} from "./telemtDc";

const row = (dc: number, state: DCState, extra: Partial<DCRow> = {}): DCRow => ({
  dc,
  state,
  endpoints: 2,
  availableEndpoints: 2,
  aliveWriters: 2,
  requiredWriters: 2,
  coveragePct: 100,
  load: 0,
  source: "me",
  ...extra,
});
const inst = (id: number, remark: string, dcs: DCRow[], extra: Partial<Instance> = {}): Instance => ({
  inboundId: id,
  tag: `tag-${id}`,
  remark,
  port: 443,
  available: true,
  meEnabled: true,
  dcs,
  updatedAt: 1,
  ...extra,
});
const src = (name: string, instances: Instance[], extra: Partial<Source> = {}): Source => ({ kind: "node", nodeId: 1, name, instances, ...extra });

describe("labels", () => {
  it("classifies dc ids", () => {
    expect(dcKind(2)).toBe("standard");
    expect(dcKind(-2)).toBe("media");
    expect(dcKind(203)).toBe("cdn");
    expect(dcKind(7)).toBe("other");
    expect(dcLabel(-4)).toBe("DC4 media");
    expect(dcLabel(203)).toBe("DC203 CDN");
  });
});

describe("pushRing / history", () => {
  it("keeps the newest N and never mutates", () => {
    const a = [1, 2, 3];
    const b = pushRing(a, 4, 3);
    expect(b).toEqual([2, 3, 4]);
    expect(a).toEqual([1, 2, 3]);
    expect(pushRing(undefined, 1, 3)).toEqual([1]);
  });
  it("records a sample per live dc and drops vanished series", () => {
    const s1 = [src("n1", [inst(1, "a", [row(1, "up", { rttMs: 40 }), row(2, "up")])])];
    let h = recordPoll({}, s1, 1000, 3);
    const k1 = flatten(s1)[0].key;
    expect(h[k1]).toEqual([{ t: 1000, rtt: 40, state: "up" }]);
    for (let t = 1; t <= 4; t++) h = recordPoll(h, s1, 1000 + t, 3);
    expect(h[k1]).toHaveLength(3);
    const s2 = [src("n1", [inst(1, "a", [row(2, "up")])])];
    h = recordPoll(h, s2, 2000, 3);
    expect(h[k1]).toBeUndefined();
    const s3 = [src("n1", [inst(1, "a", [], { available: false })])];
    expect(recordPoll(h, s3, 3000)).toEqual({});
  });
  it("round-trips through sessionStorage format and rejects garbage", () => {
    const h = { k: [{ t: 1, rtt: null, state: "up" as DCState }, { t: 2, rtt: 5, state: "down" as DCState }] };
    expect(parseHistory(serializeHistory(h))).toEqual(h);
    expect(parseHistory("not json")).toEqual({});
    expect(parseHistory('{"k":[{"t":"x"}]}')).toEqual({});
    expect(parseHistory(null)).toEqual({});
  });
});

describe("detectTransitions", () => {
  const mk = (st: DCState) => [src("n1", [inst(1, "a", [row(1, st)])])];
  it("first poll yields no transitions and stamps since", () => {
    const { next, transitions } = detectTransitions({}, mk("up"), 100);
    expect(transitions).toEqual([]);
    expect(Object.values(next).every((v) => v.since === 100)).toBe(true);
  });
  it("keeps since while the state is stable and resets it on change", () => {
    const a = detectTransitions({}, mk("up"), 100);
    const b = detectTransitions(a.next, mk("up"), 160);
    expect(Object.values(b.next).every((v) => v.since === 100)).toBe(true);
    const c = detectTransitions(b.next, mk("down"), 220);
    expect(c.transitions).toHaveLength(1);
    expect(c.transitions[0]).toMatchObject({ from: "up", to: "down", dc: 1, at: 220, instanceLabel: "a", sourceName: "n1" });
    expect(isUpToDown(c.transitions[0])).toBe(true);
    expect(isWorse(c.transitions[0])).toBe(true);
    const k = c.transitions[0].key;
    expect(c.next[k].since).toBe(220);
  });
  it("tracks instance availability without phantom DC transitions on recovery", () => {
    const up = [src("n1", [inst(1, "a", [row(1, "up")])])];
    const gone = [src("n1", [inst(1, "a", [], { available: false, reason: "unreachable" })])];
    const a = detectTransitions({}, up, 1);
    const b = detectTransitions(a.next, gone, 2);
    expect(b.transitions).toHaveLength(1);
    expect(b.transitions[0].dc).toBeNull();
    expect(b.transitions[0].to).toBe("down");
    const c = detectTransitions(b.next, up, 3);
    expect(c.transitions.map((t) => t.dc)).toEqual([null]); // only availability flips back; DC 1 is new again
    expect(c.transitions[0].to).toBe("up");
  });
  it("recovery is not 'worse' and unknown is not an alert", () => {
    expect(isWorse({ from: "down", to: "up" })).toBe(false);
    expect(isWorse({ from: "up", to: "unknown" })).toBe(false);
    expect(isUpToDown({ from: "unknown", to: "down" })).toBe(false);
  });
});

describe("appendEvents", () => {
  it("is newest-first and capped", () => {
    const t = (n: number) => ({ key: `k${n}`, at: n, from: "up" as DCState, to: "down" as DCState, dc: 1, sourceName: "s", instanceLabel: "i" });
    let log = appendEvents([], [t(1), t(2)], 3);
    expect(log.map((e) => e.at)).toEqual([2, 1]);
    log = appendEvents(log, [t(3), t(4)], 3);
    expect(log.map((e) => e.at)).toEqual([4, 3, 2]);
  });
});

describe("summarize", () => {
  it("counts states, sources and unavailable instances", () => {
    const sources: Source[] = [
      { kind: "panel", nodeId: 0, name: "panel", instances: [inst(1, "a", [row(1, "up"), row(2, "degraded")])] },
      src("n1", [inst(2, "b", [row(1, "down")]), inst(3, "c", [], { available: false })]),
      src("n2", [], { nodeId: 2, error: "boom" }),
    ];
    const s = summarize(sources);
    expect(s).toMatchObject({ up: 1, degraded: 1, down: 1, unknown: 0, totalDcs: 3, instances: 3, unavailableInstances: 1, sourcesWithErrors: 1, panelSources: 1, nodeSources: 2, overall: "down" });
    expect(s.bySource.find((x) => x.name === "n1")).toMatchObject({ down: 1, unavailable: 1 });
  });
  it("overall: ok / degraded / empty", () => {
    expect(summarize([]).overall).toBe("empty");
    expect(summarize([src("n", [inst(1, "a", [row(1, "up")])])]).overall).toBe("ok");
    expect(summarize([src("n", [inst(1, "a", [row(1, "up")]), inst(2, "b", [], { available: false })])]).overall).toBe("degraded");
    expect(summarize([src("n", [], { error: "x" })]).overall).toBe("degraded");
  });
});

describe("severity sorting", () => {
  it("orders by state then coverage", () => {
    expect(rowSeverity(row(1, "down"))).toBeGreaterThan(rowSeverity(row(1, "degraded")));
    expect(rowSeverity(row(1, "degraded", { coveragePct: 10 }))).toBeGreaterThan(rowSeverity(row(1, "degraded", { coveragePct: 90 })));
    expect(rowSeverity(row(1, "degraded"))).toBeGreaterThan(rowSeverity(row(1, "up")));
  });
  const sources = [src("n", [inst(1, "a", [row(1, "up", { rttMs: 30, load: 5 }), row(2, "down", { rttMs: 80 }), row(3, "degraded", { load: 9 })])])];
  it("sortFlat by severity / rtt / load", () => {
    const f = flatten(sources);
    expect(sortFlat(f, "severity").map((r) => r.row.dc)).toEqual([2, 3, 1]);
    expect(sortFlat(f, "rtt").map((r) => r.row.dc)).toEqual([2, 1, 3]);
    expect(sortFlat(f, "load").map((r) => r.row.dc)).toEqual([3, 1, 2]);
    expect(sortFlat(f, "dc").map((r) => r.row.dc)).toEqual([1, 2, 3]);
  });
});

describe("filter & group", () => {
  const sources: Source[] = [
    src("alpha", [inst(1, "Main", [row(1, "up")]), inst(2, "Broken", [row(1, "down")])], { nodeId: 1 }),
    src("beta", [inst(3, "Other", [row(1, "up")])], { nodeId: 2 }),
  ];
  it("problems only / source / search", () => {
    expect(filterSources(sources, { ...EMPTY_FILTER, problemsOnly: true }).flatMap((s) => s.instances.map((i) => i.remark))).toEqual(["Broken"]);
    expect(filterSources(sources, { ...EMPTY_FILTER, source: "node-2" }).map((s) => s.name)).toEqual(["beta"]);
    expect(filterSources(sources, { ...EMPTY_FILTER, search: "alp" }).flatMap((s) => s.instances.map((i) => i.remark))).toEqual(["Main", "Broken"]);
    expect(filterSources(sources, { ...EMPTY_FILTER, search: "tag-3" }).flatMap((s) => s.instances.map((i) => i.remark))).toEqual(["Other"]);
  });
  it("keeps errored sources unless searching", () => {
    const withErr = [...sources, src("gone", [], { nodeId: 9, error: "x" })];
    expect(filterSources(withErr, EMPTY_FILTER).map((s) => s.name)).toContain("gone");
    expect(filterSources(withErr, { ...EMPTY_FILTER, search: "main" }).map((s) => s.name)).not.toContain("gone");
  });
  it("groupByDc uses the worst state", () => {
    const g = groupByDc(flatten(sources));
    expect(g).toHaveLength(1);
    expect(g[0].state).toBe("down");
    expect(g[0].rows).toHaveLength(3);
  });
  it("instanceKey is stable", () => {
    expect(instanceKey("node-1", { inboundId: 4, tag: "t" })).toBe("node-1/4-t");
  });
});

describe("sparkline & stats", () => {
  it("builds gaps for nulls and handles flat/empty series", () => {
    expect(sparklinePath([], 100, 20)).toBe("");
    expect(sparklinePath([null, null], 100, 20)).toBe("");
    const d = sparklinePath([10, null, 20, 30], 100, 20);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(1);
    expect(sparklinePath([5, 5, 5], 100, 20)).toMatch(/^M2\.0 10\.0L/);
    expect(sparklinePath([7], 100, 20)).toMatch(/^M.*L/);
  });
  it("rttStats ignores nulls", () => {
    expect(rttStats([null, null])).toBeNull();
    expect(rttStats([10, null, 30])).toEqual({ min: 10, max: 30, avg: 20, last: 30, count: 2 });
  });
});

describe("time & settings", () => {
  it("formatAge", () => {
    expect(formatAge(5)).toBe("5s");
    expect(formatAge(125)).toBe("2m 5s");
    expect(formatAge(3 * 3600 + 120)).toBe("3h 2m");
    expect(formatAge(-3)).toBe("0s");
  });
  it("freshness scales with the poll interval", () => {
    expect(freshness(10, 15)).toBe("fresh");
    expect(freshness(40, 15)).toBe("aging");
    expect(freshness(200, 15)).toBe("stale");
    expect(freshness(40, 60)).toBe("fresh");
  });
  it("normalizePoll accepts only the allowed intervals", () => {
    expect(normalizePoll("30")).toBe(30);
    expect(normalizePoll(5)).toBe(5);
    expect(normalizePoll("7")).toBe(15);
    expect(normalizePoll(null)).toBe(15);
  });
  it("viewModeFor", () => {
    expect(viewModeFor(300, 400)).toBe("compact");
    expect(viewModeFor(800, 100)).toBe("compact");
    expect(viewModeFor(500, 400)).toBe("medium");
    expect(viewModeFor(900, 200)).toBe("large");
    expect(viewModeFor(900, 129)).toBe("compact");
    expect(viewModeFor(900, 500)).toBe("large");
    expect(viewModeFor(900, 0)).toBe("large");
  });
});

describe("reasonInfo", () => {
  it("maps backend codes", () => {
    expect(reasonInfo("api_disabled").code).toBe("api_disabled");
    expect(reasonInfo("feature_disabled").code).toBe("feature_disabled");
    expect(reasonInfo("source_unavailable").code).toBe("source_unavailable");
    expect(reasonInfo(undefined).code).toBe("unreachable");
    expect(reasonInfo("weird").known).toBe(false);
  });
});

import { buildGroups } from "./telemtDc";

describe("buildGroups", () => {
  const sources: Source[] = [
    src("n1", [inst(1, "ok", [row(1, "up"), row(2, "up")]), inst(2, "bad", [row(1, "down"), row(2, "up")]), inst(3, "off", [], { available: false })]),
  ];
  it("by node orders instances by severity and keeps unavailable ones", () => {
    const g = buildGroups(sources, "node", "severity");
    expect(g.map((x) => x.inst?.remark)).toEqual(["off", "bad", "ok"]);
    expect(g[0].state).toBe("down");
    expect(g[0].rows).toEqual([]);
    expect(g[1].rows[0].row.state).toBe("down");
  });
  it("by dc merges instances with the worst state", () => {
    const g = buildGroups(sources, "dc", "severity");
    expect(g.map((x) => x.dc)).toEqual([1, 2]);
    expect(g[0].state).toBe("down");
    expect(g[1].state).toBe("up");
    expect(g[0].rows).toHaveLength(2);
  });
});

describe("pickTelemtMode", () => {
  it("thresholds", () => {
    expect(pickTelemtMode(400, 600)).toBe("compact");
    expect(pickTelemtMode(900, 220)).toBe("compact");
    expect(pickTelemtMode(1553, 156)).toBe("compact");
    expect(pickTelemtMode(420, 230)).toBe("medium");
    expect(pickTelemtMode(1553, 324)).toBe("medium");
    expect(pickTelemtMode(700, 400)).toBe("medium");
    expect(pickTelemtMode(900, 419)).toBe("medium");
    expect(pickTelemtMode(800, 520)).toBe("large");
    expect(pickTelemtMode(1100, 616)).toBe("large");
    expect(pickTelemtMode(1553, 500)).toBe("wide");
    expect(pickTelemtMode(1494, 618)).toBe("wide");
  });
  it("unmeasured box keeps previous or medium", () => {
    expect(pickTelemtMode(0, 0)).toBe("medium");
    expect(pickTelemtMode(0, 500, "large")).toBe("large");
  });
  it("hysteresis", () => {
    expect(pickTelemtMode(410, 300, "medium")).toBe("medium");
    expect(pickTelemtMode(410, 300, "compact")).toBe("compact");
    expect(pickTelemtMode(900, 410, "large")).toBe("large");
    expect(pickTelemtMode(900, 410, "medium")).toBe("medium");
    expect(pickTelemtMode(1090, 500, "wide")).toBe("wide");
    expect(pickTelemtMode(1090, 500, "large")).toBe("large");
    expect(pickTelemtMode(900, 380, "large")).toBe("medium");
    expect(pickTelemtMode(900, 215, "medium")).toBe("medium");
    expect(pickTelemtMode(900, 215, "compact")).toBe("compact");
  });
});
