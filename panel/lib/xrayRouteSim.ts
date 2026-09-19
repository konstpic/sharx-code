/**
 * Offline model of Xray's routing decision for one test connection.
 * geosite / geoip data is not available in the browser, so those tags are resolved from a small
 * built-in table and from "assume this tag matches" toggles; anything else is reported as unknown.
 */
import { isRec, type Rec } from "./jsonPath";

export type SimRequest = {
  /** Destination domain (empty when the destination is a bare IP). */
  domain: string;
  /** Destination IP, or the IP the domain resolved to (optional). */
  ip: string;
  port: string;
  /** "" = not specified. */
  network: "" | "tcp" | "udp";
  /** Sniffed protocol: "", http, tls, quic, bittorrent. */
  protocol: string;
  inboundTag: string;
  sourceIp: string;
  user: string;
};

export type SimCheck = {
  cond: "domain" | "ip" | "port" | "network" | "protocol" | "inboundTag" | "source" | "user" | "attrs" | "unsupported";
  ok: boolean;
  /** What matched / why not (short, English; the UI shows the condition name). */
  detail: string;
};

export type SimVerdict = {
  matched: boolean;
  checks: SimCheck[];
  /** geosite:/geoip:/ext: tags that could not be evaluated and would change the result if assumed. */
  unknownTags: string[];
};

export type SimTarget =
  | { kind: "outbound"; tag: string }
  | { kind: "balancer"; tag: string }
  | { kind: "default"; tag: string }
  | { kind: "none"; tag: "" };

export type SimResult = {
  /** One verdict per rule up to and including the first match. */
  steps: { index: number; verdict: SimVerdict }[];
  matchedIndex: number;
  target: SimTarget;
};

// ---- geo knowledge ---------------------------------------------------------------------------

const KNOWN_GEOSITE: Record<string, string[]> = {
  "google.com": ["geosite:google"],
  "gstatic.com": ["geosite:google"],
  "youtube.com": ["geosite:youtube", "geosite:google"],
  "googlevideo.com": ["geosite:youtube", "geosite:google"],
  "ytimg.com": ["geosite:youtube", "geosite:google"],
  "t.me": ["geosite:telegram"],
  "telegram.org": ["geosite:telegram"],
  "telegram.me": ["geosite:telegram"],
  "openai.com": ["geosite:openai"],
  "chatgpt.com": ["geosite:openai"],
  "netflix.com": ["geosite:netflix"],
  "nflxvideo.net": ["geosite:netflix"],
  "apple.com": ["geosite:apple"],
  "icloud.com": ["geosite:apple"],
  "microsoft.com": ["geosite:microsoft"],
  "live.com": ["geosite:microsoft"],
  "github.com": ["geosite:github"],
  "githubusercontent.com": ["geosite:github"],
  "facebook.com": ["geosite:facebook"],
  "instagram.com": ["geosite:facebook"],
  "fbcdn.net": ["geosite:facebook"],
  "tiktok.com": ["geosite:tiktok"],
  "spotify.com": ["geosite:spotify"],
  "yandex.ru": ["geosite:category-ru"],
  "vk.com": ["geosite:category-ru"],
  "mail.ru": ["geosite:category-ru"],
  "ozon.ru": ["geosite:category-ru"],
  "baidu.com": ["geosite:cn"],
  "qq.com": ["geosite:cn"],
  "taobao.com": ["geosite:cn"],
  "bilibili.com": ["geosite:cn"],
  "doubleclick.net": ["geosite:category-ads-all"],
  "googlesyndication.com": ["geosite:category-ads-all"],
  "googleadservices.com": ["geosite:category-ads-all"],
};

function hostMatches(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

/** geosite tags that are known to contain this domain (best effort). */
export function knownGeositeTags(domain: string): string[] {
  const host = domain.trim().toLowerCase();
  if (!host) return [];
  const out = new Set<string>();
  for (const [base, tags] of Object.entries(KNOWN_GEOSITE)) {
    if (hostMatches(host, base)) tags.forEach((t) => out.add(t));
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal") || !host.includes(".")) {
    out.add("geosite:private");
  }
  if (host.endsWith(".ru") || host.endsWith(".su") || host.endsWith(".рф")) out.add("geosite:category-ru");
  if (host.endsWith(".cn")) out.add("geosite:cn");
  if (!out.has("geosite:cn") && !out.has("geosite:private")) out.add("geosite:geolocation-!cn");
  return [...out];
}

// ---- IP helpers ------------------------------------------------------------------------------

type ParsedIp = { v: 4 | 6; bytes: number[] };

export function parseIp(input: string): ParsedIp | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const parts = s.split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { v: 4, bytes: parts };
  }
  if (s.includes(":")) {
    let head = s;
    let tail = "";
    const compressed = s.includes("::");
    if (compressed) {
      const [h, t] = s.split("::");
      head = h ?? "";
      tail = t ?? "";
    }
    const toGroups = (part: string) => (part ? part.split(":") : []);
    const hg = toGroups(head);
    const tg = toGroups(tail);
    const missing = compressed ? 8 - hg.length - tg.length : 0;
    if (missing < 0 || (!compressed && hg.length !== 8)) return null;
    const groups = [...hg, ...Array<string>(missing).fill("0"), ...tg];
    if (groups.length !== 8) return null;
    const bytes: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      const n = parseInt(g, 16);
      bytes.push(n >> 8, n & 255);
    }
    return { v: 6, bytes };
  }
  return null;
}

