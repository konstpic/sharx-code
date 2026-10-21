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
import { LEGACY_COMPOSITE_IDS, LEGACY_WIDGET_SPLIT, atomDef, isLegacyCompositeId, type AtomKind } from "./dashboardLayout";

export const GRID_COLS = 12;
export const TABLET_COLS = 6;
export const GRID_ROW_HEIGHT = 30;
export const GRID_GAP = 12;
/** Explicit marker written into the saved JSON next to `grid`. */
/**
 * 1 = composite tiles, 2 = atomic tiles, 3 = atoms + one-time auto-arrange and new minimum sizes (telemt_dc),
 * 4 = one tile model: every tile is a panel (`custom-*`), built-in atoms are presets of it.
 */
export const GRID_VERSION = 4;
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

export type TileKind = "stat" | "viz" | "chart" | "table" | "content" | "widget" | "action" | "telemt";

/** Min/max size per tile kind (grid units). Gauges and stats are at least 2x3, charts and tables 4x4. */
export const KIND_CONSTRAINTS: Record<TileKind, GridConstraints> = {
  stat: { minW: 2, minH: 3, maxW: 12, maxH: 40 },
  viz: { minW: 2, minH: 3, maxW: 12, maxH: 40 },
  chart: { minW: 4, minH: 4, maxW: 12, maxH: 40 },
  table: { minW: 4, minH: 4, maxW: 12, maxH: 40 },
  content: { minW: 3, minH: 3, maxW: 12, maxH: 60 },
  widget: { minW: 3, minH: 3, maxW: 12, maxH: 40 },
  action: { minW: 2, minH: 2, maxW: 12, maxH: 40 },
  /** Telemt DC card: full width, never smaller than 12x7 (6x5 or more on the 6 column tablet board). */
  telemt: { minW: 12, minH: 7, maxW: 12, maxH: 60 },
};

const STAT_VIEWS = new Set(["stat", "hero", "spark", "status"]);
const VIZ_VIEWS = new Set(["gauge", "semi", "radial", "donut", "progress", "segments", "tank", "split"]);
const CHART_VIEWS = new Set(["line", "area", "bar"]);
const ATOM_KIND: Record<AtomKind, TileKind> = { stat: "stat", viz: "viz", chart: "chart", table: "table", action: "action", widget: "widget" };

/**
 * Which constraints a tile gets, from its id, selected view, the panel kind and (for `widget` panels) the
 * widget id. Tiles are panels (`custom-*`); the bare atom ids are only used by old (v<4) layouts.
 */
