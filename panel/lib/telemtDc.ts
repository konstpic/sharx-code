/**
 * Pure helpers for the "Telemt DC" dashboard widget (no React, no DOM, relative imports only so
 * vitest can run them). Everything the UI derives client-side lives here: state transitions,
 * RTT history ring buffers, summaries, filtering / sorting, reason explanations, diagnostics.
 */

export type DCState = "up" | "degraded" | "down" | "unknown";

export type DCEndpoint = { endpoint: string; activeWriters: number };

export type DCRow = {
  dc: number;
  state: DCState;
  rttMs?: number;
  endpoints: number;
  availableEndpoints: number;
  aliveWriters: number;
  requiredWriters: number;
  coveragePct: number;
  load: number;
  ipPreference?: string;
  source: "me" | "upstream" | "";
  // Optional extras (newer backend / Telemt).
  availablePct?: number;
  floorMin?: number;
  floorTarget?: number;
  floorMax?: number;
  floorCapped?: boolean;
  endpointList?: DCEndpoint[];
  upstreamRttMs?: number;
  upstreamReachable?: number;
  upstreamUnreachable?: number;
  slowConnectFails?: number;
  refillInflight?: number;
};

export type UpstreamItem = {
  id: number;
  routeKind: string;
  address?: string;
  healthy: boolean;
  fails: number;
  lastCheckAgeSecs: number;
  latencyMs?: number;
  weight?: number;
};

export type UpstreamSummary = {
  configured: number;
  healthy: number;
  unhealthy: number;
  direct?: number;
  socks4?: number;
  socks5?: number;
  shadowsocks?: number;
  connectAttempts?: number;
  connectSuccess?: number;
  connectFail?: number;
  items?: UpstreamItem[];
};

export type WriterSummary = {
  total: number;
  aliveNonDraining: number;
  draining: number;
  degraded: number;
  healthy: number;
  warm: number;
  active: number;
};

export type PoolSummary = {
  activeGeneration: number;
  warmGeneration: number;
  drainingGenerations: number;
  hardswapEnabled: boolean;
  hardswapPending: boolean;
  refillInflight: number;
};

export type MEQuality = {
  reconnectAttempts: number;
  reconnectSuccess: number;
  kdfDrift: number;
  readerEof: number;
  idleClosedByPeer: number;
  dropNoConn: number;
  dropChannelClosed: number;
  dropQueueFull: number;
};

export type Instance = {
  inboundId: number;
  tag: string;
  remark: string;
  port: number;
  available: boolean;
  reason?: string;
  meEnabled: boolean;
  upstreams?: UpstreamSummary;
  dcs: DCRow[];
  updatedAt: number;
  detail?: string;
  snapshotAt?: number;
  writers?: WriterSummary;
  pool?: PoolSummary;
  meQuality?: MEQuality;
};

export type Source = {
  kind: "panel" | "node";
  nodeId: number;
  name: string;
  error?: string;
  instances: Instance[];
  latencyMs?: number;
  fetchedAt?: number;
  stale?: boolean;
};

export const STANDARD_DCS = [1, 2, 3, 4, 5];
export const POLL_OPTIONS = [5, 15, 30, 60] as const;
export const DEFAULT_POLL_SECONDS = 15;
export const HISTORY_MAX = 40;
export const EVENTS_MAX = 20;

/* ------------------------------------------------------------------ keys & labels */

export function sourceKey(s: Pick<Source, "kind" | "nodeId">): string {
  return `${s.kind}-${s.nodeId}`;
}

export function instanceKey(sKey: string, i: Pick<Instance, "inboundId" | "tag">): string {
  return `${sKey}/${i.inboundId}-${i.tag}`;
}

export function dcKey(iKey: string, dc: number): string {
  return `${iKey}#${dc}`;
}

export type DCKind = "standard" | "media" | "cdn" | "other";

/** Telemt reports media DCs as negative ids; DC 203 is the CDN / non-standard cluster. */
export function dcKind(dc: number): DCKind {
  if (dc < 0) return "media";
  if (dc === 203) return "cdn";
  if (STANDARD_DCS.includes(dc)) return "standard";
  return "other";
}

