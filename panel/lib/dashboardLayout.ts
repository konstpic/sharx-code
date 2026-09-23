/**
 * User-configurable dashboard blocks (order fixed; each can be shown/hidden).
 * Persisted in DB as canonical order of enabled widget ids.
 */

export const DASHBOARD_WIDGET_ORDER = [
  "resources",
  "quick_actions",
  "uptime",
  "users_online",
  "user_agent",
  "database",
  "network",
  "panel_runtime",
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_ORDER)[number];

export const DASHBOARD_WIDGET_I18N: Record<DashboardWidgetId, string> = {
  resources: "pages.index.dashWidgetResources",
  quick_actions: "pages.index.dashWidgetQuickActions",
  uptime: "pages.index.dashWidgetUptime",
  users_online: "pages.index.dashWidgetUsersOnline",
  user_agent: "pages.clients.hwidUserAgentShareTitle",
  database: "pages.index.dashWidgetDatabase",
  network: "pages.index.dashWidgetNetwork",
  panel_runtime: "pages.index.dashWidgetPanelRuntime",
};

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
    const asSet = new Set(
      parsed.filter((x): x is string => typeof x === "string" && isDashboardWidgetId(x))
    );
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
