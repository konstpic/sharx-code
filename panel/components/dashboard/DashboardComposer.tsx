"use client";
import { useEffect, useState, useRef } from "react";
import { InsertContext } from "@/components/settings/subscription/designer/ui";
import { TileCatalog } from "./TileCatalog";
import { PresetGallery, type PresetSource } from "./presets/PresetGallery";
import type { MyPreset, PresetCtx, PresetEntry } from "@/lib/dashboardPresets";
import { MetricContent, WidgetContent, type AtomEnv } from "./BuiltinAtoms";
import { StyleEditor } from "./editor/StyleEditor";
import { SelectionBar } from "./editor/SelectionBar";
import { clearTileSelection } from "./editor/styleStore";
import { atomDef } from "@/lib/dashboardLayout";
import type { MyEntry } from "@/lib/dashboardCatalog";
import type { EntityTemplateContext } from "@/lib/dashboardMetricsTemplates";
import type { TileBundle } from "@/lib/dashboardModel";
import {
  DASHBOARD_FORMS,
  dashboardForm,
} from "@/lib/dashboardDesign";
import type { MyStyle, TileStyle } from "@/lib/dashboardStyle";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Copy,
  LayoutDashboard,
  LayoutGrid,
  Palette,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Button,
  Input,
  SelectNative,
  Drawer,
  ConfirmDialog,
} from "@/components/ui";
import type {
  CustomPanel,
  DashboardLayout,
  DashboardWorkspace,
  TileSettings,
} from "@/lib/dashboardBuilder";
import type { DashboardMetric } from "@/lib/dashboardMetrics";
import { MAX_PANELS } from "@/lib/dashboardModel";
import { CustomContentPanel, CUSTOM_HTML_EXAMPLE } from "./CustomContentPanel";
export type PanelDraft = {
  panel: CustomPanel;
  settings: TileSettings;
  isNew: boolean;
};
const colors = [
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#64748b",
];
export function DashboardComposer({
  workspace,
  editing,
  metrics,
  layout,
  draft,
  onDraft,
  onSave,
  onSwitch,
  onNew,
  onDuplicate,
  onRename,
  onTemplate,
  onRemove,
  onReset,
  onClassic,
  onV271,
  onArrange,
  saved,
  env,
  mine,
  nodeLists,
  onAdd,
  onSaveBoard,
  onDeleteMine,
  myStyles,
  onMyStyles,
  onApplyStyle,
  presetCtx,
  myPresets,
  onMyPresets,
  onPresetCreate,
  onPresetReplace,
  onPresetLook,
  onSaveCurrentPreset,
}: {
  workspace: DashboardWorkspace;
  editing: boolean;
  metrics: DashboardMetric[];
  layout: DashboardLayout;
  draft: PanelDraft | null;
  onDraft: (draft: PanelDraft | null) => void;
  onSave: (draft: PanelDraft) => void;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onTemplate: (type: string) => void;
  onRemove: () => void;
  /** Restore the default tile layout (positions and sizes; custom panels stay). */
  onReset: () => void;
  /** Replace the catalog tiles of the board with the classic v2.6 set (the user's own tiles stay below). */
  onClassic: () => void;
  /** Replace the catalog tiles of the board with the v2.7.1 dashboard (the user's own tiles stay below it). */
  onV271: () => void;
  /** Re-pack the tiles in reading order without changing their sizes (removes holes). */
  onArrange: () => void;
  saved: boolean;
  /** Live data for the miniatures of the catalog and the preview of the tile editor. */
  env: AtomEnv;
  mine: MyEntry[];
  nodeLists: EntityTemplateContext;
  onAdd: (bundle: TileBundle) => void;
  onSaveBoard: (name: string) => void;
  onDeleteMine: (id: string) => void;
  /** Named tile styles saved in the workspace (at most 24). */
  myStyles: MyStyle[];
  onMyStyles: (list: MyStyle[]) => void;
  /** Copies appearance (frame + colour + typography, never data) onto the tiles `ids`; `null` = every tile of the board. */
  onApplyStyle: (ids: string[] | null, style: TileStyle | undefined) => void;
  /** Live node / balancer lists and permissions: what the board presets are built from. */
  presetCtx: PresetCtx;
  /** The user's own board presets (workspace.myPresets, at most 24). */
  myPresets: MyPreset[];
  onMyPresets: (list: MyPreset[]) => void;
  /** Gallery actions: new board / replace the current one / only the look / save the current board as a preset. */
  onPresetCreate: (src: PresetSource) => void;
  onPresetReplace: (src: PresetSource) => void;
  onPresetLook: (entry: PresetEntry) => void;
  onSaveCurrentPreset: (name: string, desc: string) => boolean;
}) {
  const { t, i18n } = useTranslation();
  const registry = useRef<{ current: ((s: string) => void) | null }>({
    current: null,
  });
  const [catalog, setCatalog] = useState(false);
  const [gallery, setGallery] = useState(false);
  useEffect(() => {
    if (!editing) clearTileSelection();
  }, [editing]);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [classicOpen, setClassicOpen] = useState(false);
  const [v271Open, setV271Open] = useState(false);
  const active = workspace.boards.find((b) => b.id === workspace.activeId);
  const start = (kind: CustomPanel["kind"], metric?: DashboardMetric, view?: string) => {
    const panel: CustomPanel = {
      id: "custom-" + crypto.randomUUID(),
      title: metric?.label ?? t("pages.builder." + kind),
      kind,
      metrics: metric
        ? [metric.id]
        : kind === "html" || kind === "design" || kind === "text"
          ? ["cpu"]
          : [],
      code: CUSTOM_HTML_EXAMPLE,
      url: "",
      text: "",
    };
    if (kind === "design")
      panel.design = dashboardForm(
        DASHBOARD_FORMS[0],
        i18n.language?.startsWith("ru") ? "ru" : "en",
      );
    onDraft({
      panel,
      isNew: true,
      settings: {
        width: kind === "metric" ? 3 : 6,
        height: kind === "metric" ? 3 : 6,
        view: kind === "metric" ? (view ?? "stat") : "default",
        title: panel.title,
        color: colors[0],
        min: 0,
        max: metric?.max ?? 100,
        precision: 1,
      },
    });
    setCatalog(false);
  };
  const selected = draft
    ? metrics.filter((m) => draft.panel.metrics.includes(m.id))
    : [];
  const mixed = new Set(selected.map((m) => m.unit)).size > 1;
  const invalid =
    draft &&
    ((draft.panel.kind === "metric" && !selected.length) ||
      (draft.panel.kind === "embed" && !/^https:\/\//i.test(draft.panel.url)) ||
      (draft.settings.max != null &&
        draft.settings.min != null &&
        draft.settings.max <= draft.settings.min) ||
      (mixed && ["line", "area", "bar"].includes(draft.settings.view)));
  return (
    <>
      <div className="mb-4 space-y-2">
        {/* Board switcher: pills instead of a dropdown, so every dashboard is one click away. */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--fg)_6%,transparent)]">
          <span className="ml-1.5 grid size-8 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]">
            <LayoutGrid size={16} />
          </span>
          {workspace.boards.length <= 6 ? (
            <div role="tablist" aria-label={t("pages.builder.dashboard")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {workspace.boards.map((b) => {
                const on = b.id === workspace.activeId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => onSwitch(b.id)}
                    className={`max-w-[12rem] truncate rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition ${
                      on
                        ? "bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] text-[var(--fg)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_45%,transparent)]"
                        : "text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)] hover:text-[var(--fg)]"
                    }`}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <SelectNative
              aria-label={t("pages.builder.dashboard")}
              value={workspace.activeId}
              onChange={(e) => onSwitch(e.target.value)}
              className="!h-9 !w-auto min-w-40 flex-1 !text-sm"
            >
              {workspace.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectNative>
          )}
          <Button variant="ghost" className="!h-9 !rounded-xl !px-3 !text-xs" onClick={() => setGallery(true)} title={t("pages.builder.presets.openHint")}>
            <Palette size={14} />
            <span className="hidden sm:inline">{t("pages.builder.presets.open")}</span>
          </Button>
          {editing ? (
            <>
              <Button variant="ghost" className="!h-9 !rounded-xl !px-3 !text-xs" onClick={onNew} disabled={workspace.boards.length >= 12} title={t("pages.builder.newDashboard")}>
                <Plus size={14} />
                <span className="hidden sm:inline">{t("pages.builder.newDashboard")}</span>
              </Button>
              <span
                role="status"
                className={`mr-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${saved ? "bg-[color-mix(in_oklab,#22c55e_14%,transparent)] text-[#22c55e]" : "bg-[color-mix(in_oklab,#f59e0b_14%,transparent)] text-[#f59e0b]"}`}
              >
                <span className={`size-1.5 rounded-full bg-current ${saved ? "" : "animate-pulse"}`} />
                {t(saved ? "pages.builder.saved" : "pages.builder.saving")}
              </span>
            </>
          ) : null}
        </div>
        {editing ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-[color-mix(in_oklab,var(--accent)_40%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_5%,var(--surface))] p-2">
            <Input
              aria-label={t("pages.builder.dashboardName")}
              value={active?.name ?? ""}
              maxLength={60}
              onChange={(e) => onRename(e.target.value)}
              className="!h-9 !w-48 !rounded-xl !text-xs"
            />
            <div className="mx-1 hidden h-6 w-px bg-[var(--border)] sm:block" />
            <Button variant="secondary" className="!h-9 !rounded-xl !text-xs" onClick={onDuplicate} disabled={workspace.boards.length >= 12}>
              <Copy size={14} />
              {t("pages.builder.duplicate")}
            </Button>
            <SelectNative
              aria-label={t("pages.builder.template")}
              value=""
              onChange={(e) => {
                if (e.target.value) onTemplate(e.target.value);
              }}
              className="!h-9 !w-auto !rounded-xl !text-xs"
            >
              <option value="">{t("pages.builder.template")}</option>
              <option value="classic">{t("pages.builder.templateClassic")}</option>
              <option value="v271">{t("pages.builder.templateV271")}</option>
              <option value="monitoring">{t("pages.builder.monitoring")}</option>
              <option value="network">{t("pages.builder.groupNetwork")}</option>
              <option value="minimal">{t("pages.builder.minimal")}</option>
              <option value="nodes">{t("pages.builder.templateNodes")}</option>
              <option value="balancers">{t("pages.builder.templateBalancers")}</option>
            </SelectNative>
            <div className="mx-1 hidden h-6 w-px bg-[var(--border)] sm:block" />
            <Button variant="primary" className="!h-9 !rounded-xl !text-xs" onClick={() => setGallery(true)} title={t("pages.builder.presets.openHint")}>
              <Palette size={14} />
              {t("pages.builder.presets.open")}
            </Button>
            <Button variant="secondary" className="!h-9 !rounded-xl !text-xs" onClick={() => setCatalog(true)} disabled={layout.panels.length >= MAX_PANELS}>
              <LayoutGrid size={14} />
              {t("pages.builder.catalog")}
            </Button>
            <Button variant="secondary" className="!h-9 !rounded-xl !text-xs" onClick={onArrange} title={t("pages.builder.autoArrangeHint")}>
              <Sparkles size={14} />
              {t("pages.builder.autoArrange")}
            </Button>
            <Button variant="secondary" className="!h-9 !rounded-xl !text-xs" onClick={() => setClassicOpen(true)} title={t("pages.builder.classicViewHint")}>
              <LayoutDashboard size={14} />
              {t("pages.builder.classicView")}
            </Button>
            <Button variant="secondary" className="!h-9 !rounded-xl !text-xs" onClick={() => setV271Open(true)} title={t("pages.builder.v271ViewHint")}>
              <LayoutDashboard size={14} />
              {t("pages.builder.v271View")}
            </Button>
            <Button variant="secondary" className="!h-9 !rounded-xl !text-xs" onClick={() => setResetOpen(true)} title={t("pages.builder.resetLayoutHint")}>
              <RotateCcw size={14} />
              {t("pages.builder.resetLayout")}
            </Button>
            <Button
              variant="danger"
              aria-label={t("pages.builder.removeDashboard")}
              className="!ml-auto !h-9 !rounded-xl !px-2.5"
              disabled={workspace.boards.length < 2}
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ) : null}
        {editing ? <SelectionBar myStyles={myStyles} onApplyStyle={onApplyStyle} /> : null}
      </div>
      <ConfirmDialog
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          onReset();
          setResetOpen(false);
        }}
        title={t("pages.builder.resetLayout")}
        description={t("pages.builder.resetLayoutConfirm")}
      />
      <ConfirmDialog
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        open={classicOpen}
        onCancel={() => setClassicOpen(false)}
        onConfirm={() => {
          onClassic();
          setClassicOpen(false);
        }}
        title={t("pages.builder.classicView")}
        description={t("pages.builder.classicViewConfirm")}
      />
      <ConfirmDialog
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        open={v271Open}
        onCancel={() => setV271Open(false)}
        onConfirm={() => {
          onV271();
          setV271Open(false);
        }}
        title={t("pages.builder.v271View")}
        description={t("pages.builder.v271ViewConfirm")}
      />
      <ConfirmDialog
        danger
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        open={removeOpen}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => {
          onRemove();
          setRemoveOpen(false);
        }}
        title={t("pages.builder.removeDashboard")}
        description={active?.name ?? ""}
      />
      <PresetGallery
        open={gallery}
        onClose={() => setGallery(false)}
        ctx={presetCtx}
        myPresets={myPresets}
        onMyPresets={onMyPresets}
        boardsFull={workspace.boards.length >= 12}
        onCreate={onPresetCreate}
        onReplace={onPresetReplace}
        onLook={onPresetLook}
        onSaveCurrent={onSaveCurrentPreset}
      />
      <TileCatalog
        open={catalog}
        onClose={() => setCatalog(false)}
        metrics={metrics}
        env={env}
        mine={mine}
        nodeLists={nodeLists}
        onAdd={onAdd}
        onContent={(kind) => start(kind)}
        onSaveBoard={onSaveBoard}
        onDeleteMine={onDeleteMine}
      />
      <Drawer
        closeOnEscape={draft?.panel.kind !== "design"}
        open={draft != null}
        onClose={() => onDraft(null)}
        title={t(draft?.isNew ? "pages.builder.addPanel" : "pages.builder.editPanel")}
        width={660}
        lockBodyScroll={draft != null}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onDraft(null)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={Boolean(invalid)}
              onClick={() => {
                if (draft) onSave(draft);
              }}
            >
              {t(draft?.isNew ? "pages.builder.addPanel" : "pages.trafficHistory.apply")}
            </Button>
          </div>
        }
      >
        {draft ? (
          <InsertContext.Provider value={registry.current}>
            <StyleEditor
              draft={draft}
              onDraft={onDraft}
              metrics={metrics}
              selected={selected}
              insert={registry.current}
              language={i18n.language}
              mixed={mixed}
              myStyles={myStyles}
              onMyStyles={onMyStyles}
              onApplyToAll={(style) => onApplyStyle(null, style)}
              preview={
                draft.panel.kind === "metric" ? (
                  <MetricContent panel={draft.panel} settings={draft.settings} env={{ ...env, metrics }} preview />
                ) : draft.panel.kind === "widget" && draft.panel.widget && !["telemt_dc", "telemt_dc_summary", "telemt_dc_dots"].includes(draft.panel.widget) ? (
                  <WidgetContent widget={draft.panel.widget} env={env} />
                ) : draft.panel.kind === "widget" ? (
                  <div className="grid h-full place-items-center p-4 text-center text-sm text-[var(--fg-muted)]">{t(atomDef(draft.panel.widget ?? "")?.title ?? "pages.builder.preview")}</div>
                ) : (
                  <CustomContentPanel panel={draft.panel} metrics={selected} />
                )
              }
            />
          </InsertContext.Provider>
        ) : null}
      </Drawer>
    </>
  );
}
