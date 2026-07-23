/**
 * Default Xray inbound settings (JSON strings) for POST /panel/api/inbounds/add.
 * Matches structures used by the legacy web UI (x-ui style).
 */

import {
  parseShadowsocksFromSettings,
  randomShadowsocksServerPassword,
  stripShadowsocksClientMethods,
} from "@/lib/shadowsocksKeys";

export type InboundFormProtocol =
  | "vless"
  | "vmess"
  | "trojan"
  | "shadowsocks"
  | "mixed"
  | "hysteria"
  | "hysteria2"
  | "wireguard"
  | "telemt"
  | "amneziawg";

function randomId(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

function randomSubId(): string {
  return randomId(16);
}

/** URL-safe / client password (trojan) */
function randomPassword(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32-byte WireGuard / Xray `secretKey` as standard base64. */
function randomKey32Base64(): string {
  const arr = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 32; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  let bin = "";
  for (let i = 0; i < 32; i += 1) bin += String.fromCharCode(arr[i]!);
  return btoa(bin);
}

/** New `secretKey` for WireGuard server (Xray inbound `settings`). */
export function newWireGuardSecretKeyBase64(): string {
  return randomKey32Base64();
}

function splitListLinesOrCommas(s: string): string[] {
  return s
    .split(/[,\n]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export type WireguardFormState = {
  mtu: number;
  secretKey: string;
  /** One CIDR per line (maps to `address`). */
  address: string;
  /**
   * Client-side DNS for WireGuard [Interface] (comma or newline; stored as `clientDns` in settings).
   * Shown in subscription / connection info, not used by Xray.
   */
  clientDns: string;
  noKernelTun: boolean;
  /** Optional positive integer; empty = omitted when saving. */
  workers: string;
};

export function defaultWireguardForm(): WireguardFormState {
  return {
    mtu: 1420,
    secretKey: newWireGuardSecretKeyBase64(),
    address: "10.8.0.1/32",
    clientDns: "",
    noKernelTun: true,
    workers: "2",
  };
}

export function parseWireguardSettingsToForm(settingsStr: string): WireguardFormState {
  const base: WireguardFormState = {
    mtu: 1420,
    secretKey: "",
    address: "10.8.0.1/32",
    clientDns: "",
    noKernelTun: true,
    workers: "",
  };
  try {
    const root = JSON.parse(settingsStr || "{}") as Record<string, unknown>;
    if (typeof root.mtu === "number" && root.mtu > 0) base.mtu = root.mtu;
    if (typeof root.secretKey === "string") base.secretKey = root.secretKey;
    const addr = root.address;
    if (Array.isArray(addr)) {
      const lines = addr
        .map((a) => (typeof a === "string" ? a.trim() : ""))
        .filter(Boolean);
      if (lines.length) base.address = lines.join("\n");
    }
    const cd = root.clientDns;
    if (Array.isArray(cd)) {
      const lines = cd
        .map((a) => (typeof a === "string" ? a.trim() : ""))
        .filter(Boolean);
      if (lines.length) base.clientDns = lines.join("\n");
    }
    if (typeof root.noKernelTun === "boolean") {
      base.noKernelTun = root.noKernelTun;
    }
    if (typeof root.workers === "number" && root.workers > 0) {
      base.workers = String(root.workers);
    }
  } catch {
    /* use base */
  }
  return base;
}

export type WireguardInboundApiPayload = {
  mtu: number;
  secretKey: string;
  address: string[];
  /** Client [Interface] DNS; stored as `clientDns` in settings (panel / subscription only). */
  clientDns: string[];
  /** Always empty: peers are generated when clients are assigned to this inbound. */
  peers: [];
  noKernelTun: boolean;
  workers?: number;
};

export function buildWireguardInboundApiPayload(
  w: WireguardFormState,
): WireguardInboundApiPayload {
  const addrs = splitListLinesOrCommas(w.address);
  const address = addrs.length > 0 ? addrs : ["10.8.0.1/32"];
  const mtu = Number.isFinite(w.mtu) && w.mtu > 0 ? w.mtu : 1420;
  const wu = parseInt(w.workers.trim(), 10);
  const out: WireguardInboundApiPayload = {
    mtu,
    secretKey: w.secretKey.trim(),
    address,
    clientDns: splitListLinesOrCommas(w.clientDns),
    peers: [],
    noKernelTun: w.noKernelTun,
  };
  if (Number.isFinite(wu) && wu > 0) {
    out.workers = wu;
  }
  return out;
}

/** Tri-state bool for optional Telemt fields: "" = omit (Telemt default). */
export type TelemtTriBool = "" | "true" | "false";

/** Telemt (MTProto) inbound: stored under `settings` as `{ "telemt": { ... } }`. */
export type TelemtFormState = {
  useMiddleProxy: boolean;
  logLevel: string;
  /** Optional [general].ad_tag from @MTProxybot */
  adTag: string;
  modesClassic: boolean;
  modesSecure: boolean;
  /** Telemt `tls` = Fake-TLS MTProto (ee links). */
  modesTls: boolean;
  linksShow: string;
  linksPublicHost: string;
  linksPublicPort: string;
  censorshipTlsDomain: string;
  censorshipMask: boolean;
  censorshipTlsEmulation: boolean;
  censorshipTlsFrontDir: string;
  /** [censorship].unknown_sni_action — empty = omit. */
  censorshipUnknownSniAction: string;
  /** Optional [censorship].mask_host */
  censorshipMaskHost: string;
  /** Optional [censorship].mask_port */
  censorshipMaskPort: string;
  /** Optional [server].metrics_port */
  metricsPort: string;
  apiEnabled: boolean;
  apiListen: string;
  /** [server].proxy_protocol — accept PROXY Protocol from upstream (nginx/haproxy). */
  proxyProtocol: boolean;
  /** [general].fast_mode — empty = omit. */
  fastMode: TelemtTriBool;
  /** [general].me2dc_fallback — empty = omit. */
  me2dcFallback: TelemtTriBool;
  /** [general].me2dc_fast — empty = omit. */
  me2dcFast: TelemtTriBool;
  /** [general].middle_proxy_nat_ip */
  middleProxyNatIp: string;
  /** [general].tg_connect (seconds) */
  tgConnect: string;
  /** [network].ipv4 — empty = omit. */
  networkIpv4: TelemtTriBool;
  /** [network].ipv6 — empty = omit. */
  networkIpv6: TelemtTriBool;
  /** [network].prefer — empty = omit; "4" or "6". */
  networkPrefer: "" | "4" | "6";
  timeoutsClientHandshake: string;
  timeoutsClientKeepalive: string;
  timeoutsClientAck: string;
  timeoutsClientFirstByteIdleSecs: string;
  /** [access].ignore_time_skew */
  accessIgnoreTimeSkew: boolean;
  accessUserMaxUniqueIpsGlobalEach: string;
  accessUserMaxTcpConnsGlobalEach: string;
};

export function defaultTelemtForm(): TelemtFormState {
  return {
    useMiddleProxy: false,
    logLevel: "normal",
    adTag: "",
    modesClassic: false,
    modesSecure: false,
    modesTls: true,
    linksShow: "*",
    linksPublicHost: "",
    linksPublicPort: "",
    censorshipTlsDomain: "petrovich.ru",
    censorshipMask: true,
    censorshipTlsEmulation: true,
    censorshipTlsFrontDir: "tlsfront",
    censorshipUnknownSniAction: "",
    censorshipMaskHost: "",
    censorshipMaskPort: "",
    metricsPort: "",
    apiEnabled: true,
    apiListen: "127.0.0.1:9091",
    proxyProtocol: false,
    fastMode: "",
    me2dcFallback: "",
    me2dcFast: "",
    middleProxyNatIp: "",
    tgConnect: "",
    networkIpv4: "",
    networkIpv6: "",
    networkPrefer: "",
    timeoutsClientHandshake: "",
    timeoutsClientKeepalive: "",
    timeoutsClientAck: "",
    timeoutsClientFirstByteIdleSecs: "",
    accessIgnoreTimeSkew: false,
    accessUserMaxUniqueIpsGlobalEach: "",
    accessUserMaxTcpConnsGlobalEach: "",
  };
}

function parseTelemtTriBool(v: unknown): TelemtTriBool {
  if (v === true || v === "true") return "true";
  if (v === false || v === "false") return "false";
  return "";
}

function parseTelemtOptionalIntField(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(Math.trunc(v));
  if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function applyTelemtTriBoolToJson(
  target: Record<string, unknown>,
  key: string,
  value: TelemtTriBool,
) {
  if (value === "true") target[key] = true;
  else if (value === "false") target[key] = false;
}

export function parseTelemtSettingsToForm(settingsStr: string): TelemtFormState {
  const base = defaultTelemtForm();
  try {
    const root = JSON.parse(settingsStr || "{}") as Record<string, unknown>;
    const tm =
      root.telemt != null && typeof root.telemt === "object" && !Array.isArray(root.telemt)
        ? (root.telemt as Record<string, unknown>)
        : root;
    if (typeof tm.useMiddleProxy === "boolean") base.useMiddleProxy = tm.useMiddleProxy;
    if (typeof tm.logLevel === "string" && tm.logLevel.trim()) {
      base.logLevel = tm.logLevel.trim();
    }
    if (typeof tm.adTag === "string") base.adTag = tm.adTag.trim();
    const modes = tm.modes as Record<string, unknown> | undefined;
    if (modes && typeof modes === "object") {
      if (typeof modes.classic === "boolean") base.modesClassic = modes.classic;
      if (typeof modes.secure === "boolean") base.modesSecure = modes.secure;
      if (typeof modes.tls === "boolean") base.modesTls = modes.tls;
    }
    const links = tm.links as Record<string, unknown> | undefined;
    if (links && typeof links === "object") {
      if (typeof links.show === "string") base.linksShow = links.show;
      if (typeof links.publicHost === "string") base.linksPublicHost = links.publicHost;
      if (typeof links.publicPort === "number" && links.publicPort > 0) {
        base.linksPublicPort = String(links.publicPort);
      } else if (typeof links.publicPort === "string" && links.publicPort.trim()) {
        base.linksPublicPort = links.publicPort.trim();
      }
    }
    const c = tm.censorship as Record<string, unknown> | undefined;
    if (c && typeof c === "object") {
      const td =
        typeof c.tlsDomain === "string" && c.tlsDomain.trim()
          ? c.tlsDomain.trim()
          : typeof c.sni === "string" && c.sni.trim()
            ? c.sni.trim()
            : "";
      if (td) base.censorshipTlsDomain = td;
      if (typeof c.mask === "boolean") base.censorshipMask = c.mask;
      if (typeof c.tlsEmulation === "boolean") base.censorshipTlsEmulation = c.tlsEmulation;
      if (typeof c.tlsFrontDir === "string" && c.tlsFrontDir.trim()) {
        base.censorshipTlsFrontDir = c.tlsFrontDir.trim();
      }
      if (typeof c.unknownSniAction === "string") {
        base.censorshipUnknownSniAction = c.unknownSniAction.trim();
      }
      if (typeof c.maskHost === "string") base.censorshipMaskHost = c.maskHost.trim();
      base.censorshipMaskPort = parseTelemtOptionalIntField(c.maskPort);
    }
    base.fastMode = parseTelemtTriBool(tm.fastMode);
    base.me2dcFallback = parseTelemtTriBool(tm.me2dcFallback);
    base.me2dcFast = parseTelemtTriBool(tm.me2dcFast);
    if (typeof tm.middleProxyNatIp === "string") {
      base.middleProxyNatIp = tm.middleProxyNatIp.trim();
    }
    base.tgConnect = parseTelemtOptionalIntField(tm.tgConnect);
    const net = tm.network as Record<string, unknown> | undefined;
    if (net && typeof net === "object") {
      base.networkIpv4 = parseTelemtTriBool(net.ipv4);
      base.networkIpv6 = parseTelemtTriBool(net.ipv6);
      if (net.prefer === 4 || net.prefer === "4") base.networkPrefer = "4";
      else if (net.prefer === 6 || net.prefer === "6") base.networkPrefer = "6";
    }
    const to = tm.timeouts as Record<string, unknown> | undefined;
    if (to && typeof to === "object") {
      base.timeoutsClientHandshake = parseTelemtOptionalIntField(to.clientHandshake);
      base.timeoutsClientKeepalive = parseTelemtOptionalIntField(to.clientKeepalive);
      base.timeoutsClientAck = parseTelemtOptionalIntField(to.clientAck);
      base.timeoutsClientFirstByteIdleSecs = parseTelemtOptionalIntField(
        to.clientFirstByteIdleSecs,
      );
    }
    const acc = tm.access as Record<string, unknown> | undefined;
    if (acc && typeof acc === "object") {
      if (typeof acc.ignoreTimeSkew === "boolean") base.accessIgnoreTimeSkew = acc.ignoreTimeSkew;
      base.accessUserMaxUniqueIpsGlobalEach = parseTelemtOptionalIntField(
        acc.userMaxUniqueIpsGlobalEach,
      );
      base.accessUserMaxTcpConnsGlobalEach = parseTelemtOptionalIntField(
        acc.userMaxTcpConnsGlobalEach,
      );
    }
    if (typeof tm.metricsPort === "number" && tm.metricsPort > 0) {
      base.metricsPort = String(tm.metricsPort);
    } else if (typeof tm.metricsPort === "string" && tm.metricsPort.trim()) {
      base.metricsPort = tm.metricsPort.trim();
    }
    if (typeof tm.apiEnabled === "boolean") base.apiEnabled = tm.apiEnabled;
    if (typeof tm.apiListen === "string" && tm.apiListen.trim()) {
      base.apiListen = tm.apiListen.trim();
    }
    if (typeof tm.proxyProtocol === "boolean") base.proxyProtocol = tm.proxyProtocol;
  } catch {
    /* keep base */
  }
  return base;
}

export function buildTelemtSettingsJson(form: TelemtFormState): string {
  const links: Record<string, unknown> = {
    show: form.linksShow.trim() || "*",
  };
  const ph = form.linksPublicHost.trim();
  const pp = parseInt(form.linksPublicPort.trim(), 10);
  if (ph.length > 0) links.publicHost = ph;
  if (Number.isFinite(pp) && pp > 0) links.publicPort = pp;

  const mp = parseInt(form.metricsPort.trim(), 10);
  const telemt: Record<string, unknown> = {
    useMiddleProxy: form.useMiddleProxy,
    logLevel: form.logLevel.trim() || "normal",
    modes: {
      classic: form.modesClassic,
      secure: form.modesSecure,
      tls: form.modesTls,
    },
    links,
    censorship: {
      tlsDomain: form.censorshipTlsDomain.trim() || "petrovich.ru",
      mask: form.censorshipMask,
      tlsEmulation: form.censorshipTlsEmulation,
      tlsFrontDir: form.censorshipTlsFrontDir.trim() || "tlsfront",
    },
    apiEnabled: form.apiEnabled,
    apiListen: form.apiListen.trim() || "127.0.0.1:9091",
  };
  const tag = form.adTag.trim();
  if (tag) telemt.adTag = tag;
  const unk = form.censorshipUnknownSniAction.trim();
  if (unk === "mask" || unk === "reject_handshake") {
    (telemt.censorship as Record<string, unknown>).unknownSniAction = unk;
  }
  if (Number.isFinite(mp) && mp > 0) telemt.metricsPort = mp;
  if (form.proxyProtocol) telemt.proxyProtocol = true;

  applyTelemtTriBoolToJson(telemt, "fastMode", form.fastMode);
  applyTelemtTriBoolToJson(telemt, "me2dcFallback", form.me2dcFallback);
  applyTelemtTriBoolToJson(telemt, "me2dcFast", form.me2dcFast);
  const natIp = form.middleProxyNatIp.trim();
  if (natIp) telemt.middleProxyNatIp = natIp;
  const tgConnect = parseInt(form.tgConnect.trim(), 10);
  if (Number.isFinite(tgConnect) && tgConnect > 0) telemt.tgConnect = tgConnect;

  const network: Record<string, unknown> = {};
  applyTelemtTriBoolToJson(network, "ipv4", form.networkIpv4);
  applyTelemtTriBoolToJson(network, "ipv6", form.networkIpv6);
  if (form.networkPrefer === "4" || form.networkPrefer === "6") {
    network.prefer = Number(form.networkPrefer);
  }
  if (Object.keys(network).length > 0) telemt.network = network;

  const timeouts: Record<string, unknown> = {};
  const th = parseInt(form.timeoutsClientHandshake.trim(), 10);
  if (Number.isFinite(th) && th > 0) timeouts.clientHandshake = th;
  const tk = parseInt(form.timeoutsClientKeepalive.trim(), 10);
  if (Number.isFinite(tk) && tk > 0) timeouts.clientKeepalive = tk;
  const ta = parseInt(form.timeoutsClientAck.trim(), 10);
  if (Number.isFinite(ta) && ta > 0) timeouts.clientAck = ta;
  const tf = parseInt(form.timeoutsClientFirstByteIdleSecs.trim(), 10);
  if (Number.isFinite(tf) && tf >= 0) timeouts.clientFirstByteIdleSecs = tf;
  if (Object.keys(timeouts).length > 0) telemt.timeouts = timeouts;

  const maskPort = parseInt(form.censorshipMaskPort.trim(), 10);
  if (form.censorshipMaskHost.trim()) {
    (telemt.censorship as Record<string, unknown>).maskHost = form.censorshipMaskHost.trim();
  }
  if (Number.isFinite(maskPort) && maskPort > 0) {
    (telemt.censorship as Record<string, unknown>).maskPort = maskPort;
  }

  const access: Record<string, unknown> = {};
  if (form.accessIgnoreTimeSkew) access.ignoreTimeSkew = true;
  const maxIps = parseInt(form.accessUserMaxUniqueIpsGlobalEach.trim(), 10);
  if (Number.isFinite(maxIps) && maxIps >= 0) access.userMaxUniqueIpsGlobalEach = maxIps;
  const maxTcp = parseInt(form.accessUserMaxTcpConnsGlobalEach.trim(), 10);
  if (Number.isFinite(maxTcp) && maxTcp >= 0) access.userMaxTcpConnsGlobalEach = maxTcp;
  if (Object.keys(access).length > 0) telemt.access = access;

  return JSON.stringify({ telemt });
}

export function newClientUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${randomId(8)}-${randomId(4)}-4${randomId(3)}-${randomId(4)}-${randomId(12)}`;
}

const defaultStreamTcp = {
  network: "tcp",
  security: "none",
  tcpSettings: {
    acceptProxyProtocol: false,
    header: { type: "none" },
  },
};

const defaultSniffing = {
  enabled: true,
  destOverride: ["http", "tls", "quic"],
};

export function defaultStreamSettingsString(): string {
  return JSON.stringify(defaultStreamTcp);
}

export function defaultSniffingString(): string {
  return JSON.stringify(defaultSniffing);
}

/** Sniffing as form fields (serialized to Xray sniffing JSON). */
export type SniffingFormState = {
  enabled: boolean;
  destHttp: boolean;
  destTls: boolean;
  destQuic: boolean;
  destFakedns: boolean;
  metadataOnly: boolean;
  routeOnly: boolean;
  /** Comma or newline-separated list of domains to exclude from sniffing */
  domainsExcluded: string;
};

export function defaultSniffingForm(): SniffingFormState {
  return {
    enabled: true,
    destHttp: true,
    destTls: true,
    destQuic: true,
    destFakedns: false,
    metadataOnly: false,
    routeOnly: false,
    domainsExcluded: "",
  };
}

export function parseSniffingToForm(json: string): SniffingFormState {
  const base = defaultSniffingForm();
  try {
    const root = JSON.parse(json) as Record<string, unknown>;
    if (typeof root.enabled === "boolean") base.enabled = root.enabled;
    if (typeof root.metadataOnly === "boolean") base.metadataOnly = root.metadataOnly;
    if (typeof root.routeOnly === "boolean") base.routeOnly = root.routeOnly;
    const ov = root.destOverride;
    if (Array.isArray(ov)) {
      const set = new Set(ov.filter((x) => typeof x === "string") as string[]);
      base.destHttp = set.has("http");
      base.destTls = set.has("tls");
      base.destQuic = set.has("quic");
      base.destFakedns = set.has("fakedns");
    }
    const de = root.domainsExcluded;
    if (Array.isArray(de)) {
      base.domainsExcluded = de.filter((x) => typeof x === "string").join("\n");
    } else if (typeof de === "string" && de.trim()) {
      base.domainsExcluded = de;
    }
  } catch {
    /* defaults */
  }
  return base;
}

export function buildSniffingFromForm(state: SniffingFormState): string {
  const destOverride: string[] = [];
  if (state.destHttp) destOverride.push("http");
  if (state.destTls) destOverride.push("tls");
  if (state.destQuic) destOverride.push("quic");
  if (state.destFakedns) destOverride.push("fakedns");
  const obj: Record<string, unknown> = {
    enabled: state.enabled,
    destOverride,
    metadataOnly: state.metadataOnly,
    routeOnly: state.routeOnly,
  };
  const excluded = state.domainsExcluded
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (excluded.length > 0) obj.domainsExcluded = excluded;
  return JSON.stringify(obj);
}

/** Stream JSON for Hysteria / Hysteria2 inbounds (network hysteria). */
export function defaultStreamSettingsHysteriaString(version: 1 | 2): string {
  return JSON.stringify({
    network: "hysteria",
    security: "tls",
    externalProxy: [],
    tlsSettings: {
      alpn: ["h3"],
      minVersion: "1.2",
      maxVersion: "1.3",
      cipherSuites: "",
      rejectUnknownSni: false,
      disableSystemRoot: false,
      enableSessionResumption: true,
      certificates: [],
      echServerKeys: "",
      echForceQuery: "none",
      settings: {
        fingerprint: "chrome",
        echConfigList: "",
      },
    },
    hysteriaSettings: {
      version,
      auth: "",
      udpIdleTimeout: 60,
    },
  });
}

export function streamPresetTcpTlsString(): string {
  return JSON.stringify({
    network: "tcp",
    security: "tls",
    tlsSettings: {
      alpn: ["http/1.1"],
      certificates: [],
      minVersion: "1.2",
      cipherSuites: "",
      preferServerCipherSuites: false,
    },
    tcpSettings: {
      acceptProxyProtocol: false,
      header: { type: "none" },
    },
  });
}

/** uTLS fingerprints (aligned with 3x-ui / Xray Reality). */
export const REALITY_FINGERPRINTS = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
  "randomized",
  "randomizednoalpn",
  "unsafe",
] as const;

/** xHTTP custom request headers (3x-ui name/value rows → Xray v2 `headers` map, last wins per key). */
export type XhttpHeaderRow = { name: string; value: string };

/** MODE_OPTION from 3x-ui inbound xHTTPStreamSettings. */
export const XHTTP_MODES = ["auto", "packet-up", "stream-up", "stream-one", "gun-stream"] as const;

function xhttpHeadersFromXrayJson(raw: unknown): XhttpHeaderRow[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const h = raw as Record<string, unknown>;
  const out: XhttpHeaderRow[] = [];
  for (const key of Object.keys(h)) {
    const values = h[key];
    if (typeof values === "string" && values.length > 0) {
      out.push({ name: key, value: values });
    } else if (Array.isArray(values)) {
      for (const v of values) {
        if (typeof v === "string" && v.length > 0) {
          out.push({ name: key, value: v });
        }
      }
    }
  }
  return out;
}

/**
 * XTLS flow (xtls-rprx-*) is only valid for TCP+TLS/REALITY or non-none VLESS Encryption — not XHTTP/WS/gRPC.
 * @see https://xtls.github.io/ru/config/outbounds/vless.html
 */
export function vlessXtlsFlowAllowed(
  stream: Pick<StreamFormState, "network" | "security">,
  vlessEncryption: string,
): boolean {
  if (stream.network === "xhttp") return false;
  if (stream.network !== "tcp") return false;
  if (stream.security === "tls" || stream.security === "reality") return true;
  const enc = vlessEncryption.trim();
  return enc !== "" && enc !== "none";
}

export function effectiveVlessFlow(
  stream: Pick<StreamFormState, "network" | "security">,
  flow: string,
  vlessEncryption: string,
): string {
  return vlessXtlsFlowAllowed(stream, vlessEncryption) ? flow.trim() : "";
}

function xhttpHeadersToV2Map(rows: XhttpHeaderRow[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const { name, value } of rows) {
    const n = name.trim();
    const v = value.trim();
    if (!n || !v) continue;
    o[n] = v;
  }
  return o;
}

/** KCP / QUIC obfuscation header types. */
export type HeaderObfuscationType = "none" | "srtp" | "utp" | "wechat-video" | "dtls" | "wireguard";

/** Structured stream / transport fields (non-hysteria); serialized to Xray streamSettings JSON. */
export type StreamFormState = {
  network: "tcp" | "ws" | "grpc" | "quic" | "xhttp" | "httpupgrade" | "kcp" | "h2";
  security: "none" | "tls" | "reality";
  tcpHeaderType: "none" | "http";
  acceptProxyProtocol: boolean;
  /** QUIC transport (when network === quic) */
  quicSecurity: "none" | "aes-128-gcm" | "chacha20-poly1305";
  quicKey: string;
  quicHeaderType: HeaderObfuscationType;
  /** KCP (mKCP) transport */
  kcpHeaderType: HeaderObfuscationType;
  kcpSeed: string;
  kcpCongestion: boolean;
  kcpMtu: number;
  kcpTti: number;
  kcpUplinkCapacity: number;
  kcpDownlinkCapacity: number;
  kcpReadBuffer: number;
  kcpWriteBuffer: number;
  /** HTTP/2 transport (h2) */
  h2Path: string;
  h2Host: string;
  h2ReadIdleTimeout: number;
  h2HealthCheckTimeout: number;
  tlsServerName: string;
  tlsAlpn: string;
  tlsAllowInsecure: boolean;
  tlsMinVersion: "1.2" | "1.3";
  tlsCipherSuites: string;
  tlsCertificateFile: string;
  tlsKeyFile: string;
  /** Inline PEM (optional; used when file paths empty) */
  tlsCertificatePem: string;
  tlsKeyPem: string;
  wsPath: string;
  wsHost: string;
  /** XHTTP (SplitHTTP) — full xHTTPStreamSettings from 3x-ui / Xray. */
  xhttpPath: string;
  xhttpHost: string;
  xhttpHeaders: XhttpHeaderRow[];
  xhttpScMaxBufferedPosts: number;
  xhttpScMaxEachPostBytes: string;
  xhttpScStreamUpServerSecs: string;
  xhttpNoSseHeader: boolean;
  xhttpMode: string;
  xhttpPaddingBytes: string;
  xhttpPaddingObfs: boolean;
  xhttpPaddingKey: string;
  xhttpPaddingHeader: string;
  xhttpPaddingPlacement: string;
  xhttpPaddingMethod: string;
  xhttpUplinkHttpMethod: string;
  xhttpSessionPlacement: string;
  xhttpSessionKey: string;
  xhttpSeqPlacement: string;
  xhttpSeqKey: string;
  xhttpUplinkDataPlacement: string;
  xhttpUplinkDataKey: string;
  xhttpUplinkChunkSize: number;
  grpcServiceName: string;
  grpcMultiMode: boolean;
  grpcIdleTimeout: number;
  grpcHealthCheckTimeout: number;
  grpcPermitWithoutStream: boolean;
  /** TCP HTTP header camouflage extended fields (when tcpHeaderType === "http") */
  tcpHttpPath: string;
  tcpHttpRequestHeaders: XhttpHeaderRow[];
  tcpHttpResponseStatus: string;
  tcpHttpResponseReason: string;
  tcpHttpResponseHeaders: XhttpHeaderRow[];
  /** Hysteria2 masquerade URL (returns real HTTP response to browser clients) */
  hysteria2Masquerade: string;
  /** Inbound sockopt */
  sockoptTcpFastOpen: boolean;
  sockoptTproxy: "off" | "redirect" | "tproxy";
  sockoptMark: number;
  sockoptTcpKeepAlive: number;
  sockoptTcpMss: number;
  /** TLS extra: OCSP stapling cache TTL (seconds, 0 = disabled) */
  tlsOcspStapling: number;
  /** TLS mutual auth: require client certificate */
  tlsVerifyClientCertificate: boolean;
  /** TLS: pinned peer certificate SHA-256 hashes (comma or newline separated) */
  tlsPinnedSha256: string;
  hysteriaUdpIdleTimeout: number;
  hysteriaObfsType: "" | "salamander";
  hysteriaObfsPassword: string;
  /** Hysteria QUIC-TLS (3x-ui–style tlsSettings); unused for TCP/WS editor paths. */
  tlsMaxVersion: "" | "1.2" | "1.3";
  tlsRejectUnknownSni: boolean;
  tlsDisableSystemRoot: boolean;
  tlsEnableSessionResumption: boolean;
  tlsUtlsFingerprint: string;
  tlsEchServerKeys: string;
  tlsEchForceQuery: string;
  tlsEchConfigList: string;
  tlsCertOneTimeLoading: boolean;
  tlsCertUsage: string;
  tlsCertBuildChain: boolean;
  /** REALITY (security === reality); matches 3x-ui RealityStreamSettings.toJson */
  realityShow: boolean;
  realityXver: number;
  realityTarget: string;
  realityServerNames: string;
  realityPrivateKey: string;
  realityMinClientVer: string;
  realityMaxClientVer: string;
  realityMaxTimeDiff: number;
  realityShortIds: string;
  realityMldsa65Seed: string;
  realityPublicKey: string;
  realityFingerprint: string;
  realitySettingsServerName: string;
  realitySpiderX: string;
  realityMldsa65Verify: string;
};

export function defaultStreamForm(): StreamFormState {
  return {
    network: "tcp",
    security: "none",
    tcpHeaderType: "none",
    acceptProxyProtocol: false,
    quicSecurity: "none",
    quicKey: "",
    quicHeaderType: "none",
    kcpHeaderType: "none",
    kcpSeed: "",
    kcpCongestion: false,
    kcpMtu: 1350,
    kcpTti: 20,
    kcpUplinkCapacity: 50,
    kcpDownlinkCapacity: 20,
    kcpReadBuffer: 2,
    kcpWriteBuffer: 2,
    h2Path: "/",
    h2Host: "",
    h2ReadIdleTimeout: 10,
    h2HealthCheckTimeout: 15,
    tlsServerName: "",
    tlsAlpn: "http/1.1",
    tlsAllowInsecure: false,
    tlsMinVersion: "1.2",
    tlsCipherSuites: "",
    tlsCertificateFile: "",
    tlsKeyFile: "",
    tlsCertificatePem: "",
    tlsKeyPem: "",
    wsPath: "/",
    wsHost: "",
    xhttpPath: "/",
    xhttpHost: "",
    xhttpHeaders: [],
    xhttpScMaxBufferedPosts: 30,
    xhttpScMaxEachPostBytes: "1000000",
    xhttpScStreamUpServerSecs: "20-80",
    xhttpNoSseHeader: false,
    xhttpMode: "auto",
    xhttpPaddingBytes: "100-1000",
    xhttpPaddingObfs: false,
    xhttpPaddingKey: "",
    xhttpPaddingHeader: "",
    xhttpPaddingPlacement: "",
    xhttpPaddingMethod: "",
    xhttpUplinkHttpMethod: "",
    xhttpSessionPlacement: "",
    xhttpSessionKey: "",
    xhttpSeqPlacement: "",
    xhttpSeqKey: "",
    xhttpUplinkDataPlacement: "",
    xhttpUplinkDataKey: "",
    xhttpUplinkChunkSize: 0,
    grpcServiceName: "",
    grpcMultiMode: false,
    grpcIdleTimeout: 0,
    grpcHealthCheckTimeout: 0,
    grpcPermitWithoutStream: false,
    tcpHttpPath: "/",
    tcpHttpRequestHeaders: [],
    tcpHttpResponseStatus: "200",
    tcpHttpResponseReason: "OK",
    tcpHttpResponseHeaders: [],
    hysteria2Masquerade: "",
    sockoptTcpFastOpen: false,
    sockoptTproxy: "off",
    sockoptMark: 0,
    sockoptTcpKeepAlive: 0,
    sockoptTcpMss: 0,
    tlsOcspStapling: 0,
    tlsVerifyClientCertificate: false,
    tlsPinnedSha256: "",
    hysteriaUdpIdleTimeout: 60,
    hysteriaObfsType: "",
    hysteriaObfsPassword: "",
    tlsMaxVersion: "",
    tlsRejectUnknownSni: false,
    tlsDisableSystemRoot: false,
    tlsEnableSessionResumption: true,
    tlsUtlsFingerprint: "chrome",
    tlsEchServerKeys: "",
    tlsEchForceQuery: "none",
    tlsEchConfigList: "",
    tlsCertOneTimeLoading: false,
    tlsCertUsage: "encipherment",
    tlsCertBuildChain: false,
    realityShow: false,
    realityXver: 0,
    realityTarget: "www.apple.com:443",
    realityServerNames: "www.apple.com,apple.com",
    realityPrivateKey: "",
    realityMinClientVer: "",
    realityMaxClientVer: "",
    realityMaxTimeDiff: 0,
    realityShortIds: "",
    realityMldsa65Seed: "",
    realityPublicKey: "",
    realityFingerprint: "chrome",
    realitySettingsServerName: "",
    realitySpiderX: "/",
    realityMldsa65Verify: "",
  };
}

/** Defaults when switching inbound protocol to Hysteria / Hysteria2 (QUIC-TLS). */
export function defaultStreamFormHysteria(): StreamFormState {
  return {
    ...defaultStreamForm(),
    tlsAlpn: "h3",
    tlsMinVersion: "1.2",
    tlsMaxVersion: "1.3",
    tlsEnableSessionResumption: true,
    tlsUtlsFingerprint: "chrome",
    tlsEchForceQuery: "none",
    hysteriaUdpIdleTimeout: 60,
    hysteriaObfsType: "",
    hysteriaObfsPassword: "",
  };
}

function tlsCertificatesFromStreamForm(state: StreamFormState): unknown[] {
  const certFile = state.tlsCertificateFile.trim();
  const keyFile = state.tlsKeyFile.trim();
  const pemCert = state.tlsCertificatePem.trim();
  const pemKey = state.tlsKeyPem.trim();
  if (certFile && keyFile) {
    return [
      {
        certificateFile: certFile,
        keyFile,
      },
    ];
  }
  if (pemCert && pemKey) {
    return [
      {
        certificate: pemToCertArray(pemCert),
        key: pemToCertArray(pemKey),
      },
    ];
  }
  if (certFile || keyFile || pemCert || pemKey) {
    return [
      {
        certificateFile: certFile,
        keyFile,
        certificate: pemCert ? pemToCertArray(pemCert) : [],
        key: pemKey ? pemToCertArray(pemKey) : [],
      },
    ];
  }
  return [];
}

function hysteriaCertEntriesWithMeta(
  certs: unknown[],
  state: StreamFormState,
): unknown[] {
  if (certs.length === 0) return certs;
  return certs.map((c, i) => {
    if (i !== 0 || typeof c !== "object" || c === null) return c;
    const o = c as Record<string, unknown>;
    return {
      ...o,
      oneTimeLoading: state.tlsCertOneTimeLoading,
      usage: state.tlsCertUsage.trim() || "encipherment",
      buildChain: state.tlsCertBuildChain,
    };
  });
}

function parseHysteriaTlsFormFields(
  base: StreamFormState,
  root: Record<string, unknown>,
): void {
  const hy = root.hysteriaSettings as Record<string, unknown> | undefined;
  if (hy) {
    const timeout = hy.udpIdleTimeout;
    if (typeof timeout === "number" && timeout > 0) {
      base.hysteriaUdpIdleTimeout = Math.round(timeout);
    }
  }
  const fm = root.finalmask as Record<string, unknown> | undefined;
  const udp = fm?.udp;
  if (Array.isArray(udp)) {
    for (const item of udp) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      if (m.type === "salamander") {
        const settings =
          m.settings && typeof m.settings === "object"
            ? (m.settings as Record<string, unknown>)
            : null;
        const settingsPwd =
          settings && typeof settings.password === "string" ? settings.password : "";
        const legacyPwd = typeof m.password === "string" ? m.password : "";
        const pwd = settingsPwd.trim() ? settingsPwd : legacyPwd;
        if (pwd.trim()) {
          base.hysteriaObfsType = "salamander";
          base.hysteriaObfsPassword = pwd;
          break;
        }
      }
    }
  }
  if (typeof root.masquerade === "string") base.hysteria2Masquerade = root.masquerade;
  const tls = root.tlsSettings as Record<string, unknown> | undefined;
  if (!tls) return;
  if (typeof tls.serverName === "string") base.tlsServerName = tls.serverName;
  base.tlsAlpn = alpnToString(tls.alpn);
  if (tls.allowInsecure === true) base.tlsAllowInsecure = true;
  const pinnedFromTls = tlsPinnedSha256FromTls(tls);
  if (pinnedFromTls) base.tlsPinnedSha256 = pinnedFromTls;
  const mv = tls.minVersion;
  if (mv === "1.3" || mv === "1.2") base.tlsMinVersion = mv;
  const maxV = tls.maxVersion;
  if (maxV === "1.3" || maxV === "1.2") base.tlsMaxVersion = maxV;
  if (typeof tls.cipherSuites === "string") base.tlsCipherSuites = tls.cipherSuites;
  if (typeof tls.rejectUnknownSni === "boolean") {
    base.tlsRejectUnknownSni = tls.rejectUnknownSni;
  }
  if (typeof tls.disableSystemRoot === "boolean") {
    base.tlsDisableSystemRoot = tls.disableSystemRoot;
  }
  if (typeof tls.enableSessionResumption === "boolean") {
    base.tlsEnableSessionResumption = tls.enableSessionResumption;
  }
  if (typeof tls.echServerKeys === "string") base.tlsEchServerKeys = tls.echServerKeys;
  if (typeof tls.echForceQuery === "string") base.tlsEchForceQuery = tls.echForceQuery;
  const tset = tls.settings as Record<string, unknown> | undefined;
  if (tset) {
    if (typeof tset.fingerprint === "string") base.tlsUtlsFingerprint = tset.fingerprint;
    if (typeof tset.echConfigList === "string") {
      base.tlsEchConfigList = tset.echConfigList;
    }
  }
  const certs = tls.certificates;
  if (Array.isArray(certs) && certs.length > 0 && typeof certs[0] === "object" && certs[0] !== null) {
    const c0 = certs[0] as Record<string, unknown>;
    if (typeof c0.certificateFile === "string") base.tlsCertificateFile = c0.certificateFile;
    if (typeof c0.keyFile === "string") base.tlsKeyFile = c0.keyFile;
    if (c0.certificate != null) base.tlsCertificatePem = certArrayToPem(c0.certificate);
    if (c0.key != null) base.tlsKeyPem = certArrayToPem(c0.key);
    if (typeof c0.oneTimeLoading === "boolean") {
      base.tlsCertOneTimeLoading = c0.oneTimeLoading;
    }
    if (typeof c0.usage === "string") base.tlsCertUsage = c0.usage;
    if (typeof c0.buildChain === "boolean") base.tlsCertBuildChain = c0.buildChain;
  }
}

function buildHysteriaStreamSettingsFromForm(
  state: StreamFormState,
  version: 1 | 2,
): string {
  const rawCerts = tlsCertificatesFromStreamForm(state);
  const certificates = hysteriaCertEntriesWithMeta(rawCerts, state);
  const alpnParts = state.tlsAlpn
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const alpn = alpnParts.length > 0 ? alpnParts : ["h3"];

  const tlsSettings: Record<string, unknown> = {
    serverName: state.tlsServerName.trim(),
    minVersion: state.tlsMinVersion,
    alpn,
    cipherSuites: state.tlsCipherSuites.trim(),
    rejectUnknownSni: state.tlsRejectUnknownSni,
    disableSystemRoot: state.tlsDisableSystemRoot,
    enableSessionResumption: state.tlsEnableSessionResumption,
    certificates,
    echServerKeys: state.tlsEchServerKeys.trim(),
    echForceQuery: state.tlsEchForceQuery.trim() || "none",
    settings: {
      fingerprint: state.tlsUtlsFingerprint.trim() || "chrome",
      echConfigList: state.tlsEchConfigList.trim(),
    },
  };
  if (state.tlsMaxVersion === "1.2" || state.tlsMaxVersion === "1.3") {
    tlsSettings.maxVersion = state.tlsMaxVersion;
  }
  applyTlsPinnedSha256ToSettings(tlsSettings, state.tlsPinnedSha256);

  const out: Record<string, unknown> = {
    network: "hysteria",
    security: "tls",
    externalProxy: [],
    tlsSettings,
    hysteriaSettings: {
      version,
      auth: "",
      udpIdleTimeout: Math.max(1, Math.round(state.hysteriaUdpIdleTimeout) || 60),
    },
  };
  // Match common Xray Hy2 setups (e.g. other panels): BBR on QUIC stack; keeps client/server congestion aligned.
  if (version === 2) {
    const finalmask: Record<string, unknown> = {
      quicParams: {
        debug: false,
        congestion: "bbr",
      },
    };
    const obfsPwd = state.hysteriaObfsPassword.trim();
    if (state.hysteriaObfsType === "salamander" && [...obfsPwd].length >= 4) {
      finalmask.udp = [{ type: "salamander", settings: { password: obfsPwd } }];
    }
    out.finalmask = finalmask;
    const masquerade = state.hysteria2Masquerade.trim();
    if (masquerade) out.masquerade = masquerade;
  }
  return JSON.stringify(out);
}

function pemToCertArray(pem: string): string[] {
  const t = pem.trim();
  if (!t) return [];
  return t.split("\n").map((l) => l.trimEnd());
}

function certArrayToPem(lines: unknown): string {
  if (typeof lines === "string") return lines;
  if (!Array.isArray(lines)) return "";
  return lines.filter((x) => typeof x === "string").join("\n");
}

function isObfuscationHeaderType(s: string): s is HeaderObfuscationType {
  return (
    s === "none" ||
    s === "srtp" ||
    s === "utp" ||
    s === "wechat-video" ||
    s === "dtls" ||
    s === "wireguard"
  );
}

function alpnToString(alpn: unknown): string {
  if (!Array.isArray(alpn)) return "http/1.1";
  return alpn.filter((x) => typeof x === "string").join(", ");
}

/** Read pinnedPeerCertSha256 from Xray tlsSettings (supports legacy field names). */
function tlsPinnedSha256FromTls(tls: Record<string, unknown>): string {
  const pinned =
    tls.pinnedPeerCertSha256 ?? tls.pinnedPeerCertificateChainSha256;
  if (Array.isArray(pinned)) {
    return pinned.filter((x) => typeof x === "string").join("\n");
  }
  if (typeof pinned === "string" && pinned.trim()) return pinned.trim();
  return "";
}

function applyTlsPinnedSha256ToSettings(
  tlsSettings: Record<string, unknown>,
  pinnedLines: string,
): void {
  const pinned = pinnedLines
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (pinned.length > 0) {
    tlsSettings.pinnedPeerCertSha256 = pinned.join(",");
  }
}

function parseHeaderType(tcp: Record<string, unknown> | undefined): "none" | "http" {
  const header = tcp?.header as Record<string, unknown> | undefined;
  const ty = header?.type;
  return ty === "http" ? "http" : "none";
}

/** How the inbound transport editor maps to streamSettings (UI varies by protocol). */
export type InboundStreamTransportMode =
  | "hysteria"
  | "mixed"
  | "shadowsocks"
  | "wireguard"
  | "telemt"
  | "amneziawg"
  | "full";

/** Inbounds supervised outside Xray-core (no streamSettings / sniffing in worker JSON). */
export function isSidecarInboundProtocol(protocol: InboundFormProtocol): boolean {
  return protocol === "telemt" || protocol === "amneziawg";
}

export function sidecarEmptySniffingString(): string {
  return JSON.stringify({
    enabled: false,
    destOverride: [],
    metadataOnly: false,
    routeOnly: false,
  });
}

export function getInboundStreamTransportMode(
  protocol: InboundFormProtocol,
): InboundStreamTransportMode {
  if (protocol === "hysteria" || protocol === "hysteria2") return "hysteria";
  /** Mixed (HTTP+SOCKS proxy): plain TCP only, no WS/TLS. */
  if (protocol === "mixed") return "mixed";
  /** TCP/WS, stream security none — Shadowsocks has its own crypto. */
  if (protocol === "shadowsocks") return "shadowsocks";
  if (protocol === "wireguard") return "wireguard";
  /** Telemt / AmneziaWG run outside Xray — no Xray streamSettings. */
  if (protocol === "telemt") return "telemt";
  if (protocol === "amneziawg") return "amneziawg";
  return "full";
}

/**
 * Shadowsocks: only TCP or WebSocket, stream security is always "none" (SS has its own crypto).
 * TLS/REALITY apply to VLESS/VMess/Trojan, not this protocol — ignore if present in saved JSON.
 */
function parseStreamSettingsShadowsocksForm(json: string): StreamFormState {
  const base = defaultStreamForm();
  base.security = "none";
  try {
    const root = JSON.parse(json) as Record<string, unknown>;
    const net = root.network;
    base.network = net === "ws" ? "ws" : "tcp";
    if (root.acceptProxyProtocol === true) base.acceptProxyProtocol = true;
    const tcp = root.tcpSettings as Record<string, unknown> | undefined;
    if (tcp) {
      if (!base.acceptProxyProtocol) base.acceptProxyProtocol = tcp.acceptProxyProtocol === true;
      base.tcpHeaderType = parseHeaderType(tcp);
    }
    const ws = root.wsSettings as Record<string, unknown> | undefined;
    if (ws) {
      if (typeof ws.path === "string") base.wsPath = ws.path;
      const headers = ws.headers as Record<string, unknown> | undefined;
      const host = headers?.Host ?? headers?.host;
      if (typeof host === "string") base.wsHost = host;
    }
  } catch {
    /* keep defaults */
  }
  return base;
}

function buildStreamSettingsShadowsocksFromForm(state: StreamFormState): string {
  const net = state.network === "ws" ? "ws" : "tcp";
  const out: Record<string, unknown> = {
    network: net,
    security: "none",
  };
  if (net === "tcp") {
    out.tcpSettings = {
      acceptProxyProtocol: state.acceptProxyProtocol,
      header: { type: state.tcpHeaderType },
    };
  } else {
    const headers: Record<string, string> = {};
    if (state.wsHost.trim()) {
      headers.Host = state.wsHost.trim();
    }
    out.wsSettings = {
      path: state.wsPath.trim() || "/",
      headers,
    };
  }
  return JSON.stringify(out);
}

/** Preset: Shadowsocks + WebSocket (no stream TLS). */
export function streamPresetShadowsocksWsString(): string {
  return JSON.stringify({
    network: "ws",
    security: "none",
    wsSettings: {
      path: "/",
      headers: {},
    },
  });
}

/** Map existing streamSettings JSON into form state. Best-effort for tcp/ws/grpc + tls. */
export function parseStreamSettingsToForm(
  json: string,
  protocol: InboundFormProtocol,
): StreamFormState {
  const base = defaultStreamForm();
  if (protocol === "wireguard" || protocol === "telemt" || protocol === "amneziawg") {
    return base;
  }
  if (protocol === "hysteria" || protocol === "hysteria2") {
    try {
      const root = JSON.parse(json) as Record<string, unknown>;
      parseHysteriaTlsFormFields(base, root);
    } catch {
      /* keep defaults */
    }
    return base;
  }
  if (protocol === "shadowsocks" || protocol === "mixed") {
    const state = parseStreamSettingsShadowsocksForm(json);
    // mixed only supports TCP — ignore any WebSocket state that might have been stored
    if (protocol === "mixed") state.network = "tcp";
    return state;
  }
  try {
    const root = JSON.parse(json) as Record<string, unknown>;
    const net = root.network;
    if (
      net === "ws" ||
      net === "grpc" ||
      net === "tcp" ||
      net === "quic" ||
      net === "xhttp" ||
      net === "httpupgrade" ||
      net === "kcp" ||
      net === "h2"
    ) {
      base.network = net;
    }
    const sec = root.security;
    if (sec === "tls" || sec === "none" || sec === "reality") {
      base.security = sec;
    }
    const rs = root.realitySettings as Record<string, unknown> | undefined;
    if (rs && typeof rs === "object" && !Array.isArray(rs)) {
      base.security = "reality";
      if (typeof rs.show === "boolean") base.realityShow = rs.show;
      if (typeof rs.xver === "number" && rs.xver >= 0) base.realityXver = rs.xver;
      const tgt = rs.target ?? rs.dest;
      if (typeof tgt === "string") base.realityTarget = tgt;
      if (Array.isArray(rs.serverNames)) {
        base.realityServerNames = rs.serverNames
          .filter((x): x is string => typeof x === "string")
          .join(",");
      } else if (typeof rs.serverNames === "string") {
        base.realityServerNames = rs.serverNames;
      }
      if (typeof rs.privateKey === "string") base.realityPrivateKey = rs.privateKey;
      if (typeof rs.minClientVer === "string") base.realityMinClientVer = rs.minClientVer;
      if (typeof rs.maxClientVer === "string") base.realityMaxClientVer = rs.maxClientVer;
      const mtd = rs.maxTimediff ?? rs.maxTimeDiff;
      if (typeof mtd === "number" && mtd >= 0) base.realityMaxTimeDiff = mtd;
      if (Array.isArray(rs.shortIds)) {
        base.realityShortIds = rs.shortIds
          .filter((x): x is string => typeof x === "string")
          .join(",");
      } else if (typeof rs.shortIds === "string") {
        base.realityShortIds = rs.shortIds;
      }
      if (typeof rs.mldsa65Seed === "string") base.realityMldsa65Seed = rs.mldsa65Seed;
      const rst = rs.settings as Record<string, unknown> | undefined;
      if (rst && typeof rst === "object") {
        if (typeof rst.publicKey === "string") base.realityPublicKey = rst.publicKey;
        if (typeof rst.fingerprint === "string") base.realityFingerprint = rst.fingerprint;
        if (typeof rst.serverName === "string") base.realitySettingsServerName = rst.serverName;
        if (typeof rst.spiderX === "string") base.realitySpiderX = rst.spiderX;
        if (typeof rst.mldsa65Verify === "string") base.realityMldsa65Verify = rst.mldsa65Verify;
      }
    }
    // Top-level acceptProxyProtocol (all transports) takes precedence.
    if (root.acceptProxyProtocol === true) base.acceptProxyProtocol = true;
    const tcp = root.tcpSettings as Record<string, unknown> | undefined;
    if (tcp) {
      if (!base.acceptProxyProtocol) base.acceptProxyProtocol = tcp.acceptProxyProtocol === true;
      base.tcpHeaderType = parseHeaderType(tcp);
      if (base.tcpHeaderType === "http") {
        const hdr = tcp.header as Record<string, unknown> | undefined;
        const req = hdr?.request as Record<string, unknown> | undefined;
        const resp = hdr?.response as Record<string, unknown> | undefined;
        if (req) {
          const paths = req.path;
          if (Array.isArray(paths) && typeof paths[0] === "string") base.tcpHttpPath = paths[0];
          else if (typeof paths === "string") base.tcpHttpPath = paths;
          base.tcpHttpRequestHeaders = xhttpHeadersFromXrayJson(req.headers);
        }
        if (resp) {
          if (typeof resp.status === "string") base.tcpHttpResponseStatus = resp.status;
          if (typeof resp.reason === "string") base.tcpHttpResponseReason = resp.reason;
          base.tcpHttpResponseHeaders = xhttpHeadersFromXrayJson(resp.headers);
        }
      }
    }
    const sockopt = root.sockopt as Record<string, unknown> | undefined;
    if (sockopt) {
      if (sockopt.tcpFastOpen === true) base.sockoptTcpFastOpen = true;
      const tp = sockopt.tproxy;
      if (tp === "redirect" || tp === "tproxy") base.sockoptTproxy = tp;
      if (typeof sockopt.mark === "number" && sockopt.mark > 0) base.sockoptMark = sockopt.mark;
      if (typeof sockopt.tcpKeepAliveInterval === "number" && sockopt.tcpKeepAliveInterval >= 0) {
        base.sockoptTcpKeepAlive = sockopt.tcpKeepAliveInterval;
      }
      if (typeof sockopt.tcpMss === "number" && sockopt.tcpMss > 0) {
        base.sockoptTcpMss = sockopt.tcpMss;
      }
    }
    const ws = root.wsSettings as Record<string, unknown> | undefined;
    if (ws) {
      if (typeof ws.path === "string") base.wsPath = ws.path;
      const headers = ws.headers as Record<string, unknown> | undefined;
      const host = headers?.Host ?? headers?.host;
      if (typeof host === "string") base.wsHost = host;
    }
    const hu = root.httpupgradeSettings as Record<string, unknown> | undefined;
    if (hu) {
      if (typeof hu.path === "string") base.wsPath = hu.path;
      const headers = hu.headers as Record<string, unknown> | undefined;
      const host = headers?.Host ?? headers?.host;
      if (typeof host === "string") base.wsHost = host;
    }
    const grpc = root.grpcSettings as Record<string, unknown> | undefined;
    if (grpc) {
      if (typeof grpc.serviceName === "string") base.grpcServiceName = grpc.serviceName;
      if (typeof grpc.multiMode === "boolean") base.grpcMultiMode = grpc.multiMode;
      if (typeof grpc.idle_timeout === "number" && grpc.idle_timeout >= 0) base.grpcIdleTimeout = grpc.idle_timeout;
      if (typeof grpc.health_check_timeout === "number" && grpc.health_check_timeout >= 0) base.grpcHealthCheckTimeout = grpc.health_check_timeout;
      if (typeof grpc.permit_without_stream === "boolean") base.grpcPermitWithoutStream = grpc.permit_without_stream;
    }
    const quic = root.quicSettings as Record<string, unknown> | undefined;
    if (quic) {
      const qs = quic.security;
      if (qs === "aes-128-gcm" || qs === "chacha20-poly1305" || qs === "none") {
        base.quicSecurity = qs;
      }
      if (typeof quic.key === "string") base.quicKey = quic.key;
      const qh = quic.header as Record<string, unknown> | undefined;
      const qht = qh?.type;
      if (typeof qht === "string" && isObfuscationHeaderType(qht)) {
        base.quicHeaderType = qht;
      }
    }
    if (net === "kcp") {
      const kcp = root.kcpSettings as Record<string, unknown> | undefined;
      if (kcp) {
        const kh = kcp.header as Record<string, unknown> | undefined;
        const kht = kh?.type;
        if (typeof kht === "string" && isObfuscationHeaderType(kht)) base.kcpHeaderType = kht;
        if (typeof kcp.seed === "string") base.kcpSeed = kcp.seed;
        if (typeof kcp.congestion === "boolean") base.kcpCongestion = kcp.congestion;
        if (typeof kcp.mtu === "number" && kcp.mtu > 0) base.kcpMtu = kcp.mtu;
        if (typeof kcp.tti === "number" && kcp.tti > 0) base.kcpTti = kcp.tti;
        if (typeof kcp.uplinkCapacity === "number" && kcp.uplinkCapacity >= 0) base.kcpUplinkCapacity = kcp.uplinkCapacity;
        if (typeof kcp.downlinkCapacity === "number" && kcp.downlinkCapacity >= 0) base.kcpDownlinkCapacity = kcp.downlinkCapacity;
        if (typeof kcp.readBufferSize === "number" && kcp.readBufferSize > 0) base.kcpReadBuffer = kcp.readBufferSize;
        if (typeof kcp.writeBufferSize === "number" && kcp.writeBufferSize > 0) base.kcpWriteBuffer = kcp.writeBufferSize;
      }
    }
    if (net === "h2") {
      const h2 = root.httpSettings as Record<string, unknown> | undefined;
      if (h2) {
        if (typeof h2.path === "string") base.h2Path = h2.path;
        const h2host = h2.host;
        if (Array.isArray(h2host) && h2host.length > 0 && typeof h2host[0] === "string") {
          base.h2Host = h2host.join(",");
        } else if (typeof h2host === "string") {
          base.h2Host = h2host;
        }
        if (typeof h2.read_idle_timeout === "number" && h2.read_idle_timeout > 0) {
          base.h2ReadIdleTimeout = h2.read_idle_timeout;
        }
        if (typeof h2.health_check_timeout === "number" && h2.health_check_timeout > 0) {
          base.h2HealthCheckTimeout = h2.health_check_timeout;
        }
      }
    }
    if (net === "xhttp") {
      const xh = root.xhttpSettings as Record<string, unknown> | undefined;
      if (xh && typeof xh === "object" && !Array.isArray(xh)) {
        if (typeof xh.path === "string") base.xhttpPath = xh.path;
        if (typeof xh.host === "string") base.xhttpHost = xh.host;
        base.xhttpHeaders = xhttpHeadersFromXrayJson(xh.headers);
        if (typeof xh.scMaxBufferedPosts === "number" && xh.scMaxBufferedPosts >= 0) {
          base.xhttpScMaxBufferedPosts = Math.round(xh.scMaxBufferedPosts);
        }
        if (typeof xh.scMaxEachPostBytes === "string") base.xhttpScMaxEachPostBytes = xh.scMaxEachPostBytes;
        if (typeof xh.scStreamUpServerSecs === "string") {
          base.xhttpScStreamUpServerSecs = xh.scStreamUpServerSecs;
        }
        if (xh.noSSEHeader === true) base.xhttpNoSseHeader = true;
        if (typeof xh.mode === "string") base.xhttpMode = xh.mode;
        if (typeof xh.xPaddingBytes === "string") base.xhttpPaddingBytes = xh.xPaddingBytes;
        if (xh.xPaddingObfsMode === true) base.xhttpPaddingObfs = true;
        if (typeof xh.xPaddingKey === "string") base.xhttpPaddingKey = xh.xPaddingKey;
        if (typeof xh.xPaddingHeader === "string") base.xhttpPaddingHeader = xh.xPaddingHeader;
        if (typeof xh.xPaddingPlacement === "string") base.xhttpPaddingPlacement = xh.xPaddingPlacement;
        if (typeof xh.xPaddingMethod === "string") base.xhttpPaddingMethod = xh.xPaddingMethod;
        if (typeof xh.uplinkHTTPMethod === "string") base.xhttpUplinkHttpMethod = xh.uplinkHTTPMethod;
        if (typeof xh.sessionPlacement === "string") base.xhttpSessionPlacement = xh.sessionPlacement;
        if (typeof xh.sessionKey === "string") base.xhttpSessionKey = xh.sessionKey;
        if (typeof xh.seqPlacement === "string") base.xhttpSeqPlacement = xh.seqPlacement;
        if (typeof xh.seqKey === "string") base.xhttpSeqKey = xh.seqKey;
        if (typeof xh.uplinkDataPlacement === "string") {
          base.xhttpUplinkDataPlacement = xh.uplinkDataPlacement;
        }
        if (typeof xh.uplinkDataKey === "string") base.xhttpUplinkDataKey = xh.uplinkDataKey;
        if (typeof xh.uplinkChunkSize === "number" && xh.uplinkChunkSize >= 0) {
          base.xhttpUplinkChunkSize = Math.round(xh.uplinkChunkSize);
        }
      }
    }
    if (base.security === "tls") {
      const tls = root.tlsSettings as Record<string, unknown> | undefined;
      if (tls) {
        if (typeof tls.serverName === "string") base.tlsServerName = tls.serverName;
        base.tlsAlpn = alpnToString(tls.alpn);
        if (tls.allowInsecure === true) base.tlsAllowInsecure = true;
        const mv = tls.minVersion;
        if (mv === "1.3" || mv === "1.2") base.tlsMinVersion = mv;
        if (typeof tls.cipherSuites === "string") {
          base.tlsCipherSuites = tls.cipherSuites;
        }
        if (typeof tls.ocspStapling === "number" && tls.ocspStapling >= 0) {
          base.tlsOcspStapling = tls.ocspStapling;
        }
        if (tls.verifyClientCertificate === true) base.tlsVerifyClientCertificate = true;
        const pinnedFromTls = tlsPinnedSha256FromTls(tls);
        if (pinnedFromTls) base.tlsPinnedSha256 = pinnedFromTls;
        const certs = tls.certificates;
        if (Array.isArray(certs) && certs.length > 0 && typeof certs[0] === "object" && certs[0] !== null) {
          const c0 = certs[0] as Record<string, unknown>;
          if (typeof c0.certificateFile === "string") {
            base.tlsCertificateFile = c0.certificateFile;
          }
          if (typeof c0.keyFile === "string") {
            base.tlsKeyFile = c0.keyFile;
          }
          if (c0.certificate != null) {
            base.tlsCertificatePem = certArrayToPem(c0.certificate);
          }
          if (c0.key != null) {
            base.tlsKeyPem = certArrayToPem(c0.key);
          }
        }
      }
    }
  } catch {
    /* defaults */
  }
  return base;
}

/** Build streamSettings JSON string from structured form (and protocol). */
export function buildStreamSettingsFromForm(
  state: StreamFormState,
  protocol: InboundFormProtocol,
): string {
  if (protocol === "wireguard" || protocol === "telemt" || protocol === "amneziawg") {
    return "{}";
  }
  if (protocol === "hysteria") {
    return buildHysteriaStreamSettingsFromForm(state, 1);
  }
  if (protocol === "hysteria2") {
    return buildHysteriaStreamSettingsFromForm(state, 2);
  }
  if (protocol === "shadowsocks" || protocol === "mixed") {
    return buildStreamSettingsShadowsocksFromForm(state);
  }

  const out: Record<string, unknown> = {
    network: state.network,
    security: state.security,
  };

  // Always store acceptProxyProtocol at the top level so the Go builder can lift it
  // to the Xray inbound level (works for all transports, not just TCP).
  if (state.acceptProxyProtocol) {
    out.acceptProxyProtocol = true;
  }

  if (state.network === "tcp") {
    const tcpHeader: Record<string, unknown> = { type: state.tcpHeaderType };
    if (state.tcpHeaderType === "http") {
      const reqHeaders = xhttpHeadersToV2Map(state.tcpHttpRequestHeaders);
      const respHeaders = xhttpHeadersToV2Map(state.tcpHttpResponseHeaders);
      tcpHeader.request = {
        version: "1.1",
        method: "GET",
        path: [state.tcpHttpPath.trim() || "/"],
        headers: Object.keys(reqHeaders).length > 0 ? reqHeaders : undefined,
      };
      tcpHeader.response = {
        version: "1.1",
        status: state.tcpHttpResponseStatus.trim() || "200",
        reason: state.tcpHttpResponseReason.trim() || "OK",
        headers: Object.keys(respHeaders).length > 0 ? respHeaders : undefined,
      };
    }
    out.tcpSettings = {
      acceptProxyProtocol: state.acceptProxyProtocol,
      header: tcpHeader,
    };
  } else if (state.network === "ws") {
    const headers: Record<string, string> = {};
    if (state.wsHost.trim()) {
      headers.Host = state.wsHost.trim();
    }
    out.wsSettings = {
      path: state.wsPath.trim() || "/",
      headers,
    };
  } else if (state.network === "httpupgrade") {
    const headers: Record<string, string> = {};
    if (state.wsHost.trim()) {
      headers.Host = state.wsHost.trim();
    }
    out.httpupgradeSettings = {
      path: state.wsPath.trim() || "/",
      headers,
    };
  } else if (state.network === "grpc") {
    const grpcSettings: Record<string, unknown> = {
      serviceName: state.grpcServiceName.trim(),
      multiMode: state.grpcMultiMode,
    };
    if (state.grpcIdleTimeout > 0) grpcSettings.idle_timeout = state.grpcIdleTimeout;
    if (state.grpcHealthCheckTimeout > 0) grpcSettings.health_check_timeout = state.grpcHealthCheckTimeout;
    if (state.grpcPermitWithoutStream) grpcSettings.permit_without_stream = true;
    out.grpcSettings = grpcSettings;
  } else if (state.network === "quic") {
    out.quicSettings = {
      security: state.quicSecurity,
      key: state.quicKey.trim(),
      header: { type: state.quicHeaderType },
    };
  } else if (state.network === "xhttp") {
    out.xhttpSettings = {
      path: state.xhttpPath.trim() || "/",
      host: state.xhttpHost.trim(),
      headers: xhttpHeadersToV2Map(state.xhttpHeaders),
      scMaxBufferedPosts: Math.max(0, Math.round(Number(state.xhttpScMaxBufferedPosts)) || 30),
      scMaxEachPostBytes: state.xhttpScMaxEachPostBytes.trim() || "1000000",
      scStreamUpServerSecs: state.xhttpScStreamUpServerSecs.trim() || "20-80",
      noSSEHeader: state.xhttpNoSseHeader,
      xPaddingBytes: state.xhttpPaddingBytes.trim() || "100-1000",
      mode: state.xhttpMode.trim() || "auto",
      xPaddingObfsMode: state.xhttpPaddingObfs,
      xPaddingKey: state.xhttpPaddingKey.trim(),
      xPaddingHeader: state.xhttpPaddingHeader.trim(),
      xPaddingPlacement: state.xhttpPaddingPlacement.trim(),
      xPaddingMethod: state.xhttpPaddingMethod.trim(),
      uplinkHTTPMethod: state.xhttpUplinkHttpMethod.trim(),
      sessionPlacement: state.xhttpSessionPlacement.trim(),
      sessionKey: state.xhttpSessionKey.trim(),
      seqPlacement: state.xhttpSeqPlacement.trim(),
      seqKey: state.xhttpSeqKey.trim(),
      uplinkDataPlacement: state.xhttpUplinkDataPlacement.trim(),
      uplinkDataKey: state.xhttpUplinkDataKey.trim(),
      uplinkChunkSize: Math.max(0, Math.round(Number(state.xhttpUplinkChunkSize)) || 0),
    };
  } else if (state.network === "kcp") {
    out.kcpSettings = {
      mtu: Math.max(576, Math.round(Number(state.kcpMtu)) || 1350),
      tti: Math.max(1, Math.round(Number(state.kcpTti)) || 20),
      uplinkCapacity: Math.max(0, Math.round(Number(state.kcpUplinkCapacity)) || 50),
      downlinkCapacity: Math.max(0, Math.round(Number(state.kcpDownlinkCapacity)) || 20),
      congestion: state.kcpCongestion,
      readBufferSize: Math.max(1, Math.round(Number(state.kcpReadBuffer)) || 2),
      writeBufferSize: Math.max(1, Math.round(Number(state.kcpWriteBuffer)) || 2),
      header: { type: state.kcpHeaderType },
      seed: state.kcpSeed.trim(),
    };
  } else if (state.network === "h2") {
    const h2hosts = state.h2Host
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const h2Settings: Record<string, unknown> = {
      path: state.h2Path.trim() || "/",
      host: h2hosts,
    };
    if (state.h2ReadIdleTimeout > 0) h2Settings.read_idle_timeout = state.h2ReadIdleTimeout;
    if (state.h2HealthCheckTimeout > 0) h2Settings.health_check_timeout = state.h2HealthCheckTimeout;
    out.httpSettings = h2Settings;
  }

  // Sockopt for inbound (stored inside streamSettings, Xray lifts it automatically)
  const hasSockopt =
    state.sockoptTcpFastOpen ||
    state.sockoptTproxy !== "off" ||
    state.sockoptMark > 0 ||
    state.sockoptTcpKeepAlive > 0 ||
    state.sockoptTcpMss > 0;
  if (hasSockopt) {
    const sockopt: Record<string, unknown> = {};
    if (state.sockoptTcpFastOpen) sockopt.tcpFastOpen = true;
    if (state.sockoptTproxy !== "off") sockopt.tproxy = state.sockoptTproxy;
    if (state.sockoptMark > 0) sockopt.mark = state.sockoptMark;
    if (state.sockoptTcpKeepAlive > 0) sockopt.tcpKeepAliveInterval = state.sockoptTcpKeepAlive;
    if (state.sockoptTcpMss > 0) sockopt.tcpMss = state.sockoptTcpMss;
    out.sockopt = sockopt;
  }

  if (state.security === "reality") {
    const serverNames = state.realityServerNames
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const shortParts = state.realityShortIds.split(",").map((s) => s.trim());
    const shortIds =
      state.realityShortIds.trim() === "" ? [""] : shortParts.length > 0 ? shortParts : [""];
    out.realitySettings = {
      show: state.realityShow,
      xver: Math.max(0, Math.round(Number(state.realityXver)) || 0),
      target: state.realityTarget.trim(),
      serverNames: serverNames.length > 0 ? serverNames : [""],
      privateKey: state.realityPrivateKey.trim(),
      minClientVer: state.realityMinClientVer.trim(),
      maxClientVer: state.realityMaxClientVer.trim(),
      maxTimediff: Math.max(0, Math.round(Number(state.realityMaxTimeDiff)) || 0),
      shortIds,
      mldsa65Seed: state.realityMldsa65Seed.trim(),
      settings: {
        publicKey: state.realityPublicKey.trim(),
        fingerprint: (state.realityFingerprint || "chrome").trim(),
        serverName: state.realitySettingsServerName.trim(),
        spiderX: (state.realitySpiderX.trim() || "/"),
        mldsa65Verify: state.realityMldsa65Verify.trim(),
      },
    };
  } else if (state.security === "tls") {
    const alpn = state.tlsAlpn
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const certificates = tlsCertificatesFromStreamForm(state);
    const tlsSettings: Record<string, unknown> = {
      serverName: state.tlsServerName.trim(),
      alpn: alpn.length > 0 ? alpn : ["http/1.1"],
      minVersion: state.tlsMinVersion,
      certificates,
      cipherSuites: state.tlsCipherSuites.trim(),
      preferServerCipherSuites: false,
    };
    if (state.tlsOcspStapling > 0) tlsSettings.ocspStapling = state.tlsOcspStapling;
    if (state.tlsVerifyClientCertificate) tlsSettings.verifyClientCertificate = true;
    applyTlsPinnedSha256ToSettings(tlsSettings, state.tlsPinnedSha256);
    out.tlsSettings = tlsSettings;
  }

  return JSON.stringify(out);
}

/** One row in VLESS/Trojan `settings.fallbacks` (TCP+TLS multiplexing → dest). */
export type VlessTrojanFallbackFormRow = {
  /** TLS SNI (Xray field `name`); empty = any */
  name: string;
  /** Negotiated ALPN; empty = any */
  alpn: string;
  /** First HTTP path; empty = any */
  path: string;
  /** `addr:port`, Unix socket path, or port only → localhost */
  dest: string;
  /** PROXY protocol: 0 off, 1 or 2 on */
  xver: string;
};

export function defaultVlessTrojanFallbackRow(): VlessTrojanFallbackFormRow {
  return { name: "", alpn: "", path: "", dest: "", xver: "0" };
}

export function fallbackRowsSettingsToJson(
  rows: VlessTrojanFallbackFormRow[],
): unknown[] {
  const out: unknown[] = [];
  for (const row of rows) {
    const d = row.dest.trim();
    if (!d) continue;
    const rec: Record<string, unknown> = {};
    if (row.name.trim()) rec.name = row.name.trim();
    if (row.alpn.trim()) rec.alpn = row.alpn.trim();
    if (row.path.trim()) rec.path = row.path.trim();
    rec.dest = /^\d+$/.test(d) ? parseInt(d, 10) : d;
    const xv = parseInt(String(row.xver).trim(), 10);
    rec.xver = Number.isFinite(xv) && xv >= 0 ? xv : 0;
    out.push(rec);
  }
  return out;
}

export function parseVlessTrojanFallbackRowsFromSettings(
  settingsStr: string,
  protocol: InboundFormProtocol,
): VlessTrojanFallbackFormRow[] {
  if (protocol !== "vless" && protocol !== "trojan") return [];
  let root: Record<string, unknown> = {};
  try {
    root = JSON.parse(settingsStr || "{}") as Record<string, unknown>;
  } catch {
    return [];
  }
  const fb = root.fallbacks;
  if (!Array.isArray(fb)) return [];
  return fb.map((item): VlessTrojanFallbackFormRow => {
    if (typeof item !== "object" || item === null) return defaultVlessTrojanFallbackRow();
    const o = item as Record<string, unknown>;
    let destStr = "";
    const dest = o.dest;
    if (typeof dest === "number" && Number.isFinite(dest)) destStr = String(dest);
    else if (typeof dest === "string") destStr = dest;
    const xv = o.xver;
    let xverStr = "0";
    if (typeof xv === "number" && Number.isFinite(xv)) xverStr = String(Math.trunc(xv));
    else if (typeof xv === "string") xverStr = xv;
    return {
      name: typeof o.name === "string" ? o.name : "",
      alpn: typeof o.alpn === "string" ? o.alpn : "",
      path: typeof o.path === "string" ? o.path : "",
      dest: destStr,
      xver: xverStr,
    };
  });
}

export type FirstClientPatch = {
  clientEmail: string;
  vlessFlow: string;
  trojanPassword: string;
  hysteriaAuth: string;
  ssMethod: string;
  ssPassword: string;
  /** Xray mixed inbound: SOCKS/HTTP account user (maps to accounts[].user). */
  mixedUser?: string;
  mixedPassword?: string;
  /** VLESS/Trojan only; persisted as `settings.fallbacks`. */
  vlessTrojanFallbacks?: VlessTrojanFallbackFormRow[];
  vlessEncryption?: string;
  vlessDecryption?: string;
};

export function buildSettingsJson(
  protocol: InboundFormProtocol,
  opts: FirstClientPatch,
): string {
  const email = opts.clientEmail.trim() || `user-${randomId(8)}@inbound.local`;
  const subId = randomSubId();
  const now = Date.now();

  switch (protocol) {
    case "vless": {
      const o = {
        clients: [
          {
            id: newClientUUID(),
            flow: opts.vlessFlow.trim(),
            email,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            enable: true,
            tgId: "",
            subId,
            comment: "",
            reset: 0,
            created_at: now,
            updated_at: now,
          },
        ],
        decryption: opts.vlessDecryption || "none",
        encryption: opts.vlessEncryption || "none",
        fallbacks: fallbackRowsSettingsToJson(opts.vlessTrojanFallbacks ?? []),
      };
      return JSON.stringify(o);
    }
    case "vmess": {
      const o = {
        clients: [
          {
            id: newClientUUID(),
            security: "auto",
            email,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            enable: true,
            tgId: "",
            subId,
            comment: "",
            reset: 0,
            created_at: now,
            updated_at: now,
          },
        ],
        disableInsecureEncryption: false,
      };
      return JSON.stringify(o);
    }
    case "trojan": {
      const password = opts.trojanPassword.trim() || randomPassword(12);
      const o = {
        clients: [
          {
            password,
            email,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            enable: true,
            tgId: "",
            subId,
            comment: "",
            reset: 0,
            created_at: now,
            updated_at: now,
          },
        ],
        fallbacks: fallbackRowsSettingsToJson(opts.vlessTrojanFallbacks ?? []),
      };
      return JSON.stringify(o);
    }
    case "hysteria":
    case "hysteria2": {
      const version = protocol === "hysteria2" ? 2 : 1;
      const auth = opts.hysteriaAuth.trim() || randomPassword(8);
      const o = {
        version,
        clients: [
          {
            auth,
            email,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            enable: true,
            tgId: "",
            subId,
            comment: "",
            reset: 0,
            created_at: now,
            updated_at: now,
          },
        ],
      };
      return JSON.stringify(o);
    }
    case "shadowsocks": {
      const method = opts.ssMethod || "aes-256-gcm";
      const o = {
        method,
        password: opts.ssPassword.trim() || randomShadowsocksServerPassword(method),
        network: "tcp,udp",
        clients: [],
        ivCheck: false,
      };
      return JSON.stringify(o);
    }
    case "mixed": {
      const user = (opts.mixedUser || "proxy").trim() || "proxy";
      const pass = (opts.mixedPassword ?? "").trim() || randomPassword(12);
      return JSON.stringify({
        auth: "password",
        accounts: [{ user, pass }],
        udp: true,
      });
    }
    case "telemt":
      return buildTelemtSettingsJson(defaultTelemtForm());
    default:
      return "{}";
  }
}

/** Bytes → GB string for form (3 decimal max). */
export function totalBytesToGbInput(totalBytes: number): string {
  if (!totalBytes || totalBytes <= 0) return "0";
  const gb = totalBytes / (1024 * 1024 * 1024);
  return String(Math.round(gb * 1000) / 1000);
}

/** Parse settings JSON and read first client fields for the inbound form. */
export function parseFirstClientFromSettings(
  settingsStr: string,
  protocol: InboundFormProtocol,
): Partial<FirstClientPatch> {
  if (protocol === "telemt") {
    return {};
  }
  try {
    const root = JSON.parse(settingsStr) as Record<string, unknown>;
    if (protocol === "mixed") {
      const out: Partial<FirstClientPatch> = {};
      const acc = root.accounts;
      if (Array.isArray(acc) && acc.length > 0) {
        const a0 = acc[0] as Record<string, unknown>;
        if (typeof a0.user === "string") out.mixedUser = a0.user;
        if (typeof a0.pass === "string") out.mixedPassword = a0.pass;
      }
      return out;
    }
    if (protocol === "shadowsocks") {
      return parseShadowsocksFromSettings(root);
    }
    const clients = root.clients;
    if (!Array.isArray(clients) || clients.length === 0) {
      if (protocol === "vless" || protocol === "trojan") {
        return {
          vlessTrojanFallbacks: parseVlessTrojanFallbackRowsFromSettings(settingsStr, protocol),
          vlessDecryption: typeof root.decryption === "string" ? root.decryption : "none",
          vlessEncryption: typeof root.encryption === "string" ? root.encryption : "none",
        };
      }
      return {};
    }
    const c = clients[0] as Record<string, unknown>;
    const out: Partial<FirstClientPatch> = {};
    if (typeof c.email === "string") out.clientEmail = c.email;
    if (typeof c.flow === "string") out.vlessFlow = c.flow;
    if (typeof c.password === "string") out.trojanPassword = c.password;
    if (typeof c.auth === "string") out.hysteriaAuth = c.auth;
    else if (typeof c.password === "string" && (protocol === "hysteria" || protocol === "hysteria2"))
      out.hysteriaAuth = c.password;
    if (typeof root.encryption === "string") out.vlessEncryption = root.encryption;
    if (typeof root.decryption === "string") out.vlessDecryption = root.decryption;
    if (typeof root.method === "string") out.ssMethod = root.method;
    if (typeof root.password === "string") out.ssPassword = root.password;
    if (protocol === "vless" || protocol === "trojan") {
      out.vlessTrojanFallbacks = parseVlessTrojanFallbackRowsFromSettings(settingsStr, protocol);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Merge form client fields into existing settings JSON (for edit).
 * Preserves non-first clients and non-client keys.
 */
export function mergeFirstClientIntoSettings(
  settingsStr: string,
  protocol: InboundFormProtocol,
  patch: FirstClientPatch,
): string {
  if (protocol === "telemt") {
    return settingsStr.trim() ? settingsStr : buildTelemtSettingsJson(defaultTelemtForm());
  }
  let root: Record<string, unknown> = {};
  try {
    root = JSON.parse(settingsStr) as Record<string, unknown>;
  } catch {
    root = {};
  }
  const now = Date.now();

  if (protocol === "shadowsocks") {
    const prevMethod = typeof root.method === "string" ? root.method : "";
    const method = patch.ssMethod || prevMethod || "aes-256-gcm";
    const existingPw = typeof root.password === "string" ? root.password.trim() : "";
    const patchPw = patch.ssPassword.trim();
    root.method = method;
    if (patchPw) {
      root.password = patchPw;
    } else if (existingPw && method === prevMethod) {
      root.password = existingPw;
    } else {
      root.password = randomShadowsocksServerPassword(method);
    }
    if (!Array.isArray(root.clients)) root.clients = [];
    root.clients = stripShadowsocksClientMethods(method, root.clients);
    return JSON.stringify(root);
  }

  if (protocol === "mixed") {
    const user = (patch.mixedUser || "proxy").trim() || "proxy";
    const pass = (patch.mixedPassword ?? "").trim() || randomPassword(12);
    root.auth = "password";
    root.udp = true;
    delete root.clients;
    // Preserve all existing accounts, only update the one matching the form user
    const existing = Array.isArray(root.accounts)
      ? (root.accounts as Array<{ user: string; pass: string }>)
      : [];
    const idx = existing.findIndex((a) => a.user === user);
    if (idx >= 0) {
      existing[idx] = { user, pass };
      root.accounts = existing;
    } else if (existing.length > 0) {
      // Form user not found in existing list — replace first slot (legacy single-user edit)
      root.accounts = [{ user, pass }, ...existing.slice(1)];
    } else {
      root.accounts = [{ user, pass }];
    }
    return JSON.stringify(root);
  }

  let clients = Array.isArray(root.clients) ? [...root.clients] : [];
  const first =
    clients.length > 0 && typeof clients[0] === "object" && clients[0] !== null
      ? { ...(clients[0] as Record<string, unknown>) }
      : {};

  const existingEmail =
    typeof first.email === "string" && first.email.trim()
      ? first.email.trim()
      : "";
  const email =
    patch.clientEmail.trim() ||
    existingEmail ||
    `user-${randomId(8)}@inbound.local`;

  first.email = email;
  first.enable = first.enable !== false;
  if (first.created_at == null) first.created_at = now;
  first.updated_at = now;

  switch (protocol) {
    case "vless":
      first.id = typeof first.id === "string" && first.id ? first.id : newClientUUID();
      first.flow = patch.vlessFlow.trim(); // caller should pass effectiveVlessFlow() result
      root.decryption = patch.vlessDecryption || "none";
      root.encryption = patch.vlessEncryption || "none";
      break;
    case "vmess":
      first.id = typeof first.id === "string" && first.id ? first.id : newClientUUID();
      first.security = typeof first.security === "string" ? first.security : "auto";
      break;
    case "trojan": {
      const pw = patch.trojanPassword.trim() || randomPassword(12);
      first.password = pw;
      break;
    }
    case "hysteria":
    case "hysteria2": {
      const auth = patch.hysteriaAuth.trim() || randomPassword(8);
      first.auth = auth;
      delete first.password;
      root.version = protocol === "hysteria2" ? 2 : 1;
      break;
    }
    default:
      break;
  }

  if (protocol === "vless" || protocol === "trojan") {
      const fallbacks = fallbackRowsSettingsToJson(
        patch.vlessTrojanFallbacks ?? []
      );

      if (fallbacks.length > 0) {
         root.fallbacks = fallbacks;
      } else {
         delete root.fallbacks;
      }
  }

  clients = [first, ...clients.slice(1)];
  root.clients = clients;
  return JSON.stringify(root);
}

function randomHexSeq(len: number): string {
  const arr = new Uint8Array(Math.ceil(len / 2));
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

/** Comma-separated Reality shortIds (same idea as legacy RandomUtil.randomShortIds). */
export function randomRealityShortIds(): string {
  const lengths = [2, 4, 6, 8, 10, 12, 14, 16]
    .map((x) => ({ x, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .map(({ x }) => x);
  return lengths.map((len) => randomHexSeq(len)).join(",");
}

/** Key material for QUIC when encryption is enabled (hex). */
export function randomQuicKey(): string {
  return randomHexSeq(32);
}

/** Host part of `host:port` or full string if no port. Supports IPv6 `[addr]:port`. */
export function hostFromRealityTarget(target: string): string {
  const t = target.trim();
  if (!t) return "";
  if (t.startsWith("[")) {
    const end = t.indexOf("]");
    if (end > 1 && t.slice(end + 1).startsWith(":")) {
      return t.slice(1, end);
    }
  }
  const colon = t.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(t.slice(colon + 1))) {
    return t.slice(0, colon);
  }
  return t;
}

/** Random WebSocket path segment, e.g. `/a1b2c3d4`. */
export function randomWsPath(): string {
  return `/${randomHexSeq(8)}`;
}

/**
 * Strip any leading random hex labels (pattern `[0-9a-f]{6}.`) that a previous
 * call to suggestRandomTlsSni may have prepended, so repeated clicks replace
 * rather than accumulate: e.g. "ab12cd.ef34gh.example.com" → "example.com".
 */
function stripRandomHexLabels(host: string): string {
  return host.replace(/^([0-9a-f]{6}\.)+/i, "");
}

/**
 * Random TLS SNI-style hostname: random label + base domain from ws host, TLS SNI, or example.com.
 * Strips any previously prepended hex labels before generating the new one.
 */
export function suggestRandomTlsSni(wsHost: string, tlsServerName: string): string {
  const rawPick =
    hostFromRealityTarget(wsHost.trim()) ||
    hostFromRealityTarget(tlsServerName.trim()) ||
    "example.com";
  const base = stripRandomHexLabels(rawPick.replace(/^\.+/, ""));
  const label = randomHexSeq(6);
  return `${label}.${base}`;
}

export { randomPassword };
