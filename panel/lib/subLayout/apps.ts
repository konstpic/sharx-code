import { resolveAddToAppButtons, type AddToAppData } from "../addToAppButtons";
import { APP_CATALOG, subscriptionApps, type BlockAddToApp, type SubscriptionApp } from "../sharxSubpageConfig";

/** One hand-picked app of an `apps` node (an AppButton without the block bookkeeping). */
export type AppsNodeApp = { app: SubscriptionApp; label?: string; iconUrl?: string; deepLinkTemplate?: string; useEncrypted?: boolean; enabled?: boolean };
export type AppsView = "buttons" | "tiles" | "list";
export type AppsVariant = "solid" | "outline" | "ghost";
export type AppsProps = {
  apps: AppsNodeApp[];
  source: "manual" | "config";
  view: AppsView;
  variant: AppsVariant;
  showIcon: boolean;
  showBadge: boolean;
  cols?: number;
};

export const DEFAULT_APP_IDS: SubscriptionApp[] = ["happ", "v2raytun", "hiddify", "clash-meta"];

export function defaultAppsList(ids: SubscriptionApp[] = DEFAULT_APP_IDS): AppsNodeApp[] {
  return ids.map((app) => ({ app, useEncrypted: APP_CATALOG[app]?.supportsEncrypted === true }));
}

export function defaultAppsProps(): Record<string, unknown> {
  return { apps: defaultAppsList(), source: "manual", view: "buttons", variant: "solid", showIcon: true, showBadge: true };
}

const isKnownApp = (v: unknown): v is SubscriptionApp => typeof v === "string" && (subscriptionApps as readonly string[]).includes(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Reads (and repairs) the loose props of an `apps` node. Unknown apps and duplicates are dropped. */
export function readApps(props: Record<string, unknown>): AppsProps {
  const seen = new Set<string>();
  const apps: AppsNodeApp[] = [];
  for (const raw of Array.isArray(props.apps) ? props.apps : []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (!isKnownApp(r.app) || seen.has(r.app)) continue;
    seen.add(r.app);
    apps.push({
      app: r.app,
      label: str(r.label),
      iconUrl: str(r.iconUrl),
      deepLinkTemplate: str(r.deepLinkTemplate),
      useEncrypted: r.useEncrypted === true,
      enabled: r.enabled !== false,
    });
  }
  const cols = Number(props.cols);
  return {
    apps,
    source: props.source === "config" ? "config" : "manual",
    view: oneOf(props.view, ["buttons", "tiles", "list"] as const, "buttons"),
    variant: oneOf(props.variant, ["solid", "outline", "ghost"] as const, "solid"),
    showIcon: props.showIcon !== false,
    showBadge: props.showBadge !== false,
    cols: Number.isFinite(cols) && cols > 0 ? Math.min(6, Math.floor(cols)) : undefined,
  };
}

/** A synthetic "Add to app" block for the node's own list, so it resolves exactly like the classic block. */
export function buildAppsBlock(list: AppsNodeApp[]): BlockAddToApp {
  return {
    id: "apps-node",
    enabled: true,
    kind: "add-to-app",
    preferJsonUrl: false,
    buttons: list.map((a, i) => ({
      id: `apps-${i}-${a.app}`,
      app: a.app,
      enabled: a.enabled !== false,
      label: a.label ?? "",
      iconUrl: a.iconUrl ?? "",
      platforms: [],
      deepLinkTemplate: a.deepLinkTemplate ?? "",
      useEncrypted: a.useEncrypted === true,
    })),
  };
}

export type AppsItem = { id: string; label: string; href: string; iconUrl: string; badge: string };

/**
 * The buttons an `apps` node shows. "manual" resolves the node's own list through the same code as the classic
 * add-to-app block (real per-client deep links); "config" mirrors the `apps` context variable (the config's block).
 */
export function resolveNodeApps(p: AppsProps, data: AddToAppData, tgProxyLinks: string[], ctxApps: unknown): AppsItem[] {
  if (p.source === "config") {
    return (Array.isArray(ctxApps) ? ctxApps : [])
      .map((a) => a as Record<string, unknown>)
      .filter((a) => a && typeof a.url === "string" && a.url)
      .map((a, i) => ({ id: String(a.id ?? i), label: String(a.label ?? ""), href: String(a.url), iconUrl: String(a.iconUrl ?? ""), badge: String(a.badge ?? "") }));
  }
  return resolveAddToAppButtons(buildAppsBlock(p.apps), data, tgProxyLinks).map((r) => ({ id: r.id, label: r.label, href: r.href, iconUrl: r.iconUrl ?? "", badge: r.badge ?? "" }));
}
