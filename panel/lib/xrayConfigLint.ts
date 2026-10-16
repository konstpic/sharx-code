import { isRecord, stringList, tagsOfList } from "./xrayConfigSections";
import { describeMasqueIssue, masqueTransportMisuse, validateMasqueInbound, validateMasqueOutbound } from "./xrayMasque";
import {
  XRAY_FEATURE_MIN_VERSION,
  isXrayFeatureSupported,
  wireguardLocalDnsRemoved,
  type XrayFeatureId,
} from "./xrayVersionFeatures";
import { describeXdriveIssue, validateXdriveSettings } from "./xrayXdrive";

export type ConfigIssue = {
  section: string;
  level: "error" | "warning";
  /** i18n key suffix under pages.xray.cfg.lint.* */
  code: string;
  vars?: Record<string, string>;
};

const LOAD_BALANCING = new Set(["leastping", "leastload"]);

function matchesSelector(tag: string, selector: string[]): boolean {
  return selector.some((s) => s !== "" && tag.startsWith(s));
}

/**
 * Cross-section checks: references between routing, balancers, outbounds and observatories.
 * Panel-managed inbounds are not part of the template, so inbound tags are not validated here.
 */
export function lintXrayConfig(root: Record<string, unknown> | null, coreVersion?: string | null): ConfigIssue[] {
  if (!root) return [];
  const issues: ConfigIssue[] = [];
  const outboundTags = tagsOfList(root.outbounds);
  // Xray treats a rule whose outboundTag equals the API tag as "hand over to the API handler".
  const apiTag = isRecord(root.api) && typeof root.api.tag === "string" ? root.api.tag.trim() : "";
  const inboundTags = tagsOfList(root.inbounds);
  const has = (arr: string[], tag: string) => arr.includes(tag);

  const dupes = (tags: string[]) => [...new Set(tags.filter((t, i) => tags.indexOf(t) !== i))];
  for (const tag of dupes(outboundTags)) issues.push({ section: "outbounds", level: "error", code: "duplicateOutbound", vars: { tag } });
  for (const tag of dupes(inboundTags)) issues.push({ section: "inbounds", level: "error", code: "duplicateInbound", vars: { tag } });

  const routing = isRecord(root.routing) ? root.routing : null;
  const balancers = routing && Array.isArray(routing.balancers) ? routing.balancers.filter(isRecord) : [];
  const balancerTags = balancers.map((b) => (typeof b.tag === "string" ? b.tag : "")).filter(Boolean);

  const rules = routing && Array.isArray(routing.rules) ? routing.rules.filter(isRecord) : [];
  const reportedOutbounds = new Set<string>();
  const reportedBalancers = new Set<string>();
  for (const r of rules) {
    const ot = typeof r.outboundTag === "string" ? r.outboundTag.trim() : "";
    const bt = typeof r.balancerTag === "string" ? r.balancerTag.trim() : "";
    if (ot && ot !== apiTag && outboundTags.length > 0 && !has(outboundTags, ot) && !reportedOutbounds.has(ot)) {
      reportedOutbounds.add(ot);
      issues.push({ section: "routing", level: "error", code: "unknownOutbound", vars: { tag: ot } });
    }
    if (bt && !has(balancerTags, bt) && !reportedBalancers.has(bt)) {
      reportedBalancers.add(bt);
      issues.push({ section: "routing", level: "error", code: "unknownBalancer", vars: { tag: bt } });
    }
    if (!ot && !bt) issues.push({ section: "routing", level: "warning", code: "ruleWithoutTarget" });
  }

  const hasObservatory = isRecord(root.observatory) || isRecord(root.burstObservatory);
  for (const b of balancers) {
    const tag = typeof b.tag === "string" ? b.tag : "";
    const selector = stringList(b.selector);
    if (outboundTags.length > 0 && !outboundTags.some((t) => matchesSelector(t, selector))) {
      issues.push({ section: "routing", level: "warning", code: "balancerSelectsNothing", vars: { tag } });
    }
    const fb = typeof b.fallbackTag === "string" ? b.fallbackTag.trim() : "";
    if (fb && outboundTags.length > 0 && !has(outboundTags, fb)) {
      issues.push({ section: "routing", level: "error", code: "unknownFallback", vars: { tag, fallback: fb } });
    }
    const strategy = isRecord(b.strategy) && typeof b.strategy.type === "string" ? b.strategy.type.toLowerCase() : "";
    if (LOAD_BALANCING.has(strategy) && !hasObservatory) {
      issues.push({ section: "routing", level: "warning", code: "balancerNeedsObservatory", vars: { tag } });
    }
  }

  for (const key of ["observatory", "burstObservatory"] as const) {
    const o = root[key];
    if (!isRecord(o)) continue;
    const selector = stringList(o.subjectSelector);
    if (outboundTags.length > 0 && !outboundTags.some((t) => matchesSelector(t, selector))) {
      issues.push({ section: key, level: "warning", code: "observatorySelectsNothing" });
    }
  }
  issues.push(...lintNewXrayFeatures(root, coreVersion ?? null));
  return issues;
}

