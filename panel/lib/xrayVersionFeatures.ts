/**
 * Which Xray-core release introduced (or broke) which feature.
 * Pure helpers: the running core version is passed in by the caller (see useXrayCoreVersion).
 * Source: XTLS/Xray-core compare v26.9.9...v26.10.10 (commit list, release notes are empty).
 */

export type XrayFeatureId =
  /** MASQUE inbound / outbound / transport (CONNECT-IP, RFC 9484). */
  | "masque"
  /** `warp.publicKey` is mandatory for the MASQUE WARP profile. */
  | "masqueWarpPublicKey"
  /** XDRIVE transport (remote-storage based; Google Drive and "template" backends). */
  | "xdrive"
  /** Noise finalmask item `type: "exp"`. */
  | "noiseExp"
  /** XDNS finalmask `domains[].names` and `resolvers[].addrs`. */
  | "xdnsNames"
  /** Lua `script` for `dns` and `routing`. */
  | "luaScript";

export const XRAY_FEATURE_MIN_VERSION: Record<XrayFeatureId, string> = {
  masque: "26.9.30",
  masqueWarpPublicKey: "26.10.10",
  xdrive: "26.9.30",
  noiseExp: "26.9.30",
  xdnsNames: "26.10.10",
  luaScript: "26.10.10",
};

/** WireGuard outbound: `remoteDNS: ["local"]` and `domainStrategy` were removed in this release. */
export const XRAY_WIREGUARD_LOCAL_DNS_REMOVED_IN = "26.9.30";

/** Numeric parts of a version ("v26.10.10", "Xray 26.10.10 (go1.26)", "26.10.10-rc1" -> [26,10,10]); null if none. */
export function parseXrayVersion(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 / 0 / 1, or null when either side is not a version. */
export function compareXrayVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseXrayVersion(a);
  const pb = parseXrayVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** true / false, or null when the running version is unknown (callers must not block on null). */
export function xrayVersionAtLeast(version: string | null | undefined, min: string): boolean | null {
  const c = compareXrayVersions(version, min);
  return c === null ? null : c >= 0;
}

export function isXrayFeatureSupported(version: string | null | undefined, feature: XrayFeatureId): boolean | null {
  return xrayVersionAtLeast(version, XRAY_FEATURE_MIN_VERSION[feature]);
}

export function xrayFeatureMinVersion(feature: XrayFeatureId): string {
  return XRAY_FEATURE_MIN_VERSION[feature];
}

/** True only when the version is known and older than the feature's minimum (show a warning / mark the option). */
export function xrayFeatureUnsupported(version: string | null | undefined, feature: XrayFeatureId): boolean {
  return isXrayFeatureSupported(version, feature) === false;
}

/** True when the core already dropped WireGuard `remoteDNS: "local"` and `domainStrategy`. */
export function wireguardLocalDnsRemoved(version: string | null | undefined): boolean {
  return xrayVersionAtLeast(version, XRAY_WIREGUARD_LOCAL_DNS_REMOVED_IN) === true;
}
