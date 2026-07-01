"use client";

import { ChevronDown, ChevronRight, Copy, Link2, Plus, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertBanner,
  Button,
  Input,
  SelectNative,
  Switch,
  TabPanels,
  Tabs,
  useToast,
} from "@/components/ui";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import {
  defaultHappRoutingConfig,
  dnsHostsToText,
  getRoutingDeepLinkPrefix,
  happConfigToJsonText,
  importRoutingSnippet,
  listToLines,
  linesToList,
  parseDnsHostsText,
  parseHappConfigJsonText,
  routingConfigToDeepLink,
  type HappRoutingConfig,
} from "@/lib/happRouting";
import {
  defaultRouting,
  genBlockId,
  type ResponseHeaderDelivery,
  type RoutingProfile,
  type SharxSubpageConfigV2,
} from "@/lib/sharxSubpageConfig";

type Props = {
  config: SharxSubpageConfigV2;
  onChange: (next: SharxSubpageConfigV2) => void;
};

type ProfileSubTab = "routing" | "basic" | "dns" | "geo" | "json";

const textareaClass =
  "min-h-[120px] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

function loadInlineConfig(body: string): HappRoutingConfig {
  const parsed = parseHappConfigJsonText(body);
  if (parsed) return parsed;
  return defaultHappRoutingConfig();
}

