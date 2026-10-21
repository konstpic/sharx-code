"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicUptime
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile, PillTag } from "@/components/ui";
import { formatSecond } from "@/lib/format";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot } from "./helpers";

export function ClassicUptime({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st, multi } = env;
  const nx = st.nodesXray;
  return (
    <ClassicRoot>
      <div className="mb-2 flex items-center gap-2">
        <IconTile icon={Clock} tone="warning" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.operationHours")}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <PillTag tone="blue">
          {t("pages.index.panelUptimeLabel")}: {formatSecond(st.panelUptime ?? 0)}
        </PillTag>
        <PillTag tone="blue">
          {t("pages.index.osLabel")}: {formatSecond(st.uptime)}
        </PillTag>
        {!multi && (
          <PillTag tone="green">
            {t("pages.index.xrayUptimeLabel")}: {formatSecond(st.appStats?.uptime || 0)}
          </PillTag>
        )}
        {multi && nx && nx.total > 0 && (
          <PillTag tone="green">
            {t("pages.index.nodesCoresRunningPill", { running: nx.running, total: nx.total })}
          </PillTag>
        )}
      </div>
    </ClassicRoot>
  );
}
