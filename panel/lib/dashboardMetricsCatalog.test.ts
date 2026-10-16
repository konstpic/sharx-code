import {describe, expect, it} from "vitest";
import {dashboardMetrics, formatMetric, metricLevel, type DashboardMetric} from "./dashboardMetrics";
import {balancerMetricId, entityMetrics, nodeMetricId, parseEntityMetricId, unavailableMetrics} from "./dashboardMetricsCatalog";
import {entityTemplate} from "./dashboardMetricsTemplates";
import type {BalancerRow, DashboardMetricsPayload, NodeRow, Stat} from "./dashboardMetricsNodes";

const t = (k: string) => k;
const stat = (avg: number | null): Stat => ({n: avg == null ? 0 : 1, sum: avg ?? 0, avg, min: avg, max: avg});
const node = (o: Partial<NodeRow> = {}): NodeRow => ({id: 5, name: "Frankfurt", enable: true, status: "online", online: true, xrayState: "running", telemtState: "stopped", latencyMs: 42, lastCheckAge: 3, cpu: 55, mem: 40, disk: 20, memUsed: 1, memTotal: 2, netBps: 10, trafficUp: 10, trafficDown: 30, trafficAllTime: 100, trafficLimit: 0, trafficLimitPct: null, upRate: 1, downRate: 2, bandwidthMbps: 0, linkLoadPct: null, inbounds: 2, clients: 7, onlineClients: 3, ...o});
const bal = (o: Partial<BalancerRow> = {}): BalancerRow => ({id: 2, name: "LB-1", enable: true, status: "online", online: true, engine: "haproxy", running: true, configDrift: false, hasError: false, latencyMs: 9, lastCheckAge: 1, lastApplyAge: 100, pools: 2, poolsListening: 2, members: 4, membersUp: 3, membersDown: 1, healthyPct: 75, sessions: 12, connections: 99, connectionErrors: 1, timeouts: 0, failovers: 2, bytesIn: 1, bytesOut: 2, rxRate: 5, txRate: 6, rttAvg: 20, rttMax: 40, conntrackPct: 10, ...o});
const payload = (o: Partial<DashboardMetricsPayload> = {}): DashboardMetricsPayload => ({at: 1000, nodes: [node()], balancers: [bal()], ...o});
const byId = (list: DashboardMetric[]) => new Map(list.map((m) => [m.id, m]));

describe("entityMetrics", () => {
  it("creates stable per-node and per-balancer ids with labels and groups", () => {
    const m = byId(entityMetrics(payload(), t));
    expect(m.get("node:5:cpu")).toMatchObject({value: 55, unit: "percent", label: "Frankfurt · pages.builder.metric.cpu", group: "pages.builder.groupNodeEntity"});
    expect(m.get("node:5:traffic.total")?.value).toBe(40);
    expect(m.get("balancer:2:connections")?.value).toBe(12);
    expect(m.get("balancer:2:pools.unhealthy")?.value).toBe(1);
    expect(nodeMetricId(5, "cpu")).toBe("node:5:cpu");
    expect(balancerMetricId(2, "rate.in")).toBe("balancer:2:rate.in");
    expect(parseEntityMetricId("node:5:traffic.down")).toEqual({kind: "node", entityId: 5, key: "traffic.down"});
    expect(parseEntityMetricId("cpu")).toBeNull();
  });
  it("offline nodes keep null live values and map status to states", () => {
    const m = byId(entityMetrics(payload({nodes: [node({online: false, status: "offline", cpu: null})]}), t));
    expect(m.get("node:5:cpu")?.value).toBeNull();
    expect(m.get("node:5:status")?.value).toBe(0);
    expect(formatMetric(m.get("node:5:status")!)).toBe("pages.builder.metric.stateOffline");
    expect(formatMetric(m.get("node:5:cpu")!)).toBe("—");
  });
  it("aggregates and panel counters come from the payload; missing sections yield nothing", () => {
    const agg = {total: 2, enabled: 2, online: 1, offline: 1, stale: 0, overLimit: 0, cpu: stat(30), mem: stat(null), disk: stat(null), latency: stat(null), netBps: stat(null), upRate: stat(1), downRate: stat(2), trafficUp: 1, trafficDown: 2, trafficAllTime: 3, inbounds: 1, clients: 2, onlineClients: 4};
    const m = byId(entityMetrics(payload({nodes: [], balancers: [], nodesAgg: agg, panel: {clients: 3, clientsEnabled: 2, clientsExpired: 1, inbounds: 1, inboundsEnabled: 1, hosts: 0, bundles: 0, trafficUp: 1, trafficDown: 1, upRate: null, downRate: null}}), t));
    expect(m.get("nodes.cpu.avg")?.value).toBe(30);
    expect(m.get("nodes.mem.avg")?.value).toBeNull();
    expect(m.get("nodes.rate.up")?.value).toBe(1);
    expect(m.get("nodes.clients.online")?.value).toBe(4);
    expect(m.get("stats.clients.expired")?.value).toBe(1);
    expect(m.has("audit.failed24h")).toBe(false); // no audit:read -> counter absent
    expect(m.has("balancers.connections")).toBe(false);
    expect(entityMetrics(null, t)).toEqual([]);
  });
  it("ids are unique and all entity metrics carry a unit", () => {
    const list = entityMetrics(payload(), t);
    expect(new Set(list.map((m) => m.id)).size).toBe(list.length);
    expect(list.length).toBeGreaterThan(40);
  });
});

