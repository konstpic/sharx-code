"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicUsersOnline
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { Users } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { IconTile, StatBlock } from "@/components/ui";
import { linkP } from "@/lib/paths";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot, CountNumber } from "./helpers";

export function ClassicUsersOnline({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st } = env;
  return (
    <ClassicRoot>
      <div className="mb-2 flex items-center gap-2">
        <IconTile icon={Users} tone="success" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.usersOnline")}</h3>
      </div>
      <p className="mb-3 text-xs text-[var(--fg-muted)]">{t("pages.index.usersOnlineHint")}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <StatBlock
          title={t("pages.index.usersOnline")}
          value={<CountNumber value={st.usersOnline ?? 0} />}
          prefix={<Users size={16} className="text-emerald-400/90" />}
        />
        <Link
          href={linkP("panel/clients/statistics")}
          className="shrink-0 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          {t("pages.index.openClientStats")} →
        </Link>
      </div>
    </ClassicRoot>
  );
}
