"use client";
import { useState, useRef } from "react";
import {
  CodeEditor,
  TplRow,
} from "@/components/settings/subscription/designer/InspectorSections";
import { InsertContext } from "@/components/settings/subscription/designer/ui";
import { DashboardDesignEditor } from "./DashboardDesignEditor";
import {
  DASHBOARD_FORMS,
  dashboardForm,
  metricContext,
} from "@/lib/dashboardDesign";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Copy,
  Code2,
  Globe,
  Text,
  Search,
  LayoutGrid,
  Trash2,
} from "lucide-react";
import {
  Button,
  Input,
  SelectNative,
  Modal,
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
import {
  CustomMetricPanel,
} from "./CustomMetricPanel";
import { ViewPicker, ViewThumb } from "./ViewPicker";
import { METRIC_VIEWS as METRIC_VIEWS_LIST } from "./CustomMetricPanel";
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
  onBuiltins,
  onRemove,
  saved,
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
  onBuiltins: () => void;
  onRemove: () => void;
  saved: boolean;
}) {
  const { t, i18n } = useTranslation();
  const registry = useRef<{ current: ((s: string) => void) | null }>({
    current: null,
  });
  const [catalog, setCatalog] = useState(false);
  const [query, setQuery] = useState("");
  const [look, setLook] = useState("stat");
  const [groupFilter, setGroupFilter] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
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
            </SelectNative>
            <div className="mx-1 hidden h-6 w-px bg-[var(--border)] sm:block" />
            <Button variant="primary" className="!h-9 !rounded-xl !text-xs" onClick={() => setCatalog(true)} disabled={layout.panels.length >= 24}>
              <Plus size={14} />
              {t("pages.builder.addPanel")}
            </Button>
            <Button variant="secondary" className="!h-9 !rounded-xl !text-xs" onClick={onBuiltins}>
              {t("pages.builder.builtins")}
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
      <Modal
        open={catalog}
        onClose={() => setCatalog(false)}
        title={t("pages.builder.addPanel")}
        width={980}
      >
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(["design", "html", "embed", "text"] as const).map((kind, i) => {
            const Icon = [LayoutGrid, Code2, Globe, Text][i];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => start(kind)}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--accent)]"
              >
                <Icon size={22} className="mb-3 text-[var(--accent)]" />
                <span className="text-sm font-medium">
                  {t("pages.builder." + kind)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">{t("pages.builder.lookTitle", { defaultValue: "Look of the tile" })}</p>
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist">
          {METRIC_VIEWS_LIST.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={look === v}
              onClick={() => setLook(v)}
              className={`flex w-[74px] shrink-0 flex-col items-stretch gap-1 rounded-xl border p-1.5 text-center transition ${look === v ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
            >
              <span className="block h-8">
                <ViewThumb view={v} />
              </span>
              <span className="truncate text-[10px]">{t("pages.builder." + v, { defaultValue: v })}</span>
            </button>
          ))}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-muted)]" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("pages.builder.searchMetric")} className="!pl-9" />
          </div>
          <div className="flex flex-wrap gap-1">
            {["", ...groups].map((g) => (
              <button
                key={g || "all"}
                type="button"
                onClick={() => setGroupFilter(g)}
                className={`rounded-full border px-3 py-1 text-xs transition ${groupFilter === g ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
              >
                {g || t("pages.builder.allGroups", { defaultValue: "All" })}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[50vh] space-y-5 overflow-auto pr-1">
          {groups
            .filter((g) => !groupFilter || g === groupFilter)
            .map((group) => {
              const list = metrics.filter((m) => m.group === group && `${m.label} ${m.group} ${m.id}`.toLowerCase().includes(query.toLowerCase()));
              return list.length ? (
                <div key={group}>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">{group}</h3>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {list.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => start("metric", m, look)}
                        className="dash-card group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] text-left transition hover:border-[var(--accent)] hover:shadow-[0_8px_28px_-14px_var(--accent)]"
                      >
                        <span className="pointer-events-none block h-[150px] overflow-hidden">
                          <CustomMetricPanel
                            metrics={[m]}
                            settings={{ width: 3, height: 3, view: ["line", "area", "bar"].includes(look) ? "spark" : look, title: "", color: colors[0], min: 0, max: m.max ?? 100, precision: 1 }}
                          />
                        </span>
                        <span className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
                          <span className="min-w-0 truncate text-xs font-medium" title={m.label}>{m.label}</span>
                          <Plus size={14} className="shrink-0 text-[var(--accent)] opacity-60 transition group-hover:opacity-100" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null;
            })}
        </div>
      </Modal>
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
              {draft.panel.kind !== "embed" ? (
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
              <div className="grid grid-cols-2 gap-3">
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
              <div className="h-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                {draft.panel.kind === "metric" ? (
                  <CustomMetricPanel
                    metrics={selected}
                    settings={draft.settings}
                  />
                ) : (
                  <CustomContentPanel panel={draft.panel} metrics={selected} />
                )}
              </div>
            </div>
          </InsertContext.Provider>
        ) : null}
      </Drawer>
    </>
  );
}
