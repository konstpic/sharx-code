"use client";

import { ArrowDownToLine, ArrowUpFromLine, Boxes, HandCoins, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Surface } from "@/components/panel";
import { Skeleton } from "@/components/ui";
import { formatCredits, formatDateTime, formatGB } from "./format";
import type { NetworkOverview, NetworkStatus } from "@/types/network";

type OverviewTabProps = {
  overview: NetworkOverview | null;
  status: NetworkStatus;
  loading: boolean;
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
        <Icon className="size-3.5 text-[var(--accent)]" />
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--fg-subtle)]">{sub}</div> : null}
    </div>
  );
}

export function OverviewTab({ overview, status, loading }: OverviewTabProps) {
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) =>
    t(`pages.network.${key}`, { defaultValue: fallback });

  if (loading && !overview) {
    return (
      <Surface>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" rounded="xl" />
          ))}
        </div>
      </Surface>
    );
  }

  const o = overview ?? {};
  const credits = `${formatCredits(o.balance)} ₢`;
  const reserved = `${formatCredits(o.reserved)} ₢`;
  const earned = `+${formatCredits(o.earnedPeriod)} ₢`;
  const spent = `−${formatCredits(o.spentPeriod)} ₢`;
  const servedGB = formatGB((o.servedUpGB ?? 0) + (o.servedDownGB ?? 0));
  const receivedGB = formatGB((o.receivedUpGB ?? 0) + (o.receivedDownGB ?? 0));

  return (
    <div className="space-y-5">
      <Surface>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Wallet} label={tr("balance", "Balance")} value={credits} />
          <StatCard icon={Wallet} label={tr("reserved", "Reserved")} value={reserved} />
          <StatCard icon={Wallet} label={tr("heldEarnings", "Заработок на удержании")} value={o.heldCredits == null ? "—" : `${formatCredits(o.heldCredits)} ₢`} sub={tr("heldExplanation", "Доступен после срока спора; это не комиссия")} />
          <StatCard icon={HandCoins} label={tr("earnedPeriod", "Earned this period")} value={earned} />
          <StatCard icon={HandCoins} label={tr("spentPeriod", "Spent this period")} value={spent} />
          <StatCard
            icon={ArrowUpFromLine}
            label={tr("served", "Served to others")}
            value={`${servedGB} GB`}
            sub={
              o.servedUpGB != null || o.servedDownGB != null
                ? `↑${formatGB(o.servedUpGB)} ↓${formatGB(o.servedDownGB)}`
                : undefined
            }
          />
          <StatCard
            icon={ArrowDownToLine}
            label={tr("received", "Received via others")}
            value={`${receivedGB} GB`}
            sub={
              o.receivedUpGB != null || o.receivedDownGB != null
                ? `↑${formatGB(o.receivedUpGB)} ↓${formatGB(o.receivedDownGB)}`
                : undefined
            }
          />
          <StatCard
            icon={Boxes}
            label={tr("publishedNodes", "Published nodes")}
            value={String(o.publishedNodes ?? 0)}
          />
          <StatCard
            icon={Boxes}
            label={tr("activeSessions", "Active sessions")}
            value={`${o.activeProviderSessions ?? 0} / ${o.activeConsumerSessions ?? 0}`}
            sub={tr("providerConsumer", "provider / consumer")}
          />
        </div>
      </Surface>
      {status.lastSyncAt ? (
        <p className="text-xs text-[var(--fg-subtle)]">
          {tr("lastSync", "Last synchronization with the coordinator")}:{" "}
          {formatDateTime(status.lastSyncAt)}
        </p>
      ) : null}
    </div>
  );
}
