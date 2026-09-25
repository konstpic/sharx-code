/**
 * Parse/serialize the Xray `outbounds` array for the template GUI.
 * Unknown/complex outbounds are preserved as raw objects (round-trip).
 */

function randomId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    const a = new Uint8Array(8);
    globalThis.crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `ob-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const OUTBOUND_PROTOCOL_OPTIONS = [
  "freedom",
  "blackhole",
  "dns",
  "http",
  "socks",
  "shadowsocks",
  "vmess",
  "vless",
  "trojan",
  "wireguard",
  "loopback",
] as const;

export type OutboundProtocolOption = (typeof OUTBOUND_PROTOCOL_OPTIONS)[number];

/** VLESS `settings.vnext[0].users[0].flow` — Xray common values. */
export const OUTBOUND_VLESS_FLOW_OPTIONS = ["", "xtls-rprx-vision", "xtls-rprx-vision-udp443"] as const;

/** XTLS flow is incompatible with XHTTP and non-TCP transports (Xray VLESS docs). */
export function vlessOutboundFlowAllowed(network: string, security: string): boolean {
  if (network === "xhttp") return false;
  if (network !== "tcp") return false;
  return security === "tls" || security === "reality";
}

export function effectiveVlessOutboundFlow(network: string, security: string, flow: string): string {
  return vlessOutboundFlowAllowed(network, security) ? flow.trim() : "";
}

/** Xray `streamSettings.network` (outbound). */
export const OUTBOUND_STREAM_NETWORK_OPTIONS = [
  "tcp",
  "ws",
  "grpc",
  "quic",
  "http",
  "h2",
  "kcp",
  "xhttp",
  "httpupgrade",
  "splithttp",
] as const;

/** Xray `streamSettings.security` (outbound). */
export const OUTBOUND_STREAM_SECURITY_OPTIONS = ["none", "tls", "reality"] as const;

export type OutboundFormRow = {
  id: string;
  tag: string;
  protocol: string;
  /** Raw Xray outbound object; edited by GUI and serialized as-is. */
  raw: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function cloneOb(ob: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(ob)) as Record<string, unknown>;
}

/**
 * New outbound: freedom, tag from prefix (direct / proxy-N).
 */
export function newOutboundRow(protocol: string = "freedom"): OutboundFormRow {
  const tag =
    protocol === "blackhole"
      ? "blocked"
      : protocol === "freedom"
        ? "direct"
        : `out-${randomId().slice(0, 6)}`;
  const base: Record<string, unknown> = { tag, protocol, settings: defaultSettingsFor(protocol) };
  if (needsStreamSettings(protocol)) {
    base.streamSettings = { network: "tcp", security: "none" };
  }
  return { id: randomId(), tag, protocol, raw: base };
}

function defaultSettingsFor(protocol: string): Record<string, unknown> {
  switch (protocol) {
    case "freedom":
      return { domainStrategy: "AsIs", redirect: "" };
    case "blackhole":
      return {};
    case "dns":
      return { network: "tcp", address: "1.1.1.1", port: 53 };
    case "http":
      return { servers: [{ uri: "http://127.0.0.1:0" }] };
    case "socks":
      return { servers: [{ address: "127.0.0.1", port: 1080 }], userLevel: 0 };
    case "shadowsocks":
      return { servers: [{ address: "127.0.0.1", port: 443, method: "aes-256-gcm", password: "" }] };
    case "vmess":
      return {
        vnext: [
          { address: "127.0.0.1", port: 443, users: [{ id: "", alterId: 0, security: "auto" }] },
        ],
      };
    case "vless":
      return {
        vnext: [
          { address: "127.0.0.1", port: 443, users: [{ id: "", encryption: "none", flow: "" }] },
        ],
      };
    case "trojan":
      return {
        servers: [{ address: "127.0.0.1", port: 443, password: "" }],
      };
    case "wireguard":
      return {
        address: "10.0.0.2",
        peers: [{ publicKey: "", endpoint: "127.0.0.1:51820" }],
        mtu: 1420,
      };
    case "loopback":
      return { inboundTag: "api" };
    default:
      return {};
  }
}

function needsStreamSettings(protocol: string): boolean {
  return ["http", "socks", "shadowsocks", "vmess", "vless", "trojan"].includes(protocol);
}

/**
 * Parse `outbounds` key content (array JSON string).
 */
export function parseOutboundsSection(sectionJson: string): {
  rows: OutboundFormRow[] | null;
  error: string | null;
} {
  if (!sectionJson.trim() || sectionJson.trim() === "null") {
    return { rows: [newOutboundRow("freedom")], error: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sectionJson) as unknown;
  } catch {
    return { rows: null, error: "invalid" };
  }
  if (!Array.isArray(parsed)) {
    return { rows: null, error: "not-array" };
  }
  const rows: OutboundFormRow[] = [];
  for (const item of parsed) {
    const ob = asRecord(item);
    if (!ob) continue;
    const tag = typeof ob.tag === "string" ? ob.tag : "";
    const protocol = typeof ob.protocol === "string" ? ob.protocol : "freedom";
    rows.push({ id: randomId(), tag, protocol, raw: cloneOb(ob) });
  }
  if (rows.length === 0) {
    return { rows: [newOutboundRow("freedom")], error: null };
  }
  return { rows, error: null };
}

export function serializeOutboundsSection(rows: OutboundFormRow[]): string {
  const arr = rows.map((r) => {
    const o = cloneOb(r.raw);
    o.tag = r.tag.trim() || "outbound";
    o.protocol = r.protocol;
    return o;
  });
  return JSON.stringify(arr, null, 2);
}

export function updateRowProtocol(row: OutboundFormRow, protocol: string): OutboundFormRow {
  const next: OutboundFormRow = {
    ...row,
    protocol,
    raw: {
      ...cloneOb(row.raw),
      protocol,
      settings: defaultSettingsFor(protocol),
    },
  };
  if (needsStreamSettings(protocol)) {
    const prevStream = asRecord(row.raw.streamSettings) ?? {};
    next.raw.streamSettings = Object.keys(prevStream).length
      ? prevStream
      : { network: "tcp", security: "none" };
  } else {
    delete next.raw.streamSettings;
  }
  if (row.tag) next.raw.tag = row.tag;
  return next;
}

export function patchRowRaw(row: OutboundFormRow, raw: Record<string, unknown>): OutboundFormRow {
  const tag = typeof raw.tag === "string" ? raw.tag : row.tag;
  const protocol = typeof raw.protocol === "string" ? raw.protocol : row.protocol;
  return { ...row, tag, protocol, raw: cloneOb(raw) };
}

export function moveRow(rows: OutboundFormRow[], from: number, to: number): OutboundFormRow[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = rows.slice();
  const [r] = next.splice(from, 1);
  next.splice(to, 0, r);
  return next;
}

/**
 * Freedom blocks private destinations for client inbounds by default (Xray 26.6+). This allow rule opens only the LAN
 * ranges. Loopback (127/8) and link-local (169.254/16, cloud metadata) stay blocked on purpose: through them a client
 * could reach the node's own services, including the Xray API.
 */
export const FREEDOM_LAN_ALLOW_IPS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"];

function isLanAllowRule(rule: unknown): boolean {
  if (typeof rule !== "object" || rule === null) return false;
  const r = rule as Record<string, unknown>;
  if (String(r.action ?? "").toLowerCase() !== "allow" || !Array.isArray(r.ip)) return false;
  const ips = new Set((r.ip as unknown[]).map((v) => String(v)));
  return ips.size === FREEDOM_LAN_ALLOW_IPS.length && FREEDOM_LAN_ALLOW_IPS.every((v) => ips.has(v));
}

/** Whether the freedom outbound settings carry the panel's "allow private networks" rule. */
export function freedomAllowsLan(settings: Record<string, unknown>): boolean {
  return Array.isArray(settings.finalRules) && settings.finalRules.some(isLanAllowRule);
}

/** Adds or removes the "allow private networks" rule; other finalRules are kept. */
export function withFreedomLanAllowed(settings: Record<string, unknown>, on: boolean): Record<string, unknown> {
  const others = (Array.isArray(settings.finalRules) ? settings.finalRules : []).filter((r) => !isLanAllowRule(r));
  const rules = on ? [...others, { action: "allow", ip: [...FREEDOM_LAN_ALLOW_IPS] }] : others;
  const next: Record<string, unknown> = { ...settings };
  if (rules.length > 0) next.finalRules = rules;
  else delete next.finalRules;
  return next;
}
