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
    hint: "Client-only mask; cannot be used in an inbound. Must be the last udp[] entry.",
    fields: [
      { name: "interval", label: "interval (sec)", kind: "number", required: true, placeholder: "30" },
      { name: "remoteIPs", label: "remoteIPs", kind: "list", required: true, placeholder: "1.2.3.4" },
      { name: "remotePorts", label: "remotePorts", kind: "list", required: true, placeholder: "443" },
    ],
    preset: { interval: 30, remoteIPs: ["1.2.3.4"], remotePorts: ["443"] },
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
  if (state.finalmaskUdp.length > 0) fm.udp = itemsToJson(state.finalmaskUdp);
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
      issues.push(
        issue("udphop_client_only", `${path}.type`, "error", "udphop is a client-only mask and cannot be used in an inbound"),
      );
      const interval = num(st.interval);
      if (interval == null) {
        issues.push(
          issue("udphop_interval", `${path}.settings.interval`, "error", "udphop requires interval (>= 5 seconds)"),
        );
      } else if (interval < 5) {
        issues.push(
          issue("udphop_interval", `${path}.settings.interval`, "error", "udphop interval must be at least 5 seconds"),
        );
      }
      if (!nonEmptyList(st.remoteIPs)) {
        issues.push(
          issue("udphop_remote_ips", `${path}.settings.remoteIPs`, "error", "udphop requires a non-empty remoteIPs list"),
        );
      }
      if (!nonEmptyList(st.remotePorts)) {
        issues.push(
          issue("udphop_remote_ports", `${path}.settings.remotePorts`, "error", "udphop requires a non-empty remotePorts list"),
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

/** Validate the form state; mirrors the Go rules (order + required fields). */
export function validateFinalmask(state: FinalmaskState): FinalmaskIssue[] {
  const issues: FinalmaskIssue[] = [];
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
