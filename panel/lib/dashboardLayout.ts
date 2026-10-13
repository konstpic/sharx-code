/**
 * User-configurable dashboard blocks (order fixed; each can be shown/hidden).
 * Persisted in DB as canonical order of enabled widget ids.
 */

export const DASHBOARD_WIDGET_ORDER = [
  "resources",
  "logs",
  "core_versions",
  "backup",
  "uptime",
  "users_online",
  "user_agent",
  "database",
  "net_speed",
  "net_traffic",
  "net_sockets",
  "server_ip",
  "panel_runtime",
  "telemt_dc",
  "cpu_history",
  "memory_history",
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_ORDER)[number];

export const DASHBOARD_WIDGET_I18N: Record<DashboardWidgetId, string> = {
  telemt_dc: "pages.builder.telemt",
  cpu_history: "pages.index.cpuHistory",
  memory_history: "pages.index.memoryHistory",
  resources: "pages.index.dashWidgetResources",
  logs: "pages.index.dashWidgetLogs",
  core_versions: "pages.index.dashWidgetCoreVersions",
  backup: "pages.index.dashWidgetBackup",
  net_speed: "pages.index.dashWidgetNetSpeed",
  net_traffic: "pages.index.dashWidgetNetTraffic",
  net_sockets: "pages.index.dashWidgetNetSockets",
  server_ip: "pages.index.dashWidgetServerIp",
  uptime: "pages.index.dashWidgetUptime",
  users_online: "pages.index.dashWidgetUsersOnline",
  user_agent: "pages.clients.hwidUserAgentShareTitle",
  database: "pages.index.dashWidgetDatabase",
  panel_runtime: "pages.index.dashWidgetPanelRuntime",
};

/**
 * Widgets that were split into several independent tiles. A saved layout that still lists the old id
 * gets all of its successors, in place, so nobody loses a tile after the update.
 */
const LEGACY_WIDGET_SPLIT: Record<string, readonly string[]> = {
  quick_actions: ["logs", "core_versions", "backup"],
  network: ["net_speed", "net_traffic", "net_sockets", "server_ip"],
};

export function expandLegacyWidgetIds(ids: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    for (const x of LEGACY_WIDGET_SPLIT[id] ?? [id]) if (!out.includes(x)) out.push(x);
  }
  return out;
}

export function isDashboardWidgetId(v: string): v is DashboardWidgetId {
  return (DASHBOARD_WIDGET_ORDER as readonly string[]).includes(v);
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
