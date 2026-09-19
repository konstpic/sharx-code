/**
 * Simplified Xray `routing` editor: domainStrategy + field rules; balancers / complex rules → advanced JSON.
 */

export type FieldRuleFormRow = {
  id: string;
  outboundTag: string;
  /** Rule targets a balancer instead of an outbound (mutually exclusive with outboundTag). */
  balancerTag: string;
  /** one entry per line: domain lines (geosite:, domain:, full:, etc.) */
  domainLines: string;
  /** one CIDR/entry per line (geoip:, ip:, etc.) */
  ipLines: string;
  port: string;
  network: string;
  /** e.g. bittorrent */
  protocolLines: string;
  /** comma or newline separated inbound tags */
  inboundTag: string;
  source: string;
  user: string;
  /** Keys the form does not model (attrs, domainMatcher, sourcePort, localIP, ruleTag, …) kept verbatim. */
  extra: Record<string, unknown>;
  /** How the source JSON wrote these values, so an untouched rule serializes byte-for-byte equivalent. */
  shape?: { inboundTag?: "string"; port?: "string" };
};

/** A routing balancer kept as a raw object so unknown strategy fields survive editing. */
export type BalancerRow = {
  id: string;
  raw: Record<string, unknown>;
};

export type RoutingFormState = {
  domainStrategy: string;
  rules: FieldRuleFormRow[];
  balancers: BalancerRow[];
  /** Unmodeled top-level routing keys (domainMatcher, …) kept verbatim. */
  extra: Record<string, unknown>;
};

const MODELED_RULE_KEYS = new Set([
  "type",
  "outboundTag",
  "balancerTag",
  "domain",
  "ip",
  "port",
  "network",
  "protocol",
  "inboundTag",
  "source",
  "user",
]);

const MODELED_TOP_KEYS = new Set(["domainStrategy", "rules", "balancers"]);

function randomId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    const a = new Uint8Array(6);
    globalThis.crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function linesFromArray(a: unknown): string {
  if (!Array.isArray(a)) return "";
  return a.map((x) => String(x)).join("\n");
}

