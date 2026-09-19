"use client";

import type { TFunction } from "i18next";
import { Ban, Globe, Play, Radio, Route, Scale, Send, ShieldCheck, Users, Waypoints, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui";
import { Field, FieldGrid, SelectField, TextField, ToggleChip, makeTr } from "@/components/xray/configurator/fields";
import type { RoutingTagContext } from "@/components/xray/routing/useRoutingTags";
import type { Rec } from "@/lib/jsonPath";
import { autoAssumedTags, collectGeoTags, simulateRouting, type SimRequest, type SimResult } from "@/lib/xrayRouteSim";
import { buildFlowModel, type OutKind } from "./flowModel";

type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

const TONE: Record<OutKind | "balancer" | "missing" | "source", string> = {
  direct: "#34d399",
  block: "#fb7185",
  proxy: "#818cf8",
  other: "#fbbf24",
  api: "#38bdf8",
  balancer: "#c084fc",
  missing: "#f59e0b",
  source: "#94a3b8",
};

const KIND_ICON: Record<OutKind | "balancer" | "missing", LucideIcon> = {
  direct: Globe,
  block: Ban,
  proxy: ShieldCheck,
  other: Radio,
  api: Waypoints,
  balancer: Scale,
  missing: Radio,
};

const L = (r: Rect): Pt => ({ x: r.x, y: r.y + r.h / 2 });
const R = (r: Rect): Pt => ({ x: r.x + r.w, y: r.y + r.h / 2 });
const C = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const T = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y });
const B = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h });

