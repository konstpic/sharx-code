"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicPanelRuntime
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile, StatBlock } from "@/components/ui";
import { sizeFormat } from "@/lib/format";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot } from "./helpers";

export function ClassicPanelRuntime({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st, cpuGhz } = env;
  return (
    <ClassicRoot>
      <div className="mb-3 flex items-center gap-2">
        <IconTile icon={Cpu} tone="info" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.panelProcessTitle")}</h3>
      </div>
      <p className="mb-3 text-xs text-[var(--fg-muted)]">{t("pages.index.panelProcessDesc")}</p>
      <div className="grid gap-3 cl-rt">
        <StatBlock
          title={t("pages.index.logicalProcessors")}
          value={String(st.logicalPro ?? st.cpuCores ?? "—")}
        />
        <StatBlock title={t("pages.index.frequency")} value={cpuGhz} />
        <StatBlock
          title={t("pages.index.threads")}
          value={String(st.appStats?.threads ?? "—")}
        />
        <StatBlock
          title={t("pages.index.panelProcessHeap")}
          value={sizeFormat(st.appStats?.mem ?? 0)}
        />
      </div>
    </ClassicRoot>
  );
}
