/**
 * Built-in dashboard widgets ("atoms"): every metric / control is its own tile that can be enabled,
 * moved and resized independently (Grafana style).
 *
 * Persisted in DB as the canonical order of enabled widget ids. Saved dashboards created before v2.9
 * contain the old composite ids (`resources`, `uptime`, `database`, ...): they are "groups" now and
 * expand to their atoms (`expandLegacyWidgetIds`). Relative imports only (vitest has no "@" alias).
 */

/** Kind decides default constraints and look: stat / viz (gauge, ring) / chart / table (list) / action (button). */
export type AtomKind = "stat" | "viz" | "chart" | "table" | "action" | "widget";

export type AtomDef = {
  id: string;
  /** i18n key of the title shown in the tile and in the picker. */
  title: string;
  /** i18n key of the one-line description shown in the picker. */
  desc: string;
  /** lucide icon name, resolved by the UI (kept as a string so this file stays pure). */
  icon: string;
  color: string;
  group: string;
  kind: AtomKind;
  /** Default size on the 12 column grid. */
  w: number;
  h: number;
  /** Id of the dashboard metric the tile shows (metric-backed atoms), and its default look. */
  metric?: string;
  /** Several metrics in one tile (load average). */
  metrics?: string[];
  view?: string;
  /** Not part of the default dashboard (variants offered by the catalog only). */
  extra?: boolean;
  /** Rows the tile takes on the phone layout (content is stacked there and is taller than on the desktop). */
  phoneRows?: number;
};

const k = (id: string) => `pages.index.dashAtom_${id}`;
const kd = (id: string) => `pages.index.dashAtomDesc_${id}`;
const a = (
  id: string,
  icon: string,
  color: string,
  group: string,
  kind: AtomKind,
  w: number,
  h: number,
  extra: { metric?: string; metrics?: string[]; view?: string; extra?: boolean; phoneRows?: number } = {},
): AtomDef => ({ id, title: k(id), desc: kd(id), icon, color, group, kind, w, h, ...extra });

