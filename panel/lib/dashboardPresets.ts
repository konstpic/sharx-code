/**
 * Board presets: ready-made whole boards ("Presets of boards" gallery) and the user's own presets ("Mine").
 *
 * - `PRESETS` is the registry: id, i18n keys, tags, a schematic preview and `build(ctx)` that returns the tiles of the board
 *   (a `TileBundle`: panels + settings + hole-free rects at 12 columns; the 6 / 1 column layouts are derived by the grid engine).
 *   `modern`, `classic26` and `v271` reuse the existing sets; the others are made of catalog atoms and metric tiles with a
 *   per-tile `style` (see dashboardStyle.ts). Tiles whose data cannot exist (no nodes, no balancers, no permission) are
 *   skipped and the row they were in is widened, so there are no holes.
 * - The board `preset` marker (see DashboardPreset in dashboardGrid.ts) names the registry entry; "Reset layout" of such a
 *   board restores THAT preset (`resetBoardToPreset`). A board made from "Mine" has no marker (reset = modern default).
 * - "Mine" (`workspace.myPresets`, at most 24): layout + styles of a board. Tiles of one node / balancer are stored as a
 *   template (`node:@:cpu`) and rebuilt for every live node / balancer. Everything stored or imported is sanitised: only
 *   `metric` and `widget` tiles survive (no HTML / embed / text), names are plain text, nothing is ever executed.
 * Pure functions only, relative imports only.
 */
import type { CustomPanel, DashboardBoard, DashboardLayout, TileSettings } from "./dashboardBuilder";
import { metricPanel, type SetTile } from "./dashboardCatalog";
import {
  MAX_PANELS, atomPanel, classicPanelGrid, classicPanelSet, defaultPanelGrid, defaultPanelSet, placeBelow, resetToPreset, sanitizePanel, sanitizeTile,
  v271PanelGrid, v271PanelSet, type PanelSet, type TileBundle, type TileRect,
} from "./dashboardModel";
import { entityTemplate, type TemplateEntity } from "./dashboardMetricsTemplates";
import {
  GRID_COLS, GRID_VERSION, constraintsForKind, reflow, compact, tidyGrid, tileKind, type ConstraintsOf, type DashboardPreset, type GridItem,
} from "./dashboardGrid";
import { APPEARANCE_KEYS, applyAppearance, mergeStyle, pickStyle, type TileStyle } from "./dashboardStyle";

/* ------------------------------------------------------------------ context, tags, types */

/** What a preset may need from the live installation. Everything is optional: an empty context builds the "no data" board. */
export type PresetCtx = {
  nodes?: TemplateEntity[];
  balancers?: TemplateEntity[];
  /** i18n function (titles of per-node tiles); keys are returned as they are without it. */
  t?: (key: string) => string;
  /** Permissions of the viewer; an absent flag means "allowed". */
  can?: { logs?: boolean; backup?: boolean; xrayOperate?: boolean };
};

export const PRESET_TAGS = ["classic", "monitoring", "network", "infra", "clients", "telemt", "style"] as const;
export type PresetTag = (typeof PRESET_TAGS)[number];

export type PresetEntry = {
  id: string;
  /** The value stored in `board.preset` (classic26 -> "classic"). */
  marker: DashboardPreset;
  nameKey: string;
  descKey: string;
  tags: PresetTag[];
  /** Schematic rows: widths (of 12) of the tiles of every row, built from a sample context. */
  preview: number[][];
  /** The tiles depend on the live list of nodes / balancers. */
  dynamic?: boolean;
  /** The preset carries its own tile styles (so "apply the look only" makes sense). */
  styled: boolean;
  build: (ctx: PresetCtx) => TileBundle;
};

/** Prefix of the ids of tiles made by the registry presets (the three legacy ones keep the ids of their sets). */
export const PRESET_ID_PREFIX = "custom-pr-";
export const MY_PRESETS_LIMIT = 24;
export const MY_PRESET_MAX_PANELS = 80;
export const IMPORT_MAX_BYTES = 200 * 1024;

type Need = "nodes" | "balancers" | "logs" | "backup" | "xray";
type PTile = SetTile & { style?: TileStyle; need?: Need };
type PRow = { h: number; tiles: PTile[] };

export const PRESET_SAMPLE_CTX: PresetCtx = { nodes: [{ id: 1, name: "node-1" }, { id: 2, name: "node-2" }], balancers: [{ id: 1, name: "lb-1" }] };

const allowed = (need: Need | undefined, ctx: PresetCtx): boolean => {
  switch (need) {
    case "nodes": return (ctx.nodes?.length ?? 0) > 0;
    case "balancers": return (ctx.balancers?.length ?? 0) > 0;
    case "logs": return ctx.can?.logs !== false;
    case "backup": return ctx.can?.backup !== false;
    case "xray": return ctx.can?.xrayOperate !== false;
    default: return true;
  }
};

