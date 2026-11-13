import {
  buildSniffingFromForm,
  buildStreamSettingsFromForm,
  parseFirstClientFromSettings,
  parseSniffingToForm,
  parseStreamSettingsToForm,
  type InboundFormProtocol,
} from "@/lib/inboundDefaults";

export type InboundJsonRoundTripResult =
  | { ok: true; json: string; strippedKeys: string[] }
  | { ok: false; message: string };

function collectKeyPaths(value: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (value === null || typeof value !== "object") {
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      for (const p of collectKeyPaths(item, `${prefix}[${i}]`)) {
        out.add(p);
      }
    });
    return out;
  }
  const obj = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    for (const p of collectKeyPaths(v, path)) {
      out.add(p);
    }
  }
  return out;
}

function diffStrippedPaths(before: unknown, after: unknown): string[] {
  const a = collectKeyPaths(before);
  const b = collectKeyPaths(after);
  const stripped: string[] = [];
  for (const p of a) {
    if (!b.has(p)) stripped.push(p);
  }
  stripped.sort();
  return stripped;
}

function parseJsonObject(json: string, label: string): InboundJsonRoundTripResult & { value?: Record<string, unknown> } {
  const trimmed = json.trim();
  if (!trimmed) {
    return { ok: false, message: `${label}: empty JSON` };
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: `${label}: invalid JSON` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: `${label}: must be a JSON object` };
  }
  return { ok: true, json: trimmed, strippedKeys: [], value: value as Record<string, unknown> };
}

/** Drop unknown stream/sniffing fields by parsing into the form model and rebuilding. */
export function roundTripInboundStreamSettings(
  json: string,
  protocol: InboundFormProtocol,
): InboundJsonRoundTripResult {
  if (protocol === "wireguard" || protocol === "telemt") {
    return { ok: true, json: "{}", strippedKeys: [] };
  }
  const parsed = parseJsonObject(json, "streamSettings");
  if (!parsed.ok || !parsed.value) {
    return parsed;
  }
  const before = parsed.value;
  const form = parseStreamSettingsToForm(JSON.stringify(before), protocol);
  const rebuilt = buildStreamSettingsFromForm(form, protocol);
  let after: Record<string, unknown>;
  try {
    after = JSON.parse(rebuilt) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "streamSettings: rebuild failed" };
  }
  // finalmask (with quicParams) is structural form state now, but keep a
  // verbatim safety net: a future form-model gap must never silently drop it.
  if (before.finalmask !== undefined && after.finalmask === undefined) {
    after.finalmask = before.finalmask;
  }
  return {
    ok: true,
    json: JSON.stringify(after),
    strippedKeys: diffStrippedPaths(before, after),
  };
}

export function roundTripInboundSniffing(json: string): InboundJsonRoundTripResult {
  const parsed = parseJsonObject(json, "sniffing");
  if (!parsed.ok || !parsed.value) {
    return parsed;
  }
  const before = parsed.value;
  const form = parseSniffingToForm(JSON.stringify(before));
  const rebuilt = buildSniffingFromForm(form);
  let after: Record<string, unknown>;
  try {
    after = JSON.parse(rebuilt) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "sniffing: rebuild failed" };
  }
  return {
    ok: true,
    json: rebuilt,
    strippedKeys: diffStrippedPaths(before, after),
  };
}

const SERVER_SETTINGS_KEYS: Partial<Record<InboundFormProtocol, readonly string[]>> = {
  vless: ["encryption", "decryption", "fallbacks"],
  vmess: ["disableInsecureEncryption"],
  trojan: ["fallbacks"],
  shadowsocks: ["method", "password", "network", "ivCheck"],
  hysteria: ["version"],
  hysteria2: ["version"],
};

export function inboundSettingsJsonEditorSupported(protocol: InboundFormProtocol): boolean {
  return Boolean(SERVER_SETTINGS_KEYS[protocol]);
}

/** Server-only settings slice (no `clients` / panel-managed accounts). */
export function extractInboundServerSettingsJson(
  settingsStr: string,
  protocol: InboundFormProtocol,
): string {
  const allowed = SERVER_SETTINGS_KEYS[protocol];
  if (!allowed) {
    return "{}";
  }
  let root: Record<string, unknown> = {};
  try {
    root = JSON.parse(settingsStr) as Record<string, unknown>;
  } catch {
    root = {};
  }
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in root) {
      out[key] = root[key];
    }
  }
  return JSON.stringify(out, null, 2);
}

