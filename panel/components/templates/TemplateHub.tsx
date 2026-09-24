"use client";

import { Bookmark, Cloud, Download, Flag, HardDrive, Pencil, Search, Share2, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { TemplateSummary } from "@/components/templates/TemplateSummary";
import { Button, ConfirmDialog, Input, Modal, Segmented, SelectNative, Spinner, Textarea, useToast } from "@/components/ui";

export type HubKind = "inbound" | "xray_config";

export type HubTemplate = {
  id: string;
  kind: string;
  title: string;
  description: string;
  tags: string[];
  author: string;
  authorId: string;
  downloads: number;
  ratingAvg: number;
  ratingCount: number;
  sizeBytes: number;
  panelVersion: string;
  xrayVersion: string;
  createdAt: string;
  mine: boolean;
  myRating: number;
  status?: string;
  summary?: Record<string, unknown>;
};

type HubList = { items: HubTemplate[]; total: number; stale?: boolean; staleAt?: number };
type HubProfile = { panelId: string; displayName: string; anonymousName: string };

const PAGE = 12;
const LOCAL_PAGE = 20;

export type ImportMeta = { title: string };

type LocalTemplate = {
  id: number;
  kind: string;
  title: string;
  description: string;
  tags: string[];
  sizeBytes: number;
  sourceCloudId: string;
  createdAt: number;
  updatedAt: number;
  summary?: Record<string, unknown>;
};
type LocalList = { items: LocalTemplate[]; total: number };

function readSource(): "cloud" | "local" {
  try {
    return window.localStorage.getItem("sharx.tpl.source") === "local" ? "local" : "cloud";
  } catch {
    return "cloud";
  }
}
function storeSource(v: "cloud" | "local") {
  try {
    window.localStorage.setItem("sharx.tpl.source", v);
  } catch {
    /* per-viewer convenience only */
  }
}

function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function hub<T>(path: string, body?: unknown) {
  return postJson<T>(panel(`setting/templates/${path}`), body ?? {}, true);
}

/** True when the hub reported that it cannot be reached right now. */
function isUnavailable(r: { obj?: unknown }) {
  return (r.obj as { code?: string } | null | undefined)?.code === "hub_unavailable";
}

const UNAVAILABLE_FALLBACK = "Template service is temporarily unavailable. Please try again later.";

export function StarRating({
  value,
  onRate,
  disabled,
  size = 16,
}: {
  value: number;
  onRate?: (n: number) => void;
  disabled?: boolean;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled || !onRate}
          aria-label={`${n}`}
          className="p-0.5 disabled:cursor-default"
          onMouseEnter={() => onRate && !disabled && setHover(n)}
          onClick={() => onRate?.(n)}
        >
          <Star
            size={size}
            className={n <= shown ? "fill-amber-400 text-amber-400" : "text-[var(--fg-subtle)]"}
            strokeWidth={1.75}
          />
        </button>
      ))}
    </span>
  );
}

function kindLabel(t: (k: string, o?: Record<string, unknown>) => string, kind: string) {
  if (kind === "inbound") return t("pages.templates.kindInbound", { defaultValue: "Inbound" });
  if (kind === "xray_config") return t("pages.templates.kindXrayConfig", { defaultValue: "Xray core config" });
  return kind;
}