/** Widths of one row made to sum to 12 (tiles were removed): the widest tiles grow first. */
function justify(widths: number[]): number[] {
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum === GRID_COLS || !widths.length) return widths;
  const out = widths.map((w) => Math.max(2, Math.floor((w * GRID_COLS) / sum)));
  let left = GRID_COLS - out.reduce((a, b) => a + b, 0);
  const order = out.map((_, i) => i).sort((a, b) => out[b] - out[a] || a - b);
  for (let guard = 0; left > 0 && guard < 100; guard++) {
    out[order[guard % order.length]]++;
    left--;
  }
  return out;
}

/** Panels, settings and rects of rows of tiles (every row 12 columns wide), `base` style under every tile style. */
function rowsOf(prefix: string, rows: readonly PRow[], ctx: PresetCtx, base?: TileStyle): TileBundle {
  const panels: CustomPanel[] = [];
  const tiles: Record<string, TileSettings> = {};
  const rects: TileRect[] = [];
  let y = 0;
  let n = 0;
  for (const row of rows) {
    const specs = row.tiles.filter((s) => allowed(s.need, ctx));
    if (!specs.length || panels.length + specs.length > MAX_PANELS) continue;
    const widths = justify(specs.map((s) => s.w));
    let x = 0;
    specs.forEach((spec, i) => {
      const id = `${prefix}-${n++}`;
      const built = spec.atom ? atomPanel(spec.atom, id) : metricPanel(id, spec);
      if (!built) return;
      if (spec.atom && spec.title) {
        built.panel.title = spec.title;
        built.tile.title = spec.title;
      }
      const w = widths[i];
      built.tile.width = w;
      built.tile.height = Math.max(3, Math.min(24, row.h));
      const style = mergeStyle(base, spec.style);
      if (style) {
        built.tile.style = style;
        if (style.accent) built.tile.color = style.accent;
      }
      panels.push(built.panel);
      tiles[id] = built.tile;
      rects.push({ id, x, y, w, h: row.h });
      x += w;
    });
    y += row.h;
  }
  return { panels, tiles, rects };
}

/* ------------------------------------------------------------------ tile shorthands */

const PASTEL = ["#93c5fd", "#c4b5fd", "#f9a8d4", "#86efac", "#fde68a", "#99f6e4"];
const NEON = ["#22d3ee", "#f472b6", "#a3e635", "#a78bfa", "#fb923c", "#38bdf8"];
const LEVELS = { ok: "#22c55e", warn: "#f59e0b", crit: "#ef4444" };

const m = (metric: string, view: string, w: number, x: Partial<PTile> = {}): PTile => ({ metrics: [metric], view, w, ...x });
/** A metric tile of a 0..100 % range (gauge-like looks need the scale). */
const pct = (metric: string, view: string, w: number, x: Partial<PTile> = {}): PTile => m(metric, view, w, { min: 0, max: 100, ...x });
const at = (atom: string, w: number, x: Partial<PTile> = {}): PTile => ({ atom, w, ...x });
const withAccents = (row: PTile[], palette: readonly string[], from = 0): PTile[] => row.map((t, i) => ({ ...t, style: { ...t.style, accent: palette[(from + i) % palette.length] } }));

/* ------------------------------------------------------------------ the presets */

const nocRows = (): PRow[] => [
  { h: 5, tiles: [m("nodes.online", "hero", 3, { need: "nodes" }), pct("nodes.availability", "gauge", 3, { need: "nodes" }), m("clients.online", "hero", 3), m("telemt.running", "hero", 3, { need: "nodes" })] },
  { h: 4, tiles: [pct("cpu", "gauge", 3), pct("mem.percent", "gauge", 3), pct("disk.percent", "gauge", 3), m("load.1", "stat", 3)] },
  { h: 12, tiles: [at("telemt_dc", 12)] },
  { h: 4, tiles: [m("nodes.offline", "hero", 3, { need: "nodes" }), m("nodes.latency.max", "stat", 3, { need: "nodes" }), m("balancers.pools.unhealthy", "hero", 3, { need: "balancers" }), at("logs", 3, { need: "logs" })] },
];
const NOC_STYLE: TileStyle = { preset: "contrast", valueScale: 120, valueFont: "mono", colorMode: "thresholds", levelColors: LEVELS, pulseOnCrit: true, uppercaseLabel: true };

const minimalRows = (): PRow[] => [
  { h: 5, tiles: [pct("cpu", "hero", 3), pct("mem.percent", "hero", 3), pct("disk.percent", "hero", 3), m("clients.online", "hero", 3)] },
  { h: 5, tiles: [m("network.up", "hero", 3), m("network.down", "hero", 3), m("panel.uptime", "hero", 3), pct("nodes.availability", "hero", 3, { need: "nodes" })] },
];
const MINIMAL_STYLE: TileStyle = { preset: "flat", padding: "roomy", valueScale: 160, labelScale: 90, align: "center", radius: 20, border: { show: false } };

