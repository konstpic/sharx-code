/**
 * Dashboard grid engine (Grafana / react-grid-layout style), pure functions only.
 *
 * Model: every tile is {id, x, y, w, h} in grid units on a 12-column grid. One row is
 * GRID_ROW_HEIGHT px, tiles are separated by GRID_GAP px, the pixel width of a column derives from the
 * container width, so the board scales smoothly. The layout is stored for the desktop (12 column)
 * breakpoint; tablet (6 columns) and phone (one column) layouts are derived from it, never stored.
 *
 * Invariants of every layout returned by `compact` / `moveItem` / `resizeItem` / `reconcile`:
 * integer coordinates, inside the grid, within the tile's min/max size, no overlap, vertically compacted
 * (nothing can float up), and `compact` is idempotent.
 *
 * Imports are relative only (vitest has no "@" alias).
 */
import { DASHBOARD_WIDGET_ORDER } from "./dashboardLayout";

export const GRID_COLS = 12;
export const TABLET_COLS = 6;
export const GRID_ROW_HEIGHT = 30;
export const GRID_GAP = 12;
/** Explicit marker written into the saved JSON next to `grid`. */
export const GRID_VERSION = 1;
export const GRID_MAX_ROWS = 400;
export const GRID_MAX_ITEMS = 200;
/** Container widths (px): <= SM single column, <= MD tablet (6 columns), else desktop. */
export const BREAKPOINT_SM = 640;
export const BREAKPOINT_MD = 760;

export type GridItem = { id: string; x: number; y: number; w: number; h: number };
export type GridConstraints = { minW: number; minH: number; maxW: number; maxH: number };
export type ConstraintsOf = (id: string) => GridConstraints;
export type Breakpoint = "lg" | "md" | "sm";
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const DEFAULT_CONSTRAINTS: GridConstraints = { minW: 1, minH: 1, maxW: GRID_COLS, maxH: GRID_MAX_ROWS };

/* ------------------------------------------------------------------ constraints */

export type TileKind = "stat" | "viz" | "chart" | "table" | "content" | "widget" | "resources";

/** Min/max size per tile kind (grid units). */
export const KIND_CONSTRAINTS: Record<TileKind, GridConstraints> = {
  stat: { minW: 2, minH: 2, maxW: 12, maxH: 40 },
  viz: { minW: 3, minH: 3, maxW: 12, maxH: 40 },
  chart: { minW: 4, minH: 4, maxW: 12, maxH: 40 },
  table: { minW: 4, minH: 3, maxW: 12, maxH: 40 },
  content: { minW: 3, minH: 3, maxW: 12, maxH: 60 },
  widget: { minW: 3, minH: 3, maxW: 12, maxH: 40 },
  resources: { minW: 6, minH: 6, maxW: 12, maxH: 40 },
};

const STAT_VIEWS = new Set(["stat", "hero", "spark", "status"]);
const VIZ_VIEWS = new Set(["gauge", "semi", "radial", "donut", "progress", "segments", "tank", "split"]);
const CHART_VIEWS = new Set(["line", "area", "bar"]);
const CHART_WIDGETS = new Set(["cpu_history", "memory_history", "user_agent"]);

/** Which constraints a tile gets, from its id, selected view and (for custom panels) the panel kind. */
export function tileKind(id: string, view?: string, panelKind?: string): TileKind {
  const v = view && view !== "default" ? view : undefined;
  if (id.startsWith("custom-")) {
    if (panelKind && panelKind !== "metric") return "content";
    if (!v) return "stat";
  }
  if (v) {
    if (STAT_VIEWS.has(v)) return "stat";
    if (VIZ_VIEWS.has(v)) return "viz";
    if (CHART_VIEWS.has(v)) return "chart";
    if (v === "table") return "table";
  }
  if (id === "resources") return "resources";
  if (CHART_WIDGETS.has(id)) return "chart";
  return id.startsWith("custom-") ? "stat" : "widget";
}

export function constraintsForKind(kind: TileKind): GridConstraints {
  return KIND_CONSTRAINTS[kind];
}

/** Constraints made consistent for a given column count (min <= max <= cols). */
export function effectiveConstraints(c: GridConstraints | undefined, cols: number): GridConstraints {
  const src = c ?? DEFAULT_CONSTRAINTS;
  const minW = Math.min(cols, Math.max(1, Math.round(src.minW) || 1));
  const minH = Math.max(1, Math.round(src.minH) || 1);
  const maxW = Math.min(cols, Math.max(minW, Math.round(src.maxW) || cols));
  const maxH = Math.max(minH, Math.min(GRID_MAX_ROWS, Math.round(src.maxH) || GRID_MAX_ROWS));
  return { minW, minH, maxW, maxH };
}

