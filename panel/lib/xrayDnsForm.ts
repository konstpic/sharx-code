/**
 * Parse/serialize the Xray `dns` object for the template GUI.
 * `dns: null` means "custom DNS disabled". Everything the form does not model is preserved.
 */
import { isRec, type Rec } from "./jsonPath";

function randomId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    const a = new Uint8Array(6);
    globalThis.crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A DNS server entry: either a bare address string or a full object. */
export type DnsServerRow = { id: string; value: string | Rec };

/** A static host mapping: pattern -> address(es) or another domain. */
export type DnsHostRow = {
  id: string;
  key: string;
  values: string[];
  /** The value was written as a JSON array (kept even for a single entry). */
  asArray: boolean;
};

export type DnsFormState = {
  enabled: boolean;
  servers: DnsServerRow[];
  hosts: DnsHostRow[];
  /** Every other top-level key (tag, clientIp, queryStrategy, disableCache, …). */
  raw: Rec;
};

export const DNS_DEFAULT_SERVERS: (string | Rec)[] = [
  { address: "1.1.1.1", port: 53, domains: ["geosite:geolocation-!cn"], expectIPs: ["geoip:!cn"] },
  { address: "1.1.1.1", port: 53, domains: ["geosite:cn"], expectIPs: ["geoip:cn"] },
];

export function newServerRow(value: string | Rec = "1.1.1.1"): DnsServerRow {
  return { id: randomId(), value };
}

export function newHostRow(key = "", values: string[] = [""]): DnsHostRow {
  return { id: randomId(), key, values, asArray: false };
}

export function defaultDnsForm(): DnsFormState {
  return {
    enabled: false,
    servers: DNS_DEFAULT_SERVERS.map((s) => newServerRow(JSON.parse(JSON.stringify(s)) as Rec)),
    hosts: [newHostRow("host.docker.internal", ["127.0.0.1"])],
    raw: { queryStrategy: "UseIP", tag: "dns_inbound" },
  };
}

export function parseDnsSection(sectionJson: string): { state: DnsFormState; error: string | null } {
  const t = sectionJson.trim();
  if (t === "" || t === "null" || t === "undefined") {
    return { state: { ...defaultDnsForm(), enabled: false }, error: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(sectionJson) as unknown;
  } catch {
    return { state: defaultDnsForm(), error: "invalid" };
  }
  if (parsed === null) return { state: { ...defaultDnsForm(), enabled: false }, error: null };
  if (!isRec(parsed)) return { state: defaultDnsForm(), error: "not-object" };

  const servers: DnsServerRow[] = [];
  if (Array.isArray(parsed.servers)) {
    for (const s of parsed.servers) {
      if (typeof s === "string" || isRec(s)) servers.push(newServerRow(s));
    }
  }
  const hosts: DnsHostRow[] = [];
  if (isRec(parsed.hosts)) {
    for (const [key, v] of Object.entries(parsed.hosts)) {
      if (Array.isArray(v)) hosts.push({ id: randomId(), key, values: v.map(String), asArray: true });
      else if (v != null) hosts.push({ id: randomId(), key, values: [String(v)], asArray: false });
    }
  }
  const raw: Rec = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k !== "servers" && k !== "hosts") raw[k] = v;
  }
  return { state: { enabled: true, servers, hosts, raw }, error: null };
}

export function serializeDnsSection(state: DnsFormState): string {
  if (!state.enabled) return "null";
  const out: Rec = { servers: state.servers.map((s) => s.value) };
  const hosts: Rec = {};
  for (const h of state.hosts) {
    const key = h.key.trim();
    const values = h.values.map((v) => v.trim()).filter(Boolean);
    if (!key || values.length === 0) continue;
    hosts[key] = values.length === 1 && !h.asArray ? values[0] : values;
  }
  out.hosts = hosts;
  for (const [k, v] of Object.entries(state.raw)) {
    if (v !== undefined) out[k] = v;
  }
  return JSON.stringify(out, null, 2);
}