const networkRows = (): PRow[] => [
  { h: 6, tiles: withAccents([m("network.up", "area", 6), m("network.down", "area", 6)], ["#22c55e", "#38bdf8"]) },
  { h: 4, tiles: [m("network.sent", "stat", 3), m("network.received", "stat", 3), m("network.tcp", "stat", 3), m("network.udp", "stat", 3)] },
  { h: 4, tiles: [m("traffic.total", "stat", 4), m("traffic.up", "stat", 4), m("traffic.down", "stat", 4)] },
  { h: 5, tiles: [m("nodes.rate.up", "spark", 6, { need: "nodes" }), m("nodes.rate.down", "spark", 6, { need: "nodes" })] },
  { h: 4, tiles: [m("balancers.rate.in", "spark", 6, { need: "balancers" }), m("balancers.rate.out", "spark", 6, { need: "balancers" })] },
];
const NETWORK_STYLE: TileStyle = { preset: "gradient", spark: { fill: true, strokeWidth: 2.4 } };

const clientsRows = (): PRow[] => [
  { h: 4, tiles: [m("clients.online", "spark", 3), m("clients.total", "stat", 3), m("clients.enabled", "stat", 3), m("stats.clients.expired", "stat", 3)] },
  { h: 8, tiles: [at("user_agent", 6), m("clients.online", "area", 6)] },
  { h: 4, tiles: [at("db_rows", 3), at("db_size", 3), at("db_tables", 3), at("db_pool", 3)] },
  { h: 4, tiles: [m("network.sent", "stat", 3), m("network.received", "stat", 3), m("clients.traffic", "stat", 3), m("clients.allTime", "stat", 3)] },
];
const CLIENTS_STYLE: TileStyle = { preset: "soft" };

const telemtRows = (): PRow[] => [
  { h: 4, tiles: [at("telemt_version", 3), at("telemt_dc_summary", 3), at("telemt_dc_dots", 6)] },
  { h: 12, tiles: [at("telemt_dc", 12)] },
  { h: 4, tiles: [m("telemt.running", "stat", 3, { need: "nodes" }), m("telemt.stopped", "stat", 3, { need: "nodes" }), m("telemt.unknown", "stat", 3, { need: "nodes" }), m("telemt.local.sidecars", "stat", 3)] },
];
const TELEMT_STYLE: TileStyle = { preset: "glass", accent: "#a78bfa" };

const neonRows = (): PRow[] => [
  { h: 4, tiles: withAccents([pct("cpu", "gauge", 3), pct("mem.percent", "gauge", 3), pct("disk.percent", "gauge", 3), pct("swap.percent", "gauge", 3)], NEON) },
  { h: 4, tiles: withAccents([m("clients.online", "spark", 3), m("network.up", "spark", 3), m("network.down", "spark", 3), m("load.1", "stat", 3)], NEON, 4) },
  { h: 6, tiles: withAccents([at("cpu_history", 6), at("memory_history", 6)], NEON, 1) },
];
const NEON_STYLE: TileStyle = { preset: "neon", valueFont: "mono" };

const softRows = (): PRow[] => [
  { h: 4, tiles: withAccents([at("cpu_gauge", 3), at("ram_gauge", 3), at("disk_gauge", 3), at("users_online", 3)], PASTEL) },
  { h: 4, tiles: withAccents([at("net_up", 3), at("net_down", 3), at("os_uptime", 3), at("db_size", 3)], PASTEL, 4) },
  { h: 6, tiles: withAccents([at("cpu_history", 6), at("memory_history", 6)], PASTEL, 2) },
];
const SOFT_STYLE: TileStyle = { preset: "soft", radius: 28, valueWeight: 500 };

const phoneRows = (): PRow[] => [
  { h: 4, tiles: [pct("cpu", "hero", 3), pct("mem.percent", "hero", 3), pct("disk.percent", "hero", 3), m("clients.online", "hero", 3)] },
  { h: 4, tiles: [m("network.up", "hero", 3), m("network.down", "hero", 3), m("load.1", "hero", 3), m("os.uptime", "hero", 3)] },
  { h: 4, tiles: [m("network.tcp", "hero", 3), m("network.udp", "hero", 3), m("db.connections", "hero", 3), m("panel.threads", "hero", 3)] },
];
const PHONE_STYLE: TileStyle = { preset: "flat", padding: "compact", valueScale: 140, align: "center", labelPos: "bottom" };

