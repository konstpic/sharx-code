import {
  APP_CATALOG,
  filterAppsForSubscriptionProtocol,
  normalizeAddToAppBlock,
  type AppButton,
  type BlockAddToApp,
} from "./sharxSubpageConfig";
import { amneziaVpnKeyDisplayLabel, firstAmneziaVpnImportLink, listAmneziaVpnImportItems } from "./amneziaVpnImportLink";
import { tgProxyDisplayLabel } from "../components/sub/types";

export type RenderedButton = {
  id: string;
  label: string;
  href: string;
  iconUrl?: string;
  platforms?: string[];
  badge?: string;
  /** The catalog app this button belongs to. */
  app?: string;
};

function base64Url(input: string): string {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(input)));
  }
  return Buffer.from(input, "utf-8").toString("base64");
}

type SubstitutionVars = {
  url: string;
  urlEncoded: string;
  b64Url: string;
  urlJson: string;
  urlJsonEncoded: string;
  firstLink: string;
  happEncrypted: string;
  v2raytunEncrypted: string;
};

function substitute(template: string, vars: SubstitutionVars): string {
  return template
    .replace(/\{url\}/g, vars.url)
    .replace(/\{urlEncoded\}/g, vars.urlEncoded)
    .replace(/\{b64Url\}/g, vars.b64Url)
    .replace(/\{urlJson\}/g, vars.urlJson)
    .replace(/\{urlJsonEncoded\}/g, vars.urlJsonEncoded)
    .replace(/\{firstLink\}/g, vars.firstLink)
    .replace(/\{happEncrypted\}/g, vars.happEncrypted)
    .replace(/\{v2raytunEncrypted\}/g, vars.v2raytunEncrypted);
}

/** Build substitution context for a given block from the public sub payload. */
function makeSubstitutionVars(opts: {
  subscriptionUrl: string;
  subscriptionJsonUrl?: string;
  happEncryptedUrl?: string;
  v2raytunEncryptedUrl?: string;
  preferJsonUrl?: boolean;
  app?: AppButton["app"];
  links?: string[];
}): SubstitutionVars {
  const catalog = opts.app ? APP_CATALOG[opts.app] : undefined;
  const preferJson =
    (opts.preferJsonUrl || catalog?.preferJsonUrl) && opts.subscriptionJsonUrl;
  const base = preferJson ? opts.subscriptionJsonUrl! : opts.subscriptionUrl;
  const firstLink = firstAmneziaVpnImportLink(opts.links ?? []);
  return {
    url: base,
    urlEncoded: encodeURIComponent(base),
    b64Url: base ? base64Url(base) : "",
    urlJson: opts.subscriptionJsonUrl ?? "",
    urlJsonEncoded: opts.subscriptionJsonUrl
      ? encodeURIComponent(opts.subscriptionJsonUrl)
      : "",
    firstLink: firstLink ?? "",
    happEncrypted: opts.happEncryptedUrl ?? "",
    v2raytunEncrypted: opts.v2raytunEncryptedUrl ?? "",
  };
}

/** Resolve one {@link AppButton} into rendered button(s) (label + final href). */
function renderButtons(
  button: AppButton,
  vars: SubstitutionVars,
  tgProxyLinks: string[],
  subscriptionJsonUrl: string | undefined,
  subLinks: string[],
): RenderedButton[] {
  if (button.enabled === false) return [];
  const catalog = APP_CATALOG[button.app];
  const label = button.label?.trim() || catalog?.label || button.app;
  const iconUrl = button.iconUrl?.trim() || catalog?.iconUrl || "";

  if (button.app === "amneziawg") {
    return [];
  }

  if (button.app === "amneziavpn") {
    const keys = listAmneziaVpnImportItems(subLinks)
      .filter((item): item is Extract<typeof item, { kind: "link" }> => item.kind === "link")
      .map((item) => item.link);
    if (keys.length === 0) return [];
    return keys.map((href, i) => ({
      id: keys.length > 1 ? `${button.id}-${i}` : button.id,
      label: keys.length > 1 ? `${label} · ${amneziaVpnKeyDisplayLabel(href, i)}` : label,
      href,
      iconUrl,
      platforms: button.platforms,
    }));
  }

  if (button.app === "telegram") {
    if (tgProxyLinks.length === 0) return [];
    return tgProxyLinks.map((href, i) => ({
      id: tgProxyLinks.length > 1 ? `${button.id}-${i}` : button.id,
      label: tgProxyLinks.length > 1 ? `${label} · ${tgProxyDisplayLabel(href, i)}` : label,
      href,
      iconUrl,
      platforms: button.platforms,
    }));
  }

  // Prefer encrypted-specific shortcuts when admin opted in and server gave us one.
  if (button.useEncrypted && catalog?.supportsEncrypted) {
    if (button.app === "happ" && vars.happEncrypted) {
      return [
        {
          id: button.id,
          label,
          href: vars.happEncrypted,
          iconUrl,
          platforms: button.platforms,
          badge: "E2E",
        },
      ];
    }
    if (button.app === "v2raytun" && vars.v2raytunEncrypted) {
      return [
        {
          id: button.id,
          label,
          href: vars.v2raytunEncrypted,
          iconUrl,
          platforms: button.platforms,
          badge: "E2E",
        },
      ];
    }
  }

  const template =
    (button.deepLinkTemplate && button.deepLinkTemplate.trim()) ||
    catalog?.deepLinkTemplate ||
    "{url}";
  if (button.app === "sing-box" && !subscriptionJsonUrl) {
    return [];
  }
  const href = substitute(template, vars);
  if (!href) return [];
  return [
    {
      id: button.id,
      label,
      href,
      iconUrl,
      platforms: button.platforms,
    },
  ];
}


export type AddToAppData = {
  subscriptionUrl?: string;
  subscriptionJsonUrl?: string;
  happEncryptedUrl?: string;
  v2raytunEncryptedUrl?: string;
  links?: string[];
};

/**
 * The buttons of the classic "Add to app" block, resolved for one client: the admin's per-app label, icon, template,
 * encrypted links and platforms, filtered by the protocols the subscription really contains. The designer's `apps`
 * variable is built from this, so the layout's app buttons match the classic block exactly.
 */
export function resolveAddToAppButtons(block: BlockAddToApp, data: AddToAppData, tgProxyLinks: string[]): RenderedButton[] {
  if (!data.subscriptionUrl) return [];
  const normalized = normalizeAddToAppBlock(block);
  const links = data.links ?? [];
  const buttons = filterAppsForSubscriptionProtocol(normalized.buttons ?? [], links);
  return buttons.flatMap((b) =>
    renderButtons(
      b,
      makeSubstitutionVars({
        subscriptionUrl: data.subscriptionUrl ?? "",
        subscriptionJsonUrl: data.subscriptionJsonUrl,
        happEncryptedUrl: data.happEncryptedUrl,
        v2raytunEncryptedUrl: data.v2raytunEncryptedUrl,
        preferJsonUrl: normalized.preferJsonUrl,
        app: b.app,
        links,
      }),
      tgProxyLinks,
      data.subscriptionJsonUrl,
      links,
    ).map((r) => ({ ...r, app: b.app })),
  );
}
