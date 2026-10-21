"use client";
/**
 * Body of the tile editor drawer ("Настроить плитку"): live preview on top, global style actions, then tabs
 * Data | Look | Appearance | Colors | Text and numbers | Charts | Behaviour (metric tiles; other kinds get the tabs that apply to them).
 * All style edits go through `patch`, which stores a compact, validated `settings.style` (lib/dashboardStyle.ts).
 */
import { useMemo, useState, type ReactNode } from "react";
import { ClipboardPaste, Copy, LayoutGrid, RotateCcw, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Input, Tabs, type TabItem } from "@/components/ui";
import type { DashboardMetric } from "@/lib/dashboardMetrics";
import {
  APPEARANCE_KEYS,
  STYLE_GROUPS,
  addMyStyle,
  applyAppearance,
  mergeStyle,
  normalizeStyle,
  patchStyle,
  pickStyle,
  resolveStyle,
  type FramePreset,
  type MyStyle,
  type TileStyle,
} from "@/lib/dashboardStyle";
import type { TileSettings } from "@/lib/dashboardBuilder";
import type { PanelDraft } from "../DashboardComposer";
import { AppearanceTab } from "./AppearanceTab";
import { BehaviorTab } from "./BehaviorTab";
import { ChartsTab } from "./ChartsTab";
import { ColorsTab } from "./ColorsTab";
import { DataTab } from "./DataTab";
import { EditorPreview } from "./EditorPreview";
import { LookTab } from "./LookTab";
import { TextTab } from "./TextTab";
import { copyStyle, useStyleClip } from "./styleStore";
import type { TabId, TabProps } from "./types";

