"use client";
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { layoutConstraints, type DashboardLayout } from "@/lib/dashboardBuilder";
import {
  GRID_COLS,
  GRID_GAP,
  GRID_ROW_HEIGHT,
  GRID_VERSION,
  bottomOf,
  breakpointForWidth,
  columnsFor,
  defaultGridSize,
  deriveLayout,
  effectiveConstraints,
  firstFit,
  legacyToGrid,
  moveItem,
  reconcile,
  resizeItem,
  resizeRect,
  tileKind,
  type GridItem,
  type ResizeHandle,
} from "@/lib/dashboardGrid";
import { GridContext, type ActiveTile, type GridCtx } from "./gridContext";

const EDGE_ZONE = 72;
const MAX_SCROLL_STEP = 24;

/** Size a tile gets on "Reset size" / when first added, by what it shows. */
function resetSizeFor(id: string, view: string | undefined, panelKind: string | undefined): { w: number; h: number } {
  if (!id.startsWith("custom-")) return defaultGridSize(id);
  switch (tileKind(id, view, panelKind)) {
    case "stat":
      return { w: 3, h: 4 };
    case "viz":
      return { w: 4, h: 6 };
    case "table":
      return { w: 6, h: 6 };
    default:
      return { w: 6, h: 8 };
  }
}

function findScroller(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p && p !== document.body && p !== document.documentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
    p = p.parentElement;
  }
  return null;
}

type Interaction = {
  kind: "drag" | "resize";
  id: string;
  pointerId: number;
  base: GridItem[];
  start: GridItem;
  handle: ResizeHandle;
  startX: number;
  startY: number;
  offX: number;
  offY: number;
  lastX: number;
  lastY: number;
  lock: boolean;
  key: string;
  preview: GridItem[] | null;
  scroller: HTMLElement | null;
  raf: number;
  scrollRaf: number;
};

/**
 * The dashboard board: an absolutely positioned 12-column grid (30px rows, 12px gaps). Tile pixel size
 * derives from the container width. Children are `DashboardTile`s; their ids define what is visible.
 * Edit mode (desktop breakpoint only): drag by the header, resize from 8 handles, keyboard support.
 */