export function tileKind(id: string, view?: string, panelKind?: string, widget?: string): TileKind {
  const v = view && view !== "default" ? view : undefined;
  if (panelKind === "widget" || widget) {
    const w = widget ?? id;
    if (w === "telemt_dc") return "telemt";
    const a = atomDef(w);
    return a ? ATOM_KIND[a.kind] : "widget";
  }
  if (id.startsWith("custom-")) {
    if (panelKind && panelKind !== "metric") return "content";
    if (!v) return "stat";
  }
  if (id === "telemt_dc") return "telemt";
  const atom = atomDef(id);
  // An old-style atom id takes the constraints of its own kind until another look is picked.
  if (atom && !v) return ATOM_KIND[atom.kind];
  if (v) {
    if (STAT_VIEWS.has(v)) return "stat";
    if (VIZ_VIEWS.has(v)) return "viz";
    if (CHART_VIEWS.has(v)) return "chart";
    if (v === "table") return "table";
  }
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
  // Always end with a normalisation pass (clamp, resolve collisions, vertical compaction): inserted
  // tiles and stale stored positions must never leave overlaps or vertical holes behind.
  layout = compact(layout, cols, opts.constraints);
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
export function deriveLayout(
  items: readonly GridItem[],
  bp: Breakpoint,
  cons?: ConstraintsOf,
  opts: {
    boardWidth?: number;
    capHeight?: (id: string) => boolean;
    /** hard row limit of tall tiles on the phone layout (may go below the minimum height) */
    maxRows?: (id: string) => number | undefined;
    /** Phone layout of tiles that stack their own content (classic v2.6 cards): always one column, `rows` high. */
    phone?: (id: string) => { full?: boolean; rows?: number } | undefined;
  } = {},
): GridItem[] {
  if (bp === "lg") return items.map((i) => ({ ...i }));
  const order = sortItems(items);
  if (bp === "sm") {
    // Phone: narrow tiles (4 columns or less of 12) go two per row, everything else gets the full width.
    // Stat-like tiles are not taller than 0.6 x their width.
    const colW = opts.boardWidth && opts.boardWidth > 0 ? (opts.boardWidth - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS : 0;
    const phoneCons: ConstraintsOf = (id) => {
      const c = effectiveConstraints(cons?.(id), GRID_COLS);
      const m = opts.maxRows?.(id);
      return m ? { ...c, minH: Math.min(c.minH, m), maxH: Math.min(c.maxH, m) } : c;
    };
    const narrow = order.map((i) => {
      const k = phoneCons(i.id);
      const ph = opts.phone?.(i.id);
      const w = ph?.full || i.w > 4 ? GRID_COLS : GRID_COLS / 2;
      let h = clamp(ph?.rows ?? i.h, k.minH, k.maxH);
      if (colW > 0 && opts.capHeight?.(i.id)) {
        const px = w * colW + (w - 1) * GRID_GAP;
        h = clamp(h, k.minH, Math.max(k.minH, Math.floor((px * 0.6 + GRID_GAP) / (GRID_ROW_HEIGHT + GRID_GAP))));
      }
      return { id: i.id, x: 0, y: 0, w, h };
    });
    return restoreOrder(items, reflow(narrow, GRID_COLS, phoneCons, GRID_COLS));
  }
  return restoreOrder(items, reflow(order, TABLET_COLS, cons, GRID_COLS));
}

/**
 * Re-flow tiles in reading order into `cols` columns without holes: tiles are packed into shelves (rows),
 * each shelf is justified to the full width and its tiles get the height of the tallest one. Used for the
 * tablet breakpoint and for one-time migrations; it keeps the reading order, never overlaps and leaves
 * no empty cells inside the board.
 */
export function reflow(items: readonly GridItem[], cols: number, cons?: ConstraintsOf, fromCols = GRID_COLS): GridItem[] {
  const order = sortItems(items);
  const out: GridItem[] = [];
  let y = 0;
  let shelf: { id: string; w: number; h: number; c: GridConstraints }[] = [];
  let used = 0;
  const flush = () => {
    if (!shelf.length) return;
    let left = cols - used;
    for (let guard = 0; left > 0 && guard < cols * 2; guard++) {
      let progressed = false;
      for (let i = shelf.length - 1; i >= 0 && left > 0; i--) {
        if (shelf[i].w < Math.min(cols, shelf[i].c.maxW)) {
          shelf[i].w++;
          left--;
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    const height = Math.max(...shelf.map((s) => s.h));
    let x = 0;
    for (const s of shelf) {
      out.push({ id: s.id, x, y, w: s.w, h: clamp(height, s.c.minH, s.c.maxH) });
      x += s.w;
    }
    y += height;
    shelf = [];
    used = 0;
  };
  for (const it of order) {
    const c = effectiveConstraints(cons?.(it.id), cols);
    const w = clamp(Math.round((it.w * cols) / fromCols), c.minW, Math.min(c.maxW, cols));
    if (used + w > cols) flush();
    shelf.push({ id: it.id, w, h: clamp(it.h, c.minH, c.maxH), c });
    used += w;
  }
  flush();
  return out;
}

/** Cells that are empty although something sits below them in the same column (a vertical hole). */
export function holeCount(items: readonly GridItem[], cols = GRID_COLS): number {
  const rows = bottomOf(items);
  const taken = new Set<number>();
  for (const it of items) for (let yy = it.y; yy < it.y + it.h; yy++) for (let xx = it.x; xx < it.x + it.w; xx++) taken.add(yy * cols + xx);
  let holes = 0;
  for (let x = 0; x < cols; x++) {
    let seenBelow = false;
    for (let yy = rows - 1; yy >= 0; yy--) {
      if (taken.has(yy * cols + x)) seenBelow = true;
      else if (seenBelow) holes++;
    }
  }
  return holes;
}

/** Empty cells inside the bounding box of the layout (0 = every row is completely filled). */
export function emptyCellCount(items: readonly GridItem[], cols = GRID_COLS): number {
  const rows = bottomOf(items);
  const taken = new Set<number>();
  for (const it of items) for (let yy = it.y; yy < it.y + it.h; yy++) for (let xx = it.x; xx < it.x + it.w; xx++) taken.add(yy * cols + xx);
  return rows * cols - taken.size;
}

/**
 * Close horizontal gaps without touching heights: an empty run in a row is closed by widening the nearest
 * neighbour (left first, otherwise right) as far as its maximum width and the free cells in its own rows
 * allow. Repeats until nothing changes. Never overlaps.
 */
export function fillGaps(items: readonly GridItem[], cons?: ConstraintsOf, cols = GRID_COLS): GridItem[] {
  const list = items.map((i) => ({ ...i }));
  for (let pass = 0; pass < 400; pass++) {
    const rows = bottomOf(list);
    const grid = new Map<number, GridItem>();
    for (const it of list) for (let yy = it.y; yy < it.y + it.h; yy++) for (let xx = it.x; xx < it.x + it.w; xx++) grid.set(yy * cols + xx, it);
    const free = (xx: number, yy: number) => xx >= 0 && xx < cols && !grid.has(yy * cols + xx);
    const room = (it: GridItem) => effectiveConstraints(cons?.(it.id), cols).maxW - it.w;
    let changed = false;
    scan: for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!free(x, y)) continue;
        let x1 = x;
        while (free(x1, y)) x1++;
        const left = x > 0 ? grid.get(y * cols + x - 1) : undefined;
        const right = x1 < cols ? grid.get(y * cols + x1) : undefined;
        const gap = x1 - x;
        if (left && left.x + left.w === x) {
          let k = Math.min(gap, room(left));
          while (k > 0) {
            let ok = true;
            for (let yy = left.y; yy < left.y + left.h && ok; yy++) for (let xx = x; xx < x + k; xx++) if (!free(xx, yy)) ok = false;
            if (ok) break;
            k--;
          }
          if (k > 0) {
            left.w += k;
            changed = true;
            break scan;
          }
        }
        if (right && right.x === x1) {
          let k = Math.min(gap, room(right));
          while (k > 0) {
            let ok = true;
            for (let yy = right.y; yy < right.y + right.h && ok; yy++) for (let xx = x1 - k; xx < x1; xx++) if (!free(xx, yy)) ok = false;
            if (ok) break;
            k--;
          }
          if (k > 0) {
            right.x -= k;
            right.w += k;
            changed = true;
            break scan;
          }
        }
        x = x1;
      }
    }
    if (!changed) break;
  }
  return list;
}

/**
 * Remove a tile without leaving a hole: neighbours in its rows are widened into the freed space (left first,
 * up to their maximum width), tiles outside those rows are not touched, then the board is compacted.
 */
export function removeAndFill(items: readonly GridItem[], id: string, cons?: ConstraintsOf, cols = GRID_COLS): GridItem[] {
  const gone = items.find((i) => i.id === id);
  const rest = items.filter((i) => i.id !== id);
  if (!gone) return compact(rest, cols, cons);
  const filled = fillGaps(compact(rest, cols, cons), cons, cols);
  const before = new Map(rest.map((i) => [i.id, i]));
  const rows = (i: GridItem) => i.y < gone.y + gone.h && i.y + i.h > gone.y;
  const kept = filled.map((i) => {
    const o = before.get(i.id);
    return o && !rows(i) && (o.x !== i.x || o.w !== i.w) ? { ...i, x: o.x, w: o.w } : i;
  });
  return compact(kept, cols, cons);
}

/**
 * Auto-arrange: tile heights are kept. Tiles are re-packed (several candidate orders are tried, reading
 * order wins ties), each into the lowest-leftmost free slot, minimum sizes applied, then horizontal gaps are
 * closed by widening neighbours (`fillGaps`). No overlaps; with equal-height tiles the result has 0 empty
 * cells, otherwise only the ragged bottom edge can stay empty.
 */
export function autoArrange(raw: readonly GridItem[], cons?: ConstraintsOf, cols = GRID_COLS): GridItem[] {
  const items = raw.filter((i) => i && typeof i === "object" && typeof i.id === "string");
  const fitted = compact(items, cols, cons);
  const reading = sortItems(fitted);
  const orders = [reading, [...reading].sort((a, b) => b.h - a.h), [...reading].sort((a, b) => a.h - b.h)];
  let best: GridItem[] | null = null;
  let bestScore = Infinity;
  for (const order of orders) {
    const placed: GridItem[] = [];
    for (const it of order) placed.push({ ...it, ...firstFit(placed, it.w, it.h, cols) });
    const filled = compact(fillGaps(compact(placed, cols, cons), cons, cols), cols, cons);
    const score = emptyCellCount(filled, cols) + holeCount(filled, cols) * 1000;
    if (score < bestScore) {
      best = filled;
      bestScore = score;
    }
  }
  const base = emptyCellCount(fitted, cols) + holeCount(fitted, cols) * 1000;
  return restoreOrder(items, best && bestScore <= base ? best : fillGaps(fitted, cons, cols));
}

/** Compact; if empty cells remain inside the board (tiles of different widths), re-flow it hole-free. For generated layouts only. */
export function tidyGrid(items: readonly GridItem[], cons?: ConstraintsOf): GridItem[] {
  const packed = compact(items, GRID_COLS, cons);
  return holeCount(packed) > 0 ? compact(reflow(packed, GRID_COLS, cons, GRID_COLS), GRID_COLS, cons) : packed;
}

/** Normalisation applied to every loaded layout: clamp -> resolve collisions -> vertical compaction. */
export const normalizeGrid = compact;

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

/* ------------------------------------------------------------------ default sizes / default layout */

/** Sizes of the former composite tiles (grid v1); only used to read and migrate old layouts. */
const LEGACY_SIZES: Record<string, { w: number; h: number }> = {
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

/** Order of the grid v1 dashboard (composite ids). */
export const LEGACY_V1_ORDER = [
  "resources", "logs", "core_versions", "backup", "uptime", "users_online", "user_agent", "database",
  "net_speed", "net_traffic", "net_sockets", "server_ip", "panel_runtime", "telemt_dc", "cpu_history", "memory_history",
] as const;

/** Size a tile had in grid v1 (also for ids that are atoms today, e.g. `logs` was 4x6 then). */
function legacyDefaultSize(id: string): { w: number; h: number } {
  return LEGACY_SIZES[id] ?? defaultGridSize(id);
}

export function defaultGridSize(id: string): { w: number; h: number } {
  const atom = atomDef(id);
  if (atom) return { w: atom.w, h: atom.h };
  return LEGACY_SIZES[id] ?? { w: 6, h: 6 };
}

/**
 * The default dashboard: [id, x, y, w, h]. A tight overview that fits the first screens:
 * KPI gauges, availability / load / users / DB pool, two history charts, network, system, cores,
 * logs and backup, details, user agents and the Telemt DC card.
 */
const DEFAULT_ATOM_RECTS: readonly (readonly [string, number, number, number, number])[] = [
  ["cpu_gauge", 0, 0, 3, 4], ["ram_gauge", 3, 0, 3, 4], ["disk_gauge", 6, 0, 3, 4], ["swap_gauge", 9, 0, 3, 4],
  ["nodes_availability", 0, 4, 3, 4], ["load_average", 3, 4, 3, 4], ["users_online", 6, 4, 3, 4], ["db_pool", 9, 4, 3, 4],
  ["cpu_history", 0, 8, 6, 6], ["memory_history", 6, 8, 6, 6],
  ["net_up", 0, 14, 3, 4], ["net_down", 3, 14, 3, 4], ["net_total_sent", 6, 14, 3, 4], ["net_total_received", 9, 14, 3, 4],
  ["net_tcp", 0, 18, 3, 4], ["net_udp", 3, 18, 3, 4], ["panel_uptime", 6, 18, 3, 4], ["os_uptime", 9, 18, 3, 4],
  ["xray_version", 0, 22, 3, 4], ["telemt_version", 3, 22, 3, 4], ["nodes_cores", 6, 22, 3, 4], ["xray_uptime", 9, 22, 3, 4],
  ["logs", 0, 26, 3, 4], ["backup_export", 3, 26, 3, 4], ["backup_import", 6, 26, 3, 4], ["backup_config", 9, 26, 3, 4],
  ["core_update", 0, 30, 3, 4], ["core_controls", 3, 30, 3, 4], ["server_ip", 6, 30, 6, 4],
  ["db_size", 0, 34, 3, 4], ["db_tables", 3, 34, 3, 4], ["user_agent", 6, 34, 6, 8],
  ["db_rows", 0, 38, 3, 4], ["panel_threads", 3, 38, 3, 4],
  ["panel_memory", 0, 42, 4, 4], ["panel_cores", 4, 42, 4, 4], ["panel_frequency", 8, 42, 4, 4],
  ["telemt_dc", 0, 46, 12, 12],
];

function atomConstraints(id: string): GridConstraints {
  return constraintsForKind(tileKind(id));
}

/**
 * Default positions of the atoms. All of them: the hand-composed layout above (every row is full, 0 empty
 * cells). A subset (hidden by permissions / node mode / the picker): the same reading order re-flowed so the
 * rows are still full and the board has no holes.
 */
export function defaultAtomGrid(ids?: readonly string[]): GridItem[] {
  const all = DEFAULT_ATOM_RECTS.map(([id, x, y, w, h]) => ({ id, x, y, w, h }));
  const want = ids ? new Set(ids) : null;
  if (!want || all.every((i) => want.has(i.id))) return compact(all, GRID_COLS, atomConstraints);
  const subset = all.filter((i) => want.has(i.id));
  return compact(reflow(compact(subset, GRID_COLS, atomConstraints), GRID_COLS, atomConstraints, GRID_COLS), GRID_COLS, atomConstraints);
}

/** Which ready-made arrangement a board is built from: the v2.6 look ('classic'), the v2.7.1 dashboard ('v271') or the tile grid of v2.8+ ('modern'). */
export type DashboardPreset = "classic" | "v271" | "modern" | BoardPresetId;
/** Ready-made board presets besides the three above (registry: dashboardPresets.ts). Kept here so the marker union and its guard stay in one low-level module. */
export const BOARD_PRESET_IDS = ["noc", "minimal", "network", "infra", "clients", "telemt", "neon", "soft", "phone"] as const;
export type BoardPresetId = (typeof BOARD_PRESET_IDS)[number];
/**
 * Arrangement used when the user has NO saved dashboard (fresh install / never customised) and by "Reset layout"
 * of a board without a marker of its own. Saved boards are never changed by this constant.
 */
export const DEFAULT_DASHBOARD_PRESET: DashboardPreset = "classic";
export const isDashboardPreset = (v: unknown): v is DashboardPreset => v === "classic" || v === "v271" || v === "modern" || (typeof v === "string" && (BOARD_PRESET_IDS as readonly string[]).includes(v));

/**
 * The classic v2.6 dashboard: [atom id, x, y, w, h]. Resources full width; the four cards of the v2.6
 * `lg:grid-cols-4` row (logs, cores, backup, uptime) 3 columns each with equal heights; then users online, the Telemt DC
 * card, user agents, database, panel process and network, each full width, in the order of the v2.6 page.
 */
export const CLASSIC_ATOM_RECTS: readonly (readonly [string, number, number, number, number])[] = [
  ["classic_resources", 0, 0, 12, 11],
  ["classic_logs", 0, 11, 3, 6], ["classic_cores", 3, 11, 3, 6], ["classic_backup", 6, 11, 3, 6], ["classic_uptime", 9, 11, 3, 6],
  ["classic_users_online", 0, 17, 12, 5],
  ["telemt_dc", 0, 22, 12, 12],
  ["classic_user_agent", 0, 34, 12, 7],
  ["classic_database", 0, 41, 12, 4],
  ["classic_runtime", 0, 45, 12, 5],
  ["classic_network", 0, 50, 12, 16],
];
export const CLASSIC_ATOM_ORDER: readonly string[] = CLASSIC_ATOM_RECTS.map((r) => r[0]);

/** Positions of the classic tiles (atom ids). A subset (permissions, node mode) is re-flowed in the same reading order without holes. */
export function classicAtomGrid(ids?: readonly string[]): GridItem[] {
  const all = CLASSIC_ATOM_RECTS.map(([id, x, y, w, h]) => ({ id, x, y, w, h }));
  const want = ids ? new Set(ids) : null;
  if (!want || all.every((i) => want.has(i.id))) return compact(all, GRID_COLS, atomConstraints);
  const subset = all.filter((i) => want.has(i.id));
  return compact(reflow(compact(subset, GRID_COLS, atomConstraints), GRID_COLS, atomConstraints, GRID_COLS), GRID_COLS, atomConstraints);
}

/**
 * The v2.7.1 dashboard: [atom id, x, y, w, h]. It is the result of the CSS grid of 2.7.1 (`repeat(12, 1fr)`, `grid-auto-flow: row dense`,
 * tile widths resources / telemt_dc 12, logs / core versions / backup 4, the rest 6) filled in the order of its widgets:
 * resources; logs | core versions | backup; uptime | users online; user agents | database; net speed | net traffic;
 * sockets | server IP; panel runtime | CPU history (dense flow fills the half row left by the 12 wide Telemt DC card);
 * Telemt DC; memory history. In 2.7.1 the memory history stood alone in a half row; here it takes the full width so
 * that the board has no hole. Heights are the content heights of the tiles (see the atoms in dashboardLayout.ts).
 */
export const V271_ATOM_RECTS: readonly (readonly [string, number, number, number, number])[] = [
  ["v271_resources", 0, 0, 12, 10],
  ["v271_logs", 0, 10, 4, 7], ["v271_core_versions", 4, 10, 4, 7], ["v271_backup", 8, 10, 4, 7],
  ["v271_uptime", 0, 17, 6, 7], ["v271_users_online", 6, 17, 6, 7],
  ["v271_user_agent", 0, 24, 6, 7], ["v271_database", 6, 24, 6, 7],
  ["v271_net_speed", 0, 31, 6, 6], ["v271_net_traffic", 6, 31, 6, 6],
  ["v271_net_sockets", 0, 37, 6, 7], ["v271_server_ip", 6, 37, 6, 7],
  ["v271_panel_runtime", 0, 44, 6, 7], ["v271_cpu_history", 6, 44, 6, 7],
  ["telemt_dc", 0, 51, 12, 12],
  ["v271_memory_history", 0, 63, 12, 6],
];
export const V271_ATOM_ORDER: readonly string[] = V271_ATOM_RECTS.map((r) => r[0]);

/** Positions of the v2.7.1 tiles (atom ids). A subset (permissions, node mode) is re-flowed in the same reading order without holes. */
export function v271AtomGrid(ids?: readonly string[]): GridItem[] {
  const all = V271_ATOM_RECTS.map(([id, x, y, w, h]) => ({ id, x, y, w, h }));
  const want = ids ? new Set(ids) : null;
  if (!want || all.every((i) => want.has(i.id))) return compact(all, GRID_COLS, atomConstraints);
  const subset = all.filter((i) => want.has(i.id));
  return compact(reflow(compact(subset, GRID_COLS, atomConstraints), GRID_COLS, atomConstraints, GRID_COLS), GRID_COLS, atomConstraints);
}

/** Default positions for a set of ids, flowed in the given order (unknown ids get a default size). */
export function defaultGrid(ids: readonly string[]): GridItem[] {
  const out: GridItem[] = [];
  for (const id of new Set(ids)) {
    const { w, h } = defaultGridSize(id);
    out.push({ id, w, h, ...firstFit(out, w, h) });
  }
  return out;
}

export function defaultBuiltinGrid(): GridItem[] {
  return defaultAtomGrid();
}

/** The default dashboard with custom panels kept on top (their relative positions are preserved). */
export function defaultGridKeeping(custom: readonly GridItem[], cons?: ConstraintsOf, ids?: readonly string[]): GridItem[] {
  const top = custom.length ? compact(custom, GRID_COLS, cons) : [];
  const offset = bottomOf(top);
  return [...top, ...defaultAtomGrid(ids).map((i) => ({ ...i, y: i.y + offset }))];
}

/* ------------------------------------------------------------------ legacy layouts */

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
      const d = legacyDefaultSize(id);
      return { w: ow != null ? clamp(ow, 1, GRID_COLS) : d.w, h: oh != null ? legacyHeightToRows(clamp(oh, 1, 60)) : d.h };
    }
  }
  return legacyDefaultSize(id);
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

/* ------------------------------------------------------------------ migration: composite tiles -> atoms */

/**
 * True when the stored built-in tiles are what the former automatic default produced (never customised):
 * every one has its default size and they read in the default order (their exact positions may differ because
 * custom panels were added on top, or some widgets were switched off).
 */
export function isLegacyDefaultGrid(items: readonly GridItem[]): boolean {
  const legacy = new Set<string>(LEGACY_V1_ORDER);
  const stored = items.filter((i) => legacy.has(i.id) && isLegacyCompositeOrLegacyId(i.id));
  if (!stored.length) return false;
  if (!stored.some((i) => isLegacyCompositeId(i.id))) return false;
  if (stored.some((i) => {
    const d = legacyDefaultSize(i.id);
    return i.w !== d.w || i.h !== d.h;
  })) return false;
  const full: GridItem[] = [];
  for (const id of LEGACY_V1_ORDER) {
    const { w, h } = legacyDefaultSize(id);
    full.push({ id, w, h, ...firstFit(full, w, h) });
  }
  const want = sortItems(full).map((i) => i.id).filter((id) => stored.some((s) => s.id === id));
  const have = sortItems(stored).map((i) => i.id);
  return want.length === have.length && want.every((id, i) => id === have[i]);
}

const isLegacyCompositeOrLegacyId = (id: string) => (LEGACY_V1_ORDER as readonly string[]).includes(id);

/** Atoms of a former composite tile laid out compactly inside its slot (width scaled to the slot). */
function expandSlot(slot: GridItem, atoms: readonly string[], taken: Set<string>, cons?: ConstraintsOf): GridItem[] {
  const subCols = Math.max(2, Math.min(GRID_COLS, slot.w));
  const placed: GridItem[] = [];
  for (const id of atoms) {
    if (taken.has(id)) continue;
    const def = defaultGridSize(id);
    const c = effectiveConstraints(cons?.(id), subCols);
    const w = clamp(Math.round((def.w * slot.w) / GRID_COLS), c.minW, subCols);
    const h = clamp(def.h, c.minH, c.maxH);
    const at = firstFit(placed, w, h, subCols);
    placed.push({ id, w, h, x: at.x, y: at.y });
    taken.add(id);
  }
  return placed.map((p) => ({ ...p, x: Math.min(slot.x + p.x, GRID_COLS - p.w), y: slot.y + p.y }));
}

/**
 * Grid v1 (composite tiles) -> v2 (atoms). Never throws, idempotent for v2 input, no overlaps in the result.
 *  - untouched former default  -> the NEW default dashboard (custom panels stay on top);
 *  - customised layout         -> every composite is replaced IN PLACE by its atoms, laid out compactly in
 *    the freed slot; other tiles keep their positions (pushed down only if the atoms need more room);
 *  - if that still leaves holes between tiles, the board is re-flowed (reading order kept).
 */
export function migrateGridToAtoms(items: readonly GridItem[], cons: ConstraintsOf = atomConstraints): GridItem[] {
  try {
    const list = items.filter((i) => i && typeof i.id === "string").map((i) => fitItem(i, undefined));
    if (!list.some((i) => isLegacyCompositeId(i.id))) return compact(list, GRID_COLS, cons);
    const customs = list.filter((i) => !LEGACY_V1_ORDER.includes(i.id as never) && !isLegacyCompositeId(i.id) && !atomDef(i.id));
    if (isLegacyDefaultGrid(list)) return defaultGridKeeping(customs, cons);
    const taken = new Set(list.filter((i) => !isLegacyCompositeId(i.id)).map((i) => i.id));
    const out: GridItem[] = [];
    for (const it of sortItems(list)) {
      if (!isLegacyCompositeId(it.id)) {
        out.push(it);
        continue;
      }
      out.push(...expandSlot(it, LEGACY_WIDGET_SPLIT[it.id], taken, cons));
    }
    const packed = compact(out, GRID_COLS, cons);
    if (holeCount(packed) === 0) return packed;
    // Holes remain between differently sized tiles: re-flow the built-in tiles, custom panels keep their size
    // and stay on top.
    const isCustom = (i: GridItem) => !atomDef(i.id) && !isLegacyCompositeId(i.id);
    const top = compact(packed.filter(isCustom), GRID_COLS, cons);
    const offset = bottomOf(top);
    return [...top, ...tidyGrid(packed.filter((i) => !isCustom(i)), cons).map((i) => ({ ...i, y: i.y + offset }))];
  } catch {
    return defaultAtomGrid();
  }
}

/**
 * Positions to start from for a saved layout object, whatever its age:
 *   gridVersion 2        -> parsed and normalised,
 *   older `grid`         -> migrated to atoms,
 *   no grid (very old)   -> converted from `order` + `tiles`, then migrated.
 * `ids` are the valid current tile ids (atoms + custom panels). Returns null when nothing usable is stored.
 */
export function loadSavedGrid(
  data: unknown,
  opts: { ids: readonly string[]; constraints?: ConstraintsOf; legacyTiles?: unknown },
): GridItem[] | null {
  try {
    if (!data || typeof data !== "object") return null;
    const d = data as { gridVersion?: unknown; grid?: unknown; order?: unknown; tiles?: unknown };
    const cons = opts.constraints ?? atomConstraints;
    if (d.gridVersion === GRID_VERSION || d.gridVersion === 3) {
      const g = parseGrid(d.grid, { ids: opts.ids, constraints: cons });
      return g ? compact(g, GRID_COLS, cons) : null;
    }
    if (d.gridVersion === 2) {
      // v2 -> v3: apply the new minimum sizes and arrange once (old boards were left with holes).
      const g = parseGrid(d.grid, { ids: opts.ids, constraints: cons });
      return g ? autoArrange(g, cons) : null;
    }
    const customIds = opts.ids.filter((id) => id.startsWith("custom-"));
    const known = [...opts.ids, ...LEGACY_COMPOSITE_IDS];
    const stored = parseGrid(d.grid, { ids: known });
    if (stored) return migrateGridToAtoms(stored, cons);
    const legacy = legacyToGrid({ order: d.order, tiles: opts.legacyTiles ?? d.tiles }, [...LEGACY_V1_ORDER, ...customIds], undefined);
    return migrateGridToAtoms(legacy, cons);
  } catch {
    return null;
  }
}
