"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, Download, MoreVertical, Upload } from "lucide-react";
import type { PublicSubPayload } from "@/components/sub/types";
import type { SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";
import { itemFromDoc, itemFromSelection, parseTags, subtreeFromItem, type LibraryItem } from "@/lib/subLayout/library";
import type { LayoutDoc } from "@/lib/subLayout/types";
import type { Subtree } from "@/lib/subLayout/tree";
import type { D } from "./i18n";
import { CatalogTile, Thumb, type CatalogView, type Hover, type TileItem } from "./CatalogTile";
import { downloadJson, type LibraryStatus, type UseLibrary } from "./useLibrary";

// ------------------------------------------------------------------------------------
// Context: the designer hands the library and its actions to the Add tab
// ------------------------------------------------------------------------------------

export type LibraryCtxValue = {
  lib: UseLibrary;
  confirm: (text: string, ok: () => void) => void;
  hasSelection: boolean;
  /** Remembers that a freshly inserted root node came from a library item. */
  track: (rootId: string, itemId: string) => void;
  updateFromSelection: (item: LibraryItem) => void;
  editInCanvas: (item: LibraryItem) => void;
  editInfo: (item: LibraryItem) => void;
  notify: (msg: string, kind?: "success" | "error" | "info") => void;
};

export const LibraryCtx = createContext<LibraryCtxValue | null>(null);
export const useLibraryCtx = () => useContext(LibraryCtx);

const btn = "inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-40";
const primary = "h-8 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-white disabled:opacity-50";
const field = "h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-xs outline-none focus:border-[var(--accent)]";

// ------------------------------------------------------------------------------------
// Status + kebab
// ------------------------------------------------------------------------------------

export function LibraryStatusBadge({ d, status, error, onRetry }: { d: D; status: LibraryStatus; error?: string; onRetry: () => void }) {
  if (status === "offline") {
    return (
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-[11px] text-amber-400 underline" title={error}>
        <span className="size-1.5 rounded-full bg-amber-400" />
        {d("lib.status.offline", "Offline copy — retry")}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-subtle)]">
      <span className={`size-1.5 rounded-full ${status === "saving" ? "animate-pulse bg-sky-400" : "bg-emerald-400"}`} />
      {status === "saving" ? d("lib.status.saving", "Saving…") : d("lib.status.saved", "Saved to the panel")}
    </span>
  );
}

export type MenuEntry = { label: string; run: () => void; disabled?: boolean; danger?: boolean };

