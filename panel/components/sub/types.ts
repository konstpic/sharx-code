import type { SharxSubpageConfig } from "@/lib/sharxSubpageConfig";

export type PublicSubUser = {
  shortUuid: string;
  username?: string;
  daysLeft: number;
  trafficUsed: string;
  trafficLimit: string;
  expiresAt: string;
  isActive: boolean;
  userStatus: string;
  /** True when the VPN session is in Xray's current online set (not the same as account ACTIVE). */
  isOnline?: boolean;
};

export type PublicSubPayload = {
  config: SharxSubpageConfig | Record<string, unknown>;
  configUuid: string;
  /** Raw subscription feed URL (e.g. /sub/...) for VPN apps. */
  subscriptionUrl: string;
  /** Optional HTML subscription landing page when it differs from subscriptionUrl. */
  subscriptionPageUrl?: string;
  subscriptionJsonUrl: string;
  links: string[];
  user: PublicSubUser;
  /** Optional deep-link URL for Happ (happ://crypt4/...). */
  happEncryptedUrl?: string;
  /** Optional deep-link URL for v2rayTun (v2raytun://crypt/...). */
  v2raytunEncryptedUrl?: string;
  /**
   * Telemt MTProto share links (tg://proxy?... or tg://webproxy?...) for the HTML page only.
   * Not included in the raw VPN subscription feed (`links`).
   */
  mtProtoLinks?: string[];
};

export type SupportKind = "telegram" | "discord" | "vk" | "generic";

export function supportKindFromUrl(url: string): SupportKind {
  const u = url.toLowerCase();
  if (u.includes("t.me") || u.includes("telegram")) return "telegram";
  if (u.includes("discord")) return "discord";
  if (u.includes("vk.com") || u.includes("vkontakte")) return "vk";
  return "generic";
}

/** Subscription lines for Telemt MTProto (TCP and WEB). Splits each entry on newlines (API may bundle several lines). */
export function extractTgProxyLinks(links: string[]): string[] {
  const out: string[] = [];
  for (const raw of links) {
    for (const part of raw.split("\n")) {
      const s = part.trim();
      if (/^tg:\/\/(?:web)?proxy\?/i.test(s)) out.push(s);
    }
  }
  return out;
}

/** Prefer server-provided `mtProtoLinks`; fallback parse from `links` (legacy). */
export function resolveMtProtoLinks(data: Pick<PublicSubPayload, "mtProtoLinks" | "links">): string[] {
  const fromApi = data.mtProtoLinks;
  if (fromApi && fromApi.length > 0) return fromApi;
  return extractTgProxyLinks(data.links ?? []);
}

/** Human-readable label for a Telegram proxy link (server host or fallback index). */
export function tgProxyDisplayLabel(link: string, index: number): string {
  const q = link.indexOf("?");
  if (q >= 0) {
    const server = new URLSearchParams(link.slice(q + 1)).get("server");
    if (server?.trim()) {
      try {
        return decodeURIComponent(server.trim());
      } catch {
        return server.trim();
      }
    }
  }
  const title = parseLinkTitle(link);
  if (title && title !== link) return title;
  return `Proxy ${index + 1}`;
}

export function parseLinkTitle(url: string): string {
  const i = url.lastIndexOf("#");
  if (i >= 0 && i < url.length - 1) {
    const raw = url.slice(i + 1).trim();
    try {
      const decoded = decodeURIComponent(raw);
      return decoded || url;
    } catch {
      return raw || url;
    }
  }
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export const MOCK_WIREGUARD_SUB_LINK =
  "WireGuard (UDP) — preview sample\n\n" +
  "Endpoint: 203.0.113.1:51820\n\n" +
  "Client DNS: 1.1.1.1\n" +
  "Server public key: YF+7b0X9pQ2nHk8vL3mR6sT1uW4xZ7aB0cD5eF8gH1=\n\n" +
  "[Interface]\n" +
  "PrivateKey = cO7nHk8vL3mR6sT1uW4xZ7aB0cD5eF8gH1iJ4kL7mN0=\n" +
  "Address = 10.8.0.2/32\n" +
  "DNS = 1.1.1.1\n\n" +
  "[Peer]\n" +
  "PublicKey = YF+7b0X9pQ2nHk8vL3mR6sT1uW4xZ7aB0cD5eF8gH1=\n" +
  "Endpoint = 203.0.113.1:51820\n" +
  "AllowedIPs = 0.0.0.0/0, ::/0\n";

export const MOCK_SUB_DATA: PublicSubPayload = {
  config: {} as SharxSubpageConfig,
  configUuid: "preview",
  subscriptionUrl: "https://example.com/sub/abcdef12345/?preview=1",
  subscriptionJsonUrl: "https://example.com/sub/json/abcdef12345/?preview=1",
  links: [
    "vless://00000000-0000-0000-0000-000000000000@example.com:443?type=tcp&security=reality&pbk=demo&sid=00#Main%20Fast",
    "vless://00000000-0000-0000-0000-000000000000@example.com:443?type=ws&security=tls&path=/demo#Backup",
    "trojan://demo-password@example.com:443?security=tls#Backup%20TLS",
    MOCK_WIREGUARD_SUB_LINK,
  ],
  user: {
    shortUuid: "preview",
    username: "alice@example.com",
    daysLeft: 17,
    trafficUsed: "12.4 GB",
    trafficLimit: "100 GB",
    expiresAt: new Date(Date.now() + 17 * 86400 * 1000).toISOString(),
    isActive: true,
    userStatus: "ACTIVE",
    isOnline: false,
  },
};
