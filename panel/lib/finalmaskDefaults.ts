/**
 * `streamSettings.finalmask` structural editor support (Xray-core 26.10.31).
 *
 * The panel keeps every mask's `settings` as a plain JSON object in form state
 * (so unknown/advanced keys survive a round-trip) and only renders well-known
 * fields from the metadata registry below.
 *
 * Facts this file encodes (verified against the kernel, mirrored by
 * `util/finalmask/finalmask.go`):
 *  - tcp[] types: header-custom, fragment, sudoku, xmc, filter
 *  - udp[] types: header-custom, mkcp-legacy, noise, salamander, sudoku,
 *    xdns, xicmp, realm, udphop, filter
 *  - the first array element is the outermost layer
 *  - xicmp/udphop must be the last udp[] entry (socket-replacing masks)
 *  - `type` is case-insensitive; unknown settings keys are ignored by the core
 *
 * The inbound editor exposes only a fixed subset (`UI_TCP_TYPES` /
 * `UI_UDP_TYPES`): TLS fragmentation, QUIC obfuscation and port hopping. Every
 * other registry type is preserved verbatim on save (lossless round-trip) and
 * is editable only through the JSON templates.
 *
 * `finalmaskSidesFor` mirrors `util/finalmask/transport.go: SidesFor` so the
 * panel hides (and the validator rejects) masks on transports that cannot
 * carry them.
 */

export type FinalmaskSide = "tcp" | "udp";

/** One mask entry: `type` + raw settings object (kept lossless). */
export type FMItem = {
  type: string;
  settings: Record<string, unknown>;
};

/** The subset of StreamFormState that describes finalmask. */
export type FinalmaskState = {
  finalmaskTcp: FMItem[];
  finalmaskUdp: FMItem[];
  /** Pretty JSON string; empty = no quicParams block. */
  finalmaskQuicParams: string;
};

export type FinalmaskSeverity = "error" | "warning";

export type FinalmaskIssue = {
  /** Dotted/bracketed path inside streamSettings.finalmask. */
  path: string;
  message: string;
  severity: FinalmaskSeverity;
  /** Stable rule id (mirrors the Go validator codes). */
  code: string;
};

export type FinalmaskFieldKind = "string" | "number" | "bool" | "enum" | "list" | "json";

export type FinalmaskField = {
  name: string;
  label: string;
  kind: FinalmaskFieldKind;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  hint?: string;
};

export type FinalmaskTypeDef = {
  side: FinalmaskSide;
  type: string;
  label: string;
  /** May only be used on a server (inbound) side. */
  serverOnly?: boolean;
  /** Client-only mask; an inbound save is rejected by the core/panel. */
  clientOnly?: boolean;
  /** Emitted by subscription `fm=` share links (3x-ui compatible whitelist). */
  linkSupported: boolean;
  fields: FinalmaskField[];
  preset: Record<string, unknown>;
  hint?: string;
};

