/**
 * MASQUE (IETF CONNECT-IP, RFC 9484) for Xray >= 26.9.30.
 * JSON shapes follow infra/conf/masque.go and transport_method.go (MasqueConfig) at tag v26.10.10:
 *  - outbound `settings`: { address, port, remoteDNS? }
 *  - inbound `settings`: { users|clients: [{ email, pass, level? }], address: [prefix], mtu? }
 *  - `streamSettings.network = "masque"` + `masqueSettings` { host, path, user, pass, headers, warp }
 *  - the masque transport may only be used together with the masque protocol (and vice versa the protocol needs it).
 */

export const MASQUE_DEFAULT_PATH = "/.well-known/masque/ip/*/*/";

export type MasqueIssue = { code: MasqueIssueCode; detail?: string };
export type MasqueIssueCode =
  | "addressMissing"
  | "portMissing"
  | "remoteDnsInvalid"
  | "warpWithUserPass"
  | "warpKeyMissing"
  | "warpPublicKeyMissing"
  | "warpAddressMissing"
  | "pathInvalid"
  | "hostInvalid"
  | "headerForbidden"
  | "muxUnsupported"
  | "userEmailMissing"
  | "userPassMissing"
  | "userEmailDuplicate"
  | "userEmailInvalid"
  | "serverAddressMissing"
  | "serverAddressInvalid"
  | "mtuRange"
  | "transportMismatch";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function defaultMasqueOutbound(tag = "masque-out"): Rec {
  return {
    tag,
    protocol: "masque",
    settings: { address: "", port: 443 },
    streamSettings: { network: "masque", security: "tls", masqueSettings: { path: MASQUE_DEFAULT_PATH } },
  };
}

export function defaultMasqueInbound(tag = "masque-in", port = 443): Rec {
  return {
    tag,
    port,
    protocol: "masque",
    settings: { users: [{ email: "user@masque", pass: "" }], address: ["10.77.0.1/24"], mtu: 1280 },
    streamSettings: { network: "masque", security: "tls", masqueSettings: { path: MASQUE_DEFAULT_PATH } },
  };
}

/** Cloudflare WARP profile for the masque outbound (host / path default to Cloudflare's endpoint). */
export function defaultMasqueWarp(): Rec {
  return { privateKey: "", publicKey: "", address: ["172.16.0.2/32"] };
}

/** Same checks as Go IPv4/IPv6 prefix parsing in MasqueServerConfig, just enough to catch typos. */
export function isIpPrefix(s: string): boolean {
  const m = /^(.+)\/(\d{1,3})$/.exec(s.trim());
  if (!m) return false;
  const bits = Number(m[2]);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(m[1])) {
    return bits <= 32 && m[1].split(".").every((o) => Number(o) <= 255);
  }
  return m[1].includes(":") && /^[0-9a-fA-F:.]+$/.test(m[1]) && bits <= 128;
}

export function isIpAddr(s: string): boolean {
  const v = s.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v.split(".").every((o) => Number(o) <= 255);
  return v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v);
}

