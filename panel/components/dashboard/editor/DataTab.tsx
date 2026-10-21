"use client";
import { useTranslation } from "react-i18next";
import { CodeEditor, TplRow } from "@/components/settings/subscription/designer/InspectorSections";
import { Input, SelectNative, CheckboxField } from "@/components/ui";
import { atomDef } from "@/lib/dashboardLayout";
import { metricContext } from "@/lib/dashboardDesign";
import type { CustomPanel, TileSettings } from "@/lib/dashboardBuilder";
import type { DashboardMetric } from "@/lib/dashboardMetrics";
import { DashboardDesignEditor } from "../DashboardDesignEditor";
import type { PanelDraft } from "../DashboardComposer";

/** Tab "Данные": title, metrics, content of free tiles (HTML / embed / text / design), range and levels, initial size. */
export function DataTab({
  draft,
  onDraft,
  metrics,
  selected,
  insert,
  language,
}: {
  draft: PanelDraft;
  onDraft: (d: PanelDraft) => void;
  metrics: DashboardMetric[];
  selected: DashboardMetric[];
  insert: { current: ((s: string) => void) | null };
  language: string;
}) {
  const { t } = useTranslation();
  const groups = [...new Set(metrics.map((m) => m.group))];
  const panelChange = (patch: Partial<CustomPanel>) => onDraft({ ...draft, panel: { ...draft.panel, ...patch } });
  const settingChange = (patch: Partial<TileSettings>) => onDraft({ ...draft, settings: { ...draft.settings, ...patch } });
  return (
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
          onChange={(e) => onDraft({ ...draft, panel: { ...draft.panel, title: e.target.value }, settings: { ...draft.settings, title: e.target.value } })}
        />
      </label>
      <CheckboxField label={t("pages.builder.showTitle")} checked={draft.settings.showTitle !== false} onChange={(e) => settingChange({ showTitle: e.target.checked ? undefined : false })} />
      {draft.panel.kind !== "embed" && draft.panel.kind !== "widget" ? (
        <div>
          <p className="mb-2 text-xs text-[var(--fg-muted)]">{t("pages.builder.metrics")}</p>
          <SelectNative
            aria-label={t("pages.builder.selectMetric")}
            value=""
            onChange={(e) => {
              if (e.target.value && !draft.panel.metrics.includes(e.target.value) && draft.panel.metrics.length < 8) panelChange({ metrics: [...draft.panel.metrics, e.target.value] });
            }}
          >
            <option value="">{t("pages.builder.selectMetric")}</option>
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {metrics
                  .filter((m) => m.group === group)
                  .map((m) => (
                    <option key={m.id} value={m.id} disabled={draft.panel.metrics.includes(m.id)}>
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
                onClick={() => panelChange({ metrics: draft.panel.metrics.filter((id) => id !== m.id) })}
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
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-[var(--fg-muted)]">
              {t("pages.builder.min")}
              <Input type="number" value={draft.settings.min ?? 0} onChange={(e) => settingChange({ min: Number(e.target.value) })} />
            </label>
            <label className="space-y-1 text-xs text-[var(--fg-muted)]">
              {t("pages.builder.max")}
              <Input type="number" value={draft.settings.max ?? 100} onChange={(e) => settingChange({ max: Number(e.target.value) })} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-[var(--fg-muted)]">
              {t("pages.builder.warnAt")}
              <Input type="number" value={draft.settings.warn ?? ""} placeholder={String(selected[0]?.thresholds?.warn ?? "")} onChange={(e) => settingChange({ warn: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </label>
            <label className="space-y-1 text-xs text-[var(--fg-muted)]">
              {t("pages.builder.critAt")}
              <Input type="number" value={draft.settings.crit ?? ""} placeholder={String(selected[0]?.thresholds?.crit ?? "")} onChange={(e) => settingChange({ crit: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </label>
          </div>
        </>
      ) : null}
      {draft.panel.kind === "html" ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--fg-muted)]">{t("pages.builder.codeHint", { interpolation: { prefix: "%{", suffix: "}" } })}</p>
          <CodeEditor language="html" value={draft.panel.code} onChange={(code) => panelChange({ code: code.slice(0, 20000) })} height={280} />
          <div className="flex flex-wrap gap-1">
            {["metric.label", "metric.value", "metric.display", "metric.percent"].map((path) => (
              <button type="button" key={path} className="rounded border border-[var(--border)] px-2 py-1 font-mono text-[10px]" onClick={() => insert.current?.("{{ " + path + " }}")}>
                {path}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {draft.panel.kind === "design" && draft.panel.design ? <DashboardDesignEditor doc={draft.panel.design} metrics={selected} onChange={(design) => panelChange({ design })} /> : null}
      {draft.panel.kind === "embed" ? (
        <label className="block space-y-2 text-xs text-[var(--fg-muted)]">
          {t("pages.builder.httpsUrl")}
          <Input type="url" value={draft.panel.url} placeholder="https://" onChange={(e) => panelChange({ url: e.target.value })} />
        </label>
      ) : null}
      {draft.panel.kind === "text" ? (
        <label className="block space-y-2 text-xs text-[var(--fg-muted)]">
          Markdown
          <TplRow label="Markdown" value={draft.panel.text} onChange={(text) => panelChange({ text: text.slice(0, 20000) })} ctx={metricContext(selected)} lang={language} multiline rows={6} />
        </label>
      ) : null}
      {/* Size of an existing panel is changed on the board (drag / resize); these only set the initial size. */}
      <div className={`grid grid-cols-2 gap-3 ${draft.isNew ? "" : "hidden"}`}>
        <label className="space-y-2 text-xs text-[var(--fg-muted)]">
          {t("pages.builder.width")}
          <SelectNative value={draft.settings.width} onChange={(e) => settingChange({ width: Number(e.target.value) })}>
            {Array.from({ length: 10 }, (_, i) => i + 3).map((n) => (
              <option key={n} value={n}>
                {n}/12
              </option>
            ))}
          </SelectNative>
        </label>
        <label className="space-y-2 text-xs text-[var(--fg-muted)]">
          {t("pages.builder.height")}
          <SelectNative value={draft.settings.height} onChange={(e) => settingChange({ height: Number(e.target.value) })}>
            {Array.from({ length: 22 }, (_, i) => i + 3).map((n) => (
              <option key={n} value={n}>
                {n * 40 + (n - 1) * 16}px
              </option>
            ))}
          </SelectNative>
        </label>
      </div>
    </div>
  );
}
