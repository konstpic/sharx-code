// Metric definitions for nodes and balancers: the payload of GET /panel/api/server/dashboardMetrics and the tables that
// turn it into dashboard metrics (per entity and aggregated). Pure data, no React.
import type {Thresholds} from "./dashboardMetrics";

export type MetricUnit = "percent" | "bytes" | "speed" | "seconds" | "count" | "load" | "ms" | "status";
type Num = number | null;

export type NodeRow = {
  id: number; name: string; enable: boolean; status: string; online: boolean; xrayState: string; telemtState: string; amneziawgState?: string;
  latencyMs: Num; lastCheckAge: Num; cpu: Num; mem: Num; disk: Num; memUsed: Num; memTotal: Num; netBps: Num;
  trafficUp: number; trafficDown: number; trafficAllTime: number; trafficLimit: number; trafficLimitPct: Num; upRate: Num; downRate: Num;
  bandwidthMbps: number; linkLoadPct: Num; inbounds: number; clients: number; onlineClients: number;
};
export type BalancerRow = {
  id: number; name: string; enable: boolean; status: string; online: boolean; engine: string; running: boolean | null;
  configDrift: boolean; hasError: boolean; latencyMs: Num; lastCheckAge: Num; lastApplyAge: Num;
  pools: number; poolsListening: number; members: number; membersUp: number; membersDown: number; healthyPct: Num;
  sessions: Num; connections: Num; connectionErrors: Num; timeouts: Num; failovers: Num; bytesIn: Num; bytesOut: Num;
  rxRate: Num; txRate: Num; rttAvg: Num; rttMax: Num; conntrackPct: Num;
};
export type Stat = {n: number; sum: number; avg: Num; min: Num; max: Num};
export type NodesAgg = {
  total: number; enabled: number; online: number; offline: number; stale: number; overLimit: number;
  cpu: Stat; mem: Stat; disk: Stat; latency: Stat; netBps: Stat; upRate: Stat; downRate: Stat;
  trafficUp: number; trafficDown: number; trafficAllTime: number; inbounds: number; clients: number; onlineClients: number;
};
export type BalancersAgg = {
  total: number; enabled: number; online: number; offline: number; withError: number; drift: number;
  pools: number; poolsListening: number; members: number; membersUp: number; membersDown: number; healthyPct: Num;
  sessions: number; connections: number; connectionErrors: number; timeouts: number; failovers: number;
  bytesIn: number; bytesOut: number; rxRate: number; txRate: number; latency: Stat; rtt: Stat; conntrack: Stat;
};
export type PanelStats = {
  clients: number; clientsEnabled: number; clientsExpired: number; inbounds: number; inboundsEnabled: number; hosts: number; bundles: number;
  trafficUp: number; trafficDown: number; upRate: Num; downRate: Num; audit24h?: number; auditFailed24h?: number;
};
export type DashboardMetricsPayload = {at: number; nodes: NodeRow[]; balancers: BalancerRow[]; nodesAgg?: NodesAgg | null; balancersAgg?: BalancersAgg | null; panel?: PanelStats | null};

/** `key` is the id suffix, `label` an i18n key under pages.builder.metric.*, `states` maps a numeric value to an i18n key. */
export type Def<T> = {key: string; label: string; unit: MetricUnit; get: (x: T) => Num | undefined; max?: number; th?: Thresholds; states?: Record<number, string>};

const OK = {warn: 70, crit: 90};
export const STATE_ONLINE = {1: "stateOnline", 0: "stateOffline", 2: "stateDisabled"};
const STATE_CORE = {1: "stateRunning", 0: "stateStopped", 2: "stateError"};
const STATE_DRIFT = {0: "stateInSync", 1: "stateDrift"};
const STATE_FLAG = {0: "stateOk", 1: "stateProblem"};
const coreState = (s: string): Num => (s === "running" ? 1 : s === "stopped" ? 0 : s === "error" ? 2 : null);