/** Aggregates + one row per live node, then the same for balancers (built from the entity templates). */
function infraRows(ctx: PresetCtx): PRow[] {
  const t = ctx.t ?? ((k: string) => k);
  const toRows = (kind: "nodes" | "balancers"): PRow[] => entityTemplate(kind, t, ctx).rows.map((r) => ({ h: r.h, tiles: r.tiles.map((x) => ({ metrics: x.metrics, view: x.view, title: x.title, w: x.w, color: x.color, min: x.min, max: x.max })) }));
  const hasNodes = (ctx.nodes?.length ?? 0) > 0;
  const hasBal = (ctx.balancers?.length ?? 0) > 0;
  if (!hasNodes && !hasBal) return [{ h: 4, tiles: [pct("cpu", "gauge", 3), pct("mem.percent", "gauge", 3), pct("disk.percent", "gauge", 3), m("load.1", "stat", 3)] }];
  const rows = [...(hasNodes ? toRows("nodes") : []), ...(hasBal ? toRows("balancers") : [])];
  const out: PRow[] = [];
  let count = 0;
  for (const r of rows) {
    if (count + r.tiles.length > MAX_PANELS) break;
    out.push(r);
    count += r.tiles.length;
  }
  return out;
}

const fromSet = (set: PanelSet, grid: GridItem[]): TileBundle => ({ panels: set.panels, tiles: set.tiles, rects: grid.map((g) => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: g.h })) });

function previewOf(b: TileBundle): number[][] {
  const rows = new Map<number, TileRect[]>();
  for (const r of b.rects) rows.set(r.y, [...(rows.get(r.y) ?? []), r]);
  return [...rows.entries()].sort((a, c) => a[0] - c[0]).map(([, list]) => list.sort((a, c) => a.x - c.x).map((r) => r.w));
}

type Def = Omit<PresetEntry, "preview" | "styled">;
const def = (id: string, marker: DashboardPreset, tags: PresetTag[], build: (ctx: PresetCtx) => TileBundle, dynamic?: boolean): Def => ({
  id, marker, nameKey: `pages.builder.presets.name_${id}`, descKey: `pages.builder.presets.desc_${id}`, tags, build, ...(dynamic ? { dynamic } : {}),
});
const made = (id: string, rows: (ctx: PresetCtx) => PRow[], base?: TileStyle) => (ctx: PresetCtx) => rowsOf(`${PRESET_ID_PREFIX}${id}`, rows(ctx), ctx, base);

const DEFS: Def[] = [
  def("modern", "modern", ["monitoring"], () => fromSet(defaultPanelSet(), defaultPanelGrid())),
  def("classic26", "classic", ["classic"], () => fromSet(classicPanelSet(), classicPanelGrid())),
  def("v271", "v271", ["classic"], () => fromSet(v271PanelSet(), v271PanelGrid())),
  def("noc", "noc", ["monitoring"], made("noc", nocRows, NOC_STYLE)),
  def("minimal", "minimal", ["style"], made("minimal", minimalRows, MINIMAL_STYLE)),
  def("network", "network", ["network"], made("network", networkRows, NETWORK_STYLE)),
  def("infra", "infra", ["infra", "monitoring"], made("infra", infraRows, { preset: "glass" }), true),
  def("clients", "clients", ["clients"], made("clients", clientsRows, CLIENTS_STYLE)),
  def("telemt", "telemt", ["telemt"], made("telemt", telemtRows, TELEMT_STYLE)),
  def("neon", "neon", ["style"], made("neon", neonRows, NEON_STYLE)),
  def("soft", "soft", ["style"], made("soft", softRows, SOFT_STYLE)),
  def("phone", "phone", ["style"], made("phone", phoneRows, PHONE_STYLE)),
];

export const PRESETS: readonly PresetEntry[] = DEFS.map((d) => {
  const sample = d.build(PRESET_SAMPLE_CTX);
  return { ...d, preview: previewOf(sample), styled: sample.panels.some((p) => sample.tiles[p.id]?.style) };
});

export const presetById = (id: string): PresetEntry | undefined => PRESETS.find((p) => p.id === id);
export const presetByMarker = (marker: DashboardPreset | undefined): PresetEntry | undefined => PRESETS.find((p) => p.marker === marker);

/* ------------------------------------------------------------------ boards from presets */

const consOf = (panels: readonly CustomPanel[], tiles: Readonly<Record<string, TileSettings>>): ConstraintsOf => (id) => {
  const p = panels.find((x) => x.id === id);
  return constraintsForKind(tileKind(id, tiles[id]?.view, p?.kind, p?.widget));
};

const layoutOf = (b: TileBundle): DashboardLayout => ({
  version: 1,
  order: b.panels.map((p) => p.id),
  tiles: b.tiles,
  panels: b.panels,
  gridVersion: GRID_VERSION,
  grid: tidyGrid(b.rects.map((r) => ({ ...r })), consOf(b.panels, b.tiles)),
});