/** Atoms in their canonical order (this is also the default dashboard reading order). */
export const ATOMS: readonly AtomDef[] = [
  a("cpu_gauge", "Cpu", "#38bdf8", "resources", "viz", 3, 4, { metric: "cpu", view: "gauge" }),
  a("ram_gauge", "MemoryStick", "#a78bfa", "resources", "viz", 3, 4, { metric: "mem.percent", view: "gauge" }),
  a("disk_gauge", "HardDrive", "#f59e0b", "resources", "viz", 3, 4, { metric: "disk.percent", view: "gauge" }),
  a("swap_gauge", "Layers", "#14b8a6", "resources", "viz", 3, 4, { metric: "swap.percent", view: "gauge" }),
  a("nodes_availability", "Server", "#22c55e", "resources", "stat", 3, 4),
  a("load_average", "Activity", "#38bdf8", "resources", "stat", 3, 4, { metrics: ["load.1", "load.5", "load.15"], view: "stat" }),
  a("users_online", "Users", "#22c55e", "clients", "stat", 3, 4, { metric: "clients.online", view: "spark" }),
  a("db_pool", "Database", "#a78bfa", "database", "viz", 3, 4, { metric: "db.connections", view: "gauge" }),
  a("cpu_history", "History", "#38bdf8", "resources", "chart", 6, 6),
  a("memory_history", "History", "#a78bfa", "resources", "chart", 6, 6),
  a("net_up", "ArrowUp", "#22c55e", "network", "stat", 3, 4, { metric: "network.up", view: "spark" }),
  a("net_down", "ArrowDown", "#38bdf8", "network", "stat", 3, 4, { metric: "network.down", view: "spark" }),
  a("net_total_sent", "CloudUpload", "#f59e0b", "network", "stat", 3, 4, { metric: "network.sent", view: "stat" }),
  a("net_total_received", "CloudDownload", "#a78bfa", "network", "stat", 3, 4, { metric: "network.received", view: "stat" }),
  a("net_tcp", "ArrowLeftRight", "#14b8a6", "network", "stat", 3, 4, { metric: "network.tcp", view: "stat" }),
  a("net_udp", "ArrowLeftRight", "#f472b6", "network", "stat", 3, 4, { metric: "network.udp", view: "stat" }),
  a("panel_uptime", "Clock", "#38bdf8", "system", "stat", 3, 4, { metric: "panel.uptime", view: "stat" }),
  a("os_uptime", "Clock", "#a78bfa", "system", "stat", 3, 4, { metric: "os.uptime", view: "stat" }),
  a("xray_uptime", "Clock", "#22c55e", "system", "stat", 3, 4),
  a("nodes_cores", "Cpu", "#22c55e", "system", "stat", 3, 4),
  a("xray_version", "Wrench", "#38bdf8", "cores", "stat", 3, 4),
  a("telemt_version", "Wrench", "#a78bfa", "cores", "stat", 3, 4),
  a("core_update", "RefreshCw", "#38bdf8", "cores", "action", 3, 4),
  a("core_controls", "Power", "#ef4444", "cores", "action", 3, 4),
  a("logs", "History", "#38bdf8", "system", "action", 3, 4),
  a("backup_export", "Download", "#22c55e", "system", "action", 3, 4),
  a("backup_import", "CloudUpload", "#f59e0b", "system", "action", 3, 4),
  a("backup_config", "SlidersHorizontal", "#94a3b8", "system", "action", 3, 4),
  a("server_ip", "Globe", "#38bdf8", "system", "action", 6, 4),
  a("panel_cores", "Cpu", "#38bdf8", "system", "stat", 4, 4, { metric: "cpu.cores", view: "stat" }),
  a("panel_frequency", "Gauge", "#f59e0b", "system", "stat", 4, 4, { metric: "cpu.frequency", view: "stat" }),
  a("panel_threads", "Layers", "#a78bfa", "system", "stat", 3, 4, { metric: "panel.threads", view: "stat" }),
  a("panel_memory", "MemoryStick", "#22c55e", "system", "stat", 4, 4, { metric: "panel.memory", view: "stat" }),
  a("db_size", "Database", "#a78bfa", "database", "stat", 3, 4, { metric: "db.size", view: "stat" }),
  a("db_tables", "Layers", "#38bdf8", "database", "stat", 3, 4, { metric: "db.tables", view: "stat" }),
  a("db_rows", "Server", "#22c55e", "database", "stat", 3, 4, { metric: "db.rows", view: "stat" }),
  a("user_agent", "Users", "#3b82f6", "clients", "table", 6, 8),
  a("telemt_dc", "Radio", "#a78bfa", "telemt", "widget", 12, 12),
  a("telemt_dc_summary", "Radio", "#a78bfa", "telemt", "stat", 4, 4, { extra: true }),
  a("telemt_dc_dots", "Radio", "#a78bfa", "telemt", "widget", 6, 4, { extra: true }),
  // The v2.6 dashboard cards, one tile each (group "classic", see components/dashboard/classic). Sizes fit the content at 1600 px.
  a("classic_resources", "Activity", "#38bdf8", "classic", "widget", 12, 11, { extra: true, phoneRows: 12 }),
  a("classic_logs", "History", "#38bdf8", "classic", "widget", 3, 6, { extra: true, phoneRows: 4 }),
  a("classic_cores", "Wrench", "#38bdf8", "classic", "widget", 3, 6, { extra: true, phoneRows: 6 }),
  a("classic_backup", "Server", "#22c55e", "classic", "widget", 3, 6, { extra: true, phoneRows: 6 }),
  a("classic_uptime", "Clock", "#f59e0b", "classic", "widget", 3, 6, { extra: true, phoneRows: 5 }),
  a("classic_users_online", "Users", "#22c55e", "classic", "widget", 12, 5, { extra: true, phoneRows: 5 }),
  a("classic_user_agent", "Users", "#3b82f6", "classic", "widget", 12, 7, { extra: true, phoneRows: 12 }),
  a("classic_database", "Database", "#a78bfa", "classic", "widget", 12, 4, { extra: true, phoneRows: 6 }),
  a("classic_runtime", "Cpu", "#38bdf8", "classic", "widget", 12, 5, { extra: true, phoneRows: 6 }),
  a("classic_network", "Network", "#38bdf8", "classic", "widget", 12, 16, { extra: true, phoneRows: 25 }),
  // The v2.7.1 dashboard tiles (group "v271", see components/dashboard/v271). Heights are the content height of the tile at 1600 px
  // (about 42 px per row incl. the gap), `phoneRows` the height of the stacked content on a phone.
  a("v271_resources", "Activity", "#38bdf8", "v271", "widget", 12, 10, { extra: true, phoneRows: 17 }),
  a("v271_logs", "History", "#38bdf8", "v271", "widget", 4, 4, { extra: true, phoneRows: 4 }),
  a("v271_core_versions", "Wrench", "#38bdf8", "v271", "widget", 4, 7, { extra: true, phoneRows: 7 }),
  a("v271_backup", "Server", "#22c55e", "v271", "widget", 4, 6, { extra: true, phoneRows: 6 }),
  a("v271_uptime", "Clock", "#f59e0b", "v271", "widget", 6, 7, { extra: true, phoneRows: 8 }),
  a("v271_users_online", "Users", "#22c55e", "v271", "widget", 6, 7, { extra: true, phoneRows: 7 }),
  a("v271_user_agent", "Users", "#3b82f6", "v271", "widget", 6, 7, { extra: true, phoneRows: 12 }),
  a("v271_database", "Database", "#a78bfa", "v271", "widget", 6, 6, { extra: true, phoneRows: 8 }),
  a("v271_net_speed", "ArrowLeftRight", "#38bdf8", "v271", "widget", 6, 6, { extra: true, phoneRows: 10 }),
  a("v271_net_traffic", "CloudDownload", "#a78bfa", "v271", "widget", 6, 6, { extra: true, phoneRows: 6 }),
  a("v271_net_sockets", "ArrowLeftRight", "#14b8a6", "v271", "widget", 6, 7, { extra: true, phoneRows: 7 }),
  a("v271_server_ip", "Globe", "#38bdf8", "v271", "widget", 6, 5, { extra: true, phoneRows: 5 }),
  a("v271_panel_runtime", "Cpu", "#38bdf8", "v271", "widget", 6, 7, { extra: true, phoneRows: 7 }),
  a("v271_cpu_history", "Cpu", "#38bdf8", "v271", "widget", 6, 6, { extra: true, phoneRows: 6 }),
  a("v271_memory_history", "MemoryStick", "#a78bfa", "v271", "widget", 6, 6, { extra: true, phoneRows: 6 }),
];