export function mergeInboundServerSettingsJson(
  baselineSettings: string,
  editedServerJson: string,
  protocol: InboundFormProtocol,
): InboundJsonRoundTripResult {
  const allowed = SERVER_SETTINGS_KEYS[protocol];
  if (!allowed) {
    return { ok: true, json: baselineSettings, strippedKeys: [] };
  }
  const parsed = parseJsonObject(editedServerJson, "settings");
  if (!parsed.ok || !parsed.value) {
    return parsed;
  }
  const before = parsed.value;
  let baseline: Record<string, unknown> = {};
  try {
    baseline = JSON.parse(baselineSettings) as Record<string, unknown>;
  } catch {
    baseline = {};
  }
  const merged: Record<string, unknown> = { ...baseline };
  const picked: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in before) {
      picked[key] = before[key];
      merged[key] = before[key];
    }
  }
  // Re-apply known client-related fields from baseline only (never from JSON editor).
  if (Array.isArray(baseline.clients)) {
    merged.clients = baseline.clients;
  }
  if (protocol === "mixed") {
    if (typeof baseline.auth === "string") merged.auth = baseline.auth;
    if (typeof baseline.udp === "boolean") merged.udp = baseline.udp;
    if (Array.isArray(baseline.accounts)) merged.accounts = baseline.accounts;
  }
  if (protocol === "shadowsocks" && !Array.isArray(merged.clients)) {
    merged.clients = [];
  }
  const rebuilt = JSON.stringify(merged);
  let afterPick: Record<string, unknown>;
  try {
    afterPick = JSON.parse(JSON.stringify(picked)) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "settings: merge failed" };
  }
  return {
    ok: true,
    json: rebuilt,
    strippedKeys: diffStrippedPaths(before, afterPick),
  };
}

/** Parse server settings JSON into form patch fields (flow, fallbacks, SS method, …). */
export function serverSettingsJsonToFormPatch(
  serverJson: string,
  protocol: InboundFormProtocol,
): ReturnType<typeof parseFirstClientFromSettings> {
  let server: Record<string, unknown> = {};
  try {
    server = JSON.parse(serverJson || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
  const wrapped =
    protocol === "vless"
      ? JSON.stringify({ ...server, clients: [{ flow: "" }] })
      : protocol === "trojan"
        ? JSON.stringify({ ...server, clients: [{ password: "" }] })
        : JSON.stringify(server);
  try {
    return parseFirstClientFromSettings(wrapped, protocol);
  } catch {
    return {};
  }
}

const WIREGUARD_PANEL_SETTINGS_KEYS = [
  "mtu",
  "secretKey",
  "address",
  "clientDns",
  "noKernelTun",
  "workers",
] as const;

function parseListenFromCore(raw: unknown): string {
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
    return raw[0].trim();
  }
  if (typeof raw === "string" && raw.startsWith('"')) {
    try {
      const v = JSON.parse(raw);
      if (typeof v === "string") {
        return v.trim();
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

function coreProtocolMatchesForm(
  coreProtocol: string,
  formProtocol: InboundFormProtocol,
): boolean {
  const p = coreProtocol.trim().toLowerCase();
  if (formProtocol === "hysteria2") {
    return p === "hysteria" || p === "hysteria2";
  }
  return p === formProtocol;
}

function rawJsonField(value: unknown, label: string): InboundJsonRoundTripResult & { text?: string } {
  if (value === undefined || value === null) {
    return { ok: false, message: `${label}: missing` };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: false, message: `${label}: empty` };
    }
    return { ok: true, json: trimmed, strippedKeys: [], text: trimmed };
  }
  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value);
      return { ok: true, json: text, strippedKeys: [], text };
    } catch {
      return { ok: false, message: `${label}: cannot serialize` };
    }
  }
  return { ok: false, message: `${label}: must be a JSON object or string` };
}

function injectAcceptProxyIntoStream(streamJson: string, acceptProxy: boolean): string {
  if (!acceptProxy) {
    return streamJson;
  }
  try {
    const o = JSON.parse(streamJson) as Record<string, unknown>;
    o.acceptProxyProtocol = true;
    return JSON.stringify(o);
  } catch {
    return streamJson;
  }
}

