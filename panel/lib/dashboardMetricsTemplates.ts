// Ready-made "Nodes overview" / "Balancers overview" boards. They are made of ordinary atomic tiles: a row of aggregates on
// top, then for every node (balancer) ONE row of six tiles ("ES-1 · CPU"), each row exactly 12 columns wide, so the board
// has no holes for any number of entities. Per-entity tiles need the live node / balancer list, so the caller passes it in.
import {BALANCER_DEFS, NODE_DEFS} from "./dashboardMetricsNodes";

export type TemplateEntity = {id: number; name: string};
export type EntityTemplateContext = {nodes?: TemplateEntity[]; balancers?: TemplateEntity[]};
/** One tile of a template row; `w` columns wide, the row defines the height. */
export type TemplateTile = {metrics: string[]; view: string; title: string; w: number; color: string; min?: number; max?: number};
export type TemplateRow = {h: number; tiles: TemplateTile[]};
export type EntityTemplate = {name: string; rows: TemplateRow[]};

const COLORS = ["#38bdf8", "#a78bfa", "#22c55e", "#f59e0b", "#f472b6", "#14b8a6"];
/** Most tiles one board can hold (see MAX_PANELS in dashboardModel). */
const MAX_TILES = 120;

const NODE_ROW = [["status", "status"], ["cpu", "gauge"], ["mem", "gauge"], ["disk", "gauge"], ["clients.online", "stat"], ["latency", "spark"]] as const;
const BALANCER_ROW = [["status", "status"], ["connections", "spark"], ["healthy", "gauge"], ["rate.in", "spark"], ["rate.out", "spark"], ["errors", "stat"]] as const;
const NODE_SUMMARY = [
  ["nodes.online", "stat"], ["nodes.availability", "gauge"], ["nodes.cpu.avg", "gauge"], ["nodes.cpu.max", "gauge"],
  ["nodes.mem.avg", "gauge"], ["nodes.rate.up", "spark"], ["nodes.rate.down", "spark"], ["nodes.clients.online", "stat"],
] as const;
const BALANCER_SUMMARY = [
  ["balancers.online", "stat"], ["balancers.healthy", "gauge"], ["balancers.connections", "spark"], ["balancers.pools.unhealthy", "stat"],
  ["balancers.rate.in", "spark"], ["balancers.rate.out", "spark"],
] as const;

const percentLike = (id: string) => id.includes("percent") || id.endsWith("cpu.avg") || id.endsWith("cpu.max") || id.endsWith("mem.avg") || id.endsWith("availability") || id.endsWith(".healthy") || /:(cpu|mem|disk|healthy)$/.test(id);

function row(h: number, specs: readonly (readonly [string, string])[], titleOf: (key: string) => string, i0 = 0): TemplateRow {
  const w = 12 / specs.length;
  return {h, tiles: specs.map(([m, view], i) => ({metrics: [m], view, title: titleOf(m), w, color: COLORS[(i0 + i) % COLORS.length], ...(percentLike(m) ? {min: 0, max: 100} : {})}))};
}

/** Summary rows (4 tiles each for nodes, one row of six for balancers) followed by one row per entity. */
export function entityTemplate(kind: "nodes" | "balancers", t: (key: string) => string, ctx: EntityTemplateContext = {}): EntityTemplate {
  const isNodes = kind === "nodes";
  const rows: TemplateRow[] = [];
  const sum = isNodes ? NODE_SUMMARY : BALANCER_SUMMARY;
  const per = isNodes ? 4 : 6;
  for (let i = 0; i < sum.length; i += per) rows.push(row(4, sum.slice(i, i + per), () => ""));
  const list = (isNodes ? ctx.nodes : ctx.balancers) ?? [];
  const defs = isNodes ? NODE_DEFS : BALANCER_DEFS;
  const keys = isNodes ? NODE_ROW : BALANCER_ROW;
  const room = Math.max(0, Math.floor((MAX_TILES - rows.reduce((n, r) => n + r.tiles.length, 0)) / 6));
  list.slice(0, room).forEach((e, ei) => {
    const prefix = isNodes ? "node" : "balancer";
    const r = row(4, keys.map(([k, v]) => [`${prefix}:${e.id}:${k}`, v] as const), (m) => {
      const key = m.slice(`${prefix}:${e.id}:`.length);
      const def = (defs as readonly {key: string; label: string}[]).find((d) => d.key === key);
      return `${e.name} · ${t("pages.builder.metric." + (def?.label ?? key))}`;
    }, ei);
    rows.push(r);
  });
  return {name: t(isNodes ? "pages.builder.templateNodes" : "pages.builder.templateBalancers"), rows};
}
