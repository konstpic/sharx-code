import { isRecord, stringList, tagsOfList } from "./xrayConfigSections";

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
export function lintXrayConfig(root: Record<string, unknown> | null): ConfigIssue[] {
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
  return issues;
}
