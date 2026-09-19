"use client";

import {
  AlertTriangle,
  Braces,
  ClipboardPaste,
  Copy,
  FileUp,
  LayoutList,
  Network,
  Settings2,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useTranslation } from "react-i18next";
import { Surface } from "@/components/panel";
import { Button, ConfirmDialog, MonacoJsonEditor, Segmented, Spinner, useToast } from "@/components/ui";
import { DnsBuilder } from "@/components/xray/DnsBuilder";
import { OutboundsBuilder } from "@/components/xray/OutboundsBuilder";
import { RoutingBuilder } from "@/components/xray/RoutingBuilder";
import { TrafficFlow } from "@/components/xray/flow/TrafficFlow";
import { SimpleCoreForm } from "@/components/xray/SimpleCoreForm";
import { sectionButtonLabel } from "@/components/xray/sectionButtonLabel";
import { useRoutingTags } from "@/components/xray/routing/useRoutingTags";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { lintXrayConfig, type ConfigIssue } from "@/lib/xrayConfigLint";
import {
  XRAY_SECTION_BY_KEY,
  isRecord,
  missingSectionKeys,
  orderedSectionKeys,
} from "@/lib/xrayConfigSections";
import { getXrayMonacoEntryForSection, toMonacoEntry } from "@/lib/xrayMonacoJsonSchemas";
import { patchSimpleCore, type XraySimpleCore } from "@/lib/xraySimpleCore";
import { analyzeRoutingSection } from "@/lib/xrayRoutingForm";
import { extractSectionJson, mergeSectionIntoTemplate } from "@/lib/xrayTemplateSlice";
import { AddSectionMenu } from "./AddSectionMenu";
import { SectionCarousel, type CarouselItem } from "./SectionCarousel";
import { ApiEditor } from "./editors/ApiEditor";
import { FakeDnsEditor } from "./editors/FakeDnsEditor";
import { InboundsEditor } from "./editors/InboundsEditor";
import { LogEditor } from "./editors/LogEditor";
import { MetricsEditor } from "./editors/MetricsEditor";
import { BurstObservatoryEditor, ObservatoryEditor } from "./editors/ObservatoryEditor";
import { PolicyEditor } from "./editors/PolicyEditor";
import { ReverseEditor } from "./editors/ReverseEditor";
import { StatsEditor } from "./editors/StatsEditor";
import { makeTr, type SectionEditorProps } from "./fields";
import { sectionSummary } from "./summary";

export type XrayConfiguratorHandle = {
  /** Merged valid JSON or null if save must be blocked. */
  getJsonForSave: () => string | null;
};

type Props = {
  template: string;
  onTemplateChange: (next: string) => void;
  /** Increment when loading new data from the server so the view resets. */
  syncKey: string | number;
  readOnly?: boolean;
  loading?: boolean;
  /** Called whenever the open section holds JSON that cannot be applied. */
  onErrorChange?: (hasError: boolean) => void;
  /**
   * Fill the parent's height (parent must have a definite height): the section carousel and the
   * section header stay put and only the section body scrolls, so the container never resizes
   * when you switch sections. Used inside dialogs.
   */
  fillHeight?: boolean;
};

const GENERAL = "general";
const FULL = "full";

const SIMPLE_EDITORS: Record<string, ComponentType<SectionEditorProps>> = {
  log: LogEditor,
  api: ApiEditor,
  stats: StatsEditor,
  policy: PolicyEditor,
  fakedns: FakeDnsEditor,
  inbounds: InboundsEditor,
  reverse: ReverseEditor,
  observatory: ObservatoryEditor,
  burstObservatory: BurstObservatoryEditor,
  metrics: MetricsEditor,
};

