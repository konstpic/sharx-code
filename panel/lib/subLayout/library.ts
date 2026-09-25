import { type Dict } from "./i18nCollect";
import { extractSubtree, newNode, normalizeDoc, reidSubtree, subtreeIds, type Subtree } from "./tree";
import type { LNode, LayoutDoc } from "./types";

/**
 * The designer's library ("Хранилище"): elements and whole page templates the admin saved.
 * Pure data + helpers; the store (designer/useLibrary.ts) syncs it with the panel.
 */

export type LibraryBranding = {
  background?: "animated" | "plain";
  decorations?: boolean;
  accentColor?: string;
  accentAmbientColor?: string;
  bgColor?: string;
  bgElevatedColor?: string;
  fgColor?: string;
  fgMutedColor?: string;
  borderColor?: string;
  successColor?: string;
  dangerColor?: string;
};

const BRANDING_KEYS = ["background", "decorations", "accentColor", "accentAmbientColor", "bgColor", "bgElevatedColor", "fgColor", "fgMutedColor", "borderColor", "successColor", "dangerColor"] as const;

export type LibraryItem = {
  id: string;
  kind: "element" | "template";
  name: string;
  description?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  revision: number;
  /** Tombstone: kept for TOMBSTONE_DAYS so a deletion reaches other browsers. */
  deleted?: true;
  subtree?: Subtree;
  doc?: LayoutDoc;
  palette?: string;
  branding?: LibraryBranding;
  previewLang?: string;
};

export type Library = { version: 1; items: LibraryItem[] };

export const TOMBSTONE_DAYS = 30;
export const LIBRARY_WARN_BYTES = 4.5 * 1024 * 1024;
export const LIBRARY_MAX_BYTES = 6 * 1024 * 1024;

export const emptyLibrary = (): Library => ({ version: 1, items: [] });