/** Check `masqueSettings` (transport part). `hasUserPass` mirrors the Go rule that warp excludes user/pass. */
export function validateMasqueTransport(ms: unknown): MasqueIssue[] {
  const out: MasqueIssue[] = [];
  if (!isRec(ms)) return out;
  const warp = isRec(ms.warp) ? ms.warp : null;
  if (warp) {
    if (str(ms.user) || str(ms.pass)) out.push({ code: "warpWithUserPass" });
    if (!str(warp.privateKey)) out.push({ code: "warpKeyMissing" });
    if (!str(warp.publicKey)) out.push({ code: "warpPublicKeyMissing" });
    const addr = Array.isArray(warp.address) ? warp.address.map(str).filter(Boolean) : [];
    if (addr.length === 0) out.push({ code: "warpAddressMissing" });
  }
  const path = str(ms.path);
  if (path && (!path.startsWith("/") || /[{}]/.test(path.replace(/\{(target|ipproto|\?target,ipproto|\?ipproto,target|&target,ipproto|&ipproto,target)\}/g, "")))) {
    out.push({ code: "pathInvalid", detail: path });
  }
  const host = str(ms.host);
  if (host && /[\s/@?#]/.test(host)) out.push({ code: "hostInvalid", detail: host });
  if (isRec(ms.headers)) {
    for (const k of Object.keys(ms.headers)) {
      const lk = k.toLowerCase();
      if (lk === "host" || lk === "capsule-protocol" || (lk === "authorization" && (str(ms.user) || str(ms.pass)))) {
        out.push({ code: "headerForbidden", detail: k });
      }
    }
  }
  return out;
}

export function validateMasqueOutbound(ob: unknown): MasqueIssue[] {
  if (!isRec(ob)) return [];
  const out: MasqueIssue[] = [];
  const st = isRec(ob.settings) ? ob.settings : {};
  if (!str(st.address)) out.push({ code: "addressMissing" });
  const port = Number(st.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) out.push({ code: "portMissing" });
  if (Array.isArray(st.remoteDNS)) {
    for (const s of st.remoteDNS) if (!isIpAddr(str(s))) out.push({ code: "remoteDnsInvalid", detail: String(s) });
  }
  const stream = isRec(ob.streamSettings) ? ob.streamSettings : null;
  if (!stream || stream.network !== "masque") out.push({ code: "transportMismatch" });
  out.push(...validateMasqueTransport(stream?.masqueSettings));
  if (isRec(ob.mux) && ob.mux.enabled === true) out.push({ code: "muxUnsupported" });
  return out;
}

export function validateMasqueInbound(ib: unknown): MasqueIssue[] {
  if (!isRec(ib)) return [];
  const out: MasqueIssue[] = [];
  const st = isRec(ib.settings) ? ib.settings : {};
  const users = Array.isArray(st.clients) ? st.clients : Array.isArray(st.users) ? st.users : [];
  const seen = new Set<string>();
  for (const u of users) {
    if (!isRec(u)) continue;
    const email = str(u.email);
    if (!email) out.push({ code: "userEmailMissing" });
    else if (email.includes(":")) out.push({ code: "userEmailInvalid", detail: email });
    else if (seen.has(email.toLowerCase())) out.push({ code: "userEmailDuplicate", detail: email });
    else seen.add(email.toLowerCase());
    if (!str(u.pass)) out.push({ code: "userPassMissing", detail: email });
  }
  const addrs = Array.isArray(st.address) ? st.address.map(str).filter(Boolean) : [];
  if (addrs.length === 0) out.push({ code: "serverAddressMissing" });
  let v4 = 0;
  let v6 = 0;
  for (const a of addrs) {
    if (!isIpPrefix(a)) out.push({ code: "serverAddressInvalid", detail: a });
    else if (a.includes(":")) v6 += 1;
    else v4 += 1;
  }
  if (v4 > 1 || v6 > 1) out.push({ code: "serverAddressInvalid", detail: "at most one IPv4 and one IPv6 prefix" });
  const mtu = Number(st.mtu ?? 0);
  if (st.mtu !== undefined && mtu !== 0 && (!Number.isInteger(mtu) || mtu < 1280 || mtu > 65535)) out.push({ code: "mtuRange" });
  const stream = isRec(ib.streamSettings) ? ib.streamSettings : null;
  if (stream && stream.network === "masque") out.push(...validateMasqueTransport(stream.masqueSettings));
  return out;
}

/** Network "masque" is valid only for the masque protocol (xray.go: "the masque transport can only be used by..."). */
export function masqueTransportMisuse(obOrIb: unknown): boolean {
  if (!isRec(obOrIb)) return false;
  const stream = isRec(obOrIb.streamSettings) ? obOrIb.streamSettings : null;
  return !!stream && stream.network === "masque" && obOrIb.protocol !== "masque";
}

/** Short English descriptions (they mirror the Xray-core error messages); shown as the `detail` of a lint issue. */
export function describeMasqueIssue(i: MasqueIssue): string {
  const d = i.detail ? ` (${i.detail})` : "";
  switch (i.code) {
    case "addressMissing":
      return '"address" is not set';
    case "portMissing":
      return '"port" must be 1-65535';
    case "remoteDnsInvalid":
      return `"remoteDNS" must contain IP addresses${d}`;
    case "warpWithUserPass":
      return '"user"/"pass" can not be used with "warp"';
    case "warpKeyMissing":
      return '"warp.privateKey" is not set';
    case "warpPublicKeyMissing":
      return '"warp.publicKey" is not set (required by Xray 26.10.10+)';
    case "warpAddressMissing":
      return '"warp.address" is not set';
    case "pathInvalid":
      return `invalid "path"${d}: it must start with "/", only {target} and {ipproto} variables are supported`;
    case "hostInvalid":
      return `invalid "host"${d}`;
    case "headerForbidden":
      return `"headers" can not contain "${i.detail ?? ""}"`;
    case "muxUnsupported":
      return 'the masque outbound does not support "mux"';
    case "userEmailMissing":
      return 'a user has an empty "email"';
    case "userPassMissing":
      return `user${d} has an empty "pass"`;
    case "userEmailDuplicate":
      return `duplicate "email"${d}`;
    case "userEmailInvalid":
      return `invalid "email"${d}: ":" is not allowed`;
    case "serverAddressMissing":
      return '"address" (tunnel prefix, e.g. 10.77.0.1/24) is not set';
    case "serverAddressInvalid":
      return `invalid "address"${d}`;
    case "mtuRange":
      return '"mtu" must be between 1280 and 65535';
    case "transportMismatch":
      return 'the masque outbound needs streamSettings.network "masque"';
  }
}
