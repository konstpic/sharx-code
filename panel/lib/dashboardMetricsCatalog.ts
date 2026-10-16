// Builds the node / balancer / panel-stat dashboard metrics from the dashboardMetrics endpoint payload.
//
// Id scheme (stable across reloads, saved dashboards reference these):
//   aggregates      nodes.cpu.avg, nodes.traffic.up, balancers.connections, balancers.pools.unhealthy ...
//   per node        node:<id>:cpu, node:<id>:traffic.down ...        (label "<Node name> · CPU", group "Node: <name>")
//   per balancer    balancer:<id>:connections ...                    (group "Balancer: <name>")
//   panel counters  stats.clients.total, traffic.rate.down, audit.failed24h
// A saved id whose node/balancer no longer exists is turned into an "unavailable" placeholder by `unavailableMetrics`.
import type {DashboardMetric} from "./dashboardMetrics";
import {BALANCER_AGG_DEFS, BALANCER_DEFS, NODE_AGG_DEFS, NODE_DEFS, PANEL_DEFS, type Def, type DashboardMetricsPayload} from "./dashboardMetricsNodes";

type T = (key: string) => string;
const K = "pages.builder.metric.";
const clean = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) ? v : null);

function states(def: Def<never>, t: T): Record<number, string> | undefined {
  if (!def.states) return undefined;
  return Object.fromEntries(Object.entries(def.states).map(([value, key]) => [Number(value), t(K + key)]));
}

function build<S>(def: Def<S>, src: S, id: string, label: string, group: string, t: T, at: number | undefined, entity?: DashboardMetric["entity"]): DashboardMetric {
  const m: DashboardMetric = {id, label, group, value: clean(def.get(src)), unit: def.unit, updatedAt: at};
  if (def.max != null) m.max = def.max;
  if (def.th) m.thresholds = def.th;
  const st = states(def as unknown as Def<never>, t);
  if (st) m.states = st;
  if (entity) m.entity = entity;
  return m;
}

export const nodeMetricId = (id: number, key: string) => `node:${id}:${key}`;
export const balancerMetricId = (id: number, key: string) => `balancer:${id}:${key}`;

/** `node:12:cpu` -> {kind:'node', entityId:12, key:'cpu'}; null for any other id. */
export function parseEntityMetricId(id: string): {kind: "node" | "balancer"; entityId: number; key: string} | null {
  const m = /^(node|balancer):(\d+):(.+)$/.exec(id);
  return m ? {kind: m[1] as "node" | "balancer", entityId: Number(m[2]), key: m[3]} : null;
}

/** All metrics the payload can provide. Entities the viewer may not see are simply absent from the payload. */
export function entityMetrics(data: DashboardMetricsPayload | null | undefined, t: T): DashboardMetric[] {
  if (!data) return [];
  const out: DashboardMetric[] = [];
  const at = data.at || undefined;
  const nodeGroup = t("pages.builder.groupNodeEntity");
  const balGroup = t("pages.builder.groupBalancerEntity");
  if (data.nodesAgg) {
    const g = t("pages.builder.groupNodesAgg");
    for (const d of NODE_AGG_DEFS) out.push(build(d, data.nodesAgg, "nodes." + d.key, t(K + d.label), g, t, at));
  }
  for (const n of data.nodes ?? []) {
    const group = nodeGroup.replace("%name%", n.name);
    for (const d of NODE_DEFS) out.push(build(d, n, nodeMetricId(n.id, d.key), `${n.name} · ${t(K + d.label)}`, group, t, at, {kind: "node", id: n.id}));
  }
  if (data.balancersAgg) {
    const g = t("pages.builder.groupBalancersAgg");
    for (const d of BALANCER_AGG_DEFS) out.push(build(d, data.balancersAgg, "balancers." + d.key, t(K + d.label), g, t, at));
  }
  for (const b of data.balancers ?? []) {
    const group = balGroup.replace("%name%", b.name);
    for (const d of BALANCER_DEFS) out.push(build(d, b, balancerMetricId(b.id, d.key), `${b.name} · ${t(K + d.label)}`, group, t, at, {kind: "balancer", id: b.id}));
  }
  if (data.panel) {
    for (const d of PANEL_DEFS) {
      if (d.get(data.panel) === undefined) continue; // e.g. audit counters without audit:read
      out.push(build(d, data.panel, d.id, t(K + d.label), t("pages.builder.group" + d.group), t, at));
    }
  }
  return out;
}

/** Placeholders for referenced ids nobody provides (deleted node, no permission, endpoint not loaded yet): value null, flagged unavailable. */
export function unavailableMetrics(referenced: Iterable<string>, available: Iterable<string>, t: T): DashboardMetric[] {
  const have = new Set(available);
  const out: DashboardMetric[] = [];
  const dynamic = /^(node:\d+:|balancer:\d+:|nodes\.|balancers\.|stats\.|traffic\.|audit\.|telemt\.)/;
  for (const id of new Set(referenced)) {
    if (have.has(id) || !dynamic.test(id)) continue;
    const e = parseEntityMetricId(id);
    const kindLabel = e ? t(e.kind === "node" ? "pages.builder.metric.entityNode" : "pages.builder.metric.entityBalancer") : "";
    const base = e ? `${kindLabel} #${e.entityId} · ${e.key}` : id;
    out.push({id, label: `${base} (${t("pages.builder.metric.unavailable")})`, group: t("pages.builder.groupUnavailable"), value: null, unit: "count", unavailable: true});
  }
  return out;
}
