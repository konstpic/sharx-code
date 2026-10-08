import type { TFunction } from "i18next";

/** The resource part of "clients:update". */
export function resourceOf(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(0, i);
}

/** The action part of "clients:update". */
export function actionOf(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? "" : key.slice(i + 1);
}

const GROUPS: Record<string, string> = {
  overview: "Overview & logs",
  inbounds: "Inbounds",
  clients: "Clients",
  groups: "Client groups",
  subscriptions: "Subscriptions",
  infrastructure: "Servers",
  xray: "Xray & routing",
  settings: "Panel settings",
  system: "System",
  access: "Users & roles",
};

const RESOURCES: Record<string, string> = {
  dashboard: "Dashboard",
  logs: "Logs",
  inbounds: "Inbounds",
  clients: "Clients",
  groups: "Client groups",
  bundles: "Bundles",
  hosts: "Hosts",
  outbounds: "Outbounds",
  nodes: "Nodes",
  balancers: "Balancers",
  xray: "Xray core",
  settings: "Settings",
  system: "System",
  users: "Users",
  roles: "Roles",
  audit: "Audit log",
  auth: "Single sign-on",
};

const ACTIONS: Record<string, string> = {
  read: "View",
  manage: "Manage",
  create: "Create",
  update: "Edit",
  delete: "Delete",
  operate: "Operate",
  secret: "Pairing secret",
  security: "Security",
  backup: "Backup & restore",
  database: "Raw database",
};

/** Hints for the actions whose name alone does not say what they allow. */
const DESCRIPTIONS: Record<string, string> = {
  "inbounds:read": "Inbound settings contain client credentials (UUIDs, passwords, keys).",
  "clients:read": "Includes subscription links and share links, which are credentials.",
  "clients:operate": "Reset traffic, clear HWID, drop or block sessions.",
  "nodes:operate": "Restart or stop Xray, Telemt and AmneziaWG on a node, reload its config.",
  "nodes:create": "Add a node, including installing it over SSH with credentials entered in the panel.",
  "nodes:secret": "The pairing secret lets a server join the panel as a node.",
  "balancers:operate": "Push the configuration, refresh status, change the agent log level.",
  "balancers:create": "Add a balancer, including installing it over SSH.",
  "xray:operate": "Start, stop, restart or update Xray and Telemt, manage geo files.",
  "settings:read": "Shows tokens and other secrets that are stored in the settings.",
  "settings:update": "Change the panel settings, except the security ones.",
  "settings:security": "LDAP, two-factor sign-in, the Telegram bot, the panel address and TLS. Whoever controls these controls who can sign in: only administrators can grant it.",
  "system:update": "Update or restart the panel and its nodes.",
  "system:backup": "Export or replace the whole database. Only administrators can grant it.",
  "system:database": "Read and edit database tables directly. Only administrators can grant it.",
  "users:create": "Create users with any role you hold yourself.",
  "users:update": "Change users whose permissions are within yours: role, status, password.",
  "users:delete": "Delete users whose permissions are within yours.",
  "roles:create": "Create roles with permissions you hold yourself.",
  "roles:update": "Edit roles whose permissions are within yours.",
  "roles:delete": "Delete roles that nobody holds.",
};

export function groupLabel(t: TFunction, id: string): string {
  return t(`rbac.group.${id}`, { defaultValue: GROUPS[id] ?? id });
}

export function resourceLabel(t: TFunction, res: string): string {
  return t(`rbac.resource.${res}`, { defaultValue: RESOURCES[res] ?? res });
}

export function actionLabel(t: TFunction, key: string): string {
  if (key === "system:update") return t("rbac.action.systemUpdate", { defaultValue: "Update & restart" });
  const a = actionOf(key);
  return t(`rbac.action.${a}`, { defaultValue: ACTIONS[a] ?? a });
}

export function permissionLabel(t: TFunction, key: string): string {
  if (key === "*") return t("rbac.everything", { defaultValue: "Everything" });
  return `${resourceLabel(t, resourceOf(key))}: ${actionLabel(t, key)}`;
}

export function permissionHint(t: TFunction, key: string): string | undefined {
  const d = DESCRIPTIONS[key];
  return d ? t(`rbac.hint.${key.replace(":", "_")}`, { defaultValue: d }) : undefined;
}

/**
 * Starting points for a new role. They only tick checkboxes in the editor (limited to what the editor may grant); the
 * backend knows nothing about these names.
 */
export const ROLE_PRESETS: { id: string; label: string; permissions: string[] }[] = [
  {
    id: "readonly",
    label: "Read only",
    permissions: [
      "dashboard:read", "logs:read", "inbounds:read", "clients:read", "groups:read", "bundles:read", "hosts:read",
      "nodes:read", "balancers:read", "xray:read", "outbounds:read",
    ],
  },
  {
    id: "support",
    label: "Support",
    permissions: [
      "dashboard:read", "logs:read", "inbounds:read", "clients:read", "clients:update", "clients:operate",
      "groups:read", "bundles:read", "hosts:read", "nodes:read",
    ],
  },
  {
    id: "manager",
    label: "Manager",
    permissions: [
      "dashboard:read", "logs:read", "inbounds:read", "clients:read", "clients:create", "clients:update", "clients:delete",
      "clients:operate", "groups:read", "groups:create", "groups:update", "groups:delete", "bundles:read", "bundles:create",
      "bundles:update", "bundles:delete", "hosts:read", "hosts:create", "hosts:update", "hosts:delete", "nodes:read",
    ],
  },
];