export function dcLabel(dc: number): string {
  if (dc < 0) return `DC${-dc} media`;
  if (dc === 203) return "DC203 CDN";
  return `DC${dc}`;
}

/** Display order: standard 1..5, then media (by id), then CDN/others (by id). */
export function dcOrder(a: number, b: number): number {
  const rank = (d: number) => (STANDARD_DCS.includes(d) ? 0 : d < 0 ? 1 : 2);
  const ra = rank(a);
  const rb = rank(b);
  return ra !== rb ? ra - rb : Math.abs(a) - Math.abs(b);
}

/* ------------------------------------------------------------------ severity */

export function stateSeverity(state: DCState): number {
  switch (state) {
    case "down":
      return 3;
    case "degraded":
      return 2;
    case "unknown":
      return 1;
    default:
      return 0;
  }
}

export function worstState(states: DCState[]): DCState {
  let w: DCState = "up";
  let ws = -1;
  for (const s of states) {
    const v = stateSeverity(s);
    if (v > ws) {
      ws = v;
      w = s;
    }
  }
  return states.length ? w : "unknown";
}

/** Higher = worse. Down beats degraded; within a state, lower writer coverage and fewer endpoints rank worse. */
export function rowSeverity(r: DCRow): number {
  let sc = stateSeverity(r.state) * 1000;
  if (r.requiredWriters > 0) sc += Math.round(100 - Math.min(100, r.coveragePct));
  if (r.endpoints > 0) sc += Math.round((1 - r.availableEndpoints / r.endpoints) * 50);
  return sc;
}

export function instanceSeverity(i: Instance): number {
  if (!i.available) return 4000;
  return i.dcs.reduce((m, r) => Math.max(m, rowSeverity(r)), 0);
}

export function hasProblem(i: Instance): boolean {
  return !i.available || i.dcs.some((r) => r.state === "down" || r.state === "degraded");
}

/* ------------------------------------------------------------------ flat rows, filtering, sorting */

export type FlatRow = {
  key: string;
  sourceKey: string;
  sourceName: string;
  sourceKind: Source["kind"];
  instanceKey: string;
  inst: Instance;
  row: DCRow;
};

export function flatten(sources: Source[]): FlatRow[] {
  const out: FlatRow[] = [];
  for (const s of sources) {
    const sk = sourceKey(s);
    for (const inst of s.instances) {
      const ik = instanceKey(sk, inst);
      for (const row of inst.dcs) {
        out.push({ key: dcKey(ik, row.dc), sourceKey: sk, sourceName: s.name, sourceKind: s.kind, instanceKey: ik, inst, row });
      }
    }
  }
  return out;
}

export type SortMode = "severity" | "rtt" | "load" | "dc";

export function sortFlat(rows: FlatRow[], mode: SortMode): FlatRow[] {
  const copy = [...rows];
  const tie = (a: FlatRow, b: FlatRow) => dcOrder(a.row.dc, b.row.dc) || a.inst.remark.localeCompare(b.inst.remark);
  copy.sort((a, b) => {
    switch (mode) {
      case "severity":
        return rowSeverity(b.row) - rowSeverity(a.row) || tie(a, b);
      case "rtt": {
        const ra = a.row.rttMs ?? -1;
        const rb = b.row.rttMs ?? -1;
        // slowest first; rows without RTT go last
        if (ra < 0 && rb < 0) return tie(a, b);
        if (ra < 0) return 1;
        if (rb < 0) return -1;
        return rb - ra || tie(a, b);
      }
      case "load":
        return b.row.load - a.row.load || tie(a, b);
      default:
        return dcOrder(a.row.dc, b.row.dc) || a.inst.remark.localeCompare(b.inst.remark);
    }
  });
  return copy;
}