const FEATURE_LABEL: Record<XrayFeatureId, string> = {
  masque: "MASQUE",
  masqueWarpPublicKey: "MASQUE WARP publicKey",
  xdrive: "XDRIVE transport",
  noiseExp: "Noise finalmask type \"exp\"",
  xdnsNames: "XDNS names/addrs",
  luaScript: "Lua script",
};

/** Checks for options added in Xray 26.9.30 / 26.10.10 and for the WireGuard breaking change. */
function lintNewXrayFeatures(root: Record<string, unknown>, version: string | null): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const needs = (section: string, feature: XrayFeatureId, tag: string) => {
    if (isXrayFeatureSupported(version, feature) === false) {
      issues.push({
        section,
        level: "warning",
        code: "featureNeedsVersion",
        vars: { tag, feature: FEATURE_LABEL[feature], min: XRAY_FEATURE_MIN_VERSION[feature], have: version ?? "" },
      });
    }
  };

  const walk = (section: "inbounds" | "outbounds") => {
    const list = Array.isArray(root[section]) ? (root[section] as unknown[]).filter(isRecord) : [];
    for (const item of list) {
      const tag = typeof item.tag === "string" && item.tag ? item.tag : String(item.protocol ?? section);
      const stream = isRecord(item.streamSettings) ? item.streamSettings : null;

      if (item.protocol === "masque") {
        needs(section, "masque", tag);
        const found = section === "outbounds" ? validateMasqueOutbound(item) : validateMasqueInbound(item);
        for (const i of found) {
          // WARP publicKey is only mandatory from 26.10.10; older cores just ignore it.
          if (i.code === "warpPublicKeyMissing" && isXrayFeatureSupported(version, "masqueWarpPublicKey") !== true) continue;
          issues.push({ section, level: "error", code: "masqueInvalid", vars: { tag, detail: describeMasqueIssue(i) } });
        }
      } else if (masqueTransportMisuse(item)) {
        issues.push({ section, level: "error", code: "masqueTransportMisuse", vars: { tag } });
      }

      if (stream && stream.network === "xdrive") {
        needs(section, "xdrive", tag);
        for (const i of validateXdriveSettings(stream.xdriveSettings ?? {})) {
          issues.push({ section, level: "error", code: "xdriveInvalid", vars: { tag, detail: describeXdriveIssue(i) } });
        }
      }

      if (stream && isRecord(stream.finalmask)) {
        const masks = [
          ...(Array.isArray(stream.finalmask.udp) ? stream.finalmask.udp : []),
          ...(Array.isArray(stream.finalmask.tcp) ? stream.finalmask.tcp : []),
        ].filter(isRecord);
        for (const m of masks) {
          const st = isRecord(m.settings) ? m.settings : {};
          if (m.type === "noise" && Array.isArray(st.noise) && st.noise.some((n) => isRecord(n) && String(n.type).toLowerCase() === "exp")) {
            needs(section, "noiseExp", tag);
          }
          if (m.type === "xdns") {
            const domains = Array.isArray(st.domains) ? st.domains : [];
            const resolvers = Array.isArray(st.resolvers) ? st.resolvers : [];
            const newForm =
              domains.some((d) => isRecord(d) && "names" in d) || resolvers.some((r) => isRecord(r) && "addrs" in r);
            const oldForm =
              domains.some((d) => typeof d === "string" || (isRecord(d) && "name" in d)) ||
              resolvers.some((r) => typeof r === "string" || (isRecord(r) && ("addr" in r || "type" in r)));
            if (newForm) needs(section, "xdnsNames", tag);
            if (oldForm && isXrayFeatureSupported(version, "xdnsNames") === true) {
              issues.push({ section, level: "error", code: "xdnsLegacyFields", vars: { tag } });
            }
          }
        }
      }
    }
  };
  walk("inbounds");
  walk("outbounds");

  // WireGuard outbound: `remoteDNS: ["local"]` and `domainStrategy` were removed in 26.9.30.
  if (wireguardLocalDnsRemoved(version) && Array.isArray(root.outbounds)) {
    for (const ob of root.outbounds.filter(isRecord)) {
      if (ob.protocol !== "wireguard" || !isRecord(ob.settings)) continue;
      const tag = typeof ob.tag === "string" && ob.tag ? ob.tag : "wireguard";
      const dns = ob.settings.remoteDNS;
      const list = Array.isArray(dns) ? dns : typeof dns === "string" ? [dns] : [];
      if (list.some((v) => String(v).trim().toLowerCase() === "local")) {
        issues.push({ section: "outbounds", level: "error", code: "wireguardLocalDns", vars: { tag } });
      }
      if (typeof ob.settings.domainStrategy === "string" && ob.settings.domainStrategy !== "") {
        issues.push({ section: "outbounds", level: "warning", code: "wireguardDomainStrategy", vars: { tag } });
      }
    }
  }

  for (const key of ["dns", "routing"] as const) {
    const sec = root[key];
    if (isRecord(sec) && typeof sec.script === "string" && sec.script.trim() !== "") needs(key, "luaScript", key);
  }
  return issues;
}
