"use client";
/**
 * Tile box contract (dashboard grid).
 *
 * GridTile (components/dashboard/GridTile.tsx) renders the widget inside `.dashboard-tile-body`, a flex
 * item with a DEFINITE width and height, and its single child is a flex column that fills the body
 * (`display:flex; flex-direction:column; min-height:0; height:100%`). The pixel size of that body is
 * published through `TileBoxContext` (ResizeObserver, rounded to whole px) together with the chrome state:
 *   - width / height : size of the tile body in px (0 until the first measurement),
 *   - hideTitle      : the tile chrome already shows the title (edit mode title bar), so a widget must
 *                      NOT render its own heading; in view mode the widget shows its compact heading
 *                      (use <TileHeader/> from AtomParts, it reads this flag),
 *   - title          : the title of the tile (user override or the widget's default).
 *
 * Usage:   const { width, height } = useTileBox();
 * Outside a GridTile (modal / drawer preview / tests) the hook falls back to measuring the element the
 * returned `ref` is attached to, so a widget works anywhere:  <div ref={ref} className="h-full">.
 * Prefer CSS container queries (`@container`) for layout and use the numbers for SVG / canvas sizing.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type TileBox = { width: number; height: number; hideTitle: boolean; title: string };

export const TileBoxContext = createContext<TileBox | null>(null);

/** Observe the size of an element; returns a callback ref and the rounded box. */
export function useElementBox(): { width: number; height: number; ref: (el: HTMLElement | null) => void } {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const width = Math.round(r.width);
      const height = Math.round(r.height);
      setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);
  return { ...box, ref };
}

export function useTileBox(): { width: number; height: number; hideTitle: boolean; title: string; ref: (el: HTMLElement | null) => void } {
  const ctx = useContext(TileBoxContext);
  const own = useElementBox();
  if (ctx) return { ...ctx, ref: noopRef };
  return { width: own.width, height: own.height, hideTitle: false, title: "", ref: own.ref };
}

const noopRef = () => {};
