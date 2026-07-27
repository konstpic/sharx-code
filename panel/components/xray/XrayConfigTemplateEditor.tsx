"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  patchSimpleCore,
  type XraySimpleCore,
} from "@/lib/xraySimpleCore";
import {
  extractSectionJson,
  getOrderedTemplateKeys,
  isTemplateJsonValid,
  mergeSectionIntoTemplate,
} from "@/lib/xrayTemplateSlice";
import { linkP } from "@/lib/paths";
import { PanelNavLink } from "@/components/panel/PanelNavLink";
import {
  buildXrayTemplateStepperItems,
  getActiveStepId,
  getNavIdForStep,
} from "@/lib/xrayTemplateStepper";
import { Surface } from "@/components/panel";
import { XrayTemplateNav, type XrayTemplateNavId } from "@/components/XrayTemplateNav";
import { Stepper, useToast } from "@/components/ui";
import { sectionButtonLabel } from "@/components/xray/sectionButtonLabel";
import { SimpleCoreForm } from "@/components/xray/SimpleCoreForm";
import { XrayTemplateSectionContent } from "@/components/xray/XrayTemplateSectionContent";

type SectionKey = "full" | string;

export type XrayConfigTemplateEditorHandle = {
  /** Merged valid JSON or null if save must be blocked */
  getJsonForSave: () => string | null;
};

type Props = {
  template: string;
  onTemplateChange: (next: string) => void;
  /** Increment when loading new data from server so nav resets */
  syncKey: string | number;
  readOnly?: boolean;
  loading?: boolean;
};

