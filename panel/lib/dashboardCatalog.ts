/**
 * ONE catalog of tiles. Entries:
 *   - tiles: every built-in atom (a preset of the common tile model, see dashboardModel.ts) and the free content kinds;
 *     in addition the UI offers every metric of the metric catalog as a tile (see `metricCategory`),
 *   - sets: ready-made groups of tiles ("ready-made widgets"); inserting a set adds ordinary independent tiles,
 *   - mine: tiles / sets the user saved (stored with the workspace).
 * Pure functions, relative imports only.
 */
import type { CustomPanel, TileSettings } from "./dashboardBuilder";
import { ATOMS, atomDef } from "./dashboardLayout";
import { entityTemplate, type EntityTemplateContext } from "./dashboardMetricsTemplates";
import { MAX_PANELS, atomPanel, sanitizePanel, sanitizeTile, type TileBundle, type TileRect } from "./dashboardModel";

export type CatalogCategory = "resources" | "clients" | "network" | "system" | "database" | "cores" | "telemt" | "nodes" | "balancers" | "content" | "mine";

export const CATALOG_CATEGORIES: readonly { id: CatalogCategory; title: string }[] = [
  { id: "resources", title: "pages.builder.cat_resources" },
  { id: "clients", title: "pages.builder.cat_clients" },
  { id: "network", title: "pages.builder.cat_network" },
  { id: "system", title: "pages.builder.cat_system" },
  { id: "database", title: "pages.builder.cat_database" },
  { id: "cores", title: "pages.builder.cat_cores" },
  { id: "telemt", title: "pages.builder.cat_telemt" },
  { id: "nodes", title: "pages.builder.cat_nodes" },
  { id: "balancers", title: "pages.builder.cat_balancers" },
  { id: "content", title: "pages.builder.cat_content" },
  { id: "mine", title: "pages.builder.cat_mine" },
];

/** Category of a dashboard metric (by id), used to file the metric catalog under the same categories. */
export function metricCategory(id: string): CatalogCategory {
  if (/^node:|^nodes\./.test(id)) return "nodes";
  if (/^balancer:|^balancers\./.test(id)) return "balancers";
  if (id.startsWith("telemt.")) return "telemt";
  if (id.startsWith("network.") || id.startsWith("traffic.")) return "network";
  if (id.startsWith("db.")) return "database";
  if (id.startsWith("clients.") || id.startsWith("stats.")) return "clients";
  if (/^(cpu|mem|disk|swap|load)(\.|$)/.test(id) && !/^cpu\.(cores|frequency)$/.test(id)) return "resources";
  return "system";
}

export type CatalogTile = {
  kind: "tile";
  id: string;
  category: CatalogCategory;
  title: string;
  desc: string;
  icon: string;
  color: string;
  w: number;
  h: number;
  /** Built-in atom the tile is made from. */
  atom?: string;
  /** Free content tile (opens the editor). */
  content?: "html" | "embed" | "text" | "design";
};

export type SetTile = { atom?: string; metrics?: string[]; view?: string; title?: string; color?: string; w: number; min?: number; max?: number };
export type SetRow = { h: number; tiles: SetTile[] };
export type CatalogSet = {
  kind: "set";
  id: string;
  category: CatalogCategory;
  title: string;
  desc: string;
  icon: string;
  color: string;
  rows: SetRow[];
  /** Rows depend on live data (the list of nodes / balancers). */
  dynamic?: "nodes" | "balancers";
};
export type CatalogEntry = CatalogTile | CatalogSet;

const CONTENT: { id: "html" | "embed" | "text" | "design"; icon: string }[] = [
  { id: "design", icon: "LayoutGrid" },
  { id: "html", icon: "Code2" },
  { id: "embed", icon: "Globe" },
  { id: "text", icon: "Text" },
];

/** Every built-in tile plus the free content kinds. */
export const CATALOG_TILES: readonly CatalogTile[] = [
  ...ATOMS.map(
    (a): CatalogTile => ({ kind: "tile", id: a.id, category: a.group as CatalogCategory, title: a.title, desc: a.desc, icon: a.icon, color: a.color, w: a.w, h: a.h, atom: a.id }),
  ),
  ...CONTENT.map(
    (c): CatalogTile => ({ kind: "tile", id: "content_" + c.id, category: "content", title: "pages.builder." + c.id, desc: "pages.builder.contentDesc_" + c.id, icon: c.icon, color: "#38bdf8", w: 6, h: 6, content: c.id }),
  ),
];

const r4 = (atoms: string[], w = 3, h = 4): SetRow => ({ h, tiles: atoms.map((atom) => ({ atom, w })) });
const setDef = (id: string, category: CatalogCategory, icon: string, color: string, rows: SetRow[], dynamic?: CatalogSet["dynamic"]): CatalogSet => ({
  kind: "set",
  id,
  category,
  title: `pages.builder.set_${id}`,
  desc: `pages.builder.setDesc_${id}`,
  icon,
  color,
  rows,
  ...(dynamic ? { dynamic } : {}),
});