/* ------------------------------------------------------------------ basics */

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const int = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback);

export function collides(a: GridItem, b: GridItem): boolean {
  if (a.id === b.id) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function hasOverlap(items: readonly GridItem[]): boolean {
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (collides(items[i], items[j])) return true;
  return false;
}

export function bottomOf(items: readonly GridItem[]): number {
  let b = 0;
  for (const it of items) b = Math.max(b, it.y + it.h);
  return b;
}

/** Reading order: top to bottom, then left to right. Stable for ties. */
export function sortItems(items: readonly GridItem[]): GridItem[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Clamp an item into the grid and its size limits. */
export function fitItem(item: GridItem, c: GridConstraints | undefined, cols = GRID_COLS): GridItem {
  const k = effectiveConstraints(c, cols);
  const w = clamp(int(item.w, k.minW), k.minW, k.maxW);
  const h = clamp(int(item.h, k.minH), k.minH, k.maxH);
  return {
    id: item.id,
    w,
    h,
    x: clamp(int(item.x, 0), 0, cols - w),
    y: clamp(int(item.y, 0), 0, GRID_MAX_ROWS * 4),
  };
}

/** Lowest-y position for `it` given already placed items: pushed below colliders, else floated up. */
function settle(placed: readonly GridItem[], it: GridItem): GridItem {
  let y = it.y;
  for (let guard = 0; guard < placed.length + 2; guard++) {
    let next = Infinity;
    for (const p of placed) if (collides(p, { ...it, y })) next = Math.min(next, p.y + p.h);
    if (next === Infinity) break;
    y = next;
  }
  // Float up: the first obstacle is the lowest bottom edge above us among items sharing columns.
  let floor = 0;
  for (const p of placed) {
    if (p.id === it.id) continue;
    if (p.x < it.x + it.w && p.x + p.w > it.x && p.y + p.h <= y) floor = Math.max(floor, p.y + p.h);
  }
  return { ...it, y: floor };
}

function restoreOrder(original: readonly GridItem[], placed: readonly GridItem[]): GridItem[] {
  const byId = new Map(placed.map((p) => [p.id, p]));
  return original.map((o) => byId.get(o.id) ?? o);
}

/** Vertical compaction: every item floats up; overlapping items are pushed down. Idempotent. */
export function compact(items: readonly GridItem[], cols = GRID_COLS, cons?: ConstraintsOf): GridItem[] {
  const placed: GridItem[] = [];
  for (const raw of sortItems(items.map((i) => fitItem(i, cons?.(i.id), cols)))) placed.push(settle(placed, raw));
  // A second sweep is cheap insurance: reading order may change after the first one.
  const again: GridItem[] = [];
  for (const it of sortItems(placed)) again.push(settle(again, it));
  return restoreOrder(items, again);
}

/**
 * Place `moved` exactly where it is (priority), keep every other tile out of its way (pushed down, or
 * above it when it was dragged downwards past them), then compact. Deterministic for a given input,
 * so previews can be recomputed from the drag start layout on every pointer move.
 */
function placeWithPriority(
  items: readonly GridItem[],
  moved: GridItem,
  cols: number,
  cons: ConstraintsOf | undefined,
  from?: GridItem,
): GridItem[] {
  const others = sortItems(items.filter((i) => i.id !== moved.id).map((i) => fitItem(i, cons?.(i.id), cols)));
  const placed: GridItem[] = [moved];
  for (const raw of others) {
    let cand = raw;
    if (from && moved.y > from.y && collides(moved, cand)) {
      const above = Math.max(0, moved.y - cand.h);
      if (!placed.some((p) => collides(p, { ...cand, y: above }))) cand = { ...cand, y: above };
    }
    placed.push(settle(placed, cand));
  }
  const all = items.some((i) => i.id === moved.id) ? items : [...items, moved];
  return restoreOrder(all, compact(placed, cols, cons));
}

/* ------------------------------------------------------------------ move / resize / add */

export function moveItem(
  items: readonly GridItem[],
  id: string,
  x: number,
  y: number,
  cons?: ConstraintsOf,
  cols = GRID_COLS,
): GridItem[] {
  const cur = items.find((i) => i.id === id);
  if (!cur) return [...items];
  const moved = fitItem({ ...cur, x, y }, cons?.(id), cols);
  return placeWithPriority(items, moved, cols, cons, cur);
}

/** Apply a proposed rectangle (already snapped to cells) to a tile; the rest is pushed / compacted. */
export function resizeItem(
  items: readonly GridItem[],
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  cons?: ConstraintsOf,
  cols = GRID_COLS,
): GridItem[] {
  const cur = items.find((i) => i.id === id);
  if (!cur) return [...items];
  const next = fitItem({ id, ...rect }, cons?.(id), cols);
  return placeWithPriority(items, next, cols, cons);
}

/**
 * Rectangle produced by dragging `handle` by (dx, dy) grid cells from `start`. The opposite edge stays
 * anchored, sizes are clamped to min/max and to the grid. `lockAspect` keeps the start w/h ratio.
 */
export function resizeRect(
  start: GridItem,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  c?: GridConstraints,
  cols = GRID_COLS,
  lockAspect = false,
): { x: number; y: number; w: number; h: number } {
  const k = effectiveConstraints(c, cols);
  const hasE = handle.includes("e");
  const hasW = handle.includes("w");
  const hasS = handle.includes("s");
  const hasN = handle.includes("n");
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let w = start.w + (hasE ? dx : hasW ? -dx : 0);
  let h = start.h + (hasS ? dy : hasN ? -dy : 0);
  if (lockAspect && start.w > 0 && start.h > 0) {
    const horizontal = hasE || hasW;
    const vertical = hasS || hasN;
    if (horizontal && vertical) {
      const sx = w / start.w;
      const sy = h / start.h;
      const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      w = Math.round(start.w * s);
      h = Math.round(start.h * s);
    } else if (horizontal) h = Math.round((w * start.h) / start.w);
    else w = Math.round((h * start.w) / start.h);
  }
  const maxWAvail = hasW ? right : cols - start.x;
  const maxHAvail = hasN ? bottom : GRID_MAX_ROWS;
  w = clamp(Math.round(w), k.minW, Math.min(k.maxW, Math.max(k.minW, maxWAvail)));
  h = clamp(Math.round(h), k.minH, Math.min(k.maxH, Math.max(k.minH, maxHAvail)));
  const x = hasW ? right - w : start.x;
  const y = hasN ? bottom - h : start.y;
  return { x: Math.max(0, x), y: Math.max(0, y), w, h };
}

/** First free (y, x) slot of size w x h, scanning rows top to bottom (like CSS `grid-auto-flow: dense`). */
export function firstFit(items: readonly GridItem[], w: number, h: number, cols = GRID_COLS): { x: number; y: number } {
  const ww = clamp(Math.round(w), 1, cols);
  const hh = Math.max(1, Math.round(h));
  const limit = bottomOf(items);
  for (let y = 0; y <= limit; y++) {
    for (let x = 0; x + ww <= cols; x++) {
      const probe: GridItem = { id: "\u0000probe", x, y, w: ww, h: hh };
      if (!items.some((p) => collides(p, probe))) return { x, y };
    }
  }
  return { x: 0, y: limit };
}

/** Insert a tile at its desired position, pushing others away (new custom panels go top-left). */
export function addItem(items: readonly GridItem[], item: GridItem, cons?: ConstraintsOf, cols = GRID_COLS): GridItem[] {
  const base = items.filter((i) => i.id !== item.id);
  return placeWithPriority(base, fitItem(item, cons?.(item.id), cols), cols, cons);
}

export function removeItem(items: readonly GridItem[], id: string, cons?: ConstraintsOf, cols = GRID_COLS): GridItem[] {
  return compact(
    items.filter((i) => i.id !== id),
    cols,
    cons,
  );
}

/* ------------------------------------------------------------------ reconcile with visible tiles */

export type ReconcileOptions = {
  /** Size for tiles that have no stored position. */
  defaultSize: (id: string) => { w: number; h: number };
  constraints?: ConstraintsOf;
  /** Tiles that enter at the top-left (new custom panels) instead of the first free slot. */
  top?: (id: string) => boolean;
  cols?: number;
};

/**
 * The layout actually shown: stored positions for the visible ids (in the given order), clamped to
 * the current constraints, new ids inserted, overlaps resolved and compacted. Stored positions of
 * hidden tiles are ignored; unknown / duplicate ids dropped.
 */
export function reconcile(stored: readonly GridItem[] | undefined, ids: readonly string[], opts: ReconcileOptions): GridItem[] {
  const cols = opts.cols ?? GRID_COLS;
  const wanted = [...new Set(ids)];
  const byId = new Map<string, GridItem>();
  for (const it of stored ?? []) if (!byId.has(it.id)) byId.set(it.id, it);
  let layout: GridItem[] = compact(
    wanted.filter((id) => byId.has(id)).map((id) => byId.get(id)!),
    cols,
    opts.constraints,
  );
  for (const id of wanted) {
    if (byId.has(id)) continue;
    const size = opts.defaultSize(id);
    const c = effectiveConstraints(opts.constraints?.(id), cols);
    const w = clamp(size.w, c.minW, c.maxW);
    const h = clamp(size.h, c.minH, c.maxH);
    if (opts.top?.(id)) layout = addItem(layout, { id, x: 0, y: 0, w, h }, opts.constraints, cols);
    else {
      const slot = firstFit(layout, w, h, cols);
      layout = [...layout, { id, w, h, ...slot }];
    }
  }
  return wanted.map((id) => layout.find((i) => i.id === id)!);
}

/* ------------------------------------------------------------------ breakpoints */

export function breakpointForWidth(px: number): Breakpoint {
  if (px <= BREAKPOINT_SM) return "sm";
  if (px <= BREAKPOINT_MD) return "md";
  return "lg";
}

export function columnsFor(bp: Breakpoint): number {
  return bp === "md" ? TABLET_COLS : GRID_COLS;
}

/**
 * Layout for a smaller breakpoint, derived from the desktop one (stable ordering by y, then x).
 * sm: one column (every tile is full width, w = 12 of 12), md: 6 columns, widths halved (rounded up).
 */
export function deriveLayout(items: readonly GridItem[], bp: Breakpoint, cons?: ConstraintsOf): GridItem[] {
  if (bp === "lg") return items.map((i) => ({ ...i }));
  const order = sortItems(items);
  if (bp === "sm") {
    let y = 0;
    const out = order.map((i) => {
      const k = effectiveConstraints(cons?.(i.id), GRID_COLS);
      const h = clamp(i.h, k.minH, k.maxH);
      const placed = { id: i.id, x: 0, y, w: GRID_COLS, h };
      y += h;
      return placed;
    });
    return restoreOrder(items, out);
  }
  const mapped = order.map((i) => {
    const w = Math.min(TABLET_COLS, Math.max(1, Math.ceil(i.w / 2)));
    return { id: i.id, w, h: i.h, y: i.y, x: Math.min(Math.floor(i.x / 2), TABLET_COLS - w) };
  });
  return restoreOrder(items, compact(mapped, TABLET_COLS));
}

/* ------------------------------------------------------------------ serialize / parse / validate */

export type SerializedGrid = { gridVersion: typeof GRID_VERSION; grid: GridItem[] };

export function serializeGrid(items: readonly GridItem[]): SerializedGrid {
  return { gridVersion: GRID_VERSION, grid: items.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })) };
}