/** The layout of a preset for the given installation. */
export const presetLayoutFor = (entry: PresetEntry, ctx: PresetCtx = {}): DashboardLayout => layoutOf(entry.build(ctx));

/** A new board made from a preset (`preset: marker`). */
export function presetBoard(entry: PresetEntry, ctx: PresetCtx, name: string, id: string): DashboardBoard {
  return { id, name: name.slice(0, 60) || "Dashboard", enabled: [], preset: entry.marker, layout: presetLayoutFor(entry, ctx) };
}

type Replaceable = { panels: CustomPanel[]; tiles: Record<string, TileSettings>; order: string[]; grid?: GridItem[] };

/** The tiles of the board made by presets / the catalog atoms are replaced; tiles the user composed himself stay below. */
export function replaceWithPreset<L extends Replaceable>(layout: L, entry: PresetEntry, ctx: PresetCtx = {}): L {
  const set = entry.build(ctx);
  const setIds = new Set(set.panels.map((p) => p.id));
  const kept = layout.panels.filter((p) => !p.preset && !p.id.startsWith(PRESET_ID_PREFIX) && !setIds.has(p.id)).slice(0, Math.max(0, MAX_PANELS - set.panels.length));
  const panels = [...set.panels, ...kept];
  const tiles: Record<string, TileSettings> = { ...set.tiles };
  for (const p of kept) if (layout.tiles[p.id]) tiles[p.id] = layout.tiles[p.id];
  const cons = consOf(panels, tiles);
  const base = tidyGrid(set.rects.map((r) => ({ ...r })), cons);
  const grid = placeBelow(base, kept, tiles, layout.grid ?? [], cons);
  return { ...layout, panels, tiles, order: panels.map((p) => p.id), grid };
}

/**
 * "Reset layout" of a board made from a preset: tiles of the preset return to its arrangement (a hole-free block when some
 * are missing), every other tile gets its default size and is arranged below. Pure, never throws.
 */
export function resetBoardToPreset(
  marker: DashboardPreset | undefined,
  panels: readonly CustomPanel[],
  tiles: Readonly<Record<string, TileSettings>>,
  current: readonly GridItem[],
  ctx: PresetCtx = {},
  cons?: ConstraintsOf,
): GridItem[] {
  const entry = presetByMarker(marker);
  if (!entry || marker === "modern" || marker === "classic" || marker === "v271" || !marker) return resetToPreset(marker, panels, tiles, current, cons);
  try {
    const rect = new Map(entry.build(ctx).rects.map((r) => [r.id, r]));
    const present = panels.filter((p) => rect.has(p.id));
    const used = new Set(present.map((p) => p.id));
    const base = tidyGrid(present.map((p) => ({ ...rect.get(p.id)! })), cons);
    return placeBelow(base, panels.filter((p) => !used.has(p.id)), tiles, current, cons);
  } catch {
    return [...current];
  }
}

/* ------------------------------------------------------------------ apply only the look */

const STYLE_KEYS = APPEARANCE_KEYS.filter((k) => k !== "accent" && k !== "accent2" && k !== "hue");

/** The look of a preset per kind of tile (first styled tile of every kind; `*` = the first one). Accent colours are not part of it. */
export function presetStyleMap(entry: PresetEntry): Map<string, TileStyle> {
  const out = new Map<string, TileStyle>();
  const b = entry.build(PRESET_SAMPLE_CTX);
  for (const p of b.panels) {
    const tile = b.tiles[p.id];
    const style = pickStyle(tile?.style, STYLE_KEYS);
    if (!style) continue;
    const kind = tileKind(p.id, tile.view, p.kind, p.widget);
    if (!out.has(kind)) out.set(kind, style);
    if (!out.has("*")) out.set("*", style);
  }
  return out;
}

/** Gives the tiles of a board the look of a preset by kind of tile; data options, sizes and positions stay. */
export function applyPresetStyle<L extends { panels: CustomPanel[]; tiles: Record<string, TileSettings> }>(layout: L, entry: PresetEntry): L {
  const map = presetStyleMap(entry);
  if (!map.size) return layout;
  const tiles: Record<string, TileSettings> = { ...layout.tiles };
  for (const p of layout.panels) {
    const tile = tiles[p.id];
    if (!tile) continue;
    const style = map.get(tileKind(p.id, tile.view, p.kind, p.widget)) ?? map.get("*");
    if (style) tiles[p.id] = applyAppearance(tile, style);
  }
  return { ...layout, tiles };
}

/* ------------------------------------------------------------------ "Mine": the user's presets */

export type MyPreset = {
  id: string;
  name: string;
  desc: string;
  createdAt: number;
  layout: { panels: CustomPanel[]; tiles: Record<string, TileSettings>; rects: TileRect[] };
};