/** Merge server fields with validation; keep clients/peers/accounts from the edited core settings. */
export function mergeInboundSettingsPreservingEditedClients(
  baselineSettings: string,
  editedSettingsStr: string,
  protocol: InboundFormProtocol,
): InboundJsonRoundTripResult {
  const parsed = parseJsonObject(editedSettingsStr, "settings");
  if (!parsed.ok || !parsed.value) {
    return parsed;
  }
  const edited = parsed.value;
  const serverOnly = extractInboundServerSettingsJson(editedSettingsStr, protocol);
  const merged = mergeInboundServerSettingsJson(baselineSettings, serverOnly, protocol);
  if (!merged.ok) {
    return merged;
  }
  let baseline: Record<string, unknown> = {};
  try {
    baseline = JSON.parse(baselineSettings || "{}") as Record<string, unknown>;
  } catch {
    baseline = {};
  }
  const final: Record<string, unknown> = JSON.parse(merged.json) as Record<string, unknown>;

  if (Array.isArray(edited.clients)) {
    final.clients = edited.clients;
  } else if (Array.isArray(baseline.clients)) {
    final.clients = baseline.clients;
  }
  if (Array.isArray(edited.peers)) {
    final.peers = edited.peers;
  } else if (Array.isArray(baseline.peers)) {
    final.peers = baseline.peers;
  }
  if (protocol === "mixed") {
    if (typeof edited.auth === "string") {
      final.auth = edited.auth;
    }
    if (typeof edited.udp === "boolean") {
      final.udp = edited.udp;
    }
    if (Array.isArray(edited.accounts)) {
      final.accounts = edited.accounts;
    }
  }
  if (protocol === "shadowsocks" && !Array.isArray(final.clients)) {
    final.clients = [];
  }
  if (protocol === "wireguard") {
    for (const key of WIREGUARD_PANEL_SETTINGS_KEYS) {
      if (key in edited) {
        final[key] = edited[key];
      } else if (key in baseline) {
        final[key] = baseline[key];
      }
    }
  }

  return {
    ok: true,
    json: JSON.stringify(final),
    strippedKeys: merged.strippedKeys,
  };
}

export type InboundCoreConfigApplyPatch = {
  listen: string;
  port: number;
  tag: string;
  streamSettingsStr: string;
  sniffingStr: string;
  settingsStr: string;
  formPatch: ReturnType<typeof serverSettingsJsonToFormPatch>;
  strippedKeys: string[];
};

/** Validate and sanitize a full Xray inbound object from the core preview editor. */
export function roundTripInboundCoreConfig(
  json: string,
  formProtocol: InboundFormProtocol,
  baselineSettings: string,
): { ok: true; patch: InboundCoreConfigApplyPatch } | { ok: false; message: string } {
  const rootParsed = parseJsonObject(json, "inbound");
  if (!rootParsed.ok || !rootParsed.value) {
    return { ok: false, message: rootParsed.ok ? "inbound: invalid" : rootParsed.message };
  }
  const root = rootParsed.value;
  const stripped: string[] = [];

  const protoRaw = root.protocol;
  if (typeof protoRaw !== "string" || !coreProtocolMatchesForm(protoRaw, formProtocol)) {
    return {
      ok: false,
      message: `protocol must match the form (${formProtocol})`,
    };
  }

  const portRaw = root.port;
  const port =
    typeof portRaw === "number"
      ? portRaw
      : typeof portRaw === "string"
        ? parseInt(portRaw, 10)
        : NaN;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return { ok: false, message: "port: must be 1–65535" };
  }

  const tag = typeof root.tag === "string" ? root.tag.trim() : "";
  if (!tag) {
    return { ok: false, message: "tag: required" };
  }

  const streamField = rawJsonField(root.streamSettings, "streamSettings");
  if (!streamField.ok || !streamField.text) {
    return { ok: false, message: streamField.ok ? "streamSettings: invalid" : streamField.message };
  }
  let streamText = streamField.text;
  if (root.acceptProxyProtocol === true) {
    streamText = injectAcceptProxyIntoStream(streamText, true);
  }
  const streamRt = roundTripInboundStreamSettings(streamText, formProtocol);
  if (!streamRt.ok) {
    return { ok: false, message: streamRt.message };
  }
  stripped.push(...streamRt.strippedKeys);

  const sniffField = rawJsonField(root.sniffing, "sniffing");
  if (!sniffField.ok || !sniffField.text) {
    return { ok: false, message: sniffField.ok ? "sniffing: invalid" : sniffField.message };
  }
  const sniffRt = roundTripInboundSniffing(sniffField.text);
  if (!sniffRt.ok) {
    return { ok: false, message: sniffRt.message };
  }
  stripped.push(...sniffRt.strippedKeys);

  const settingsField = rawJsonField(root.settings, "settings");
  if (!settingsField.ok || !settingsField.text) {
    return { ok: false, message: settingsField.ok ? "settings: invalid" : settingsField.message };
  }
  const settingsRt = mergeInboundSettingsPreservingEditedClients(
    baselineSettings,
    settingsField.text,
    formProtocol,
  );
  if (!settingsRt.ok) {
    return { ok: false, message: settingsRt.message };
  }
  stripped.push(...settingsRt.strippedKeys);

  const formPatch = serverSettingsJsonToFormPatch(
    extractInboundServerSettingsJson(settingsRt.json, formProtocol),
    formProtocol,
  );

  return {
    ok: true,
    patch: {
      listen: parseListenFromCore(root.listen),
      port,
      tag,
      streamSettingsStr: streamRt.json,
      sniffingStr: sniffRt.json,
      settingsStr: settingsRt.json,
      formPatch,
      strippedKeys: stripped,
    },
  };
}