export function StyleEditor({
  draft,
  onDraft,
  metrics,
  selected,
  insert,
  language,
  mixed,
  preview,
  myStyles,
  onMyStyles,
  onApplyToAll,
}: {
  draft: PanelDraft;
  onDraft: (d: PanelDraft) => void;
  metrics: DashboardMetric[];
  selected: DashboardMetric[];
  insert: { current: ((s: string) => void) | null };
  language: string;
  /** Selected metrics have different units (line / area / bar need one unit). */
  mixed: boolean;
  /** The tile content for the live preview. */
  preview: ReactNode;
  myStyles: MyStyle[];
  onMyStyles: (list: MyStyle[]) => void;
  /** Copies appearance (frame + colour + typography, no data) onto every tile of the board. */
  onApplyToAll: (style: TileStyle | undefined) => void;
}) {
  const { t } = useTranslation();
  const metric = draft.panel.kind === "metric";
  const [tab, setTab] = useState<TabId>("data");
  const [confirmAll, setConfirmAll] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const clip = useStyleClip();
  const settings = draft.settings;
  const r = useMemo(() => resolveStyle(settings.style), [settings.style]);

  const onSettings = (p: Partial<TileSettings>) => onDraft({ ...draft, settings: { ...draft.settings, ...p } });
  const setStyle = (style: TileStyle | undefined, color?: string | null) =>
    onDraft({ ...draft, settings: { ...draft.settings, style, ...(color === undefined ? {} : { color: color ?? undefined }) } });
  /** Style edits. The accent also drives the legacy tile colour so every renderer follows it. */
  const patch: TabProps["patch"] = (p) => {
    const next = patchStyle(settings.style, p);
    if ("accent" in p) setStyle(next, (p.accent as string | undefined) ?? null);
    else setStyle(next);
  };

  const frameKeys = STYLE_GROUPS.frame as readonly (keyof TileStyle)[];
  const onPreset = (p: FramePreset) => {
    const rest = pickStyle(settings.style, (Object.keys(r) as (keyof TileStyle)[]).filter((k) => !frameKeys.includes(k)));
    setStyle(mergeStyle(rest, p === "default" ? undefined : { preset: p }));
  };
  const applyClip = (c: TileStyle | undefined) => {
    const next = applyAppearance({ style: settings.style, color: settings.color }, c);
    setStyle(next.style, next.color ?? null);
  };
  const base: TabProps = { style: settings.style, r, patch, metric };

  const tabs: TabItem<TabId>[] = [
    { id: "data", label: t("pages.builder.style.tabData") },
    ...(metric ? [{ id: "look" as const, label: t("pages.builder.style.tabLook") }] : []),
    { id: "appearance", label: t("pages.builder.style.tabAppearance") },
    { id: "colors", label: t("pages.builder.style.tabColors") },
    { id: "text", label: t("pages.builder.style.tabText") },
    ...(metric ? [{ id: "charts" as const, label: t("pages.builder.style.tabCharts") }] : []),
    { id: "behavior", label: t("pages.builder.style.tabBehavior") },
  ];
  const active = tabs.some((x) => x.id === tab) ? tab : "data";
  const styled = normalizeStyle(settings.style) !== undefined;

  return (
    <div className="space-y-4">
      <EditorPreview tileId={draft.panel.id} title={draft.panel.title} settings={settings}>
        {preview}
      </EditorPreview>
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t("pages.builder.style.actions")}>
        <Button variant="secondary" className="!h-8 !rounded-lg !px-2.5 !text-xs" disabled={!styled} onClick={() => setStyle(pickStyle(settings.style, (Object.keys(r) as (keyof TileStyle)[]).filter((k) => !APPEARANCE_KEYS.includes(k))))}>
          <RotateCcw size={13} />
          {t("pages.builder.style.reset")}
        </Button>
        <Button variant="secondary" className="!h-8 !rounded-lg !px-2.5 !text-xs" onClick={() => copyStyle(settings.style)}>
          <Copy size={13} />
          {t("pages.builder.style.copy")}
        </Button>
        <Button variant="secondary" className="!h-8 !rounded-lg !px-2.5 !text-xs" disabled={!clip} onClick={() => applyClip(clip)}>
          <ClipboardPaste size={13} />
          {t("pages.builder.style.paste")}
        </Button>
        <Button variant="secondary" className="!h-8 !rounded-lg !px-2.5 !text-xs" onClick={() => setConfirmAll(true)}>
          <LayoutGrid size={13} />
          {t("pages.builder.style.applyAll")}
        </Button>
        <Button variant="secondary" className="!h-8 !rounded-lg !px-2.5 !text-xs" disabled={!styled || myStyles.length >= 24} onClick={() => setNaming(true)} title={myStyles.length >= 24 ? t("pages.builder.style.myLimit") : undefined}>
          <Save size={13} />
          {t("pages.builder.style.saveMine")}
        </Button>
      </div>
      {confirmAll ? (
        <div role="alertdialog" aria-label={t("pages.builder.style.applyAll")} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-2.5 text-xs text-[var(--fg-muted)]">
          <span className="min-w-0 flex-1">{t("pages.builder.style.applyAllConfirm")}</span>
          <Button variant="secondary" className="!h-8 !text-xs" onClick={() => setConfirmAll(false)}>
            {t("cancel")}
          </Button>
          <Button
            className="!h-8 !text-xs"
            onClick={() => {
              onApplyToAll(pickStyle(settings.style, APPEARANCE_KEYS));
              setConfirmAll(false);
            }}
          >
            {t("confirm")}
          </Button>
        </div>
      ) : null}
      {naming ? (
        <form
          className="flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const next = addMyStyle(myStyles, name, settings.style, "my-" + crypto.randomUUID().slice(0, 8));
            if (next.length) onMyStyles(next);
            setNaming(false);
            setName("");
          }}
        >
          <Input autoFocus aria-label={t("pages.builder.style.myName")} placeholder={t("pages.builder.style.myName")} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="!h-8 !text-xs" />
          <Button type="submit" className="!h-8 !text-xs" disabled={!name.trim()}>
            {t("pages.builder.style.saveMine")}
          </Button>
          <Button type="button" variant="secondary" className="!h-8 !text-xs" onClick={() => setNaming(false)}>
            {t("cancel")}
          </Button>
        </form>
      ) : null}
      <Tabs tabs={tabs} active={active} onChange={setTab} size="sm" layoutId="tile-editor-tab" className="w-full" />
      <div role="tabpanel">
        {active === "data" ? <DataTab draft={draft} onDraft={onDraft} metrics={metrics} selected={selected} insert={insert} language={language} /> : null}
        {active === "look" ? <LookTab {...base} settings={settings} onSettings={onSettings} mixed={mixed} /> : null}
        {active === "appearance" ? (
          <AppearanceTab
            {...base}
            presetOf={r.preset}
            myStyles={myStyles}
            onPreset={onPreset}
            onApplyMine={(m) => applyClip(m.style)}
            onDeleteMine={(id) => onMyStyles(myStyles.filter((m) => m.id !== id))}
          />
        ) : null}
        {active === "colors" ? <ColorsTab {...base} /> : null}
        {active === "text" ? <TextTab {...base} precision={settings.precision ?? 1} onPrecision={(precision) => onSettings({ precision })} /> : null}
        {active === "charts" ? <ChartsTab {...base} /> : null}
        {active === "behavior" ? <BehaviorTab {...base} /> : null}
      </div>
    </div>
  );
}