describe("unavailable placeholders", () => {
  it("flags only dynamic ids that nobody provides", () => {
    const have = ["cpu", "node:5:cpu"];
    const out = unavailableMetrics(["cpu", "node:5:cpu", "node:9:cpu", "balancer:3:status", "nodes.cpu.avg", "client.weird"], have, t);
    expect(out.map((m) => m.id).sort()).toEqual(["balancer:3:status", "node:9:cpu", "nodes.cpu.avg"]);
    expect(out.every((m) => m.unavailable && m.value === null)).toBe(true);
    expect(formatMetric(out[0])).toBe("—");
  });
});

describe("existing metrics stay stable", () => {
  const st = {cpu: 12, cpuCores: 2, mem: {current: 1, total: 2}, disk: {current: 1, total: 2}, swap: {current: 0, total: 0}, loads: [1, 2, 3], netIO: {up: 1, down: 2}, netTraffic: {sent: 1, recv: 2}, tcpCount: 1, udpCount: 1, uptime: 1, appStats: {threads: 1, mem: 1, uptime: 1}, nodes: {online: 1, total: 2}, nodesTelemt: {total: 2, running: 1, stopped: 1, unknown: 0}, database: {size: 1, tables: 1, totalRows: 1, openConns: 1, idleConns: 1, maxOpenConns: 5, maxIdleConns: 2}};
  it("keeps every previous id and adds thresholds metadata", () => {
    const m = byId(dashboardMetrics(st, t));
    for (const id of ["cpu", "cpu.cores", "mem.percent", "disk.used", "load.15", "network.up", "network.tcp", "nodes.total", "nodes.online", "nodes.availability", "nodes.xray.running", "nodes.xray.error", "nodes.telemt.running", "db.size", "db.idle", "os.uptime", "panel.memory", "panel.threads", "panel.uptime"]) expect(m.has(id), id).toBe(true);
    expect(m.get("cpu")?.thresholds).toEqual({warn: 70, crit: 90});
    expect(m.get("telemt.running")?.value).toBe(1);
    expect(m.get("nodes.online")?.group).toBe("pages.builder.groupNodesAgg");
  });
  it("evaluates thresholds, including inverted ones", () => {
    expect(metricLevel({value: 95, thresholds: {warn: 70, crit: 90}})).toBe("crit");
    expect(metricLevel({value: 50, thresholds: {warn: 70, crit: 90}})).toBe("ok");
    expect(metricLevel({value: 60, thresholds: {warn: 99, crit: 50, invert: true}})).toBe("warn");
    expect(metricLevel({value: null, thresholds: {warn: 1, crit: 2}})).toBeNull();
  });
  it("formats ms", () => {
    const base = {id: "x", label: "", group: "", unit: "ms" as const};
    expect(formatMetric({...base, value: 42.4})).toBe("42 ms");
    expect(formatMetric({...base, value: 12500})).toMatch(/12\.5 s|12,5 s/);
  });
});

describe("entity templates", () => {
  const tiles = (tpl: ReturnType<typeof entityTemplate>) => tpl.rows.flatMap((r) => r.tiles);
  it("builds one row of six atomic tiles per node, titled \"name · metric\", capped by the tile limit", () => {
    const nodes = Array.from({length: 40}, (_, i) => ({id: i + 1, name: "n" + i}));
    const tpl = entityTemplate("nodes", t, {nodes});
    expect(tiles(tpl).length).toBeLessThanOrEqual(120);
    const first = tpl.rows.find((r) => r.tiles[0].metrics[0] === "node:1:status")!;
    expect(first.tiles.map((x) => x.metrics[0])).toEqual(["node:1:status", "node:1:cpu", "node:1:mem", "node:1:disk", "node:1:clients.online", "node:1:latency"]);
    expect(first.tiles[1].title).toBe("n0 · pages.builder.metric.cpu");
    expect(tpl.rows.every((r) => r.tiles.reduce((n, x) => n + x.w, 0) === 12)).toBe(true);
  });
  it("falls back to aggregates without a node list", () => {
    const tpl = entityTemplate("balancers", t);
    expect(tiles(tpl).map((p) => p.metrics[0])).toContain("balancers.connections");
  });
});
