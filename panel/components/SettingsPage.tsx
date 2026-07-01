"use client";

import {
  BarChart3,
  Bell,
  Building2,
  CalendarSync,
  Download,
  Globe,
  Gauge,
  KeyRound,
  Link2,
  ListOrdered,
  Palette,
  Power,
  RotateCcw,
  Save,
  Send,
  Server,
  Settings as SettingsGearIcon,
  Shield,
  SlidersHorizontal,
  Tags,
  ToggleLeft,
  Type,
  UserCog,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AllSetting } from "@/lib/allSetting";
import { normalizeAllSetting } from "@/lib/allSetting";
import { getJson, postJson } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { getPanelTimeZoneOptions } from "@/lib/panelTimeZones";
import { changeLanguage, panelSelectLangValue, supported } from "@/lib/i18n";
import { linkP, panel, p } from "@/lib/paths";
import {
  applyPanelTheme,
  PANEL_THEME_DEFAULT,
  PANEL_THEME_IDS,
  parsePanelTheme,
  type PanelThemeId,
} from "@/lib/panelTheme";
import { parseSettingsTab, type SettingsTabId } from "@/lib/settingsTabs";
import { getUiPref, setUiPref } from "@/lib/uiPrefs";
import { PageScaffold, PageHeader, Surface } from "@/components/panel";
import { RemarkModelConstructor } from "@/components/settings/RemarkModelConstructor";
import { SubscriptionBuilder } from "@/components/settings/subscription/SubscriptionBuilder";
import { TgRunTimeField } from "@/components/settings/TgRunTimeField";
import {
  AlertBanner,
  Button,
  ConfirmDialog,
  HelpTooltip,
  IconTile,
  Input,
  Modal,
  SelectNative,
  Spinner,
  Switch,
  useToast,
  type IconTileTone,
} from "@/components/ui";
import type { HelpKey } from "@/components/ui/help-tooltip";

type ApiTokenRow = {
  id: number;
  name: string;
  createdAt: number;
  lastUsedAt?: number | null;
};


function SettingsSection({
  title,
  hint,
  children,
  icon,
  iconTone = "accent",
  full,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  icon?: LucideIcon;
  iconTone?: IconTileTone;
  full?: boolean;
}) {
  return (
    <Surface
      padding="none"
      className={`h-full overflow-hidden ${full ? "lg:col-span-2" : ""}`}
    >
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-start gap-3">
          {icon ? <IconTile icon={icon} tone={iconTone} size="sm" className="mt-0.5" /> : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--fg)]">{title}</h2>
            {hint ? <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">{hint}</p> : null}
          </div>
        </div>
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </Surface>
  );
}

function SettingsGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">{children}</div>;
}