function ProfileCard({
  profile,
  expanded,
  onToggleExpand,
  onPatch,
  onRemove,
}: {
  profile: RoutingProfile;
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (next: RoutingProfile) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [subTab, setSubTab] = useState<ProfileSubTab>("routing");
  const [importText, setImportText] = useState("");
  const [jsonText, setJsonText] = useState(() =>
    happConfigToJsonText(loadInlineConfig(profile.body), true),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (subTab !== "json" || profile.source !== "inline") return;
    setJsonText(happConfigToJsonText(loadInlineConfig(profile.body), true));
    setJsonError(null);
  }, [subTab, profile.body, profile.source]);

  const inlineCfg = useMemo(
    () => (profile.source === "inline" ? loadInlineConfig(profile.body) : null),
    [profile.body, profile.source],
  );

  const generatedDeepLink = useMemo(() => {
    if (profile.source !== "inline") return "";
    const cfg = loadInlineConfig(profile.body);
    const preset = profile.deepLinkPreset ?? "happ";
    const prefix = getRoutingDeepLinkPrefix(preset, profile.deepLinkCustomPrefix ?? "");
    return routingConfigToDeepLink(cfg, prefix);
  }, [profile.body, profile.source, profile.deepLinkPreset, profile.deepLinkCustomPrefix]);

  const syncBodyFromConfig = useCallback(
    (cfg: HappRoutingConfig) => {
      onPatch({ ...profile, body: happConfigToJsonText(cfg, true) });
    },
    [onPatch, profile],
  );

  const setInline = useCallback(
    (patch: Partial<HappRoutingConfig>) => {
      if (profile.source !== "inline") return;
      const base = loadInlineConfig(profile.body);
      syncBodyFromConfig({ ...base, ...patch });
    },
    [profile.source, profile.body, syncBodyFromConfig],
  );

  const applyImport = () => {
    const cfg = importRoutingSnippet(importText);
    if (!cfg) {
      toast.error(
        t("subBuilder.clientRouting.importInvalid", {
          defaultValue:
            "Could not decode. Paste a deep link (…://routing/add/…), Base64, or JSON.",
        }),
      );
      return;
    }
    onPatch({ ...profile, source: "inline", body: happConfigToJsonText(cfg, true) });
    setJsonText(happConfigToJsonText(cfg, true));
    setImportText("");
    toast.success(
      t("subBuilder.clientRouting.importOk", { defaultValue: "Routing imported." }),
    );
  };

  const copyLink = async () => {
    if (profile.source !== "inline" || !generatedDeepLink) return;
    try {
      await copyTextToClipboard(generatedDeepLink);
      toast.success(
        t("subBuilder.clientRouting.copiedLink", { defaultValue: "Deep link copied." }),
      );
    } catch {
      toast.error(t("subBuilder.clientRouting.copyFailed", { defaultValue: "Copy failed." }));
    }
  };

  const onJsonApply = () => {
    const cfg = parseHappConfigJsonText(jsonText);
    if (!cfg) {
      setJsonError(
        t("subBuilder.clientRouting.jsonInvalid", { defaultValue: "Invalid JSON." }),
      );
      return;
    }
    setJsonError(null);
    syncBodyFromConfig(cfg);
    toast.success(
      t("subBuilder.clientRouting.jsonApplied", { defaultValue: "JSON applied to profile." }),
    );
  };

  const subTabs = useMemo(
    () => [
      {
        id: "routing" as ProfileSubTab,
        label: t("subBuilder.clientRouting.subtab.routing", { defaultValue: "Routing" }),
      },
      {
        id: "basic" as ProfileSubTab,
        label: t("subBuilder.clientRouting.subtab.basic", { defaultValue: "Basic" }),
      },
      {
        id: "dns" as ProfileSubTab,
        label: t("subBuilder.clientRouting.subtab.dns", { defaultValue: "DNS" }),
      },
      {
        id: "geo" as ProfileSubTab,
        label: t("subBuilder.clientRouting.subtab.geo", { defaultValue: "Geo" }),
      },
      {
        id: "json" as ProfileSubTab,
        label: t("subBuilder.clientRouting.subtab.json", { defaultValue: "JSON" }),
      },
    ],
    [t],
  );

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-[var(--fg)]"
        >
          {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <span className="truncate">
            {profile.name?.trim() ||
              t("subBuilder.clientRouting.unnamed", { defaultValue: "Untitled profile" })}
          </span>
          <span className="truncate font-mono text-[10px] text-[var(--fg-subtle)]">{profile.id}</span>
        </button>
        <Button type="button" variant="ghost" className="!px-2" onClick={onRemove} aria-label={t("subBuilder.clientRouting.removeProfileAria")}>
          <Trash2 className="size-4 text-[var(--danger,#f87171)]" />
        </Button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-4 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                {t("subBuilder.clientRouting.displayName", { defaultValue: "Display name" })}
              </span>
              <Input
                value={profile.name}
                onChange={(e) => onPatch({ ...profile, name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                {t("subBuilder.clientRouting.source", { defaultValue: "Source" })}
              </span>
              <SelectNative
                value={profile.source}
                onChange={(e) =>
                  onPatch({
                    ...profile,
                    source: e.target.value as "inline" | "url",
                  })
                }
              >
                <option value="inline">
                  {t("subBuilder.clientRouting.sourceInline", { defaultValue: "Inline (constructor)" })}
                </option>
                <option value="url">
                  {t("subBuilder.clientRouting.sourceUrl", { defaultValue: "External URL" })}
                </option>
              </SelectNative>
            </label>
          </div>

          {profile.source === "url" ? (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                {t("subBuilder.clientRouting.profileUrl", { defaultValue: "Routing profile URL" })}
              </span>
              <Input value={profile.url} onChange={(e) => onPatch({ ...profile, url: e.target.value })} />
            </label>
          ) : null}

          {profile.source === "inline" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                    {t("subBuilder.clientRouting.deepLinkScheme", { defaultValue: "Deep link scheme" })}
                  </span>
                  <SelectNative
                    value={profile.deepLinkPreset ?? "happ"}
                    onChange={(e) =>
                      onPatch({
                        ...profile,
                        deepLinkPreset: e.target.value as RoutingProfile["deepLinkPreset"],
                      })
                    }
                  >
                    <option value="happ">
                      {t("subBuilder.clientRouting.preset.happ", { defaultValue: "Happ (happ://…)" })}
                    </option>
                    <option value="happ_onadd">
                      {t("subBuilder.clientRouting.preset.happOnAdd", { defaultValue: "Happ OnAdd (happ://routing/onadd/…)" })}
                    </option>
                    <option value="incy">
                      {t("subBuilder.clientRouting.preset.incy", { defaultValue: "Incy (incy://…)" })}
                    </option>
                    <option value="sharx">
                      {t("subBuilder.clientRouting.preset.sharx", { defaultValue: "SharX (sharx://…)" })}
                    </option>
                    <option value="custom">
                      {t("subBuilder.clientRouting.preset.custom", { defaultValue: "Custom prefix" })}
                    </option>
                  </SelectNative>
                  <p className="mt-1 text-[10px] text-[var(--fg-subtle)]">
                    {t("subBuilder.clientRouting.deepLinkSchemeHint", {
                      defaultValue:
                        "Used when copying the import link. JSON payload is the same; only the URL scheme changes.",
                    })}
                  </p>
                </label>
                {(profile.deepLinkPreset ?? "happ") === "custom" ? (
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                      {t("subBuilder.clientRouting.customPrefix", {
                        defaultValue: "Custom URL prefix (before Base64)",
                      })}
                    </span>
                    <Input
                      value={profile.deepLinkCustomPrefix ?? ""}
                      onChange={(e) => onPatch({ ...profile, deepLinkCustomPrefix: e.target.value })}
                      placeholder={t("subBuilder.clientRouting.customPrefixPlaceholder")}
                    />
                    <p className="mt-1 text-[10px] text-[var(--fg-subtle)]">
                      {t("subBuilder.clientRouting.customPrefixHint", {
                        defaultValue: "Include the path up to and including routing/add/ — the panel appends Base64 JSON.",
                      })}
                    </p>
                  </label>
                ) : null}
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
                  {t("subBuilder.clientRouting.generatedDeepLink", {
                    defaultValue: "Generated deep link",
                  })}
                </span>
                <textarea
                  readOnly
                  className={textareaClass + " min-h-[88px] cursor-text font-mono text-[11px] leading-snug"}
                  value={generatedDeepLink}
                  onFocus={(e) => e.target.select()}
                  spellCheck={false}
                  aria-label={t("subBuilder.clientRouting.generatedDeepLink", {
                    defaultValue: "Generated deep link",
                  })}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" className="!gap-2" onClick={() => void copyLink()}>
                    <Copy className="size-4" />
                    {t("subBuilder.clientRouting.copyDeepLink", { defaultValue: "Copy deep link" })}
                  </Button>
                </div>
              </label>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                  {t("subBuilder.clientRouting.importBlock", { defaultValue: "Import" })}
                </div>
                <p className="mb-2 text-[11px] text-[var(--fg-subtle)]">
                  {t("subBuilder.clientRouting.importHint", {
                    defaultValue:
                      "Paste a deep link (happ://, incy://, sharx://, …) with /routing/add/ or /routing/onadd/, or Base64 / JSON.",
                  })}
                </p>
                <textarea
                  className={textareaClass + " min-h-[72px]"}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={t("subBuilder.clientRouting.importPastePlaceholder")}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" className="!gap-2" onClick={applyImport}>
                    <Upload className="size-4" />
                    {t("subBuilder.clientRouting.decodeImport", { defaultValue: "Decode & import" })}
                  </Button>
                </div>
              </div>

              {inlineCfg ? (
                <>
                  <Tabs<ProfileSubTab> tabs={subTabs} active={subTab} onChange={setSubTab} layoutId={`hr-sub-${profile.id}`} />
                  <TabPanels value={subTab}>
                    {subTab === "routing" ? (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <RoutingColumn
                          title={t("subBuilder.clientRouting.directTitle", { defaultValue: "DIRECT" })}
                          subtitle={t("subBuilder.clientRouting.directSub", {
                            defaultValue: "Bypass proxy for these destinations",
                          })}
                          sites={listToLines(inlineCfg.DirectSites)}
                          ips={listToLines(inlineCfg.DirectIp)}
                          onSites={(text) => setInline({ DirectSites: linesToList(text) })}
                          onIps={(text) => setInline({ DirectIp: linesToList(text) })}
                          tone="success"
                        />
                        <RoutingColumn
                          title={t("subBuilder.clientRouting.proxyTitle", { defaultValue: "PROXY" })}
                          subtitle={t("subBuilder.clientRouting.proxySub", {
                            defaultValue: "Force proxy for these destinations",
                          })}
                          sites={listToLines(inlineCfg.ProxySites)}
                          ips={listToLines(inlineCfg.ProxyIp)}
                          onSites={(text) => setInline({ ProxySites: linesToList(text) })}
                          onIps={(text) => setInline({ ProxyIp: linesToList(text) })}
                          tone="accent"
                        />
                        <RoutingColumn
                          title={t("subBuilder.clientRouting.blockTitle", { defaultValue: "BLOCK" })}
                          subtitle={t("subBuilder.clientRouting.blockSub", {
                            defaultValue: "Block these destinations",
                          })}
                          sites={listToLines(inlineCfg.BlockSites)}
                          ips={listToLines(inlineCfg.BlockIp)}
                          onSites={(text) => setInline({ BlockSites: linesToList(text) })}
                          onIps={(text) => setInline({ BlockIp: linesToList(text) })}
                          tone="danger"
                        />
                      </div>
                    ) : subTab === "basic" ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label={t("subBuilder.clientRouting.routingProfileName")}>
                          <Input value={inlineCfg.Name} onChange={(e) => setInline({ Name: e.target.value })} />
                        </Field>
                        <Field
                          label={t("subBuilder.clientRouting.globalProxy", { defaultValue: "Global proxy" })}
                        >
                          <Switch
                            checked={inlineCfg.GlobalProxy === "true"}
                            onChange={(v) => setInline({ GlobalProxy: v ? "true" : "false" })}
                            ariaLabel={t("subBuilder.clientRouting.globalProxy", { defaultValue: "Global proxy" })}
                          />
                        </Field>
                        <Field label={t("subBuilder.clientRouting.routeOrder", { defaultValue: "Route order" })}>
                          <SelectNative
                            value={inlineCfg.RouteOrder}
                            onChange={(e) => setInline({ RouteOrder: e.target.value })}
                          >
                            <option value="block-proxy-direct">block-proxy-direct</option>
                            <option value="direct-proxy-block">direct-proxy-block</option>
                            <option value="proxy-direct-block">proxy-direct-block</option>
                            <option value="block-direct-proxy">block-direct-proxy</option>
                            <option value="direct-block-proxy">direct-block-proxy</option>
                            <option value="proxy-block-direct">proxy-block-direct</option>
                          </SelectNative>
                        </Field>
                        <Field
                          label={t("subBuilder.clientRouting.domainStrategy", { defaultValue: "Domain strategy" })}
                        >
                          <Input
                            value={inlineCfg.DomainStrategy}
                            onChange={(e) => setInline({ DomainStrategy: e.target.value })}
                          />
                        </Field>
                        <Field label={t("subBuilder.clientRouting.fakeDns", { defaultValue: "Fake DNS" })}>
                          <Switch
                            checked={inlineCfg.FakeDNS === "true"}
                            onChange={(v) => setInline({ FakeDNS: v ? "true" : "false" })}
                            ariaLabel="Fake DNS"
                          />
                        </Field>
                        <Field
                          label={t("subBuilder.clientRouting.useChunkFiles", { defaultValue: "Use chunk files" })}
                        >
                          <Switch
                            checked={inlineCfg.UseChunkFiles === "true"}
                            onChange={(v) => setInline({ UseChunkFiles: v ? "true" : "false" })}
                            ariaLabel="Use chunk files"
                          />
                        </Field>
                      </div>
                    ) : subTab === "dns" ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label={t("subBuilder.clientRouting.remoteDnsType", { defaultValue: "Remote DNS type" })}>
                          <Input
                            value={inlineCfg.RemoteDNSType}
                            onChange={(e) => setInline({ RemoteDNSType: e.target.value })}
                          />
                        </Field>
                        <Field
                          label={t("subBuilder.clientRouting.domesticDnsType", { defaultValue: "Domestic DNS type" })}
                        >
                          <Input
                            value={inlineCfg.DomesticDNSType}
                            onChange={(e) => setInline({ DomesticDNSType: e.target.value })}
                          />
                        </Field>
                        <Field
                          label={t("subBuilder.clientRouting.remoteDnsDomain", { defaultValue: "Remote DNS domain" })}
                        >
                          <Input
                            value={inlineCfg.RemoteDNSDomain}
                            onChange={(e) => setInline({ RemoteDNSDomain: e.target.value })}
                          />
                        </Field>
                        <Field
                          label={t("subBuilder.clientRouting.domesticDnsDomain", {
                            defaultValue: "Domestic DNS domain",
                          })}
                        >
                          <Input
                            value={inlineCfg.DomesticDNSDomain}
                            onChange={(e) => setInline({ DomesticDNSDomain: e.target.value })}
                          />
                        </Field>
                        <Field label={t("subBuilder.clientRouting.remoteDnsIp", { defaultValue: "Remote DNS IP" })}>
                          <Input
                            value={inlineCfg.RemoteDNSIP}
                            onChange={(e) => setInline({ RemoteDNSIP: e.target.value })}
                          />
                        </Field>
                        <Field
                          label={t("subBuilder.clientRouting.domesticDnsIp", { defaultValue: "Domestic DNS IP" })}
                        >
                          <Input
                            value={inlineCfg.DomesticDNSIP}
                            onChange={(e) => setInline({ DomesticDNSIP: e.target.value })}
                          />
                        </Field>
                        <div className="sm:col-span-2">
                          <Field
                            label={t("subBuilder.clientRouting.dnsHosts", { defaultValue: "DNS hosts (host → IP)" })}
                            hint={t("subBuilder.clientRouting.dnsHostsHint", {
                              defaultValue: "One mapping per line: hostname tab IP (or hostname space IP).",
                            })}
                          >
                            <textarea
                              className={textareaClass}
                              value={dnsHostsToText(inlineCfg.DnsHosts)}
                              onChange={(e) => setInline({ DnsHosts: parseDnsHostsText(e.target.value) })}
                            />
                          </Field>
                        </div>
                      </div>
                    ) : subTab === "geo" ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label={t("subBuilder.clientRouting.geoipUrl", { defaultValue: "GeoIP URL" })}>
                          <Input
                            value={inlineCfg.Geoipurl}
                            onChange={(e) => setInline({ Geoipurl: e.target.value })}
                          />
                        </Field>
                        <Field label={t("subBuilder.clientRouting.geositeUrl", { defaultValue: "Geosite URL" })}>
                          <Input
                            value={inlineCfg.Geositeurl}
                            onChange={(e) => setInline({ Geositeurl: e.target.value })}
                          />
                        </Field>
                        <Field
                          label={t("subBuilder.clientRouting.lastUpdated", { defaultValue: "Last updated (optional)" })}
                        >
                          <Input
                            value={inlineCfg.LastUpdated}
                            onChange={(e) => setInline({ LastUpdated: e.target.value })}
                          />
                        </Field>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <textarea
                          className={textareaClass + " min-h-[220px] font-mono text-[12px]"}
                          value={jsonText}
                          onChange={(e) => {
                            setJsonText(e.target.value);
                            setJsonError(null);
                          }}
                        />
                        {jsonError ? <AlertBanner type="error" title={jsonError} /> : null}
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="secondary" onClick={onJsonApply}>
                            {t("subBuilder.clientRouting.applyJson", { defaultValue: "Apply JSON" })}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              const cfg = loadInlineConfig(profile.body);
                              setJsonText(happConfigToJsonText(cfg, true));
                              setJsonError(null);
                            }}
                          >
                            {t("subBuilder.clientRouting.resetJson", { defaultValue: "Reload from profile" })}
                          </Button>
                        </div>
                      </div>
                    )}
                  </TabPanels>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
        {label}
      </span>
      {hint ? <p className="mb-1 text-[10px] text-[var(--fg-subtle)]">{hint}</p> : null}
      {children}
    </label>
  );
}

function RoutingListTextarea({
  value,
  onCommit,
  placeholder,
  className = "",
}: {
  value: string;
  onCommit: (text: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <textarea
      className={textareaClass + " min-h-[100px] " + className}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      placeholder={placeholder}
    />
  );
}

function RoutingColumn({
  title,
  subtitle,
  sites,
  ips,
  onSites,
  onIps,
  tone,
}: {
  title: string;
  subtitle: string;
  sites: string;
  ips: string;
  onSites: (text: string) => void;
  onIps: (text: string) => void;
  tone: "success" | "accent" | "danger";
}) {
  const border =
    tone === "success"
      ? "border-emerald-500/35"
      : tone === "danger"
        ? "border-red-500/35"
        : "border-cyan-500/35";
  const label =
    tone === "success" ? "text-emerald-400/95" : tone === "danger" ? "text-red-300/95" : "text-cyan-300/95";

  const { t } = useTranslation();
  return (
    <div className={`rounded-xl border ${border} bg-[var(--surface)] p-3`}>
      <div className={`mb-1 text-xs font-bold uppercase tracking-wider ${label}`}>{title}</div>
      <p className="mb-3 text-[10px] leading-relaxed text-[var(--fg-subtle)]">{subtitle}</p>
      <div className="mb-2">
        <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--fg-muted)]">
          {t("subBuilder.clientRouting.sites", { defaultValue: "Sites" })}
        </div>
        <RoutingListTextarea
          value={sites}
          onCommit={(text) => onSites(text)}
          placeholder="geosite:category-ads-all"
        />
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase text-[var(--fg-muted)]">
          {t("subBuilder.clientRouting.ips", { defaultValue: "IPs" })}
        </div>
        <RoutingListTextarea
          value={ips}
          onCommit={(text) => onIps(text)}
          placeholder="geoip:private"
        />
      </div>
    </div>
  );
}

