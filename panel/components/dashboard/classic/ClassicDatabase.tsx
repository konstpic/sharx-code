"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicDatabase
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile, StatBlock } from "@/components/ui";
import { sizeFormat } from "@/lib/format";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot } from "./helpers";

export function ClassicDatabase({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st } = env;
  return (
    <ClassicRoot>
      <div className="mb-3 flex items-center gap-2">
        <IconTile icon={Database} tone="neutral" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.database")}</h3>
      </div>
      <div className="grid gap-3 cl-db">
        <StatBlock title={t("pages.index.dbSize")} value={sizeFormat(st.database?.size ?? 0)} />
        <StatBlock title={t("pages.index.dbTables")} value={String(st.database?.tables ?? 0)} />
        <StatBlock title={t("pages.index.dbRows")} value={String(st.database?.totalRows ?? 0)} />
        <StatBlock
          title={t("pages.index.dbConnections")}
          value={`${st.database?.openConns ?? 0} / ${st.database?.maxOpenConns ?? 0}`}
        />
      </div>
    </ClassicRoot>
  );
}
