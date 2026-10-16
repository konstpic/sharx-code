/**
 * One tile model. Every dashboard tile is a panel `{id: "custom-*", kind, metrics, widget?, preset?}` plus its
 * `TileSettings` (view, colours, thresholds ...). The former built-in atoms (cpu_gauge, net_up, logs, ...) are
 * presets of this model: `atomPanel(atomId)` creates the panel. Pure functions only, relative imports only.
 *
 * kind 'metric'  : one or more dashboard metrics shown in a look (stat / gauge / bar / sparkline / ...),
 * kind 'widget'  : a purpose-built tile (logs, backup, core update, user agents, server IP, Telemt DC ...), `widget` names it,
 * kind html / embed / text / design : free content.
 */
import type { CustomPanel, TileSettings } from "./dashboardBuilder";
import { normalizeDoc } from "./subLayout/tree";
import { DASHBOARD_WIDGET_ORDER, atomDef, expandLegacyWidgetIds } from "./dashboardLayout";
import { GRID_COLS, autoArrange, bottomOf, compact, defaultAtomGrid, firstFit, tileKind, type ConstraintsOf, type GridItem } from "./dashboardGrid";

/** Upper bound of tiles on one board (templates for many nodes need room). */
export const MAX_PANELS = 120;

export const panelIdForAtom = (atomId: string): string => "custom-" + atomId.replace(/_/g, "-");

const blankPanel = (id: string): CustomPanel => ({ id, title: "", kind: "metric", metrics: [], code: "", url: "", text: "" });

/** The panel (and its settings) a catalog atom stands for. `id` defaults to a stable id derived from the atom id. */
export function atomPanel(atomId: string, id: string = panelIdForAtom(atomId)): { panel: CustomPanel; tile: TileSettings } | null {
  const d = atomDef(atomId);
  if (!d) return null;
  const metrics = d.metrics ?? (d.metric ? [d.metric] : []);
  const metric = metrics.length > 0;
  const panel: CustomPanel = { ...blankPanel(id), kind: metric ? "metric" : "widget", metrics: [...metrics], preset: atomId, ...(metric ? {} : { widget: atomId }) };
  const tile = sanitizeTile(
    { width: Math.min(12, d.w), height: Math.max(3, Math.min(24, d.h)), view: metric ? (d.view ?? "stat") : "default", title: "", ...(metric ? { color: d.color } : {}) },
    { width: 3, height: 4, view: "default", title: "" },
  );
  return { panel, tile };
}

/* ------------------------------------------------------------------ sanitising stored data */

const clampNum = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
const PANEL_KINDS = ["metric", "widget", "html", "embed", "text", "design"];

/** A stored panel made safe; null when it is unusable (bad id, unknown widget). */
export function sanitizePanel(p: unknown): CustomPanel | null {
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^custom-[a-zA-Z0-9-]+$/.test(r.id)) return null;
  const kind = PANEL_KINDS.includes(r.kind as string) ? (r.kind as CustomPanel["kind"]) : "metric";
  let widget: string | undefined;
  if (kind === "widget") {
    const a = typeof r.widget === "string" ? atomDef(r.widget) : undefined;
    if (!a || a.metric || a.metrics) return null;
    widget = a.id;
  }
  const rawDesign = r.design as { nodes?: Record<string, unknown> } | undefined;
  const design = rawDesign && typeof rawDesign === "object" && Object.keys(rawDesign.nodes ?? {}).length <= 200 ? normalizeDoc(rawDesign as never) : null;
  const preset = typeof r.preset === "string" && atomDef(r.preset) ? r.preset : undefined;
  return {
    ...(design ? { design } : {}),
    id: r.id,
    title: typeof r.title === "string" ? r.title.slice(0, 100) : "",
    kind,
    ...(widget ? { widget } : {}),
    ...(preset ? { preset } : {}),
    metrics: Array.isArray(r.metrics) ? r.metrics.filter((x): x is string => typeof x === "string").slice(0, 8) : [],
    code: typeof r.code === "string" ? r.code.slice(0, 20000) : "",
    url: typeof r.url === "string" ? r.url.slice(0, 2000) : "",
    text: typeof r.text === "string" ? r.text.slice(0, 20000) : "",
  };
}