function bez(a: Pt, b: Pt): string {
  const dx = Math.max(36, Math.abs(b.x - a.x) * 0.5);
  return `C ${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
}
const curve = (a: Pt, b: Pt) => `M ${a.x} ${a.y} ${bez(a, b)}`;
/** Loop that leaves the right side of two nodes in the same column. */
const bracket = (a: Pt, b: Pt) => `M ${a.x} ${a.y} C ${a.x + 54} ${a.y} ${b.x + 54} ${b.y} ${b.x} ${b.y}`;

type Geometry = { rects: Record<string, Rect>; w: number; h: number };

function useGeometry(ref: RefObject<HTMLDivElement | null>, key: string): Geometry {
  const [geo, setGeo] = useState<Geometry>({ rects: {}, w: 0, h: 0 });
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const measure = () => {
      const cr = c.getBoundingClientRect();
      const rects: Record<string, Rect> = {};
      c.querySelectorAll<HTMLElement>("[data-flow-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        rects[el.dataset.flowId!] = { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
      });
      setGeo((prev) => {
        const same = prev.w === cr.width && prev.h === cr.height && JSON.stringify(prev.rects) === JSON.stringify(rects);
        return same ? prev : { rects, w: cr.width, h: cr.height };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, [ref, key]);
  return geo;
}

type Marks = Record<number, { ok: boolean; text: string }>;

type Sim = {
  phase: "idle" | "running" | "done";
  d: string;
  total: number;
  pos: number;
  head: Pt | null;
  marks: Marks;
  arrivedId: string | null;
  result: SimResult | null;
  target: string;
};

const IDLE_SIM: Sim = { phase: "idle", d: "", total: 0, pos: 0, head: null, marks: {}, arrivedId: null, result: null, target: "" };

type Props = {
  root: Rec | null;
  tags: RoutingTagContext;
  t: TFunction;
};

export function TrafficFlow({ root, tags, t }: Props) {
  const tr = useMemo(() => makeTr(t), [t]);
  const model = useMemo(() => buildFlowModel(root), [root]);

  // Right-column nodes: balancers, real outbounds, plus virtual ones for tags rules point at but nobody defines.
  const outNodes = useMemo(() => {
    const known = new Set(model.outbounds.map((o) => o.tag));
    const nodes = model.outbounds.map((o) => ({ tag: o.tag, sub: o.protocol, kind: o.kind as OutKind | "missing" }));
    for (const rule of model.rules) {
      if (rule.target.kind === "outbound" && !known.has(rule.target.tag)) {
        known.add(rule.target.tag);
        nodes.push({ tag: rule.target.tag, sub: rule.target.tag === model.apiTag ? "API" : "?", kind: rule.target.tag === model.apiTag ? "api" : "missing" });
      }
    }
    return nodes;
  }, [model]);

  const templateInboundTags = useMemo(() => model.inbounds.map((i) => i.tag), [model.inbounds]);
  const panelInbounds = useMemo(() => tags.inbounds.filter((i) => !templateInboundTags.includes(i.tag)), [tags.inbounds, templateInboundTags]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const modelKey = useMemo(() => JSON.stringify([model, outNodes, panelInbounds.length]), [model, outNodes, panelInbounds.length]);
  const geo = useGeometry(containerRef, modelKey);

  const [hover, setHover] = useState<string | null>(null);
  const [sim, setSim] = useState<Sim>(IDLE_SIM);
  const animRef = useRef<number | null>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // ---- simulator form ----
  const referencedGeo = useMemo(() => collectGeoTags((root && typeof root.routing === "object" ? root.routing : {}) as Rec), [root]);
  const [req, setReq] = useState<SimRequest>({ domain: "youtube.com", ip: "", port: "443", network: "tcp", protocol: "tls", inboundTag: "", sourceIp: "", user: "" });
  const [assumed, setAssumed] = useState<Set<string>>(() => autoAssumedTags({ domain: "youtube.com" } as SimRequest, referencedGeo));
  const [simOpen, setSimOpen] = useState(true);

  const patchReq = (p: Partial<SimRequest>) => {
    const next = { ...req, ...p };
    setReq(next);
    if ("domain" in p) setAssumed(autoAssumedTags(next, referencedGeo));
  };

  const stop = useCallback(() => {
    if (animRef.current != null) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    stop();
    setSim(IDLE_SIM);
  }, [modelKey, stop]);

  const nodeId = {
    src: "src",
    inbound: (tag: string) => `in:${tag}`,
    rule: (i: number) => `rule:${i}`,
    out: (tag: string) => `out:${tag}`,
    bal: (tag: string) => `bal:${tag}`,
  };

  const run = () => {
    stop();
    const routing = root && typeof root.routing === "object" ? root.routing : {};
    const matchTag = req.inboundTag || panelInbounds[0]?.tag || "";
    const result = simulateRouting(routing, model.defaultTag, { ...req, inboundTag: matchTag }, assumed);

    const targetId =
      result.target.kind === "balancer" ? nodeId.bal(result.target.tag) : result.target.tag ? nodeId.out(result.target.tag) : "";
    const startId = templateInboundTags.includes(req.inboundTag) ? nodeId.inbound(req.inboundTag) : nodeId.src;
    const rects = geo.rects;
    const start = rects[startId];
    const tgt = rects[targetId];
    if (!start || !tgt) {
      setSim({ ...IDLE_SIM, phase: "done", result, target: targetId, arrivedId: targetId || null });
      return;
    }

    // Build one continuous path: start → each visited rule (top to bottom) → target.
    const stops: { index: number; len: number }[] = [];
    const svgNS = "http://www.w3.org/2000/svg";
    const meter = document.createElementNS(svgNS, "path");
    const lenOf = (d: string) => {
      meter.setAttribute("d", d);
      return meter.getTotalLength();
    };
    const s0 = R(start);
    let d = `M ${s0.x} ${s0.y}`;
    const visited = result.steps.map((st) => st.index);
    if (visited.length === 0) {
      d += ` ${bez(s0, L(tgt))} L ${C(tgt).x} ${C(tgt).y}`;
    } else {
      const first = rects[nodeId.rule(visited[0]!)];
      if (!first) return;
      d += ` ${bez(s0, L(first))} L ${C(first).x} ${C(first).y}`;
      stops.push({ index: visited[0]!, len: lenOf(d) });
      for (let k = 1; k < visited.length; k++) {
        const rr = rects[nodeId.rule(visited[k]!)];
        if (!rr) continue;
        d += ` L ${C(rr).x} ${C(rr).y}`;
        stops.push({ index: visited[k]!, len: lenOf(d) });
      }
      const last = rects[nodeId.rule(visited[visited.length - 1]!)]!;
      if (result.matchedIndex >= 0) {
        d += ` L ${R(last).x} ${R(last).y} ${bez(R(last), L(tgt))} L ${C(tgt).x} ${C(tgt).y}`;
      } else {
        d += ` L ${B(last).x} ${B(last).y} ${bez(B(last), L(tgt))} L ${C(tgt).x} ${C(tgt).y}`;
      }
    }
    const total = lenOf(d);

    const marksFor = (index: number): { ok: boolean; text: string } => {
      const step = result.steps.find((x) => x.index === index)!;
      if (step.verdict.matched) return { ok: true, text: step.verdict.checks.length ? tr("flowMatch", "match") : tr("flowMatchAll", "matches everything") };
      const bad = step.verdict.checks.find((c) => !c.ok);
      return { ok: false, text: bad ? `${bad.cond}` : "" };
    };

    if (reduced) {
      const marks: Marks = {};
      for (const s of stops) marks[s.index] = marksFor(s.index);
      setSim({ phase: "done", d, total, pos: total, head: C(tgt), marks, arrivedId: targetId, result, target: targetId });
      return;
    }

    const probe = document.createElementNS(svgNS, "path");
    probe.setAttribute("d", d);
    const marks: Marks = {};
    let pos = 0;
    let nextStop = 0;
    let dwellUntil = 0;
    let last = performance.now();
    setSim({ phase: "running", d, total, pos: 0, head: s0, marks: {}, arrivedId: null, result, target: targetId });

    const frame = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      if (now >= dwellUntil) {
        const remaining = total - pos;
        const speed = remaining < 90 ? 240 : 620; // ease into the target
        pos = Math.min(total, pos + (speed * dt) / 1000);
        const st = stops[nextStop];
        if (st && pos >= st.len) {
          pos = st.len;
          marks[st.index] = marksFor(st.index);
          nextStop++;
          dwellUntil = now + (marks[st.index]!.ok ? 620 : 420);
        }
      }
      const head = probe.getPointAtLength(pos);
      const done = pos >= total && nextStop >= stops.length;
      setSim({
        phase: done ? "done" : "running",
        d,
        total,
        pos,
        head: { x: head.x, y: head.y },
        marks: { ...marks },
        arrivedId: done ? targetId : null,
        result,
        target: targetId,
      });
      if (!done) animRef.current = requestAnimationFrame(frame);
      else animRef.current = null;
    };
    animRef.current = requestAnimationFrame(frame);
  };

  // ---- links ----
  type LinkDef = { id: string; d: string; color: string; from: string; to: string; dashed?: boolean; particles: number; rail?: boolean };
  const links = useMemo<LinkDef[]>(() => {
    const rects = geo.rects;
    const out: LinkDef[] = [];
    const leftIds = [nodeId.src, ...templateInboundTags.map(nodeId.inbound)];
    const firstRule = model.rules[0];
    const defaultOut = model.defaultTag ? rects[nodeId.out(model.defaultTag)] : undefined;

    for (const id of leftIds) {
      const a = rects[id];
      if (!a) continue;
      const dest = firstRule ? rects[nodeId.rule(0)] : defaultOut;
      if (!dest) continue;
      out.push({ id: `l:${id}`, d: curve(R(a), L(dest)), color: TONE.source, from: id, to: firstRule ? nodeId.rule(0) : nodeId.out(model.defaultTag), particles: 2 });
    }
    model.rules.forEach((rule, i) => {
      const a = rects[nodeId.rule(i)];
      if (!a) return;
      const next = rects[nodeId.rule(i + 1)];
      if (next) {
        out.push({ id: `rail:${i}`, d: `M ${B(a).x} ${B(a).y} L ${T(next).x} ${T(next).y}`, color: TONE.source, from: nodeId.rule(i), to: nodeId.rule(i + 1), particles: 1, rail: true });
      }
      let targetId = "";
      let color = TONE.source;
      if (rule.target.kind === "outbound") {
        targetId = nodeId.out(rule.target.tag);
        const n = outNodes.find((o) => o.tag === rule.target.tag);
        color = TONE[n?.kind ?? "missing"];
      } else if (rule.target.kind === "balancer") {
        targetId = nodeId.bal(rule.target.tag);
        color = TONE.balancer;
      }
      const b = targetId ? rects[targetId] : undefined;
      if (b) out.push({ id: `rule-out:${i}`, d: curve(R(a), L(b)), color, from: nodeId.rule(i), to: targetId, particles: 2 });
    });
    const lastRule = model.rules[model.rules.length - 1];
    if (lastRule && !lastRule.catchAll && defaultOut) {
      const a = rects[nodeId.rule(model.rules.length - 1)];
      if (a) out.push({ id: "default", d: `M ${B(a).x} ${B(a).y} ${bez(B(a), L(defaultOut))}`, color: TONE.source, from: nodeId.rule(model.rules.length - 1), to: nodeId.out(model.defaultTag), dashed: true, particles: 1 });
    }
    for (const bal of model.balancers) {
      const a = rects[nodeId.bal(bal.tag)];
      if (!a) continue;
      for (const m of bal.members) {
        const mr = rects[nodeId.out(m)];
        if (mr) out.push({ id: `bal:${bal.tag}:${m}`, d: bracket(R(a), R(mr)), color: TONE.balancer, from: nodeId.bal(bal.tag), to: nodeId.out(m), particles: 1 });
      }
      const fb = bal.fallback ? rects[nodeId.out(bal.fallback)] : undefined;
      if (fb) out.push({ id: `balfb:${bal.tag}`, d: bracket(R(a), R(fb)), color: TONE.source, from: nodeId.bal(bal.tag), to: nodeId.out(bal.fallback), dashed: true, particles: 0 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, model, outNodes, templateInboundTags]);

  /** Hovered node plus the nodes it is directly linked to. */
  const related = useMemo(() => {
    if (!hover) return null;
    const ids = new Set<string>([hover]);
    for (const l of links) {
      if (l.from === hover) ids.add(l.to);
      if (l.to === hover) ids.add(l.from);
    }
    return ids;
  }, [hover, links]);

  const running = sim.phase === "running";
  const nodeProps = (id: string) => ({
    "data-flow-id": id,
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover((h) => (h === id ? null : h)),
  });
  const dimmed = (id: string) => (related && !related.has(id) ? "opacity-35" : "");
  const arrived = (id: string) => sim.arrivedId === id;

  const inboundOptions = [
    { value: "", label: tr("flowClient", "Client (panel inbound)") },
    ...templateInboundTags.map((v) => ({ value: v, label: `${v} (${tr("flowTemplateInbound", "template")})` })),
    ...panelInbounds.map((i) => ({ value: i.tag, label: i.hint ? `${i.tag} · ${i.hint}` : i.tag })),
  ];

  const presets: { label: string; patch: Partial<SimRequest>; geo?: boolean }[] = [
    { label: "youtube.com · TLS", patch: { domain: "youtube.com", ip: "", port: "443", network: "tcp", protocol: "tls", inboundTag: "" } },
    { label: tr("flowPresetLan", "LAN 192.168.1.10"), patch: { domain: "", ip: "192.168.1.10", port: "80", network: "tcp", protocol: "", inboundTag: "" } },
    { label: "BitTorrent", patch: { domain: "tracker.example.org", ip: "", port: "6881", network: "tcp", protocol: "bittorrent", inboundTag: "" } },
    { label: tr("flowPresetAds", "Ad domain"), patch: { domain: "doubleclick.net", ip: "", port: "443", network: "tcp", protocol: "tls", inboundTag: "" } },
    { label: tr("flowPresetApi", "Panel API call"), patch: { domain: "", ip: "127.0.0.1", port: "62789", network: "tcp", protocol: "", inboundTag: templateInboundTags[0] ?? "api" } },
  ];

  const result = sim.result;
  const targetLabel = result
    ? result.target.kind === "none"
      ? tr("flowNoTarget", "no target — the rule has neither outbound nor balancer")
      : result.target.tag
    : "";
  const unknownTags = result ? [...new Set(result.steps.flatMap((s) => s.verdict.unknownTags))] : [];

  const empty = model.rules.length === 0 && model.outbounds.length === 0;

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
            <Route size={16} className="text-[var(--accent)]" />
            {tr("flowTitle", "Traffic map")}
          </div>
          <p className="mt-0.5 max-w-3xl text-xs text-[var(--fg-subtle)]">
            {tr("flowHint", "How a connection travels: it enters through an inbound, falls down the rules until one matches, and leaves through that rule's outbound. Hover a node to see its paths.")}
          </p>
        </div>
        <Button type="button" variant={simOpen ? "primary" : "secondary"} className="!gap-1.5 !px-3 !py-1.5 !text-xs" onClick={() => setSimOpen((v) => !v)}>
          <Send size={13} />
          {tr("flowSimulator", "Test a connection")}
        </Button>
      </div>

      {simOpen ? (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => patchReq(p.patch)}
                className="rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
              >
                {p.label}
              </button>
            ))}
          </div>
          <FieldGrid>
            <Field label={tr("flowDomain", "Destination domain")} hint={tr("flowDomainHint", "Leave empty when the destination is a bare IP.")}>
              <TextField mono value={req.domain} placeholder="youtube.com" onChange={(v) => patchReq({ domain: v.trim() })} />
            </Field>
            <Field label={tr("flowIp", "Destination IP")} hint={tr("flowIpHint", "For a domain: the IP it resolves to (only used by IP rules).")}>
              <TextField mono value={req.ip} placeholder="203.0.113.7" onChange={(v) => patchReq({ ip: v.trim() })} />
            </Field>
            <Field label={tr("flowPort", "Port")}>
              <TextField mono value={req.port} placeholder="443" onChange={(v) => patchReq({ port: v.trim() })} />
            </Field>
            <Field label={tr("flowInbound", "Arrives through")}>
              <SelectField value={req.inboundTag} onChange={(v) => patchReq({ inboundTag: v })} options={inboundOptions} />
            </Field>
            <Field label={tr("flowNetwork", "Network")}>
              <div className="flex gap-1.5">
                {(["tcp", "udp"] as const).map((n) => (
                  <ToggleChip key={n} active={req.network === n} onClick={() => patchReq({ network: n })}>
                    {n}
                  </ToggleChip>
                ))}
              </div>
            </Field>
            <Field label={tr("flowProtocol", "Sniffed protocol")}>
              <div className="flex flex-wrap gap-1.5">
                {["", "http", "tls", "quic", "bittorrent"].map((p) => (
                  <ToggleChip key={p || "none"} active={req.protocol === p} onClick={() => patchReq({ protocol: p })}>
                    {p || tr("flowNone", "none")}
                  </ToggleChip>
                ))}
              </div>
            </Field>
          </FieldGrid>
          {referencedGeo.length > 0 ? (
            <Field label={tr("flowAssume", "Assume these geo lists contain the destination")} hint={tr("flowAssumeHint", "geosite/geoip files are not available in the browser. Well-known domains are pre-selected; adjust to test other outcomes.")}>
              <div className="flex flex-wrap gap-1.5">
                {referencedGeo.map((g) => {
                  const key = g.toLowerCase();
                  return (
                    <ToggleChip
                      key={g}
                      active={assumed.has(key)}
                      onClick={() =>
                        setAssumed((prev) => {
                          const n = new Set(prev);
                          if (n.has(key)) n.delete(key);
                          else n.add(key);
                          return n;
                        })
                      }
                    >
                      {g}
                    </ToggleChip>
                  );
                })}
              </div>
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="primary" className="!gap-2" onClick={run} disabled={running || empty}>
              <Play size={15} />
              {running ? tr("flowRunning", "Sending…") : tr("flowSend", "Send traffic")}
            </Button>
            {result && sim.phase === "done" ? (
              <div className="min-w-0 flex-1 text-sm text-[var(--fg)]">
                {result.matchedIndex >= 0 ? (
                  <span>
                    {tr("flowRuleMatched", "Rule {{n}} matched", { n: result.matchedIndex + 1 })} →{" "}
                    <b className="text-[var(--accent)]">{targetLabel}</b>
                  </span>
                ) : (
                  <span>
                    {tr("flowNoRule", "No rule matched — default outbound")} → <b className="text-[var(--accent)]">{targetLabel}</b>
                  </span>
                )}
                {unknownTags.length > 0 ? (
                  <span className="mt-0.5 block text-[11px] text-amber-300">
                    {tr("flowUnknownTags", "Could not check: {{tags}}. Toggle them above to try other outcomes.", { tags: unknownTags.join(", ") })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {empty ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--fg-muted)]">
          {tr("flowEmpty", "Add outbounds and routing rules to see the map.")}
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div ref={containerRef} className="relative mx-auto min-w-[820px] max-w-[1040px]">
            <svg className="pointer-events-none absolute inset-0" width={geo.w} height={geo.h} aria-hidden>
              <defs>
                <filter id="flow-glow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="3.2" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {links.map((l, i) => {
                const lit = !hover || l.from === hover || l.to === hover;
                const soft = running ? 0.35 : 1;
                const hot = sim.phase === "done" && sim.target !== "" && l.from === sim.target && l.id.startsWith("bal:");
                return (
                  <g key={l.id} style={{ opacity: lit ? (hot ? 1 : soft) : 0.08, transition: "opacity .2s" }}>
                    <path id={`fl-${l.id}`} d={l.d} fill="none" style={{ stroke: l.color }} strokeOpacity={hot ? 0.95 : l.dashed ? 0.35 : 0.28} strokeWidth={hot ? 2.6 : 1.5} strokeDasharray={l.dashed ? "3 5" : undefined} filter={hot ? "url(#flow-glow)" : undefined} />
                    {!reduced && !l.dashed ? <path d={l.d} fill="none" style={{ stroke: l.color }} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="2 10" className="flow-dash" /> : null}
                    {!reduced
                      ? Array.from({ length: hot ? 4 : l.particles }).map((_, k) => (
                          <circle key={k} r={l.rail ? 2 : 2.6} style={{ fill: l.color }}>
                            <animateMotion dur={`${l.rail ? 1.6 : 2.6 + ((i + k) % 3) * 0.5}s`} begin={`${((i * 0.37 + k * 1.1) % 2.4).toFixed(2)}s`} repeatCount="indefinite">
                              <mpath href={`#fl-${l.id}`} />
                            </animateMotion>
                          </circle>
                        ))
                      : null}
                  </g>
                );
              })}

              {sim.d ? (
                <g>
                  <path d={sim.d} fill="none" style={{ stroke: TONE.balancer }} strokeOpacity={0.9} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${sim.pos} ${sim.total + 10}`} filter="url(#flow-glow)" />
                  {sim.head && sim.phase === "running" ? (
                    <>
                      <circle cx={sim.head.x} cy={sim.head.y} r={11} style={{ fill: "#ffffff" }} opacity={0.16} />
                      <circle cx={sim.head.x} cy={sim.head.y} r={5.5} style={{ fill: "#ffffff" }} filter="url(#flow-glow)" />
                    </>
                  ) : null}
                </g>
              ) : null}
            </svg>

            <div className="relative grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,210px)] gap-x-20">
              {/* inbounds */}
              <div className="flex flex-col justify-center gap-3">
                <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{tr("flowColInbounds", "Enters")}</div>
                <FlowCard {...nodeProps(nodeId.src)} tone={TONE.source} icon={Users} title={tr("flowClients", "Clients")} sub={tr("flowClientsSub", "{{n}} panel inbounds", { n: panelInbounds.length })} className={dimmed(nodeId.src)} pulse={running && sim.result != null && !templateInboundTags.includes(req.inboundTag)} />
                {model.inbounds.map((i) => (
                  <FlowCard key={i.tag} {...nodeProps(nodeId.inbound(i.tag))} tone={TONE.api} icon={Radio} title={i.tag} sub={i.protocol} className={dimmed(nodeId.inbound(i.tag))} small />
                ))}
              </div>

              {/* rules */}
              <div className="flex flex-col gap-3">
                <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{tr("flowColRules", "Routing rules — first match wins")}</div>
                {model.rules.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-3 text-center text-xs text-[var(--fg-muted)]">{tr("flowNoRules", "No rules — everything goes to the first outbound")}</div>
                ) : null}
                {model.rules.map((rule) => {
                  const mark = sim.marks[rule.index];
                  const isTarget = sim.result?.matchedIndex === rule.index && sim.phase !== "idle";
                  return (
                    <div
                      key={rule.index}
                      {...nodeProps(nodeId.rule(rule.index))}
                      className={`rounded-xl border bg-[var(--bg)] px-3 py-2 transition-all ${dimmed(nodeId.rule(rule.index))} ${
                        mark ? (mark.ok ? "border-emerald-400/70 shadow-[0_0_0_1px_rgba(52,211,153,.5),0_0_18px_rgba(52,211,153,.25)]" : "border-rose-400/60") : "border-[var(--border-strong)]"
                      } ${isTarget && mark?.ok ? "flow-arrive" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-[11px] font-semibold text-[var(--fg-muted)]">{rule.index + 1}</span>
                        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                          {rule.catchAll ? (
                            <span className="text-xs italic text-[var(--fg-muted)]">{tr("flowAnyTraffic", "any traffic")}</span>
                          ) : (
                            <>
                              {rule.chips.slice(0, 5).map((c, k) => (
                                <span key={k} className="max-w-[14rem] truncate rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--fg)]">
                                  {c}
                                </span>
                              ))}
                              {rule.chips.length > 5 ? <span className="text-[11px] text-[var(--fg-muted)]">+{rule.chips.length - 5}</span> : null}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-1 h-4 pl-7 text-[11px]">
                        {mark ? (
                          mark.ok ? (
                            <span className="text-emerald-400">✓ {mark.text}</span>
                          ) : (
                            <span className="text-rose-300">✕ {tr("flowNoMatch", "no match")}: {mark.text}</span>
                          )
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* outputs */}
              <div className="flex flex-col justify-center gap-3">
                <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{tr("flowColOut", "Leaves via")}</div>
                {model.balancers.map((b) => (
                  <FlowCard key={b.tag} {...nodeProps(nodeId.bal(b.tag))} tone={TONE.balancer} icon={KIND_ICON.balancer} title={b.tag} sub={`${b.strategy} · ${b.members.length}`} className={dimmed(nodeId.bal(b.tag))} arrived={arrived(nodeId.bal(b.tag))} />
                ))}
                {outNodes.map((o) => (
                  <FlowCard
                    key={o.tag}
                    {...nodeProps(nodeId.out(o.tag))}
                    tone={TONE[o.kind]}
                    icon={KIND_ICON[o.kind]}
                    title={o.tag}
                    sub={o.tag === model.defaultTag ? `${o.sub} · ${tr("flowDefault", "default")}` : o.sub}
                    className={dimmed(nodeId.out(o.tag))}
                    arrived={arrived(nodeId.out(o.tag))}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FlowCard({
  tone,
  icon: Icon,
  title,
  sub,
  small,
  className = "",
  arrived,
  pulse,
  ...rest
}: {
  tone: string;
  icon: LucideIcon;
  title: ReactNode;
  sub?: ReactNode;
  small?: boolean;
  className?: string;
  arrived?: boolean;
  pulse?: boolean;
} & HTMLAttributes<HTMLDivElement> & { "data-flow-id": string }) {
  return (
    <div
      {...rest}
      className={`flex items-center gap-2.5 rounded-xl border bg-[var(--bg)] transition-all ${small ? "px-2.5 py-1.5" : "px-3 py-2.5"} ${arrived ? "flow-arrive" : ""} ${pulse ? "flow-pulse" : ""} ${className}`}
      style={{ borderColor: `color-mix(in oklab, ${tone} 55%, transparent)`, boxShadow: arrived ? `0 0 0 1px ${tone}, 0 0 24px ${tone}66` : undefined }}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${tone} 18%, transparent)`, color: tone }}>
        <Icon size={small ? 14 : 16} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-[var(--fg)]">{title}</span>
        {sub ? <span className="block truncate text-[11px] text-[var(--fg-subtle)]">{sub}</span> : null}
      </span>
    </div>
  );
}