/** True when ints, inside the grid, within limits and without overlap. */
export function validateGrid(items: readonly GridItem[], cols = GRID_COLS, cons?: ConstraintsOf): boolean {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    if (![it.x, it.y, it.w, it.h].every(Number.isInteger)) return false;
    if (it.x < 0 || it.y < 0 || it.w < 1 || it.h < 1 || it.x + it.w > cols) return false;
    const k = effectiveConstraints(cons?.(it.id), cols);
    if (it.w < k.minW || it.w > k.maxW || it.h < k.minH || it.h > k.maxH) return false;
  }
  return !hasOverlap(items);
}

/**
 * Sanitise a stored array of positions: bad entries are skipped, duplicates and (when `ids` is given)
 * unknown ids dropped, numbers rounded and clamped. Overlaps are NOT resolved here (hidden tiles may
 * legitimately overlap visible ones); `reconcile` does that for the tiles actually shown.
 * Returns null when nothing usable is left.
 */
export function parseGrid(raw: unknown, opts: { ids?: readonly string[]; constraints?: ConstraintsOf; cols?: number } = {}): GridItem[] | null {
  if (!Array.isArray(raw)) return null;
  const cols = opts.cols ?? GRID_COLS;
  const allowed = opts.ids ? new Set(opts.ids) : null;
  const out: GridItem[] = [];
  const seen = new Set<string>();
  for (const e of raw.slice(0, GRID_MAX_ITEMS * 2)) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || r.id.length > 100 || seen.has(r.id)) continue;
    if (allowed && !allowed.has(r.id)) continue;
    if (![r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    if ((r.w as number) < 1 || (r.h as number) < 1) continue;
    seen.add(r.id);
    out.push(fitItem({ id: r.id, x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number }, opts.constraints?.(r.id), cols));
    if (out.length >= GRID_MAX_ITEMS) break;
  }
  return out.length ? out : null;
}