/** Atoms of the default dashboard (variants marked `extra` are catalog-only). */
export const DASHBOARD_WIDGET_ORDER = ATOMS.filter((x) => !x.extra).map((x) => x.id) as unknown as readonly DashboardWidgetId[];
export const ALL_ATOM_IDS: readonly string[] = ATOMS.map((x) => x.id);

export type DashboardWidgetId =
  | "cpu_gauge" | "ram_gauge" | "disk_gauge" | "swap_gauge" | "nodes_availability" | "load_average" | "users_online" | "db_pool"
  | "cpu_history" | "memory_history" | "net_up" | "net_down" | "net_total_sent" | "net_total_received" | "net_tcp" | "net_udp"
  | "panel_uptime" | "os_uptime" | "xray_uptime" | "nodes_cores" | "xray_version" | "telemt_version" | "core_update" | "core_controls"
  | "logs" | "backup_export" | "backup_import" | "backup_config" | "server_ip" | "panel_cores" | "panel_frequency" | "panel_threads"
  | "panel_memory" | "db_size" | "db_tables" | "db_rows" | "user_agent" | "telemt_dc";

const ATOM_BY_ID = new Map(ATOMS.map((x) => [x.id, x]));
export const atomDef = (id: string): AtomDef | undefined => ATOM_BY_ID.get(id);

export const DASHBOARD_WIDGET_I18N = Object.fromEntries(ATOMS.map((x) => [x.id, x.title])) as Record<DashboardWidgetId, string>;

