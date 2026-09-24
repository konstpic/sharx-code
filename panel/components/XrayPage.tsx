"use client";

import { RotateCcw, Save, Wand2, FileCode2, Radio, Wrench, Upload, Download, LayoutTemplate, Share2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getJson, postJson } from "@/lib/api";
import { linkP, panel } from "@/lib/paths";
import { normalizeAllSetting } from "@/lib/allSetting";
import { PageScaffold, PageHeader, Surface } from "@/components/panel";
import { ShareTemplateModal, TemplateGalleryModal } from "@/components/templates/TemplateHub";
import { XrayConfigurator, type XrayConfiguratorHandle } from "@/components/xray/configurator/XrayConfigurator";
import { Button, ConfirmDialog, Spinner, useToast, Input, Modal, Switch } from "@/components/ui";

type XrayView = "template" | "runtime" | "geo";
type GeoFileName = "geoip.dat" | "geosite.dat";
type GeofileApplyResult = {
  fileName: string;
  localOk: boolean;
  nodeSuccess: string[];
  nodeErrors: string[];
};
type GeofileAsset = {
  id: number;
  fileType: "geoip" | "geosite";
  displayName: string;
  sourceUrl: string;
  filePath: string;
  sizeBytes: number;
  sha256: string;
  isActive: boolean;
  createdAt: number;
};
type GeofileAssetApplyResponse = {
  asset?: GeofileAsset;
  result?: GeofileApplyResult;
};

function parsePanelObj<T>(obj: unknown): T | null {
  let raw: unknown = obj;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw as T;
}

function templateToString(xraySetting: unknown): string {
  if (xraySetting == null) return "{}";
  if (typeof xraySetting === "string") {
    try {
      return JSON.stringify(JSON.parse(xraySetting), null, 2);
    } catch {
      return xraySetting;
    }
  }
  return JSON.stringify(xraySetting, null, 2);
}