export function DashboardBuilder({
  layout,
  setLayout,
  editing,
  hide,
  children,
}: {
  layout: DashboardLayout;
  setLayout: Dispatch<SetStateAction<DashboardLayout>>;
  editing: boolean;
  hide: (id: string) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const boardRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<ActiveTile | null>(null);
  const [preview, setPreview] = useState<GridItem[] | null>(null);
  const [message, setMessage] = useState("");
  const interaction = useRef<Interaction | null>(null);
  const detach = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ids: string[] = [];
  for (const c of Children.toArray(children)) {
    if (!isValidElement(c)) continue;
    const id = (c.props as { id?: unknown }).id;
    if (typeof id === "string") ids.push(id);
  }
  const idsKey = ids.join("|");
  const keys = useMemo(() => ids, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const constraintsOf = useMemo(() => {
    const of = layoutConstraints(layout);
    return (id: string) => effectiveConstraints(of(id), GRID_COLS);
  }, [layout]);

  const resetOf = useCallback(
    (id: string) => resetSizeFor(id, layout.tiles[id]?.view, layout.panels.find((p) => p.id === id)?.kind),
    [layout.tiles, layout.panels],
  );
  // A tile without a stored position takes the size from its legacy settings (the composer's initial size).
  const defaultSize = useCallback(
    (id: string) => (layout.tiles[id] ? legacyToGrid({ order: [id], tiles: layout.tiles }, [id])[0] : resetOf(id)),
    [layout.tiles, resetOf],
  );

  const bp = breakpointForWidth(width);
  const canEdit = editing && bp === "lg";
  const cols = columnsFor(bp);
  const geo = useMemo(() => {
    const colW = Math.max(1, (width - GRID_GAP * (cols - 1)) / cols);
    return { cols, colW, rowH: GRID_ROW_HEIGHT, gap: GRID_GAP };
  }, [width, cols]);

  const desktop = useMemo(
    () => reconcile(layout.grid, keys, { defaultSize, constraints: constraintsOf, top: (id) => id.startsWith("custom-") }),
    [layout.grid, keys, defaultSize, constraintsOf],
  );
  const base = useMemo(() => (bp === "lg" ? desktop : deriveLayout(desktop, bp, constraintsOf)), [desktop, bp, constraintsOf]);
  const shown = preview ?? base;
  const items = useMemo(() => new Map(shown.map((i) => [i.id, i])), [shown]);

  // Latest values for window-level listeners.
  const live = useRef({ geo, base, constraintsOf, canEdit });
  useEffect(() => {
    live.current = { geo, base, constraintsOf, canEdit };
  });

  const commit = useCallback(
    (next: GridItem[]) => {
      setLayout((l) => ({ ...l, gridVersion: GRID_VERSION, grid: next.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })) }));
    },
    [setLayout],
  );

  /* ---------------------------------------------------------------- pointer interactions */

  const apply = useCallback(() => {
    const it = interaction.current;
    const el = boardRef.current;
    if (!it || !el) return;
    const { geo: g, constraintsOf: cons } = live.current;
    const box = el.getBoundingClientRect();
    const stepX = g.colW + g.gap;
    const stepY = g.rowH + g.gap;
    if (it.kind === "drag") {
      const left = it.lastX - it.offX - box.left;
      const top = it.lastY - it.offY - box.top;
      setActive({ id: it.id, kind: "drag", left, top });
      const cx = Math.min(Math.max(0, Math.round(left / stepX)), g.cols - it.start.w);
      const cy = Math.max(0, Math.round(top / stepY));
      const key = `${cx},${cy}`;
      if (key !== it.key) {
        it.key = key;
        it.preview = moveItem(it.base, it.id, cx, cy, cons, g.cols);
        setPreview(it.preview);
      }
    } else {
      const dx = Math.round((it.lastX - it.startX) / stepX);
      const dy = Math.round((it.lastY - it.startY) / stepY);
      const rect = resizeRect(it.start, it.handle, dx, dy, cons(it.id), g.cols, it.lock);
      const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
      if (key !== it.key) {
        it.key = key;
        it.preview = resizeItem(it.base, it.id, rect, cons, g.cols);
        setPreview(it.preview);
      }
    }
  }, []);

  const finish = useCallback(
    (save: boolean) => {
      const it = interaction.current;
      if (!it) return;
      interaction.current = null;
      detach.current?.();
      detach.current = null;
      const next = it.preview;
      setActive(null);
      setPreview(null);
      if (save && next && JSON.stringify(next) !== JSON.stringify(it.base)) commit(next);
      if (!save) setMessage(t("pages.builder.dragCancelled"));
    },
    [commit, t],
  );

  const begin = useCallback(
    (it: Interaction) => {
      interaction.current = it;
      const schedule = () => {
        if (it.raf) return;
        it.raf = requestAnimationFrame(() => {
          it.raf = 0;
          apply();
        });
      };
      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== it.pointerId) return;
        it.lastX = ev.clientX;
        it.lastY = ev.clientY;
        it.lock = ev.shiftKey;
        schedule();
      };
      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== it.pointerId) return;
        if (it.raf) cancelAnimationFrame(it.raf);
        it.raf = 0;
        it.lastX = ev.clientX;
        it.lastY = ev.clientY;
        apply();
        finish(ev.type === "pointerup");
      };
      const onKey = (ev: globalThis.KeyboardEvent) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          finish(false);
        }
      };
      const onScroll = () => schedule();
      // Autoscroll while the pointer rests near the top / bottom edge of the scrolling area.
      const tick = () => {
        if (interaction.current !== it) return;
        const top = it.scroller ? it.scroller.getBoundingClientRect().top : 0;
        const bottom = it.scroller ? it.scroller.getBoundingClientRect().bottom : window.innerHeight;
        let step = 0;
        if (it.lastY < top + EDGE_ZONE) step = -Math.min(1, (top + EDGE_ZONE - it.lastY) / EDGE_ZONE) * MAX_SCROLL_STEP;
        else if (it.lastY > bottom - EDGE_ZONE) step = Math.min(1, (it.lastY - (bottom - EDGE_ZONE)) / EDGE_ZONE) * MAX_SCROLL_STEP;
        if (Math.abs(step) >= 1) {
          if (it.scroller) it.scroller.scrollTop += step;
          else window.scrollBy(0, step);
        }
        it.scrollRaf = requestAnimationFrame(tick);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("scroll", onScroll, true);
      const prevSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      it.scrollRaf = requestAnimationFrame(tick);
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("scroll", onScroll, true);
        document.body.style.userSelect = prevSelect;
        if (it.raf) cancelAnimationFrame(it.raf);
        cancelAnimationFrame(it.scrollRaf);
      };
      apply();
    },
    [apply, finish],
  );

  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
      interaction.current = null;
    },
    [],
  );
  // Leaving edit mode (or shrinking to a derived breakpoint) mid-gesture drops the gesture.
  useEffect(() => {
    if (!canEdit && interaction.current) finish(false);
  }, [canEdit, finish]);

  const startDrag = useCallback(
    (id: string, e: PointerEvent<HTMLElement>) => {
      const { canEdit: ok, base: current } = live.current;
      if (!ok || interaction.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button,a,input,select,textarea,[data-no-drag]")) return;
      const start = current.find((i) => i.id === id);
      const tile = (e.currentTarget as HTMLElement).closest("[data-dashboard-tile]");
      if (!start || !tile) return;
      e.preventDefault();
      const r = tile.getBoundingClientRect();
      begin({
        kind: "drag",
        id,
        pointerId: e.pointerId,
        base: current.map((i) => ({ ...i })),
        start,
        handle: "se",
        startX: e.clientX,
        startY: e.clientY,
        offX: e.clientX - r.left,
        offY: e.clientY - r.top,
        lastX: e.clientX,
        lastY: e.clientY,
        lock: false,
        key: "",
        preview: null,
        scroller: findScroller(boardRef.current),
        raf: 0,
        scrollRaf: 0,
      });
    },
    [begin],
  );

  const startResize = useCallback(
    (id: string, handle: ResizeHandle, e: PointerEvent<HTMLElement>) => {
      const { canEdit: ok, base: current } = live.current;
      if (!ok || interaction.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const start = current.find((i) => i.id === id);
      if (!start) return;
      e.preventDefault();
      e.stopPropagation();
      begin({
        kind: "resize",
        id,
        pointerId: e.pointerId,
        base: current.map((i) => ({ ...i })),
        start,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        offX: 0,
        offY: 0,
        lastX: e.clientX,
        lastY: e.clientY,
        lock: e.shiftKey,
        key: "",
        preview: null,
        scroller: findScroller(boardRef.current),
        raf: 0,
        scrollRaf: 0,
      });
      setActive({ id, kind: "resize", left: 0, top: 0 });
    },
    [begin],
  );

  /* ---------------------------------------------------------------- keyboard + menu actions */

  const onKeyboard = useCallback(
    (id: string, title: string, e: KeyboardEvent<HTMLElement>) => {
      const { canEdit: ok, base: current, constraintsOf: cons, geo: g } = live.current;
      if (!ok || !e.altKey || e.ctrlKey || e.metaKey) return false;
      if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return false;
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable='true']")) return false;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return false;
      e.preventDefault();
      const cur = current.find((i) => i.id === id);
      if (!cur) return true;
      const next = e.shiftKey
        ? resizeItem(current, id, resizeRect(cur, "se", dir[0], dir[1], cons(id), g.cols), cons, g.cols)
        : moveItem(current, id, cur.x + dir[0], cur.y + dir[1], cons, g.cols);
      const after = next.find((i) => i.id === id)!;
      if (JSON.stringify(next) === JSON.stringify(current)) return true;
      commit(next);
      setMessage(
        e.shiftKey
          ? t("pages.builder.tileResized", { title, w: after.w, h: after.h })
          : t("pages.builder.tileMoved", { title, x: after.x + 1, y: after.y + 1 }),
      );
      return true;
    },
    [commit, t],
  );

  const setSize = useCallback(
    (id: string, size: { w?: number; h?: number }) => {
      const { base: current, constraintsOf: cons, geo: g } = live.current;
      const cur = current.find((i) => i.id === id);
      if (!cur) return;
      const next = resizeItem(current, id, { x: cur.x, y: cur.y, w: size.w ?? cur.w, h: size.h ?? cur.h }, cons, g.cols);
      if (JSON.stringify(next) !== JSON.stringify(current)) commit(next);
    },
    [commit],
  );

  const resetSize = useCallback(
    (id: string) => {
      setSize(id, resetOf(id));
    },
    [resetOf, setSize],
  );

  const canDuplicate = useCallback((id: string) => id.startsWith("custom-") && layout.panels.length < 24 && layout.panels.some((p) => p.id === id), [layout.panels]);

  const duplicate = useCallback(
    (id: string) => {
      const { base: current } = live.current;
      const src = layout.panels.find((p) => p.id === id);
      const cur = current.find((i) => i.id === id);
      if (!src || !cur || layout.panels.length >= 24) return;
      const newId = `custom-${crypto.randomUUID().slice(0, 8)}`;
      const slot = firstFit(current, cur.w, cur.h);
      const copy = structuredClone(src);
      copy.id = newId;
      if (copy.title) copy.title = `${copy.title} · ${t("pages.builder.copy")}`;
      const placed: GridItem[] = [...current, { id: newId, w: cur.w, h: cur.h, ...slot }];
      setLayout((l) => ({
        ...l,
        panels: [...l.panels, copy],
        order: [newId, ...l.order],
        tiles: l.tiles[id] ? { ...l.tiles, [newId]: { ...l.tiles[id] } } : l.tiles,
        gridVersion: GRID_VERSION,
        grid: placed.map(({ id: pid, x, y, w, h }) => ({ id: pid, x, y, w, h })),
      }));
    },
    [layout.panels, setLayout, t],
  );

  const ctx = useMemo<GridCtx>(
    () => ({
      layout,
      setLayout,
      editing: canEdit,
      breakpoint: bp,
      geo,
      items,
      active,
      keys,
      hide,
      constraintsOf,
      startDrag,
      startResize,
      onKeyboard,
      setSize,
      resetSize,
      duplicate,
      canDuplicate,
    }),
    [layout, setLayout, canEdit, bp, geo, items, active, keys, hide, constraintsOf, startDrag, startResize, onKeyboard, setSize, resetSize, duplicate, canDuplicate],
  );

  const rows = bottomOf(shown) + (active ? 4 : 0);
  const stepY = GRID_ROW_HEIGHT + GRID_GAP;
  const boardHeight = rows > 0 ? rows * stepY - GRID_GAP : 0;
  const ghost = active?.kind === "drag" ? items.get(active.id) : undefined;

  return (
    <GridContext.Provider value={ctx}>
      {editing && bp !== "lg" ? (
        <p role="status" className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--fg-muted)]">
          {t("pages.builder.gridNarrow")}
        </p>
      ) : null}
      <div
        ref={boardRef}
        className="dashboard-builder dashboard-grid"
        data-editing={canEdit ? "true" : "false"}
        data-breakpoint={bp}
        style={{
          height: width > 0 ? Math.max(boardHeight, 120) : 120,
          backgroundSize: `${geo.colW + geo.gap}px ${stepY}px`,
          backgroundPosition: `${-geo.gap / 2 + 0}px ${-geo.gap / 2}px`,
          backgroundImage: canEdit ? undefined : "none",
        }}
      >
        {width > 0 ? children : null}
        {ghost && width > 0 ? (
          <div
            className="dashboard-ghost"
            aria-hidden
            style={{
              width: ghost.w * geo.colW + (ghost.w - 1) * geo.gap,
              height: ghost.h * geo.rowH + (ghost.h - 1) * geo.gap,
              transform: `translate3d(${ghost.x * (geo.colW + geo.gap)}px, ${ghost.y * stepY}px, 0)`,
            }}
          />
        ) : null}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>
    </GridContext.Provider>
  );
}