export const FINALMASK_TYPES: readonly FinalmaskTypeDef[] = [
  // ---- TCP -----------------------------------------------------------------
  {
    side: "tcp",
    type: "header-custom",
    label: "header-custom",
    linkSupported: true,
    hint: "Exactly one of packet / rand / reuse / transform must be set.",
    fields: [
      { name: "packet", label: "packet (JSON)", kind: "json", placeholder: '{"type":"tls","settings":{}}' },
      { name: "rand", label: "rand (JSON)", kind: "json", placeholder: '{"length":"100-200"}' },
      { name: "reuse", label: "reuse (JSON)", kind: "json", placeholder: '{"type":"..."}' },
      { name: "transform", label: "transform (JSON)", kind: "json", placeholder: '{"type":"..."}' },
    ],
    preset: { packet: { type: "tls" } },
  },
  {
    side: "tcp",
    type: "fragment",
    label: "fragment",
    linkSupported: true,
    hint: "Lengths are ranges like \"100-200\"; the minimum must be greater than 0.",
    fields: [
      { name: "lengths", label: "lengths", kind: "list", required: true, placeholder: "100-200, 150-250" },
      { name: "delays", label: "delays", kind: "list", placeholder: "1-2, 3-4" },
    ],
    preset: { lengths: ["100-200"], delays: ["1-2"] },
  },
  {
    side: "tcp",
    type: "sudoku",
    label: "sudoku",
    linkSupported: true,
    fields: [{ name: "password", label: "password", kind: "string", required: true, placeholder: "secret" }],
    preset: { password: "" },
  },
  {
    side: "tcp",
    type: "xmc",
    label: "xmc (Minecraft)",
    linkSupported: true,
    hint: "profiles[].username must be 3-16 chars of [A-Za-z0-9_].",
    fields: [
      { name: "hostname", label: "hostname", kind: "string", required: true, placeholder: "mc.example.com" },
      { name: "password", label: "password", kind: "string", required: true, placeholder: "secret" },
      {
        name: "profiles",
        label: "profiles (JSON array)",
        kind: "json",
        required: true,
        placeholder: '[{"username":"steve_1","uuid":"..."}]',
      },
    ],
    preset: { hostname: "", password: "", profiles: [{ username: "", uuid: "" }] },
  },
  {
    side: "tcp",
    type: "filter",
    label: "filter",
    serverOnly: true,
    linkSupported: false,
    hint: "Server-side only; never emitted to clients.",
    fields: [],
    preset: {},
  },

  // ---- UDP -----------------------------------------------------------------
  {
    side: "udp",
    type: "header-custom",
    label: "header-custom",
    linkSupported: true,
    fields: [
      {
        name: "mode",
        label: "mode",
        kind: "enum",
        options: ["", "prefix", "standalone"],
        placeholder: "standard",
      },
    ],
    preset: { mode: "" },
  },
  {
    side: "udp",
    type: "mkcp-legacy",
    label: "mkcp-legacy",
    linkSupported: false,
    fields: [
      {
        name: "header",
        label: "header",
        kind: "enum",
        required: true,
        options: ["dns", "dtls", "srtp", "utp", "wechat", "wireguard"],
      },
    ],
    preset: { header: "dtls" },
  },
  {
    side: "udp",
    type: "noise",
    label: "noise",
    linkSupported: false,
    hint: "Each item: {type: \"\",str,hex,base64,exp, packet, delay}. `exp` requires core 26.9.30+.",
    fields: [
      {
        name: "noise",
        label: "noise (JSON array)",
        kind: "json",
        required: true,
        placeholder: '[{"type":"str","packet":"hello"}]',
      },
    ],
    preset: { noise: [{ type: "str", packet: "hello" }] },
  },
  {
    side: "udp",
    type: "salamander",
    label: "salamander",
    linkSupported: true,
    hint: "Hysteria obfuscation PSK; at least 4 bytes.",
    fields: [{ name: "password", label: "password", kind: "string", required: true, placeholder: "strongpsk" }],
    preset: { password: "" },
  },
  {
    side: "udp",
    type: "sudoku",
    label: "sudoku",
    linkSupported: true,
    fields: [{ name: "password", label: "password", kind: "string", required: true, placeholder: "secret" }],
    preset: { password: "" },
  },
  {
    side: "udp",
    type: "xdns",
    label: "xdns",
    linkSupported: false,
    hint: "domains[].names requires core 26.10.10+.",
    fields: [
      {
        name: "domains",
        label: "domains (JSON array)",
        kind: "json",
        required: true,
        placeholder: '[{"names":["example.com"]}]',
      },
    ],
    preset: { domains: [{ names: ["example.com"] }] },
  },
  {
    side: "udp",
    type: "xicmp",
    label: "xicmp",
    linkSupported: false,
    hint: "Socket-replacing mask: must be the last udp[] entry.",
    fields: [],
    preset: {},
  },
  {
    side: "udp",
    type: "realm",
    label: "realm",
    linkSupported: true,
    fields: [
      { name: "url", label: "url", kind: "string", required: true, placeholder: "realm://example.com" },
      { name: "stunServers", label: "stunServers", kind: "list", required: true, placeholder: "stun.example.com:3478" },
    ],
    preset: { url: "realm://example.com", stunServers: ["stun.example.com:3478"] },
  },
  {
    side: "udp",
    type: "udphop",
    label: "udphop",
    clientOnly: true,
    linkSupported: true,
    hint:
      "Client-side mask: kept in the inbound for share links, stripped from the node config. Must be the last udp[] entry; DNAT the remote port range to the inbound port on the node.",
    fields: [
      {
        name: "mode",
        label: "mode",
        kind: "enum",
        required: true,
        options: ["intervalremote", "intervallocal", "perconnremote"],
      },
      { name: "interval", label: "interval (sec)", kind: "number", required: true, placeholder: "30" },
      { name: "remoteIPs", label: "remoteIPs", kind: "list", required: true, placeholder: "1.2.3.4" },
      { name: "remotePorts", label: "remotePorts", kind: "string", required: true, placeholder: "20000-30000" },
    ],
    preset: { mode: "intervalremote", interval: 30, remoteIPs: [], remotePorts: "" },
  },
  {
    side: "udp",
    type: "filter",
    label: "filter",
    serverOnly: true,
    linkSupported: false,
    hint: "Server-side only; never emitted to clients.",
    fields: [],
    preset: {},
  },
];

const LINK_TCP_WHITELIST = new Set(["header-custom", "fragment", "sudoku", "xmc"]);
const LINK_UDP_WHITELIST = new Set(["salamander", "udphop", "sudoku", "realm", "header-custom"]);
const SOCKET_REPLACING = new Set(["xicmp", "udphop"]);

/**
 * Mask types rendered by the compact inbound editor. Everything else stays in
 * the config untouched (see `countFinalmaskMasksOutsideEditor`).
 */
export const UI_TCP_TYPES = ["fragment"] as const;
export const UI_UDP_TYPES = ["salamander", "udphop"] as const;

const UI_TCP_SET = new Set<string>(UI_TCP_TYPES);
const UI_UDP_SET = new Set<string>(UI_UDP_TYPES);

function normType(type: unknown): string {
  return typeof type === "string" ? type.trim().toLowerCase() : "";
}

/** True when the editor renders an editable card for this mask. */
export function isUiFinalmaskType(side: FinalmaskSide, type: string): boolean {
  return side === "tcp" ? UI_TCP_SET.has(normType(type)) : UI_UDP_SET.has(normType(type));
}