export function XrayPage({ initialView = "template" }: { initialView?: XrayView }) {
  const geoOnlyPage = initialView === "geo";
  const { t } = useTranslation();
  const toast = useToast();
  const [view, setView] = useState<XrayView>(initialView);
  const [dataEpoch, setDataEpoch] = useState(0);
  const [hasSectionError, setHasSectionError] = useState(false);
  const editorRef = useRef<XrayConfiguratorHandle>(null);
  const [template, setTemplate] = useState("{}");
  const [baseline, setBaseline] = useState("{}");
  const [runtime, setRuntime] = useState("{}");
  const [inboundTags, setInboundTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [multi, setMulti] = useState(false);
  const [xrayState, setXrayState] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoipUrl, setGeoipUrl] = useState("");
  const [geositeUrl, setGeositeUrl] = useState("");
  const [geoAssets, setGeoAssets] = useState<Record<GeoFileName, GeofileAsset[]>>({
    "geoip.dat": [],
    "geosite.dat": [],
  });
  const [geoAssetsLoading, setGeoAssetsLoading] = useState(false);
  const [geoResultOpen, setGeoResultOpen] = useState(false);
  const [geoResultTitle, setGeoResultTitle] = useState("");
  const [geoResult, setGeoResult] = useState<GeofileApplyResult | null>(null);
  const [geofileAutoUpdateEnable, setGeofileAutoUpdateEnable] = useState(false);
  const [geofileAutoUpdateIntervalHours, setGeofileAutoUpdateIntervalHours] = useState(24);
  const [geofileRetentionCount, setGeofileRetentionCount] = useState(5);
  const [geofileAutoUpdateSaving, setGeofileAutoUpdateSaving] = useState(false);

  const loadSettingsFlags = useCallback(async () => {
    const s = await postJson<Record<string, unknown>>(panel("setting/all"));
    if (s.success && s.obj) {
      const settings = normalizeAllSetting(s.obj as Record<string, unknown>);
      setMulti(settings.multiNodeMode);
      setGeofileAutoUpdateEnable(settings.geofileAutoUpdateEnable);
      setGeofileAutoUpdateIntervalHours(settings.geofileAutoUpdateIntervalHours);
      setGeofileRetentionCount(settings.geofileRetentionCount);
    }
  }, []);

  const saveGeofileAutoUpdate = useCallback(
    async (patch: {
      geofileAutoUpdateEnable?: boolean;
      geofileAutoUpdateIntervalHours?: number;
      geofileRetentionCount?: number;
    }) => {
      setGeofileAutoUpdateSaving(true);
      try {
        const s = await postJson<Record<string, unknown>>(panel("setting/all"));
        if (!s.success || !s.obj) {
          toast.error(t("fail"));
          return;
        }
        const body = {
          ...normalizeAllSetting(s.obj as Record<string, unknown>),
          ...patch,
        };
        const r = await postJson(panel("setting/update"), body, true);
        if (r.success) {
          toast.success(t("success"));
        } else {
          toast.error(r.msg || t("fail"));
        }
      } finally {
        setGeofileAutoUpdateSaving(false);
      }
    },
    [t, toast],
  );

  const loadTemplate = useCallback(async () => {
    setLoading(true);
    const r = await postJson<unknown>(panel("xray/"), {});
    setLoading(false);
    if (!r.success) {
      toast.error(r.msg || t("pages.settings.toasts.getSettings"));
      return;
    }
    const parsed = parsePanelObj<{
      xraySetting: unknown;
      inboundTags: unknown;
    }>(r.obj);
    if (!parsed) {
      toast.error(t("fail"));
      return;
    }
    const tStr = templateToString(parsed.xraySetting);
    setTemplate(tStr);
    setBaseline(tStr);
    setDataEpoch((e) => e + 1);
    setHasSectionError(false);
    const tags = parsed.inboundTags;
    if (Array.isArray(tags)) {
      setInboundTags(tags.filter((x): x is string => typeof x === "string"));
    } else {
      setInboundTags([]);
    }
  }, [t, toast]);

  const loadRuntime = useCallback(async () => {
    setLoadingRuntime(true);
    const r = await getJson<unknown>(panel("api/server/getConfigJson"));
    setLoadingRuntime(false);
    if (r.success) {
      setRuntime(JSON.stringify(r.obj, null, 2));
    } else {
      toast.error(r.msg || t("pages.settings.toasts.getSettings"));
    }
  }, [t, toast]);

  const standalone = !multi;

  const loadXrayHint = useCallback(async () => {
    const r = await getJson<string>(panel("xray/getXrayResult"));
    if (r.success && r.obj) {
      setXrayState(typeof r.obj === "string" ? r.obj : null);
    }
  }, []);

  useEffect(() => {
    void loadSettingsFlags();
  }, [loadSettingsFlags]);

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  useEffect(() => {
    if (view === "runtime") {
      void loadRuntime();
    }
  }, [view, loadRuntime]);

  const loadGeoAssets = useCallback(async () => {
    setGeoAssetsLoading(true);
    try {
      const [geoipRes, geositeRes] = await Promise.all([
        getJson<GeofileAsset[]>(panel("api/server/geofileAssets/geoip.dat")),
        getJson<GeofileAsset[]>(panel("api/server/geofileAssets/geosite.dat")),
      ]);
      setGeoAssets({
        "geoip.dat": geoipRes.success && Array.isArray(geoipRes.obj) ? geoipRes.obj : [],
        "geosite.dat": geositeRes.success && Array.isArray(geositeRes.obj) ? geositeRes.obj : [],
      });
    } finally {
      setGeoAssetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "geo") {
      void loadGeoAssets();
    }
  }, [view, loadGeoAssets]);

  useEffect(() => {
    void loadXrayHint();
  }, [loadXrayHint]);

  const dirty = useMemo(
    () => view === "template" && (template !== baseline || hasSectionError),
    [view, template, baseline, hasSectionError],
  );

  const save = async () => {
    if (view !== "template") return;
    const toSave = editorRef.current?.getJsonForSave() ?? null;
    if (toSave == null) {
      toast.error(t("pages.xrayCoreConfigProfiles.invalidJson"));
      return;
    }
    setSaving(true);
    const r = await postJson(panel("xray/update"), { xraySetting: toSave });
    setSaving(false);
    if (r.success) {
      toast.success(r.msg || t("success"));
      setTemplate(toSave);
      setBaseline(toSave);
      setDataEpoch((e) => e + 1);
      setHasSectionError(false);
      await loadRuntime();
    } else {
      toast.error(r.msg || t("pages.settings.toasts.modifySettings"));
    }
  };

  const revert = () => {
    if (view === "template") {
      setTemplate(baseline);
      setDataEpoch((e) => e + 1);
      setHasSectionError(false);
    }
  };

  const doReset = async () => {
    setResetting(true);
    const r = await postJson(panel("xray/resetToDefault"), {});
    setResetting(false);
    setResetOpen(false);
    if (r.success) {
      toast.success(r.msg || t("success"));
      await loadTemplate();
      await loadRuntime();
    } else {
      toast.error(r.msg || t("pages.settings.toasts.modifySettings"));
    }
  };

  const setViewMode = useCallback(
    (next: XrayView) => {
      if (next === "runtime" && hasSectionError) {
        toast.error(t("pages.xrayCoreConfigProfiles.invalidJson"));
        return;
      }
      setView(next);
    },
    [hasSectionError, t, toast],
  );

  const showGeoResult = (title: string, res: GeofileApplyResult | null | undefined) => {
    setGeoResultTitle(title);
    setGeoResult(res ?? null);
    setGeoResultOpen(true);
  };

  const uploadGeofileToStorage = async (fileName: GeoFileName) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dat,application/octet-stream";
    input.onchange = async (event) => {
      const f = (event.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const fd = new FormData();
      fd.append("file", f);
      fd.append("displayName", f.name || "");
      setGeoBusy(true);
      try {
        const res = await api.post<{ success: boolean; msg: string }>(
          panel(`api/server/geofileAssets/upload/${fileName}`),
          fd,
          { headers: { "Content-Type": "multipart/form-data" } },
        );
        if (res.data.success) {
          toast.success(t("success"));
          await loadGeoAssets();
        } else {
          toast.error(res.data.msg || t("fail"));
        }
      } catch {
        toast.error(t("fail"));
      } finally {
        setGeoBusy(false);
      }
    };
    input.click();
  };

  const rollbackGeofile = async (fileName: GeoFileName) => {
    setGeoBusy(true);
    try {
      const r = await postJson<GeofileApplyResult>(panel(`api/server/rollbackGeofile/${fileName}`));
      if (r.success) {
        toast.success(r.msg || t("success"));
      } else {
        toast.error(r.msg || t("fail"));
      }
      showGeoResult(
        t("pages.xray.geoRollbackTitle", { file: fileName }),
        r.obj || null,
      );
    } finally {
      setGeoBusy(false);
    }
  };

  const saveDownloadToStorage = async (fileName: GeoFileName, sourceURL: string) => {
    if (!sourceURL.trim()) {
      toast.error(t("pages.xray.geoUrlRequired"));
      return;
    }
    setGeoBusy(true);
    try {
      const r = await postJson(
        panel(`api/server/geofileAssets/download/${fileName}`),
        { url: sourceURL.trim() },
        true,
      );
      if (r.success) {
        toast.success(t("success"));
        await loadGeoAssets();
      } else {
        toast.error(r.msg || t("fail"));
      }
    } finally {
      setGeoBusy(false);
    }
  };

  const applyGeofileAsset = async (id: number) => {
    setGeoBusy(true);
    try {
      const r = await postJson<GeofileAssetApplyResponse>(panel(`api/server/geofileAssets/apply/${id}`));
      if (r.success) {
        toast.success(r.msg || t("success"));
      } else {
        toast.error(r.msg || t("fail"));
      }
      showGeoResult(r.msg || "Apply geofile asset", r.obj?.result || null);
      await loadGeoAssets();
    } finally {
      setGeoBusy(false);
    }
  };

  const deleteGeofileAsset = async (id: number) => {
    setGeoBusy(true);
    try {
      const r = await postJson(panel(`api/server/geofileAssets/delete/${id}`));
      if (r.success) {
        toast.success(r.msg || t("success"));
        await loadGeoAssets();
      } else {
        toast.error(r.msg || t("fail"));
      }
    } finally {
      setGeoBusy(false);
    }
  };

  const pageDescription = useMemo(() => {
    if (view === "template") {
      return standalone
        ? t("pages.xray.TemplateDescStandalone")
        : t("pages.xray.TemplateDesc");
    }
    if (view === "geo") {
      return t("pages.xray.geoSectionDesc");
    }
    return standalone
      ? t("pages.xray.runtimeViewStandalone")
      : t("pages.xray.runtimeView");
  }, [view, standalone, t]);

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("pages.xray.title")}
        description={pageDescription}
        icon={Wrench}
        iconTone="accent"
        actions={
          <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
            {!geoOnlyPage ? (
              <div className="inline-flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={view === "template" ? "primary" : "secondary"}
                  onClick={() => setViewMode("template")}
                  className="!gap-2"
                >
                  <FileCode2 size={16} />
                  {standalone
                    ? t("pages.xray.configEditorTab")
                    : t("pages.xray.Template")}
                </Button>
                <Button
                  type="button"
                  variant={view === "runtime" ? "primary" : "secondary"}
                  onClick={() => setViewMode("runtime")}
                  className="!gap-2"
                >
                  <Radio size={16} />
                  {t("pages.xray.runtimeViewTab")}
                </Button>
              </div>
            ) : null}
            {view === "template" ? (
              <>
                <span
                  className="hidden h-7 w-px shrink-0 self-center bg-[var(--border)] sm:block"
                  aria-hidden
                />
                <div className="inline-flex min-w-0 flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={revert} disabled={!dirty} className="!gap-2">
                    <RotateCcw size={16} />
                    {t("reset")}
                  </Button>
                  <Button variant="secondary" onClick={() => setGalleryOpen(true)} className="!gap-2">
                    <LayoutTemplate size={16} />
                    {t("pages.templates.gallery", { defaultValue: "Templates" })}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShareOpen(true)}
                    disabled={dirty}
                    title={
                      dirty
                        ? t("pages.templates.saveBeforeShare", { defaultValue: "Save the template first: the saved version is what gets shared" })
                        : undefined
                    }
                    className="!gap-2"
                  >
                    <Share2 size={16} />
                    {t("pages.templates.shareShort", { defaultValue: "Share" })}
                  </Button>
                  <Button variant="secondary" onClick={() => setResetOpen(true)} className="!gap-2">
                    <Wand2 size={16} />
                    {t("pages.xrayCoreConfigProfiles.resetToDefaultTemplate")}
                  </Button>
                  <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty} className="!gap-2">
                    <Save size={16} />
                    {standalone
                      ? t("pages.xray.saveApply")
                      : t("pages.xray.save")}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        }
      />

      {multi && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
          <p className="leading-relaxed">{t("pages.xray.nodeModeInfo")}</p>
          <Link
            href={linkP("panel/xray-core-config-profiles")}
            className="mt-2 inline-block text-[var(--accent)] underline-offset-2 hover:underline"
          >
            {t("pages.xray.openCoreProfiles")}
          </Link>
        </div>
      )}

      {inboundTags.length > 0 && (
        <p className="text-xs text-[var(--fg-muted)]">
          <span className="font-medium text-[var(--fg-subtle)]">{t("pages.xray.Inbounds")}:</span>{" "}
          {inboundTags.join(", ")}
        </p>
      )}

      {xrayState ? (
        <p className="text-xs text-[var(--fg-muted)]" title={xrayState}>
          {xrayState}
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        <div className="min-w-0 space-y-3">
          {view === "geo" ? (
          <Surface>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--fg)]">
                {t("pages.xray.geoSectionTitle")}
              </h3>
            </div>
            <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--fg)]">
                    {t("pages.xray.geoAutoUpdateEnable", { defaultValue: "Auto-update active geofiles" })}
                  </p>
                  <p className="mt-1 text-xs text-[var(--fg-muted)]">
                    {t("pages.xray.geoAutoUpdateEnableDesc", {
                      defaultValue:
                        "Periodically re-download applied geofiles from their source URL and apply when content changed.",
                    })}
                  </p>
                </div>
                <Switch
                  checked={geofileAutoUpdateEnable}
                  disabled={geofileAutoUpdateSaving}
                  onChange={(on) => {
                    setGeofileAutoUpdateEnable(on);
                    void saveGeofileAutoUpdate({ geofileAutoUpdateEnable: on });
                  }}
                  ariaLabel={t("pages.xray.geoAutoUpdateEnable", { defaultValue: "Auto-update active geofiles" })}
                />
              </div>
              {geofileAutoUpdateEnable ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-[var(--fg-muted)]" htmlFor="geofile-auto-update-hours">
                    {t("pages.xray.geoAutoUpdateInterval", { defaultValue: "Check interval (hours)" })}
                  </label>
                  <Input
                    id="geofile-auto-update-hours"
                    type="number"
                    min={1}
                    max={168}
                    className="max-w-[120px]"
                    value={geofileAutoUpdateIntervalHours}
                    disabled={geofileAutoUpdateSaving}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setGeofileAutoUpdateIntervalHours(
                        Number.isFinite(v) ? Math.min(168, Math.max(1, v)) : 24,
                      );
                    }}
                    onBlur={() => {
                      void saveGeofileAutoUpdate({
                        geofileAutoUpdateIntervalHours: geofileAutoUpdateIntervalHours,
                      });
                    }}
                  />
                </div>
              ) : null}
            </div>
            <div className="mb-4 rounded-lg border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--fg)]">
                    {t("pages.xray.geoRetentionCount", { defaultValue: "Keep last N revisions" })}
                  </p>
                  <p className="mt-1 text-xs text-[var(--fg-muted)]">
                    {t("pages.xray.geoRetentionCountDesc", {
                      defaultValue:
                        "Older downloaded revisions of each geofile are pruned automatically past this count. The currently applied revision is never pruned.",
                    })}
                  </p>
                </div>
                <Input
                  id="geofile-retention-count"
                  type="number"
                  min={1}
                  max={50}
                  className="max-w-[100px]"
                  value={geofileRetentionCount}
                  disabled={geofileAutoUpdateSaving}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setGeofileRetentionCount(Number.isFinite(v) ? Math.min(50, Math.max(1, v)) : 5);
                  }}
                  onBlur={() => {
                    void saveGeofileAutoUpdate({ geofileRetentionCount });
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
                <p className="text-sm font-medium text-[var(--fg)]">geoip.dat</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => void rollbackGeofile("geoip.dat")} loading={geoBusy}>
                    <RotateCcw size={16} />
                    {t("pages.settings.geofileRollback")}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={geoipUrl}
                    onChange={(e) => setGeoipUrl(e.target.value)}
                    placeholder={t("pages.xray.geoUrlPlaceholder")}
                  />
                  <Button type="button" variant="secondary" onClick={() => void saveDownloadToStorage("geoip.dat", geoipUrl)} loading={geoBusy}>
                    <Download size={16} />
                    {t("download")}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => void uploadGeofileToStorage("geoip.dat")} loading={geoBusy}>
                    <Upload size={16} />
                    {t("pages.xray.geoStoreUploadDevice")}
                  </Button>
                </div>
                <div className="space-y-2 rounded-md border border-[var(--border)]/80 p-2">
                  <p className="text-xs text-[var(--fg-muted)]">
                    {t("pages.xray.geoStorageList")}
                  </p>
                  {(() => {
                    const active = (geoAssets["geoip.dat"] || []).find((x) => x.isActive);
                    if (!active) return null;
                    return (
                      <div className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-2 text-xs">
                        <p className="font-medium text-[var(--fg)]">
                          {t("pages.xray.geoActiveApplied")}: {active.displayName}
                        </p>
                        <p className="mt-1 text-[var(--fg-muted)] break-all">
                          {active.sourceUrl || t("pages.xray.geoSourceManual")}
                        </p>
                      </div>
                    );
                  })()}
                  {(geoAssets["geoip.dat"] || []).map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)]/70 px-2 py-1">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-[var(--fg)]">
                          {asset.displayName} {asset.isActive ? `(${t("pages.xray.geoActive")})` : ""}
                        </p>
                        <p className="text-[11px] text-[var(--fg-muted)]">
                          {Math.max(1, Math.round(asset.sizeBytes / 1024))} KB • {new Date(asset.createdAt * 1000).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" variant="secondary" onClick={() => void applyGeofileAsset(asset.id)} loading={geoBusy}>
                          {t("pages.xray.geoApply")}
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => void deleteGeofileAsset(asset.id)} loading={geoBusy}>
                          {t("delete")}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {geoAssetsLoading ? <Spinner size={18} /> : null}
                </div>
              </div>
              <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
                <p className="text-sm font-medium text-[var(--fg)]">geosite.dat</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => void rollbackGeofile("geosite.dat")} loading={geoBusy}>
                    <RotateCcw size={16} />
                    {t("pages.settings.geofileRollback")}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={geositeUrl}
                    onChange={(e) => setGeositeUrl(e.target.value)}
                    placeholder={t("pages.xray.geoUrlPlaceholder2")}
                  />
                  <Button type="button" variant="secondary" onClick={() => void saveDownloadToStorage("geosite.dat", geositeUrl)} loading={geoBusy}>
                    <Download size={16} />
                    {t("download")}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => void uploadGeofileToStorage("geosite.dat")} loading={geoBusy}>
                    <Upload size={16} />
                    {t("pages.xray.geoStoreUploadDevice")}
                  </Button>
                </div>
                <div className="space-y-2 rounded-md border border-[var(--border)]/80 p-2">
                  <p className="text-xs text-[var(--fg-muted)]">
                    {t("pages.xray.geoStorageList")}
                  </p>
                  {(() => {
                    const active = (geoAssets["geosite.dat"] || []).find((x) => x.isActive);
                    if (!active) return null;
                    return (
                      <div className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-2 text-xs">
                        <p className="font-medium text-[var(--fg)]">
                          {t("pages.xray.geoActiveApplied")}: {active.displayName}
                        </p>
                        <p className="mt-1 text-[var(--fg-muted)] break-all">
                          {active.sourceUrl || t("pages.xray.geoSourceManual")}
                        </p>
                      </div>
                    );
                  })()}
                  {(geoAssets["geosite.dat"] || []).map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)]/70 px-2 py-1">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-[var(--fg)]">
                          {asset.displayName} {asset.isActive ? `(${t("pages.xray.geoActive")})` : ""}
                        </p>
                        <p className="text-[11px] text-[var(--fg-muted)]">
                          {Math.max(1, Math.round(asset.sizeBytes / 1024))} KB • {new Date(asset.createdAt * 1000).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" variant="secondary" onClick={() => void applyGeofileAsset(asset.id)} loading={geoBusy}>
                          {t("pages.xray.geoApply")}
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => void deleteGeofileAsset(asset.id)} loading={geoBusy}>
                          {t("delete")}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {geoAssetsLoading ? <Spinner size={18} /> : null}
                </div>
              </div>
            </div>
          </Surface>
          ) : null}

          {view !== "geo" ? (
            <XrayConfigurator
              ref={editorRef}
              template={view === "runtime" ? runtime : template}
              onTemplateChange={setTemplate}
              syncKey={`${view}:${dataEpoch}`}
              readOnly={view === "runtime"}
              loading={view === "runtime" ? loadingRuntime : loading}
              onErrorChange={setHasSectionError}
            />
          ) : null}
        </div>
      </div>

      <TemplateGalleryModal
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        kind="xray_config"
        onImport={(_, content) => setPendingImport(JSON.stringify(content, null, 2))}
      />
      <ShareTemplateModal open={shareOpen} onClose={() => setShareOpen(false)} kind="xray_config" />
      <ConfirmDialog
        open={pendingImport !== null}
        title={t("pages.templates.importConfigTitle", { defaultValue: "Load shared config" })}
        description={t("pages.templates.importConfigDesc", {
          defaultValue:
            "The editor content will be replaced with the shared config. Nothing is saved until you press Save, and your current inbounds are not touched.",
        })}
        confirmLabel={t("pages.templates.import", { defaultValue: "Import" })}
        cancelLabel={t("cancel")}
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport !== null) {
            setTemplate(pendingImport);
            setDataEpoch((e) => e + 1);
            setViewMode("template");
            toast.success(t("pages.templates.importedUnsaved", { defaultValue: "Config loaded into the editor (not saved yet)" }));
          }
          setPendingImport(null);
        }}
      />
      <ConfirmDialog
        open={resetOpen}
        title={t("pages.xrayCoreConfigProfiles.resetToDefault")}
        description={t("pages.xray.resetServerTemplateConfirm")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void doReset()}
        danger
        loading={resetting}
      />
      <Modal
        open={geoResultOpen}
        onClose={() => setGeoResultOpen(false)}
        title={geoResultTitle || t("pages.settings.geofileResultTitle")}
        width={640}
      >
        <div className="space-y-3 text-sm">
          <p className="text-[var(--fg-muted)]">
            {geoResult?.localOk
              ? t("pages.settings.geofileLocalOk")
              : t("pages.settings.geofileLocalFail")}
          </p>
          <div>
            <p className="mb-1 font-medium text-[var(--fg)]">
              {t("pages.settings.geofileNodesSuccess")}:{" "}
              {geoResult?.nodeSuccess?.length ?? 0}
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-[var(--fg)]">
              {t("pages.settings.geofileNodesErrors")}:{" "}
              {geoResult?.nodeErrors?.length ?? 0}
            </p>
          </div>
        </div>
      </Modal>
    </PageScaffold>
  );
}
