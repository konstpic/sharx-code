"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicLogs
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile } from "@/components/ui";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot } from "./helpers";

export function ClassicLogs({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const openLogs = env.act.openLogs;
  return (
    <ClassicRoot className="flex flex-col">
      <div className="flex items-center gap-2">
        <IconTile icon={History} tone="info" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.logs")}</h3>
      </div>
      <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
        {t("pages.index.logsCardSubtitle", { defaultValue: "Panel actions and events (nodes and balancers have their own logs)" })}
      </p>
      <button
        type="button"
        onClick={openLogs}
        className="mt-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] py-2 text-center text-xs font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--surface-strong)]"
      >
        {t("pages.index.logs")}
      </button>
    </ClassicRoot>
  );
}