/** Parse `{gridVersion, grid}` from a saved layout object; null unless the marker matches. */
export function parseGridState(data: unknown, opts: { ids?: readonly string[]; constraints?: ConstraintsOf } = {}): GridItem[] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { gridVersion?: unknown; grid?: unknown };
  if (d.gridVersion !== GRID_VERSION) return null;
  return parseGrid(d.grid, opts);
}

/* ------------------------------------------------------------------ legacy layouts */

/** Default tile sizes of the built-in widgets (grid units), the shape of the former default dashboard. */
const WIDGET_SIZES: Record<string, { w: number; h: number }> = {
  resources: { w: 12, h: 12 },
  logs: { w: 4, h: 6 },
  core_versions: { w: 4, h: 7 },
  backup: { w: 4, h: 6 },
  uptime: { w: 6, h: 6 },
  users_online: { w: 6, h: 5 },
  user_agent: { w: 6, h: 9 },
  database: { w: 6, h: 7 },
  net_speed: { w: 6, h: 7 },
  net_traffic: { w: 6, h: 6 },
  net_sockets: { w: 6, h: 6 },
  server_ip: { w: 6, h: 5 },
  panel_runtime: { w: 6, h: 6 },
  telemt_dc: { w: 12, h: 8 },
  cpu_history: { w: 6, h: 8 },
  memory_history: { w: 6, h: 8 },
};