const SECTION_DESC: Record<string, string> = {
  general: "Common options in one place — log level, statistics and the API — without touching JSON.",
  log: "Where the core writes logs and how verbose they are.",
  api: "The gRPC API the panel uses to read statistics and manage users.",
  stats: "Traffic statistics collection.",
  policy: "Timeouts, buffers and which traffic counters are collected, per user level and system-wide.",
  dns: "How the core resolves domain names: servers, static hosts and query strategy.",
  routing: "Decides which outbound (or balancer) handles each connection. Rules are checked top to bottom.",
  fakedns: "Fake address pools that let the core route by domain without a real lookup.",
  inbounds: "Inbounds defined in the template itself (usually the API inbound).",
  outbounds: "Where traffic can be sent: direct, blocked, or through another server.",
  transport: "Legacy global transport settings. Configure transports per inbound or outbound instead.",
  reverse: "Reverse proxy bridges and portals.",
  observatory: "Latency probing of outbounds, used by the leastPing balancer.",
  burstObservatory: "Burst latency sampling of outbounds, used by the leastLoad balancer.",
  metrics: "Built-in metrics endpoint.",
  full: "The entire Xray configuration as JSON. Paste a complete config here to replace everything.",
};

function worstIssue(issues: ConfigIssue[], section: string): "error" | "warning" | undefined {
  const own = issues.filter((i) => i.section === section);
  if (own.some((i) => i.level === "error")) return "error";
  if (own.length > 0) return "warning";
  return undefined;
}