export const XrayConfigTemplateEditor = forwardRef<XrayConfigTemplateEditorHandle, Props>(
  function XrayConfigTemplateEditor(
    { template, onTemplateChange, syncKey, readOnly = false, loading = false },
    ref,
  ) {
    const { t } = useTranslation();
    const toast = useToast();
    const [navId, setNavId] = useState<XrayTemplateNavId>("general");
    const [sectionDraft, setSectionDraft] = useState("{}");
    const [dataEpoch, setDataEpoch] = useState(0);
    const [sectionParseError, setSectionParseError] = useState<string | null>(null);

    const sectionKey = useMemo<SectionKey>(() => (navId === "general" ? "full" : navId), [navId]);

    useEffect(() => {
      setNavId("general");
      setSectionParseError(null);
      setDataEpoch((e) => e + 1);
    }, [syncKey]);

    useEffect(() => {
      if (loading) return;
      if (sectionKey === "full") {
        setSectionParseError(null);
        return;
      }
      try {
        const root = JSON.parse(template) as Record<string, unknown>;
        setSectionDraft(extractSectionJson(root, sectionKey));
        setSectionParseError(null);
      } catch {
        setSectionDraft("{}");
        setSectionParseError(t("pages.xrayCoreConfigProfiles.invalidJson"));
      }
    }, [sectionKey, dataEpoch, loading, t, template]);

    const templateOk = useMemo(() => isTemplateJsonValid(template), [template]);

    useEffect(() => {
      if (loading || templateOk || navId !== "general") return;
      setNavId("full");
    }, [loading, templateOk, navId]);

    const sectionKeys = useMemo(() => {
      try {
        return getOrderedTemplateKeys(JSON.parse(template) as Record<string, unknown>);
      } catch {
        return [];
      }
    }, [template]);

    const { steps: xrayStepperItems, grouped: xrayGrouped, otherKeys: xrayOtherKeys } = useMemo(
      () => buildXrayTemplateStepperItems(t, sectionKeys),
      [t, sectionKeys],
    );

    const xrayActiveStepId = useMemo(
      () => getActiveStepId(navId, xrayGrouped, xrayOtherKeys),
      [navId, xrayGrouped, xrayOtherKeys],
    );

    const navigateTemplateNav = useCallback(
      (next: XrayTemplateNavId) => {
        if (readOnly || next === navId) return;
        if (next !== "general" && next !== "full" && !isTemplateJsonValid(template)) {
          toast.error(t("pages.xrayCoreConfigProfiles.invalidJson"));
          return;
        }
        if (navId !== "general" && navId !== "full" && sectionParseError) {
          toast.error(t("pages.xrayCoreConfigProfiles.invalidJson"));
          return;
        }
        setNavId(next);
        if (next === "general") {
          setSectionParseError(null);
        }
      },
      [readOnly, navId, sectionParseError, t, toast, template],
    );

    const handleCodeChange = useCallback(
      (v: string | undefined) => {
        const val = v ?? "";
        if (readOnly || navId === "general") return;
        if (sectionKey === "full") {
          onTemplateChange(val);
          return;
        }
        setSectionDraft(val);
        try {
          onTemplateChange(mergeSectionIntoTemplate(template, sectionKey, val));
          setSectionParseError(null);
        } catch {
          setSectionParseError(t("pages.xrayCoreConfigProfiles.invalidJson"));
        }
      },
      [readOnly, navId, sectionKey, template, onTemplateChange, t],
    );

    const patchSimpleCoreSafe = useCallback(
      (p: Partial<XraySimpleCore>) => {
        if (!isTemplateJsonValid(template)) {
          toast.error(t("pages.xrayCoreConfigProfiles.invalidJson"));
          return;
        }
        try {
          onTemplateChange(patchSimpleCore(template, p));
          setSectionParseError(null);
        } catch {
          toast.error(t("pages.xrayCoreConfigProfiles.invalidJson"));
        }
      },
      [template, onTemplateChange, t, toast],
    );

    const applySection = useCallback(
      (sectionJson: string) => {
        setSectionDraft(sectionJson);
        try {
          onTemplateChange(mergeSectionIntoTemplate(template, String(sectionKey), sectionJson));
          setSectionParseError(null);
        } catch {
          setSectionParseError(t("pages.xrayCoreConfigProfiles.invalidJson"));
        }
      },
      [sectionKey, template, onTemplateChange, t],
    );

    const codeValue = useMemo(() => {
      if (sectionKey === "full") return template;
      return sectionDraft;
    }, [sectionKey, template, sectionDraft]);

    const showGeneralUi = navId === "general" && templateOk && !readOnly;
    const sectionLabel = useCallback((k: string) => sectionButtonLabel(t, k), [t]);

    useImperativeHandle(
      ref,
      () => ({
        getJsonForSave: () => {
          if (sectionKey !== "full" && sectionParseError) return null;
          let toSave = template;
          if (sectionKey !== "full") {
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

    return (
      <>
        {!loading && !templateOk && navId !== "full" ? (
          <p className="text-sm text-rose-300">{t("pages.xrayCoreConfigProfiles.invalidJson")}</p>
        ) : null}

        {!loading ? (
          <div className="mb-2 overflow-x-auto">
            <Stepper
              steps={xrayStepperItems}
              activeId={xrayActiveStepId}
              allowJump={!readOnly && templateOk}
              onSelect={(id) => {
                const nextNav = getNavIdForStep(id, xrayGrouped, xrayOtherKeys);
                navigateTemplateNav(nextNav);
              }}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          {!loading ? (
            <XrayTemplateNav
              navId={navId}
              onSelect={navigateTemplateNav}
              sectionKeys={sectionKeys}
              sectionLabel={sectionLabel}
              templateOk={templateOk}
              disabled={readOnly}
            />
          ) : null}

          <div className="min-w-0 flex-1 space-y-3">
            {showGeneralUi ? (
              <SimpleCoreForm template={template} onPatch={patchSimpleCoreSafe} />
            ) : null}

            {!loading && templateOk && navId !== "general" ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--fg-muted)]">{t("pages.xray.sliceEditorHint")}</p>
                {navId === "routing" ? (
                  <p className="text-xs leading-relaxed text-[var(--fg-subtle)]">
                    {t("pages.xray.RoutingsDesc")} {t("pages.xray.balancer.balancerDesc")}
                  </p>
                ) : null}
                {navId === "dns" ? (
                  <p className="text-xs text-[var(--fg-subtle)]">{t("pages.xray.dns.enableDesc")}</p>
                ) : null}
                {navId === "outbounds" ? (
                  <p className="text-xs text-[var(--fg-subtle)]">{t("pages.xray.OutboundsDesc")}</p>
                ) : null}
                {navId === "inbounds" ? (
                  <p className="text-xs leading-relaxed text-[var(--fg-subtle)]">
                    {t("pages.xray.inboundsTemplateHint", {
                      defaultValue:
                        "User-facing inbounds are usually managed under Inbounds. This template slice is for defaults and the API inbound.",
                    })}{" "}
                    <PanelNavLink
                      href={linkP("panel/inbounds")}
                      className="text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      {t("menu.inbounds", { defaultValue: "Inbounds" })}
                    </PanelNavLink>
                  </p>
                ) : null}
                {sectionParseError ? (
                  <p className="text-sm text-rose-300">{sectionParseError}</p>
                ) : null}
              </div>
            ) : null}

            {!loading && !templateOk && navId === "full" ? (
              <p className="text-sm text-rose-300">{t("pages.xrayCoreConfigProfiles.invalidJson")}</p>
            ) : null}

            <Surface padding="sm" className="overflow-x-auto">
              <XrayTemplateSectionContent
                navId={navId}
                sectionDraft={sectionDraft}
                applySection={applySection}
                handleCodeChange={handleCodeChange}
                codeValue={codeValue}
                templateOk={templateOk}
                loading={loading}
                readOnly={readOnly}
                showGeneralUi={showGeneralUi}
                syncKey={syncKey}
                t={t}
              />
            </Surface>
          </div>
        </div>
      </>
    );
  },
);
