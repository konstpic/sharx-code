"use client";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookmarkPlus, Copy, Download, FileUp, LayoutDashboard, Pencil, Plus, Replace, Search, Trash2, Upload, Wand2 } from "lucide-react";
import { Button, ConfirmDialog, Input, Modal, Textarea, useToast } from "@/components/ui";
import { PresetThumb } from "@/components/dashboard/presets/PresetThumb";
import {
  GALLERY_FILTERS, MY_PRESETS_LIMIT, PRESETS, PRESET_SAMPLE_CTX, addMyPreset, buildMyPreset, deleteMyPreset, duplicateMyPreset, exportMyPreset, importMyPresets,
  renameMyPreset, type GalleryFilter, type MyPreset, type PresetCtx, type PresetEntry,
} from "@/lib/dashboardPresets";

/** What a card stands for: a registry preset or one of the user's own. */
export type PresetSource = { kind: "preset"; entry: PresetEntry } | { kind: "mine"; preset: MyPreset };

type Props = {
  open: boolean;
  onClose: () => void;
  ctx: PresetCtx;
  myPresets: MyPreset[];
  onMyPresets: (list: MyPreset[]) => void;
  /** 12 boards is the limit. */
  boardsFull: boolean;
  onCreate: (src: PresetSource) => void;
  onReplace: (src: PresetSource) => void;
  onLook: (entry: PresetEntry) => void;
  /** Saves the current board as a preset; false when nothing could be stored. */
  onSaveCurrent: (name: string, desc: string) => boolean;
};