/**
 * Masks stored in the config that the compact editor does not render: types
 * outside the UI subset, duplicate entries of a UI type (only the first is
 * edited) and — when a transport context is given — every mask on a side the
 * transport cannot carry (the whole card is hidden there).
 */
export function countFinalmaskMasksOutsideEditor(
  state: FinalmaskState,
  query?: FinalmaskSidesQuery,
): number {
  const sides = query ? finalmaskSidesFor(query) : { tcp: true, udp: true };
  const countSide = (side: FinalmaskSide, items: FMItem[], allowed: boolean): number => {
    if (!allowed) return items.length;
    const seen = new Set<string>();
    let hidden = 0;
    for (const item of items) {
      const type = normType(item.type);
      if (!isUiFinalmaskType(side, type)) {
        hidden += 1;
      } else if (seen.has(type)) {
        hidden += 1;
      } else {
        seen.add(type);
      }
    }
    return hidden;
  };
  return (
    countSide("tcp", state.finalmaskTcp, sides.tcp) + countSide("udp", state.finalmaskUdp, sides.udp)
  );
}

// ---- transport matrix (mirror of util/finalmask/transport.go) ---------------

export type FinalmaskSides = { tcp: boolean; udp: boolean };

export type FinalmaskSidesQuery = {
  protocol?: string | null;
  network?: string | null;
  /** `streamSettings.security` (“tls” enables the ALPN h3 QUIC path). */
  security?: string | null;
  /** `streamSettings.tlsSettings.alpn` as a form string or a token list. */
  alpn?: string | readonly string[] | null;
};

/** Panel/3x-ui transport aliases → kernel names. */
export function normalizeFinalmaskNetwork(network: unknown): string {
  switch (typeof network === "string" ? network.trim().toLowerCase() : "") {
    case "raw":
      return "tcp";
    case "mkcp":
      return "kcp";
    case "splithttp":
      return "xhttp";
    case "websocket":
      return "ws";
    default:
      return typeof network === "string" ? network.trim().toLowerCase() : "";
  }
}

function alpnTokens(alpn: FinalmaskSidesQuery["alpn"]): string[] {
  const values = Array.isArray(alpn) ? alpn : [alpn ?? ""];
  return values
    .flatMap((value) => String(value).split(/[,\s;]+/))
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * The kernel compares ALPN to "h3" case-sensitively and only takes the QUIC
 * path when it is exactly one "h3" entry: "H3" stays on the TCP path,
 * ["h3", "h2"] negotiates h2/TCP and h3-29 is not accepted.
 */
export function alpnIsH3Only(alpn: FinalmaskSidesQuery["alpn"]): boolean {
  const tokens = alpnTokens(alpn);
  return tokens.length === 1 && tokens[0] === "h3";
}

/**
 * xhttp runs over QUIC only with TLS + exactly ["h3"]; its dialer then calls
 * FinalMask.DialUDP, so UDP masks apply and TCP masks are a no-op.
 */
export function finalmaskUsesQuic(query: FinalmaskSidesQuery): boolean {
  const security = typeof query.security === "string" ? query.security.trim().toLowerCase() : "";
  return (
    security === "tls" &&
    normalizeFinalmaskNetwork(query.network) === "xhttp" &&
    alpnIsH3Only(query.alpn)
  );
}

/**
 * Which finalmask sides a protocol/transport can carry (kernel 26.10.31):
 *
 *   wireguard                   -> UDP only (InboundsPage still hides the block)
 *   amneziawg|telemt            -> none
 *   hysteria|hysteria2          -> UDP only (network ignored)
 *   tcp|ws|httpupgrade|grpc     -> TCP only
 *   xhttp                       -> TCP only; TLS + exactly ["h3"] -> UDP only (QUIC)
 *   kcp (hysteria network)      -> UDP only
 *   quic|h2|h3|http             -> none (removed from the kernel)
 *   masque                      -> both
 *   xdrive                      -> TCP only (dials through FinalMask.DialTCP)
 *   empty/unknown               -> TCP only (kernel default is raw/tcp)
 *
 * ALPN is ignored unless security is "tls": h3 without TLS is impossible.
 */
export function finalmaskSidesFor(query: FinalmaskSidesQuery): FinalmaskSides {
  const protocol = typeof query.protocol === "string" ? query.protocol.trim().toLowerCase() : "";
  switch (protocol) {
    case "wireguard":
      return { tcp: false, udp: true };
    case "amneziawg":
    case "telemt":
      return { tcp: false, udp: false };
    case "hysteria":
    case "hysteria2":
      return { tcp: false, udp: true };
    default:
      break;
  }
  switch (normalizeFinalmaskNetwork(query.network)) {
    case "tcp":
    case "ws":
    case "httpupgrade":
    case "grpc":
      return { tcp: true, udp: false };
    case "xhttp":
      return finalmaskUsesQuic(query) ? { tcp: false, udp: true } : { tcp: true, udp: false };
    case "kcp":
    case "hysteria":
      return { tcp: false, udp: true };
    case "quic":
    case "h2":
    case "h3":
    case "http":
      return { tcp: false, udp: false };
    case "masque":
      return { tcp: true, udp: true };
    case "xdrive":
      return { tcp: true, udp: false };
    default:
      return { tcp: true, udp: false };
  }
}

/**
 * Stable `udp[]` order with socket-replacing masks (xicmp/udphop) last: they
 * wrap the connection itself, so the kernel reports "incorrect index" when a
 * layer follows them. The input array is not mutated.
 */
export function orderFinalmaskUdp(items: FMItem[]): FMItem[] {
  const head: FMItem[] = [];
  const tail: FMItem[] = [];
  for (const item of items) {
    if (SOCKET_REPLACING.has(normType(item.type))) tail.push(item);
    else head.push(item);
  }
  return [...head, ...tail];
}

/** True when the mask is emitted by subscription `fm=` share links. */
export function fmSupportedInLink(type: string, side: FinalmaskSide): boolean {
  const t = type.trim().toLowerCase();
  return side === "tcp" ? LINK_TCP_WHITELIST.has(t) : LINK_UDP_WHITELIST.has(t);
}

export function finalmaskTypesForSide(side: FinalmaskSide): FinalmaskTypeDef[] {
  return FINALMASK_TYPES.filter((d) => d.side === side);
}

export function finalmaskTypeDef(side: FinalmaskSide, type: string): FinalmaskTypeDef | undefined {
  const t = type.trim().toLowerCase();
  return FINALMASK_TYPES.find((d) => d.side === side && d.type === t);
}

/** Deep-cloned preset settings for a new mask entry. */
export function defaultFinalmaskSettings(side: FinalmaskSide, type: string): Record<string, unknown> {
  const def = finalmaskTypeDef(side, type);
  if (!def) return {};
  return cloneJson(def.preset);
}

export function emptyFinalmaskState(): FinalmaskState {
  return { finalmaskTcp: [], finalmaskUdp: [], finalmaskQuicParams: "" };
}

// ---- parse / build ---------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Legacy item-level keys the kernel still accepts; migrate them into settings. */
const LEGACY_ITEM_SETTING_KEYS: Record<string, readonly string[]> = {
  salamander: ["password"],
  sudoku: ["password"],
  "mkcp-legacy": ["header"],
  noise: ["noise"],
  udphop: ["interval", "remoteIPs", "remotePorts"],
};

function parseItems(raw: unknown): FMItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FMItem[] = [];
  for (const item of raw) {
    const obj = asRecord(item);
    if (!obj) continue;
    const type = typeof obj.type === "string" ? obj.type.trim() : "";
    if (!type) continue;
    const settings = asRecord(obj.settings);
    const next: Record<string, unknown> = settings ? cloneJson(settings) : {};
    // Keep legacy item-level fields (e.g. salamander.password) lossless.
    for (const key of LEGACY_ITEM_SETTING_KEYS[type.toLowerCase()] ?? []) {
      if (!(key in next) && key in obj) next[key] = cloneJson(obj[key]);
    }
    out.push({ type, settings: next });
  }
  return out;
}