export function libId(): string {
  return `lib${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function validSubtree(v: unknown): Subtree | null {
  if (!isObj(v) || typeof v.root !== "string" || !isObj(v.nodes)) return null;
  const nodes = v.nodes as Record<string, LNode>;
  if (!isObj(nodes[v.root])) return null;
  for (const n of Object.values(nodes)) if (!isObj(n) || typeof n.id !== "string" || typeof n.type !== "string") return null;
  const out: Subtree = { root: v.root, nodes };
  if (isObj(v.i18n)) out.i18n = v.i18n as Dict;
  return out;
}

/** One raw item -> a valid item, or null. Never throws. */
export function normalizeItem(raw: unknown): LibraryItem | null {
  try {
    if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
    const kind = raw.kind === "template" ? "template" : raw.kind === "element" ? "element" : null;
    if (!kind) return null;
    const now = Date.now();
    const base: LibraryItem = {
      id: raw.id,
      kind,
      name: typeof raw.name === "string" ? raw.name.slice(0, 120) : "",
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string").slice(0, 20) : [],
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
      revision: typeof raw.revision === "number" && raw.revision >= 0 ? Math.floor(raw.revision) : 1,
    };
    if (typeof raw.description === "string" && raw.description) base.description = raw.description.slice(0, 500);
    if (raw.deleted === true) return { ...base, deleted: true };
    if (kind === "element") {
      const st = validSubtree(raw.subtree);
      if (!st) return null;
      base.subtree = st;
    } else {
      const doc = normalizeDoc(raw.doc);
      if (!doc) return null;
      base.doc = { ...doc, enabled: false };
      if (typeof raw.palette === "string") base.palette = raw.palette;
      if (isObj(raw.branding)) base.branding = brandingSubset(raw.branding);
      if (typeof raw.previewLang === "string") base.previewLang = raw.previewLang;
    }
    return base;
  } catch {
    return null;
  }
}

/** Tolerant: drops invalid items, keeps the first of duplicate ids, never throws. */
export function parseLibrary(text: string | null | undefined): Library {
  if (!text || typeof text !== "string") return emptyLibrary();
  try {
    const v: unknown = JSON.parse(text);
    return libraryFromUnknown(v);
  } catch {
    return emptyLibrary();
  }
}

function libraryFromUnknown(v: unknown): Library {
  const list = isObj(v) && Array.isArray(v.items) ? v.items : [];
  const seen = new Set<string>();
  const items: LibraryItem[] = [];
  for (const r of list) {
    const it = normalizeItem(r);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(it);
  }
  return { version: 1, items };
}

export function serializeLibrary(lib: Library): string {
  return JSON.stringify({ version: 1, items: lib.items });
}

export function librarySize(text: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length;
}

/** "refuse" above 6 MB, "warn" above 4.5 MB. */
export function sizeStatus(text: string): "ok" | "warn" | "refuse" {
  const n = librarySize(text);
  return n > LIBRARY_MAX_BYTES ? "refuse" : n > LIBRARY_WARN_BYTES ? "warn" : "ok";
}

export const liveItems = (lib: Library | LibraryItem[], kind?: LibraryItem["kind"]): LibraryItem[] =>
  (Array.isArray(lib) ? lib : lib.items).filter((i) => !i.deleted && (!kind || i.kind === kind));

export function brandingSubset(b: unknown): LibraryBranding {
  const out: Record<string, unknown> = {};
  if (!isObj(b)) return out as LibraryBranding;
  for (const k of BRANDING_KEYS) {
    const v = b[k];
    if (v === undefined) continue;
    if (k === "decorations" ? typeof v === "boolean" : typeof v === "string") out[k] = v;
  }
  return out as LibraryBranding;
}

// ---- building items

/** Keeps only the dictionary entries the nodes refer to as `tr.<key>`. */
export function pruneI18n(nodes: Record<string, LNode>, i18n: Dict | undefined): Dict | undefined {
  if (!i18n) return undefined;
  const json = JSON.stringify(nodes);
  const keys = new Set<string>();
  for (const m of json.matchAll(/\btr\.([A-Za-z0-9_]+)/g)) keys.add(m[1]);
  if (!keys.size) return undefined;
  const out: Dict = {};
  for (const [lang, m] of Object.entries(i18n)) {
    const kept: Record<string, string> = {};
    for (const k of keys) if (m && m[k] !== undefined) kept[k] = m[k];
    if (Object.keys(kept).length) out[lang] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

export type ItemMeta = { description?: string; tags?: string[] };

function newItemBase(kind: LibraryItem["kind"], name: string, meta: ItemMeta | undefined, now: number): LibraryItem {
  return {
    id: libId(),
    kind,
    name: name.trim() || (kind === "element" ? "Element" : "Template"),
    ...(meta?.description?.trim() ? { description: meta.description.trim() } : {}),
    tags: cleanTags(meta?.tags ?? []),
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}

export function cleanTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).slice(0, 20);
}

export const parseTags = (s: string): string[] => cleanTags(s.split(","));

/** The subtree of the selected nodes; several nodes are wrapped in a frame. Only referenced texts travel along. */
export function subtreeFromSelection(doc: LayoutDoc, ids: string[], wrapName = "Group"): Subtree | null {
  const picked = ids.filter((i) => i !== doc.root && doc.nodes[i]);
  // drop nodes whose ancestor is also selected
  const set = new Set(picked);
  const tops = picked.filter((id) => !Object.values(doc.nodes).some((p) => set.has(p.id) && p.id !== id && subtreeIds(doc, p.id).includes(id)));
  if (!tops.length) return null;
  let sub: Subtree;
  if (tops.length === 1) sub = extractSubtree(doc, tops[0]);
  else {
    const frame = newNode("frame", { name: wrapName, style: { mode: "stack", dir: "column", gap: 12, pad: 0, w: "fill" } });
    const nodes: Record<string, LNode> = {};
    for (const id of tops) Object.assign(nodes, extractSubtree(doc, id).nodes);
    frame.children = tops;
    nodes[frame.id] = frame;
    sub = { root: frame.id, nodes };
  }
  const i18n = pruneI18n(sub.nodes, doc.i18n);
  return i18n ? { ...sub, i18n: clone(i18n) } : sub;
}

export function itemFromSelection(doc: LayoutDoc, ids: string[], name: string, meta?: ItemMeta, now = Date.now()): LibraryItem | null {
  const sub = subtreeFromSelection(doc, ids, name || "Group");
  if (!sub) return null;
  return { ...newItemBase("element", name, meta, now), subtree: sub };
}

export function itemFromDoc(doc: LayoutDoc, palette: string | undefined, branding: unknown, name: string, meta?: ItemMeta & { previewLang?: string }, now = Date.now()): LibraryItem {
  const item: LibraryItem = { ...newItemBase("template", name, meta, now), doc: { ...clone(doc), enabled: false } };
  if (palette) item.palette = palette;
  if (branding !== undefined) {
    const b = brandingSubset(branding);
    if (Object.keys(b).length) item.branding = b;
  }
  if (meta?.previewLang) item.previewLang = meta.previewLang;
  return item;
}

/** A fresh copy for every insertion: new node ids, texts included. */
export function subtreeFromItem(item: LibraryItem): Subtree {
  const s = item.subtree;
  if (!s) throw new Error("not an element");
  return reidSubtree(clone(s));
}

export function docFromItem(item: LibraryItem): LayoutDoc {
  const d = item.doc;
  if (!d) throw new Error("not a template");
  const c = clone(d);
  const r = reidSubtree({ root: c.root, nodes: c.nodes });
  return { ...c, root: r.root, nodes: r.nodes, enabled: true };
}

// ---- edits (each bumps revision/updatedAt)

export function touch(item: LibraryItem, patch: Partial<LibraryItem>, now = Date.now()): LibraryItem {
  return { ...item, ...patch, id: item.id, kind: item.kind, createdAt: item.createdAt, revision: item.revision + 1, updatedAt: Math.max(now, item.updatedAt + 1) };
}

export function duplicateItem(item: LibraryItem, name: string, now = Date.now()): LibraryItem {
  const c = clone(item);
  delete c.deleted;
  return { ...c, id: libId(), name, createdAt: now, updatedAt: now, revision: 1 };
}

export function tombstone(item: LibraryItem, now = Date.now()): LibraryItem {
  return { id: item.id, kind: item.kind, name: "", tags: [], createdAt: item.createdAt, updatedAt: Math.max(now, item.updatedAt + 1), revision: item.revision + 1, deleted: true };
}

// ---- merge

const newer = (a: LibraryItem, b: LibraryItem): boolean => (a.updatedAt !== b.updatedAt ? a.updatedAt > b.updatedAt : a.revision > b.revision);

/** By id: the newer updatedAt (then higher revision) wins; on a full tie the remote copy stays. Old tombstones are dropped. */
export function mergeLibraries(local: Library, remote: Library, now = Date.now()): Library {
  const map = new Map<string, LibraryItem>();
  for (const it of remote.items) map.set(it.id, it);
  for (const it of local.items) {
    const r = map.get(it.id);
    if (!r || newer(it, r)) map.set(it.id, it);
  }
  const cutoff = now - TOMBSTONE_DAYS * 86400000;
  const items = [...map.values()].filter((i) => !(i.deleted && i.updatedAt < cutoff));
  return { version: 1, items };
}

// ---- export / import

export function exportLibrary(items: LibraryItem[]): string {
  return JSON.stringify({ version: 1, items: items.filter((i) => !i.deleted) }, null, 2);
}

/** Accepts a library file or a single item; ids that collide with existing ones (or repeat) are replaced by new ones. */
export function importLibrary(text: string, existingIds: Iterable<string> = []): { items: LibraryItem[]; skipped: number } {
  const taken = new Set(existingIds);
  let raws: unknown[] = [];
  try {
    const v: unknown = JSON.parse(text);
    if (isObj(v) && Array.isArray(v.items)) raws = v.items;
    else if (isObj(v) && typeof v.kind === "string") raws = [v];
  } catch {
    /* not JSON */
  }
  const items: LibraryItem[] = [];
  const now = Date.now();
  for (const r of raws) {
    const it = normalizeItem(r);
    if (!it || it.deleted) continue;
    if (taken.has(it.id)) it.id = libId();
    taken.add(it.id);
    it.updatedAt = now;
    items.push(it);
  }
  return { items, skipped: raws.length - items.length };
}