export const NODE_DEFS: Def<NodeRow>[] = [
  {key: "status", label: "status", unit: "status", get: (n) => (!n.enable ? 2 : n.online ? 1 : 0), states: STATE_ONLINE},
  {key: "xray", label: "xrayState", unit: "status", get: (n) => coreState(n.xrayState), states: STATE_CORE},
  {key: "telemt", label: "telemtState", unit: "status", get: (n) => coreState(n.telemtState), states: STATE_CORE},
  {key: "cpu", label: "cpu", unit: "percent", get: (n) => n.cpu, max: 100, th: OK},
  {key: "mem", label: "mem", unit: "percent", get: (n) => n.mem, max: 100, th: {warn: 80, crit: 90}},
  {key: "disk", label: "disk", unit: "percent", get: (n) => n.disk, max: 100, th: {warn: 80, crit: 90}},
  {key: "mem.used", label: "memUsed", unit: "bytes", get: (n) => n.memUsed},
  {key: "mem.total", label: "memTotal", unit: "bytes", get: (n) => n.memTotal},
  {key: "latency", label: "latency", unit: "ms", get: (n) => n.latencyMs, th: {warn: 150, crit: 500}},
  {key: "checkAge", label: "checkAge", unit: "seconds", get: (n) => n.lastCheckAge, th: {warn: 60, crit: 120}},
  {key: "net", label: "netThroughput", unit: "speed", get: (n) => n.netBps},
  {key: "linkLoad", label: "linkLoad", unit: "percent", get: (n) => n.linkLoadPct, max: 100, th: OK},
  {key: "traffic.up", label: "trafficUp", unit: "bytes", get: (n) => n.trafficUp},
  {key: "traffic.down", label: "trafficDown", unit: "bytes", get: (n) => n.trafficDown},
  {key: "traffic.total", label: "trafficTotal", unit: "bytes", get: (n) => n.trafficUp + n.trafficDown},
  {key: "traffic.alltime", label: "trafficAllTime", unit: "bytes", get: (n) => n.trafficAllTime},
  {key: "traffic.limitPct", label: "trafficLimitPct", unit: "percent", get: (n) => n.trafficLimitPct, max: 100, th: {warn: 80, crit: 100}},
  {key: "rate.up", label: "rateUp", unit: "speed", get: (n) => n.upRate},
  {key: "rate.down", label: "rateDown", unit: "speed", get: (n) => n.downRate},
  {key: "inbounds", label: "inbounds", unit: "count", get: (n) => n.inbounds},
  {key: "clients", label: "clientsKnown", unit: "count", get: (n) => n.clients},
  {key: "clients.online", label: "clientsOnline", unit: "count", get: (n) => (n.online ? n.onlineClients : null)},
];

export const BALANCER_DEFS: Def<BalancerRow>[] = [
  {key: "status", label: "status", unit: "status", get: (b) => (!b.enable ? 2 : b.online ? 1 : 0), states: STATE_ONLINE},
  {key: "engine", label: "engineRunning", unit: "status", get: (b) => (b.running == null ? null : b.running ? 1 : 0), states: {1: "stateRunning", 0: "stateStopped"}},
  {key: "drift", label: "configDrift", unit: "status", get: (b) => (b.configDrift ? 1 : 0), states: STATE_DRIFT, th: {warn: 1, crit: 2}},
  {key: "error", label: "hasError", unit: "status", get: (b) => (b.hasError ? 1 : 0), states: STATE_FLAG, th: {warn: 2, crit: 1}},
  {key: "latency", label: "latency", unit: "ms", get: (b) => b.latencyMs, th: {warn: 150, crit: 500}},
  {key: "checkAge", label: "checkAge", unit: "seconds", get: (b) => b.lastCheckAge, th: {warn: 60, crit: 120}},
  {key: "applyAge", label: "applyAge", unit: "seconds", get: (b) => b.lastApplyAge},
  {key: "pools", label: "pools", unit: "count", get: (b) => (b.online ? b.pools : null)},
  {key: "pools.listening", label: "poolsListening", unit: "count", get: (b) => (b.online ? b.poolsListening : null)},
  {key: "members", label: "members", unit: "count", get: (b) => (b.online ? b.members : null)},
  {key: "members.up", label: "membersUp", unit: "count", get: (b) => (b.online ? b.membersUp : null)},
  {key: "pools.unhealthy", label: "membersDown", unit: "count", get: (b) => (b.online ? b.membersDown : null), th: {warn: 1, crit: 3}},
  {key: "healthy", label: "healthyPct", unit: "percent", get: (b) => b.healthyPct, max: 100, th: {warn: 99, crit: 50, invert: true}},
  {key: "connections", label: "connectionsActive", unit: "count", get: (b) => b.sessions},
  {key: "connections.total", label: "connectionsTotal", unit: "count", get: (b) => b.connections},
  {key: "errors", label: "connectionErrors", unit: "count", get: (b) => b.connectionErrors},
  {key: "timeouts", label: "timeouts", unit: "count", get: (b) => b.timeouts},
  {key: "failovers", label: "failovers", unit: "count", get: (b) => b.failovers},
  {key: "bytes.in", label: "bytesIn", unit: "bytes", get: (b) => b.bytesIn},
  {key: "bytes.out", label: "bytesOut", unit: "bytes", get: (b) => b.bytesOut},
  {key: "rate.in", label: "rateIn", unit: "speed", get: (b) => b.rxRate},
  {key: "rate.out", label: "rateOut", unit: "speed", get: (b) => b.txRate},
  {key: "rtt.avg", label: "rttAvg", unit: "ms", get: (b) => b.rttAvg, th: {warn: 150, crit: 500}},
  {key: "rtt.max", label: "rttMax", unit: "ms", get: (b) => b.rttMax, th: {warn: 250, crit: 800}},
  {key: "conntrack", label: "conntrack", unit: "percent", get: (b) => b.conntrackPct, max: 100, th: OK},
];