export const XrayConfigurator = forwardRef<XrayConfiguratorHandle, Props>(function XrayConfigurator(
  { template, onTemplateChange, syncKey, readOnly = false, loading = false, onErrorChange, fillHeight = false },
  ref,
) {
  const { t } = useTranslation();
  const toast = useToast();
  const tr = useMemo(() => makeTr(t), [t]);

  const [navId, setNavId] = useState<string>(GENERAL);
  const [viewModes, setViewModes] = useState<Record<string, "visual" | "flow" | "json">>({});
  const [sectionDraft, setSectionDraft] = useState("{}");
  const [dataEpoch, setDataEpoch] = useState(0);
  const [sectionParseError, setSectionParseError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastEpoch = useRef(-1);

  const invalidMsg = t("pages.xrayCoreConfigProfiles.invalidJson");

  const root = useMemo<Record<string, unknown> | null>(() => {
    try {
      const p = JSON.parse(template) as unknown;
      return isRecord(p) ? p : null;
    } catch {
      return null;
    }
  }, [template]);
  const templateOk = root !== null;

  const sectionKey = navId === GENERAL ? FULL : navId;

  useEffect(() => {
    setNavId(GENERAL);
    setSectionParseError(null);
    setDataEpoch((e) => e + 1);
  }, [syncKey]);

  useEffect(() => {
    if (loading) return;
    if (sectionKey === FULL) {
      setSectionParseError(null);
      return;
    }
    if (!root) {
      setSectionDraft("{}");
      setSectionParseError(invalidMsg);
      return;
    }
    const forced = lastEpoch.current !== dataEpoch;
    lastEpoch.current = dataEpoch;
    setSectionDraft((prev) => {
      if (!forced) {
        try {
          // The draft already represents this section (the user is typing) — keep their formatting.
          if (JSON.stringify(JSON.parse(prev)) === JSON.stringify(root[sectionKey] ?? {})) return prev;
        } catch {
          /* fall through */
        }
      }
      return extractSectionJson(root, sectionKey);
    });
    setSectionParseError(null);
  }, [sectionKey, dataEpoch, loading, root, invalidMsg]);

  useEffect(() => {
    if (loading || templateOk || navId === FULL) return;
    setNavId(FULL);
  }, [loading, templateOk, navId]);

  useEffect(() => {
    onErrorChange?.(sectionKey !== FULL && sectionParseError !== null);
  }, [sectionKey, sectionParseError, onErrorChange]);

  const routingTags = useRoutingTags(template, navId === GENERAL || navId === "routing" || navId === "observatory" || navId === "burstObservatory" || navId === "outbounds");
  const issues = useMemo(() => lintXrayConfig(root), [root]);
  const sectionKeys = useMemo(() => orderedSectionKeys(root), [root]);
  const missingKeys = useMemo(() => missingSectionKeys(root), [root]);

  const navigate = useCallback(
    (next: string) => {
      if (next === navId) return;
      if (next !== GENERAL && next !== FULL && !templateOk) {
        toast.error(invalidMsg);
        return;
      }
      if (navId !== GENERAL && navId !== FULL && sectionParseError) {
        toast.error(invalidMsg);
        return;
      }
      setNavId(next);
      if (next === GENERAL) setSectionParseError(null);
    },
    [navId, templateOk, sectionParseError, toast, invalidMsg],
  );

  const handleCodeChange = useCallback(
    (v: string | undefined) => {
      const val = v ?? "";
      if (readOnly || navId === GENERAL) return;
      if (sectionKey === FULL) {
        onTemplateChange(val);
        return;
      }
      setSectionDraft(val);
      try {
        onTemplateChange(mergeSectionIntoTemplate(template, sectionKey, val));
        setSectionParseError(null);
      } catch {
        setSectionParseError(invalidMsg);
      }
    },
    [readOnly, navId, sectionKey, template, onTemplateChange, invalidMsg],
  );

  const applySection = useCallback(
    (sectionJson: string) => {
      setSectionDraft(sectionJson);
      try {
        onTemplateChange(mergeSectionIntoTemplate(template, String(sectionKey), sectionJson));
        setSectionParseError(null);
      } catch {
        setSectionParseError(invalidMsg);
      }
    },
    [sectionKey, template, onTemplateChange, invalidMsg],
  );

  const patchSimpleCoreSafe = useCallback(
    (p: Partial<XraySimpleCore>) => {
      if (!templateOk) {
        toast.error(invalidMsg);
        return;
      }
      try {
        onTemplateChange(patchSimpleCore(template, p));
        setSectionParseError(null);
      } catch {
        toast.error(invalidMsg);
      }
    },
    [template, templateOk, onTemplateChange, toast, invalidMsg],
  );

  const codeValue = sectionKey === FULL ? template : sectionDraft;

  useImperativeHandle(
    ref,
    () => ({
      getJsonForSave: () => {
        if (sectionKey !== FULL && sectionParseError) return null;
        let toSave = template;
        if (sectionKey !== FULL) {
          try {
            toSave = mergeSectionIntoTemplate(template, sectionKey, sectionDraft);
          } catch {
            return null;
          }
        }
        try {
          JSON.parse(toSave);
          return toSave;
        } catch {
          return null;
        }
      },
    }),
    [template, sectionKey, sectionDraft, sectionParseError],
  );

  // ---- carousel ---------------------------------------------------------------------------
  const groupLabel = useCallback(
    (key: string) => {
      const g = XRAY_SECTION_BY_KEY[key]?.group;
      return g ? t(`pages.xray.navGroup.${g}`) : t("pages.xray.navGroup.misc", { defaultValue: "Other" });
    },
    [t],
  );

  const carouselItems = useMemo<CarouselItem[]>(() => {
    const items: CarouselItem[] = [
      {
        id: GENERAL,
        label: t("pages.xray.navGeneral", { defaultValue: "General" }),
        summary: tr("generalSummary", "quick options"),
        icon: Settings2,
        group: tr("groupStart", "Start"),
        issue: issues.length > 0 ? (issues.some((i) => i.level === "error") ? "error" : "warning") : undefined,
      },
    ];
    for (const key of sectionKeys) {
      const def = XRAY_SECTION_BY_KEY[key];
      items.push({
        id: key,
        label: sectionButtonLabel(t, key),
        summary: sectionSummary(key, root?.[key], tr),
        icon: def?.icon ?? Braces,
        group: groupLabel(key),
        issue: worstIssue(issues, key),
      });
    }
    items.push({
      id: FULL,
      label: t("pages.xray.navFullTemplate", { defaultValue: "Entire template (JSON)" }),
      summary: tr("fullSummary", "paste / import"),
      icon: Braces,
      group: tr("groupRaw", "Raw"),
      trailing: true,
    });
    return items;
  }, [t, tr, sectionKeys, root, issues, groupLabel]);

  // ---- section frame ----------------------------------------------------------------------
  const isSection = navId !== GENERAL && navId !== FULL;
  const def = XRAY_SECTION_BY_KEY[navId];
  const hasVisual = isSection && !readOnly && templateOk && (def?.visual ?? false);
  const routingAdvanced = navId === "routing" && templateOk && analyzeRoutingSection(sectionDraft) === "advanced";
  const wantJson = viewModes[navId] === "json" || (isSection && !hasVisual) || routingAdvanced;
  const wantFlow = navId === "routing" && viewModes[navId] === "flow" && hasVisual && !routingAdvanced;
  const showVisual = hasVisual && !wantJson && !wantFlow;

  const title =
    navId === GENERAL
      ? t("pages.xray.navGeneral", { defaultValue: "General" })
      : navId === FULL
        ? t("pages.xray.navFullTemplate", { defaultValue: "Entire template (JSON)" })
        : sectionButtonLabel(t, navId);
  const description = tr(`desc.${navId}`, SECTION_DESC[navId] ?? "");

  const sectionIssues = navId === GENERAL || navId === FULL ? issues : issues.filter((i) => i.section === navId);

  const monacoEntry = useMemo(() => getXrayMonacoEntryForSection(String(sectionKey), t), [sectionKey, t]);
  const schemaBundle = useMemo(() => [toMonacoEntry(monacoEntry)], [monacoEntry]);

  const issueText = (i: ConfigIssue) => {
    const fallback: Record<string, string> = {
      duplicateOutbound: "Outbound tag “{{tag}}” is used more than once.",
      duplicateInbound: "Inbound tag “{{tag}}” is used more than once.",
      unknownOutbound: "A rule sends traffic to “{{tag}}”, but no outbound has that tag.",
      unknownBalancer: "A rule points at balancer “{{tag}}”, which does not exist.",
      ruleWithoutTarget: "A rule has neither an outbound nor a balancer — Xray will reject it.",
      balancerSelectsNothing: "Balancer “{{tag}}” selects no outbounds.",
      unknownFallback: "Balancer “{{tag}}” falls back to “{{fallback}}”, which is not an outbound.",
      balancerNeedsObservatory: "Balancer “{{tag}}” uses a latency strategy but there is no Observatory or Burst Observatory section.",
      observatorySelectsNothing: "The selector matches no outbound.",
    };
    return tr(`lint.${i.code}`, fallback[i.code] ?? i.code, i.vars);
  };

  const formatJson = () => {
    try {
      handleCodeChange(JSON.stringify(JSON.parse(codeValue), null, 2));
    } catch {
      toast.error(invalidMsg);
    }
  };
  const copyJson = async () => {
    try {
      await copyTextToClipboard(codeValue);
      toast.success(tr("copied", "Copied"));
    } catch {
      toast.error(tr("copyFailed", "Could not copy"));
    }
  };
  const pasteJson = async () => {
    try {
      const text = await navigator.clipboard.readText();
      JSON.parse(text);
      handleCodeChange(text);
      toast.success(tr("pasted", "Pasted from clipboard"));
    } catch {
      toast.error(tr("pasteFailed", "Clipboard does not contain valid JSON"));
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      JSON.parse(text);
      handleCodeChange(text);
      toast.success(tr("imported", "File imported"));
    } catch {
      toast.error(tr("pasteFailed", "Clipboard does not contain valid JSON"));
    }
  };

  const addSection = (key: string) => {
    if (!root) return;
    const d = XRAY_SECTION_BY_KEY[key]?.defaultValue ?? {};
    onTemplateChange(JSON.stringify({ ...root, [key]: d }, null, 2));
    setNavId(key);
    setDataEpoch((e) => e + 1);
  };

  const removeSection = () => {
    if (!root || !isSection) return;
    const next = { ...root };
    delete next[navId];
    onTemplateChange(JSON.stringify(next, null, 2));
    setRemoveOpen(false);
    setNavId(GENERAL);
    setSectionParseError(null);
  };

  const editorProps: SectionEditorProps = {
    value: sectionDraft,
    onChange: applySection,
    readOnly,
    t,
    tags: routingTags,
  };

  const renderVisual = () => {
    if (navId === "routing") {
      return (
        <RoutingBuilder value={sectionDraft} onChange={applySection} readOnly={readOnly} t={t} syncKey={dataEpoch} tags={routingTags} />
      );
    }
    if (navId === "outbounds") {
      return <OutboundsBuilder value={sectionDraft} onChange={applySection} readOnly={readOnly} t={t} syncKey={dataEpoch} usage={outboundUsage} inboundTags={routingTags.inbounds.map((i) => i.tag)} />;
    }
    if (navId === "dns") {
      return <DnsBuilder value={sectionDraft} onChange={applySection} readOnly={readOnly} t={t} syncKey={dataEpoch} />;
    }
    const Editor = SIMPLE_EDITORS[navId];
    return Editor ? <Editor {...editorProps} /> : null;
  };

  const availableAdds = missingKeys;

  const outboundUsage = useMemo(() => {
    const usage: Record<string, number> = {};
    const routing = isRecord(root?.routing) ? root!.routing : null;
    const bump = (tag: unknown) => {
      if (typeof tag === "string" && tag) usage[tag] = (usage[tag] ?? 0) + 1;
    };
    for (const r of Array.isArray(routing?.rules) ? (routing!.rules as unknown[]) : []) if (isRecord(r)) bump(r.outboundTag);
    for (const b of Array.isArray(routing?.balancers) ? (routing!.balancers as unknown[]) : []) {
      if (!isRecord(b)) continue;
      bump(b.fallbackTag);
      const selectors = Array.isArray(b.selector) ? b.selector.filter((x): x is string => typeof x === "string") : [];
      for (const ob of Array.isArray(root?.outbounds) ? (root!.outbounds as unknown[]) : []) {
        if (isRecord(ob) && typeof ob.tag === "string" && selectors.some((sel) => sel && (ob.tag as string).startsWith(sel))) bump(ob.tag);
      }
    }
    return usage;
  }, [root]);

  return (
    <div className={fillHeight ? "flex h-full min-h-0 flex-col gap-3" : "space-y-3"}>
      {!loading && !templateOk ? <p className="shrink-0 text-sm text-rose-300">{invalidMsg}</p> : null}

      {!loading ? (
        <div className={fillHeight ? "shrink-0" : undefined}>
        <SectionCarousel
          items={carouselItems}
          activeId={navId}
          onSelect={navigate}
                    ariaLabel={t("pages.xray.navAria", { defaultValue: "Xray template sections" })}
          prevLabel={tr("prevSection", "Previous section")}
          nextLabel={tr("nextSection", "Next section")}
          extra={
            !readOnly && templateOk && availableAdds.length > 0 ? (
              <AddSectionMenu
                label={tr("addSection", "Add section")}
                options={availableAdds.map((k) => ({ key: k, label: sectionButtonLabel(t, k), icon: XRAY_SECTION_BY_KEY[k]?.icon ?? Braces }))}
                onPick={addSection}
              />
            ) : null
          }
        />
        </div>
      ) : null}

      <Surface padding="sm" className={fillHeight ? "flex min-h-0 flex-1 flex-col" : undefined}>
        <div className={fillHeight ? "shrink-0" : undefined}>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-[var(--fg)]">{title}</h3>
            {description ? <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-[var(--fg-subtle)]">{description}</p> : null}
          </div>
          {(hasVisual && !routingAdvanced) || (isSection && !readOnly && templateOk) ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {hasVisual && !routingAdvanced ? (
                <Segmented
                  size="sm"
                  layoutId="cfg-view-mode"
                  value={wantJson ? "json" : wantFlow ? "flow" : "visual"}
                  onChange={(v) => setViewModes((m) => ({ ...m, [navId]: v }))}
                  items={[
                    { id: "visual", label: tr("viewVisual", "Visual"), icon: LayoutList },
                    ...(navId === "routing" ? [{ id: "flow" as const, label: tr("viewFlow", "Traffic map"), icon: Network }] : []),
                    { id: "json", label: "JSON", icon: Braces },
                  ]}
                />
              ) : null}
              {isSection && !readOnly && templateOk ? (
                <Button type="button" variant="ghost" className="!px-2.5 !py-1.5 !text-xs !gap-1.5 text-rose-300" onClick={() => setRemoveOpen(true)}>
                  <Trash2 size={14} />
                  {tr("removeSection", "Remove section")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {(wantJson || navId === FULL) && templateOk && navId !== GENERAL ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" className="!px-2.5 !py-1.5 !text-xs !gap-1.5" onClick={formatJson} disabled={readOnly}>
              <Wand2 size={14} />
              {tr("format", "Format")}
            </Button>
            <Button type="button" variant="secondary" className="!px-2.5 !py-1.5 !text-xs !gap-1.5" onClick={() => void copyJson()}>
              <Copy size={14} />
              {tr("copy", "Copy")}
            </Button>
            {!readOnly ? (
              <Button type="button" variant="secondary" className="!px-2.5 !py-1.5 !text-xs !gap-1.5" onClick={() => void pasteJson()}>
                <ClipboardPaste size={14} />
                {tr("paste", "Paste")}
              </Button>
            ) : null}
            {!readOnly && navId === FULL ? (
              <>
                <Button type="button" variant="secondary" className="!px-2.5 !py-1.5 !text-xs !gap-1.5" onClick={() => fileRef.current?.click()}>
                  <FileUp size={14} />
                  {tr("importFile", "Import file")}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </>
            ) : null}
          </div>
        ) : null}

        {routingAdvanced ? (
          <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
            {t("pages.xray.routingBuilder.advancedOnly")}
          </p>
        ) : null}

        {sectionIssues.length > 0 && !loading ? (
          <ul className={`mb-3 space-y-1.5 ${fillHeight ? "max-h-36 overflow-y-auto" : ""}`}>
            {sectionIssues.map((i, idx) => (
              <li
                key={idx}
                className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${
                  i.level === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span className="flex-1">{issueText(i)}</span>
                {navId === GENERAL || navId === FULL ? (
                  <button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={() => navigate(i.section)}>
                    {sectionButtonLabel(t, i.section)}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {sectionParseError && isSection ? <p className="mb-3 text-sm text-rose-300">{sectionParseError}</p> : null}
        </div>

        <div className={fillHeight ? "min-h-0 flex-1 overflow-y-auto pr-1" : undefined}>
        {loading ? (
          <div className="grid min-h-48 place-items-center">
            <Spinner size={40} />
          </div>
        ) : navId === GENERAL && templateOk && !readOnly ? (
          <div className="space-y-4">
            <TrafficFlow root={root} tags={routingTags} t={t} />
            <SimpleCoreForm template={template} onPatch={patchSimpleCoreSafe} />
          </div>
        ) : wantFlow ? (
          <TrafficFlow root={root} tags={routingTags} t={t} />
        ) : showVisual ? (
          <div className="min-w-0">{renderVisual()}</div>
        ) : (
          <div className={`overflow-hidden rounded-xl border border-[var(--border)] ${fillHeight ? "h-full min-h-[240px]" : "min-h-[50vh]"}`}>
            <MonacoJsonEditor
              key={monacoEntry.fileName}
              path={monacoEntry.fileName}
              height={fillHeight ? "100%" : "70vh"}
              value={navId === GENERAL ? template : codeValue}
              onChange={handleCodeChange}
              readOnly={readOnly}
              schemaBundle={schemaBundle}
            />
          </div>
        )}
        </div>
      </Surface>

      <ConfirmDialog
        open={removeOpen}
        title={tr("removeSectionTitle", "Remove this section?")}
        description={tr("removeSectionBody", "The section is deleted from the template. You can add it back later with default values.")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={removeSection}
        danger
      />
    </div>
  );
});