/** Stored tile settings made safe, on top of `base`. */
export function sanitizeTile(p: unknown, base: TileSettings): TileSettings {
  const r = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const th = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1e15, Math.min(1e15, v)) : undefined);
  return {
    width: Math.round(clampNum(r.width, 3, 12, base.width)),
    height: Math.round(clampNum(r.height, 3, 24, base.height)),
    view: typeof r.view === "string" ? r.view.slice(0, 20) : "default",
    title: typeof r.title === "string" ? r.title.slice(0, 100) : "",
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : undefined,
    min: typeof r.min === "number" ? clampNum(r.min, -1e15, 1e15, 0) : undefined,
    max: typeof r.max === "number" ? clampNum(r.max, -1e15, 1e15, 100) : undefined,
    precision: Math.round(clampNum(r.precision, 0, 3, 1)),
    fixedScale: r.fixedScale === true,
    ...(r.showTitle === false ? { showTitle: false } : {}),
    ...(th(r.warn) !== undefined ? { warn: th(r.warn) } : {}),
    ...(th(r.crit) !== undefined ? { crit: th(r.crit) } : {}),
  };
}

export type PanelSet = { panels: CustomPanel[]; tiles: Record<string, TileSettings> };

/** Panels and settings of the default dashboard (all default atoms). */
export function defaultPanelSet(): PanelSet {
  const panels: CustomPanel[] = [];
  const tiles: Record<string, TileSettings> = {};
  for (const id of DASHBOARD_WIDGET_ORDER) {
    const a = atomPanel(id);
    if (!a) continue;
    panels.push(a.panel);
    tiles[a.panel.id] = a.tile;
  }
  return { panels, tiles };
}

/** Grid of the default dashboard expressed in panel ids. */
export function defaultPanelGrid(atomIds?: readonly string[]): GridItem[] {
  return defaultAtomGrid(atomIds).map((g) => ({ ...g, id: panelIdForAtom(g.id) }));
}

const KEEP_FROM_OLD: (keyof TileSettings)[] = ["title", "showTitle", "color", "min", "max", "precision", "fixedScale"];

/**
 * v<4 -> v4: the enabled built-in atoms become ordinary panels (same slot in the grid, their title / colour / look
 * kept), custom panels are untouched. Idempotent (an atom whose panel already exists is not added twice), never throws.
 * `grid` is the v3-shaped grid (atom ids + panel ids); items of atoms that are not enabled are dropped.
 */
export function migrateLayoutToV4(input: {
  panels: readonly CustomPanel[];
  tiles: Readonly<Record<string, TileSettings>>;
  grid: readonly GridItem[];
  enabled: readonly unknown[];
}): { panels: CustomPanel[]; tiles: Record<string, TileSettings>; grid: GridItem[] } {
  try {
    const panels = input.panels.map((p) => ({ ...p }));
    const tiles: Record<string, TileSettings> = { ...input.tiles };
    const enabled = new Set(expandLegacyWidgetIds(Array.isArray(input.enabled) ? input.enabled : []));
    const known = new Set(panels.map((p) => p.id));
    const idMap = new Map<string, string>();
    for (const atomId of DASHBOARD_WIDGET_ORDER) {
      if (!enabled.has(atomId)) continue;
      const a = atomPanel(atomId);
      if (!a) continue;
      if (known.has(a.panel.id)) {
        idMap.set(atomId, a.panel.id);
        continue;
      }
      const old = input.tiles[atomId];
      const tile: TileSettings = { ...a.tile };
      if (old && typeof old === "object") {
        for (const k of KEEP_FROM_OLD) {
          // the old parser stored a 0..100 scale for every tile; it only counts when the user fixed the scale
          if ((k === "min" || k === "max") && old.fixedScale !== true) continue;
          if (old[k] !== undefined) (tile as unknown as Record<string, unknown>)[k] = old[k];
        }
        if (a.panel.kind === "metric" && typeof old.view === "string" && old.view !== "default") tile.view = old.view;
      }
      panels.push(a.panel);
      known.add(a.panel.id);
      tiles[a.panel.id] = sanitizeTile(tile, a.tile);
      idMap.set(atomId, a.panel.id);
    }
    for (const atomId of Object.keys(tiles)) if (!atomId.startsWith("custom-")) delete tiles[atomId];
    const grid: GridItem[] = [];
    const seen = new Set<string>();
    for (const g of input.grid) {
      const id = idMap.get(g.id) ?? (known.has(g.id) ? g.id : null);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      grid.push({ id, x: g.x, y: g.y, w: g.w, h: g.h });
    }
    return { panels, tiles, grid };
  } catch {
    return { panels: [], tiles: {}, grid: [] };
  }
}

/* ------------------------------------------------------------------ inserting tiles / sets */