export function RoutingProfilesEditor({ config, onChange }: Props) {
  const { t } = useTranslation();
  const routing = config.routing ?? defaultRouting();
  const profiles: RoutingProfile[] = routing.profiles;

  const setRouting = (patch: Partial<typeof routing>) =>
    onChange({ ...config, routing: { ...routing, ...patch } });

  const setProfiles = (next: RoutingProfile[]) => setRouting({ profiles: next });

  const [expandedId, setExpandedId] = useState<string | null>(() => profiles[0]?.id ?? null);

  const addProfile = () => {
    const p: RoutingProfile = {
      id: genBlockId(),
      name: "",
      source: "inline",
      body: happConfigToJsonText(defaultHappRoutingConfig(), true),
      url: "",
      deepLinkPreset: "happ",
      deepLinkCustomPrefix: "",
    };
    setProfiles([...profiles, p]);
    setExpandedId(p.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-strong)] text-[var(--accent)]">
            <Link2 className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--fg)]">
              {t("subBuilder.clientRouting.title", { defaultValue: "Client routing profiles" })}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--fg-subtle)]">
              {t("subBuilder.clientRouting.intro", {
                defaultValue:
                  "Edit routing JSON once. Copy deep link builds the client URL as <prefix> + Base64(UTF-8 JSON) — the standard …://routing/add/{payload} form (choose scheme below). Stored in routing.profiles.",
              })}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
                {t("subBuilder.clientRouting.delivery", { defaultValue: "Routing delivery" })}
              </span>
              <SelectNative
                value={routing.delivery ?? "header"}
                onChange={(e) =>
                  setRouting({ delivery: e.target.value as ResponseHeaderDelivery })
                }
                aria-label={t("subBuilder.clientRouting.delivery", {
                  defaultValue: "Routing delivery",
                })}
              >
                {(["header", "body", "both", "none"] as const).map((opt) => (
                  <option key={opt} value={opt}>
                    {t(`subBuilder.responseRules.extraHeaderDelivery.${opt}`, {
                      defaultValue:
                        opt === "header"
                          ? "HTTP header"
                          : opt === "body"
                            ? "Body comment"
                            : opt === "both"
                              ? "Header + body"
                              : "Disabled",
                    })}
                  </option>
                ))}
              </SelectNative>
              <span className="text-[11px] text-[var(--fg-subtle)]">
                {t("subBuilder.clientRouting.deliveryHint", {
                  defaultValue:
                    "How Routing / Routing-Enable reach Happ clients. Body adds #routing-enable: 1; the deeplink stays in the HTTP header.",
                })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {profiles.length === 0 ? (
        <AlertBanner
          type="info"
          title={t("subBuilder.clientRouting.emptyTitle", { defaultValue: "No routing profiles yet" })}
          description={t("subBuilder.clientRouting.emptyDesc", {
            defaultValue:
              "Add a profile to author DIRECT / PROXY / BLOCK lists and copy deep links (happ://, incy://, sharx://, …) for clients.",
          })}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              expanded={expandedId === p.id}
              onToggleExpand={() => setExpandedId((id) => (id === p.id ? null : p.id))}
              onPatch={(next) => setProfiles(profiles.map((x) => (x.id === p.id ? next : x)))}
              onRemove={() => {
                setProfiles(profiles.filter((x) => x.id !== p.id));
                setExpandedId((id) => (id === p.id ? null : id));
              }}
            />
          ))}
        </div>
      )}

      <Button type="button" variant="secondary" className="!w-fit !gap-2" onClick={addProfile}>
        <Plus className="size-4" />
        {t("subBuilder.clientRouting.addProfile", { defaultValue: "Add routing profile" })}
      </Button>
    </div>
  );
}
