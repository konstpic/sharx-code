import type { TFunction } from "i18next";

export const SETTINGS_TAB_IDS = [
  "general",
  "security",
  "telegram",
  "subscription",
  "ldap",
  "grafana",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "general";

const setIds = new Set<string>(SETTINGS_TAB_IDS);

export function tSettingsTabLabel(t: TFunction, id: SettingsTabId): string {
  switch (id) {
    case "general":
      return t("pages.settings.tabs.general");
    case "security":
      return t("pages.settings.tabs.security");
    case "telegram":
      return t("pages.settings.tabs.telegram");
    case "subscription":
      return t("pages.settings.tabs.subscription");
    case "ldap":
      return t("pages.settings.tabs.ldap");
    case "grafana":
      return t("pages.settings.tabs.grafana");
    default: {
      const _e: never = id;
      return _e;
    }
  }
}

export function isSettingsTabId(s: string): s is SettingsTabId {
  return setIds.has(s);
}

export function parseSettingsTab(param: string | undefined): SettingsTabId {
  if (param && isSettingsTabId(param)) return param;
  return DEFAULT_SETTINGS_TAB;
}