/**
 * Widgets that were split into several independent tiles. A saved layout that still lists the old id
 * gets all of its successors, in place, so nobody loses a tile after the update. Values are flat
 * (atoms only). Keys are the former composite tiles ("groups").
 */
export const LEGACY_WIDGET_SPLIT: Record<string, readonly string[]> = {
  resources: ["cpu_gauge", "ram_gauge", "disk_gauge", "swap_gauge", "nodes_availability", "load_average"],
  uptime: ["panel_uptime", "os_uptime", "xray_uptime", "nodes_cores"],
  core_versions: ["xray_version", "telemt_version", "core_update", "core_controls"],
  backup: ["backup_export", "backup_import", "backup_config"],
  database: ["db_pool", "db_size", "db_tables", "db_rows"],
  panel_runtime: ["panel_cores", "panel_frequency", "panel_threads", "panel_memory"],
  net_speed: ["net_up", "net_down"],
  net_traffic: ["net_total_sent", "net_total_received"],
  net_sockets: ["net_tcp", "net_udp"],
  quick_actions: ["logs", "xray_version", "telemt_version", "core_update", "core_controls", "backup_export", "backup_import", "backup_config"],
  network: ["net_up", "net_down", "net_total_sent", "net_total_received", "net_tcp", "net_udp", "server_ip"],
};

/** Former composite ids (groups); they are not valid tile ids any more. */
export const LEGACY_COMPOSITE_IDS: readonly string[] = Object.keys(LEGACY_WIDGET_SPLIT);

export function isLegacyCompositeId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_WIDGET_SPLIT, id);
}

/** Atoms a group toggles in the picker (the legacy split, plus the picker sections). */
export function atomsOfGroup(group: string): string[] {
  return ATOMS.filter((x) => x.group === group).map((x) => x.id);
}

export function expandLegacyWidgetIds(ids: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    for (const x of isLegacyCompositeId(id) ? LEGACY_WIDGET_SPLIT[id] : [id]) if (!out.includes(x)) out.push(x);
  }
  return out;
}

export function isDashboardWidgetId(v: string): v is DashboardWidgetId {
  return ATOM_BY_ID.has(v) && !ATOM_BY_ID.get(v)!.extra;
}

/** Enabled widgets in display order. On error or empty → all. */
export function parseDashboardWidgets(raw: string | null | undefined): DashboardWidgetId[] {
  try {
    if (!raw) return [...DASHBOARD_WIDGET_ORDER];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [...DASHBOARD_WIDGET_ORDER];
    }
    const asSet = new Set(expandLegacyWidgetIds(parsed).filter(isDashboardWidgetId));
    if (asSet.size === 0) return [...DASHBOARD_WIDGET_ORDER];
    return DASHBOARD_WIDGET_ORDER.filter((id) => asSet.has(id));
  } catch {
    return [...DASHBOARD_WIDGET_ORDER];
  }
}

export function encodeDashboardWidgets(enabled: readonly DashboardWidgetId[]): string {
  return JSON.stringify([...enabled]);
}

export function toggleDashboardWidget(
  id: DashboardWidgetId,
  current: Set<DashboardWidgetId>
): DashboardWidgetId[] {
  const next = new Set(current);
  if (next.has(id)) {
    if (next.size <= 1) {
      return DASHBOARD_WIDGET_ORDER.filter((w) => next.has(w));
    }
    next.delete(id);
  } else {
    next.add(id);
  }
  return DASHBOARD_WIDGET_ORDER.filter((w) => next.has(w));
}

/** Enable / disable a whole set of atoms at once (group toggle in the picker); never leaves the board empty. */
export function setDashboardWidgets(ids: readonly DashboardWidgetId[], on: boolean, current: Set<DashboardWidgetId>): DashboardWidgetId[] {
  const next = new Set(current);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  if (next.size === 0) return DASHBOARD_WIDGET_ORDER.filter((w) => current.has(w));
  return DASHBOARD_WIDGET_ORDER.filter((w) => next.has(w));
}
