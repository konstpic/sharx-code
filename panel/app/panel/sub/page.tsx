"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePublicPageMeta } from "@/components/sub/usePublicPageMeta";
import { SubPageShell } from "@/components/sub/SubPageShell";
import {
  SubPageCenterMessage,
  SubPageErrorBox,
  SubPageRenderer,
} from "@/components/sub/SubPageRenderer";
import type { PublicSubPayload } from "@/components/sub/types";
import {
  isSharxV2Config,
  isSharxV1Config,
  type SharxBranding,
} from "@/lib/sharxSubpageConfig";
import { SUB_PAGE_COLOR_PRESET_DEFAULT } from "@/lib/subPageColorPreset";
import { panel } from "@/lib/paths";

function extractShellProps(data: PublicSubPayload | null): {
  branding?: SharxBranding;
  theme?: string;
  colorPreset?: string;
} {
  if (!data) return {};
  if (isSharxV2Config(data.config)) {
    return {
      branding: data.config.branding,
      theme: data.config.theme,
      colorPreset: data.config.colorPreset,
    };
  }
  if (isSharxV1Config(data.config)) {
    return {
      branding: {
        title: data.config.branding.title,
        logoUrl: data.config.branding.logoUrl,
        brandText: data.config.branding.brandText,
        supportUrl: data.config.branding.supportUrl,
      },
      theme: data.config.theme,
      colorPreset: SUB_PAGE_COLOR_PRESET_DEFAULT,
    };
  }
  return {};
}

function PublicSubPageInner() {
  const { t, i18n } = useTranslation();
  const searchParams = useSearchParams();
  const sp = searchParams.get("id")?.trim() ?? "";
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<PublicSubPayload | null>(null);

  const load = useCallback(
    async (id: string) => {
      if (!id.trim()) {
        setErr(t("pages.publicSub.missingId", { defaultValue: "Missing subscription id." }));
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const url = `${panel(`api/public/subscription`)}?id=${encodeURIComponent(id)}`;
        const res = await fetch(url, { credentials: "omit" });
        if (res.status === 404) {
          setErr(t("pages.publicSub.notFound", { defaultValue: "Subscription not found." }));
          setData(null);
          return;
        }
        if (res.status === 429) {
          setErr(
            t("pages.publicSub.rateLimit", {
              defaultValue: "Too many requests. Try again later.",
            }),
          );
          setData(null);
          return;
        }
        const body = (await res.json()) as {
          success?: boolean;
          obj?: PublicSubPayload;
          msg?: string;
        };
        if (!body.success || !body.obj) {
          setErr(
            body.msg ||
              t("pages.publicSub.loadError", { defaultValue: "Could not load subscription." }),
          );
          setData(null);
          return;
        }
        setData(body.obj);
      } catch {
        setErr(t("pages.publicSub.loadError", { defaultValue: "Could not load subscription." }));
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(sp);
  }, [load, sp]);

  // Browser-tab title / favicon from the page config (defaults while loading / on errors).
  const metaBranding = useMemo(() => extractShellProps(data).branding, [data]);
  usePublicPageMeta(metaBranding, {
    lang: i18n.language,
    username: data?.user?.username,
    status: data?.user?.userStatus,
    fallbackTitle: t("pages.publicSub.title", { defaultValue: "Subscription" }),
    applyToDocument: true,
  });

  if (loading) {
    return (
      <SubPageShell>
        <SubPageCenterMessage>
          {t("loading", { defaultValue: "Loading…" })}
        </SubPageCenterMessage>
      </SubPageShell>
    );
  }

  if (err || !data) {
    return (
      <SubPageShell>
        <SubPageErrorBox
          title={t("pages.publicSub.title", { defaultValue: "Subscription" })}
          description={err}
        />
      </SubPageShell>
    );
  }

  const { branding, theme, colorPreset } = extractShellProps(data);
  return (
    <SubPageShell branding={branding} theme={theme} colorPreset={colorPreset}>
      <SubPageRenderer data={data} interactive />
    </SubPageShell>
  );
}

export default function PublicSubPage() {
  return (
    <Suspense
      fallback={
        <SubPageShell>
          <SubPageCenterMessage>…</SubPageCenterMessage>
        </SubPageShell>
      }
    >
      <PublicSubPageInner />
    </Suspense>
  );
}
