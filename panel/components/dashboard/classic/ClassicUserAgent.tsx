"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicUserAgent
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile } from "@/components/ui";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot } from "./helpers";

export function ClassicUserAgent({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  // the donut gradient of v2.6, rebuilt from the same shares the list shows
  let current = 0;
  const parts = env.userAgents.map((item) => {
    const start = current;
    current += item.percentRaw;
    return { ...item, start, end: current };
  });
  const dashboardHwidUserAgentPie = {
    parts,
    gradient: parts.length > 0 ? `conic-gradient(${parts.map((part) => `${part.color} ${part.start}% ${part.end}%`).join(", ")})` : "conic-gradient(var(--border) 0% 100%)",
  };
  return (
    <ClassicRoot>
      <div className="mb-2 flex items-center gap-2">
        <IconTile icon={Users} tone="info" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">
          {t("pages.clients.hwidUserAgentShareTitle", {
            defaultValue: "User-Agent distribution by HWID",
          })}
        </h3>
      </div>
      <p className="mb-3 text-xs text-[var(--fg-muted)]">
        {t("pages.index.hwidUserAgentDashboardHint", {
          defaultValue: "Overall share of registered devices across all clients.",
        })}
      </p>
      {dashboardHwidUserAgentPie.parts.length === 0 ? (
        <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
      ) : (
        <div className="grid gap-4 cl-ua">
          <div className="mx-auto w-fit">
            <div
              className="relative h-40 w-40 rounded-full border border-[var(--border)]"
              style={{ background: dashboardHwidUserAgentPie.gradient }}
              aria-label={t("pages.clients.hwidUserAgentShareTitle", {
                defaultValue: "User-Agent distribution by HWID",
              })}
            >
              <div className="absolute inset-[22%] rounded-full bg-[var(--bg-elevated)]" />
            </div>
          </div>
          <div className="max-h-48 space-y-2 overflow-auto pr-1">
            {dashboardHwidUserAgentPie.parts.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate font-mono text-[var(--fg-muted)]">
                    {item.label}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-[var(--fg)]">
                  {item.percentLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ClassicRoot>
  );
}
