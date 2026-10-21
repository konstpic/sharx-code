"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicCores
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { Power, RefreshCw, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton, IconTile } from "@/components/ui";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot } from "./helpers";

export function ClassicCores({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st, multi, installedXray, installedTelemt } = env;
  const canXrayOperate = env.can.xrayOperate;
  const stopTelemtLocal = env.act.stopTelemt;
  const stopX = env.act.stopXray;
  const restartX = env.act.restartXray;
  const openVer = env.act.openVersions;
  return (
    <ClassicRoot className="flex flex-col">
      <div className="flex items-center gap-2">
        <IconTile icon={Wrench} tone="accent" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">
          {t("pages.index.coreVersionSwitch")}
        </h3>
      </div>
      <div className="mt-3 flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-xs text-[var(--fg-muted)]">Xray</span>
          <span className="flex items-center gap-1">
            {installedXray?.mismatch ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-amber-400"
                title={t("pages.index.coreVersionMismatch", {
                  defaultValue: "Nodes are not all on the same version — check Nodes",
                })}
              />
            ) : null}
            <span className="whitespace-nowrap rounded border border-[var(--border)] bg-[var(--surface-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent)]">
              {installedXray?.version || "—"}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-xs text-[var(--fg-muted)]">{t("pages.index.telemtShort")}</span>
          <span className="flex items-center gap-1">
            {installedTelemt?.mismatch ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-amber-400"
                title={t("pages.index.coreVersionMismatch", {
                  defaultValue: "Nodes are not all on the same version — check Nodes",
                })}
              />
            ) : null}
            <span className="whitespace-nowrap rounded border border-[var(--border)] bg-[var(--surface-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-subtle)]">
              {installedTelemt?.version || "—"}
            </span>
          </span>
        </div>
      </div>
      {!multi && canXrayOperate ? (
        <div className="mt-2 flex justify-end gap-0 border-t border-[var(--border)]/80 pt-2">
          <IconButton
            label={t("pages.index.stopTelemt")}
            disabled={st.telemt?.state !== "running"}
            onClick={stopTelemtLocal}
          >
            <Power size={14} />
          </IconButton>
          <IconButton label={t("pages.index.stopXray")} onClick={stopX}>
            <Power size={14} />
          </IconButton>
          <IconButton label={t("pages.index.restartXray")} onClick={restartX}>
            <RefreshCw size={14} />
          </IconButton>
        </div>
      ) : null}
      {canXrayOperate ? (
        <button
          type="button"
          onClick={openVer}
          className="mt-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] py-2 text-center text-xs font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--surface-strong)]"
        >
          {t("pages.index.coreVersionSwitch")}
        </button>
      ) : null}
    </ClassicRoot>
  );
}