function stringArrayToLines(s: string): string[] {
  return s
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Split a multi-value form field (newline / comma / semicolon separated) into trimmed entries. */
export function splitRoutingList(s: string): string[] {
  return s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const NON_CONDITION_EXTRA_KEYS = new Set(["ruleTag", "webhook"]);

/** True when the rule has no match condition, i.e. it matches every connection. */
export function isCatchAllRule(row: FieldRuleFormRow): boolean {
  if (Object.keys(row.extra).some((k) => !NON_CONDITION_EXTRA_KEYS.has(k))) return false;
  return !(
    row.domainLines.trim() ||
    row.ipLines.trim() ||
    row.port.trim() ||
    row.network.trim() ||
    row.protocolLines.trim() ||
    row.inboundTag.trim() ||
    row.source.trim() ||
    row.user.trim()
  );
}

export function newEmptyRule(): FieldRuleFormRow {
  return {
    id: randomId(),
    outboundTag: "",
    balancerTag: "",
    domainLines: "",
    ipLines: "",
    port: "",
    network: "",
    protocolLines: "",
    inboundTag: "",
    source: "",
    user: "",
    extra: {},
  };
}

export function newBalancer(tag = ""): BalancerRow {
  return { id: randomId(), raw: { tag, selector: [] } };
}

function isPrimitive(v: unknown): boolean {
  return v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * The visual editor keeps every key it does not model, so only structurally unusable routing
 * (not an object, `rules` not an array, a rule that is not an object, or a modeled field holding
 * nested objects) is sent to the advanced JSON editor.
 */
export function routingNeedsAdvancedJson(routing: unknown): boolean {
  const o = asRecord(routing);
  if (!o) return true;
  if (o.rules != null && !Array.isArray(o.rules)) return true;
  if (o.balancers != null) {
    if (!Array.isArray(o.balancers)) return true;
    for (const b of o.balancers) if (!asRecord(b)) return true;
  }
  for (const r of (o.rules as unknown[] | undefined) ?? []) {
    const m = asRecord(r);
    if (!m) return true;
    const t = m.type;
    if (t != null && t !== "field") return true;
    for (const k of MODELED_RULE_KEYS) {
      if (k === "type") continue;
      const v = m[k];
      if (v == null) continue;
      if (Array.isArray(v)) {
        if (!v.every(isPrimitive)) return true;
      } else if (!isPrimitive(v)) {
        return true;
      }
    }
  }
  return false;
}

function ruleToFormRow(m: Record<string, unknown>, id: string): FieldRuleFormRow {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (!MODELED_RULE_KEYS.has(k)) extra[k] = v;
  }
  const shape: NonNullable<FieldRuleFormRow["shape"]> = {};
  if (typeof m.inboundTag === "string") shape.inboundTag = "string";
  if (typeof m.port === "string") shape.port = "string";
  return {
    id,
    shape: Object.keys(shape).length ? shape : undefined,
    outboundTag: typeof m.outboundTag === "string" ? m.outboundTag : "",
    balancerTag: typeof m.balancerTag === "string" ? m.balancerTag : "",
    domainLines: linesFromArray(m.domain),
    ipLines: linesFromArray(m.ip),
    port: m.port != null ? String(m.port) : "",
    network: m.network != null ? String(m.network) : "",
    protocolLines: linesFromArray(m.protocol),
    inboundTag: (() => {
      const it = m.inboundTag;
      if (it == null) return "";
      if (Array.isArray(it)) return it.map(String).join(", ");
      return String(it);
    })(),
    source: linesFromArray(m.source),
    user: Array.isArray(m.user) ? m.user.map(String).join(", ") : m.user != null ? String(m.user) : "",
    extra,
  };
}

function formRowToRule(row: FieldRuleFormRow): Record<string, unknown> | null {
  const otag = row.outboundTag.trim();
  const btag = row.balancerTag.trim();
  const hasAny =
    otag ||
    btag ||
    row.domainLines.trim() ||
    row.ipLines.trim() ||
    row.port.trim() ||
    row.network.trim() ||
    row.protocolLines.trim() ||
    row.inboundTag.trim() ||
    row.source.trim() ||
    row.user.trim() ||
    Object.keys(row.extra).length > 0;
  if (!hasAny) return null;
  const r: Record<string, unknown> = { type: "field" };
  if (otag) r.outboundTag = otag;
  else if (btag) r.balancerTag = btag;
  const d = stringArrayToLines(row.domainLines);
  if (d.length) r.domain = d;
  const ips = stringArrayToLines(row.ipLines);
  if (ips.length) r.ip = ips;
  if (row.port.trim()) {
    const n = Number(row.port);
    r.port = Number.isFinite(n) && row.shape?.port !== "string" ? n : row.port.trim();
  }
  if (row.network.trim()) r.network = row.network.trim();
  const prot = stringArrayToLines(row.protocolLines);
  if (prot.length) r.protocol = prot;
  if (row.inboundTag.trim()) {
    const tags = splitRoutingList(row.inboundTag);
    r.inboundTag = tags.length === 1 && row.shape?.inboundTag === "string" ? tags[0] : tags;
  }
  const src = stringArrayToLines(row.source);
  if (src.length) r.source = src;
  const users = stringArrayToLines(row.user);
  if (users.length) r.user = users;
  for (const [k, v] of Object.entries(row.extra)) r[k] = v;
  return r;
}

export const DEFAULT_DOMAIN_STRATEGIES = ["AsIs", "IPIfNonMatch", "IPOnDemand"] as const;

export function defaultRoutingForm(): RoutingFormState {
  return {
    domainStrategy: "AsIs",
    rules: [
      {
        ...newEmptyRule(),
        outboundTag: "direct",
        ipLines: "geoip:private",
      },
    ],
    balancers: [],
    extra: {},
  };
}

/**
 * @param sectionJson `routing` key JSON
 */
export function parseRoutingSection(sectionJson: string): {
  state: RoutingFormState | null;
  needsAdvanced: boolean;
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sectionJson) as unknown;
  } catch {
    return { state: null, needsAdvanced: true, error: "invalid" };
  }
  const o = asRecord(parsed);
  if (!o) {
    return { state: null, needsAdvanced: true, error: "not-object" };
  }
  if (routingNeedsAdvancedJson(o)) {
    return { state: null, needsAdvanced: true, error: null };
  }
  const ds = typeof o.domainStrategy === "string" ? o.domainStrategy : "AsIs";
  const rules: FieldRuleFormRow[] = [];
  if (Array.isArray(o.rules)) {
    for (const r of o.rules) {
      const m = asRecord(r);
      if (m) rules.push(ruleToFormRow(m, randomId()));
    }
  }
  const balancers: BalancerRow[] = [];
  if (Array.isArray(o.balancers)) {
    for (const b of o.balancers) {
      const m = asRecord(b);
      if (m) balancers.push({ id: randomId(), raw: { ...m } });
    }
  }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!MODELED_TOP_KEYS.has(k)) extra[k] = v;
  }
  return {
    state: { domainStrategy: ds, rules, balancers, extra },
    needsAdvanced: false,
    error: null,
  };
}

export function serializeRoutingSection(state: RoutingFormState): string {
  const rules = state.rules.map((row) => formRowToRule(row)).filter((x): x is Record<string, unknown> => x != null);
  const out: Record<string, unknown> = { domainStrategy: state.domainStrategy, ...state.extra, rules };
  if (state.balancers.length > 0) out.balancers = state.balancers.map((b) => b.raw);
  return JSON.stringify(out, null, 2);
}

export function analyzeRoutingSection(sectionJson: string): "visual" | "advanced" {
  const { needsAdvanced } = parseRoutingSection(sectionJson);
  return needsAdvanced ? "advanced" : "visual";
}