function sameBytes(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const target = parseIp(ip);
  if (!target) return false;
  const [base, bitsRaw] = cidr.split("/");
  const b = parseIp(base ?? "");
  if (!b || b.v !== target.v) return false;
  const total = b.v === 4 ? 32 : 128;
  const bits = bitsRaw === undefined ? total : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > total) return false;
  const full = Math.floor(bits / 8);
  for (let i = 0; i < full; i++) if (target.bytes[i] !== b.bytes[i]) return false;
  const rem = bits % 8;
  if (rem === 0) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return ((target.bytes[full] ?? 0) & mask) === ((b.bytes[full] ?? 0) & mask);
}

const PRIVATE_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

export function isPrivateIp(ip: string): boolean {
  return PRIVATE_CIDRS.some((c) => ipInCidr(ip, c));
}

// ---- rule matching ---------------------------------------------------------------------------

function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v == null) return [];
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function portMatches(spec: string, port: string): boolean {
  const p = Number(port);
  if (!Number.isFinite(p) || port.trim() === "") return false;
  for (const part of spec.split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    if (seg.includes("-")) {
      const [a, b] = seg.split("-").map((x) => Number(x.trim()));
      if (Number.isFinite(a) && Number.isFinite(b) && p >= (a as number) && p <= (b as number)) return true;
    } else if (Number(seg) === p) {
      return true;
    }
  }
  return false;
}

function domainPatternMatches(pattern: string, host: string, assumed: Set<string>, unknown: Set<string>): boolean {
  const h = host.toLowerCase();
  if (pattern.startsWith("geosite:")) {
    const tag = pattern.toLowerCase();
    if (assumed.has(tag)) return true;
    if (tag === "geosite:private" && knownGeositeTags(h).includes("geosite:private")) return true;
    unknown.add(pattern);
    return false;
  }
  if (pattern.startsWith("ext:")) {
    if (assumed.has(pattern.toLowerCase())) return true;
    unknown.add(pattern);
    return false;
  }
  if (pattern.startsWith("full:")) return h === pattern.slice(5).toLowerCase();
  if (pattern.startsWith("domain:")) return hostMatches(h, pattern.slice(7).toLowerCase());
  if (pattern.startsWith("keyword:")) return h.includes(pattern.slice(8).toLowerCase());
  if (pattern.startsWith("regexp:")) {
    try {
      return new RegExp(pattern.slice(7), "i").test(h);
    } catch {
      return false;
    }
  }
  // A bare string is a substring match in Xray.
  return h.includes(pattern.toLowerCase());
}

function ipPatternMatches(pattern: string, ip: string, assumed: Set<string>, unknown: Set<string>): boolean {
  if (pattern.startsWith("geoip:")) {
    const tag = pattern.toLowerCase();
    if (tag === "geoip:private") return isPrivateIp(ip);
    if (assumed.has(tag)) return true;
    unknown.add(pattern);
    return false;
  }
  if (pattern.startsWith("ext:")) {
    if (assumed.has(pattern.toLowerCase())) return true;
    unknown.add(pattern);
    return false;
  }
  if (pattern.includes("/")) return ipInCidr(ip, pattern);
  const a = parseIp(pattern);
  const b = parseIp(ip);
  return !!a && !!b && a.v === b.v && sameBytes(a.bytes, b.bytes);
}

