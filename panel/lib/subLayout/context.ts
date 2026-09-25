import { resolveAddToAppButtons } from "../addToAppButtons";
import { APP_CATALOG, subscriptionApps, type BlockAddToApp, type SubscriptionApp } from "../sharxSubpageConfig";
import { dictFor, type Dict } from "./i18nCollect";
import { formatBytes, type Ctx } from "./template";

/** The subset of the public subscription payload the designer reads (kept structural: no import of UI types). */
export type LayoutData = {
  config?: unknown;
  subscriptionUrl?: string;
  subscriptionPageUrl?: string;
  subscriptionJsonUrl?: string;
  happEncryptedUrl?: string;
  v2raytunEncryptedUrl?: string;
  links?: string[];
  mtProtoLinks?: string[];
  user?: Record<string, unknown>;
  devices?: { enabled?: boolean; max?: number; count?: number; items?: Record<string, unknown>[] };
};

export type ContextOptions = {
  lang?: string;
  /** Designer preview: `page.preview` is true. */
  preview?: boolean;
  /** "mobile" | "tablet" | "desktop" while editing, "" on the public page. */
  device?: string;
  vars?: Record<string, string>;
  branding?: { title?: string; logoUrl?: string; brandText?: string; supportUrl?: string };
  pageUrl?: string;
  /** Apps to expose as `apps` / `app.<id>` (default: the config's deepLinks.enabledApps). */
  enabledApps?: string[];
  /** The config's classic "Add to app" block: when given, `apps` mirrors it (labels, icons, templates, encrypted links, protocol filter). */
  addToApp?: BlockAddToApp | null;
  /** The document's translations; exposed as `tr.<key>` in the visitor's language. */
  i18n?: Dict;
  /** Bundled texts of the visitor's language for the ready-made elements (see locales/). */
  bundledTr?: Record<string, string>;
};

function b64(s: string): string {
  try {
    return typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : "";
  } catch {
    return "";
  }
}

function linkProtocol(link: string): string {
  const m = /^([a-z0-9+.-]+):\/\//i.exec(link.trim());
  return m ? m[1].toLowerCase() : link.includes("[Interface]") ? "wireguard" : "";
}

function linkTitle(link: string): string {
  const i = link.lastIndexOf("#");
  if (i >= 0 && i < link.length - 1) {
    const raw = link.slice(i + 1).trim();
    try {
      return decodeURIComponent(raw.replace(/\?serverDescription=.*$/, ""));
    } catch {
      return raw;
    }
  }
  try {
    return new URL(link).hostname || link.slice(0, 40);
  } catch {
    return link.split("\n")[0].slice(0, 60);
  }
}

function linkHost(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return "";
  }
}

