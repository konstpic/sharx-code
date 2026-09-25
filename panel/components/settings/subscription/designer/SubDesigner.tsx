"use client";

import { BookmarkPlus, Braces, Copy, Eye, Layers as LayersIcon, Palette as PaletteIcon, LayoutTemplate, Maximize2, Minus, Monitor, Plus, Redo2, Save, Smartphone, Tablet, Undo2, Variable, X, Boxes } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MOCK_SUB_DATA, type PublicSubPayload } from "@/components/sub/types";
import { panel } from "@/lib/paths";
import type { BlockAddToApp, SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";
import { buildLayoutContext } from "@/lib/subLayout/context";
import { presetDocI18n } from "@/lib/subLayout/presets";
import { useCatalogLocale } from "@/lib/subLayout/useCatalogLocale";
import { PAGE_TEMPLATES, type PageTemplate } from "@/lib/subLayout/templates";
import { SubPageShell } from "@/components/sub/SubPageShell";
import { LayoutRenderer } from "@/components/sub/layout/LayoutRenderer";
import { mergeDict } from "@/lib/subLayout/i18nCollect";
import { isPristineDefault, wowDoc } from "@/lib/subLayout/wow";
import { duplicateNode, extractSubtree, insertSubtree, isContainerType, normalizeDoc, parentOf, removeNode, reidSubtree, shiftNode, unwrapFrame, wrapInFrame, wrapInRow, type Subtree } from "@/lib/subLayout/tree";
import type { LayoutDoc } from "@/lib/subLayout/types";
import { docFromItem, itemFromDoc, itemFromSelection, subtreeFromItem, type LibraryItem } from "@/lib/subLayout/library";
import { useToast } from "@/components/ui";
import { SectionHelpModal } from "@/components/panel/SectionHelpModal";
import { Canvas, DEVICE_WIDTH, type CanvasHandle, type CanvasOps, type Device } from "./Canvas";
import { GridControls, useGridSettings } from "./GridControls";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { Palette } from "./Palette";
import { StylesPanel } from "./StylesPanel";
import { VariablesPanel } from "./VariablesPanel";
import { CodeEditor } from "./InspectorSections";
import { useD } from "./i18n";
import { EditInfoForm, KebabMenu, LibraryCtx, LibraryStatusBadge, SaveElementForm, SaveTemplateForm, slug, type LibraryCtxValue } from "./LibraryUI";
import { downloadJson, useLibrary } from "./useLibrary";
import { useDesignerState } from "./state";
import { InsertContext, SmallBtn, type InsertRegistry } from "./ui";
import { TourAutoStart, TourMenu, TourOverlay } from "./tour/DesignerTour";
import type { TourApi, TourSnapshot } from "./tour/tourLogic";
import { useTour } from "./tour/useTour";

type Props = {
  config: SharxSubpageConfigV2;
  onClose: () => void;
  /** Persists the config (with the new layout). Resolves true on success. */
  onSave: (cfg: SharxSubpageConfigV2) => Promise<boolean>;
  /** Mirrors the layout into the parent's state without saving. */
  onChange: (cfg: SharxSubpageConfigV2) => void;
};

type Left = "layers" | "add" | "vars" | "style";
type Modal = null | "presets" | "json" | "css";
type LibModal = null | { k: "element"; ids: string[]; existing?: LibraryItem } | { k: "template" } | { k: "info"; item: LibraryItem };

function initialDoc(cfg: SharxSubpageConfigV2): LayoutDoc {
  const raw = (cfg as { layout?: unknown }).layout;
  const norm = raw ? normalizeDoc(raw) : null;
  if (norm) return norm;
  return { ...wowDoc(typeof document !== "undefined" ? document.documentElement.lang : "en"), enabled: isPristineDefault(cfg) };
}

export function SubDesigner({ config: config0, onClose, onSave, onChange }: Props) {
  const [config, setConfig] = useState(config0);
  const [cfgDirty, setCfgDirty] = useState(false);
  const d = useD();
  const toast = useToast();
  const lib = useLibrary();
  const [libModal, setLibModal] = useState<LibModal>(null);
  const libMap = useRef(new Map<string, string>());
  const [grid, setGrid, toggleGrid] = useGridSettings();
  const lang0 = (typeof document !== "undefined" ? document.documentElement.lang : "en")?.slice(0, 2) || "en";
  const ds = useDesignerState(useMemo(() => initialDoc(config0), []) as LayoutDoc);
  const { state, commit, select } = ds;
  const doc = state.doc;

  const [left, setLeft] = useState<Left>("layers");
  const [device, setDevice] = useState<Device>("mobile");
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [bp, setBp] = useState<"base" | "mobile">("base");
  const [modal, setModal] = useState<Modal>(null);
  const [lang, setLang] = useState(lang0);
  const [data, setData] = useState<PublicSubPayload>(MOCK_SUB_DATA);
  const [subId, setSubId] = useState("");
  const [dataNote, setDataNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmAsk, setConfirmAsk] = useState<{ text: string; ok: () => void } | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [jsonErr, setJsonErr] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const clip = useRef<Subtree[]>([]);
  const reg = useRef<InsertRegistry["current"]>(null) as InsertRegistry;
  const docRef = useRef(doc);
  docRef.current = doc;
  const selRef = useRef(state.sel);
  selRef.current = state.sel;

  // ---- mount: lock page scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ---- fit zoom
  useEffect(() => {
    if (!fit) return;
    const el = scrollRef.current;
    if (!el) return;
    const calc = () => {
      const w = el.clientWidth - 64;
      setZoom(Math.max(0.3, Math.min(1, w / DEVICE_WIDTH[device])));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, device, left]);

  useEffect(() => {
    if (device === "mobile") setBp("base");
  }, [device]);

  const branding = config.branding as { title?: string; logoUrl?: string; brandText?: string; supportUrl?: string } | undefined;
  const bundledTr = useCatalogLocale(lang);
  const addToAppBlock = useMemo(() => config.blocks.find((b) => b.kind === "add-to-app" && b.enabled !== false) as BlockAddToApp | undefined, [config.blocks]);
  const ctx = useMemo(
    () => buildLayoutContext(data as never, { lang, preview: true, device, vars: doc.vars, branding, enabledApps: config.deepLinks?.enabledApps, addToApp: addToAppBlock, i18n: doc.i18n, bundledTr }),
    [data, lang, device, doc.vars, doc.i18n, bundledTr, branding, config.deepLinks?.enabledApps, addToAppBlock],
  );

  // ---- preview data
  const loadClient = async () => {
    const id = subId.trim();
    if (!id) {
      setData(MOCK_SUB_DATA);
      setDataNote("");
      return;
    }
    try {
      const res = await fetch(`${panel("api/public/subscription")}?id=${encodeURIComponent(id)}`);
      const j = await res.json();
      if (j && (j.user || j.links)) {
        setData(j as PublicSubPayload);
        setDataNote(d("data.real", "Real client data"));
      } else setDataNote(d("data.notFound", "Client not found"));
    } catch {
      setDataNote(d("data.notFound", "Client not found"));
    }
  };

  // ---- ops
  const addSub = useCallback(
    (build: () => Subtree, libraryId?: string) => {
      const cur = docRef.current;
      const sel = selRef.current;
      const built = build();
      const sub = reidSubtree(built);
      const lid = libraryId ?? libMap.current.get(built.root);
      if (lid) libMap.current.set(sub.root, lid);
      let parent = cur.root;
      let index = cur.nodes[cur.root]?.children?.length ?? 0;
      const s0 = sel[0] && cur.nodes[sel[0]];
      if (s0) {
        if (isContainerType(s0.type)) {
          parent = s0.id;
          index = s0.children?.length ?? 0;
        } else {
          const pid = parentOf(cur, s0.id);
          if (pid) {
            parent = pid;
            index = (cur.nodes[pid]?.children ?? []).indexOf(s0.id) + 1;
          }
        }
      }
      commit(insertSubtree(cur, parent, index, sub), { sel: [sub.root] });
    },
    [commit],
  );

  const openSaveElement = (ids: string[]) => {
    const cur = docRef.current;
    const picked = ids.filter((i) => i !== cur.root && cur.nodes[i]);
    if (!picked.length) return;
    const lid = picked.length === 1 ? libMap.current.get(picked[0]) : undefined;
    const existing = lid ? lib.byId(lid) : undefined;
    setLibModal({ k: "element", ids: picked, existing });
  };
  const openSaveRef = useRef(openSaveElement);
  openSaveRef.current = openSaveElement;

  const ops: CanvasOps = useMemo(
    () => ({
      select,
      commit,
      remove: (ids) => {
        let next = docRef.current;
        for (const id of ids) if (id !== next.root && next.nodes[id]) next = removeNode(next, id);
        commit(next, { sel: [] });
      },
      duplicate: (ids) => {
        let next = docRef.current;
        const out: string[] = [];
        for (const id of ids) {
          const r = duplicateNode(next, id);
          if (r) {
            next = r.doc;
            out.push(r.id);
          }
        }
        if (out.length) commit(next, { sel: out });
      },
      group: (ids) => {
        const r = wrapInFrame(docRef.current, ids);
        if (r) commit(r.doc, { sel: [r.id] });
      },
      wrapRow: (ids) => {
        const r = wrapInRow(docRef.current, ids);
        if (r) commit(r.doc, { sel: [r.id] });
      },
      ungroup: (id) => commit(unwrapFrame(docRef.current, id), { sel: [] }),
      copy: (ids) => {
        clip.current = ids.filter((i) => i !== docRef.current.root).map((i) => extractSubtree(docRef.current, i));
      },
      paste: () => {
        if (!clip.current.length) return;
        let next = docRef.current;
        const out: string[] = [];
        const sel = selRef.current[0];
        const cur = sel ? next.nodes[sel] : undefined;
        let parent = next.root;
        let index = next.nodes[next.root]?.children?.length ?? 0;
        if (cur) {
          if (isContainerType(cur.type)) {
            parent = cur.id;
            index = cur.children?.length ?? 0;
          } else {
            const pid = parentOf(next, cur.id);
            if (pid) {
              parent = pid;
              index = (next.nodes[pid]?.children ?? []).indexOf(cur.id) + 1;
            }
          }
        }
        for (const sub of clip.current) {
          const s = reidSubtree(sub);
          next = insertSubtree(next, parent, index++, s);
          out.push(s.root);
        }
        commit(next, { sel: out });
      },
      shift: (id, delta) => commit(shiftNode(docRef.current, id, delta)),
      saveToLibrary: (ids) => openSaveRef.current(ids),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, select],
  );

  // ---- shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || !!t.closest(".monaco-editor"));
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (e.key === "Escape" && !modal && !libModal) {
        if (typing) return;
        if (selRef.current.length) select([]);
        else onClose();
        return;
      }
      if (typing) return;
      const sel = selRef.current;
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) ds.redo();
        else ds.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        ds.redo();
      } else if (mod && k === "d" && sel.length) {
        e.preventDefault();
        ops.duplicate(sel);
      } else if (mod && k === "c" && sel.length) {
        ops.copy(sel);
      } else if (mod && k === "v") {
        ops.paste();
      } else if (mod && k === "g" && sel.length) {
        e.preventDefault();
        if (e.shiftKey) ops.ungroup(sel[0]);
        else ops.group(sel);
      } else if (mod && e.shiftKey && k === "r" && sel.length) {
        e.preventDefault();
        ops.wrapRow(sel);
      } else if (!mod && !e.altKey && !e.shiftKey && k === "g") {
        e.preventDefault();
        toggleGrid();
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel.length) {
        e.preventDefault();
        ops.remove(sel);
      } else if (mod && e.shiftKey && k === "s") {
        e.preventDefault();
        if (sel.length) openSaveRef.current(sel);
      } else if (mod && k === "s") {
        e.preventDefault();
        void doSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, libModal, ops, toggleGrid, ds.undo, ds.redo]);

  const toConfig = (dc: LayoutDoc) => ({ ...config, layout: dc as unknown as Record<string, unknown> }) as SharxSubpageConfigV2;

  useEffect(() => {
    onChange(toConfig(doc));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, config]);

  const doSave = async () => {
    setSaving(true);
    const ok = await onSave(toConfig(docRef.current));
    setSaving(false);
    if (ok) {
      ds.saved();
      setCfgDirty(false);
    }
  };

  const requestClose = () => {
    if (state.dirty || cfgDirty) {
      setConfirmAsk({ text: d("confirmClose", "You have unsaved changes. Close the designer anyway?"), ok: onClose });
      return;
    }
    onClose();
  };

  const openJson = () => {
    setJsonText(JSON.stringify(doc, null, 2));
    setJsonErr("");
    setModal("json");
  };

  const applyJson = () => {
    try {
      const n = normalizeDoc(JSON.parse(jsonText));
      if (!n) throw new Error(d("json.bad", "Not a valid layout document"));
      commit(n, { sel: [] });
      setModal(null);
    } catch (e) {
      setJsonErr(String((e as Error).message));
    }
  };

  const applyTemplate = (t: PageTemplate | LibraryItem | "classic") => {
    const run = () => {
      const p = t === "classic" ? presetDocI18n("classic") : "kind" in t ? docFromItem(t) : t.build();
      commit({ ...p, enabled: doc.enabled, vars: { ...p.vars, ...doc.vars }, css: doc.css, i18n: mergeDict(doc.i18n, p.i18n) }, { sel: [] });
      if (t !== "classic") {
        if ("kind" in t) {
          if (t.palette || t.branding) {
            setConfig((c) => ({ ...c, ...(t.palette ? { colorPreset: t.palette } : {}), ...(t.branding ? { branding: { ...c.branding, ...t.branding } } : {}) }) as SharxSubpageConfigV2);
            setCfgDirty(true);
          }
        } else {
          setConfig((c) => ({ ...c, colorPreset: t.palette }));
          setCfgDirty(true);
        }
      }
      setModal(null);
    };
    if (Object.keys(doc.nodes).length > 2) setConfirmAsk({ text: d("preset.confirm", "Replace the current layout with this template? You can undo it."), ok: run });
    else run();
  };

  const sel0 = state.sel.filter((i) => i !== doc.root && doc.nodes[i]);
  const libCtx: LibraryCtxValue = {
    lib,
    confirm: (text, ok) => setConfirmAsk({ text, ok }),
    hasSelection: sel0.length > 0,
    track: (rootId, itemId) => { libMap.current.set(rootId, itemId); },
    updateFromSelection: (item) => {
      const cur = docRef.current;
      const st = itemFromSelection(cur, selRef.current.filter((i) => i !== cur.root), item.name);
      if (!st) return;
      setConfirmAsk({ text: d("lib.confirmUpdate", "Replace “%{name}” with the current selection?", { name: item.name }), ok: () => { lib.updateItem(item.id, { subtree: st.subtree }); toast.success(d("lib.updated", "Library item updated")); } });
    },
    editInCanvas: (item) => addSub(() => subtreeFromItem(item), item.id),
    editInfo: (item) => setLibModal({ k: "info", item }),
    notify: (msg, kind = "info") => toast[kind](msg),
  };
  const errShown = useRef("");
  useEffect(() => {
    if (lib.error && lib.error !== errShown.current) toast.error(d("lib.saveFailed", "Could not sync the library with the panel; your changes are kept in this browser."));
    errShown.current = lib.error;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.error]);

  const canvasOps = ops;
  const sel = state.sel;
  const nodeCount = useMemo(() => Object.keys(doc.nodes).length, [doc.nodes]);
  const selKey = sel.join(",");
  const tourSnap: TourSnapshot = useMemo(
    () => ({ left, device, selKey, nodes: nodeCount, grid: grid.enabled, modal, bp, enabled: doc.enabled }),
    [left, device, selKey, nodeCount, grid.enabled, modal, bp, doc.enabled],
  );
  const tourApi: TourApi = useMemo(
    () => ({ setLeft, setDevice, setModal: (m) => setModal(m), select }),
    [select],
  );
  const tour = useTour(tourSnap, tourApi);
  const w = DEVICE_WIDTH[device];

  const node = (
    <InsertContext.Provider value={reg}>
      <LibraryCtx.Provider value={libCtx}>
      <div className="fixed inset-0 z-[300] flex flex-col bg-[var(--bg)] text-[var(--fg)]" role="dialog" aria-label={d("title", "Subscription page designer")}>
        {/* toolbar */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3">
          <button type="button" onClick={requestClose} className="grid size-8 place-items-center rounded-lg text-[var(--fg-muted)] hover:bg-[var(--surface)]" title={d("close", "Close")} aria-label={d("close", "Close")}>
            <X size={17} />
          </button>
          <div className="hidden text-sm font-semibold sm:block">{d("title", "Subscription page designer")}</div>
          <div className="mx-1 h-5 w-px bg-[var(--border)]" />
          <div data-tour="undo-redo" className="flex items-center gap-2">
            <SmallBtn title={d("undo", "Undo (⌘Z)")} onClick={ds.undo} disabled={!ds.canUndo}><Undo2 size={15} /></SmallBtn>
            <SmallBtn title={d("redo", "Redo (⇧⌘Z)")} onClick={ds.redo} disabled={!ds.canRedo}><Redo2 size={15} /></SmallBtn>
          </div>
          <div className="mx-1 h-5 w-px bg-[var(--border)]" />
          <GridControls grid={grid} onChange={setGrid} d={d} />
          <div data-tour="device-switch" className="flex rounded-lg border border-[var(--border)] p-0.5">
            {([["mobile", Smartphone], ["tablet", Tablet], ["desktop", Monitor]] as const).map(([id, Ico]) => (
              <button key={id} type="button" title={d(`dev.${id}`, id)} aria-pressed={device === id} onClick={() => setDevice(id)} className={`grid size-7 place-items-center rounded-md ${device === id ? "bg-[var(--accent)] text-white" : "text-[var(--fg-muted)] hover:bg-[var(--surface)]"}`}>
                <Ico size={15} />
              </button>
            ))}
          </div>
          <span className="hidden text-[11px] tabular-nums text-[var(--fg-subtle)] md:inline">{w}px</span>
          <div data-tour="zoom" className="hidden items-center gap-0.5 md:flex">
            <SmallBtn title={d("zoomOut", "Zoom out")} onClick={() => { setFit(false); setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2))); }}><Minus size={14} /></SmallBtn>
            <button type="button" className="w-11 text-center text-[11px] tabular-nums text-[var(--fg-muted)]" onClick={() => { setFit(false); setZoom(1); }} title="100%">{Math.round(zoom * 100)}%</button>
            <SmallBtn title={d("zoomIn", "Zoom in")} onClick={() => { setFit(false); setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2))); }}><Plus size={14} /></SmallBtn>
            <SmallBtn title={d("fit", "Fit to screen")} active={fit} onClick={() => setFit(true)}><Maximize2 size={14} /></SmallBtn>
          </div>
          <div className="flex-1" />
          <select data-tour="preview-lang" value={lang} onChange={(e) => setLang(e.target.value)} className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 text-xs" aria-label={d("previewLang", "Preview language")}>
            {Array.from(new Set(["en", "ru", ...((config.locales as string[]) ?? []), lang])).map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
          <div className="hidden items-center gap-1 lg:flex">
            <input data-tour="client-id-input" value={subId} onChange={(e) => setSubId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void loadClient()} placeholder={d("data.placeholder", "Client subId → real data")} className="h-8 w-44 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-xs outline-none focus:border-[var(--accent)]" aria-label={d("data.placeholder", "Client subId → real data")} />
            <SmallBtn title={d("data.load", "Load")} onClick={() => void loadClient()}><Eye size={14} /></SmallBtn>
            {dataNote ? <span className="text-[11px] text-[var(--fg-subtle)]">{dataNote}</span> : null}
          </div>
          <TourAutoStart tour={tour} />
          <SectionHelpModal
            scene="subpage"
            sectionId="subpage-designer"
            portalClassName="!z-[400]"
            titleKey="subBuilder.designer.helpTitle"
            paragraphKeys={["subBuilder.designer.helpP1", "subBuilder.designer.helpP2", "subBuilder.designer.helpP3"]}
          />
          <TourMenu tour={tour} d={d} />
          <span data-tour="templates-button" className="inline-flex"><SmallBtn title={d("presets", "Templates")} onClick={() => setModal("presets")}><LayoutTemplate size={15} /></SmallBtn></span>
          <SmallBtn title={d("lib.saveTemplateTip", "Save the page as a template")} onClick={() => setLibModal({ k: "template" })}><BookmarkPlus size={15} /></SmallBtn>
          <SmallBtn title={d("css", "Page CSS")} onClick={() => setModal("css")}><Braces size={15} /></SmallBtn>
          <SmallBtn title="JSON" onClick={openJson}><Copy size={15} /></SmallBtn>
          <label data-tour="publish-toggle" className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1 text-xs" title={d("publishHint", "When on, the public page uses this layout instead of the classic blocks")}>
            <input type="checkbox" checked={doc.enabled} onChange={(e) => commit({ ...doc, enabled: e.target.checked })} />
            {d("publish", "Use on page")}
          </label>
          <button type="button" data-tour="save-button" onClick={() => void doSave()} disabled={saving} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-white disabled:opacity-60">
            <Save size={14} />
            {saving ? d("saving", "Saving…") : state.dirty || cfgDirty ? d("save", "Save") + " •" : d("save", "Save")}
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* left */}
          <aside className="flex w-[300px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)]">
            <div className="flex shrink-0 border-b border-[var(--border)]">
              {([["layers", LayersIcon, d("tab.layers", "Layers")], ["add", Boxes, d("tab.add", "Add")], ["vars", Variable, d("tab.vars", "Variables")], ["style", PaletteIcon, d("tab.style", "Styles")]] as const).map(([id, Ico, label]) => (
                <button key={id} type="button" data-tour={`tab-${id}`} onClick={() => setLeft(id)} className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-[11px] font-medium ${left === id ? "border-b-2 border-[var(--accent)] text-[var(--fg)]" : "text-[var(--fg-muted)]"}`}>
                  <Ico size={14} />
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" data-tour={`${left}-panel`}>
              {left === "layers" ? (
                <Layers doc={doc} sel={sel} select={select} commit={commit} d={d} />
              ) : left === "add" ? (
                <Palette d={d} lang={lang} data={data} config={config} onAdd={addSub} onDragStart={(b, label, e) => canvasRef.current?.startNewDrag(b, label, e)} />
              ) : left === "style" ? (
                <StylesPanel config={config} onChange={(c) => { setConfig(c); setCfgDirty(true); }} d={d} lang={lang} />
              ) : (
                <VariablesPanel doc={doc} langs={Array.from(new Set(["en", "ru", ...((config.locales as string[]) ?? [])]))} ctx={ctx} lang={lang} d={d} commit={commit} />
              )}
            </div>
          </aside>

          {/* canvas */}
          <div ref={scrollRef} data-tour="canvas" className="relative min-w-0 flex-1 overflow-auto bg-[color-mix(in_oklab,var(--bg)_88%,var(--fg)_12%)]" onPointerDown={(e) => { if (e.target === e.currentTarget) select([]); }}>
            <div className="mx-auto w-fit px-8 py-8" onPointerDown={(e) => { if (e.target === e.currentTarget) select([]); }}>
              <Canvas ref={canvasRef} doc={doc} sel={sel} data={data} config={config} device={device} zoom={zoom} bp={bp} ops={canvasOps} d={d} lang={lang} grid={grid} />
            </div>
          </div>

          {/* right */}
          <aside data-tour="inspector" className="w-[320px] shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-elevated)]">
            <Inspector doc={doc} sel={sel} ctx={ctx} lang={lang} bp={bp} setBp={setBp} commit={commit} d={d} onDelete={() => ops.remove(sel)} onDuplicate={() => ops.duplicate(sel)} onSaveToLibrary={() => openSaveElement(sel)} />
          </aside>
        </div>

        {modal === "presets" ? (
          <ModalShell wide title={d("presets", "Templates")} onClose={() => setModal(null)}>
            <p className="mb-3 text-xs text-[var(--fg-muted)]">{d("preset.hint2", "Pick a page template. It also switches the palette it was designed for; you can change everything afterwards and undo it.")}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {PAGE_TEMPLATES.map((t) => (
                <TemplateCard key={t.id} sig={t.id} title={lang === "ru" ? t.ru[0] : t.en[0]} hint={lang === "ru" ? t.ru[1] : t.en[1]} build={t.build} palette={t.palette} data={data} config={config} lang={lang} onPick={() => applyTemplate(t)} />
              ))}
              <button type="button" onClick={() => applyTemplate("classic")} className="flex min-h-[120px] flex-col justify-center rounded-xl border border-dashed border-[var(--border)] p-3 text-left hover:border-[var(--accent)]">
                <div className="text-sm font-semibold">{d("preset.classic", "Classic")}</div>
                <div className="mt-1 text-xs text-[var(--fg-muted)]">{d("preset.classic.hint", "Your current blocks as an editable layout")}</div>
              </button>
            </div>
            <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">{d("lib.myTemplates", "My templates")} <span className="text-xs font-normal text-[var(--fg-subtle)]">{lib.templates.length}</span></div>
              <LibraryStatusBadge d={d} status={lib.status} error={lib.error} onRetry={lib.reload} />
            </div>
            {lib.templates.length === 0 ? <p className="text-xs text-[var(--fg-muted)]">{d("lib.tplEmpty", "Nothing here yet. Build a page and press the bookmark button in the toolbar to save it as a template.")}</p> : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {[...lib.templates].sort((a, b) => b.updatedAt - a.updatedAt).map((it) => (
                <TemplateCard
                  key={it.id}
                  sig={`${it.id}:${it.revision}`}
                  title={it.name}
                  hint={it.description || it.tags.join(", ")}
                  build={() => docFromItem(it)}
                  palette={it.palette}
                  brandingOverride={it.branding}
                  data={data}
                  config={config}
                  lang={lang}
                  onPick={() => applyTemplate(it)}
                  menu={
                    <KebabMenu
                      label={d("lib.menu", "More")}
                      items={[
                        { label: d("lib.editInfo", "Rename / edit info"), run: () => setLibModal({ k: "info", item: it }) },
                        { label: d("lib.duplicate", "Duplicate"), run: () => lib.duplicateItem(it.id, d("lib.copySuffix", "%{name} (copy)", { name: it.name })) },
                        { label: d("lib.updateFromPage", "Update from current page"), run: () => setConfirmAsk({ text: d("lib.confirmUpdateTpl", "Replace “%{name}” with the current page?", { name: it.name }), ok: () => {
                          const n = itemFromDoc(docRef.current, it.palette ? config.colorPreset : undefined, it.branding ? config.branding : undefined, it.name);
                          lib.updateItem(it.id, { doc: n.doc, palette: n.palette, branding: n.branding });
                          toast.success(d("lib.updated", "Library item updated"));
                        } }) },
                        { label: d("lib.exportJson", "Export JSON"), run: () => downloadJson(`${slug(it.name)}.json`, lib.exportItems([it.id])) },
                        { label: d("lib.delete", "Delete"), danger: true, run: () => setConfirmAsk({ text: d("lib.confirmDelete", "Delete “%{name}” from the library?", { name: it.name }), ok: () => lib.deleteItem(it.id) }) },
                      ]}
                    />
                  }
                />
              ))}
            </div>
          </ModalShell>
        ) : null}
        {libModal ? (
          <ModalShell
            title={libModal.k === "element" ? d("lib.saveElementTitle", "Save to library") : libModal.k === "template" ? d("lib.saveTemplateTitle", "Save the page as a template") : d("lib.editInfo", "Rename / edit info")}
            onClose={() => setLibModal(null)}
          >
            {libModal.k === "element" ? (
              <SaveElementForm d={d} doc={doc} ids={libModal.ids} lib={lib} existing={libModal.existing} data={data} config={config} lang={lang}
                onCancel={() => setLibModal(null)}
                onDone={(it, updated) => { if (libModal.ids.length === 1) libMap.current.set(libModal.ids[0], it.id); setLibModal(null); toast.success(updated ? d("lib.updated", "Library item updated") : d("lib.saved", "Saved to the library")); }} />
            ) : libModal.k === "template" ? (
              <SaveTemplateForm d={d} doc={doc} palette={config.colorPreset} branding={config.branding} lib={lib} lang={lang}
                onCancel={() => setLibModal(null)}
                onDone={() => { setLibModal(null); toast.success(d("lib.saved", "Saved to the library")); }} />
            ) : (
              <EditInfoForm d={d} item={libModal.item} lib={lib} onCancel={() => setLibModal(null)} onDone={() => setLibModal(null)} />
            )}
          </ModalShell>
        ) : null}
        {confirmAsk ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-2xl" role="alertdialog" aria-label={confirmAsk.text}>
              <p className="text-sm">{confirmAsk.text}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs" onClick={() => setConfirmAsk(null)}>{d("cancel", "Cancel")}</button>
                <button type="button" className="h-8 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-white" onClick={() => { const f = confirmAsk.ok; setConfirmAsk(null); f(); }}>{d("ok", "Yes")}</button>
              </div>
            </div>
          </div>
        ) : null}
        {modal === "css" ? (
          <ModalShell title={d("css", "Page CSS")} onClose={() => setModal(null)}>
            <p className="mb-2 text-xs text-[var(--fg-muted)]">{d("css.hint", "Extra CSS for the whole layout. Scope with .sublyt. Use classes from a node's CSS class field.")}</p>
            <CodeEditor value={doc.css ?? ""} onChange={(v) => commit({ ...doc, css: v }, { key: "pagecss" })} language="css" height={360} />
          </ModalShell>
        ) : null}
        {modal === "json" ? (
          <ModalShell title="JSON" onClose={() => setModal(null)}>
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <CodeEditor value={jsonText} onChange={setJsonText} language="json" height={380} />
            </div>
            {jsonErr ? <p className="mt-2 text-xs text-red-400">{jsonErr}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="h-8 rounded-lg border border-[var(--border)] px-3 text-xs" onClick={() => void navigator.clipboard?.writeText(jsonText)}>{d("copy", "Copy")}</button>
              <button type="button" className="h-8 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-white" onClick={applyJson}>{d("apply", "Apply")}</button>
            </div>
          </ModalShell>
        ) : null}
        <TourOverlay tour={tour} d={d} />
      </div>
      </LibraryCtx.Provider>
    </InsertContext.Provider>
  );

  return typeof document === "undefined" ? null : createPortal(node, document.body);
}

function TemplateCard({ sig, title, hint, build, palette, brandingOverride, data, config, lang, onPick, menu }: { sig: string; title: string; hint: string; build: () => LayoutDoc; palette?: string; brandingOverride?: object; data: PublicSubPayload; config: SharxSubpageConfigV2; lang: string; onPick: () => void; menu?: React.ReactNode }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doc = useMemo(() => build(), [sig]);
  const branding = useMemo(() => (brandingOverride ? { ...config.branding, ...brandingOverride } : config.branding), [config.branding, brandingOverride]);
  return (
    <div className="group relative overflow-hidden rounded-xl border border-[var(--border)] transition hover:border-[var(--accent)] hover:shadow-lg">
      <button type="button" onClick={onPick} className="block w-full text-left">
        <div className="relative h-[230px] overflow-hidden" aria-hidden>
          <div className="pointer-events-none origin-top-left" style={{ width: 420, transform: "scale(0.62)" }}>
            <SubPageShell className="!min-h-0" branding={branding} theme="dark" colorPreset={(palette ?? config.colorPreset) as never}>
              <LayoutRenderer doc={{ ...doc, enabled: true }} data={data} config={config} mode="view" interactive={false} device="mobile" lang={lang} />
            </SubPageShell>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--bg-elevated)] to-transparent" />
        </div>
        <div className="p-2.5">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--fg-muted)]">{hint}</div>
        </div>
      </button>
      {menu ? <div className="absolute right-1.5 top-1.5 z-10">{menu}</div> : null}
    </div>
  );
}

function ModalShell({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-black/50 p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div data-tour="modal" className={`max-h-[90vh] w-full ${wide ? "max-w-6xl" : "max-w-2xl"} overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-2xl`}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">{title}</div>
          <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--surface)]" aria-label="Close"><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