const newId = () => "mp-" + crypto.randomUUID().slice(0, 8);
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${on ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"}`;

export function PresetGallery({ open, onClose, ctx, myPresets, onMyPresets, boardsFull, onCreate, onReplace, onLook, onSaveCurrent }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<PresetSource | null>(null);
  const [removing, setRemoving] = useState<MyPreset | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string; desc: string } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [paste, setPaste] = useState("");
  const [showImport, setShowImport] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const ctxFull: PresetCtx = { ...ctx, t };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: PRESETS.length + myPresets.length, mine: myPresets.length };
    for (const p of PRESETS) for (const g of p.tags) c[g] = (c[g] ?? 0) + 1;
    return c;
  }, [myPresets.length]);

  const cards = useMemo(() => {
    const list: { key: string; src: PresetSource; name: string; desc: string; tags: string[] }[] = [];
    if (filter !== "mine")
      for (const entry of PRESETS)
        if ((filter === "all" || entry.tags.includes(filter)) && (!q || `${t(entry.nameKey)} ${t(entry.descKey)}`.toLowerCase().includes(q)))
          list.push({ key: entry.id, src: { kind: "preset", entry }, name: t(entry.nameKey), desc: t(entry.descKey), tags: entry.tags });
    if (filter === "all" || filter === "mine")
      for (const preset of myPresets)
        if (!q || `${preset.name} ${preset.desc}`.toLowerCase().includes(q)) list.push({ key: "mine:" + preset.id, src: { kind: "mine", preset }, name: preset.name, desc: preset.desc, tags: ["mine"] });
    return list;
  }, [filter, q, myPresets, t]);

  const bundleOf = (src: PresetSource) => (src.kind === "preset" ? src.entry.build(src.entry.dynamic ? PRESET_SAMPLE_CTX : ctxFull) : buildMyPreset(src.preset, PRESET_SAMPLE_CTX));
  const countOf = (src: PresetSource) => (src.kind === "preset" ? src.entry.build(ctxFull).panels.length : buildMyPreset(src.preset, ctxFull).panels.length);

  const download = (p: MyPreset) => {
    try {
      const url = URL.createObjectURL(new Blob([exportMyPreset(p)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard-preset-${p.name.replace(/[^\w.-]+/g, "_").slice(0, 40) || "preset"}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t("pages.builder.presets.exported"));
    } catch {
      /* download blocked */
    }
  };

  const runImport = (text: string) => {
    const r = importMyPresets(text, newId, MY_PRESETS_LIMIT - myPresets.length);
    if (!r.ok) {
      toast.error(t("pages.builder.presets.importErr_" + r.error));
      return;
    }
    let list = myPresets;
    for (const p of r.presets) list = addMyPreset(list, p);
    onMyPresets(list);
    setPaste("");
    setShowImport(false);
    setFilter("mine");
    toast.success(t("pages.builder.presets.importOk"));
  };

  const readFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200 * 1024) {
      toast.error(t("pages.builder.presets.importErr_tooBig"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => runImport(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(f);
    if (file.current) file.current.value = "";
  };

  const full = myPresets.length >= MY_PRESETS_LIMIT;
  const small = "!h-8 !rounded-lg !px-2.5 !text-xs";

  return (
    <>
      <Modal open={open} onClose={onClose} title={t("pages.builder.presets.title")} width={1180}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)]" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("pages.builder.presets.search")} aria-label={t("pages.builder.presets.search")} className="!pl-9" />
          </div>
          <Button variant="secondary" className={small} onClick={() => setShowImport((v) => !v)} aria-expanded={showImport}>
            <Upload size={14} />
            {t("pages.builder.presets.import")}
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={t("pages.builder.presets.title")}>
          {GALLERY_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={chip(filter === f)}>
              {t("pages.builder.presets." + (f === "all" ? "filter_all" : "tag_" + f))}
              <span className="ml-1.5 tabular-nums opacity-60">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
        {showImport ? (
          <div className="mb-3 space-y-2 rounded-xl border border-dashed border-[var(--border)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
              <Button variant="secondary" className={small} onClick={() => file.current?.click()} disabled={full}>
                <FileUp size={14} />
                {t("pages.builder.presets.importFile")}
              </Button>
              <span className="text-[11px] text-[var(--fg-subtle)]">{t("pages.builder.presets.importHint")}</span>
            </div>
            <Textarea value={paste} onChange={(e) => setPaste(e.target.value.slice(0, 210 * 1024))} rows={3} placeholder={t("pages.builder.presets.importPaste")} aria-label={t("pages.builder.presets.importPaste")} className="!font-mono !text-xs" />
            <Button className={small} disabled={!paste.trim() || full} onClick={() => runImport(paste)}>
              {t("pages.builder.presets.importRun")}
            </Button>
          </div>
        ) : null}
        {filter === "mine" || filter === "all" ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-2">
            <Input value={saveName} maxLength={40} onChange={(e) => setSaveName(e.target.value)} placeholder={t("pages.builder.presets.saveName")} aria-label={t("pages.builder.presets.saveName")} className="!h-9 !w-52 !text-xs" />
            <Input value={saveDesc} maxLength={140} onChange={(e) => setSaveDesc(e.target.value)} placeholder={t("pages.builder.presets.saveDesc")} aria-label={t("pages.builder.presets.saveDesc")} className="!h-9 !min-w-48 !flex-1 !text-xs" />
            <Button
              variant="secondary"
              className="!h-9 !rounded-xl !text-xs"
              disabled={!saveName.trim() || full}
              title={full ? t("pages.builder.presets.limit") : undefined}
              onClick={() => {
                if (onSaveCurrent(saveName, saveDesc)) {
                  setSaveName("");
                  setSaveDesc("");
                  setFilter("mine");
                  toast.success(t("pages.builder.presets.saved"));
                }
              }}
            >
              <BookmarkPlus size={14} />
              {t("pages.builder.presets.saveCurrent")}
            </Button>
          </div>
        ) : null}
        <div className="grid max-h-[58vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ key, src, name, desc, tags }) => {
            const b = bundleOf(src);
            const mine = src.kind === "mine";
            const editing = renaming && mine && renaming.id === src.preset.id;
            return (
              <div key={key} className="dash-card flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] transition hover:border-[var(--accent)]">
                <div className="pointer-events-none h-[150px] overflow-hidden bg-[color-mix(in_oklab,var(--fg)_3%,transparent)]">
                  <PresetThumb panels={b.panels} tiles={b.tiles} rects={b.rects} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 border-t border-[var(--border)] px-3 pb-2 pt-2">
                  {editing ? (
                    <div className="space-y-1">
                      <Input value={renaming.name} maxLength={40} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} aria-label={t("pages.builder.presets.saveName")} className="!h-8 !text-xs" />
                      <Input value={renaming.desc} maxLength={140} onChange={(e) => setRenaming({ ...renaming, desc: e.target.value })} aria-label={t("pages.builder.presets.saveDesc")} className="!h-8 !text-xs" />
                      <div className="flex gap-1">
                        <Button className={small} onClick={() => { onMyPresets(renameMyPreset(myPresets, renaming.id, renaming.name, renaming.desc)); setRenaming(null); }}>
                          {t("confirm")}
                        </Button>
                        <Button variant="secondary" className={small} onClick={() => setRenaming(null)}>
                          {t("cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium" title={name}>{name}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--fg-subtle)]">{countOf(src)} {t("pages.builder.tilesCount")}</span>
                      </span>
                      <span className="line-clamp-2 min-h-[2.2em] text-[11px] leading-snug text-[var(--fg-subtle)]">{desc}</span>
                      <span className="flex flex-wrap gap-1">
                        {tags.map((g) => (
                          <span key={g} className="rounded-full bg-[color-mix(in_oklab,var(--fg)_6%,transparent)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]">{t("pages.builder.presets.tag_" + g)}</span>
                        ))}
                        {src.kind === "preset" && src.entry.dynamic ? <span className="rounded-full bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] px-2 py-0.5 text-[10px] text-[var(--accent)]">{t("pages.builder.presets.live")}</span> : null}
                      </span>
                    </>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5">
                    <Button className={small} disabled={boardsFull} title={boardsFull ? t("pages.builder.presets.boardsLimit") : undefined} onClick={() => { onCreate(src); onClose(); }}>
                      <Plus size={13} />
                      {t("pages.builder.presets.create")}
                    </Button>
                    <Button variant="secondary" className={small} onClick={() => setConfirm(src)}>
                      <Replace size={13} />
                      {t("pages.builder.presets.replace")}
                    </Button>
                    {src.kind === "preset" && src.entry.styled ? (
                      <Button variant="ghost" className={small} title={t("pages.builder.presets.lookHint")} onClick={() => { onLook(src.entry); toast.success(t("pages.builder.presets.lookDone")); }}>
                        <Wand2 size={13} />
                        {t("pages.builder.presets.look")}
                      </Button>
                    ) : null}
                    {mine ? (
                      <span className="ml-auto flex items-center">
                        {[
                          { icon: Pencil, label: t("pages.builder.presets.rename"), on: () => setRenaming({ id: src.preset.id, name: src.preset.name, desc: src.preset.desc }) },
                          { icon: Copy, label: t("pages.builder.presets.duplicate"), on: () => onMyPresets(duplicateMyPreset(myPresets, src.preset.id, newId(), t("pages.builder.presets.copySuffix"))), off: full },
                          { icon: Download, label: t("pages.builder.presets.export"), on: () => download(src.preset) },
                          { icon: Trash2, label: t("delete"), on: () => setRemoving(src.preset) },
                        ].map(({ icon: Icon, label, on, off }) => (
                          <button key={label} type="button" disabled={off} onClick={on} aria-label={label} title={label} className="grid size-7 place-items-center rounded-md text-[var(--fg-subtle)] transition hover:text-[var(--fg)] disabled:opacity-40">
                            <Icon size={14} />
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {!cards.length ? (
            <p className="col-span-full flex flex-col items-center gap-2 py-8 text-center text-sm text-[var(--fg-muted)]">
              <LayoutDashboard size={26} aria-hidden />
              {t(filter === "mine" && !q ? "pages.builder.presets.mineEmpty" : "noData")}
            </p>
          ) : null}
        </div>
      </Modal>
      <ConfirmDialog
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        open={confirm != null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) {
            onReplace(confirm);
            onClose();
          }
          setConfirm(null);
        }}
        title={t("pages.builder.presets.replace")}
        description={t("pages.builder.presets.replaceConfirm")}
      />
      <ConfirmDialog
        danger
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        open={removing != null}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) onMyPresets(deleteMyPreset(myPresets, removing.id));
          setRemoving(null);
        }}
        title={t("pages.builder.presets.deleteTitle")}
        description={removing?.name ?? ""}
      />
    </>
  );
}
