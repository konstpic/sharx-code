"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { SubPageShell } from "@/components/sub/SubPageShell";
import { LayoutRenderer } from "@/components/sub/layout/LayoutRenderer";
import type { PublicSubPayload } from "@/components/sub/types";
import type { SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";
import { insertSubtree, isContainerType, moveNode, parentMap, parentOf, placeBeside, placeBesideSubtree, subtreeIds, updateNode, type Subtree } from "@/lib/subLayout/tree";
import type { LNode, LayoutDoc, Style } from "@/lib/subLayout/types";
import { GridOverlay, snapTo, type GridSettings } from "./GridControls";
import type { D } from "./i18n";

export type Device = "mobile" | "tablet" | "desktop";
export const DEVICE_WIDTH: Record<Device, number> = { mobile: 390, tablet: 768, desktop: 1200 };

type R = { x: number; y: number; w: number; h: number };

export type CanvasOps = {
  select: (ids: string[]) => void;
  commit: (doc: LayoutDoc, opts?: { sel?: string[]; key?: string }) => void;
  remove: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
  group: (ids: string[]) => void;
  wrapRow: (ids: string[]) => void;
  ungroup: (id: string) => void;
  copy: (ids: string[]) => void;
  paste: () => void;
  shift: (id: string, delta: number) => void;
  /** Opens the "save to library" dialog for these nodes. */
  saveToLibrary?: (ids: string[]) => void;
};

export type CanvasHandle = {
  /** Starts dragging a new element (from the Add tab) with the pointer that pressed on it. */
  startNewDrag: (build: () => Subtree, label: string, e: { clientX: number; clientY: number; pointerId?: number }) => void;
  /** Recompute overlay rects (after the layers panel changed something). */
  refresh: () => void;
};

type Drop =
  | { kind: "index"; parentId: string; beforeId: string | null; line: R | null; box: R | null }
  | { kind: "free"; parentId: string; x: number; y: number }
  | { kind: "side"; targetId: string; side: "left" | "right"; line: R };

type Props = {
  doc: LayoutDoc;
  sel: string[];
  data: PublicSubPayload;
  config: SharxSubpageConfigV2 | null;
  device: Device;
  zoom: number;
  bp: "base" | "mobile";
  ops: CanvasOps;
  d: D;
  /** True while a layers-panel drag is in progress: the canvas ignores its own hover. */
  frameWidth?: number;
  lang?: string;
  grid?: GridSettings;
};

const CE = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));
const TEXT_KEY: Record<string, string> = { text: "text", button: "label", badge: "text" };

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({ doc, sel, data, config, device, zoom, bp, ops, d, frameWidth, lang, grid }, ref) {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [rev, setRev] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [sizeTag, setSizeTag] = useState<{ x: number; y: number; text: string } | null>(null);
  const [textEdit, setTextEdit] = useState<{ id: string; key: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const dragging = useRef(false);
  const [gridFlash, setGridFlash] = useState<{ v: number[]; h: number[] } | null>(null);
  const flashTimer = useRef(0);
  const flashKey = useRef("");
  const gridRef = useRef(grid);
  gridRef.current = grid;

  const docRef = useRef(doc);
  docRef.current = doc;
  const selRef = useRef(sel);
  selRef.current = sel;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const bpRef = useRef(bp);
  bpRef.current = bp;

  // ---- measuring
  const bump = useRef(0);
  const scheduleRev = useCallback(() => {
    if (bump.current) return;
    bump.current = requestAnimationFrame(() => {
      bump.current = 0;
      setRev((r) => r + 1);
    });
  }, []);

  useLayoutEffect(() => {
    scheduleRev();
  }, [doc, zoom, device, frameWidth, scheduleRev]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(scheduleRev);
    ro.observe(el);
    const mo = new MutationObserver(scheduleRev);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", scheduleRev);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", scheduleRev);
    };
  }, [scheduleRev]);

  /** Brief highlight of the grid line an element just snapped to. */
  const flash = useCallback((v: number[], h: number[]) => {
    const k = `${v.join()}|${h.join()}`;
    if (k === flashKey.current) return;
    flashKey.current = k;
    setGridFlash({ v, h });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setGridFlash(null), 350);
  }, []);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const frameRect = useCallback((): DOMRect | null => frameRef.current?.getBoundingClientRect() ?? null, []);

  const toLocal = useCallback(
    (cx: number, cy: number) => {
      const fr = frameRect();
      if (!fr) return { x: 0, y: 0 };
      return { x: (cx - fr.left) / zoomRef.current, y: (cy - fr.top) / zoomRef.current };
    },
    [frameRect],
  );

  const rectOf = useCallback(
    (id: string): R | null => {
      const fr = frameRect();
      const root = contentRef.current;
      if (!fr || !root) return null;
      const el = root.querySelector(`[data-lnode="${CE(id)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const z = zoomRef.current;
      return { x: (r.left - fr.left) / z, y: (r.top - fr.top) / z, w: r.width / z, h: r.height / z };
    },
    [frameRect],
  );

  /** Node ids under a point, deepest first. */
  const hitsAt = useCallback((cx: number, cy: number): string[] => {
    const root = contentRef.current;
    if (!root) return [];
    const out: string[] = [];
    for (const el of document.elementsFromPoint(cx, cy)) {
      if (!root.contains(el)) continue;
      const n = (el as HTMLElement).closest?.("[data-lnode]") as HTMLElement | null;
      const id = n?.dataset.lnode;
      if (id && !out.includes(id) && docRef.current.nodes[id]) out.push(id);
    }
    return out;
  }, []);

  const pickNode = useCallback(
    (cx: number, cy: number): string | null => {
      for (const id of hitsAt(cx, cy)) {
        const n = docRef.current.nodes[id];
        if (n && !n.locked) return id;
      }
      return null;
    },
    [hitsAt],
  );

  // ---- drop target
  const computeDrop = useCallback(
    (cx: number, cy: number, dragged: string[], grab: { x: number; y: number } | null, alt = false): Drop | null => {
      const dc = docRef.current;
      const excluded = new Set<string>();
      for (const id of dragged) for (const s of subtreeIds(dc, id)) excluded.add(s);
      const hits = hitsAt(cx, cy);
      const local = toLocal(cx, cy);

      // Left / right edge zones of a stack child: place side by side (new row, or into the existing row).
      if (dragged.length <= 1) {
        const pm = parentMap(dc);
        for (const h of hits) {
          const hn = dc.nodes[h];
          const pid = pm.get(h);
          const pn = pid ? dc.nodes[pid] : undefined;
          if (!hn || !pn || excluded.has(h) || hn.locked || !isContainerType(pn.type) || (pn.style.mode ?? "stack") !== "stack") continue;
          if (pid === dc.root && hn.type === "header") continue;
          const hr = rectOf(h);
          if (!hr) continue;
          const zone = hr.w * 0.22;
          const side = local.x < hr.x + zone ? "left" : local.x > hr.x + hr.w - zone ? "right" : null;
          if (side && local.y >= hr.y && local.y <= hr.y + hr.h) return { kind: "side", targetId: h, side, line: { x: side === "left" ? hr.x - 2 : hr.x + hr.w - 1, y: hr.y, w: 3, h: hr.h } };
        }
      }
      let container = hits.find((id) => {
        const n = dc.nodes[id];
        return n && isContainerType(n.type) && !excluded.has(id) && !n.locked;
      });
      if (!container) container = dc.root;
      const cn = dc.nodes[container];
      const mode = cn.style.mode ?? "stack";
      const cr = rectOf(container);

      if (mode === "free" && cr) {
        let fx = Math.round(local.x - cr.x - (grab?.x ?? 0));
        let fy = Math.round(local.y - cr.y - (grab?.y ?? 0));
        const g = gridRef.current;
        if (g?.snap && !alt) {
          fx = Math.max(0, snapTo(fx, g.step));
          fy = Math.max(0, snapTo(fy, g.step));
        }
        return { kind: "free", parentId: container, x: fx, y: fy };
      }

      const all = cn.children ?? [];
      const kids = all.filter((c) => !excluded.has(c));
      if (kids.length === 0) return { kind: "index", parentId: container, beforeId: null, line: null, box: cr };

      const rects = kids.map((c) => ({ id: c, r: rectOf(c) })).filter((k): k is { id: string; r: R } => !!k.r);
      if (rects.length === 0) return { kind: "index", parentId: container, beforeId: null, line: null, box: cr };

      const dir = cn.style.dir ?? "column";
      const flow = mode === "grid" || cn.style.wrap ? "grid" : dir;
      let at = rects.length; // insert before rects[at]
      if (flow === "column") {
        const i = rects.findIndex((k) => local.y < k.r.y + k.r.h / 2);
        at = i < 0 ? rects.length : i;
      } else if (flow === "row") {
        const i = rects.findIndex((k) => local.x < k.r.x + k.r.w / 2);
        at = i < 0 ? rects.length : i;
      } else {
        let best = 0;
        let bd = Infinity;
        rects.forEach((k, i) => {
          const cxk = k.r.x + k.r.w / 2;
          const cyk = k.r.y + k.r.h / 2;
          const dist = (cxk - local.x) ** 2 + (cyk - local.y) ** 2;
          if (dist < bd) {
            bd = dist;
            best = i;
          }
        });
        const k = rects[best].r;
        at = local.x < k.x + k.w / 2 ? best : best + 1;
      }
      const beforeId = at < rects.length ? rects[at].id : null;

      let line: R | null = null;
      if (flow === "column" || flow === "grid") {
        if (flow === "column") {
          const edge = at < rects.length ? rects[at].r.y - 1 : rects[rects.length - 1].r.y + rects[rects.length - 1].r.h + 1;
          const ref = rects[Math.min(at, rects.length - 1)].r;
          line = { x: cr ? cr.x + 4 : ref.x, y: edge - 1, w: cr ? Math.max(20, cr.w - 8) : ref.w, h: 3 };
        } else {
          const ref = rects[Math.min(at, rects.length - 1)].r;
          const x = at < rects.length ? rects[at].r.x - 3 : ref.x + ref.w + 1;
          line = { x, y: ref.y, w: 3, h: ref.h };
        }
      } else {
        const ref = rects[Math.min(at, rects.length - 1)].r;
        const x = at < rects.length ? rects[at].r.x - 3 : ref.x + ref.w + 1;
        line = { x, y: cr ? cr.y + 4 : ref.y, w: 3, h: cr ? Math.max(20, cr.h - 8) : ref.h };
      }
      return { kind: "index", parentId: container, beforeId, line, box: null };
    },
    [hitsAt, rectOf, toLocal],
  );

  /** Applies a move / insert at a computed drop. */
  const applyDrop = useCallback(
    (dr: Drop, ids: string[], newTree?: Subtree, grabbed?: { w: number; h: number }) => {
      let cur = docRef.current;
      if (dr.kind === "side") {
        if (newTree) {
          const next = placeBesideSubtree(cur, dr.targetId, newTree, dr.side);
          if (next !== cur) ops.commit(next, { sel: [newTree.root] });
        } else if (ids[0]) {
          const next = placeBeside(cur, dr.targetId, ids[0], dr.side);
          if (next !== cur) ops.commit(next, { sel: ids.slice(0, 1) });
        }
        return;
      }
      if (newTree) {
        const parent = cur.nodes[dr.parentId];
        if (!parent) return;
        const children = parent.children ?? [];
        const index = dr.kind === "index" ? (dr.beforeId ? children.indexOf(dr.beforeId) : children.length) : children.length;
        cur = insertSubtree(cur, dr.parentId, index, newTree);
        if (dr.kind === "free") cur = updateNode(cur, newTree.root, { style: { x: Math.max(0, dr.x), y: Math.max(0, dr.y) } });
        ops.commit(cur, { sel: [newTree.root] });
        return;
      }
      for (const id of ids) {
        const parent = cur.nodes[dr.parentId];
        if (!parent) continue;
        const children = parent.children ?? [];
        const index = dr.kind === "index" ? (dr.beforeId && dr.beforeId !== id ? children.indexOf(dr.beforeId) : children.length) : children.length;
        cur = moveNode(cur, id, dr.parentId, index);
        if (dr.kind === "free") {
          const w = grabbed?.w ?? 0;
          void w;
          cur = updateNode(cur, id, { style: { x: Math.max(0, dr.x), y: Math.max(0, dr.y) } });
        }
      }
      ops.commit(cur, { sel: ids });
    },
    [ops],
  );

  // ---- pointer flows
  const startWindowDrag = useCallback((onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) => {
    const move = (e: PointerEvent) => onMove(e);
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);

  const clearTransient = useCallback(() => {
    setDrop(null);
    setGuides(null);
    setGhost(null);
    setSizeTag(null);
    setGridFlash(null);
    flashKey.current = "";
    dragging.current = false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      refresh: scheduleRev,
      startNewDrag: (build, label, e) => {
        dragging.current = true;
        setGhost({ x: e.clientX, y: e.clientY, label });
        startWindowDrag(
          (ev) => {
            setGhost({ x: ev.clientX, y: ev.clientY, label });
            const fr = frameRect();
            const inside = fr && ev.clientX >= fr.left && ev.clientX <= fr.right && ev.clientY >= fr.top && ev.clientY <= fr.bottom;
            setDrop(inside ? computeDrop(ev.clientX, ev.clientY, [], { x: 0, y: 0 }, ev.altKey) : null);
          },
          (ev) => {
            const fr = frameRect();
            const inside = fr && ev.clientX >= fr.left && ev.clientX <= fr.right && ev.clientY >= fr.top && ev.clientY <= fr.bottom;
            const dr = inside ? computeDrop(ev.clientX, ev.clientY, [], { x: 0, y: 0 }, ev.altKey) : null;
            clearTransient();
            if (dr) applyDrop(dr, [], build());
          },
        );
      },
    }),
    [applyDrop, clearTransient, computeDrop, frameRect, scheduleRev, startWindowDrag],
  );

  // hover
  const onPointerMove = (e: RPointerEvent) => {
    if (dragging.current) return;
    const id = pickNode(e.clientX, e.clientY);
    setHover((h) => (h === id ? h : id));
  };

  const beginMove = (e: RPointerEvent, id: string) => {
    const dc = docRef.current;
    const startX = e.clientX;
    const startY = e.clientY;
    const ids = selRef.current.includes(id) ? selRef.current.filter((s) => s !== dc.root) : [id];
    const node = dc.nodes[id];
    const parentId = parentOf(dc, id);
    const parent = parentId ? dc.nodes[parentId] : undefined;
    const startRect = rectOf(id);
    const startLocal = toLocal(startX, startY);
    const grab = startRect ? { x: startLocal.x - startRect.x, y: startLocal.y - startRect.y } : { x: 0, y: 0 };
    const startPos = { x: Number(node.style.x ?? 0), y: Number(node.style.y ?? 0) };
    const inFree = !!parent && (parent.style.mode ?? "stack") === "free";
    let started = false;

    startWindowDrag(
      (ev) => {
        if (!started) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
          started = true;
          dragging.current = true;
          setHover(null);
        }
        const label = node.name || node.type;
        setGhost({ x: ev.clientX, y: ev.clientY, label });

        // Free frame: move in place with snapping while the pointer stays inside it.
        if (inFree && parentId) {
          const pr = rectOf(parentId);
          const local = toLocal(ev.clientX, ev.clientY);
          if (pr && local.x >= pr.x && local.x <= pr.x + pr.w && local.y >= pr.y && local.y <= pr.y + pr.h && startRect) {
            let nx = Math.round(startPos.x + (local.x - startLocal.x));
            let ny = Math.round(startPos.y + (local.y - startLocal.y));
            const vx: number[] = [];
            const hy: number[] = [];
            const w = startRect.w;
            const h = startRect.h;
            const xs = [0, pr.w / 2, pr.w];
            const ys = [0, pr.h / 2, pr.h];
            for (const sid of parent!.children ?? []) {
              if (sid === id) continue;
              const r = rectOf(sid);
              if (!r) continue;
              xs.push(r.x - pr.x, r.x - pr.x + r.w / 2, r.x - pr.x + r.w);
              ys.push(r.y - pr.y, r.y - pr.y + r.h / 2, r.y - pr.y + r.h);
            }
            const snap = (val: number, size: number, lines: number[], out: number[]) => {
              const edges = [val, val + size / 2, val + size];
              let best: number | null = null;
              for (const edge of edges) {
                for (const l of lines) {
                  const dd = l - edge;
                  if (Math.abs(dd) <= 4 && (best === null || Math.abs(dd) < Math.abs(best))) best = dd;
                }
              }
              if (best === null) return val;
              const nv = val + best;
              for (const l of lines) if ([nv, nv + size / 2, nv + size].some((edge) => Math.abs(edge - l) < 0.5)) out.push(l);
              return nv;
            };
            if (!ev.altKey) {
              nx = Math.round(snap(nx, w, xs, vx));
              ny = Math.round(snap(ny, h, ys, hy));
              // Guides win when they matched; otherwise the position falls onto the grid.
              const g = gridRef.current;
              if (g?.snap) {
                const fv: number[] = [];
                const fh: number[] = [];
                if (vx.length === 0) {
                  nx = Math.max(0, snapTo(nx, g.step));
                  fv.push(pr.x + nx);
                }
                if (hy.length === 0) {
                  ny = Math.max(0, snapTo(ny, g.step));
                  fh.push(pr.y + ny);
                }
                if (fv.length || fh.length) flash(fv, fh);
              }
            }
            setGuides({ v: vx.map((x) => x + pr.x), h: hy.map((y) => y + pr.y) });
            setDrop(null);
            ops.commit(updateNode(docRef.current, id, { style: { x: Math.max(0, nx), y: Math.max(0, ny) } }), { key: `${id}:move`, sel: ids });
            return;
          }
        }
        setGuides(null);
        setDrop(computeDrop(ev.clientX, ev.clientY, ids, grab, ev.altKey));
      },
      (ev) => {
        if (started) {
          const dr = inFree ? null : computeDrop(ev.clientX, ev.clientY, ids, grab, ev.altKey);
          const dc2 = docRef.current;
          const pr = parentId ? rectOf(parentId) : null;
          const local = toLocal(ev.clientX, ev.clientY);
          const insideOwnFree = inFree && pr && local.x >= pr.x && local.x <= pr.x + pr.w && local.y >= pr.y && local.y <= pr.y + pr.h;
          if (!insideOwnFree) {
            const target = dr ?? computeDrop(ev.clientX, ev.clientY, ids, grab, ev.altKey);
            clearTransient();
            if (target && dc2.nodes[id]) applyDrop(target, ids, undefined, startRect ? { w: startRect.w, h: startRect.h } : undefined);
            return;
          }
        }
        clearTransient();
      },
    );
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    if (textEdit) setTextEdit(null);
    const id = pickNode(e.clientX, e.clientY) ?? docRef.current.root;
    if (e.shiftKey) {
      const cur = selRef.current;
      ops.select(cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]);
      return;
    }
    if (!selRef.current.includes(id)) ops.select([id]);
    const n = docRef.current.nodes[id];
    if (!n || id === docRef.current.root || n.locked) return;
    beginMove(e, id);
  };

  const onDoubleClick = (e: RPointerEvent | React.MouseEvent) => {
    const id = pickNode(e.clientX, e.clientY);
    const n = id ? docRef.current.nodes[id] : null;
    if (n && TEXT_KEY[n.type]) setTextEdit({ id: n.id, key: TEXT_KEY[n.type] });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const id = pickNode(e.clientX, e.clientY) ?? docRef.current.root;
    if (!selRef.current.includes(id)) ops.select([id]);
    setMenu({ x: e.clientX, y: e.clientY, id });
  };

  // ---- resize
  const beginResize = (e: RPointerEvent, id: string, axis: "e" | "s" | "se") => {
    e.stopPropagation();
    e.preventDefault();
    const r0 = rectOf(id);
    if (!r0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    dragging.current = true;
    startWindowDrag(
      (ev) => {
        const z = zoomRef.current;
        let nw = Math.max(8, Math.round(r0.w + (ev.clientX - sx) / z));
        let nh = Math.max(8, Math.round(r0.h + (ev.clientY - sy) / z));
        const g = gridRef.current;
        if (g?.snap && !ev.altKey) {
          nw = Math.max(g.step, snapTo(nw, g.step));
          nh = Math.max(g.step, snapTo(nh, g.step));
        }
        const patch: Partial<Style> = {};
        if (axis === "e" || axis === "se") patch.w = nw;
        if (axis === "s" || axis === "se") patch.h = nh;
        const cur = docRef.current;
        ops.commit(updateNode(cur, id, bpRef.current === "mobile" ? { mobile: patch } : { style: patch }), { key: `${id}:resize`, sel: [id] });
        setSizeTag({ x: ev.clientX, y: ev.clientY, text: `${axis === "s" ? Math.round(r0.w) : nw} × ${axis === "e" ? Math.round(r0.h) : nh}` });
      },
      () => clearTransient(),
    );
  };

  // ---- arrow-key nudging of free-positioned nodes (1 step / Shift = 10 steps; 1px / 10px without snapping)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (!dx && !dy) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || t.closest(".monaco-editor"))) return;
      const dc = docRef.current;
      const ids = selRef.current.filter((id) => {
        const pid = parentOf(dc, id);
        return !!pid && !dc.nodes[id]?.locked && (dc.nodes[pid].style.mode ?? "stack") === "free";
      });
      if (!ids.length) return;
      e.preventDefault();
      const g = gridRef.current;
      const snapOn = !!g?.snap;
      const amount = (snapOn ? g!.step : 1) * (e.shiftKey ? 10 : 1);
      const move = (v: number, dir: number) => {
        if (!dir) return v;
        if (snapOn && v % g!.step !== 0) {
          const first = dir > 0 ? Math.ceil(v / g!.step) * g!.step : Math.floor(v / g!.step) * g!.step;
          return Math.max(0, first + (e.shiftKey ? dir * (amount - g!.step) : 0));
        }
        return Math.max(0, v + dir * amount);
      };
      let next = dc;
      for (const id of ids) {
        const st = dc.nodes[id].style;
        next = updateNode(next, id, { style: { x: move(Number(st.x ?? 0), dx), y: move(Number(st.y ?? 0), dy) } });
      }
      ops.commit(next, { key: `nudge:${ids.join(",")}` });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ops]);

  // ---- overlay geometry
  const selRects = useMemo(() => {
    void rev;
    return sel.map((id) => ({ id, r: rectOf(id) })).filter((x): x is { id: string; r: R } => !!x.r);
  }, [sel, rev, rectOf, doc]);

  const hoverRect = useMemo(() => {
    void rev;
    return hover && !sel.includes(hover) ? rectOf(hover) : null;
  }, [hover, sel, rev, rectOf]);

  const width = frameWidth ?? DEVICE_WIDTH[device];

  const single = sel.length === 1 ? doc.nodes[sel[0]] : null;
  const dropBox = drop && drop.kind === "index" ? drop.box : null;
  const dropLine = drop && (drop.kind === "index" || drop.kind === "side") ? drop.line : null;
  const sideLine = drop && drop.kind === "side" ? drop.line : null;

  const editRect = textEdit ? rectOf(textEdit.id) : null;
  const editNode = textEdit ? doc.nodes[textEdit.id] : null;

  return (
    <div className="relative" style={{ width: width * zoom, minHeight: 100 }}>
      <div ref={frameRef} className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl" style={{ width, transform: `scale(${zoom})` }} data-designer-frame>
        <div ref={contentRef}>
          <SubPageShell branding={config?.branding} theme={config?.theme} colorPreset={config?.colorPreset}>
            <LayoutRenderer doc={doc} data={data} config={config} mode="edit" interactive={false} device={device} lang={lang} />
          </SubPageShell>
        </div>

        {/* interaction layer */}
        <div className="absolute inset-0 z-[60]" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => !dragging.current && setHover(null)} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu} style={{ cursor: dragging.current ? "grabbing" : "default", touchAction: "none" }}>
          {grid && (grid.enabled || gridFlash) ? <GridOverlay step={grid.step} lines={grid.enabled} zoom={zoom} flash={gridFlash} /> : null}
          {hoverRect ? <Outline r={hoverRect} tone="hover" label={doc.nodes[hover as string]?.name || doc.nodes[hover as string]?.type} zoom={zoom} /> : null}
          {selRects.map(({ id, r }) => (
            <Outline key={id} r={r} tone="sel" label={doc.nodes[id]?.name || doc.nodes[id]?.type} zoom={zoom} type={doc.nodes[id]?.type} />
          ))}
          {single && selRects[0] && single.id !== doc.root && !single.locked ? (
            <>
              <Handle r={selRects[0].r} at="e" zoom={zoom} onDown={(e) => beginResize(e, single.id, "e")} />
              <Handle r={selRects[0].r} at="s" zoom={zoom} onDown={(e) => beginResize(e, single.id, "s")} />
              <Handle r={selRects[0].r} at="se" zoom={zoom} onDown={(e) => beginResize(e, single.id, "se")} />
            </>
          ) : null}
          {dropBox ? <div className="pointer-events-none absolute rounded-md border-2 border-dashed border-[#22d3ee] bg-[rgba(34,211,238,.10)]" style={{ left: dropBox.x, top: dropBox.y, width: dropBox.w, height: dropBox.h }} /> : null}
          {drop && drop.kind === "side" ? <DropParent id={drop.targetId} rectOf={rectOf} /> : null}
          {dropLine ? <div className={`pointer-events-none absolute rounded-full shadow-[0_0_0_2px_rgba(34,211,238,.25)] ${sideLine ? "bg-[#f59e0b]" : "bg-[#22d3ee]"}`} style={{ left: dropLine.x, top: dropLine.y, width: dropLine.w, height: dropLine.h }} /> : null}
          {drop && drop.kind === "index" ? <DropParent id={drop.parentId} rectOf={rectOf} /> : null}
          {guides?.v.map((x, i) => <div key={`v${i}`} className="pointer-events-none absolute top-0 h-full w-px bg-[#f0abfc]" style={{ left: x }} />)}
          {guides?.h.map((y, i) => <div key={`h${i}`} className="pointer-events-none absolute left-0 h-px w-full bg-[#f0abfc]" style={{ top: y }} />)}
        </div>
      </div>

      {sizeTag ? <div className="pointer-events-none fixed z-[400] rounded-md bg-[#0b1220] px-1.5 py-0.5 text-[11px] font-medium text-[#22d3ee] shadow" style={{ left: sizeTag.x + 14, top: sizeTag.y + 14 }}>{sizeTag.text}</div> : null}
      {ghost ? <div className="pointer-events-none fixed z-[400] rounded-md border border-[#22d3ee] bg-[#0b1220]/90 px-2 py-1 text-[11px] font-medium text-[#22d3ee] shadow" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>{ghost.label}</div> : null}

      {textEdit && editRect && editNode ? (
        <InlineText
          rect={editRect}
          zoom={zoom}
          frame={frameRef}
          value={String(editNode.props[textEdit.key] ?? "")}
          onChange={(v) => ops.commit(updateNode(docRef.current, textEdit.id, { props: { [textEdit.key]: v } }), { key: `${textEdit.id}:inline` })}
          onClose={() => setTextEdit(null)}
        />
      ) : null}

      {menu ? <ContextMenu x={menu.x} y={menu.y} id={menu.id} doc={doc} sel={sel} ops={ops} d={d} onClose={() => setMenu(null)} /> : null}
    </div>
  );
});

// ------------------------------------------------------------------------------------
// Overlay pieces
// ------------------------------------------------------------------------------------

function Outline({ r, tone, label, zoom, type }: { r: R; tone: "hover" | "sel"; label?: string; zoom: number; type?: string }) {
  const c = tone === "sel" ? "#22d3ee" : "rgba(34,211,238,.55)";
  const s = 1 / Math.max(zoom, 0.25);
  return (
    <div className="pointer-events-none absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h, outline: `${(tone === "sel" ? 2 : 1) * s}px solid ${c}`, outlineOffset: -(tone === "sel" ? 1 : 0) * s }}>
      {label ? (
        <div className="absolute left-0 whitespace-nowrap rounded-sm px-1 text-[10px] font-semibold text-[#04141a]" style={{ background: c, transform: `scale(${s}) translateY(-100%)`, transformOrigin: "left bottom", top: 0 }}>
          {label}
          {type && tone === "sel" ? <span className="ml-1 opacity-60">{type}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function Handle({ r, at, zoom, onDown }: { r: R; at: "e" | "s" | "se"; zoom: number; onDown: (e: RPointerEvent) => void }) {
  const s = 1 / Math.max(zoom, 0.25);
  const size = 9 * s;
  const pos = at === "e" ? { left: r.x + r.w - size / 2, top: r.y + r.h / 2 - size / 2 } : at === "s" ? { left: r.x + r.w / 2 - size / 2, top: r.y + r.h - size / 2 } : { left: r.x + r.w - size / 2, top: r.y + r.h - size / 2 };
  return (
    <div
      onPointerDown={onDown}
      className="absolute rounded-[2px] border border-[#04141a] bg-[#22d3ee]"
      style={{ ...pos, width: size, height: size, cursor: at === "e" ? "ew-resize" : at === "s" ? "ns-resize" : "nwse-resize" }}
    />
  );
}

function DropParent({ id, rectOf }: { id: string; rectOf: (id: string) => R | null }) {
  const r = rectOf(id);
  if (!r) return null;
  return <div className="pointer-events-none absolute rounded-sm" style={{ left: r.x, top: r.y, width: r.w, height: r.h, outline: "1px dashed rgba(34,211,238,.6)", outlineOffset: -1 }} />;
}

function InlineText({ rect, zoom, frame, value, onChange, onClose }: { rect: R; zoom: number; frame: React.RefObject<HTMLDivElement | null>; value: string; onChange: (v: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const fr = frame.current?.getBoundingClientRect();
  if (!fr) return null;
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          onClose();
        }
        e.stopPropagation();
      }}
      className="fixed z-[500] resize-none rounded-md border-2 border-[#22d3ee] bg-[#0b1220] p-1.5 text-[13px] text-white shadow-xl outline-none"
      style={{ left: fr.left + rect.x * zoom, top: fr.top + rect.y * zoom, width: Math.max(160, rect.w * zoom), minHeight: Math.max(36, rect.h * zoom) }}
      spellCheck={false}
    />
  );
}

function ContextMenu({ x, y, id, doc, sel, ops, d, onClose }: { x: number; y: number; id: string; doc: LayoutDoc; sel: string[]; ops: CanvasOps; d: D; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close, { once: true });
    window.addEventListener("blur", close, { once: true });
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  const node: LNode | undefined = doc.nodes[id];
  const isRoot = id === doc.root;
  const ids = sel.includes(id) ? sel : [id];
  const items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[] = [
    { label: d("act.duplicate", "Duplicate"), run: () => ops.duplicate(ids), disabled: isRoot },
    { label: d("act.copy", "Copy"), run: () => ops.copy(ids), disabled: isRoot },
    { label: d("act.paste", "Paste inside"), run: () => ops.paste() },
    ...(ops.saveToLibrary ? [{ label: d("lib.saveMenu", "Save to library…"), run: () => ops.saveToLibrary?.(ids), disabled: isRoot }] : []),
    { label: d("act.groupShort", "Group"), run: () => ops.group(ids), disabled: isRoot },
    { label: d("act.sideBySide", "Place side by side"), run: () => ops.wrapRow(ids), disabled: isRoot || ids.length < 2 },
    { label: d("act.breakRow", "Break row"), run: () => ops.ungroup(id), disabled: !node || node.type !== "frame" || isRoot || node.style.dir !== "row" },
    { label: d("act.ungroup", "Ungroup"), run: () => ops.ungroup(id), disabled: !node || node.type !== "frame" || isRoot },
    { label: d("act.forward", "Move earlier"), run: () => ops.shift(id, -1), disabled: isRoot },
    { label: d("act.backward", "Move later"), run: () => ops.shift(id, 1), disabled: isRoot },
    { label: d("act.delete", "Delete"), run: () => ops.remove(ids), disabled: isRoot, danger: true },
  ];
  return (
    <div className="fixed z-[600] w-52 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-2xl" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          disabled={it.disabled}
          onClick={() => {
            it.run();
            onClose();
          }}
          className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12.5px] disabled:cursor-not-allowed disabled:opacity-35 ${it.danger ? "text-red-400 hover:bg-red-500/10" : "text-[var(--fg)] hover:bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
