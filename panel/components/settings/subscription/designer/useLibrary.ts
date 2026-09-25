"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import {
  duplicateItem as dupItem,
  emptyLibrary,
  exportLibrary,
  importLibrary,
  liveItems,
  mergeLibraries,
  parseLibrary,
  serializeLibrary,
  sizeStatus,
  tombstone,
  touch,
  type Library,
  type LibraryItem,
} from "@/lib/subLayout/library";

const CACHE_KEY = "sharx.designer.library.cache";
const DEBOUNCE_MS = 700;

export type LibraryStatus = "saved" | "saving" | "offline";
type Snap = { lib: Library; loading: boolean; error: string; status: LibraryStatus; loaded: boolean; version: number };

let snap: Snap = { lib: emptyLibrary(), loading: false, error: "", status: "saved", loaded: false, version: 0 };
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
let started = false;
const listeners = new Set<() => void>();

function set(patch: Partial<Snap>) {
  snap = { ...snap, ...patch, version: snap.version + 1 };
  listeners.forEach((l) => l());
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as { library?: string; dirty?: boolean };
    snap = { ...snap, lib: parseLibrary(v.library) };
    dirty = !!v.dirty;
  } catch {
    /* storage unavailable or broken */
  }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ library: serializeLibrary(snap.lib), dirty }));
  } catch {
    /* quota / private mode */
  }
}

async function fetchRemote(): Promise<{ lib: Library; text: string }> {
  const r = await postJson<{ library?: string }>(panel("setting/designerLibrary/get"), {}, true);
  if (!r.success) throw new Error(r.msg || "load failed");
  const text = typeof r.obj?.library === "string" ? r.obj.library : "";
  return { lib: parseLibrary(text), text };
}

/** Read the latest remote, merge with local, and (when needed) write back. Serialized through `chain`. */
function sync(): Promise<void> {
  chain = chain.then(async () => {
    set({ loading: !snap.loaded, status: dirty ? "saving" : snap.status, error: "" });
    try {
      const { lib: remote, text } = await fetchRemote();
      // Guard: the remote has content we could not parse -> never overwrite it.
      if (text.trim().length > 2 && remote.items.length === 0 && dirty) throw new Error("remote library is unreadable; not overwriting");
      const merged = mergeLibraries(snap.lib, remote);
      const out = serializeLibrary(merged);
      snap = { ...snap, lib: merged };
      if (dirty) {
        const st = sizeStatus(out);
        if (st === "refuse") throw new Error("library is too large (over 6 MB)");
        const wasEmptyOverFull = liveItems(remote).length > 0 && liveItems(merged).length === 0 && !merged.items.some((i) => i.deleted);
        if (wasEmptyOverFull) throw new Error("refusing to save an empty library over a non-empty one");
        const r = await postJson(panel("setting/designerLibrary/save"), { library: out }, true);
        if (!r.success) throw new Error(r.msg || "save failed");
        dirty = false;
      }
      writeCache();
      set({ lib: merged, loading: false, loaded: true, status: "saved", error: "" });
    } catch (e) {
      writeCache();
      set({ loading: false, loaded: snap.loaded, status: "offline", error: (e as Error)?.message || "error" });
    }
  });
  return chain;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void sync();
  }, DEBOUNCE_MS);
}

function mutate(fn: (lib: Library) => Library) {
  snap = { ...snap, lib: fn(snap.lib) };
  dirty = true;
  writeCache();
  set({ status: "saving", error: "" });
  schedule();
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  readCache();
  set({});
  void sync();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export type UseLibrary = {
  items: LibraryItem[];
  elements: LibraryItem[];
  templates: LibraryItem[];
  loading: boolean;
  error: string;
  status: LibraryStatus;
  saveItem: (item: LibraryItem) => void;
  updateItem: (id: string, patch: Partial<LibraryItem>) => void;
  deleteItem: (id: string) => void;
  duplicateItem: (id: string, name: string) => void;
  importItems: (text: string) => { added: number; skipped: number };
  exportItems: (ids?: string[], kind?: LibraryItem["kind"]) => string;
  reload: () => void;
  byId: (id: string) => LibraryItem | undefined;
};

export function useLibrary(): UseLibrary {
  const s = useSyncExternalStore(subscribe, () => snap, () => snap);
  useEffect(() => {
    ensureStarted();
  }, []);
  const items = liveItems(s.lib);
  const saveItem = useCallback((item: LibraryItem) => mutate((l) => ({ ...l, items: [...l.items.filter((i) => i.id !== item.id), item] })), []);
  const updateItem = useCallback(
    (id: string, patch: Partial<LibraryItem>) => mutate((l) => ({ ...l, items: l.items.map((i) => (i.id === id && !i.deleted ? touch(i, patch) : i)) })),
    [],
  );
  const deleteItem = useCallback((id: string) => mutate((l) => ({ ...l, items: l.items.map((i) => (i.id === id && !i.deleted ? tombstone(i) : i)) })), []);
  const duplicateItem = useCallback(
    (id: string, name: string) => {
      const src = snap.lib.items.find((i) => i.id === id && !i.deleted);
      if (src) mutate((l) => ({ ...l, items: [...l.items, dupItem(src, name)] }));
    },
    [],
  );
  const importItems = useCallback((text: string) => {
    const r = importLibrary(text, snap.lib.items.map((i) => i.id));
    if (r.items.length) mutate((l) => ({ ...l, items: [...l.items, ...r.items] }));
    return { added: r.items.length, skipped: r.skipped };
  }, []);
  const exportItems = useCallback((ids?: string[], kind?: LibraryItem["kind"]) => exportLibrary(liveItems(snap.lib, kind).filter((i) => !ids || ids.includes(i.id))), []);
  const reload = useCallback(() => {
    if (timer) clearTimeout(timer);
    timer = null;
    void sync();
  }, []);
  const byId = useCallback((id: string) => snap.lib.items.find((i) => i.id === id && !i.deleted), []);
  return {
    items,
    elements: items.filter((i) => i.kind === "element"),
    templates: items.filter((i) => i.kind === "template"),
    loading: s.loading,
    error: s.error,
    status: s.status,
    saveItem,
    updateItem,
    deleteItem,
    duplicateItem,
    importItems,
    exportItems,
    reload,
    byId,
  };
}

/** Triggers a browser download of a JSON string. */
export function downloadJson(name: string, text: string) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* ignore */
  }
}
