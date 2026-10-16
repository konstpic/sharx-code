// Ready-made "Nodes overview" / "Balancers overview" boards. Per-entity cards need the live node/balancer list, so the
// caller passes it in; without it the board falls back to the aggregate tiles only.
import type {CustomPanel, TileSettings} from "./dashboardBuilder";

export type TemplateEntity = {id: number; name: string};
export type EntityTemplateContext = {nodes?: TemplateEntity[]; balancers?: TemplateEntity[]};
export type EntityTemplate = {name: string; panels: CustomPanel[]; tiles: Record<string, TileSettings>};

const COLORS = ["#38bdf8", "#a78bfa", "#22c55e", "#f59e0b"];
const MAX_PANELS = 24; // parseLayout keeps at most 24 panels
const panel = (id: string, title: string, metrics: string[]): CustomPanel => ({id, title, kind: "metric", metrics, code: "", url: "", text: ""});

export function entityTemplate(kind: "nodes" | "balancers", t: (key: string) => string, ctx: EntityTemplateContext = {}): EntityTemplate {
  const isNodes = kind === "nodes";
  const summary = isNodes
    ? ["nodes.online", "nodes.availability", "nodes.cpu.avg", "nodes.cpu.max", "nodes.mem.avg", "nodes.rate.up", "nodes.rate.down", "nodes.clients.online"]
    : ["balancers.online", "balancers.healthy", "balancers.connections", "balancers.pools.unhealthy", "balancers.rate.in", "balancers.rate.out"];
  const panels: CustomPanel[] = summary.map((m, i) => panel(`custom-${kind}-sum-${i}`, "", [m]));
  const tiles: Record<string, TileSettings> = {};
  panels.forEach((p, i) => {
    tiles[p.id] = {width: 3, height: 4, view: "stat", title: "", color: COLORS[i % 4], precision: 1, ...(p.metrics[0].includes("percent") || p.metrics[0] === "nodes.availability" || p.metrics[0].endsWith("cpu.avg") || p.metrics[0].endsWith("cpu.max") || p.metrics[0].endsWith("mem.avg") || p.metrics[0] === "balancers.healthy" ? {min: 0, max: 100} : {})};
  });
  const list = (isNodes ? ctx.nodes : ctx.balancers) ?? [];
  const keys = isNodes ? ["status", "cpu", "mem", "traffic.total", "clients.online"] : ["status", "connections", "healthy", "rate.in", "rate.out", "errors"];
  list.slice(0, MAX_PANELS - panels.length).forEach((e, i) => {
    const id = `custom-${kind}-${e.id}`;
    panels.push(panel(id, e.name, keys.map((k) => `${isNodes ? "node" : "balancer"}:${e.id}:${k}`)));
    tiles[id] = {width: 4, height: 6, view: "stat", title: "", color: COLORS[i % 4], precision: 1};
  });
  return {name: t(isNodes ? "pages.builder.templateNodes" : "pages.builder.templateBalancers"), panels, tiles};
}