const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
const METRIC_ID = /^[A-Za-z0-9_.:@-]{1,80}$/;
const ENTITY_RE = /^(node|balancer):(\d+):(.+)$/;
const TEMPLATE_RE = /^(node|balancer):@:(.+)$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const BASE_TILE: TileSettings = { width: 3, height: 4, view: "default", title: "" };

/** One stored preset made safe, or null when nothing usable is left. `fallbackId` is used when the stored id is missing / unsafe. */
export function sanitizeMyPreset(raw: unknown, fallbackId: string): MyPreset | null {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const lay = r.layout as { panels?: unknown; tiles?: unknown; rects?: unknown } | undefined;
    if (!lay || typeof lay !== "object" || !Array.isArray(lay.panels) || !Array.isArray(lay.rects)) return null;
    const panels: CustomPanel[] = [];
    for (const p of lay.panels.slice(0, MY_PRESET_MAX_PANELS * 2)) {
      if (panels.length >= MY_PRESET_MAX_PANELS) break;
      const s = sanitizePanel(p);
      if (!s || panels.some((x) => x.id === s.id)) continue;
      // only data tiles: no HTML / embed / text / design content ever comes from a preset
      if (s.kind !== "metric" && s.kind !== "widget") continue;
      const metrics = s.metrics.filter((x) => METRIC_ID.test(x));
      if (s.kind === "metric" && !metrics.length) continue;
      panels.push({ ...s, title: clean(s.title, 100), metrics: s.kind === "metric" ? metrics : [], code: "", url: "", text: "" });
    }
    const ids = new Set(panels.map((p) => p.id));
    const rawTiles = (lay.tiles && typeof lay.tiles === "object" ? lay.tiles : {}) as Record<string, unknown>;
    const tiles: Record<string, TileSettings> = {};
    for (const p of panels) {
      const t = sanitizeTile(Object.prototype.hasOwnProperty.call(rawTiles, p.id) ? rawTiles[p.id] : undefined, BASE_TILE);
      tiles[p.id] = { ...t, title: clean(t.title, 100) };
    }
    const rects: TileRect[] = [];
    for (const g of lay.rects) {
      const q = g as Record<string, unknown>;
      if (!q || typeof q !== "object" || typeof q.id !== "string" || !ids.has(q.id) || rects.some((x) => x.id === q.id)) continue;
      if (![q.x, q.y, q.w, q.h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
      const w = Math.max(1, Math.min(GRID_COLS, Math.round(q.w as number)));
      rects.push({ id: q.id, x: Math.max(0, Math.min(GRID_COLS - w, Math.round(q.x as number))), y: Math.max(0, Math.min(400, Math.round(q.y as number))), w, h: Math.max(1, Math.min(60, Math.round(q.h as number))) });
    }
    const placed = panels.filter((p) => rects.some((x) => x.id === p.id));
    if (!placed.length) return null;
    const keep = new Set(placed.map((p) => p.id));
    for (const id of Object.keys(tiles)) if (!keep.has(id)) delete tiles[id];
    const id = typeof r.id === "string" && SAFE_ID.test(r.id) ? r.id : fallbackId;
    const createdAt = typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? Math.max(0, Math.round(r.createdAt)) : 0;
    return { id, name: clean(r.name, 40) || "Preset", desc: clean(r.desc, 140), createdAt, layout: { panels: placed, tiles, rects: rects.filter((x) => keep.has(x.id)) } };
  } catch {
    return null;
  }
}

/** Stored list made safe: corrupt entries and duplicate ids are dropped, at most MY_PRESETS_LIMIT stay. */
export function parseMyPresets(raw: unknown): MyPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: MyPreset[] = [];
  for (const e of raw.slice(0, MY_PRESETS_LIMIT * 2)) {
    if (out.length >= MY_PRESETS_LIMIT) break;
    const p = sanitizeMyPreset(e, `my-${out.length}-${Math.abs(hash(JSON.stringify(e ?? null)))}`.slice(0, 40));
    if (p && !out.some((x) => x.id === p.id)) out.push(p);
  }
  return out;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < Math.min(s.length, 4000); i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

const reading = (a: TileRect, b: TileRect) => a.y - b.y || a.x - b.x;
type EntityRef = { kind: "node" | "balancer"; id: number };
function entityOf(p: CustomPanel): EntityRef | null {
  if (p.kind !== "metric" || !p.metrics.length) return null;
  let found: EntityRef | null = null;
  for (const id of p.metrics) {
    const e = ENTITY_RE.exec(id);
    if (!e) return null;
    const ref = { kind: e[1] as "node" | "balancer", id: Number(e[2]) };
    if (found && (found.kind !== ref.kind || found.id !== ref.id)) return null;
    found = ref;
  }
  return found;
}

/**
 * Saves a board as a preset. Per-node / per-balancer tiles are stored as a template of the FIRST node (balancer) found in
 * reading order (`node:@:cpu`, title `%name% · CPU`); the tiles of the other ones are dropped and rebuilt per live entity.
 * Content tiles (HTML, embed, text, design) are not stored. Returns null when nothing is left.
 */
export function makeMyPreset(
  id: string,
  name: string,
  desc: string,
  from: { panels: readonly CustomPanel[]; tiles: Readonly<Record<string, TileSettings>>; grid: readonly TileRect[] },
  ctx: PresetCtx = {},
  now: number = Date.now(),
): MyPreset | null {
  const gridOf = new Map(from.grid.map((g) => [g.id, g]));
  const cand = from.panels.filter((p) => (p.kind === "metric" || p.kind === "widget") && gridOf.has(p.id)).sort((a, b) => reading(gridOf.get(a.id)!, gridOf.get(b.id)!));
  const first = new Map<string, number>();
  for (const p of cand) {
    const e = entityOf(p);
    if (e && !first.has(e.kind)) first.set(e.kind, e.id);
  }
  const panels: CustomPanel[] = [];
  const tiles: Record<string, TileSettings> = {};
  const rects: TileRect[] = [];
  for (const p of cand) {
    const e = entityOf(p);
    if (e && first.get(e.kind) !== e.id) continue;
    let panel: CustomPanel = JSON.parse(JSON.stringify(p));
    if (e) {
      const list = (e.kind === "node" ? ctx.nodes : ctx.balancers) ?? [];
      const ent = list.find((x) => x.id === e.id);
      const title = ent && panel.title.startsWith(ent.name + " · ") ? "%name%" + panel.title.slice(ent.name.length) : panel.title;
      panel = { ...panel, title, metrics: panel.metrics.map((x) => `${e.kind}:@:${ENTITY_RE.exec(x)![3]}`) };
    }
    const g = gridOf.get(p.id)!;
    panels.push(panel);
    if (from.tiles[p.id]) tiles[p.id] = JSON.parse(JSON.stringify(from.tiles[p.id]));
    rects.push({ id: p.id, x: g.x, y: g.y, w: g.w, h: g.h });
  }
  if (!panels.length) return null;
  const minY = Math.min(...rects.map((r) => r.y));
  return sanitizeMyPreset({ id, name, desc, createdAt: now, layout: { panels, tiles, rects: rects.map((r) => ({ ...r, y: r.y - minY })) } }, id);
}

const tplKind = (p: CustomPanel): "node" | "balancer" | null => {
  if (p.kind !== "metric" || !p.metrics.length) return null;
  const k = TEMPLATE_RE.exec(p.metrics[0])?.[1] as "node" | "balancer" | undefined;
  return k && p.metrics.every((x) => TEMPLATE_RE.exec(x)?.[1] === k) ? k : null;
};

/** The tiles of a saved preset for the given installation: templates are repeated for every live node / balancer. Ids are fresh. */
export function buildMyPreset(mp: MyPreset, ctx: PresetCtx = {}): TileBundle {
  const items = [...mp.layout.rects].sort(reading).map((r) => ({ r, p: mp.layout.panels.find((x) => x.id === r.id)! })).filter((i) => i.p);
  type Out = { p: CustomPanel; tile: TileSettings; w: number; h: number; x: number; y: number };
  const out: Out[] = [];
  const done = new Set<string>();
  let hasTemplate = false;
  const push = (p: CustomPanel, r: TileRect, e?: TemplateEntity) => {
    const tile: TileSettings = JSON.parse(JSON.stringify(mp.layout.tiles[p.id] ?? BASE_TILE));
    let panel: CustomPanel = JSON.parse(JSON.stringify(p));
    if (e) panel = { ...panel, title: panel.title.replace("%name%", e.name).slice(0, 100), metrics: panel.metrics.map((x) => x.replace(":@:", `:${e.id}:`)) };
    out.push({ p: panel, tile, w: r.w, h: r.h, x: r.x, y: r.y });
  };
  for (const { r, p } of items) {
    const k = tplKind(p);
    if (!k) {
      push(p, r);
      continue;
    }
    hasTemplate = true;
    if (done.has(k)) continue;
    done.add(k);
    const tpl = items.filter((i) => tplKind(i.p) === k);
    for (const e of (k === "node" ? ctx.nodes : ctx.balancers) ?? []) for (const i of tpl) push(i.p, i.r, e);
  }
  const list = out.slice(0, MAX_PANELS);
  const panels: CustomPanel[] = [];
  const tiles: Record<string, TileSettings> = {};
  const raw: GridItem[] = [];
  list.forEach((o, i) => {
    const id = `${PRESET_ID_PREFIX}u-${i}`;
    panels.push({ ...o.p, id });
    tiles[id] = { ...o.tile, width: o.w, height: o.h };
    raw.push({ id, x: hasTemplate ? 0 : o.x, y: hasTemplate ? i : o.y, w: o.w, h: o.h });
  });
  if (!panels.length) return { panels, tiles, rects: [] };
  const cons = consOf(panels, tiles);
  const minY = Math.min(...raw.map((g) => g.y));
  const placed = hasTemplate ? compact(reflow(raw, GRID_COLS, cons, GRID_COLS), GRID_COLS, cons) : compact(raw.map((g) => ({ ...g, y: g.y - minY })), GRID_COLS, cons);
  return { panels, tiles, rects: placed.map((g) => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: g.h })) };
}

