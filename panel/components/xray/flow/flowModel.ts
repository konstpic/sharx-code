import { isRec, type Rec } from "@/lib/jsonPath";
import { stringList } from "@/lib/xrayConfigSections";

export type OutKind = "direct" | "block" | "proxy" | "other" | "api";

export type FlowRule = {
  index: number;
  chips: string[];
  catchAll: boolean;
  target: { kind: "outbound" | "balancer" | "none"; tag: string };
};

export type FlowOutbound = { tag: string; protocol: string; kind: OutKind };
export type FlowBalancer = { tag: string; strategy: string; members: string[]; fallback: string };
export type FlowInbound = { tag: string; protocol: string };

export type FlowModel = {
  inbounds: FlowInbound[];
  rules: FlowRule[];
  balancers: FlowBalancer[];
  outbounds: FlowOutbound[];
  /** Outbound that receives traffic no rule claims (the first one). */
  defaultTag: string;
  apiTag: string;
};

function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v == null || v === "") return [];
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function outKind(protocol: string, tag: string, apiTag: string): OutKind {
  if (apiTag && tag === apiTag) return "api";
  if (protocol === "freedom") return "direct";
  if (protocol === "blackhole") return "block";
  if (protocol === "dns" || protocol === "loopback") return "other";
  return "proxy";
}

/** One-line condition chips for a raw routing rule. */
export function ruleChips(rule: Rec): string[] {
  const out: string[] = [];
  out.push(...listOf(rule.domain));
  out.push(...listOf(rule.ip));
  for (const p of listOf(rule.protocol)) out.push(`proto: ${p}`);
  if (rule.network) out.push(String(rule.network).toUpperCase());
  if (rule.port != null && String(rule.port).trim() !== "") out.push(`port ${String(rule.port).trim()}`);
  for (const i of listOf(rule.inboundTag)) out.push(`in: ${i}`);
  for (const s of listOf(rule.source)) out.push(`src: ${s}`);
  for (const u of listOf(rule.user)) out.push(`user: ${u}`);
  for (const k of Object.keys(rule)) {
    if (["type", "outboundTag", "balancerTag", "domain", "ip", "port", "network", "protocol", "inboundTag", "source", "user", "ruleTag", "webhook"].includes(k)) continue;
    out.push(k);
  }
  return out;
}

export function buildFlowModel(root: Rec | null): FlowModel {
  const r = root ?? {};
  const apiTag = isRec(r.api) && typeof r.api.tag === "string" ? r.api.tag.trim() : "";
  const outbounds: FlowOutbound[] = [];
  for (const o of Array.isArray(r.outbounds) ? r.outbounds : []) {
    if (!isRec(o) || typeof o.tag !== "string" || !o.tag.trim()) continue;
    const protocol = typeof o.protocol === "string" ? o.protocol : "";
    outbounds.push({ tag: o.tag.trim(), protocol, kind: outKind(protocol, o.tag.trim(), apiTag) });
  }
  const inbounds: FlowInbound[] = [];
  for (const i of Array.isArray(r.inbounds) ? r.inbounds : []) {
    if (!isRec(i) || typeof i.tag !== "string" || !i.tag.trim()) continue;
    inbounds.push({ tag: i.tag.trim(), protocol: typeof i.protocol === "string" ? i.protocol : "" });
  }

  const routing = isRec(r.routing) ? r.routing : {};
  const balancers: FlowBalancer[] = [];
  for (const b of Array.isArray(routing.balancers) ? routing.balancers : []) {
    if (!isRec(b) || typeof b.tag !== "string" || !b.tag.trim()) continue;
    const selector = stringList(b.selector);
    const strategy = isRec(b.strategy) && typeof b.strategy.type === "string" ? b.strategy.type : "random";
    balancers.push({
      tag: b.tag.trim(),
      strategy,
      members: outbounds.map((o) => o.tag).filter((t) => selector.some((s) => s && t.startsWith(s))),
      fallback: typeof b.fallbackTag === "string" ? b.fallbackTag.trim() : "",
    });
  }

  const rules: FlowRule[] = [];
  let idx = 0;
  for (const rule of Array.isArray(routing.rules) ? routing.rules : []) {
    if (!isRec(rule)) continue;
    const ot = typeof rule.outboundTag === "string" ? rule.outboundTag.trim() : "";
    const bt = typeof rule.balancerTag === "string" ? rule.balancerTag.trim() : "";
    const chips = ruleChips(rule);
    rules.push({
      index: idx++,
      chips,
      catchAll: chips.length === 0,
      target: ot ? { kind: "outbound", tag: ot } : bt ? { kind: "balancer", tag: bt } : { kind: "none", tag: "" },
    });
  }

  return { inbounds, rules, balancers, outbounds, defaultTag: outbounds[0]?.tag ?? "", apiTag };
}