export type TileRect = { id: string; x: number; y: number; w: number; h: number };
export type TileBundle = { panels: CustomPanel[]; tiles: Record<string, TileSettings>; rects: TileRect[] };

/**
 * Add a bundle of tiles to a layout as ordinary independent tiles. The bundle keeps its own (hole-free) arrangement
 * and is placed below everything that is already on the board. Ids are made unique with `newId`.
 */
export function insertBundle<L extends { panels: CustomPanel[]; tiles: Record<string, TileSettings>; grid?: GridItem[] }>(
  layout: L,
  bundle: TileBundle,
  newId: () => string,
  cons?: ConstraintsOf,
): L {
  const room = MAX_PANELS - layout.panels.length;
  const take = bundle.panels.slice(0, Math.max(0, room));
  const rename = new Map<string, string>();
  const used = new Set(layout.panels.map((p) => p.id));
  for (const p of take) {
    let id = newId();
    for (let guard = 0; used.has(id) && guard < 20; guard++) id = newId();
    used.add(id);
    rename.set(p.id, id);
  }
  const panels = take.map((p) => ({ ...p, id: rename.get(p.id)! }));
  const tiles: Record<string, TileSettings> = {};
  for (const p of take) if (bundle.tiles[p.id]) tiles[rename.get(p.id)!] = { ...bundle.tiles[p.id] };
  const base = compact(layout.grid ?? [], GRID_COLS, cons);
  const rects = bundle.rects.filter((r) => rename.has(r.id));
  let added: GridItem[];
  if (rects.length === 1) {
    // a single tile goes into the first free slot of the board
    const r = rects[0];
    added = [{ id: rename.get(r.id)!, w: r.w, h: r.h, ...firstFit(base, r.w, r.h) }];
  } else {
    // a set keeps its own hole-free arrangement and is placed below everything else
    const offset = bottomOf(base);
    const minY = Math.min(0, ...rects.map((r) => r.y));
    added = rects.map((r) => ({ id: rename.get(r.id)!, x: r.x, y: r.y - minY + offset, w: r.w, h: r.h }));
  }
  return {
    ...layout,
    panels: [...layout.panels, ...panels],
    tiles: { ...layout.tiles, ...tiles },
    grid: [...base, ...added],
  };
}

/* ------------------------------------------------------------------ reset to the default layout */

/** Size a tile takes when it is reset: its catalog atom, otherwise by what it shows. */
export function panelDefaultSize(panel: CustomPanel, tile: TileSettings | undefined): { w: number; h: number } {
  const a = atomDef(panel.widget ?? panel.preset ?? "");
  if (a) return { w: a.w, h: a.h };
  const k = tileKind(panel.id, tile?.view, panel.kind, panel.widget);
  return k === "chart" || k === "table" || k === "content" ? { w: 6, h: 6 } : k === "viz" ? { w: 4, h: 6 } : { w: 3, h: 4 };
}

/**
 * "Reset layout": the tiles of the default dashboard return to their default places (as a hole-free block for the
 * ones that are on the board), every other tile gets its default size and is arranged below. Pure, never throws.
 */
export function resetToDefault(
  panels: readonly CustomPanel[],
  tiles: Readonly<Record<string, TileSettings>>,
  current: readonly GridItem[],
  cons?: ConstraintsOf,
): GridItem[] {
  try {
    const defaults = new Map(DASHBOARD_WIDGET_ORDER.map((a) => [panelIdForAtom(a), a as string]));
    const present = panels.filter((p) => defaults.has(p.id) && p.preset === defaults.get(p.id));
    const base = present.length ? defaultPanelGrid(present.map((p) => defaults.get(p.id)!)) : [];
    const rest = panels.filter((p) => !present.includes(p));
    const order = new Map(current.map((g, i) => [g.id, i]));
    const others = [...rest].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    // The default block keeps its places; the other tiles are arranged among themselves (auto-arrange + gap filling)
    // and put below it, so the result has no avoidable holes.
    const extras: GridItem[] = [];
    for (const p of others) {
      const { w, h } = panelDefaultSize(p, tiles[p.id]);
      extras.push({ id: p.id, w, h, ...firstFit(extras, w, h) });
    }
    const offset = bottomOf(base);
    const arranged = autoArrange(extras, cons).map((i) => ({ ...i, y: i.y + offset }));
    const placed: GridItem[] = [...base, ...arranged];
    return compact(placed, GRID_COLS, cons);
  } catch {
    return [...current];
  }
}