/** A board made from one of the user's presets. It has no registry marker: "Reset layout" restores the modern default places. */
export function myPresetBoard(mp: MyPreset, ctx: PresetCtx, id: string): DashboardBoard {
  return { id, name: mp.name, enabled: [], layout: layoutOf(buildMyPreset(mp, ctx)) };
}

/** Replaces the catalog / preset tiles of a board by a saved preset; the user's own tiles stay below. */
export function replaceWithMyPreset<L extends Replaceable>(layout: L, mp: MyPreset, ctx: PresetCtx = {}): L {
  const entry: PresetEntry = { id: "mine", marker: "modern", nameKey: "", descKey: "", tags: [], preview: [], styled: false, build: () => buildMyPreset(mp, ctx) };
  return replaceWithPreset(layout, entry, ctx);
}

/* ---- list operations (pure) */

export function addMyPreset(list: readonly MyPreset[], preset: MyPreset | null): MyPreset[] {
  if (!preset || list.length >= MY_PRESETS_LIMIT || list.some((x) => x.id === preset.id)) return [...list];
  return [...list, preset];
}
export const renameMyPreset = (list: readonly MyPreset[], id: string, name: string, desc?: string): MyPreset[] =>
  list.map((x) => (x.id === id ? { ...x, name: clean(name, 40) || x.name, desc: desc === undefined ? x.desc : clean(desc, 140) } : x));