export function sortInstances(list: Instance[], mode: SortMode): Instance[] {
  const copy = [...list];
  const worstRtt = (i: Instance) => i.dcs.reduce((m, r) => Math.max(m, r.rttMs ?? -1), -1);
  const totalLoad = (i: Instance) => i.dcs.reduce((m, r) => m + r.load, 0);
  copy.sort((a, b) => {
    switch (mode) {
      case "severity":
        return instanceSeverity(b) - instanceSeverity(a) || a.remark.localeCompare(b.remark);
      case "rtt":
        return worstRtt(b) - worstRtt(a) || a.remark.localeCompare(b.remark);
      case "load":
        return totalLoad(b) - totalLoad(a) || a.remark.localeCompare(b.remark);
      default:
        return a.remark.localeCompare(b.remark);
    }
  });
  return copy;
}

export type Filter = {
  problemsOnly: boolean;
  /** "all" or a sourceKey. */
  source: string;
  search: string;
};

export const EMPTY_FILTER: Filter = { problemsOnly: false, source: "all", search: "" };

function matchesSearch(s: Source, i: Instance, q: string): boolean {
  if (!q) return true;
  const hay = `${i.tag} ${i.remark} ${s.name} ${i.port} ${i.inboundId}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Filters sources/instances; sources left without instances are dropped unless they carry an error. */
export function filterSources(sources: Source[], f: Filter): Source[] {
  const out: Source[] = [];
  for (const s of sources) {
    if (f.source !== "all" && sourceKey(s) !== f.source) continue;
    const instances = s.instances.filter((i) => matchesSearch(s, i, f.search.trim()) && (!f.problemsOnly || hasProblem(i)));
    if (instances.length === 0 && !(s.error && !f.search.trim())) continue;
    out.push({ ...s, instances });
  }
  return out;
}

export type DcGroup = { dc: number; state: DCState; rows: FlatRow[]; rttMin?: number; rttMax?: number; load: number };

/** Group-by-DC view: one group per DC id with the worst state across all instances. */
export function groupByDc(rows: FlatRow[]): DcGroup[] {
  const m = new Map<number, FlatRow[]>();
  for (const r of rows) {
    const l = m.get(r.row.dc);
    if (l) l.push(r);
    else m.set(r.row.dc, [r]);
  }
  return [...m.entries()]
    .sort((a, b) => dcOrder(a[0], b[0]))
    .map(([dc, list]) => {
      const rtts = list.map((x) => x.row.rttMs).filter((v): v is number => typeof v === "number");
      return {
        dc,
        state: worstState(list.map((x) => x.row.state)),
        rows: list,
        rttMin: rtts.length ? Math.min(...rtts) : undefined,
        rttMax: rtts.length ? Math.max(...rtts) : undefined,
        load: list.reduce((n, x) => n + x.row.load, 0),
      };
    });
}

/* ------------------------------------------------------------------ summary */

export type Counts = { up: number; degraded: number; down: number; unknown: number };
export type SourceSummary = Counts & { key: string; name: string; kind: Source["kind"]; instances: number; unavailable: number; error?: string; stale?: boolean };
export type Overall = "ok" | "degraded" | "down" | "empty";
export type Summary = Counts & {
  totalDcs: number;
  instances: number;
  unavailableInstances: number;
  sourcesWithErrors: number;
  panelSources: number;
  nodeSources: number;
  overall: Overall;
  bySource: SourceSummary[];
};

const zero = (): Counts => ({ up: 0, degraded: 0, down: 0, unknown: 0 });

export function summarize(sources: Source[]): Summary {
  const total = zero();
  let instances = 0;
  let unavailable = 0;
  let errs = 0;
  const bySource: SourceSummary[] = [];
  for (const s of sources) {
    const c = zero();
    let un = 0;
    for (const i of s.instances) {
      instances++;
      if (!i.available) {
        un++;
        continue;
      }
      for (const r of i.dcs) c[r.state]++;
    }
    unavailable += un;
    if (s.error) errs++;
    for (const k of ["up", "degraded", "down", "unknown"] as const) total[k] += c[k];
    bySource.push({ ...c, key: sourceKey(s), name: s.name, kind: s.kind, instances: s.instances.length, unavailable: un, error: s.error, stale: s.stale });
  }
  const totalDcs = total.up + total.degraded + total.down + total.unknown;
  let overall: Overall = "ok";
  if (instances === 0 && errs === 0) overall = "empty";
  else if (total.down > 0) overall = "down";
  else if (total.degraded > 0 || unavailable > 0 || errs > 0) overall = "degraded";
  return {
    ...total,
    totalDcs,
    instances,
    unavailableInstances: unavailable,
    sourcesWithErrors: errs,
    panelSources: sources.filter((s) => s.kind === "panel").length,
    nodeSources: sources.filter((s) => s.kind === "node").length,
    overall,
    bySource,
  };
}

/* ------------------------------------------------------------------ history ring buffers */

export type Sample = { t: number; rtt: number | null; state: DCState };
export type History = Record<string, Sample[]>;

/** Immutable ring-buffer push: keeps the newest `max` items. */
export function pushRing<T>(arr: readonly T[] | undefined, item: T, max = HISTORY_MAX): T[] {
  const next = arr ? [...arr, item] : [item];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Appends one sample per live DC row; series of DCs that disappeared are dropped. */
export function recordPoll(prev: History, sources: Source[], now: number, max = HISTORY_MAX): History {
  const next: History = {};
  for (const r of flatten(sources)) {
    if (!r.inst.available) continue;
    next[r.key] = pushRing(prev[r.key], { t: now, rtt: typeof r.row.rttMs === "number" ? r.row.rttMs : null, state: r.row.state }, max);
  }
  return next;
}

export function rttSeries(h: Sample[] | undefined): (number | null)[] {
  return (h ?? []).map((s) => s.rtt);
}

export type RttStats = { min: number; max: number; avg: number; last: number; count: number };

export function rttStats(values: (number | null)[]): RttStats | null {
  const v = values.filter((x): x is number => typeof x === "number");
  if (v.length === 0) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return { min: Math.min(...v), max: Math.max(...v), avg: sum / v.length, last: v[v.length - 1], count: v.length };
}

/**
 * SVG path for a sparkline. `null` values break the line (gap). Returns "" when there is nothing
 * drawable. Single points are drawn as a tiny horizontal tick so they stay visible.
 */
export function sparklinePath(values: (number | null)[], w: number, h: number, pad = 2): string {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => typeof p.v === "number");
  if (pts.length === 0) return "";
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const n = Math.max(1, values.length - 1);
  const x = (i: number) => pad + (n === 0 ? 0 : (i / n) * (w - 2 * pad));
  const y = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) / span) * (h - 2 * pad));
  let d = "";
  let prevI = -2;
  for (const p of pts) {
    const cmd = p.i === prevI + 1 ? "L" : "M";
    d += `${cmd}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`;
    prevI = p.i;
  }
  if (pts.length === 1) {
    const only = pts[0];
    d = `M${Math.max(0, x(only.i) - 2).toFixed(1)} ${y(only.v).toFixed(1)}L${(x(only.i) + 2).toFixed(1)} ${y(only.v).toFixed(1)}`;
  }
  return d;
}

/** sessionStorage payload: only the newest samples of every series. */
export function serializeHistory(h: History, max = HISTORY_MAX): string {
  const o: History = {};
  for (const [k, v] of Object.entries(h)) o[k] = v.slice(-max);
  return JSON.stringify(o);
}

export function parseHistory(raw: string | null | undefined, max = HISTORY_MAX): History {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const out: History = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const list = v
        .filter((s): s is Sample => !!s && typeof s === "object" && typeof (s as Sample).t === "number" && ["up", "degraded", "down", "unknown"].includes((s as Sample).state))
        .map((s) => ({ t: s.t, rtt: typeof s.rtt === "number" ? s.rtt : null, state: s.state }));
      if (list.length) out[k] = list.slice(-max);
    }
    return out;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ state transitions */

export type TrackedState = { state: DCState; since: number };
export type Tracker = Record<string, TrackedState>;

export type Transition = {
  /** Series key (dc key, or instance key for whole-instance availability changes). */
  key: string;
  at: number;
  from: DCState;
  to: DCState;
  /** null when the whole instance became (un)available. */
  dc: number | null;
  sourceName: string;
  instanceLabel: string;
};

const instLabel = (i: Instance) => i.remark || i.tag;

/**
 * Compares the new snapshot with the tracked states. `since` is kept while the state is unchanged
 * and reset on a change. A series seen for the first time is NOT a transition. An instance that
 * is unavailable is tracked as a single "down" series (key = instance key); its DC series vanish
 * and so do not produce phantom transitions when it comes back.
 */
export function detectTransitions(prev: Tracker, sources: Source[], now: number): { next: Tracker; transitions: Transition[] } {
  const next: Tracker = {};
  const transitions: Transition[] = [];
  const visit = (key: string, state: DCState, dc: number | null, s: Source, i: Instance) => {
    const p = prev[key];
    if (!p) {
      next[key] = { state, since: now };
      return;
    }
    if (p.state === state) {
      next[key] = p;
      return;
    }
    next[key] = { state, since: now };
    transitions.push({ key, at: now, from: p.state, to: state, dc, sourceName: s.name, instanceLabel: instLabel(i) });
  };
  for (const s of sources) {
    const sk = sourceKey(s);
    for (const i of s.instances) {
      const ik = instanceKey(sk, i);
      // availability pseudo-series
      visit(ik, i.available ? "up" : "down", null, s, i);
      if (!i.available) continue;
      for (const r of i.dcs) visit(dcKey(ik, r.dc), r.state, r.dc, s, i);
    }
  }
  return { next, transitions };
}

export function appendEvents(log: readonly Transition[], add: readonly Transition[], max = EVENTS_MAX): Transition[] {
  if (add.length === 0) return log.length > max ? log.slice(0, max) : [...log];
  return [...[...add].reverse(), ...log].slice(0, max); // newest first
}

export function isWorse(t: Pick<Transition, "from" | "to">): boolean {
  return stateSeverity(t.to) > stateSeverity(t.from) && t.to !== "unknown";
}

/** Notification trigger: a DC (or instance) went from working to down. */
export function isUpToDown(t: Pick<Transition, "from" | "to">): boolean {
  return t.to === "down" && (t.from === "up" || t.from === "degraded");
}

/** Keys that changed in the last poll (for the flash animation). */
export function changedKeys(transitions: readonly Transition[]): Set<string> {
  return new Set(transitions.map((t) => t.key));
}

/* ------------------------------------------------------------------ time */

export function formatAge(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export type Freshness = "fresh" | "aging" | "stale";

export function freshness(ageSec: number, intervalSec: number): Freshness {
  if (ageSec <= intervalSec * 1.5 + 2) return "fresh";
  if (ageSec <= intervalSec * 3 + 5) return "aging";
  return "stale";
}

/* ------------------------------------------------------------------ reasons */

export type ReasonInfo = { code: string; known: boolean; level: "error" | "warn" | "info" };

/**
 * Maps the backend `reason` codes (and Telemt's own `feature_disabled` / `source_unavailable`) to a
 * canonical code used for i18n keys `reason.<code>` and `hint.<code>`.
 */
export function reasonInfo(reason: string | undefined): ReasonInfo {
  switch (reason) {
    case "api_disabled":
      return { code: "api_disabled", known: true, level: "warn" };
    case "feature_disabled":
      return { code: "feature_disabled", known: true, level: "warn" };
    case "source_unavailable":
      return { code: "source_unavailable", known: true, level: "info" };
    case "unreachable":
    case undefined:
    case "":
      return { code: "unreachable", known: true, level: "error" };
    default:
      return { code: "other", known: false, level: "error" };
  }
}

/* ------------------------------------------------------------------ view mode */

export type ViewMode = "compact" | "medium" | "large";

export function viewModeFor(width: number, height: number): ViewMode {
  // Height only forces "compact" for very short tiles: a content-sized (auto height) container
  // would otherwise lock itself into a smaller mode after the first re-render.
  if (width < 360 || (height > 0 && height < 130)) return "compact";
  if (width < 760) return "medium";
  return "large";
}

/* ------------------------------------------------------------------ settings */

export function normalizePoll(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return (POLL_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_POLL_SECONDS;
}

/* ------------------------------------------------------------------ diagnostics */

function fmtMs(v?: number): string {
  return typeof v === "number" ? `${Math.round(v)}ms` : "-";
}

/** Plain-text diagnostic summary, handy to paste into a support ticket. */
export function diagnosticText(sources: Source[], now: number): string {
  const sum = summarize(sources);
  const lines: string[] = [];
  lines.push(`Telemt DC status @ ${new Date(now).toISOString()}`);
  lines.push(`Overall: ${sum.overall} | DCs up ${sum.up}, degraded ${sum.degraded}, down ${sum.down}, unknown ${sum.unknown} | instances ${sum.instances} (unavailable ${sum.unavailableInstances})`);
  for (const s of sources) {
    lines.push(`\n[${s.kind}] ${s.name}${s.stale ? " (STALE)" : ""}${s.error ? ` ERROR: ${s.error}` : ""}`);
    for (const i of s.instances) {
      const up = i.upstreams ? ` upstreams ${i.upstreams.healthy}/${i.upstreams.configured}` : "";
      lines.push(`  - ${instLabel(i)} (tag ${i.tag}, port ${i.port || "-"}, ME ${i.meEnabled ? "on" : "off"}${up})${i.available ? "" : ` UNAVAILABLE: ${i.reason ?? "unreachable"}${i.detail ? ` (${i.detail})` : ""}`}`);
      for (const r of [...i.dcs].sort((a, b) => dcOrder(a.dc, b.dc))) {
        lines.push(
          `      ${dcLabel(r.dc)} ${r.state} rtt=${fmtMs(r.rttMs)} endpoints=${r.availableEndpoints}/${r.endpoints} writers=${r.aliveWriters}/${r.requiredWriters} cov=${Math.round(r.coveragePct)}% load=${r.load} ip=${r.ipPreference || "-"} src=${r.source || "-"}`,
        );
      }
    }
  }
  return lines.join("\n");
}

export function diagnosticJson(sources: Source[], now: number): string {
  return JSON.stringify({ generatedAt: new Date(now).toISOString(), summary: summarize(sources), sources }, null, 2);
}

/* ------------------------------------------------------------------ grouping for the views */

export type GroupBy = "node" | "dc";

export type Group = {
  id: string;
  kind: "instance" | "dc";
  state: DCState;
  rows: FlatRow[];
  /** group-by-node: the instance (and the source it runs on). */
  inst?: Instance;
  source?: Source;
  /** group-by-dc: the DC id. */
  dc?: number;
};

/**
 * Builds the displayed groups. By node: one group per instance (unavailable instances included,
 * with zero rows), instances ordered by `sort`. By DC: one group per DC id with every instance's row.
 */
export function buildGroups(sources: Source[], groupBy: GroupBy, sort: SortMode): Group[] {
  if (groupBy === "dc") {
    return groupByDc(sortFlat(flatten(sources), sort)).map((g) => ({
      id: `dc:${g.dc}`,
      kind: "dc" as const,
      state: g.state,
      rows: g.rows,
      dc: g.dc,
    }));
  }
  const out: Group[] = [];
  for (const s of sources) {
    const sk = sourceKey(s);
    for (const inst of sortInstances(s.instances, sort)) {
      const ik = instanceKey(sk, inst);
      const rows = sortFlat(
        flatten([{ ...s, instances: [inst] }]),
        sort === "severity" || sort === "rtt" || sort === "load" ? sort : "dc",
      );
      out.push({ id: ik, kind: "instance", state: inst.available ? worstState(inst.dcs.map((d) => d.state)) : "down", rows, inst, source: s });
    }
  }
  if (sort === "dc") return out;
  const sev = (g: Group) => (g.inst ? instanceSeverity(g.inst) : 0);
  return sort === "severity" ? out.sort((a, b) => sev(b) - sev(a)) : out;
}
