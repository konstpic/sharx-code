"use client";
import { useState, useRef } from "react";
import {
  CodeEditor,
  TplRow,
} from "@/components/settings/subscription/designer/InspectorSections";
import { InsertContext } from "@/components/settings/subscription/designer/ui";
import { DashboardDesignEditor } from "./DashboardDesignEditor";
import { TileCatalog } from "./TileCatalog";
import { MetricContent, WidgetContent, type AtomEnv } from "./BuiltinAtoms";
import { TilePreview } from "./GridTile";
import { atomDef } from "@/lib/dashboardLayout";
import type { MyEntry } from "@/lib/dashboardCatalog";
import type { EntityTemplateContext } from "@/lib/dashboardMetricsTemplates";
import type { TileBundle } from "@/lib/dashboardModel";
import {
  DASHBOARD_FORMS,
  dashboardForm,
  metricContext,
} from "@/lib/dashboardDesign";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Copy,
  LayoutGrid,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Button,
  Input,
  SelectNative,
  Drawer,
  CheckboxField,
  ConfirmDialog,
} from "@/components/ui";
import type {
  CustomPanel,
  DashboardLayout,
  DashboardWorkspace,
  TileSettings,
} from "@/lib/dashboardBuilder";
import type { DashboardMetric } from "@/lib/dashboardMetrics";
import { ViewPicker } from "./ViewPicker";
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
  onArrange,
  saved,
  env,
  mine,
  nodeLists,
  onAdd,
  onSaveBoard,
  onDeleteMine,
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
}) {
  const { t, i18n } = useTranslation();
  const registry = useRef<{ current: ((s: string) => void) | null }>({
    current: null,
  });
  const [catalog, setCatalog] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
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
  const panelChange = (patch: Partial<CustomPanel>) => {
    if (draft) onDraft({ ...draft, panel: { ...draft.panel, ...patch } });
  };
  const settingChange = (patch: Partial<TileSettings>) => {
    if (draft) onDraft({ ...draft, settings: { ...draft.settings, ...patch } });
  };
  const mixed = new Set(selected.map((m) => m.unit)).size > 1;
  const invalid =
    draft &&
    ((draft.panel.kind === "metric" && !selected.length) ||
      (draft.panel.kind === "embed" && !/^https:\/\//i.test(draft.panel.url)) ||
      (draft.settings.max != null &&
        draft.settings.min != null &&
        draft.settings.max <= draft.settings.min) ||
      (mixed && ["line", "area", "bar"].includes(draft.settings.view)));
  const groups = [...new Set(metrics.map((m) => m.group))];
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
              <option value="monitoring">{t("pages.builder.monitoring")}</option>
              <option value="network">{t("pages.builder.groupNetwork")}</option>
              <option value="minimal">{t("pages.builder.minimal")}</option>
              <option value="nodes">{t("pages.builder.templateNodes")}</option>
              <option value="balancers">{t("pages.builder.templateBalancers")}</option>
            </SelectNative>
            <div className="mx-1 hidden h-6 w-px bg-[var(--border)] sm:block" />
            <Button variant="primary" className="!h-9 !rounded-xl !text-xs" onClick={() => setCatalog(true)} disabled={layout.panels.length >= MAX_PANELS}>
              <LayoutGrid size={14} />
              {t("pages.builder.catalog")}
            </Button>
            <Button variant="secondary" className="!h-9 !rounded-xl !text-xs" onClick={onArrange} title={t("pages.builder.autoArrangeHint")}>
              <Sparkles size={14} />
              {t("pages.builder.autoArrange")}
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
        title={t(
          draft?.isNew ? "pages.builder.addPanel" : "pages.builder.editPanel",
        )}
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
              {t(
                draft?.isNew
                  ? "pages.builder.addPanel"
                  : "pages.trafficHistory.apply",
              )}
            </Button>
          </div>
        }
      >
        {draft ? (
          <InsertContext.Provider value={registry.current}>
            <div className="space-y-5">
              <label className="block space-y-2 text-xs text-[var(--fg-muted)]">
                {t("pages.builder.title")}
                <Input
                  value={draft.panel.title}
                  placeholder={(() => {
                    const a = atomDef(draft.panel.widget ?? draft.panel.preset ?? "");
                    return a ? t(a.title) : "";
                  })()}
                  maxLength={100}
                  onChange={(e) => {
                    onDraft({
                      ...draft,
                      panel: { ...draft.panel, title: e.target.value },
                      settings: { ...draft.settings, title: e.target.value },
                    });
                  }}
                />
              </label>
              <CheckboxField
                label={t("pages.builder.showTitle")}
                checked={draft.settings.showTitle !== false}
                onChange={(e) => settingChange({ showTitle: e.target.checked ? undefined : false })}
              />
              {draft.panel.kind !== "embed" && draft.panel.kind !== "widget" ? (
                <div>
                  <p className="mb-2 text-xs text-[var(--fg-muted)]">
                    {t("pages.builder.metrics")}
                  </p>
                  <SelectNative
                    aria-label={t("pages.builder.selectMetric")}
                    value=""
                    onChange={(e) => {
                      if (
                        e.target.value &&
                        !draft.panel.metrics.includes(e.target.value) &&
                        draft.panel.metrics.length < 8
                      )
                        panelChange({
                          metrics: [...draft.panel.metrics, e.target.value],
                        });
                    }}
                  >
                    <option value="">{t("pages.builder.selectMetric")}</option>
                    {groups.map((group) => (
                      <optgroup key={group} label={group}>
                        {metrics
                          .filter((m) => m.group === group)
                          .map((m) => (
                            <option
                              key={m.id}
                              value={m.id}
                              disabled={draft.panel.metrics.includes(m.id)}
                            >
                              {m.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </SelectNative>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() =>
                          panelChange({
                            metrics: draft.panel.metrics.filter(
                              (id) => id !== m.id,
                            ),
                          })
                        }
                        className="rounded-full border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--fg-muted)]"
                      >
                        {m.label} ×
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {draft.panel.kind === "metric" ? (
                <>
                  <div>
                    <p className="mb-2 text-xs text-[var(--fg-muted)]">
                      {t("pages.builder.view")}
                    </p>
                    <ViewPicker value={draft.settings.view} onChange={(view) => settingChange({ view })} color={draft.settings.color} />
                  </div>
                  {mixed &&
                  ["line", "area", "bar"].includes(draft.settings.view) ? (
                    <p className="text-xs text-[var(--danger)]">
                      {t("pages.builder.sameUnits")}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {colors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={c}
                        onClick={() => settingChange({ color: c })}
                        className={`size-7 rounded-full border-2 ${draft.settings.color === c ? "border-[var(--fg)]" : "border-transparent"}`}
                        style={{ background: c }}
                      />
                    ))}
                    <Input
                      aria-label={t("pages.builder.color")}
                      value={draft.settings.color ?? colors[0]}
                      onChange={(e) => {
                        if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                          settingChange({ color: e.target.value });
                      }}
                      className="!h-8 !w-28 !font-mono !text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="space-y-1 text-xs text-[var(--fg-muted)]">
                      {t("pages.builder.min")}
                      <Input
                        type="number"
                        value={draft.settings.min ?? 0}
                        onChange={(e) =>
                          settingChange({ min: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-xs text-[var(--fg-muted)]">
                      {t("pages.builder.max")}
                      <Input
                        type="number"
                        value={draft.settings.max ?? 100}
                        onChange={(e) =>
                          settingChange({ max: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-xs text-[var(--fg-muted)]">
                      {t("pages.builder.precision")}
                      <SelectNative
                        value={draft.settings.precision ?? 1}
                        onChange={(e) =>
                          settingChange({ precision: Number(e.target.value) })
                        }
                      >
                        {[0, 1, 2, 3].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </SelectNative>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-xs text-[var(--fg-muted)]">
                      {t("pages.builder.warnAt")}
                      <Input
                        type="number"
                        value={draft.settings.warn ?? ""}
                        placeholder={String(selected[0]?.thresholds?.warn ?? "")}
                        onChange={(e) => settingChange({ warn: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </label>
                    <label className="space-y-1 text-xs text-[var(--fg-muted)]">
                      {t("pages.builder.critAt")}
                      <Input
                        type="number"
                        value={draft.settings.crit ?? ""}
                        placeholder={String(selected[0]?.thresholds?.crit ?? "")}
                        onChange={(e) => settingChange({ crit: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  {["line", "area", "bar"].includes(draft.settings.view) ? (
                    <CheckboxField
                      label={t("pages.builder.fixedScale")}
                      checked={draft.settings.fixedScale === true}
                      onChange={(e) =>
                        settingChange({ fixedScale: e.target.checked })
                      }
                    />
                  ) : null}
                </>
              ) : null}
              {draft.panel.kind === "html" ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--fg-muted)]">
                    {t("pages.builder.codeHint", {
                      interpolation: { prefix: "%{", suffix: "}" },
                    })}
                  </p>
                  <CodeEditor
                    language="html"
                    value={draft.panel.code}
                    onChange={(code) =>
                      panelChange({ code: code.slice(0, 20000) })
                    }
                    height={280}
                  />
                  <div className="flex flex-wrap gap-1">
                    {[
                      "metric.label",
                      "metric.value",
                      "metric.display",
                      "metric.percent",
                    ].map((path) => (
                      <button
                        type="button"
                        key={path}
                        className="rounded border border-[var(--border)] px-2 py-1 font-mono text-[10px]"
                        onClick={() =>
                          registry.current.current?.("{{ " + path + " }}")
                        }
                      >
                        {path}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {draft.panel.kind === "design" && draft.panel.design ? (
                <DashboardDesignEditor
                  doc={draft.panel.design}
                  metrics={selected}
                  onChange={(design) => panelChange({ design })}
                />
              ) : null}
              {draft.panel.kind === "embed" ? (
                <label className="block space-y-2 text-xs text-[var(--fg-muted)]">
                  {t("pages.builder.httpsUrl")}
                  <Input
                    type="url"
                    value={draft.panel.url}
                    placeholder="https://"
                    onChange={(e) => panelChange({ url: e.target.value })}
                  />
                </label>
              ) : null}
              {draft.panel.kind === "text" ? (
                <label className="block space-y-2 text-xs text-[var(--fg-muted)]">
                  Markdown
                  <TplRow
                    label="Markdown"
                    value={draft.panel.text}
                    onChange={(text) =>
                      panelChange({ text: text.slice(0, 20000) })
                    }
                    ctx={metricContext(selected)}
                    lang={i18n.language}
                    multiline
                    rows={6}
                  />
                </label>
              ) : null}
              {/* Size of an existing panel is changed on the board (drag / resize); these only set the initial size. */}
              <div className={`grid grid-cols-2 gap-3 ${draft.isNew ? "" : "hidden"}`}>
                <label className="space-y-2 text-xs text-[var(--fg-muted)]">
                  {t("pages.builder.width")}
                  <SelectNative
                    value={draft.settings.width}
                    onChange={(e) =>
                      settingChange({ width: Number(e.target.value) })
                    }
                  >
                    {Array.from({ length: 10 }, (_, i) => i + 3).map((n) => (
                      <option key={n} value={n}>
                        {n}/12
                      </option>
                    ))}
                  </SelectNative>
                </label>
                <label className="space-y-2 text-xs text-[var(--fg-muted)]">
                  {t("pages.builder.height")}
                  <SelectNative
                    value={draft.settings.height}
                    onChange={(e) =>
                      settingChange({ height: Number(e.target.value) })
                    }
                  >
                    {Array.from({ length: 22 }, (_, i) => i + 3).map((n) => (
                      <option key={n} value={n}>
                        {n * 40 + (n - 1) * 16}px
                      </option>
                    ))}
                  </SelectNative>
                </label>
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
                {t("pages.builder.preview")}
              </p>
              <TilePreview width={580} height={256} title={draft.panel.title}>
                {draft.panel.kind === "metric" ? (
                  <MetricContent panel={draft.panel} settings={draft.settings} env={{ ...env, metrics }} preview />
                ) : draft.panel.kind === "widget" && draft.panel.widget && !["telemt_dc", "telemt_dc_summary", "telemt_dc_dots"].includes(draft.panel.widget) ? (
                  <WidgetContent widget={draft.panel.widget} env={env} />
                ) : draft.panel.kind === "widget" ? (
                  <div className="grid h-full place-items-center p-4 text-center text-sm text-[var(--fg-muted)]">{t(atomDef(draft.panel.widget ?? "")?.title ?? "pages.builder.preview")}</div>
                ) : (
                  <CustomContentPanel panel={draft.panel} metrics={selected} />
                )}
              </TilePreview>
            </div>
          </InsertContext.Provider>
        ) : null}
      </Drawer>
    </>
  );
}