function Row({
  label,
  hint,
  helpKey,
  children,
}: {
  label: string;
  hint?: string;
  helpKey?: HelpKey;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(160px,280px)_1fr] sm:items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-sm font-medium text-[var(--fg-muted)]">
          {label}
          {helpKey ? <HelpTooltip helpKey={helpKey} /> : null}
        </div>
        {hint ? <div className="mt-0.5 text-xs text-[var(--fg-subtle)]">{hint}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type SettingsTabConfig = {
  id: SettingsTabId;
  label: string;
  icon: LucideIcon;
};

/** Maps BCP-47 locale codes (used by the bot) to panel short codes for label lookup. */
const BCP47_TO_PANEL_CODE: Record<string, (typeof supported)[number]["code"]> = {
  "en-US": "en",
  "ru-RU": "ru",
  "fa-IR": "fa",
  "zh-CN": "zh",
  "zh-TW": "tw",
  "ar-EG": "ar",
  "es-ES": "es",
  "ja-JP": "ja",
  "id-ID": "id",
  "tr-TR": "tr",
  "pt-BR": "pt",
  "uk-UA": "uk",
  "vi-VN": "vi",
};

const PANEL_CODE_LABEL = Object.fromEntries(supported.map((s) => [s.code, s.label]));

const TG_BOT_LANGUAGE_OPTIONS = Object.entries(BCP47_TO_PANEL_CODE).map(([bcp47, code]) => ({
  value: bcp47,
  label: PANEL_CODE_LABEL[code] ?? bcp47,
}));

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const params = useParams();
  const activeTab = parseSettingsTab(
    typeof params?.tab === "string" ? params.tab : undefined,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AllSetting | null>(null);
  const [baseline, setBaseline] = useState<AllSetting | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [multiConfirmOpen, setMultiConfirmOpen] = useState(false);
  const [twoFactorModalOpen, setTwoFactorModalOpen] = useState(false);
  const [twoFactorQrB64, setTwoFactorQrB64] = useState("");
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorCodeInput, setTwoFactorCodeInput] = useState("");
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorSubmitting, setTwoFactorSubmitting] = useState(false);
  const [twoFactorDisableOpen, setTwoFactorDisableOpen] = useState(false);
  const [twoFactorDisableLoading, setTwoFactorDisableLoading] = useState(false);
  const [panelTheme, setPanelTheme] = useState<PanelThemeId>(PANEL_THEME_DEFAULT);
  const [account, setAccount] = useState({
    oldUsername: "",
    oldPassword: "",
    newUsername: "",
    newPassword: "",
  });
  const [apiTokens, setApiTokens] = useState<ApiTokenRow[]>([]);
  const [apiTokensLoading, setApiTokensLoading] = useState(false);
  const [newApiTokenName, setNewApiTokenName] = useState("");
  const [apiTokenCreating, setApiTokenCreating] = useState(false);
  const [apiTokenModalOpen, setApiTokenModalOpen] = useState(false);
  const [apiTokenModalValue, setApiTokenModalValue] = useState("");
  const [apiTokenRevokeOpen, setApiTokenRevokeOpen] = useState(false);
  const [apiTokenRevokeId, setApiTokenRevokeId] = useState<number | null>(null);
  const [apiTokenRevoking, setApiTokenRevoking] = useState(false);
  const [secretPathsGenerating, setSecretPathsGenerating] = useState(false);
  const [secretPathsSaving, setSecretPathsSaving] = useState(false);
  const [secretPathsUpdateSub, setSecretPathsUpdateSub] = useState(false);
  const [secretPathsEnv, setSecretPathsEnv] = useState({ web: false, sub: false });
  const [secretPathsDraft, setSecretPathsDraft] = useState({ webBasePath: "", subPath: "" });
  const [secretPathsResult, setSecretPathsResult] = useState<{
    webBasePath: string;
    subPath: string;
    subPathUpdated: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await postJson<Record<string, unknown>>(panel("setting/all"));
    setLoading(false);
    if (r.success && r.obj && typeof r.obj === "object" && !Array.isArray(r.obj)) {
      const n = normalizeAllSetting(r.obj as Record<string, unknown>);
      setForm(n);
      setBaseline(n);
      const resolvedTheme = parsePanelTheme(await getUiPref("panelTheme"));
      setPanelTheme(resolvedTheme);
      applyPanelTheme(resolvedTheme);
    } else {
      toast.error(r.msg || t("pages.settings.toasts.getSettings"));
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadApiTokens = useCallback(async () => {
    setApiTokensLoading(true);
    const r = await getJson<ApiTokenRow[]>(panel("api/tokens/list"));
    setApiTokensLoading(false);
    if (r.success && Array.isArray(r.obj)) {
      setApiTokens(r.obj);
    } else {
      toast.error(r.msg || t("pages.settings.security.apiTokenLoadError"));
    }
  }, [t, toast]);

  useEffect(() => {
    if (activeTab !== "security" || !form) return;
    void loadApiTokens();
  }, [activeTab, form, loadApiTokens]);

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  useEffect(() => {
    void (async () => {
      const r = await getJson<{ envOverridesWeb: boolean; envOverridesSub: boolean }>(
        panel("setting/secretPathsMeta"),
      );
      if (r.success && r.obj) {
        setSecretPathsEnv({ web: r.obj.envOverridesWeb, sub: r.obj.envOverridesSub });
      }
    })();
  }, []);

  useEffect(() => {
    if (!form) return;
    setSecretPathsDraft({ webBasePath: form.webBasePath, subPath: form.subPath });
  }, [form?.webBasePath, form?.subPath, form]);

  const applySecretPathsResult = (
    paths: { webBasePath: string; subPath: string; subPathUpdated?: boolean },
    toastKey: string,
  ) => {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            webBasePath: paths.webBasePath,
            subPath: paths.subPath,
          }
        : prev,
    );
    setSecretPathsDraft({ webBasePath: paths.webBasePath, subPath: paths.subPath });
    setSecretPathsResult({
      webBasePath: paths.webBasePath,
      subPath: paths.subPath,
      subPathUpdated: paths.subPathUpdated ?? secretPathsUpdateSub,
    });
    toast.success(t(toastKey));
  };

  const onGenerateSecretPaths = async () => {
    setSecretPathsGenerating(true);
    try {
      const r = await postJson<{
        webBasePath: string;
        subPath: string;
        subPathUpdated?: boolean;
      }>(panel("setting/generateSecretPaths"), { includeSub: secretPathsUpdateSub }, true);
      if (r.success && r.obj) {
        applySecretPathsResult(r.obj, "pages.settings.secretPathsGenerated");
      } else {
        toast.error(r.msg || t("pages.settings.secretPathsGenerateError"));
      }
    } catch {
      toast.error(t("fail"));
    } finally {
      setSecretPathsGenerating(false);
    }
  };

  const onSaveSecretPaths = async () => {
    setSecretPathsSaving(true);
    try {
      const r = await postJson<{
        webBasePath: string;
        subPath: string;
        subPathUpdated?: boolean;
      }>(panel("setting/saveSecretPaths"), {
        webBasePath: secretPathsDraft.webBasePath,
        subPath: secretPathsDraft.subPath,
        updateSub: secretPathsUpdateSub,
      }, true);
      if (r.success && r.obj) {
        applySecretPathsResult(r.obj, "pages.settings.secretPathsSaved");
      } else {
        toast.error(r.msg || t("pages.settings.secretPathsSaveError"));
      }
    } catch {
      toast.error(t("fail"));
    } finally {
      setSecretPathsSaving(false);
    }
  };

  const timeZoneListId = useId();
  const timeZoneOptions = useMemo(() => getPanelTimeZoneOptions(), []);

  const patch = useCallback(<K extends keyof AllSetting>(key: K, value: AllSetting[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    const r = await postJson(panel("setting/update"), form, true);
    setSaving(false);
    if (r.success) {
      toast.success(r.msg || t("success"));
      await load();
    } else {
      toast.error(r.msg || t("pages.settings.toasts.modifySettings"));
    }
  };

  const revert = () => {
    if (baseline) setForm(baseline);
  };

  const saveAccount = async () => {
    const r = await postJson(
      panel("setting/updateUser"),
      {
        oldUsername: account.oldUsername,
        oldPassword: account.oldPassword,
        newUsername: account.newUsername,
        newPassword: account.newPassword,
      },
      true,
    );
    if (r.success) {
      toast.success(r.msg || t("pages.settings.toasts.modifyUser"));
      setAccount({ oldUsername: "", oldPassword: "", newUsername: "", newPassword: "" });
    } else {
      toast.error(r.msg || t("pages.settings.toasts.modifyUserError"));
    }
  };

  const doRestart = async () => {
    setRestartLoading(true);
    const r = await postJson(panel("setting/restartPanel"));
    setRestartLoading(false);
    setRestartOpen(false);
    if (r.success) {
      toast.success(r.msg || t("pages.settings.restartPanelSuccess"));
    } else {
      toast.error(r.msg || t("fail"));
    }
  };


  const downloadGrafana = () => {
    window.location.href = p("panel/setting/grafana/dashboard");
  };

  const settingsTabs: SettingsTabConfig[] = useMemo(
    () => [
      { id: "general", label: t("pages.settings.tabs.general"), icon: SlidersHorizontal },
      { id: "security", label: t("pages.settings.tabs.security"), icon: Shield },
      { id: "telegram", label: t("pages.settings.tabs.telegram"), icon: Send },
      { id: "subscription", label: t("pages.settings.tabs.subscription"), icon: Link2 },
      { id: "ldap", label: t("pages.settings.tabs.ldap"), icon: Building2 },
      { id: "grafana", label: t("pages.settings.tabs.grafana"), icon: BarChart3 },
      { id: "admin", label: t("pages.settings.tabs.admin"), icon: UserCog },
    ],
    [t],
  );

  const activeTabLabel = useMemo(
    () => settingsTabs.find((x) => x.id === activeTab)?.label,
    [settingsTabs, activeTab],
  );

  if (loading && !form) {
    return (
      <PageScaffold compact>
        <PageHeader
          title={t("menu.settings")}
          eyebrow={activeTabLabel}
          description={t("pages.settings.infoDesc")}
          icon={SettingsGearIcon}
          iconTone="neutral"
        />
        <div className="min-w-0">
          <div
            className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-px md:hidden"
            aria-hidden
          >
            {settingsTabs.map((tab) => (
              <div
                key={tab.id}
                className="h-9 w-24 shrink-0 rounded-t-lg bg-[var(--surface)]/50 animate-pulse"
              />
            ))}
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden>
            <div className="h-56 rounded-xl border border-[var(--border)]/30 bg-[var(--surface)]/50 animate-pulse" />
            <div className="h-56 rounded-xl border border-[var(--border)]/30 bg-[var(--surface)]/50 animate-pulse" />
          </div>
        </div>
      </PageScaffold>
    );
  }

  if (!form) {
    return (
      <PageScaffold compact>
        <PageHeader title={t("menu.settings")} icon={SettingsGearIcon} iconTone="neutral" />
        <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
      </PageScaffold>
    );
  }

  const envHint = t("pages.settings.envOnlyHint");

  const tabNav = (
    <nav
      className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-px [-ms-overflow-style:none] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label={t("menu.settings")}
    >
      {settingsTabs.map((tab) => {
        const on = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={linkP(`panel/settings/${tab.id}`)}
            scroll={false}
            role="tab"
            aria-selected={on}
            id={`settings-tab-${tab.id}`}
            aria-controls={`settings-panel-${tab.id}`}
            className={`flex shrink-0 items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
              on
                ? "rounded-t-lg bg-[var(--surface-strong)] text-[var(--fg)] ring-1 ring-[var(--border-strong)] ring-b-0"
                : "whitespace-nowrap rounded-t-lg text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] hover:text-[var(--fg)]"
            }`}
          >
            <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );

  const panelBody = (
    <>
      {activeTab === "general" ? (
        <SettingsGrid>
          <SettingsSection
            title={t("pages.settings.sections.generalInterface")}
            hint={t("pages.settings.languageDesc")}
            icon={Globe}
            iconTone="accent"
            full
          >
            <Row label={t("pages.settings.language")}>
              <SelectNative
                value={panelSelectLangValue()}
                onChange={async (e) => {
                  await changeLanguage(e.target.value);
                }}
              >
                {supported.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </SelectNative>
            </Row>
            <Row
              label={t("pages.settings.panelTheme")}
              hint={t("pages.settings.panelThemeDesc")}
            >
              <SelectNative
                value={panelTheme}
                onChange={(e) => {
                  const v = e.target.value;
                  if ((PANEL_THEME_IDS as readonly string[]).includes(v)) {
                    const id = v as PanelThemeId;
                    setPanelTheme(id);
                    applyPanelTheme(id);
                    void setUiPref("panelTheme", id);
                  }
                }}
              >
                {PANEL_THEME_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`pages.settings.panelThemePreset.${id}`)}
                  </option>
                ))}
              </SelectNative>
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.generalPanelBind")}
            hint={envHint}
            icon={Server}
            iconTone="info"
          >
            <Row label={t("pages.settings.panelListeningIP")} hint={t("pages.settings.panelListeningIPDesc")}>
              <Input value={form.webListen} readOnly className="opacity-80" />
            </Row>
            <Row label={t("pages.settings.panelListeningDomain")} hint={t("pages.settings.panelListeningDomainDesc")}>
              <Input value={form.webDomain} readOnly className="opacity-80" />
            </Row>
            <Row label={t("pages.settings.panelPort")} hint={t("pages.settings.panelPortDesc")} helpKey="settings.panelPort">
              <Input type="number" value={form.webPort} readOnly className="opacity-80" />
            </Row>
            <Row label={t("pages.settings.publicKeyPath")} hint={t("pages.settings.publicKeyPathDesc")}>
              <Input value={form.webCertFile} readOnly className="opacity-80" />
            </Row>
            <Row label={t("pages.settings.privateKeyPath")} hint={t("pages.settings.privateKeyPathDesc")}>
              <Input value={form.webKeyFile} readOnly className="opacity-80" />
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.secretPaths")}
            hint={t("pages.settings.secretPathsSectionHint")}
            icon={Shield}
            iconTone="warning"
          >
            <div className="px-4 pt-3">
              <AlertBanner
                type="info"
                title={t("pages.settings.secretPathsInfoTitle")}
                description={t("pages.settings.secretPathsInfoDesc")}
              />
            </div>
            <Row label={t("pages.settings.secretPathsPanelPrefix")} hint={t("pages.settings.secretPathsPanelPrefixDesc")}>
              <Input
                value={secretPathsDraft.webBasePath}
                disabled={secretPathsEnv.web}
                className="font-mono text-xs"
                onChange={(e) =>
                  setSecretPathsDraft((prev) => ({ ...prev, webBasePath: e.target.value }))
                }
              />
            </Row>
            <Row label={t("pages.settings.secretPathsSubPrefix")} hint={t("pages.settings.secretPathsSubPrefixDesc")}>
              <Input
                value={secretPathsDraft.subPath}
                disabled={secretPathsEnv.sub || !secretPathsUpdateSub}
                className="font-mono text-xs"
                onChange={(e) =>
                  setSecretPathsDraft((prev) => ({ ...prev, subPath: e.target.value }))
                }
              />
            </Row>
            <Row
              label={t("pages.settings.secretPathsIncludeSub")}
              hint={t("pages.settings.secretPathsIncludeSubDesc")}
            >
              <Switch
                checked={secretPathsUpdateSub}
                disabled={secretPathsEnv.sub}
                onChange={setSecretPathsUpdateSub}
                ariaLabel={t("pages.settings.secretPathsIncludeSub")}
              />
            </Row>
            {(secretPathsEnv.web || secretPathsEnv.sub) ? (
              <div className="px-4 pb-3">
                <AlertBanner
                  type="warning"
                  title={t("pages.settings.secretPathsEnvTitle")}
                  description={t("pages.settings.secretPathsEnvDesc")}
                />
              </div>
            ) : null}
            <Row label={t("pages.settings.secretPathsSave")} hint={t("pages.settings.secretPathsSaveDesc")}>
              <Button
                type="button"
                variant="primary"
                disabled={secretPathsSaving || secretPathsEnv.web}
                onClick={() => void onSaveSecretPaths()}
              >
                {secretPathsSaving ? t("loading") : t("pages.settings.secretPathsSaveBtn")}
              </Button>
            </Row>
            <Row label={t("pages.settings.secretPathsGenerate")} hint={t("pages.settings.secretPathsGenerateDesc")}>
              <Button
                type="button"
                variant="secondary"
                disabled={secretPathsGenerating || secretPathsEnv.web}
                onClick={() => void onGenerateSecretPaths()}
              >
                {secretPathsGenerating ? t("loading") : t("pages.settings.secretPathsGenerateBtn")}
              </Button>
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.generalSessionLists")}
            icon={ListOrdered}
            iconTone="accent"
          >
            <Row label={t("pages.settings.sessionMaxAge")} hint={t("pages.settings.sessionMaxAgeDesc")}>
              <Input
                type="number"
                value={form.sessionMaxAge}
                onChange={(e) => patch("sessionMaxAge", parseInt(e.target.value, 10) || 0)}
              />
            </Row>
            <Row label={t("pages.settings.pageSize")} hint={t("pages.settings.pageSizeDesc")}>
              <Input
                type="number"
                value={form.pageSize}
                onChange={(e) => patch("pageSize", parseInt(e.target.value, 10) || 0)}
              />
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.generalThresholdsDisplay")}
            icon={Gauge}
            iconTone="warning"
          >
            <Row label={t("pages.settings.expireTimeDiff")} hint={t("pages.settings.expireTimeDiffDesc")}>
              <div className="flex max-w-xs items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  className="min-w-0 flex-1"
                  value={form.expireDiff}
                  onChange={(e) => patch("expireDiff", parseInt(e.target.value, 10) || 0)}
                />
                <span className="shrink-0 text-xs tabular-nums text-[var(--fg-muted)]">
                  {t("pages.settings.thresholdUnitDays")}
                </span>
              </div>
            </Row>
            <Row label={t("pages.settings.trafficDiff")} hint={t("pages.settings.trafficDiffDesc")}>
              <div className="flex max-w-xs items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  className="min-w-0 flex-1"
                  value={form.trafficDiff}
                  onChange={(e) => patch("trafficDiff", parseInt(e.target.value, 10) || 0)}
                />
                <span className="shrink-0 text-xs tabular-nums text-[var(--fg-muted)]">
                  {t("pages.settings.thresholdUnitGb")}
                </span>
              </div>
            </Row>
            <div className="space-y-2 px-4 py-3">
              <div className="text-sm font-medium text-[var(--fg-muted)]">
                {t("pages.settings.remarkModelLegendTitle")}
              </div>
              <div className="text-xs leading-relaxed text-[var(--fg-subtle)]">
                {t("pages.settings.remarkModelLegendIntro")}
              </div>
              <RemarkModelConstructor
                value={form.remarkModel}
                onChange={(model) => patch("remarkModel", model)}
              />
            </div>
            <Row label={t("pages.settings.datepicker")} hint={t("pages.settings.datepickerDescription")}>
              <SelectNative
                className="max-w-md"
                value={form.datepicker}
                onChange={(e) => patch("datepicker", e.target.value)}
              >
                {form.datepicker &&
                form.datepicker !== "gregorian" &&
                form.datepicker !== "jalalian" ? (
                  <option value={form.datepicker}>{form.datepicker}</option>
                ) : null}
                <option value="gregorian">
                  {t("pages.settings.datepickerGregorian")}
                </option>
                <option value="jalalian">
                  {t("pages.settings.datepickerJalalian")}
                </option>
              </SelectNative>
            </Row>
            <Row label={t("pages.settings.timeZone")} hint={t("pages.settings.timeZoneDesc")}>
              <div className="max-w-md space-y-1.5">
                <Input
                  list={timeZoneListId}
                  value={form.timeLocation}
                  onChange={(e) => patch("timeLocation", e.target.value)}
                  placeholder={t("pages.settings.timeZonePlaceholder")}
                  autoComplete="off"
                />
                <datalist id={timeZoneListId}>
                  {timeZoneOptions.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </div>
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.generalModes")}
            icon={ToggleLeft}
            iconTone="success"
          >
            <Row
              label={t("pages.settings.panelLogLevel")}
              hint={t("pages.settings.panelLogLevelDesc")}
            >
              <SelectNative value={form.panelLogLevel} onChange={(e) => patch("panelLogLevel", e.target.value)}>
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="notice">notice</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </SelectNative>
            </Row>
            <Row label={t("pages.settings.logRotateMaxSize", { defaultValue: "Log max size (MB)" })} hint={t("pages.settings.logRotateMaxSizeDesc", { defaultValue: "Rotate panel and node log files when they exceed this size." })}>
              <Input
                type="number"
                min={1}
                max={1024}
                className="max-w-[120px]"
                value={form.logRotateMaxSizeMB}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  patch("logRotateMaxSizeMB", Number.isFinite(v) ? Math.min(1024, Math.max(1, v)) : 50);
                }}
              />
            </Row>
            <Row label={t("pages.settings.logRotateMaxAge", { defaultValue: "Log retention (days)" })} hint={t("pages.settings.logRotateMaxAgeDesc", { defaultValue: "Delete rotated log files older than this many days." })}>
              <Input
                type="number"
                min={1}
                max={365}
                className="max-w-[120px]"
                value={form.logRotateMaxAgeDays}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  patch("logRotateMaxAgeDays", Number.isFinite(v) ? Math.min(365, Math.max(1, v)) : 14);
                }}
              />
            </Row>
            <Row label={t("pages.settings.logRotateMaxBackups", { defaultValue: "Rotated log files" })} hint={t("pages.settings.logRotateMaxBackupsDesc", { defaultValue: "Number of rotated log files to keep per service." })}>
              <Input
                type="number"
                min={1}
                max={100}
                className="max-w-[120px]"
                value={form.logRotateMaxBackups}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  patch("logRotateMaxBackups", Number.isFinite(v) ? Math.min(100, Math.max(1, v)) : 5);
                }}
              />
            </Row>
            <Row label={t("pages.settings.logRotateCompress", { defaultValue: "Compress rotated logs" })} hint={t("pages.settings.logRotateCompressDesc", { defaultValue: "Gzip old log files to save disk space." })}>
              <Switch checked={form.logRotateCompress} onChange={(on) => patch("logRotateCompress", on)} ariaLabel={t("pages.settings.logRotateCompress", { defaultValue: "Compress rotated logs" })} />
            </Row>
            <Row label={t("pages.settings.multiNodeMode")} hint={t("pages.settings.multiNodeModeDesc")}>
              <Switch
                checked={form.multiNodeMode}
                onChange={(on) => {
                  if (on && !form.multiNodeMode) {
                    setMultiConfirmOpen(true);
                  } else {
                    patch("multiNodeMode", on);
                  }
                }}
                ariaLabel={t("pages.settings.enableMultiNodeMode")}
              />
            </Row>
            <Row
              label={t("pages.settings.enableIPv6")}
              hint={t("pages.settings.enableIPv6Desc")}
            >
              <Switch
                checked={form.enableIPv6}
                onChange={(on) => patch("enableIPv6", on)}
                ariaLabel={t("pages.settings.enableIPv6")}
              />
            </Row>
            {form.multiNodeMode ? (
              <>
                <Row label={t("pages.settings.nodeStatsInterval")} hint={t("pages.settings.nodeStatsIntervalDesc")}>
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    className="max-w-[120px]"
                    value={form.nodeStatsCollectionIntervalSec}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      patch(
                        "nodeStatsCollectionIntervalSec",
                        Number.isFinite(v) ? Math.min(600, Math.max(1, v)) : 3,
                      );
                    }}
                  />
                </Row>
                <Row label={t("pages.settings.nodeHealthInterval")} hint={t("pages.settings.nodeHealthIntervalDesc")}>
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    className="max-w-[120px]"
                    value={form.nodeHealthCheckIntervalSec}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      patch(
                        "nodeHealthCheckIntervalSec",
                        Number.isFinite(v) ? Math.min(600, Math.max(1, v)) : 15,
                      );
                    }}
                  />
                </Row>
                <Row
                  label={t("pages.settings.nodeHealthDegradedInterval")}
                  hint={t("pages.settings.nodeHealthDegradedIntervalDesc")}
                >
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    className="max-w-[120px]"
                    value={form.nodeHealthCheckDegradedIntervalSec}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      patch(
                        "nodeHealthCheckDegradedIntervalSec",
                        Number.isFinite(v) ? Math.min(600, Math.max(1, v)) : 5,
                      );
                    }}
                  />
                </Row>
              </>
            ) : null}
            <Row label={t("hwidSettings")} hint={t("hwidBetaWarningDesc")}>
              <SelectNative value={form.hwidMode} onChange={(e) => patch("hwidMode", e.target.value)}>
                <option value="off">{t("pages.settings.hwidMode.off")}</option>
                <option value="client_header">
                  {t("pages.settings.hwidMode.header")}
                </option>
                <option value="legacy_fingerprint">
                  {t("pages.settings.hwidMode.legacy")}
                </option>
              </SelectNative>
            </Row>
            <Row
              label={t("pages.settings.ipLimitGlobalEnable", { defaultValue: "Enable IP limit enforcement" })}
              hint={t("pages.settings.ipLimitGlobalEnableDesc", {
                defaultValue: "Background job that enforces per-client concurrent IP limits.",
              })}
            >
              <Switch
                checked={form.ipLimitGlobalEnable}
                onChange={(on) => patch("ipLimitGlobalEnable", on)}
                ariaLabel={t("pages.settings.ipLimitGlobalEnable", { defaultValue: "Enable IP limit enforcement" })}
              />
            </Row>
            {form.ipLimitGlobalEnable ? (
              <>
                <Row
                  label={t("pages.settings.ipLimitCheckInterval", { defaultValue: "Check interval (sec)" })}
                  hint={t("pages.settings.ipLimitCheckIntervalDesc", {
                    defaultValue: "How often the panel scans online sessions for IP limit violations (5–600).",
                  })}
                >
                  <Input
                    type="number"
                    min={5}
                    max={600}
                    className="max-w-[120px]"
                    value={form.ipLimitCheckIntervalSec}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      patch(
                        "ipLimitCheckIntervalSec",
                        Number.isFinite(v) ? Math.min(600, Math.max(5, v)) : 30,
                      );
                    }}
                  />
                </Row>
                <Row
                  label={t("pages.settings.ipLimitBanDuration", { defaultValue: "Ban duration (sec)" })}
                  hint={t("pages.settings.ipLimitBanDurationDesc", {
                    defaultValue: "How long excess IPs stay blocked in subscription routing. 0 = permanent until manual unblock.",
                  })}
                >
                  <Input
                    type="number"
                    min={0}
                    max={2592000}
                    className="max-w-[120px]"
                    value={form.ipLimitBanDurationSec}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      patch(
                        "ipLimitBanDurationSec",
                        Number.isFinite(v) ? Math.min(2592000, Math.max(0, v)) : 3600,
                      );
                    }}
                  />
                </Row>
                <Row
                  label={t("pages.settings.ipLimitEnforcement", { defaultValue: "Enforcement mode" })}
                  hint={t("pages.settings.ipLimitEnforcementDesc", {
                    defaultValue: "Drop closes active connections; block denies subscription/routing for the IP; both applies drop and block.",
                  })}
                >
                  <SelectNative
                    value={form.ipLimitEnforcement}
                    onChange={(e) => patch("ipLimitEnforcement", e.target.value)}
                  >
                    <option value="drop">{t("pages.settings.ipLimitEnforcement.drop", { defaultValue: "Drop connections only" })}</option>
                    <option value="block">{t("pages.settings.ipLimitEnforcement.block", { defaultValue: "Block IP in subscription" })}</option>
                    <option value="drop_and_block">
                      {t("pages.settings.ipLimitEnforcement.dropAndBlock", { defaultValue: "Drop and block" })}
                    </option>
                  </SelectNative>
                </Row>
                <Row
                  label={t("pages.settings.ipLimitExcessPolicy", { defaultValue: "Excess IP policy" })}
                  hint={t("pages.settings.ipLimitExcessPolicyDesc", {
                    defaultValue: "Which connections to target when the client exceeds the concurrent IP limit.",
                  })}
                >
                  <SelectNative
                    value={form.ipLimitExcessPolicy}
                    onChange={(e) => patch("ipLimitExcessPolicy", e.target.value)}
                  >
                    <option value="newest">
                      {t("pages.settings.ipLimitExcessPolicy.newest", { defaultValue: "Kick newest IPs" })}
                    </option>
                    <option value="oldest">
                      {t("pages.settings.ipLimitExcessPolicy.oldest", { defaultValue: "Kick oldest IPs" })}
                    </option>
                  </SelectNative>
                </Row>
              </>
            ) : null}
          </SettingsSection>
        </SettingsGrid>
      ) : null}

      {activeTab === "security" ? (
        <SettingsGrid>
        <SettingsSection
          title={t("pages.settings.security.twoFactorSection")}
          icon={Shield}
          iconTone="danger"
          full
        >
          {form.twoFactorEnable && form.twoFactorToken ? (
            <>
              <Row label={t("pages.settings.security.twoFactorEnable")}>
                <p className="text-sm text-[var(--fg-muted)]">
                  {t("pages.settings.security.twoFactorEnabledHint")}
                </p>
              </Row>
              <Row
                label={t("pages.settings.security.twoFactorTelegram")}
                hint={t("pages.settings.security.twoFactorTelegramDesc")}
              >
                <Switch
                  checked={form.twoFactorTelegram}
                  onChange={(v) => patch("twoFactorTelegram", v)}
                  ariaLabel={t("pages.settings.security.twoFactorTelegram")}
                />
              </Row>
              <Row label={t("pages.settings.security.twoFactorDisable")}>
                <Button type="button" variant="secondary" onClick={() => setTwoFactorDisableOpen(true)}>
                  {t("pages.settings.security.twoFactorDisable")}
                </Button>
              </Row>
            </>
          ) : (
            <Row label={t("pages.settings.security.twoFactorEnable")} hint={t("pages.settings.security.twoFactorEnableDesc")}>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setTwoFactorCodeInput("");
                  setTwoFactorModalOpen(true);
                  void (async () => {
                    setTwoFactorBusy(true);
                    setTwoFactorQrB64("");
                    setTwoFactorSecret("");
                    const r = await postJson<{ qrPngBase64: string; secret: string }>(
                      panel("setting/twoFactor/begin"),
                      {},
                    );
                    setTwoFactorBusy(false);
                    if (r.success && r.obj && typeof r.obj === "object") {
                      const o = r.obj as { qrPngBase64?: string; secret?: string };
                      setTwoFactorQrB64(o.qrPngBase64 ?? "");
                      setTwoFactorSecret(o.secret ?? "");
                    } else {
                      toast.error(r.msg || t("pages.settings.security.twoFactorBeginError"));
                      setTwoFactorModalOpen(false);
                    }
                  })();
                }}
              >
                {t("pages.settings.security.twoFactorSetupButton")}
              </Button>
            </Row>
          )}
        </SettingsSection>

        <SettingsSection
          title={t("pages.settings.security.apiTokenSection")}
          hint={t("pages.settings.security.apiTokenHint")}
          icon={KeyRound}
          iconTone="warning"
          full
        >
          <Row
            label={t("pages.settings.security.apiTokenName")}
            hint={t("pages.settings.security.apiTokenNamePlaceholder")}
          >
            <div className="flex max-w-2xl flex-col gap-2 sm:flex-row sm:items-end">
              <Input
                value={newApiTokenName}
                onChange={(e) => setNewApiTokenName(e.target.value)}
                placeholder={t("pages.settings.security.apiTokenNamePlaceholder")}
                autoComplete="off"
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="primary"
                loading={apiTokenCreating}
                onClick={() => {
                  void (async () => {
                    setApiTokenCreating(true);
                    const r = await postJson<{ token: string; id: number; name: string }>(
                      panel("api/tokens/create"),
                      { name: newApiTokenName.trim() },
                      true,
                    );
                    setApiTokenCreating(false);
                    if (r.success && r.obj && typeof r.obj === "object") {
                      const o = r.obj as { token?: string };
                      if (o.token) {
                        setApiTokenModalValue(o.token);
                        setApiTokenModalOpen(true);
                      }
                      setNewApiTokenName("");
                      await loadApiTokens();
                    } else {
                      toast.error(r.msg || t("pages.settings.security.apiTokenCreateError"));
                    }
                  })();
                }}
              >
                {t("pages.settings.security.apiTokenCreate")}
              </Button>
            </div>
          </Row>
          {apiTokensLoading ? (
            <div className="flex justify-center px-4 py-10">
              <Spinner size={32} />
            </div>
          ) : apiTokens.length === 0 ? (
            <p className="px-4 py-3 text-sm leading-relaxed text-[var(--fg-muted)]">
              {t("pages.settings.security.apiTokenNoTokens")}
            </p>
          ) : (
            <div className="px-4 pb-4 pt-1 sm:pt-0">
              <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-sm">
                <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--fg)_4%,transparent)] text-xs text-[var(--fg-muted)]">
                      <th className="px-4 py-3 pr-3 font-medium">{t("pages.settings.security.apiTokenName")}</th>
                      <th className="px-3 py-3 font-medium whitespace-nowrap">
                        {t("pages.settings.security.apiTokenCreatedAt")}
                      </th>
                      <th className="px-3 py-3 font-medium whitespace-nowrap">
                        {t("pages.settings.security.apiTokenLastUsed")}
                      </th>
                      <th className="w-0 min-w-0 px-3 py-3 pr-4 text-right font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {apiTokens.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--border)]/70 transition-colors last:border-0 hover:bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]"
                      >
                        <td className="px-4 py-3 pr-3 align-middle text-[var(--fg)]">
                          <span className="font-medium">{row.name || "—"}</span>
                        </td>
                        <td className="px-3 py-3 text-[var(--fg-muted)] tabular-nums">
                          {row.createdAt
                            ? new Date(row.createdAt * 1000).toLocaleString(i18n.language)
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-[var(--fg-muted)] tabular-nums">
                          {row.lastUsedAt != null && row.lastUsedAt > 0
                            ? new Date(row.lastUsedAt * 1000).toLocaleString(i18n.language)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 pr-4 text-right align-middle">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setApiTokenRevokeId(row.id);
                              setApiTokenRevokeOpen(true);
                            }}
                          >
                            {t("pages.settings.security.apiTokenRevoke")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SettingsSection>
        </SettingsGrid>
      ) : null}

      {activeTab === "telegram" ? (
        <SettingsGrid>
          <SettingsSection
            title={t("pages.settings.sections.telegramConnection")}
            icon={Send}
            iconTone="info"
          >
            <Row label={t("pages.settings.telegramBotEnable")} hint={t("pages.settings.telegramBotEnableDesc")}>
              <Switch
                checked={form.tgBotEnable}
                onChange={(v) => patch("tgBotEnable", v)}
                ariaLabel={t("pages.settings.telegramBotEnable")}
              />
            </Row>
            <Row label={t("pages.settings.telegramToken")} hint={t("pages.settings.telegramTokenDesc")}>
              <Input value={form.tgBotToken} onChange={(e) => patch("tgBotToken", e.target.value)} autoComplete="off" />
            </Row>
            <Row label={t("pages.settings.telegramProxy")} hint={t("pages.settings.telegramProxyDesc")}>
              <Input value={form.tgBotProxy} onChange={(e) => patch("tgBotProxy", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.telegramAPIServer")} hint={t("pages.settings.telegramAPIServerDesc")}>
              <Input value={form.tgBotAPIServer} onChange={(e) => patch("tgBotAPIServer", e.target.value)} />
            </Row>
          </SettingsSection>
          <SettingsSection
            title={t("pages.settings.sections.telegramNotifications")}
            icon={Bell}
            iconTone="warning"
          >
            <Row label={t("pages.settings.telegramChatId")} hint={t("pages.settings.telegramChatIdDesc")}>
              <Input value={form.tgBotChatId} onChange={(e) => patch("tgBotChatId", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.telegramNotifyTime")} hint={t("pages.settings.telegramNotifyTimeDesc")}>
              <TgRunTimeField value={form.tgRunTime} onChange={(v) => patch("tgRunTime", v)} t={t} />
            </Row>
            <Row label={t("pages.settings.tgNotifyBackup")} hint={t("pages.settings.tgNotifyBackupDesc")}>
              <Switch
                checked={form.tgBotBackup}
                onChange={(v) => patch("tgBotBackup", v)}
                ariaLabel={t("pages.settings.tgNotifyBackup")}
              />
            </Row>
            <Row label={t("pages.settings.tgNotifyLogin")} hint={t("pages.settings.tgNotifyLoginDesc")}>
              <Switch
                checked={form.tgBotLoginNotify}
                onChange={(v) => patch("tgBotLoginNotify", v)}
                ariaLabel={t("pages.settings.tgNotifyLogin")}
              />
            </Row>
            <Row label={t("pages.settings.tgNotifyCpu")} hint={t("pages.settings.tgNotifyCpuDesc")}>
              <Input
                type="number"
                value={form.tgCpu}
                onChange={(e) => patch("tgCpu", parseInt(e.target.value, 10) || 0)}
              />
            </Row>
            <Row label={t("pages.settings.telegramBotLanguage")}>
              <SelectNative value={form.tgLang} onChange={(e) => patch("tgLang", e.target.value)}>
                {!TG_BOT_LANGUAGE_OPTIONS.some((lang) => lang.value === form.tgLang) ? (
                  <option value={form.tgLang}>{form.tgLang}</option>
                ) : null}
                {TG_BOT_LANGUAGE_OPTIONS.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.label}
                  </option>
                ))}
              </SelectNative>
            </Row>
          </SettingsSection>
        </SettingsGrid>
      ) : null}

      {activeTab === "subscription" ? (
        <SettingsGrid>
          <SettingsSection
            title={t("pages.settings.sections.subOverview")}
            hint={envHint}
            icon={Link2}
            iconTone="accent"
          >
            <Row label={t("pages.settings.subEnable")} hint={t("pages.settings.subEnableDesc")} helpKey="settings.subEnable">
              <Switch
                checked={form.subEnable}
                onChange={(v) => patch("subEnable", v)}
                ariaLabel={t("pages.settings.subEnable")}
              />
            </Row>
            <Row label={t("pages.settings.subJsonEnable")}>
              <Switch
                checked={form.subJsonEnable}
                onChange={(v) => patch("subJsonEnable", v)}
                ariaLabel={t("pages.settings.subJsonEnable")}
              />
            </Row>
            <Row label={t("pages.settings.subListen")} hint={t("pages.settings.subListenDesc")} helpKey="settings.subListen">
              <Input value={form.subListen} onChange={(e) => patch("subListen", e.target.value)} />
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.subUriTitles")}
            icon={Type}
            iconTone="neutral"
          >
            <div className="px-4 pt-3">
              <AlertBanner
                type="info"
                title={t("pages.settings.envOnlyNetworkTitle")}
                description={t("pages.settings.envOnlyNetworkDesc")}
              />
            </div>
            <Row label={t("pages.settings.subURI")} hint={t("pages.settings.subURIDesc")} helpKey="settings.subUri">
              <Input
                value={form.subURI}
                onChange={(e) => patch("subURI", e.target.value)}
                placeholder={t("pages.settings.subURIPlaceholder")}
              />
            </Row>
            <Row
              label={t("pages.settings.subPageURI")}
              hint={t("pages.settings.subPageURIDesc")}
            >
              <Input
                value={form.subPageURI}
                onChange={(e) => patch("subPageURI", e.target.value)}
                placeholder={t("pages.settings.subPageURIPlaceholder")}
              />
            </Row>
            <Row label={t("pages.settings.subJsonPath")} hint={t("pages.settings.subJsonPathDesc")}>
              <Input value={form.subJsonPath} onChange={(e) => patch("subJsonPath", e.target.value)} placeholder="/json/" />
            </Row>
            <Row label={t("pages.settings.subJsonURI")} hint={t("pages.settings.subJsonURIDesc")}>
              <Input
                value={form.subJsonURI}
                onChange={(e) => patch("subJsonURI", e.target.value)}
                placeholder={t("pages.settings.subJsonURIPlaceholder")}
              />
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.subExternalTraffic")}
            icon={Webhook}
            iconTone="warning"
          >
            <Row label={t("pages.settings.externalTrafficInformEnable")} hint={t("pages.settings.externalTrafficInformEnableDesc")}>
              <Switch
                checked={form.externalTrafficInformEnable}
                onChange={(v) => patch("externalTrafficInformEnable", v)}
                ariaLabel={t("pages.settings.externalTrafficInformEnable")}
              />
            </Row>
            <Row label={t("pages.settings.externalTrafficInformURI")} hint={t("pages.settings.externalTrafficInformURIDesc")}>
              <Input value={form.externalTrafficInformURI} onChange={(e) => patch("externalTrafficInformURI", e.target.value)} />
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.subProvider")}
            icon={Tags}
            iconTone="accent"
          >
            <Row label={t("pages.settings.subProviderID")} hint={t("pages.settings.subProviderIDDesc")} helpKey="settings.subProviderId">
              <Input value={form.subProviderID} onChange={(e) => patch("subProviderID", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.subProviderIDMethod")} hint={t("pages.settings.subProviderIDMethodDesc")}>
              <SelectNative
                value={form.subProviderIDMethod}
                onChange={(e) => patch("subProviderIDMethod", e.target.value)}
              >
                <option value="url">{t("pages.settings.subProviderIDMethodUrl")}</option>
                <option value="header">{t("pages.settings.subProviderIDMethodHeader")}</option>
                <option value="body">{t("pages.settings.subProviderIDMethodBody")}</option>
                <option value="none">{t("pages.settings.subProviderIDMethodNone")}</option>
              </SelectNative>
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.subpageBuilder")}
            hint={t("pages.settings.sections.subpageBuilderHint")}
            icon={Palette}
            iconTone="accent"
            full
          >
            <div className="px-4 py-4">
              <SubscriptionBuilder />
            </div>
          </SettingsSection>
        </SettingsGrid>
      ) : null}

      {activeTab === "ldap" ? (
        <SettingsGrid>
          <SettingsSection
            title={t("pages.settings.sections.ldapServerTls")}
            hint={t("pages.settings.ldapSectionDesc")}
            icon={Building2}
            iconTone="info"
          >
            <Row label={t("pages.settings.ldapEnable")}>
              <Switch
                checked={form.ldapEnable}
                onChange={(v) => patch("ldapEnable", v)}
                ariaLabel={t("pages.settings.ldapEnable")}
              />
            </Row>
            <Row label={t("host")}>
              <Input value={form.ldapHost} onChange={(e) => patch("ldapHost", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.ldapPortLabel")}>
              <Input
                type="number"
                value={form.ldapPort}
                onChange={(e) => patch("ldapPort", parseInt(e.target.value, 10) || 0)}
              />
            </Row>
            <Row label={t("pages.settings.certs")}>
              <Switch
                checked={form.ldapUseTLS}
                onChange={(v) => patch("ldapUseTLS", v)}
                ariaLabel={t("pages.settings.ldapUseTLS")}
              />
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.ldapBindSearch")}
            icon={KeyRound}
            iconTone="neutral"
          >
            <Row label={t("pages.settings.ldapBindDN")}>
              <Input value={form.ldapBindDN} onChange={(e) => patch("ldapBindDN", e.target.value)} autoComplete="off" />
            </Row>
            <Row label={t("password")}>
              <Input
                type="password"
                value={form.ldapPassword}
                onChange={(e) => patch("ldapPassword", e.target.value)}
                autoComplete="new-password"
              />
            </Row>
            <Row label={t("pages.settings.ldapBaseDN")}>
              <Input value={form.ldapBaseDN} onChange={(e) => patch("ldapBaseDN", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.ldapUserFilter")}>
              <Input value={form.ldapUserFilter} onChange={(e) => patch("ldapUserFilter", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.ldapUserAttr")}>
              <Input value={form.ldapUserAttr} onChange={(e) => patch("ldapUserAttr", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.ldapVlessField")}>
              <Input value={form.ldapVlessField} onChange={(e) => patch("ldapVlessField", e.target.value)} />
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.ldapSyncFlags")}
            icon={CalendarSync}
            iconTone="accent"
          >
            <Row label={t("pages.settings.ldapSyncCron")}>
              <Input value={form.ldapSyncCron} onChange={(e) => patch("ldapSyncCron", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.ldapFlagField")}>
              <Input value={form.ldapFlagField} onChange={(e) => patch("ldapFlagField", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.ldapTruthyValues")}>
              <Input value={form.ldapTruthyValues} onChange={(e) => patch("ldapTruthyValues", e.target.value)} />
            </Row>
            <Row label={t("pages.settings.ldapInvertFlag")}>
              <Switch
                checked={form.ldapInvertFlag}
                onChange={(v) => patch("ldapInvertFlag", v)}
                ariaLabel={t("pages.settings.ldapInvertFlag")}
              />
            </Row>
            <Row label={t("pages.settings.ldapInboundTags")}>
              <Input value={form.ldapInboundTags} onChange={(e) => patch("ldapInboundTags", e.target.value)} />
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.ldapClientDefaults")}
            icon={UserCog}
            iconTone="success"
          >
            <Row label={t("pages.settings.ldapAutoCreate")}>
              <Switch
                checked={form.ldapAutoCreate}
                onChange={(v) => patch("ldapAutoCreate", v)}
                ariaLabel={t("pages.settings.ldapAutoCreate")}
              />
            </Row>
            <Row label={t("pages.settings.ldapAutoDelete")}>
              <Switch
                checked={form.ldapAutoDelete}
                onChange={(v) => patch("ldapAutoDelete", v)}
                ariaLabel={t("pages.settings.ldapAutoDelete")}
              />
            </Row>
            <Row label={t("pages.settings.ldapDefaultTotalGB")}>
              <Input
                type="number"
                value={form.ldapDefaultTotalGB}
                onChange={(e) => patch("ldapDefaultTotalGB", parseInt(e.target.value, 10) || 0)}
              />
            </Row>
            <Row label={t("pages.settings.ldapDefaultExpiryDays")}>
              <Input
                type="number"
                value={form.ldapDefaultExpiryDays}
                onChange={(e) => patch("ldapDefaultExpiryDays", parseInt(e.target.value, 10) || 0)}
              />
            </Row>
            <Row label={t("pages.settings.ldapDefaultLimitIP")}>
              <Input
                type="number"
                value={form.ldapDefaultLimitIP}
                onChange={(e) => patch("ldapDefaultLimitIP", parseInt(e.target.value, 10) || 0)}
              />
            </Row>
          </SettingsSection>
        </SettingsGrid>
      ) : null}

      {activeTab === "grafana" ? (
        <SettingsGrid>
          <SettingsSection
            title={t("pages.settings.sections.grafanaEndpoints")}
            hint={t("pages.settings.grafanaIntegrationEnabledDesc")}
            icon={BarChart3}
            iconTone="info"
          >
            <Row label={t("pages.settings.grafanaEnable")} hint={t("pages.settings.grafanaEnableDesc")}>
              <Switch
                checked={form.grafanaEnable}
                onChange={(v) => patch("grafanaEnable", v)}
                ariaLabel={t("pages.settings.grafanaEnable")}
              />
            </Row>
            <Row label={t("pages.settings.grafanaLokiUrl")} hint={t("pages.settings.grafanaLokiUrlDesc")}>
              <Input value={form.grafanaLokiUrl} onChange={(e) => patch("grafanaLokiUrl", e.target.value)} />
            </Row>
            <Row
              label={t("pages.settings.grafanaVictoriaMetricsUrl")}
              hint={t("pages.settings.grafanaVictoriaMetricsUrlDesc")}
            >
              <Input
                value={form.grafanaVictoriaMetricsUrl}
                onChange={(e) => patch("grafanaVictoriaMetricsUrl", e.target.value)}
              />
            </Row>
          </SettingsSection>
          <SettingsSection
            title={t("pages.settings.sections.grafanaExport")}
            icon={Download}
            iconTone="success"
          >
            <Row label={t("pages.settings.grafanaMetricsEndpoint")} hint={t("pages.settings.grafanaMetricsEndpointDesc")}>
              <code className="text-xs break-all text-[var(--fg-muted)]">{p("panel/metrics")}</code>
            </Row>
            <Row label={t("pages.settings.grafanaDashboard")} hint={t("pages.settings.grafanaDashboardDesc")}>
              <Button type="button" variant="secondary" className="!gap-2" onClick={downloadGrafana}>
                <Download size={16} />
                {t("download")}
              </Button>
            </Row>
          </SettingsSection>
        </SettingsGrid>
      ) : null}

      {activeTab === "admin" ? (
        <SettingsGrid>
          <SettingsSection
            title={t("pages.settings.sections.adminCredentials")}
            icon={UserCog}
            iconTone="danger"
          >
            <Row label={t("pages.settings.oldUsername")}>
              <Input
                value={account.oldUsername}
                onChange={(e) => setAccount((a) => ({ ...a, oldUsername: e.target.value }))}
                autoComplete="username"
              />
            </Row>
            <Row label={t("pages.settings.currentPassword")}>
              <Input
                type="password"
                value={account.oldPassword}
                onChange={(e) => setAccount((a) => ({ ...a, oldPassword: e.target.value }))}
                autoComplete="current-password"
              />
            </Row>
            <Row label={t("pages.settings.newUsername")}>
              <Input
                value={account.newUsername}
                onChange={(e) => setAccount((a) => ({ ...a, newUsername: e.target.value }))}
                autoComplete="off"
              />
            </Row>
            <Row label={t("pages.settings.newPassword")}>
              <Input
                type="password"
                value={account.newPassword}
                onChange={(e) => setAccount((a) => ({ ...a, newPassword: e.target.value }))}
                autoComplete="new-password"
              />
            </Row>
            <Row label={t("pages.settings.actions")}>
              <Button type="button" variant="primary" onClick={() => void saveAccount()} className="!gap-2">
                <Save size={16} />
                {t("update")}
              </Button>
            </Row>
          </SettingsSection>

          <SettingsSection
            title={t("pages.settings.sections.adminRestart")}
            hint={t("pages.settings.restartPanelDesc")}
            icon={Power}
            iconTone="warning"
          >
            <Row label={t("pages.settings.actions")}>
              <Button type="button" variant="secondary" className="!gap-2" onClick={() => setRestartOpen(true)}>
                <Power size={16} />
                {t("pages.settings.restartPanel")}
              </Button>
            </Row>
          </SettingsSection>
        </SettingsGrid>
      ) : null}
    </>
  );

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("menu.settings")}
        eyebrow={activeTabLabel}
        description={t("pages.settings.infoDesc")}
        icon={SettingsGearIcon}
        iconTone="neutral"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={revert} disabled={!dirty} className="!gap-2">
              <RotateCcw size={16} />
              {t("reset")}
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty} className="!gap-2">
              <Save size={16} />
              {t("pages.settings.save")}
            </Button>
          </div>
        }
      />

      {dirty ? (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-[var(--fg)]">
          {t("pages.settings.unsavedHint")}
        </div>
      ) : null}

      <div className="min-w-0">
        {tabNav}
        <div
          className="min-w-0"
          role="tabpanel"
          id={`settings-panel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
        >
          {panelBody}
        </div>
      </div>

      <ConfirmDialog
        open={restartOpen}
        title={t("pages.settings.restartPanel")}
        description={t("pages.settings.restartPanelDesc")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        danger
        loading={restartLoading}
        onCancel={() => setRestartOpen(false)}
        onConfirm={doRestart}
      />

      <ConfirmDialog
        open={multiConfirmOpen}
        title={t("pages.settings.multiNodeMode")}
        description={t("pages.settings.enableMultiNodeModeConfirm")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        onCancel={() => setMultiConfirmOpen(false)}
        onConfirm={() => {
          patch("multiNodeMode", true);
          setMultiConfirmOpen(false);
        }}
      />

      <Modal
        open={twoFactorModalOpen}
        onClose={() => {
          if (!twoFactorSubmitting) {
            void postJson(panel("setting/twoFactor/cancel"), {});
            setTwoFactorModalOpen(false);
            setTwoFactorQrB64("");
            setTwoFactorSecret("");
            setTwoFactorCodeInput("");
          }
        }}
        title={t("pages.settings.security.twoFactorModalSetTitle")}
        width={440}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={twoFactorSubmitting || twoFactorBusy}
              onClick={() => {
                void postJson(panel("setting/twoFactor/cancel"), {});
                setTwoFactorModalOpen(false);
                setTwoFactorQrB64("");
                setTwoFactorSecret("");
                setTwoFactorCodeInput("");
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={twoFactorSubmitting}
              disabled={twoFactorBusy || !twoFactorSecret}
              onClick={() => {
                void (async () => {
                  setTwoFactorSubmitting(true);
                  const r = await postJson(
                    panel("setting/twoFactor/complete"),
                    { code: twoFactorCodeInput.trim() },
                    true,
                  );
                  setTwoFactorSubmitting(false);
                  if (r.success) {
                    toast.success(r.msg || t("pages.settings.security.twoFactorModalSetSuccess"));
                    setTwoFactorModalOpen(false);
                    setTwoFactorQrB64("");
                    setTwoFactorSecret("");
                    setTwoFactorCodeInput("");
                    await load();
                  } else {
                    toast.error(r.msg || t("pages.settings.security.twoFactorModalError"));
                  }
                })();
              }}
            >
              {t("confirm")}
            </Button>
          </div>
        }
      >
        <div className={`space-y-4 px-5 py-4 ${twoFactorBusy ? "pointer-events-none opacity-60" : ""}`}>
          <p className="text-sm text-[var(--fg-muted)]">{t("pages.settings.security.twoFactorModalSteps")}</p>
          {twoFactorBusy ? (
            <div className="flex justify-center py-8">
              <Spinner size={36} />
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--fg-muted)]">{t("pages.settings.security.twoFactorModalFirstStep")}</p>
              {twoFactorQrB64 ? (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${twoFactorQrB64}`}
                    width={200}
                    height={200}
                    alt=""
                    className="rounded-lg border border-[var(--border)] bg-white p-1"
                  />
                </div>
              ) : null}
              {twoFactorSecret ? (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                    {t("pages.settings.security.twoFactor")}
                  </label>
                  <Input value={twoFactorSecret} readOnly className="font-mono text-sm" />
                </div>
              ) : null}
              <p className="text-sm text-[var(--fg-muted)]">{t("pages.settings.security.twoFactorModalSecondStep")}</p>
              <Input
                value={twoFactorCodeInput}
                onChange={(e) => setTwoFactorCodeInput(e.target.value)}
                autoComplete="one-time-code"
                placeholder={t("twoFactorCode")}
                inputMode="numeric"
              />
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={twoFactorDisableOpen}
        title={t("pages.settings.security.twoFactorModalDeleteTitle")}
        description={t("pages.settings.security.twoFactorDisableConfirm")}
        confirmLabel={t("pages.settings.security.twoFactorDisable")}
        cancelLabel={t("cancel")}
        danger
        loading={twoFactorDisableLoading}
        onCancel={() => setTwoFactorDisableOpen(false)}
        onConfirm={() => {
          void (async () => {
            if (!form) return;
            setTwoFactorDisableLoading(true);
            const body = {
              ...form,
              twoFactorEnable: false,
              twoFactorToken: "",
              twoFactorTelegram: false,
            };
            const r = await postJson(panel("setting/update"), body, true);
            setTwoFactorDisableLoading(false);
            setTwoFactorDisableOpen(false);
            if (r.success) {
              toast.success(r.msg || t("pages.settings.security.twoFactorModalDeleteSuccess"));
              await load();
            } else {
              toast.error(r.msg || t("pages.settings.toasts.modifySettings"));
            }
          })();
        }}
      />

      <Modal
        open={apiTokenModalOpen}
        onClose={() => {
          setApiTokenModalOpen(false);
          setApiTokenModalValue("");
        }}
        title={t("pages.settings.security.apiTokenModalTitle")}
        width={480}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                if (!apiTokenModalValue) {
                  return;
                }
                void copyTextToClipboard(apiTokenModalValue)
                  .then(() => {
                    toast.success(t("copySuccess"));
                  })
                  .catch(() => {
                    toast.error(t("fail"));
                  });
              }}
            >
              {t("copy")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setApiTokenModalOpen(false);
                setApiTokenModalValue("");
              }}
            >
              {t("close")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-[var(--fg-muted)]">{t("pages.settings.security.apiTokenModalHint")}</p>
          <Input value={apiTokenModalValue} readOnly className="font-mono text-xs" />
        </div>
      </Modal>

      <Modal
        open={secretPathsResult != null}
        onClose={() => setSecretPathsResult(null)}
        title={t("pages.settings.secretPathsModalTitle")}
        width={520}
        footer={
          <Button type="button" variant="secondary" onClick={() => setSecretPathsResult(null)}>
            {t("close")}
          </Button>
        }
      >
        {secretPathsResult ? (
          <div className="space-y-4 px-5 py-4 text-sm">
            <p className="text-[var(--fg-muted)]">{t("pages.settings.secretPathsModalHint")}</p>
            <div>
              <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">
                {t("pages.settings.secretPathsPanelLoginUrl")}
              </div>
              <code className="block break-all rounded-lg border border-[var(--border)] bg-[var(--bg-muted)]/40 px-3 py-2 font-mono text-xs">
                {typeof window !== "undefined"
                  ? `${window.location.origin}${secretPathsResult.webBasePath}`
                  : secretPathsResult.webBasePath}
              </code>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-[var(--fg-muted)]">
                {t("pages.settings.secretPathsSubPrefix")}
              </div>
              <code className="block break-all rounded-lg border border-[var(--border)] bg-[var(--bg-muted)]/40 px-3 py-2 font-mono text-xs">
                {secretPathsResult.subPath}
              </code>
              {!secretPathsResult.subPathUpdated ? (
                <p className="mt-2 text-xs text-[var(--fg-muted)]">
                  {t("pages.settings.secretPathsSubUnchanged")}
                </p>
              ) : null}
            </div>
            <AlertBanner
              type="warning"
              title={t("pages.settings.secretPathsRestartTitle")}
              description={
                secretPathsResult.subPathUpdated
                  ? t("pages.settings.secretPathsRestartDesc")
                  : t("pages.settings.secretPathsRestartPanelOnlyDesc")
              }
            />
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={apiTokenRevokeOpen}
        title={t("pages.settings.security.apiTokenRevoke")}
        description={t("pages.settings.security.apiTokenConfirmRevoke")}
        confirmLabel={t("pages.settings.security.apiTokenRevoke")}
        cancelLabel={t("cancel")}
        danger
        loading={apiTokenRevoking}
        onCancel={() => {
          setApiTokenRevokeOpen(false);
          setApiTokenRevokeId(null);
        }}
        onConfirm={() => {
          void (async () => {
            if (apiTokenRevokeId == null) return;
            setApiTokenRevoking(true);
            const r = await postJson(panel("api/tokens/revoke"), { id: apiTokenRevokeId }, true);
            setApiTokenRevoking(false);
            setApiTokenRevokeOpen(false);
            setApiTokenRevokeId(null);
            if (r.success) {
              toast.success(r.msg || t("success"));
              await loadApiTokens();
            } else {
              toast.error(r.msg || t("pages.settings.security.apiTokenRevokeError"));
            }
          })();
        }}
      />
    </PageScaffold>
  );
}
