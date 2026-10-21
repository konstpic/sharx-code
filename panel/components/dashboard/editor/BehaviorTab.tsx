"use client";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui";
import { safeLinkUrl } from "@/lib/dashboardStyle";
import { Choice, Field, Section, Toggle } from "./controls";
import type { TabProps } from "./types";

/** Tab "Поведение": click action, hide on mobile, pulse on critical level, count-up. */
export function BehaviorTab({ r, style, patch, metric }: TabProps) {
  const { t } = useTranslation();
  const url = style?.url ?? "";
  return (
    <div className="space-y-4">
      {metric ? (
        <Section title={t("pages.builder.style.clickAction")} hint={t("pages.builder.style.clickHint")}>
          <Choice
            label={t("pages.builder.style.clickAction")}
            value={r.onClick}
            options={[
              { id: "none", label: t("pages.builder.style.clickNone") },
              { id: "history", label: t("pages.builder.style.clickHistory") },
              { id: "link", label: t("pages.builder.style.clickLink") },
            ]}
            onChange={(onClick) => patch({ onClick })}
          />
          {r.onClick === "history" ? <p className="text-[11px] text-[var(--fg-subtle)]">{t("pages.builder.style.historyHint")}</p> : null}
          {r.onClick === "link" ? (
            <Field label={t("pages.builder.style.linkUrl")}>
              <Input
                key={url}
                defaultValue={url}
                placeholder="/panel/inbounds  |  https://…"
                maxLength={500}
                aria-invalid={!url ? undefined : !safeLinkUrl(url)}
                onBlur={(e) => patch({ url: e.target.value.trim() ? (safeLinkUrl(e.target.value) ?? undefined) : undefined })}
              />
              <span className="block text-[11px] text-[var(--fg-subtle)]">{t("pages.builder.style.linkHint")}</span>
            </Field>
          ) : null}
        </Section>
      ) : null}
      <Section title={t("pages.builder.style.tabBehavior")}>
        <Toggle label={t("pages.builder.style.hideOnMobile")} checked={r.hideOnMobile} onChange={(hideOnMobile) => patch({ hideOnMobile })} hint={t("pages.builder.style.hideOnMobileHint")} />
        {metric ? (
          <>
            <Toggle label={t("pages.builder.style.pulseOnCrit")} checked={r.pulseOnCrit} onChange={(pulseOnCrit) => patch({ pulseOnCrit })} />
            <Toggle label={t("pages.builder.style.countUp")} checked={r.countUp} onChange={(countUp) => patch({ countUp })} hint={t("pages.builder.style.countUpHint")} />
          </>
        ) : null}
      </Section>
    </div>
  );
}
