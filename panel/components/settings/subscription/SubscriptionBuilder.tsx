"use client";

import {
  Braces,
  Code2,
  Layers,
  Megaphone,
  MessageSquareText,
  Palette,
  RotateCcw,
  Route,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertBanner, Button, Input, MonacoJsonEditor, Tabs, TabPanels, useToast } from "@/components/ui";
import { getSharxV2ConfigMonacoEntry } from "@/lib/sharxV2ConfigJsonSchemaForMonaco";
import { postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import {
  defaultV2,
  parseAnyAsV2,
  stringifyConfig,
  type SharxSubpageConfigV2,
  type SubpageBlock,
} from "@/lib/sharxSubpageConfig";
import { BlockListEditor } from "./BlockListEditor";
import { BrandingEditor } from "./BrandingEditor";
import { CustomRemarksEditor } from "./CustomRemarksEditor";
import { RoutingProfilesEditor } from "./RoutingProfilesEditor";
import { JsonTemplatesEditor } from "./JsonTemplatesEditor";
import { ResponseRulesEditor } from "./ResponseRulesEditor";
import { SubscriptionPreview } from "./SubscriptionPreview";

type LeftTab =
  | "branding"
  | "blocks"
  | "response-rules"
  | "custom-remarks"
  | "client-routing"
  | "json-templates"
  | "raw";

import { isPristineDefault } from "@/lib/subLayout/wow";
import { SubDesigner } from "./designer/SubDesigner";

export function SubscriptionBuilder() {
  const { t } = useTranslation();
  const toast = useToast();

  const [config, setConfig] = useState<SharxSubpageConfigV2>(() => defaultV2());
  const [uuid, setUuid] = useState("");
  const [name, setName] = useState("Default");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<LeftTab>("branding");
  const [rawJson, setRawJson] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [migratedNotice, setMigratedNotice] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await postJson<{
      uuid: string;
      name: string;
      configJson: string;
    }>(panel("setting/subscriptionPageConfig/get"), { uuid: "" });
    setLoading(false);
    if (r.success && r.obj && typeof r.obj === "object") {
      const row = r.obj as { uuid?: string; name?: string; configJson?: string };
      setUuid(row.uuid ?? "");
      setName(row.name ?? "Default");
      const raw = row.configJson ?? "{}";
      const parsed = parseAnyAsV2(raw);
      if (parsed.ok) {
        setConfig(parsed.data);
        setMigratedNotice(!!parsed.migrated);
        setRawJson(stringifyConfig(parsed.data));
      } else {
        setRawJson(raw);
        toast.error(parsed.error);
      }
    } else {
      toast.error(r.msg || t("pages.settings.toasts.getSettings", { defaultValue: "Failed to load settings." }));
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep raw JSON in sync when the user edits via visual builder.
  useEffect(() => {
    if (activeTab !== "raw") {
      setRawJson(stringifyConfig(config));
      setRawError(null);
    }
  }, [config, activeTab]);

  const { rawConfigPath, rawConfigSchemaBundle } = useMemo(() => {
    const e = getSharxV2ConfigMonacoEntry();
    return {
      rawConfigPath: e.fileName,
      rawConfigSchemaBundle: [{ uri: e.uri, fileMatch: [e.fileName], schema: e.schema }],
    };
  }, []);

  const handleSetBlocks = useCallback(
    (blocks: SubpageBlock[]) => setConfig((c) => ({ ...c, blocks })),
    [],
  );

  const handleRawChange = (raw: string) => {
    setRawJson(raw);
    const parsed = parseAnyAsV2(raw);
    if (!parsed.ok) {
      setRawError(parsed.error);
      return;
    }
    setRawError(null);
    setConfig(parsed.data);
  };

  const save = async (override?: SharxSubpageConfigV2): Promise<boolean> => {
    const payload = stringifyConfig(override ?? config);
    setLoading(true);
    const r = await postJson(
      panel("setting/subscriptionPageConfig/save"),
      {
        uuid: uuid || undefined,
        name,
        configJson: payload,
      },
      true,
    );
    setLoading(false);
    if (r.success) {
      toast.success(r.msg || t("subBuilder.saveSuccess", { defaultValue: "Saved" }));
      setMigratedNotice(false);
      if (!override) void load();
      return true;
    }
    toast.error(r.msg || t("pages.settings.toasts.modifySettings", { defaultValue: "Could not save." }));
    return false;
  };

  const resetToDefault = () => {
    const next = defaultV2();
    setConfig(next);
    setRawJson(stringifyConfig(next));
    setRawError(null);
  };

  const layoutInUse = !!(config as { layout?: { enabled?: boolean } }).layout?.enabled || isPristineDefault(config);
  useEffect(() => {
    if (layoutInUse && activeTab === "blocks") setActiveTab("branding");
  }, [layoutInUse, activeTab]);
  const tabs = useMemo(
    () => [
      {
        id: "branding" as LeftTab,
        label: t("subBuilder.tabs.branding", { defaultValue: "Branding" }),
        icon: Palette,
      },
      ...(layoutInUse
        ? []
        : [
            {
              id: "blocks" as LeftTab,
              label: t("subBuilder.tabs.blocks", { defaultValue: "Blocks" }),
              icon: Layers,
              badge: config.blocks.length || undefined,
            },
          ]),
      {
        id: "response-rules" as LeftTab,
        label: t("subBuilder.tabs.responseRules", { defaultValue: "Response rules" }),
        icon: Megaphone,
      },
      {
        id: "custom-remarks" as LeftTab,
        label: t("subBuilder.tabs.customRemarks", { defaultValue: "Subscription remarks" }),
        icon: MessageSquareText,
      },
      {
        id: "client-routing" as LeftTab,
        label: t("subBuilder.tabs.clientRouting", { defaultValue: "Client routing" }),
        icon: Route,
        badge: config.routing?.profiles?.length || undefined,
      },
      {
        id: "json-templates" as LeftTab,
        label: t("subBuilder.tabs.jsonTemplates", { defaultValue: "JSON templates" }),
        icon: Braces,
      },
      {
        id: "raw" as LeftTab,
        label: t("subBuilder.tabs.raw", { defaultValue: "Raw JSON" }),
        icon: Code2,
      },
    ],
    [t, config.blocks.length, config.routing?.profiles?.length, layoutInUse],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
            {t("pages.settings.subpageConfigUuid", { defaultValue: "Config UUID" })}
          </div>
          <Input value={uuid} readOnly className="opacity-90" />
        </label>
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
            {t("pages.settings.subpageConfigName", { defaultValue: "Display name" })}
          </div>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>

      {migratedNotice ? (
        <AlertBanner
          type="info"
          title={t("subBuilder.migrated.title", {
            defaultValue: "Config was upgraded to sharx-v2",
          })}
          description={t("subBuilder.migrated.text", {
            defaultValue: "Your existing branding is preserved. Default blocks were added.",
          })}
          onClose={() => setMigratedNotice(false)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {t("subBuilder.designer.cardTitle", { defaultValue: "Visual designer" })}
            {layoutInUse ? (
              <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-400">{t("subBuilder.designer.cardOn", { defaultValue: "in use" })}</span>
            ) : null}
          </div>
          <p className="mb-1 text-xs text-[var(--fg-muted)]">{t("subBuilder.designer.appearanceMoved", { defaultValue: "Look and blocks (palette, colors, theme, elements) are set in the designer. This page keeps the content and the behavior of the subscription." })}</p>
          <p className="text-xs text-[var(--fg-muted)]">{t("subBuilder.designer.cardText", { defaultValue: "Drag elements like in Figma: stacks, grids, free positioning, mobile overrides, template variables and custom code." })}</p>
        </div>
        <Button type="button" variant="primary" onClick={() => setDesignerOpen(true)}>
          {t("subBuilder.designer.open", { defaultValue: "Open designer" })}
        </Button>
      </div>
      {designerOpen ? (
        <SubDesigner config={config} onChange={setConfig} onSave={(c) => save(c)} onClose={() => setDesignerOpen(false)} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs<LeftTab>
            tabs={tabs}
            active={activeTab}
            onChange={setActiveTab}
            layoutId="sub-builder-tab"
          />
          <TabPanels value={activeTab}>
            {activeTab === "branding" ? (
              <BrandingEditor config={config} onChange={setConfig} />
            ) : activeTab === "blocks" ? (
              <BlockListEditor blocks={config.blocks} onChange={handleSetBlocks} />
            ) : activeTab === "response-rules" ? (
              <ResponseRulesEditor config={config} onChange={setConfig} />
            ) : activeTab === "custom-remarks" ? (
              <CustomRemarksEditor config={config} onChange={setConfig} />
            ) : activeTab === "client-routing" ? (
              <RoutingProfilesEditor config={config} onChange={setConfig} />
            ) : activeTab === "json-templates" ? (
              <JsonTemplatesEditor config={config} onChange={setConfig} />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                  <MonacoJsonEditor
                    path={rawConfigPath}
                    value={rawJson}
                    onChange={handleRawChange}
                    height="60vh"
                    schemaBundle={rawConfigSchemaBundle}
                  />
                </div>
                {rawError ? (
                  <AlertBanner type="error" title={rawError} />
                ) : (
                  <p className="text-[11px] text-[var(--fg-subtle)]">
                    {t("subBuilder.raw.hint", {
                      defaultValue:
                        "Sharx-v1 and sharx-v2 are both accepted; v1 is migrated to v2 automatically. Editor validates against sharx-v2 schema; hover over keys for hints.",
                    })}
                  </p>
                )}
              </div>
            )}
          </TabPanels>
        </div>

        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <SubscriptionPreview config={config} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
        <Button type="button" variant="secondary" onClick={resetToDefault}>
          <RotateCcw size={16} />
          {t("subBuilder.resetDefault", { defaultValue: "Reset to default" })}
        </Button>
        <div className="flex-1" />
        <Button
          type="button"
          variant="primary"
          onClick={() => void save()}
          loading={loading}
          disabled={!!rawError}
        >
          <Save size={16} />
          {t("pages.settings.subpageSaveConfig", {
            defaultValue: "Save subscription page config",
          })}
        </Button>
      </div>
    </div>
  );
}