function LocalTemplateList({
  kind,
  onImport,
  onClose,
}: {
  kind: HubKind;
  onImport: (kind: HubKind, content: unknown, meta: ImportMeta) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [items, setItems] = useState<LocalTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ title: string; json: string } | null>(null);
  const [edit, setEdit] = useState<LocalTemplate | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalTemplate | null>(null);
  const [shareTarget, setShareTarget] = useState<LocalTemplate | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      setLoading(true);
      const r = await hub<LocalList>("local/list", { kind, q: query, limit: LOCAL_PAGE, offset });
      setLoading(false);
      if (!r.success || !r.obj) {
        toast.error(r.msg || t("fail"));
        return;
      }
      setTotal(r.obj.total);
      setItems((prev) => (append ? [...prev, ...r.obj!.items] : r.obj!.items));
    },
    [kind, query, t, toast],
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  const fetchContent = async (tpl: LocalTemplate) => {
    setBusyId(tpl.id);
    const r = await hub<{ content: unknown }>("local/get", { id: tpl.id });
    setBusyId(null);
    if (!r.success || !r.obj) {
      toast.error(r.msg || t("fail"));
      return null;
    }
    return r.obj.content;
  };

  const openEdit = (tpl: LocalTemplate) => {
    setEdit(tpl);
    setEditTitle(tpl.title);
    setEditDesc(tpl.description);
    setEditTags(tpl.tags.join(", "));
  };

  return (
    <>
      <p className="text-xs text-[var(--fg-muted)]">
        {t("pages.templates.localHint", {
          defaultValue:
            "Templates stored only in this panel for quick deployment. Clients, keys and passwords are not stored; they are generated on import.",
        })}
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" />
          <Input
            className="!pl-9"
            value={q}
            placeholder={t("pages.templates.search", { defaultValue: "Search templates" })}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="ml-auto text-xs text-[var(--fg-subtle)]">
          {t("pages.templates.total", { defaultValue: "{{n}} templates", n: total })}
        </span>
      </form>

      {loading && items.length === 0 ? (
        <div className="grid min-h-40 place-items-center">
          <Spinner size={32} />
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--fg-muted)]">
          {query
            ? t("pages.templates.localNoMatch", { defaultValue: "Nothing found." })
            : t("pages.templates.localEmpty", {
                defaultValue: "No local templates yet. Use \"Share / save\" on an inbound or the config editor, or save one from the cloud gallery.",
              })}
        </p>
      ) : (
        <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
          {items.map((tpl) => (
            <li key={tpl.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[var(--fg)]">{tpl.title}</span>
                {tpl.sourceCloudId ? (
                  <span className="rounded bg-[var(--surface-strong)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">
                    {t("pages.templates.fromCloud", { defaultValue: "from cloud" })}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">
                {new Date(tpl.createdAt * 1000).toLocaleDateString()} · {(tpl.sizeBytes / 1024).toFixed(1)} KB
              </div>
              <TemplateSummary kind={tpl.kind} summary={tpl.summary} />
              {tpl.description ? <p className="mt-1.5 text-sm text-[var(--fg-muted)]">{tpl.description}</p> : null}
              {tpl.tags.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {tpl.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  loading={busyId === tpl.id}
                  onClick={() =>
                    void (async () => {
                      const content = await fetchContent(tpl);
                      if (content == null) return;
                      onImport(kind, content, { title: tpl.title });
                      onClose();
                    })()
                  }
                >
                  {t("pages.templates.deploy", { defaultValue: "Use" })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyId === tpl.id}
                  onClick={() =>
                    void (async () => {
                      const content = await fetchContent(tpl);
                      if (content != null) setPreview({ title: tpl.title, json: JSON.stringify(content, null, 2) });
                    })()
                  }
                >
                  {t("pages.templates.viewJson", { defaultValue: "View JSON" })}
                </Button>
                <Button type="button" variant="secondary" className="!gap-1.5" onClick={() => openEdit(tpl)}>
                  <Pencil size={14} /> {t("edit", { defaultValue: "Edit" })}
                </Button>
                <Button type="button" variant="secondary" className="!gap-1.5" onClick={() => setShareTarget(tpl)}>
                  <Share2 size={14} /> {t("pages.templates.shareToCloud", { defaultValue: "Share to cloud" })}
                </Button>
                <Button type="button" variant="secondary" className="!gap-1.5" onClick={() => setDeleteTarget(tpl)}>
                  <Trash2 size={14} /> {t("delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length < total ? (
        <div className="flex justify-center">
          <Button type="button" variant="secondary" loading={loading} onClick={() => void load(items.length, true)}>
            {t("pages.templates.loadMore", { defaultValue: "Load more" })}
          </Button>
        </div>
      ) : null}

      <Modal open={preview !== null} onClose={() => setPreview(null)} title={preview?.title ?? ""} width={720}>
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-[var(--surface-strong)] p-3 text-xs">{preview?.json}</pre>
      </Modal>

      <Modal
        open={edit !== null}
        onClose={() => (saving ? undefined : setEdit(null))}
        title={t("pages.templates.editTitle", { defaultValue: "Edit template" })}
        width={520}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setEdit(null)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saving}
              disabled={editTitle.trim().length < 1}
              onClick={() =>
                void (async () => {
                  if (!edit) return;
                  setSaving(true);
                  const r = await hub<LocalTemplate>("local/update", {
                    id: edit.id,
                    title: editTitle.trim(),
                    description: editDesc.trim(),
                    tags: splitTags(editTags),
                  });
                  setSaving(false);
                  if (r.success && r.obj) {
                    setItems((prev) => prev.map((x) => (x.id === r.obj!.id ? r.obj! : x)));
                    setEdit(null);
                  } else toast.error(r.msg || t("fail"));
                })()
              }
            >
              {t("update", { defaultValue: "Save" })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <Input value={editTitle} maxLength={120} onChange={(e) => setEditTitle(e.target.value)} />
          <Textarea rows={3} maxLength={1000} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
          <Input
            value={editTags}
            placeholder={t("pages.templates.fieldTags", { defaultValue: "Tags (comma separated, up to 8)" })}
            onChange={(e) => setEditTags(e.target.value)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("delete")}
        description={t("pages.templates.confirmDeleteLocal", { defaultValue: "Delete this local template? This cannot be undone." })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const tpl = deleteTarget;
          setDeleteTarget(null);
          if (!tpl) return;
          void (async () => {
            const r = await hub("local/delete", { id: tpl.id });
            if (r.success) {
              setItems((prev) => prev.filter((x) => x.id !== tpl.id));
              setTotal((n) => Math.max(0, n - 1));
            } else toast.error(r.msg || t("fail"));
          })();
        }}
      />

      <ConfirmDialog
        open={shareTarget !== null}
        title={t("pages.templates.shareToCloud", { defaultValue: "Share to cloud" })}
        description={t("pages.templates.confirmShareLocal", {
          defaultValue:
            "Publish this template to the public gallery? It will be visible to everyone under your gallery name (or anonymously). Check the JSON first if unsure.",
        })}
        confirmLabel={t("pages.templates.publish", { defaultValue: "Publish" })}
        cancelLabel={t("cancel")}
        loading={sharing}
        onCancel={() => setShareTarget(null)}
        onConfirm={() => {
          const tpl = shareTarget;
          if (!tpl) return;
          void (async () => {
            setSharing(true);
            const r = await hub("local/share", { id: tpl.id });
            setSharing(false);
            setShareTarget(null);
            if (r.success) toast.success(t("pages.templates.published", { defaultValue: "Template published to the gallery" }));
            else toast.error(isUnavailable(r) ? t("pages.templates.unavailable", { defaultValue: UNAVAILABLE_FALLBACK }) : r.msg || t("fail"));
          })();
        }}
      />
    </>
  );
}

export function TemplateGalleryModal({
  open,
  onClose,
  kind,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  kind: HubKind;
  onImport: (kind: HubKind, content: unknown, meta: ImportMeta) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [source, setSource] = useState<"cloud" | "local">("cloud");
  useEffect(() => {
    if (open) setSource(readSource());
  }, [open]);
  const [items, setItems] = useState<HubTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("rating");
  const [mine, setMine] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ meta: HubTemplate; json: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HubTemplate | null>(null);
  const [reportTarget, setReportTarget] = useState<HubTemplate | null>(null);
  const [reportCategory, setReportCategory] = useState("unsafe");
  const [reportComment, setReportComment] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [staleAt, setStaleAt] = useState<number | null>(null);

  const failToast = useCallback(
    (r: { msg?: string; obj?: unknown }, fallback: string) => {
      toast.error(
        isUnavailable(r)
          ? t("pages.templates.unavailable", { defaultValue: UNAVAILABLE_FALLBACK })
          : r.msg || fallback,
      );
    },
    [t, toast],
  );

  const load = useCallback(
    async (offset: number, append: boolean) => {
      setLoading(true);
      const r = await hub<HubList>("list", { kind, sort, q: query, mine, limit: PAGE, offset });
      setLoading(false);
      if (!r.success || !r.obj) {
        if (isUnavailable(r)) {
          if (!append) {
            setItems([]);
            setTotal(0);
            setStaleAt(null);
          }
          setUnavailable(true);
        } else {
          toast.error(r.msg || t("pages.templates.loadError", { defaultValue: "Could not load templates" }));
        }
        return;
      }
      setUnavailable(false);
      setStaleAt(r.obj.stale && r.obj.staleAt ? r.obj.staleAt : null);
      setTotal(r.obj.total);
      setItems((prev) => (append ? [...prev, ...r.obj!.items] : r.obj!.items));
    },
    [kind, sort, query, mine, t, toast],
  );

  useEffect(() => {
    if (open) {
      setUnavailable(false);
      void load(0, false);
    }
  }, [open, load]);

  const update = (tpl: HubTemplate) => setItems((prev) => prev.map((x) => (x.id === tpl.id ? { ...x, ...tpl } : x)));

  const rate = async (tpl: HubTemplate, stars: number) => {
    setBusyId(tpl.id);
    const r = await hub<HubTemplate>("rate", { id: tpl.id, stars });
    setBusyId(null);
    if (r.success && r.obj) update(r.obj);
    else failToast(r, t("fail"));
  };

  const fetchContent = async (tpl: HubTemplate) => {
    setBusyId(tpl.id);
    const r = await hub<{ meta: HubTemplate; content: unknown }>("get", { id: tpl.id });
    setBusyId(null);
    if (!r.success || !r.obj) {
      failToast(r, t("fail"));
      return null;
    }
    return r.obj.content;
  };

  const doImport = async (tpl: HubTemplate) => {
    const content = await fetchContent(tpl);
    if (content == null) return;
    onImport(kind, content, tpl);
    onClose();
  };

  const saveLocal = async (tpl: HubTemplate) => {
    const content = await fetchContent(tpl);
    if (content == null) return;
    const r = await hub("local/saveContent", {
      kind: tpl.kind,
      title: tpl.title,
      description: tpl.description,
      tags: tpl.tags,
      content,
      sourceCloudId: tpl.id,
    });
    if (r.success) toast.success(t("pages.templates.savedLocal", { defaultValue: "Saved to local templates" }));
    else toast.error(r.msg || t("fail"));
  };

  const doPreview = async (tpl: HubTemplate) => {
    const content = await fetchContent(tpl);
    if (content != null) setPreview({ meta: tpl, json: JSON.stringify(content, null, 2) });
  };

  const totalLabel = useMemo(
    () => t("pages.templates.total", { defaultValue: "{{n}} templates", n: total }),
    [t, total],
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t("pages.templates.galleryTitle", { defaultValue: "Template gallery" })}
        width={860}
      >
        <div className="flex flex-col gap-3">
          <Segmented<"cloud" | "local">
            size="sm"
            layoutId="tpl-source"
            value={source}
            onChange={(v) => {
              setSource(v);
              storeSource(v);
            }}
            items={[
              { id: "cloud", label: t("pages.templates.sourceCloud", { defaultValue: "Cloud" }), icon: Cloud },
              { id: "local", label: t("pages.templates.sourceLocal", { defaultValue: "Local" }), icon: HardDrive },
            ]}
          />
          {source === "local" ? (
            <LocalTemplateList kind={kind} onImport={onImport} onClose={onClose} />
          ) : (
            <>
          <p className="text-xs text-[var(--fg-muted)]">
            {kind === "inbound"
              ? t("pages.templates.galleryHintInbound", {
                  defaultValue: "Inbound templates shared by other panels. Importing opens the inbound form so you can review it; keys are generated for you.",
                })
              : t("pages.templates.galleryHintConfig", {
                  defaultValue: "Xray core configs shared by other panels. Importing loads it into the editor without saving.",
                })}
          </p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q.trim());
            }}
          >
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" />
              <Input
                className="!pl-9"
                value={q}
                placeholder={t("pages.templates.search", { defaultValue: "Search templates" })}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <SelectNative value={sort} onChange={(e) => setSort(e.target.value)} aria-label="sort">
              <option value="rating">{t("pages.templates.sortRating", { defaultValue: "Top rated" })}</option>
              <option value="downloads">{t("pages.templates.sortDownloads", { defaultValue: "Most downloaded" })}</option>
              <option value="new">{t("pages.templates.sortNew", { defaultValue: "Newest" })}</option>
            </SelectNative>
            <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)]">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              {t("pages.templates.mineOnly", { defaultValue: "Only mine" })}
            </label>
            <span className="ml-auto text-xs text-[var(--fg-subtle)]">{totalLabel}</span>
          </form>

          {staleAt ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
              {t("pages.templates.staleNotice", {
                defaultValue: "The template service is unavailable. Showing the list saved at {{time}}; it may be out of date.",
                time: new Date(staleAt * 1000).toLocaleString(),
              })}
            </div>
          ) : null}
          {loading && items.length === 0 ? (
            <div className="grid min-h-40 place-items-center">
              <Spinner size={32} />
            </div>
          ) : unavailable && items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="max-w-md text-sm text-[var(--fg-muted)]">
                {t("pages.templates.unavailable", { defaultValue: UNAVAILABLE_FALLBACK })}
              </p>
              <Button type="button" variant="secondary" loading={loading} onClick={() => void load(0, false)}>
                {t("retry", { defaultValue: "Retry" })}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--fg-muted)]">
              {t("pages.templates.empty", { defaultValue: "No templates yet. Be the first to share one." })}
            </p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
              {items.map((tpl) => (
                <li key={tpl.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[var(--fg)]">{tpl.title}</span>
                        <span className="rounded bg-[var(--surface-strong)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">
                          {kindLabel(t, tpl.kind)}
                        </span>
                        {tpl.mine ? (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                            {t("pages.templates.yours", { defaultValue: "Yours" })}
                          </span>
                        ) : null}
                        {tpl.status === "hidden" ? (
                          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-300">
                            {t("pages.templates.hiddenBadge", { defaultValue: "Hidden after reports" })}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">
                        {tpl.author} · {new Date(tpl.createdAt).toLocaleDateString()}
                        {tpl.panelVersion ? ` · panel ${tpl.panelVersion}` : ""}
                        {tpl.xrayVersion ? ` · xray ${tpl.xrayVersion}` : ""} · {(tpl.sizeBytes / 1024).toFixed(1)} KB
                      </div>
                      <TemplateSummary kind={tpl.kind} summary={tpl.summary} />
                      {tpl.status === "hidden" ? (
                        <p className="mt-1.5 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-[var(--fg-muted)]">
                          {t("pages.templates.hiddenExplain", {
                            defaultValue:
                              "This template received reports and is not shown to others. It will stay hidden until the gallery administrator reviews it. You can delete it any time.",
                          })}
                        </p>
                      ) : null}
                      {tpl.description ? (
                        <p className="mt-1.5 text-sm text-[var(--fg-muted)]">{tpl.description}</p>
                      ) : null}
                      {tpl.tags.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {tpl.tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1 text-xs text-[var(--fg-muted)]">
                      <div className="flex items-center gap-1.5">
                        <StarRating
                          value={tpl.myRating || tpl.ratingAvg}
                          disabled={tpl.mine || busyId === tpl.id}
                          onRate={(n) => void rate(tpl, n)}
                        />
                      </div>
                      <span>
                        {tpl.ratingCount > 0
                          ? `${tpl.ratingAvg.toFixed(1)} (${tpl.ratingCount})`
                          : t("pages.templates.noRatings", { defaultValue: "No ratings" })}
                        {tpl.myRating ? ` · ${t("pages.templates.yourRating", { defaultValue: "you: {{n}}", n: tpl.myRating })}` : ""}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Download size={12} /> {tpl.downloads}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {tpl.status === "hidden" ? null : (
                      <>
                        <Button type="button" variant="secondary" className="!gap-1.5" disabled={busyId === tpl.id} onClick={() => void saveLocal(tpl)}>
                          <Bookmark size={14} /> {t("pages.templates.saveLocal", { defaultValue: "Save locally" })}
                        </Button>
                        <Button type="button" variant="primary" loading={busyId === tpl.id} onClick={() => void doImport(tpl)}>
                          {t("pages.templates.import", { defaultValue: "Import" })}
                        </Button>
                        <Button type="button" variant="secondary" disabled={busyId === tpl.id} onClick={() => void doPreview(tpl)}>
                          {t("pages.templates.viewJson", { defaultValue: "View JSON" })}
                        </Button>
                      </>
                    )}
                    {tpl.mine ? (
                      <Button type="button" variant="secondary" className="!gap-1.5" onClick={() => setDeleteTarget(tpl)}>
                        <Trash2 size={14} /> {t("delete")}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        className="!gap-1.5"
                        onClick={() => {
                          setReportCategory("unsafe");
                          setReportComment("");
                          setReportTarget(tpl);
                        }}
                      >
                        <Flag size={14} /> {t("pages.templates.report", { defaultValue: "Report" })}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {items.length < total ? (
            <div className="flex justify-center">
              <Button type="button" variant="secondary" loading={loading} onClick={() => void load(items.length, true)}>
                {t("pages.templates.loadMore", { defaultValue: "Load more" })}
              </Button>
            </div>
          ) : null}
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.meta.title ?? ""}
        width={720}
      >
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-[var(--surface-strong)] p-3 text-xs">{preview?.json}</pre>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("delete")}
        description={t("pages.templates.confirmDelete", { defaultValue: "Remove this template from the gallery?" })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const tpl = deleteTarget;
          setDeleteTarget(null);
          if (!tpl) return;
          void (async () => {
            const r = await hub("delete", { id: tpl.id });
            if (r.success) {
              setItems((prev) => prev.filter((x) => x.id !== tpl.id));
              setTotal((n) => Math.max(0, n - 1));
            } else failToast(r, t("fail"));
          })();
        }}
      />

      <Modal
        open={reportTarget !== null}
        onClose={() => (reportSending ? undefined : setReportTarget(null))}
        title={t("pages.templates.reportTitle", { defaultValue: "Report template" })}
        width={480}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setReportTarget(null)} disabled={reportSending}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={reportSending}
              onClick={() => {
                const tpl = reportTarget;
                if (!tpl) return;
                void (async () => {
                  setReportSending(true);
                  const r = await hub("report", { id: tpl.id, category: reportCategory, reason: reportComment.trim() });
                  setReportSending(false);
                  setReportTarget(null);
                  if (r.success) toast.success(t("pages.templates.reported", { defaultValue: "Thanks, the report was sent" }));
                  else failToast(r, t("fail"));
                })();
              }}
            >
              {t("pages.templates.report", { defaultValue: "Report" })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-[var(--fg-muted)]">
            {reportTarget?.title}
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
              {t("pages.templates.reportReason", { defaultValue: "Reason" })}
            </label>
            <SelectNative value={reportCategory} onChange={(e) => setReportCategory(e.target.value)}>
              <option value="unsafe">{t("pages.templates.reportUnsafe", { defaultValue: "Unsafe or malicious" })}</option>
              <option value="private_data">{t("pages.templates.reportPrivate", { defaultValue: "Contains private data" })}</option>
              <option value="spam">{t("pages.templates.reportSpam", { defaultValue: "Spam or junk" })}</option>
              <option value="duplicate">{t("pages.templates.reportDuplicate", { defaultValue: "Duplicate" })}</option>
              <option value="other">{t("pages.templates.reportOther", { defaultValue: "Other" })}</option>
            </SelectNative>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
              {t("pages.templates.reportComment", { defaultValue: "Comment (optional)" })}
            </label>
            <Textarea rows={3} maxLength={300} value={reportComment} onChange={(e) => setReportComment(e.target.value)} />
          </div>
          <p className="text-xs text-[var(--fg-subtle)]">
            {t("pages.templates.reportNote", {
              defaultValue: "Reports are reviewed by the gallery administrator. A template is hidden automatically after several reports from established panels.",
            })}
          </p>
        </div>
      </Modal>
    </>
  );
}

export function ShareTemplateModal({
  open,
  onClose,
  kind,
  inboundId,
  defaultTitle,
}: {
  open: boolean;
  onClose: () => void;
  kind: HubKind;
  inboundId?: number;
  defaultTitle?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [contentText, setContentText] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [profile, setProfile] = useState<HubProfile | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setWarnings([]);
    setContentText("");
    setDescription("");
    setTags("");
    setConfirmed(false);
    setOffline(false);
    setLoading(true);
    void (async () => {
      const [pv, pr] = await Promise.all([
        hub<{ content: unknown; warnings: string[]; suggestedTitle: string }>("preview", { kind, inboundId }),
        hub<HubProfile>("profile/get"),
      ]);
      setLoading(false);
      if (pr.success && pr.obj) {
        setProfile(pr.obj);
        setNameInput(pr.obj.displayName);
      } else if (isUnavailable(pr)) {
        setOffline(true);
      }
      if (!pv.success || !pv.obj) {
        setError(pv.msg || t("fail"));
        return;
      }
      setWarnings(pv.obj.warnings ?? []);
      setContentText(JSON.stringify(pv.obj.content, null, 2));
      setTitle((defaultTitle || pv.obj.suggestedTitle || "").trim());
    })();
  }, [open, kind, inboundId, defaultTitle, t]);

  const saveName = async () => {
    setSavingName(true);
    const r = await hub<HubProfile>("profile/set", { displayName: nameInput.trim() });
    setSavingName(false);
    if (r.success && r.obj) {
      setProfile(r.obj);
      toast.success(t("success"));
    } else toast.error(isUnavailable(r) ? t("pages.templates.unavailable", { defaultValue: UNAVAILABLE_FALLBACK }) : r.msg || t("fail"));
  };

  const publish = async () => {
    setPublishing(true);
    const tagList = tags
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const r = await hub("publish", { kind, inboundId, title: title.trim(), description: description.trim(), tags: tagList });
    setPublishing(false);
    if (r.success) {
      toast.success(t("pages.templates.published", { defaultValue: "Template published to the gallery" }));
      onClose();
    } else {
      toast.error(isUnavailable(r) ? t("pages.templates.unavailable", { defaultValue: UNAVAILABLE_FALLBACK }) : r.msg || t("fail"));
    }
  };

  const [savingLocal, setSavingLocal] = useState(false);
  const saveLocalOnly = async () => {
    setSavingLocal(true);
    const r = await hub("local/save", { kind, inboundId, title: title.trim(), description: description.trim(), tags: splitTags(tags) });
    setSavingLocal(false);
    if (r.success) {
      toast.success(t("pages.templates.savedLocal", { defaultValue: "Saved to local templates" }));
      onClose();
    } else toast.error(r.msg || t("fail"));
  };

  const publishAs = profile?.displayName || profile?.anonymousName || "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("pages.templates.shareTitle", { defaultValue: "Share or save template" })}
      width={680}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={savingLocal}
            disabled={loading || !!error || title.trim().length < 1}
            onClick={() => void saveLocalOnly()}
          >
            {t("pages.templates.saveLocalOnly", { defaultValue: "Save locally only" })}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={publishing}
            disabled={loading || !!error || offline || !confirmed || title.trim().length < 3}
            onClick={() => void publish()}
          >
            {t("pages.templates.publish", { defaultValue: "Publish" })}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="grid min-h-40 place-items-center">
          <Spinner size={32} />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-[var(--fg-muted)]">
            {t("pages.templates.shareHint", {
              defaultValue:
                "Clients, keys, passwords and certificates are removed automatically. Check the preview below before publishing: it is public.",
            })}
          </p>
          {offline ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs">
              {t("pages.templates.unavailable", { defaultValue: UNAVAILABLE_FALLBACK })}
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
              <div className="mb-1 font-medium">
                {t("pages.templates.removed", { defaultValue: "Removed before publishing:" })}
              </div>
              <ul className="list-disc space-y-0.5 pl-4">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
              {t("pages.templates.fieldTitle", { defaultValue: "Title" })}
            </label>
            <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
              {t("pages.templates.fieldDescription", { defaultValue: "Description" })}
            </label>
            <Textarea rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
              {t("pages.templates.fieldTags", { defaultValue: "Tags (comma separated, up to 8)" })}
            </label>
            <Input value={tags} placeholder="reality, vless, xhttp" onChange={(e) => setTags(e.target.value)} />
          </div>
          <div className="rounded-lg border border-[var(--border)] p-2.5">
            <div className="text-xs text-[var(--fg-muted)]">
              {t("pages.templates.publishAs", { defaultValue: "Publishing as" })}: <b className="text-[var(--fg)]">{publishAs}</b>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                className="max-w-xs"
                value={nameInput}
                maxLength={32}
                placeholder={t("pages.templates.namePlaceholder", { defaultValue: "Public name (empty = anonymous)" })}
                onChange={(e) => setNameInput(e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                loading={savingName}
                disabled={nameInput.trim() === (profile?.displayName ?? "")}
                onClick={() => void saveName()}
              >
                {t("pages.templates.saveName", { defaultValue: "Save name" })}
              </Button>
            </div>
          </div>
          <details className="rounded-lg border border-[var(--border)] p-2.5">
            <summary className="cursor-pointer text-xs font-medium text-[var(--fg-muted)]">
              {t("pages.templates.previewJson", { defaultValue: "What will be published (JSON)" })}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--surface-strong)] p-2 text-[11px]">{contentText}</pre>
          </details>
          <label className="flex items-start gap-2 text-xs text-[var(--fg-muted)]">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {t("pages.templates.confirmPublic", {
              defaultValue: "I checked the preview: it contains no personal data or secrets, and I agree to publish it publicly.",
            })}
          </label>
        </div>
      )}
    </Modal>
  );
}