export function KebabMenu({ items, label, className }: { items: MenuEntry[]; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);
  return (
    <div ref={ref} className={`relative ${className ?? ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface)]/90 text-[var(--fg-muted)] hover:text-[var(--fg)]">
        <MoreVertical size={13} />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-7 z-30 w-48 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-2xl">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.run(); }} className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] disabled:opacity-35 ${it.danger ? "text-red-400 hover:bg-red-500/10" : "text-[var(--fg)] hover:bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]"}`}>
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------
// Element tiles (adapter from LibraryItem to the catalog tile)
// ------------------------------------------------------------------------------------

const adapters = new Map<string, TileItem>();
export function tileItemOf(it: LibraryItem, hintFallback = ""): TileItem {
  const key = `lib:${it.id}:${it.revision}:${it.updatedAt}`;
  let t = adapters.get(key);
  if (!t) {
    const hint = it.description || it.tags.join(", ") || hintFallback;
    t = { id: key, cat: "info", icon: "frame", en: [it.name, hint], ru: [it.name, hint], build: () => subtreeFromItem(it), direct: () => subtreeFromItem(it) };
    adapters.set(key, t);
  }
  return t;
}

const NO_TAGS = new Set<never>();
const NO_LABELS = {} as never;

type TilesProps = {
  d: D;
  view: CatalogView;
  L: "en" | "ru";
  lang: string;
  q: string;
  data: PublicSubPayload;
  config: SharxSubpageConfigV2 | null;
  onAdd: (build: () => Subtree) => void;
  onDragStart: (build: () => Subtree, label: string, e: { clientX: number; clientY: number }) => void;
  onHover: (h: Hover) => void;
};

export function LibraryElements({ d, view, L, lang, q, data, config, onAdd, onDragStart, onHover }: TilesProps) {
  const cx = useLibraryCtx();
  const fileRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (cx?.lib.elements ?? []).filter((i) => !needle || `${i.name} ${i.description ?? ""} ${i.tags.join(" ")}`.toLowerCase().includes(needle));
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [cx?.lib.elements, q]);
  if (!cx) return null;
  const { lib } = cx;
  const track = (it: LibraryItem, b: () => Subtree) => () => {
    const s = b();
    cx.track(s.root, it.id);
    return s;
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = lib.importItems(await f.text());
      cx.notify(r.added ? d("lib.imported", "Imported: %{n}", { n: r.added }) : d("lib.importNone", "Nothing to import in this file"), r.added ? "success" : "error");
    } catch {
      cx.notify(d("lib.importNone", "Nothing to import in this file"), "error");
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <div className="space-y-2" data-tour="library-section">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <LibraryStatusBadge d={d} status={lib.status} error={lib.error} onRetry={lib.reload} />
        <div className="flex gap-1">
          <button type="button" className={btn} onClick={() => fileRef.current?.click()}><Upload size={11} />{d("lib.import", "Import")}</button>
          <button type="button" className={btn} disabled={!lib.items.length} onClick={() => downloadJson("sharx-library.json", lib.exportItems())}><Download size={11} />{d("lib.exportAll", "Export all")}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void doImport(e.target.files?.[0])} />
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-3 text-[11.5px] leading-snug text-[var(--fg-muted)]">
          <div className="mb-1 flex items-center gap-1 font-medium text-[var(--fg)]"><BookmarkPlus size={13} />{d("lib.empty.title", "Your library is empty")}</div>
          {lib.loading ? d("lib.loading", "Loading…") : d("lib.empty.body", "Select an element on the canvas and press the bookmark button in the inspector (or Ctrl/⌘+Shift+S). It is stored in the panel and available to every admin from any browser.")}
        </div>
      ) : null}
      <div className={view === "grid" ? "grid grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5" : "flex flex-col gap-1.5"}>
        {items.map((it) => (
          <CatalogTile
            key={it.id}
            item={tileItemOf(it)}
            view={view}
            L={L}
            lang={lang}
            d={d}
            tags={NO_TAGS}
            tagLabels={NO_LABELS}
            catLabel={it.tags[0] ?? d("lib.mine", "My library")}
            fav={false}
            onFav={() => {}}
            hideFav
            onAdd={(b) => onAdd(track(it, b))}
            onDragStart={(b, l, e) => onDragStart(track(it, b), l, e)}
            data={data}
            config={config}
            onHover={onHover}
            menu={
              <KebabMenu
                label={d("lib.menu", "More")}
                items={[
                  { label: d("lib.editInfo", "Rename / edit info"), run: () => cx.editInfo(it) },
                  { label: d("lib.editCanvas", "Edit in canvas"), run: () => cx.editInCanvas(it) },
                  { label: d("lib.updateFromSel", "Update from selection"), run: () => cx.updateFromSelection(it), disabled: !cx.hasSelection },
                  { label: d("lib.duplicate", "Duplicate"), run: () => lib.duplicateItem(it.id, d("lib.copySuffix", "%{name} (copy)", { name: it.name })) },
                  { label: d("lib.exportJson", "Export JSON"), run: () => downloadJson(`${slug(it.name)}.json`, lib.exportItems([it.id])) },
                  { label: d("lib.delete", "Delete"), danger: true, run: () => cx.confirm(d("lib.confirmDelete", "Delete “%{name}” from the library?", { name: it.name }), () => lib.deleteItem(it.id)) },
                ]}
              />
            }
          />
        ))}
      </div>
    </div>
  );
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "") || "item";

// ------------------------------------------------------------------------------------
// Forms shown inside the designer's modal shell
// ------------------------------------------------------------------------------------

