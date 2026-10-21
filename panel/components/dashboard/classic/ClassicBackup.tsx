"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicBackup
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { CloudUpload, Download, Server, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile } from "@/components/ui";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot } from "./helpers";

export function ClassicBackup({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { exportDb, importDb, openConfig } = env.act;
  return (
    <ClassicRoot className="flex flex-col">
      <div className="flex items-center gap-2">
        <IconTile icon={Server} tone="success" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.backup")}</h3>
      </div>
      <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
        {t("pages.index.backupCardSubtitle", {
          defaultValue: "Download or restore the database",
        })}
      </p>
      <div className="mt-3 flex-1 space-y-2">
        <button
          type="button"
          onClick={exportDb}
          className="group flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 transition-colors hover:border-[var(--accent)]/50"
        >
          <span className="text-[11px] font-medium text-[var(--fg-muted)] group-hover:text-[var(--fg)]">
            {t("pages.index.exportDatabase")}
          </span>
          <Download size={14} className="shrink-0 text-[var(--fg-subtle)]" />
        </button>
        <button
          type="button"
          onClick={importDb}
          className="group flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 transition-colors hover:border-[var(--accent)]/50"
        >
          <span className="text-[11px] font-medium text-[var(--fg-muted)] group-hover:text-[var(--fg)]">
            {t("pages.index.importDatabase")}
          </span>
          <CloudUpload size={14} className="shrink-0 text-[var(--fg-subtle)]" />
        </button>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={openConfig}
          className="inline-flex items-center gap-1 text-[11px] text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)] hover:underline"
        >
          <SlidersHorizontal size={12} />
          {t("pages.index.config")}
        </button>
      </div>
    </ClassicRoot>
  );
}