export function defaultGridSize(id: string): { w: number; h: number } {
  return WIDGET_SIZES[id] ?? { w: 6, h: 8 };
}

/** Old row unit: 40px rows with a 16px gap. New: GRID_ROW_HEIGHT rows with GRID_GAP. */
export function legacyHeightToRows(oldRows: number): number {
  const px = oldRows * 40 + (oldRows - 1) * 16;
  return Math.max(1, Math.round((px + GRID_GAP) / (GRID_ROW_HEIGHT + GRID_GAP)));
}

type LegacyTile = { width?: unknown; height?: unknown };
export type LegacyLayoutLike = { order?: unknown; tiles?: unknown };

function legacySize(id: string, tiles: Record<string, LegacyTile>): { w: number; h: number } {
  const t = tiles[id];
  if (t && typeof t === "object") {
    const ow = typeof t.width === "number" && Number.isFinite(t.width) ? Math.round(t.width) : null;
    const oh = typeof t.height === "number" && Number.isFinite(t.height) ? Math.round(t.height) : null;
    if (ow != null || oh != null) {
      const d = defaultGridSize(id);
      return { w: ow != null ? clamp(ow, 1, GRID_COLS) : d.w, h: oh != null ? legacyHeightToRows(clamp(oh, 1, 60)) : d.h };
    }
  }
  return defaultGridSize(id);
}

/**
 * Convert the old model (`order` + per-tile width in 12ths / height in 56px rows) into grid positions.
 * Tiles are flowed in the old order with first-fit placement (what `grid-auto-flow: row dense` did),
 * old widths are kept, old heights converted by pixel height, unconfigured tiles get the default sizes.
 * Never throws: anything unreadable falls back to defaults.
 */
export function legacyToGrid(
  legacy: LegacyLayoutLike | null | undefined,
  ids: readonly string[],
  constraints?: ConstraintsOf,
): GridItem[] {
  try {
    const want = [...new Set(ids)];
    const tiles = legacy && typeof legacy.tiles === "object" && legacy.tiles ? (legacy.tiles as Record<string, LegacyTile>) : {};
    const order = Array.isArray(legacy?.order) ? (legacy!.order as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const sequence = [...new Set([...order.filter((x) => want.includes(x)), ...want])];
    const out: GridItem[] = [];
    for (const id of sequence) {
      const size = legacySize(id, tiles);
      const c = effectiveConstraints(constraints?.(id), GRID_COLS);
      const w = clamp(size.w, c.minW, c.maxW);
      const h = clamp(size.h, c.minH, c.maxH);
      out.push({ id, w, h, ...firstFit(out, w, h) });
    }
    return out;
  } catch {
    return defaultGrid(ids);
  }
}

/** Default positions for a set of ids, flowed in the given order. */
export function defaultGrid(ids: readonly string[]): GridItem[] {
  const out: GridItem[] = [];
  for (const id of new Set(ids)) {
    const { w, h } = defaultGridSize(id);
    out.push({ id, w, h, ...firstFit(out, w, h) });
  }
  return out;
}

export function defaultBuiltinGrid(): GridItem[] {
  return defaultGrid(DASHBOARD_WIDGET_ORDER);
}