const RES_ROWS = [r4(["cpu_gauge", "ram_gauge", "disk_gauge", "swap_gauge"]), { h: 4, tiles: [{ atom: "nodes_availability", w: 4 }, { atom: "load_average", w: 8 }] }, r4(["cpu_history", "memory_history"], 6, 6)];
const NET_ROWS = [r4(["net_up", "net_down", "net_total_sent", "net_total_received"]), r4(["net_tcp", "net_udp"], 6)];

/** Ready-made sets ("ready-made widgets"). They become ordinary independent tiles. */
export const CATALOG_SETS: readonly CatalogSet[] = [
  setDef("resources", "resources", "Activity", "#38bdf8", RES_ROWS),
  setDef("network", "network", "ArrowLeftRight", "#14b8a6", NET_ROWS),
  setDef("database", "database", "Database", "#a78bfa", [r4(["db_pool", "db_size", "db_tables", "db_rows"])]),
  setDef("uptime", "system", "Clock", "#f59e0b", [r4(["panel_uptime", "os_uptime", "xray_uptime", "nodes_cores"])]),
  setDef("process", "system", "Cpu", "#38bdf8", [r4(["panel_cores", "panel_frequency", "panel_threads", "panel_memory"])]),
  setDef("cores", "cores", "Wrench", "#38bdf8", [r4(["xray_version", "telemt_version", "core_update", "core_controls"])]),
  setDef("backup", "system", "Download", "#22c55e", [r4(["backup_export", "backup_import", "backup_config"], 4)]),
  setDef("telemt", "telemt", "Radio", "#a78bfa", [r4(["telemt_version", "telemt_dc_summary", "telemt_dc_dots"], 4), { h: 12, tiles: [{ atom: "telemt_dc", w: 12 }] }]),
  setDef("nodes", "nodes", "Server", "#22c55e", [], "nodes"),
  setDef("balancers", "balancers", "Layers", "#f59e0b", [], "balancers"),
  setDef("overview", "resources", "LayoutDashboard", "#38bdf8", [...RES_ROWS, ...NET_ROWS]),
];

export const CATALOG_ENTRIES: readonly CatalogEntry[] = [...CATALOG_TILES, ...CATALOG_SETS];

/* ------------------------------------------------------------------ building bundles */

function metricPanel(id: string, t: SetTile): { panel: CustomPanel; tile: TileSettings } {
  const panel: CustomPanel = { id, title: t.title ?? "", kind: "metric", metrics: [...(t.metrics ?? [])], code: "", url: "", text: "" };
  const tile = sanitizeTile(
    { width: Math.min(12, t.w), height: 4, view: t.view ?? "stat", title: t.title ?? "", color: t.color, ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}), precision: 1 },
    { width: 3, height: 4, view: "default", title: "" },
  );
  return { panel, tile };
}

/** Panels, settings and the arrangement (rows stacked, every row 12 columns wide) of rows of tiles. */
export function rowsBundle(rows: readonly SetRow[], prefix = "custom-s"): TileBundle {
  const panels: CustomPanel[] = [];
  const tiles: Record<string, TileSettings> = {};
  const rects: TileRect[] = [];
  let y = 0;
  let n = 0;
  for (const row of rows) {
    let x = 0;
    for (const spec of row.tiles) {
      if (panels.length >= MAX_PANELS) break;
      const id = `${prefix}-${n++}`;
      const built = spec.atom ? atomPanel(spec.atom, id) : metricPanel(id, spec);
      if (!built) continue;
      if (spec.atom && spec.title) {
        built.panel.title = spec.title;
        built.tile.title = spec.title;
      }
      built.tile.width = Math.min(12, spec.w);
      built.tile.height = Math.max(3, Math.min(24, row.h));
      panels.push(built.panel);
      tiles[id] = built.tile;
      rects.push({ id, x, y, w: spec.w, h: row.h });
      x += spec.w;
    }
    y += row.h;
  }
  return { panels, tiles, rects };
}

/** Rows of a set; the dynamic sets (nodes, balancers) are built from the live lists. */
export function setRows(set: CatalogSet, t: (key: string) => string = (k) => k, ctx: EntityTemplateContext = {}): SetRow[] {
  if (set.dynamic) return entityTemplate(set.dynamic, t, ctx).rows.map((r) => ({ h: r.h, tiles: r.tiles.map((x) => ({ metrics: x.metrics, view: x.view, title: x.title, w: x.w, color: x.color, min: x.min, max: x.max })) }));
  return set.rows;
}

export function setBundle(set: CatalogSet, t?: (key: string) => string, ctx?: EntityTemplateContext): TileBundle {
  return rowsBundle(setRows(set, t, ctx));
}