/** Aggregates over every node (`nodes.*`). Existing ids (nodes.online, nodes.total, nodes.availability, nodes.xray.*) live in dashboardMetrics.ts. */
export const NODE_AGG_DEFS: Def<NodesAgg>[] = [
  {key: "enabled", label: "aggEnabled", unit: "count", get: (a) => a.enabled},
  {key: "offline", label: "aggOffline", unit: "count", get: (a) => a.offline, th: {warn: 1, crit: 2}},
  {key: "stale", label: "aggStale", unit: "count", get: (a) => a.stale, th: {warn: 1, crit: 2}},
  {key: "overLimit", label: "aggOverLimit", unit: "count", get: (a) => a.overLimit, th: {warn: 1, crit: 2}},
  {key: "cpu.avg", label: "cpuAvg", unit: "percent", get: (a) => a.cpu.avg, max: 100, th: OK},
  {key: "cpu.max", label: "cpuMax", unit: "percent", get: (a) => a.cpu.max, max: 100, th: OK},
  {key: "cpu.min", label: "cpuMin", unit: "percent", get: (a) => a.cpu.min, max: 100},
  {key: "mem.avg", label: "memAvg", unit: "percent", get: (a) => a.mem.avg, max: 100, th: {warn: 80, crit: 90}},
  {key: "mem.max", label: "memMax", unit: "percent", get: (a) => a.mem.max, max: 100, th: {warn: 80, crit: 90}},
  {key: "disk.avg", label: "diskAvg", unit: "percent", get: (a) => a.disk.avg, max: 100, th: {warn: 80, crit: 90}},
  {key: "disk.max", label: "diskMax", unit: "percent", get: (a) => a.disk.max, max: 100, th: {warn: 80, crit: 90}},
  {key: "latency.avg", label: "latencyAvg", unit: "ms", get: (a) => a.latency.avg, th: {warn: 150, crit: 500}},
  {key: "latency.max", label: "latencyMax", unit: "ms", get: (a) => a.latency.max, th: {warn: 150, crit: 500}},
  {key: "net", label: "netThroughputSum", unit: "speed", get: (a) => (a.netBps.n ? a.netBps.sum : null)},
  {key: "traffic.up", label: "trafficUp", unit: "bytes", get: (a) => a.trafficUp},
  {key: "traffic.down", label: "trafficDown", unit: "bytes", get: (a) => a.trafficDown},
  {key: "traffic.total", label: "trafficTotal", unit: "bytes", get: (a) => a.trafficUp + a.trafficDown},
  {key: "traffic.alltime", label: "trafficAllTime", unit: "bytes", get: (a) => a.trafficAllTime},
  {key: "rate.up", label: "rateUp", unit: "speed", get: (a) => (a.upRate.n ? a.upRate.sum : null)},
  {key: "rate.down", label: "rateDown", unit: "speed", get: (a) => (a.downRate.n ? a.downRate.sum : null)},
  {key: "inbounds", label: "inbounds", unit: "count", get: (a) => a.inbounds},
  {key: "clients", label: "clientsKnown", unit: "count", get: (a) => a.clients},
  {key: "clients.online", label: "clientsOnline", unit: "count", get: (a) => a.onlineClients},
];