function Meta({ d, name, setName, desc, setDesc, tags, setTags }: { d: D; name: string; setName: (v: string) => void; desc: string; setDesc: (v: string) => void; tags: string; setTags: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-[11px] text-[var(--fg-muted)]">{d("lib.name", "Name")}
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${field} mt-1`} autoFocus maxLength={120} />
      </label>
      <label className="block text-[11px] text-[var(--fg-muted)]">{d("lib.description", "Description")}
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={500} className={`${field} mt-1 h-auto py-1.5`} />
      </label>
      <label className="block text-[11px] text-[var(--fg-muted)]">{d("lib.tags", "Tags (comma separated)")}
        <input value={tags} onChange={(e) => setTags(e.target.value)} className={`${field} mt-1`} />
      </label>
    </div>
  );
}

export function SaveElementForm({ d, doc, ids, lib, existing, data, config, lang, onDone, onCancel }: {
  d: D; doc: LayoutDoc; ids: string[]; lib: UseLibrary; existing?: LibraryItem; data: PublicSubPayload; config: SharxSubpageConfigV2 | null; lang: string;
  onDone: (item: LibraryItem, updated: boolean) => void; onCancel: () => void;
}) {
  const first = doc.nodes[ids[0]];
  const [name, setName] = useState(existing?.name ?? (ids.length > 1 ? d("lib.groupName", "Group") : first?.name || "Element"));
  const [desc, setDesc] = useState(existing?.description ?? "");
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const [mode, setMode] = useState<"update" | "new">(existing ? "update" : "new");
  const fresh = useMemo(() => itemFromSelection(doc, ids, name), [doc, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => (fresh ? tileItemOf({ ...fresh, id: `pending-${fresh.id}` }) : null), [fresh]);
  if (!fresh || !preview) return <p className="text-xs text-[var(--fg-muted)]">{d("lib.nothing", "Select an element first")}</p>;
  const save = () => {
    const meta = { description: desc.trim() || undefined, tags: parseTags(tags) };
    if (existing && mode === "update") {
      lib.updateItem(existing.id, { name: name.trim() || existing.name, description: meta.description, tags: meta.tags, subtree: fresh.subtree });
      onDone(existing, true);
    } else {
      const it = itemFromSelection(doc, ids, name, meta) as LibraryItem;
      lib.saveItem(it);
      onDone(it, false);
    }
  };
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_240px]">
      <div className="space-y-3">
        {existing ? (
          <div className="space-y-1 rounded-lg border border-[var(--border)] p-2 text-xs">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "update"} onChange={() => setMode("update")} />{d("lib.updateExisting", "Update existing “%{name}”", { name: existing.name })}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />{d("lib.saveNew", "Save as new")}</label>
          </div>
        ) : null}
        <Meta d={d} name={name} setName={setName} desc={desc} setDesc={setDesc} tags={tags} setTags={setTags} />
        <div className="flex justify-end gap-2">
          <button type="button" className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs" onClick={onCancel}>{d("cancel", "Cancel")}</button>
          <button type="button" className={primary} onClick={save}>{d("lib.save", "Save to library")}</button>
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] text-[var(--fg-muted)]">{d("lib.preview", "What will be saved")}</div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5">
          <Thumb item={preview} view="large" hot={false} data={data} config={config} lang={lang} />
        </div>
      </div>
    </div>
  );
}

export function SaveTemplateForm({ d, doc, palette, branding, lib, lang, onDone, onCancel }: {
  d: D; doc: LayoutDoc; palette: string | undefined; branding: unknown; lib: UseLibrary; lang: string; onDone: (item: LibraryItem) => void; onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [tags, setTags] = useState("");
  const [inc, setInc] = useState(true);
  const save = () => {
    const it = itemFromDoc(doc, inc ? palette : undefined, inc ? branding : undefined, name || d("lib.tplName", "My template"), { description: desc, tags: parseTags(tags), previewLang: lang });
    lib.saveItem(it);
    onDone(it);
  };
  return (
    <div className="space-y-3">
      <Meta d={d} name={name} setName={setName} desc={desc} setDesc={setDesc} tags={tags} setTags={setTags} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={inc} onChange={(e) => setInc(e.target.checked)} />{d("lib.includePalette", "Include palette & background")}</label>
      <div className="flex justify-end gap-2">
        <button type="button" className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs" onClick={onCancel}>{d("cancel", "Cancel")}</button>
        <button type="button" className={primary} onClick={save}>{d("lib.saveTemplate", "Save as template")}</button>
      </div>
    </div>
  );
}

export function EditInfoForm({ d, item, lib, onDone, onCancel }: { d: D; item: LibraryItem; lib: UseLibrary; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(item.name);
  const [desc, setDesc] = useState(item.description ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));
  return (
    <div className="space-y-3">
      <Meta d={d} name={name} setName={setName} desc={desc} setDesc={setDesc} tags={tags} setTags={setTags} />
      <div className="flex justify-end gap-2">
        <button type="button" className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs" onClick={onCancel}>{d("cancel", "Cancel")}</button>
        <button type="button" className={primary} onClick={() => { lib.updateItem(item.id, { name: name.trim() || item.name, description: desc.trim() || undefined, tags: parseTags(tags) }); onDone(); }}>{d("lib.saveInfo", "Save")}</button>
      </div>
    </div>
  );
}
