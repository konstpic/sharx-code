/**
 * VLESS Encryption (post-quantum) string helpers.
 * Format: https://github.com/XTLS/Xray-core/pull/5067 and `xray vlessenc` output.
 *
 *   decryption (server): mlkem768x25519plus.<native|xorpub|random>.<600s|300-600s|0s>.[padding...].<key>...
 *   encryption (client): mlkem768x25519plus.<native|xorpub|random>.<0rtt|1rtt>.[padding...].<key>...
 *
 * Padding segments are "probability-from-to" (e.g. 100-111-1111), alternating len, gap, len, ...
 * Keys are base64url (X25519 private key / password, ML-KEM-768 seed / client).
 */

export const VLESS_ENC_PREFIX = "mlkem768x25519plus";
export type VlessEncMode = "native" | "xorpub" | "random";
export const VLESS_ENC_MODES: VlessEncMode[] = ["native", "xorpub", "random"];
export type VlessEncSide = "server" | "client";

export type VlessEncAuth = { label: string; decryption: string; encryption: string };

export type VlessEncParts = {
  mode: VlessEncMode;
  /** server: "600s" | "300-600s" | "0s"; client: "0rtt" | "1rtt". */
  ticket: string;
  /** Dot-joined padding segments, "" when default. */
  padding: string;
  keys: string[];
};

const PADDING_RE = /^\d+-\d+-\d+$/;
const KEY_RE = /^[A-Za-z0-9_-]{20,}$/;

/** Decoded size of a base64url (unpadded) string, or -1 when malformed. */
function b64urlBytes(s: string): number {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return -1;
  return Math.floor((s.length * 3) / 4);
}
const SERVER_TICKET_RE = /^\d+(-\d+)?s$/;

export function isVlessEncNone(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  return s === "" || s === "none";
}

/** Splits a value into parts; null for "none" or when the structure is unreadable. */
export function parseVlessEnc(v: string, side: VlessEncSide): VlessEncParts | null {
  const s = v.trim();
  if (isVlessEncNone(s)) return null;
  const p = s.split(".");
  if (p.length < 4 || p[0] !== VLESS_ENC_PREFIX) return null;
  if (!VLESS_ENC_MODES.includes(p[1] as VlessEncMode)) return null;
  void side;
  let i = 3;
  const padding: string[] = [];
  // xray treats every segment shorter than 20 chars as padding, the rest as keys.
  while (i < p.length && p[i].length < 20) padding.push(p[i++]);
  return { mode: p[1] as VlessEncMode, ticket: p[2], padding: padding.join("."), keys: p.slice(i) };
}

/** Returns an error code or null when valid ("none"/empty is valid). */
export function validateVlessEnc(v: string, side: VlessEncSide): string | null {
  const s = v.trim();
  if (isVlessEncNone(s)) return null;
  const p = s.split(".");
  if (p.length < 4) return "format";
  if (p[0] !== VLESS_ENC_PREFIX) return "prefix";
  if (!VLESS_ENC_MODES.includes(p[1] as VlessEncMode)) return "mode";
  if (side === "server") {
    if (!SERVER_TICKET_RE.test(p[2])) return "ticket";
  } else if (p[2] !== "0rtt" && p[2] !== "1rtt") return "ticket";
  const parts = parseVlessEnc(s, side);
  if (!parts) return "format";
  if (validateVlessEncPadding(parts.padding)) return "padding";
  if (parts.keys.length === 0) return "key";
  // server: X25519 private key (32 B) or ML-KEM-768 seed (64 B); client: X25519 password (32 B) or ML-KEM-768 client (1184 B)
  const sizes = side === "server" ? [32, 64] : [32, 1184];
  if (!parts.keys.every((k) => KEY_RE.test(k) && sizes.includes(b64urlBytes(k)))) return "key";
  return null;
}

/**
 * Validates the optional padding field alone: "" or dot-joined "probability-from-to" segments
 * (len, gap, len, ... alternating). Per xray: first segment needs probability >= 100 and from/to >= 35.
 */
export function validateVlessEncPadding(padding: string): string | null {
  const s = padding.trim();
  if (s === "") return null;
  const segs = s.split(".");
  if (!segs.every((x) => PADDING_RE.test(x))) return "padding";
  const [pr, from, to] = segs[0].split("-").map(Number);
  if (pr < 100 || from < 35 || to < 35 || from > to) return "padding";
  return null;
}

export function composeVlessEnc(parts: VlessEncParts): string {
  const head = [VLESS_ENC_PREFIX, parts.mode, parts.ticket];
  const pad = parts.padding.trim() ? [parts.padding.trim()] : [];
  return [...head, ...pad, ...parts.keys].join(".");
}

/** Changes mode/ticket/padding of an existing value, keeping its keys. Returns v unchanged if unparsable. */
export function patchVlessEnc(
  v: string,
  side: VlessEncSide,
  patch: Partial<Pick<VlessEncParts, "mode" | "ticket" | "padding">>,
): string {
  const parts = parseVlessEnc(v, side);
  if (!parts) return v;
  return composeVlessEnc({ ...parts, ...patch });
}

export type VlessEncKeyKind = "x25519" | "mlkem-seed" | "mlkem-client" | "unknown";

export function vlessEncKeyKind(key: string): VlessEncKeyKind {
  if (key.length === 43) return "x25519";
  if (key.length === 86) return "mlkem-seed";
  if (key.length > 1000) return "mlkem-client";
  return "unknown";
}

/** Which authentication the value uses, from its (last) key. */
export function detectVlessEncAuth(v: string, side: VlessEncSide): "none" | "x25519" | "mlkem768" | "invalid" {
  if (isVlessEncNone(v)) return "none";
  const parts = parseVlessEnc(v, side);
  if (!parts || parts.keys.length === 0) return "invalid";
  const k = vlessEncKeyKind(parts.keys[parts.keys.length - 1]);
  if (k === "x25519") return "x25519";
  if (k === "mlkem-seed" || k === "mlkem-client") return "mlkem768";
  return "invalid";
}

/** Problems between a server decryption and a client encryption value (codes). */
export function vlessEncPairProblems(decryption: string, encryption: string): string[] {
  const out: string[] = [];
  const dNone = isVlessEncNone(decryption);
  const eNone = isVlessEncNone(encryption);
  if (dNone && eNone) return out;
  if (!dNone && eNone) out.push("clientMissing");
  if (dNone && !eNone) out.push("serverMissing");
  const d = parseVlessEnc(decryption, "server");
  const e = parseVlessEnc(encryption, "client");
  if (d && e && d.mode !== e.mode) out.push("modeMismatch");
  return out;
}

/** Normalizes the `auths` payload of getNewVlessEnc. */
export function normalizeVlessEncAuths(obj: unknown): VlessEncAuth[] {
  const raw = (obj as { auths?: unknown } | null)?.auths;
  if (!Array.isArray(raw)) return [];
  const out: VlessEncAuth[] = [];
  for (const a of raw) {
    const r = a as Record<string, unknown>;
    if (typeof r?.decryption === "string" && typeof r?.encryption === "string") {
      out.push({
        label: typeof r.label === "string" ? r.label : "",
        decryption: r.decryption,
        encryption: r.encryption,
      });
    }
  }
  return out;
}