/** Fills the placeholders of an app's deep link template the way the classic "Add to app" block does. */
export function appDeepLink(app: SubscriptionApp, d: LayoutData): string {
  const cat = APP_CATALOG[app];
  if (!cat || !cat.deepLinkTemplate) return "";
  const feed = (cat.preferJsonUrl && d.subscriptionJsonUrl ? d.subscriptionJsonUrl : d.subscriptionUrl) ?? "";
  const first = (d.links ?? []).find((l) => /^(vless|vmess|trojan|ss|vpn):\/\//i.test(l.trim())) ?? "";
  return cat.deepLinkTemplate
    .replace(/\{url\}/g, feed)
    .replace(/\{urlEncoded\}/g, encodeURIComponent(feed))
    .replace(/\{b64Url\}/g, feed ? b64(feed) : "")
    .replace(/\{urlJson\}/g, d.subscriptionJsonUrl ?? "")
    .replace(/\{urlJsonEncoded\}/g, d.subscriptionJsonUrl ? encodeURIComponent(d.subscriptionJsonUrl) : "")
    .replace(/\{firstLink\}/g, first.trim())
    .replace(/\{happEncrypted\}/g, d.happEncryptedUrl ?? "")
    .replace(/\{v2raytunEncrypted\}/g, d.v2raytunEncryptedUrl ?? "");
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Builds the variable context used by templates and conditions. See the variables panel for what each name means. */
export function buildLayoutContext(d: LayoutData, opts: ContextOptions = {}): Ctx {
  const u = (d.user ?? {}) as Record<string, unknown>;
  const used = num(u.trafficUsedBytes);
  const limit = num(u.trafficLimitBytes);
  const unlimited = limit <= 0;
  const percent = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const daysLeft = num(u.daysLeft);
  const neverExpires = daysLeft >= 9000;

  const links = (d.links ?? []).map((url, index) => ({ index, number: index + 1, url, title: linkTitle(url), protocol: linkProtocol(url), host: linkHost(url) }));
  const mtProto = (d.mtProtoLinks ?? []).map((url, index) => ({ index, number: index + 1, url, title: linkTitle(url) || `Proxy ${index + 1}`, protocol: "mtproto" }));

  const dev = d.devices ?? {};
  const items = (dev.items ?? []).map((it, index) => ({
    index,
    number: index + 1,
    os: String(it.os ?? ""),
    model: String(it.model ?? ""),
    osVersion: String(it.osVersion ?? ""),
    name: [String(it.model ?? ""), String(it.os ?? "")].filter(Boolean).join(" · ") || "Device",
    firstSeenAt: num(it.firstSeenAt),
    lastSeenAt: num(it.lastSeenAt),
    active: it.active !== false,
  }));
  const max = num(dev.max);
  const count = dev.count !== undefined ? num(dev.count) : items.length;

  const enabledApps = (opts.enabledApps && opts.enabledApps.length ? opts.enabledApps : (subscriptionApps as readonly string[]).filter((a) => a !== "custom")) as SubscriptionApp[];
  const appList: Record<string, unknown>[] = [];
  const app: Record<string, unknown> = {};
  if (opts.addToApp) {
    const rendered = resolveAddToAppButtons(
      opts.addToApp,
      { subscriptionUrl: d.subscriptionUrl, subscriptionJsonUrl: d.subscriptionJsonUrl, happEncryptedUrl: d.happEncryptedUrl, v2raytunEncryptedUrl: d.v2raytunEncryptedUrl, links: d.links },
      d.mtProtoLinks ?? [],
    );
    for (const r of rendered) {
      const entry = { id: r.app ?? r.id, label: r.label, iconUrl: r.iconUrl ?? "", url: r.href, platforms: r.platforms ?? [], badge: r.badge ?? "" };
      appList.push(entry);
      const key = String(r.app ?? r.id).replace(/-/g, "_");
      if (!(key in app)) app[key] = entry;
    }
  } else
  for (const id of enabledApps) {
    const cat = APP_CATALOG[id];
    if (!cat) continue;
    const url = appDeepLink(id, d);
    if (!url) continue;
    const entry = { id, label: cat.label, iconUrl: cat.iconUrl, url, platforms: cat.platforms };
    appList.push(entry);
    app[id.replace(/-/g, "_")] = entry;
  }

  const ctx: Ctx = {
    user: {
      ...u,
      username: String(u.username ?? ""),
      isActive: u.isActive === true,
      isOnline: u.isOnline === true,
      daysLeft,
      neverExpires,
      trafficUsedBytes: used,
      trafficLimitBytes: limit,
      unlimited,
      percentUsed: percent,
      remainingBytes: unlimited ? 0 : Math.max(0, limit - used),
      remaining: unlimited ? "∞" : formatBytes(Math.max(0, limit - used)),
      group: String(u.group ?? ""),
      createdAt: num(u.createdAt),
      lastOnline: num(u.lastOnline),
    },
    subscription: {
      url: d.subscriptionUrl ?? "",
      jsonUrl: d.subscriptionJsonUrl ?? "",
      pageUrl: d.subscriptionPageUrl ?? d.subscriptionUrl ?? "",
      happUrl: d.happEncryptedUrl ?? "",
      v2raytunUrl: d.v2raytunEncryptedUrl ?? "",
    },
    links,
    mtProto,
    devices: { enabled: dev.enabled === true, max, count, left: max > 0 ? Math.max(0, max - count) : 0, unlimited: max <= 0, items },
    apps: appList,
    app,
    branding: { title: opts.branding?.title ?? "", logoUrl: opts.branding?.logoUrl ?? "", brandText: opts.branding?.brandText ?? "", supportUrl: opts.branding?.supportUrl ?? "" },
    page: { url: opts.pageUrl ?? d.subscriptionPageUrl ?? "", preview: opts.preview === true, device: opts.device ?? "", lang: opts.lang ?? "en" },
    vars: opts.vars ?? {},
    tr: dictFor(opts.i18n, opts.lang ?? "en", opts.bundledTr),
    now: Date.now(),
  };
  return ctx;
}

export type VariableInfo = {
  path: string;
  /** i18n-less English description; the designer translates by path. */
  hint: string;
  group: "user" | "traffic" | "subscription" | "devices" | "links" | "apps" | "page" | "vars";
  kind?: "list";
};

/** Catalogue for the variables panel (paths are what goes between {{ }}). */
export const VARIABLE_CATALOG: VariableInfo[] = [
  { path: "user.username", hint: "Client name", group: "user" },
  { path: "user.userStatus", hint: "ACTIVE, EXPIRED, LIMITED or DISABLED", group: "user" },
  { path: "user.isActive", hint: "Account is active (yes / no)", group: "user" },
  { path: "user.isOnline", hint: "Connected right now", group: "user" },
  { path: "user.group", hint: "Group name", group: "user" },
  { path: "user.daysLeft", hint: "Days until expiry (9999 = never)", group: "user" },
  { path: "user.expiresAt", hint: "Expiry date (use | date)", group: "user" },
  { path: "user.neverExpires", hint: "No expiry date", group: "user" },
  { path: "user.createdAt", hint: "Created (use | date)", group: "user" },
  { path: "user.lastOnline", hint: "Last seen (use | ago)", group: "user" },
  { path: "user.shortUuid", hint: "Subscription id", group: "user" },
  { path: "user.trafficUsed", hint: "Traffic used, e.g. 12.4 GB", group: "traffic" },
  { path: "user.trafficLimit", hint: "Traffic limit or ∞", group: "traffic" },
  { path: "user.remaining", hint: "Traffic left", group: "traffic" },
  { path: "user.percentUsed", hint: "Used, percent (0-100)", group: "traffic" },
  { path: "user.unlimited", hint: "No traffic limit", group: "traffic" },
  { path: "user.trafficUsedBytes", hint: "Used, bytes (for progress)", group: "traffic" },
  { path: "user.trafficLimitBytes", hint: "Limit, bytes (for progress)", group: "traffic" },
  { path: "user.lifetimeTrafficUsed", hint: "Traffic used in total", group: "traffic" },
  { path: "subscription.url", hint: "Subscription URL for apps", group: "subscription" },
  { path: "subscription.jsonUrl", hint: "JSON subscription URL", group: "subscription" },
  { path: "subscription.pageUrl", hint: "This page's URL", group: "subscription" },
  { path: "subscription.happUrl", hint: "Encrypted Happ link", group: "subscription" },
  { path: "subscription.v2raytunUrl", hint: "Encrypted v2rayTun link", group: "subscription" },
  { path: "devices.enabled", hint: "Device limit is on", group: "devices" },
  { path: "devices.count", hint: "Devices connected", group: "devices" },
  { path: "devices.max", hint: "Device limit (0 = unlimited)", group: "devices" },
  { path: "devices.left", hint: "Free device slots", group: "devices" },
  { path: "devices.items", hint: "List of devices", group: "devices", kind: "list" },
  { path: "links", hint: "List of subscription links", group: "links", kind: "list" },
  { path: "mtProto", hint: "List of Telegram proxy links", group: "links", kind: "list" },
  { path: "apps", hint: "List of apps with their add-to-app links", group: "apps", kind: "list" },
  { path: "app.happ.url", hint: "Add to Happ link (app.<id>.url)", group: "apps" },
  { path: "branding.title", hint: "Page title", group: "page" },
  { path: "branding.supportUrl", hint: "Support URL", group: "page" },
  { path: "page.lang", hint: "Language of the visitor", group: "page" },
  { path: "now", hint: "Current time", group: "page" },
];

/** Fields of the items in list variables (shown in the panel and offered inside #each / repeat). */
export const LIST_ITEM_FIELDS: Record<string, { path: string; hint: string }[]> = {
  links: [
    { path: "title", hint: "Link name" },
    { path: "url", hint: "The link itself" },
    { path: "protocol", hint: "vless, trojan ..." },
    { path: "host", hint: "Server host" },
    { path: "number", hint: "Position, from 1" },
  ],
  mtProto: [
    { path: "title", hint: "Proxy name" },
    { path: "url", hint: "tg:// link" },
    { path: "number", hint: "Position, from 1" },
  ],
  "devices.items": [
    { path: "name", hint: "Model · OS" },
    { path: "model", hint: "Device model" },
    { path: "os", hint: "Operating system" },
    { path: "osVersion", hint: "OS version" },
    { path: "lastSeenAt", hint: "Last seen (use | ago)" },
    { path: "firstSeenAt", hint: "First seen (use | date)" },
    { path: "active", hint: "Active" },
    { path: "number", hint: "Position, from 1" },
  ],
  apps: [
    { path: "label", hint: "App name" },
    { path: "url", hint: "Add to app link" },
    { path: "iconUrl", hint: "App icon" },
    { path: "id", hint: "App id" },
  ],
};

/** Name of a repeat source → the context path that holds the list. */
export function repeatSourcePath(source: string): string {
  switch (source) {
    case "devices":
      return "devices.items";
    case "links":
      return "links";
    case "apps":
      return "apps";
    case "mtProto":
      return "mtProto";
    default:
      return source;
  }
}