/** Aggregates over every balancer (`balancers.*`). */
export const BALANCER_AGG_DEFS: Def<BalancersAgg>[] = [
  {key: "total", label: "aggTotalBalancers", unit: "count", get: (a) => a.total},
  {key: "enabled", label: "aggEnabled", unit: "count", get: (a) => a.enabled},
  {key: "online", label: "aggOnlineBalancers", unit: "count", get: (a) => a.online},
  {key: "offline", label: "aggOffline", unit: "count", get: (a) => a.offline, th: {warn: 1, crit: 2}},
  {key: "error", label: "aggWithError", unit: "count", get: (a) => a.withError, th: {warn: 1, crit: 2}},
  {key: "drift", label: "aggDrift", unit: "count", get: (a) => a.drift, th: {warn: 1, crit: 3}},
  {key: "pools", label: "pools", unit: "count", get: (a) => a.pools},
  {key: "pools.listening", label: "poolsListening", unit: "count", get: (a) => a.poolsListening},
  {key: "members", label: "members", unit: "count", get: (a) => a.members},
  {key: "members.up", label: "membersUp", unit: "count", get: (a) => a.membersUp},
  {key: "pools.unhealthy", label: "membersDown", unit: "count", get: (a) => a.membersDown, th: {warn: 1, crit: 3}},
  {key: "healthy", label: "healthyPct", unit: "percent", get: (a) => a.healthyPct, max: 100, th: {warn: 99, crit: 50, invert: true}},
  {key: "connections", label: "connectionsActive", unit: "count", get: (a) => a.sessions},
  {key: "connections.total", label: "connectionsTotal", unit: "count", get: (a) => a.connections},
  {key: "errors", label: "connectionErrors", unit: "count", get: (a) => a.connectionErrors},
  {key: "timeouts", label: "timeouts", unit: "count", get: (a) => a.timeouts},
  {key: "failovers", label: "failovers", unit: "count", get: (a) => a.failovers},
  {key: "bytes.in", label: "bytesIn", unit: "bytes", get: (a) => a.bytesIn},
  {key: "bytes.out", label: "bytesOut", unit: "bytes", get: (a) => a.bytesOut},
  {key: "rate.in", label: "rateIn", unit: "speed", get: (a) => a.rxRate},
  {key: "rate.out", label: "rateOut", unit: "speed", get: (a) => a.txRate},
  {key: "latency.avg", label: "latencyAvg", unit: "ms", get: (a) => a.latency.avg, th: {warn: 150, crit: 500}},
  {key: "rtt.avg", label: "rttAvg", unit: "ms", get: (a) => a.rtt.avg, th: {warn: 150, crit: 500}},
  {key: "rtt.max", label: "rttMax", unit: "ms", get: (a) => a.rtt.max, th: {warn: 250, crit: 800}},
  {key: "conntrack.max", label: "conntrackMax", unit: "percent", get: (a) => a.conntrack.max, max: 100, th: OK},
];

/** Panel-wide counters from the same payload. Group is "Clients" / "Traffic" / "Panel". */
export const PANEL_DEFS: (Def<PanelStats> & {group: "Clients" | "Traffic" | "Process"; id: string})[] = [
  {id: "stats.clients.total", group: "Clients", key: "", label: "statsClients", unit: "count", get: (p) => p.clients},
  {id: "stats.clients.enabled", group: "Clients", key: "", label: "statsClientsEnabled", unit: "count", get: (p) => p.clientsEnabled},
  {id: "stats.clients.expired", group: "Clients", key: "", label: "statsClientsExpired", unit: "count", get: (p) => p.clientsExpired},
  {id: "stats.inbounds.total", group: "Clients", key: "", label: "statsInbounds", unit: "count", get: (p) => p.inbounds},
  {id: "stats.inbounds.enabled", group: "Clients", key: "", label: "statsInboundsEnabled", unit: "count", get: (p) => p.inboundsEnabled},
  {id: "stats.hosts", group: "Clients", key: "", label: "statsHosts", unit: "count", get: (p) => p.hosts},
  {id: "stats.bundles", group: "Clients", key: "", label: "statsBundles", unit: "count", get: (p) => p.bundles},
  {id: "traffic.up", group: "Traffic", key: "", label: "trafficUp", unit: "bytes", get: (p) => p.trafficUp},
  {id: "traffic.down", group: "Traffic", key: "", label: "trafficDown", unit: "bytes", get: (p) => p.trafficDown},
  {id: "traffic.total", group: "Traffic", key: "", label: "trafficTotal", unit: "bytes", get: (p) => p.trafficUp + p.trafficDown},
  {id: "traffic.rate.up", group: "Traffic", key: "", label: "rateUp", unit: "speed", get: (p) => p.upRate},
  {id: "traffic.rate.down", group: "Traffic", key: "", label: "rateDown", unit: "speed", get: (p) => p.downRate},
  {id: "audit.events24h", group: "Process", key: "", label: "audit24h", unit: "count", get: (p) => p.audit24h},
  {id: "audit.failed24h", group: "Process", key: "", label: "auditFailed24h", unit: "count", get: (p) => p.auditFailed24h, th: {warn: 5, crit: 20}},
];