export const deleteMyPreset = (list: readonly MyPreset[], id: string): MyPreset[] => list.filter((x) => x.id !== id);
export function duplicateMyPreset(list: readonly MyPreset[], id: string, newId: string, suffix: string): MyPreset[] {
  const src = list.find((x) => x.id === id);
  if (!src || list.length >= MY_PRESETS_LIMIT) return [...list];
  const copy = sanitizeMyPreset({ ...JSON.parse(JSON.stringify(src)), id: newId, name: `${src.name} ${suffix}`.slice(0, 40), createdAt: src.createdAt }, newId);
  return copy ? [...list, copy] : [...list];
}

/* ---- export / import */

export const PRESET_FILE_FORMAT = "sharx-dashboard-preset";

export function exportMyPreset(mp: MyPreset): string {
  return JSON.stringify({ format: PRESET_FILE_FORMAT, version: 1, preset: { name: mp.name, desc: mp.desc, layout: mp.layout } }, null, 2);
}

export type ImportResult = { ok: true; presets: MyPreset[] } | { ok: false; error: "tooBig" | "invalid" | "empty" };

/**
 * Reads exported JSON (one preset, the file wrapper, or a list of them). The text is size-capped, parsed with JSON.parse
 * only and every preset goes through `sanitizeMyPreset`; ids are assigned by `newId`. Nothing is evaluated.
 */
export function importMyPresets(text: string, newId: () => string, room: number = MY_PRESETS_LIMIT, now: number = Date.now()): ImportResult {
  if (typeof text !== "string") return { ok: false, error: "invalid" };
  if (text.length > IMPORT_MAX_BYTES || (typeof TextEncoder !== "undefined" && new TextEncoder().encode(text).length > IMPORT_MAX_BYTES)) return { ok: false, error: "tooBig" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid" };
  }
  const wrapped = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v) && (v as Record<string, unknown>).format === PRESET_FILE_FORMAT ? (v as Record<string, unknown>).preset : v);
  const list = Array.isArray(data) ? data : [data];
  const presets: MyPreset[] = [];
  for (const e of list.slice(0, MY_PRESETS_LIMIT)) {
    if (presets.length >= Math.max(0, room)) break;
    const p = sanitizeMyPreset({ ...(wrapped(e) as object), id: undefined }, newId());
    if (p) presets.push({ ...p, id: newId(), createdAt: now });
  }
  return presets.length ? { ok: true, presets } : { ok: false, error: list.length ? "invalid" : "empty" };
}

/** Tags used by the gallery filter, with the "mine" pseudo tag. */
export const GALLERY_FILTERS = ["all", ...PRESET_TAGS, "mine"] as const;
export type GalleryFilter = (typeof GALLERY_FILTERS)[number];
