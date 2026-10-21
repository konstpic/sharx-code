"use client";
/**
 * Session state shared by the tile editor, the tile menu and the board toolbar:
 *  - the style clipboard ("Copy style" / "Paste style"): module state, mirrored to localStorage so it survives a reload,
 *  - the multi-selection of tiles in edit mode (Shift/Ctrl+click or Space on a tile).
 * Plain subscribe/snapshot stores read through useSyncExternalStore.
 */
import { useSyncExternalStore } from "react";
import { normalizeStyle, parseStyleClip, pickStyle, type TileStyle } from "@/lib/dashboardStyle";

const CLIP_KEY = "dashboard.styleClipboard.v1";

function makeStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      subs.forEach((f) => f());
    },
    subscribe: (f: () => void) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}

const clip = makeStore<TileStyle | undefined>(undefined);
let clipLoaded = false;
function loadClip() {
  if (clipLoaded || typeof window === "undefined") return;
  clipLoaded = true;
  try {
    clip.set(parseStyleClip(window.localStorage.getItem(CLIP_KEY)));
  } catch {
    /* storage blocked: the clipboard still works for this session */
  }
}

/** Copies the appearance (frame + colour + typography) of a style to the clipboard. */
export function copyStyle(style: TileStyle | undefined) {
  const picked = pickStyle(normalizeStyle(style));
  clipLoaded = true;
  clip.set(picked ?? {});
  try {
    window.localStorage.setItem(CLIP_KEY, JSON.stringify(picked ?? {}));
  } catch {
    /* ignore */
  }
}

/** `undefined` while nothing was copied; `{}` is a copied default style. */
export function getStyleClip(): TileStyle | undefined {
  loadClip();
  return clip.get();
}

export function useStyleClip(): TileStyle | undefined {
  return useSyncExternalStore(
    (f) => {
      loadClip();
      return clip.subscribe(f);
    },
    () => {
      loadClip();
      return clip.get();
    },
    () => undefined,
  );
}

const EMPTY: ReadonlySet<string> = new Set();
const selection = makeStore<ReadonlySet<string>>(EMPTY);

export function toggleTileSelection(id: string) {
  const next = new Set(selection.get());
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selection.set(next);
}
export function clearTileSelection() {
  if (selection.get().size) selection.set(EMPTY);
}
export function getTileSelection(): ReadonlySet<string> {
  return selection.get();
}
export function useTileSelection(): ReadonlySet<string> {
  return useSyncExternalStore(selection.subscribe, selection.get, () => EMPTY);
}