/**
 * Read `finalmask` from a streamSettings object (or a bare finalmask object).
 * Unknown/advanced settings keys are preserved verbatim.
 */
export function parseFinalmask(root: unknown): {
  tcp: FMItem[];
  udp: FMItem[];
  quicParams: string;
} {
  const empty = { tcp: [] as FMItem[], udp: [] as FMItem[], quicParams: "" };
  const obj = asRecord(root);
  if (!obj) return empty;
  const direct = "finalmask" in obj ? obj.finalmask : obj;
  const fm = asRecord(direct);
  if (!fm) return empty;
  const qp = asRecord(fm.quicParams);
  return {
    tcp: parseItems(fm.tcp),
    udp: parseItems(fm.udp),
    quicParams: qp ? JSON.stringify(qp, null, 2) : "",
  };
}

function itemsToJson(items: FMItem[]): unknown[] {
  return items.map((item) => ({
    type: item.type,
    settings: cloneJson(item.settings ?? {}),
  }));
}

/**
 * Build the `finalmask` object from form state. Returns undefined when the
 * state is empty (the caller must not write an empty finalmask).
 */
export function buildFinalmask(state: FinalmaskState): Record<string, unknown> | undefined {
  const fm: Record<string, unknown> = {};
  if (state.finalmaskTcp.length > 0) fm.tcp = itemsToJson(state.finalmaskTcp);
  if (state.finalmaskUdp.length > 0) fm.udp = itemsToJson(orderFinalmaskUdp(state.finalmaskUdp));
  const qpText = (state.finalmaskQuicParams || "").trim();
  if (qpText) {
    try {
      const parsed: unknown = JSON.parse(qpText);
      if (asRecord(parsed)) fm.quicParams = parsed;
    } catch {
      /* invalid JSON is reported by validateFinalmask; omit it on build */
    }
  }
  return Object.keys(fm).length > 0 ? fm : undefined;
}

// ---- validation (mirror of util/finalmask) --------------------------------

