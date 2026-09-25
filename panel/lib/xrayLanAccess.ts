import { FREEDOM_LAN_ALLOW_IPS, freedomAllowsLan, withFreedomLanAllowed } from "./xrayOutboundForm";

/**
 * "Allow clients to reach private networks" touches two places, and both must agree:
 *  - the `direct` freedom outbound must not block private destinations (its finalRules), and
 *  - routing must send those destinations to `direct` before any rule that blackholes `geoip:private`
 *    (the panel's default template has exactly such a rule, so the outbound alone would change nothing).
 * Only the LAN ranges are opened; loopback and link-local stay blocked by the routing rule that follows.
 */
export const LAN_ROUTE_TAG = "sharx-allow-lan";

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function directFreedom(root: Rec): Rec | null {
  const outs = Array.isArray(root.outbounds) ? root.outbounds : [];
  const hit = outs.find((o) => isRec(o) && o.tag === "direct" && o.protocol === "freedom");
  return isRec(hit) ? hit : null;
}

function mentionsPrivate(rule: unknown): boolean {
  return isRec(rule) && Array.isArray(rule.ip) && rule.ip.some((v) => String(v).toLowerCase() === "geoip:private");
}

/** True when the outbound rule and the routing rule of the panel are both in place. */
export function lanAccessAllowed(root: Rec): boolean {
  const direct = directFreedom(root);
  if (!direct || !freedomAllowsLan(isRec(direct.settings) ? direct.settings : {})) return false;
  const rules = isRec(root.routing) && Array.isArray(root.routing.rules) ? root.routing.rules : [];
  return rules.some((r) => isRec(r) && r.ruleTag === LAN_ROUTE_TAG);
}

/** Whether the template has a `direct` freedom outbound to attach the rule to. */
export function lanAccessAvailable(root: Rec): boolean {
  return directFreedom(root) !== null;
}

/** Returns a copy of the template with the LAN access rules added or removed. Anything else is left alone. */
export function withLanAccess(root: Rec, on: boolean): Rec {
  const next: Rec = { ...root };
  const outs = Array.isArray(root.outbounds) ? root.outbounds : [];
  next.outbounds = outs.map((o) => {
    if (!isRec(o) || o.tag !== "direct" || o.protocol !== "freedom") return o;
    return { ...o, settings: withFreedomLanAllowed(isRec(o.settings) ? o.settings : {}, on) };
  });

  const routing: Rec = isRec(root.routing) ? { ...root.routing } : {};
  const rules = (Array.isArray(routing.rules) ? routing.rules : []).filter((r) => !(isRec(r) && r.ruleTag === LAN_ROUTE_TAG));
  if (on) {
    const rule = { type: "field", ruleTag: LAN_ROUTE_TAG, ip: [...FREEDOM_LAN_ALLOW_IPS], outboundTag: "direct" };
    let at = rules.findIndex(mentionsPrivate);
    if (at < 0) at = rules.length > 0 && isRec(rules[0]) && Array.isArray(rules[0].inboundTag) ? 1 : 0; // after the API rule
    rules.splice(at, 0, rule);
  }
  routing.rules = rules;
  next.routing = routing;
  return next;
}
