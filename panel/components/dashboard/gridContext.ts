"use client";
import { createContext, useContext, type Dispatch, type KeyboardEvent, type PointerEvent, type SetStateAction } from "react";
import type { DashboardLayout } from "@/lib/dashboardBuilder";
import type { Breakpoint, GridConstraints, GridItem, ResizeHandle } from "@/lib/dashboardGrid";

export type GridGeometry = { cols: number; colW: number; rowH: number; gap: number };
export type ActiveTile = { id: string; kind: "drag" | "resize"; left: number; top: number };

export type GridCtx = {
  layout: DashboardLayout;
  setLayout: Dispatch<SetStateAction<DashboardLayout>>;
  /** True only when the layout can really be edited (edit mode on the desktop breakpoint). */
  editing: boolean;
  breakpoint: Breakpoint;
  geo: GridGeometry;
  /** Positions to render (live preview applied while dragging / resizing). */
  items: Map<string, GridItem>;
  active: ActiveTile | null;
  keys: string[];
  hide: (id: string) => void;
  constraintsOf: (id: string) => GridConstraints;
  startDrag: (id: string, e: PointerEvent<HTMLElement>) => void;
  startResize: (id: string, handle: ResizeHandle, e: PointerEvent<HTMLElement>) => void;
  /** Alt+Arrows move, Alt+Shift+Arrows resize. Returns true when the key was handled. */
  onKeyboard: (id: string, title: string, e: KeyboardEvent<HTMLElement>) => boolean;
  setSize: (id: string, size: { w?: number; h?: number }) => void;
  resetSize: (id: string) => void;
  duplicate: (id: string) => void;
  canDuplicate: (id: string) => boolean;
  /** Save the tile to "Mine" in the catalog (absent when the host does not support it). */
  saveTile?: (id: string) => void;
};

export const GridContext = createContext<GridCtx | null>(null);

export function useGrid(): GridCtx {
  const ctx = useContext(GridContext);
  if (!ctx) throw new Error("GridTile must be rendered inside DashboardBuilder");
  return ctx;
}