/** A single catalog atom as a one-tile bundle (default size). */
export function atomBundle(atomId: string): TileBundle | null {
  const a = atomDef(atomId);
  const built = atomPanel(atomId, "custom-s-0");
  if (!a || !built) return null;
  return { panels: [built.panel], tiles: { [built.panel.id]: built.tile }, rects: [{ id: built.panel.id, x: 0, y: 0, w: a.w, h: a.h }] };
}

/** A single metric as a tile in the given look. */
export function metricBundle(metricId: string, label: string, view: string, color: string, w = 3, h = 4, max?: number): TileBundle {
  const built = metricPanel("custom-s-0", { metrics: [metricId], view, title: label, color, w, max });
  built.tile.height = h;
  return { panels: [built.panel], tiles: { [built.panel.id]: built.tile }, rects: [{ id: built.panel.id, x: 0, y: 0, w, h }] };
}

/** Whole boards ("From template"): built from the same sets. */
export function templateRows(kind: string, t: (key: string) => string, ctx?: EntityTemplateContext): { name: string; rows: SetRow[] } | null {
  const set = (id: string) => CATALOG_SETS.find((s) => s.id === id)!;
  switch (kind) {
    case "monitoring":
      return { name: t("pages.builder.monitoring"), rows: [...set("resources").rows, ...set("network").rows] };
    case "network":
      return { name: t("pages.builder.groupNetwork"), rows: set("network").rows };
    case "minimal":
      return { name: t("pages.builder.minimal"), rows: [r4(["cpu_gauge", "ram_gauge", "users_online", "nodes_availability"])] };
    case "nodes":
    case "balancers": {
      const e = entityTemplate(kind, t, ctx);
      return { name: e.name, rows: setRows(set(kind), t, ctx) };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ "Mine": tiles / sets the user saved */

export type MyEntry = { id: string; name: string; kind: "tile" | "set"; bundle: TileBundle };
const MAX_MINE = 50;

/** Save panels (with their settings and relative arrangement) as an entry of "Mine". */
export function makeMyEntry(
  id: string,
  name: string,
  from: { panels: readonly CustomPanel[]; tiles: Readonly<Record<string, TileSettings>>; grid: readonly TileRect[] },
  ids?: readonly string[],
): MyEntry | null {
  const want = ids ? new Set(ids) : null;
  const panels = from.panels.filter((p) => !want || want.has(p.id)).slice(0, MAX_PANELS);
  const rects = from.grid.filter((g) => panels.some((p) => p.id === g.id));
  if (!panels.length || !rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const tiles: Record<string, TileSettings> = {};
  for (const p of panels) if (from.tiles[p.id]) tiles[p.id] = { ...from.tiles[p.id] };
  return {
    id,
    name: name.trim().slice(0, 60) || "—",
    kind: panels.length === 1 ? "tile" : "set",
    bundle: { panels: structuredCloneSafe(panels), tiles, rects: rects.map((r) => ({ id: r.id, x: r.x - minX, y: r.y - minY, w: r.w, h: r.h })) },
  };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Stored "Mine" made safe; corrupt entries are dropped. */
export function parseMine(raw: unknown): MyEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MyEntry[] = [];
  for (const e of raw.slice(0, MAX_MINE)) {
    try {
      if (!e || typeof e !== "object") continue;
      const r = e as Record<string, unknown>;
      const b = r.bundle as { panels?: unknown; tiles?: unknown; rects?: unknown } | undefined;
      if (typeof r.id !== "string" || typeof r.name !== "string" || !b || !Array.isArray(b.panels) || !Array.isArray(b.rects)) continue;
      const panels = b.panels.slice(0, MAX_PANELS).map(sanitizePanel).filter((p): p is CustomPanel => p != null);
      const ids = new Set(panels.map((p) => p.id));
      const tiles: Record<string, TileSettings> = {};
      for (const p of panels) tiles[p.id] = sanitizeTile((b.tiles as Record<string, unknown> | undefined)?.[p.id], { width: 3, height: 4, view: "default", title: "" });
      const rects: TileRect[] = [];
      for (const g of b.rects) {
        const q = g as Record<string, unknown>;
        if (!q || typeof q.id !== "string" || !ids.has(q.id) || ![q.x, q.y, q.w, q.h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
        const w = Math.max(1, Math.min(12, Math.round(q.w as number)));
        rects.push({ id: q.id, x: Math.max(0, Math.min(12 - w, Math.round(q.x as number))), y: Math.max(0, Math.round(q.y as number)), w, h: Math.max(1, Math.min(60, Math.round(q.h as number))) });
      }
      if (!panels.length || !rects.length) continue;
      out.push({ id: r.id.slice(0, 60), name: r.name.slice(0, 60), kind: panels.length === 1 ? "tile" : "set", bundle: { panels, tiles, rects } });
    } catch {
      /* skip */
    }
  }
  return out;
}