export function evaluateRule(rule: Rec, req: SimRequest, assumed: Set<string>, domainStrategy: string): SimVerdict {
  const checks: SimCheck[] = [];
  const unknown = new Set<string>();

  const domains = toList(rule.domain);
  if (domains.length) {
    if (!req.domain.trim()) {
      checks.push({ cond: "domain", ok: false, detail: "no domain in the request" });
    } else {
      const hit = domains.find((p) => domainPatternMatches(p, req.domain, assumed, unknown));
      checks.push({ cond: "domain", ok: !!hit, detail: hit ?? "none of the patterns match" });
    }
  }

  const ips = toList(rule.ip);
  if (ips.length) {
    if (!req.ip.trim()) {
      const resolves = domainStrategy !== "AsIs" && req.domain.trim() !== "";
      checks.push({
        cond: "ip",
        ok: false,
        detail: resolves ? "domain not resolved — enter the resolved IP to test IP rules" : "destination is a domain and domainStrategy is AsIs",
      });
    } else {
      const hit = ips.find((p) => ipPatternMatches(p, req.ip.trim(), assumed, unknown));
      checks.push({ cond: "ip", ok: !!hit, detail: hit ?? "none of the ranges match" });
    }
  }

  if (rule.port != null && String(rule.port).trim() !== "") {
    const ok = portMatches(String(rule.port), req.port);
    checks.push({ cond: "port", ok, detail: String(rule.port) });
  }

  const networks = toList(rule.network).map((n) => n.toLowerCase());
  if (networks.length) {
    checks.push({ cond: "network", ok: req.network !== "" && networks.includes(req.network), detail: networks.join(", ") });
  }

  const protocols = toList(rule.protocol).map((p) => p.toLowerCase());
  if (protocols.length) {
    checks.push({ cond: "protocol", ok: req.protocol !== "" && protocols.includes(req.protocol.toLowerCase()), detail: protocols.join(", ") });
  }

  const inbounds = toList(rule.inboundTag);
  if (inbounds.length) {
    checks.push({ cond: "inboundTag", ok: req.inboundTag !== "" && inbounds.includes(req.inboundTag), detail: inbounds.join(", ") });
  }

  const sources = toList(rule.source);
  if (sources.length) {
    const ok = req.sourceIp.trim() !== "" && sources.some((p) => ipPatternMatches(p, req.sourceIp.trim(), assumed, unknown));
    checks.push({ cond: "source", ok, detail: sources.join(", ") });
  }

  const users = toList(rule.user);
  if (users.length) {
    checks.push({ cond: "user", ok: req.user.trim() !== "" && users.includes(req.user.trim()), detail: users.join(", ") });
  }

  if (rule.attrs != null) {
    checks.push({ cond: "attrs", ok: req.protocol.toLowerCase() === "http", detail: "needs HTTP traffic with matching attributes (not simulated further)" });
  }
  const unsupported = ["sourcePort", "localIP", "localPort", "process", "vlessRoute"].filter((k) => rule[k] != null);
  if (unsupported.length) {
    checks.push({ cond: "unsupported", ok: false, detail: `${unsupported.join(", ")} not simulated` });
  }

  return { matched: checks.every((c) => c.ok), checks, unknownTags: [...unknown] };
}

export function simulateRouting(routing: unknown, defaultOutboundTag: string, req: SimRequest, assumed: Set<string>): SimResult {
  const r = isRec(routing) ? routing : {};
  const rules = Array.isArray(r.rules) ? r.rules.filter(isRec) : [];
  const strategy = typeof r.domainStrategy === "string" ? r.domainStrategy : "AsIs";
  const steps: SimResult["steps"] = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    const verdict = evaluateRule(rule, req, assumed, strategy);
    steps.push({ index: i, verdict });
    if (verdict.matched) {
      const ot = typeof rule.outboundTag === "string" ? rule.outboundTag.trim() : "";
      const bt = typeof rule.balancerTag === "string" ? rule.balancerTag.trim() : "";
      const target: SimTarget = ot ? { kind: "outbound", tag: ot } : bt ? { kind: "balancer", tag: bt } : { kind: "none", tag: "" };
      return { steps, matchedIndex: i, target };
    }
  }
  return {
    steps,
    matchedIndex: -1,
    target: defaultOutboundTag ? { kind: "default", tag: defaultOutboundTag } : { kind: "none", tag: "" },
  };
}

/** Every geosite:/geoip:/ext: tag mentioned by the rules (offered as "assume match" toggles). */
export function collectGeoTags(routing: unknown): string[] {
  const r = isRec(routing) ? routing : {};
  const rules = Array.isArray(r.rules) ? r.rules.filter(isRec) : [];
  const out = new Set<string>();
  for (const rule of rules) {
    for (const key of ["domain", "ip", "source"]) {
      for (const p of toList(rule[key])) {
        if (/^(geosite|geoip|ext):/i.test(p) && p.toLowerCase() !== "geoip:private" && p.toLowerCase() !== "geosite:private") out.add(p);
      }
    }
  }
  return [...out];
}

/** Tags to pre-select for a request: known geosite membership of the domain. */
export function autoAssumedTags(req: SimRequest, referenced: string[]): Set<string> {
  const known = new Set(knownGeositeTags(req.domain).map((t) => t.toLowerCase()));
  const out = new Set<string>();
  for (const tag of referenced) if (known.has(tag.toLowerCase())) out.add(tag.toLowerCase());
  return out;
}