const XMC_USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MKCP_HEADERS = new Set(["dns", "dtls", "srtp", "utp", "wechat", "wireguard"]);
const NOISE_TYPES = new Set(["", "str", "hex", "base64", "exp"]);
const QUIC_CONGESTION = new Set(["", "reno", "bbr", "brutal", "force-brutal"]);
const QUIC_BBR_PROFILE = new Set(["", "conservative", "standard", "aggressive"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function nonEmptyValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  if (typeof v === "number") return true;
  return false;
}

/** Smallest number in a fragment lengths/delays value (number, "a-b", list). */
function minNumber(v: unknown): number | null {
  if (Array.isArray(v)) {
    let min: number | null = null;
    for (const item of v) {
      const n = minNumber(item);
      if (n == null) continue;
      if (min == null || n < min) min = n;
    }
    return min;
  }
  if (typeof v === "string") {
    let min: number | null = null;
    for (const part of v.split(/[,;]/)) {
      for (const bound of part.split("-")) {
        const parsed = Number.parseFloat(bound.trim());
        if (!Number.isFinite(parsed)) continue;
        if (min == null || parsed < min) min = parsed;
      }
    }
    return min;
  }
  return num(v);
}

function minNumberExists(v: unknown): number | null {
  if (v == null) return null;
  return minNumber(v);
}

function nonEmptyList(v: unknown): boolean {
  if (Array.isArray(v)) {
    return v.some((item) => {
      if (typeof item === "string") return item.trim() !== "";
      return num(item) != null;
    });
  }
  if (typeof v === "string") return v.trim() !== "";
  return false;
}

/**
 * `Int32Range` as accepted by the kernel: a number, "30" or "5-30".
 * Returns sorted bounds, or null when the value cannot be parsed.
 */
function parseRangeBounds(v: unknown): { min: number; max: number } | null {
  if (typeof v === "number" && Number.isFinite(v)) return { min: v, max: v };
  if (typeof v !== "string") return null;
  const m = /^\s*(-?\d+)\s*(?:-\s*(-?\d+))?\s*$/.exec(v);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function isIPv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}

function isIPv6Loose(value: string): boolean {
  return value.includes(":") && /^[0-9a-fA-F:.]+$/.test(value);
}

/** IP address or CIDR prefix (what `udphop.remoteIPs` accepts). */
function isIpOrCidr(value: string): boolean {
  const slash = value.split("/");
  if (slash.length > 2) return false;
  const addr = slash[0];
  const v4 = isIPv4(addr);
  if (!v4 && !isIPv6Loose(addr)) return false;
  if (slash.length === 1) return true;
  if (!/^\d{1,3}$/.test(slash[1])) return false;
  const prefix = Number(slash[1]);
  return v4 ? prefix <= 32 : prefix <= 128;
}

/** Port or port range ("443", "20000-30000"), 1..65535. */
function isValidPortToken(token: string): boolean {
  const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(token);
  if (!m) return false;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  return from >= 1 && from <= to && to <= 65535;
}

/** `remotePorts` as the kernel accepts it: "443,8443" or a legacy array. */
function udphopPortTokens(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .flatMap((item) =>
        typeof item === "string" || typeof item === "number" ? String(item).split(",") : [],
      )
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

const UDPHOP_MODES = new Set(["intervallocal", "intervalremote", "perconnremote"]);

function udphopModeTokens(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function issue(
  code: string,
  path: string,
  severity: FinalmaskSeverity,
  message: string,
): FinalmaskIssue {
  return { code, path, severity, message };
}

function validateElement(side: FinalmaskSide, idx: number, item: FMItem): FinalmaskIssue[] {
  const path = `streamSettings.finalmask.${side}[${idx}]`;
  const issues: FinalmaskIssue[] = [];
  const type = (item.type || "").trim().toLowerCase();
  if (!type) {
    return [issue("type_required", `${path}.type`, "error", "type is required")];
  }
  const def = finalmaskTypeDef(side, type);
  if (!def) {
    return [
      issue(
        "unknown_type",
        `${path}.type`,
        "error",
        `unknown ${side} finalmask type "${type}" (kernel rejects it as "unknown config id")`,
      ),
    ];
  }
  const st: Record<string, unknown> = asRecord(item.settings) ?? {};

  switch (type) {
    case "fragment": {
      let min = minNumber(st.lengths);
      if (min == null) min = minNumber(st.length);
      if (min == null) {
        issues.push(
          issue(
            "fragment_lengths_required",
            `${path}.settings.lengths`,
            "error",
            'fragment requires lengths (or legacy length), e.g. ["100-200"]',
          ),
        );
      } else if (min <= 0) {
        issues.push(
          issue(
            "fragment_lengths_min",
            `${path}.settings.lengths`,
            "error",
            "fragment lengths min must be greater than 0",
          ),
        );
      }
      const delays = minNumberExists(st.delays);
      if (delays != null && delays < 0) {
        issues.push(
          issue("fragment_delays_min", `${path}.settings.delays`, "error", "fragment delays must not be negative"),
        );
      } else if (delays == null) {
        const delay = minNumberExists(st.delay);
        if (delay != null && delay < 0) {
          issues.push(
            issue("fragment_delays_min", `${path}.settings.delay`, "error", "fragment delay must not be negative"),
          );
        }
      }
      const packets = str(st.packets).trim();
      if (packets !== "" && packets.toLowerCase() !== "tlshello") {
        const bounds = parseRangeBounds(packets);
        if (bounds == null) {
          issues.push(
            issue(
              "fragment_packets",
              `${path}.settings.packets`,
              "error",
              'fragment packets must be "", "tlshello" or a packet range like "2-4"',
            ),
          );
        } else if (bounds.min === 0) {
          issues.push(
            issue("fragment_packets", `${path}.settings.packets`, "error", "fragment packets range must start above 0"),
          );
        }
      }
      if (st.maxSplit != null && st.maxSplit !== "") {
        const split = parseRangeBounds(st.maxSplit);
        if (split == null) {
          issues.push(
            issue(
              "fragment_max_split",
              `${path}.settings.maxSplit`,
              "error",
              "fragment maxSplit must be a number or a range",
            ),
          );
        } else if (split.min < 0) {
          issues.push(
            issue("fragment_max_split", `${path}.settings.maxSplit`, "error", "fragment maxSplit must not be negative"),
          );
        }
      }
      break;
    }
    case "xmc": {
      if (str(st.hostname).trim() === "") {
        issues.push(issue("xmc_hostname_required", `${path}.settings.hostname`, "error", "xmc requires hostname"));
      }
      if (str(st.password).trim() === "") {
        issues.push(issue("xmc_password_required", `${path}.settings.password`, "error", "xmc requires password"));
      }
      const profiles = Array.isArray(st.profiles) ? st.profiles : [];
      if (profiles.length === 0) {
        issues.push(
          issue(
            "xmc_profiles_required",
            `${path}.settings.profiles`,
            "error",
            "xmc requires at least one profile",
          ),
        );
        break;
      }
      profiles.forEach((p, i) => {
        const ppath = `${path}.settings.profiles[${i}]`;
        const pm = asRecord(p);
        if (!pm) {
          issues.push(issue("xmc_profile_shape", ppath, "error", "profile must be an object"));
          return;
        }
        if (!XMC_USERNAME_RE.test(str(pm.username).trim())) {
          issues.push(
            issue(
              "xmc_profile_username",
              `${ppath}.username`,
              "error",
              "username must be 3-16 characters of [A-Za-z0-9_]",
            ),
          );
        }
        if (str(pm.uuid).trim() === "") {
          issues.push(issue("xmc_profile_uuid", `${ppath}.uuid`, "error", "uuid is required"));
        }
      });
      break;
    }
    case "salamander": {
      const pwd = str(st.password).trim() || str((item as unknown as Record<string, unknown>).password).trim();
      if (BufferByteLength(pwd) < 4) {
        issues.push(
          issue("salamander_password", `${path}.settings.password`, "error", "salamander requires a PSK of at least 4 bytes"),
        );
      }
      if (st.packetSize != null && st.packetSize !== "") {
        const bounds = parseRangeBounds(st.packetSize);
        if (bounds == null) {
          issues.push(
            issue(
              "salamander_packet_size",
              `${path}.settings.packetSize`,
              "error",
              'salamander packetSize must be a number or a range like "1200-1400"',
            ),
          );
        } else if (bounds.max > 0 && (bounds.min <= 0 || bounds.max > 2048)) {
          issues.push(
            issue(
              "salamander_packet_size",
              `${path}.settings.packetSize`,
              "error",
              "salamander packetSize must satisfy 0 < min <= max <= 2048",
            ),
          );
        }
      }
      break;
    }
    case "xdns": {
      const domains = Array.isArray(st.domains) ? st.domains : [];
      if (domains.length === 0) {
        issues.push(
          issue("xdns_domains_required", `${path}.settings.domains`, "error", "xdns requires at least one domain entry"),
        );
        break;
      }
      domains.forEach((d, i) => {
        const dpath = `${path}.settings.domains[${i}]`;
        const dm = asRecord(d);
        if (!dm) {
          issues.push(issue("xdns_domain_shape", dpath, "error", "domain entry must be an object"));
          return;
        }
        const names = Array.isArray(dm.names) ? dm.names : [];
        if (names.length === 0 || !names.some((n) => str(n).trim() !== "")) {
          issues.push(
            issue("xdns_names_required", `${dpath}.names`, "error", "names must contain at least one non-empty domain name"),
          );
        }
      });
      break;
    }
    case "realm": {
      const url = str(st.url).trim().toLowerCase();
      if (url === "") {
        issues.push(
          issue("realm_url_required", `${path}.settings.url`, "error", "realm requires url (realm:// or realm+http:// scheme)"),
        );
      } else if (!url.startsWith("realm://") && !url.startsWith("realm+http://")) {
        issues.push(
          issue("realm_url_scheme", `${path}.settings.url`, "error", "realm url must use the realm:// or realm+http:// scheme"),
        );
      }
      const stun = Array.isArray(st.stunServers) ? st.stunServers : [];
      if (stun.length === 0) {
        issues.push(issue("realm_stun_required", `${path}.settings.stunServers`, "error", "realm requires stunServers"));
      }
      break;
    }
    case "udphop": {
      // udphop is client-side: it is kept in the inbound for share links and
      // stripped from the node config (util/finalmask/transport.go: ServerView),
      // so it is valid on an inbound as well.
      const modes = udphopModeTokens(st.mode);
      if (modes.length === 0 || modes.some((m) => !UDPHOP_MODES.has(m))) {
        issues.push(
          issue(
            "udphop_mode",
            `${path}.settings.mode`,
            "error",
            "udphop mode must be one of intervalremote, intervallocal, perconnremote",
          ),
        );
      }
      const interval = parseRangeBounds(st.interval);
      if (interval == null) {
        issues.push(
          issue("udphop_interval", `${path}.settings.interval`, "error", "udphop requires interval (>= 5 seconds)"),
        );
      } else if (interval.min < 5) {
        issues.push(
          issue("udphop_interval", `${path}.settings.interval`, "error", "udphop interval must be at least 5 seconds"),
        );
      }
      if (!nonEmptyList(st.remoteIPs)) {
        issues.push(
          issue("udphop_remote_ips", `${path}.settings.remoteIPs`, "error", "udphop requires a non-empty remoteIPs list"),
        );
      } else if (Array.isArray(st.remoteIPs)) {
        const bad = st.remoteIPs.filter((ip) => typeof ip !== "string" || !isIpOrCidr(ip.trim()));
        if (bad.length > 0) {
          issues.push(
            issue(
              "udphop_remote_ips_format",
              `${path}.settings.remoteIPs`,
              "error",
              "udphop remoteIPs must be IP addresses or CIDR prefixes",
            ),
          );
        }
      }
      const ports = udphopPortTokens(st.remotePorts);
      if (ports.length === 0) {
        issues.push(
          issue("udphop_remote_ports", `${path}.settings.remotePorts`, "error", "udphop requires a non-empty remotePorts list"),
        );
      } else if (!ports.every(isValidPortToken)) {
        issues.push(
          issue(
            "udphop_remote_ports_format",
            `${path}.settings.remotePorts`,
            "error",
            'udphop remotePorts must be ports or ranges (1-65535), e.g. "443,8443" or "20000-30000"',
          ),
        );
      }
      break;
    }
    case "header-custom": {
      if (side === "tcp") {
        const modes = ["packet", "rand", "reuse", "transform"].filter((k) => nonEmptyValue(st[k]));
        if (modes.length !== 1) {
          issues.push(
            issue(
              "header_custom_tcp_mode",
              `${path}.settings`,
              "error",
              `tcp header-custom requires exactly one of packet/rand/reuse/transform, found ${modes.length}`,
            ),
          );
        }
      } else {
        const mode = str(st.mode).trim().toLowerCase();
        if (mode !== "" && mode !== "prefix" && mode !== "standalone") {
          issues.push(
            issue(
              "header_custom_udp_mode",
              `${path}.settings.mode`,
              "error",
              'udp header-custom mode must be one of "", prefix, standalone',
            ),
          );
        }
      }
      break;
    }
    case "mkcp-legacy": {
      const header = str(st.header).trim().toLowerCase();
      if (!MKCP_HEADERS.has(header)) {
        issues.push(
          issue(
            "mkcp_legacy_header",
            `${path}.settings.header`,
            "error",
            "mkcp-legacy header must be one of dns, dtls, srtp, utp, wechat, wireguard",
          ),
        );
      }
      break;
    }
    case "noise": {
      const list = Array.isArray(st.noise) ? st.noise : [];
      if (list.length === 0) {
        issues.push(
          issue("noise_list_required", `${path}.settings.noise`, "error", "noise requires a non-empty noise[] list"),
        );
        break;
      }
      list.forEach((entry, i) => {
        const npath = `${path}.settings.noise[${i}]`;
        const im = asRecord(entry);
        if (!im) {
          issues.push(issue("noise_item_shape", npath, "error", "noise item must be an object"));
          return;
        }
        const typ = str(im.type).trim().toLowerCase();
        if (!NOISE_TYPES.has(typ)) {
          issues.push(
            issue("noise_item_type", `${npath}.type`, "error", 'noise item type must be one of "", str, hex, base64, exp'),
          );
          return;
        }
        const packet = str(im.packet).trim();
        if (packet === "") {
          issues.push(issue("noise_item_packet", `${npath}.packet`, "error", "noise item requires a non-empty packet"));
          return;
        }
        if (typ === "exp" && !packet.toLowerCase().startsWith("exp:")) {
          issues.push(
            issue(
              "noise_exp_packet",
              `${npath}.packet`,
              "warning",
              'exp packet does not look like "exp:<payload>" and may be rejected by the kernel',
            ),
          );
        }
      });
      break;
    }
    case "sudoku": {
      const pwd = str(st.password).trim() || str((item as unknown as Record<string, unknown>).password).trim();
      if (pwd === "") {
        issues.push(issue("sudoku_password_required", `${path}.settings.password`, "error", "sudoku requires password"));
      }
      break;
    }
    // filter / xicmp have no required settings.
    default:
      break;
  }
  return issues;
}

function validateOrdering(side: FinalmaskSide, items: FMItem[]): FinalmaskIssue[] {
  if (side !== "udp") return [];
  const socketIdx: number[] = [];
  items.forEach((item, i) => {
    if (SOCKET_REPLACING.has((item.type || "").trim().toLowerCase())) socketIdx.push(i);
  });
  const issues: FinalmaskIssue[] = [];
  if (socketIdx.length > 1) {
    issues.push(
      issue(
        "multiple_socket_masks",
        "streamSettings.finalmask.udp",
        "error",
        `only one socket-replacing mask (xicmp/udphop) is allowed, found ${socketIdx.length}`,
      ),
    );
  }
  for (const i of socketIdx) {
    if (i !== items.length - 1) {
      issues.push(
        issue(
          "socket_mask_order",
          `streamSettings.finalmask.udp[${i}]`,
          "error",
          'socket-replacing mask must be the last udp entry, otherwise the kernel reports "incorrect index"',
        ),
      );
    }
  }
  return issues;
}

function validateQuicParams(json: string): FinalmaskIssue[] {
  const text = (json || "").trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [
      issue("quic_params_json", "streamSettings.finalmask.quicParams", "error", "quicParams is not valid JSON"),
    ];
  }
  const qp = asRecord(parsed);
  if (!qp) {
    return [
      issue("quic_params_shape", "streamSettings.finalmask.quicParams", "error", "quicParams must be an object"),
    ];
  }
  const issues: FinalmaskIssue[] = [];
  const base = "streamSettings.finalmask.quicParams";
  if ("congestion" in qp && !QUIC_CONGESTION.has(str(qp.congestion).trim().toLowerCase())) {
    issues.push(
      issue("quic_congestion", `${base}.congestion`, "error", "congestion must be one of reno, bbr, brutal, force-brutal"),
    );
  }
  if ("bbrProfile" in qp && !QUIC_BBR_PROFILE.has(str(qp.bbrProfile).trim().toLowerCase())) {
    issues.push(
      issue("quic_bbr_profile", `${base}.bbrProfile`, "error", "bbrProfile must be one of conservative, standard, aggressive"),
    );
  }
  for (const [key, value] of Object.entries(qp)) {
    const n = typeof value === "number" ? value : null;
    if (n != null && n <= 0) {
      issues.push(issue("quic_number_positive", `${base}.${key}`, "error", `${key} must be greater than 0`));
    }
  }
  return issues;
}

function allowedSidesText(sides: FinalmaskSides): string {
  if (sides.tcp && sides.udp) return "TCP and UDP";
  if (sides.tcp) return "TCP only";
  if (sides.udp) return "UDP only";
  return "none";
}

/**
 * Rejects masks on a transport that cannot carry them (mirror of
 * `util/finalmask/transport.go: ValidateTransportCompatibility`). An empty
 * finalmask yields no issues.
 */
export function validateFinalmaskTransport(
  state: FinalmaskState,
  query: FinalmaskSidesQuery,
): FinalmaskIssue[] {
  const hasTcp = state.finalmaskTcp.length > 0;
  const hasUdp = state.finalmaskUdp.length > 0;
  if (!hasTcp && !hasUdp) return [];

  const network = normalizeFinalmaskNetwork(query.network);
  const protocol = typeof query.protocol === "string" ? query.protocol.trim().toLowerCase() : "";
  if (network === "quic" || network === "h2" || network === "h3" || network === "http") {
    return [
      issue(
        "transport_unsupported",
        "streamSettings.finalmask",
        "error",
        `finalmask cannot be used with protocol "${protocol}": transport "${network}" was removed from the Xray kernel; remove the finalmask block`,
      ),
    ];
  }

  const sides = finalmaskSidesFor(query);
  const quicH3 = finalmaskUsesQuic(query);
  const issues: FinalmaskIssue[] = [];
  if (hasTcp && !sides.tcp) {
    issues.push(
      quicH3
        ? issue(
            "transport_tcp_on_quic",
            "streamSettings.finalmask.tcp",
            "error",
            'TCP masks are not applied on QUIC; use UDP masks (salamander/udphop) for xhttp with ALPN "h3"',
          )
        : issue(
            "transport_tcp_forbidden",
            "streamSettings.finalmask.tcp",
            "error",
            `tcp masks are not supported for protocol "${protocol}" on transport "${network}" (allowed finalmask sides: ${allowedSidesText(sides)})`,
          ),
    );
  }
  if (hasUdp && !sides.udp) {
    issues.push(
      issue(
        "transport_udp_forbidden",
        "streamSettings.finalmask.udp",
        "error",
        `udp masks are not supported for protocol "${protocol}" on transport "${network}" (allowed finalmask sides: ${allowedSidesText(sides)})`,
      ),
    );
  }
  return issues;
}

/** Validate the form state; mirrors the Go rules (order + required fields). */
export function validateFinalmask(
  state: FinalmaskState,
  transport?: FinalmaskSidesQuery,
): FinalmaskIssue[] {
  const issues: FinalmaskIssue[] = [];
  if (transport) issues.push(...validateFinalmaskTransport(state, transport));
  state.finalmaskTcp.forEach((item, i) => issues.push(...validateElement("tcp", i, item)));
  state.finalmaskUdp.forEach((item, i) => issues.push(...validateElement("udp", i, item)));
  issues.push(...validateOrdering("udp", state.finalmaskUdp));
  issues.push(...validateQuicParams(state.finalmaskQuicParams));
  return issues;
}

/** Byte length of a string (salamander requires >= 4 bytes, not chars). */
function BufferByteLength(s: string): number {
  return typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(s).length
    : unescape(encodeURIComponent(s)).length;
}
