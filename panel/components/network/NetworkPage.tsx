"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { useRbac } from "@/lib/rbac";
import { PageHeader, PageScaffold, Surface } from "@/components/panel";
import { Tabs, TabPanels } from "@/components/ui";
import { CatalogTab } from "./CatalogTab";
import { LedgerTab } from "./LedgerTab";
import { NodesTab } from "./NodesTab";
import { OnboardingCard } from "./OnboardingCard";
import { OverviewTab } from "./OverviewTab";
import { SessionsTab } from "./SessionsTab";
import type { NetworkOverview, NetworkStatus } from "@/types/network";

const TABS = ["overview", "nodes", "catalog", "sessions", "ledger"] as const;
type Tab = (typeof TABS)[number];

/**
 * SharX Network section. Participation is opt-in; until the panel is enrolled
 * and enabled, only the onboarding card is shown.
 */
export function NetworkPage() {
  const { t } = useTranslation();
  const { can } = useRbac();
  const manage = can("network:manage");
  const tr = (key: string, fallback: string) =>
    t(`pages.network.${key}`, { defaultValue: fallback });

  const [tab, setTab] = useState<Tab>("overview");
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [overview, setOverview] = useState<NetworkOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setError("");
    try {
      const [st, ov] = await Promise.all([
        getJson<NetworkStatus>(panel("network/status")),
        getJson<NetworkOverview>(panel("network/overview")),
      ]);
      if (!st.success) throw new Error(st.msg);
      setStatus(st.obj);
      setOverview(ov.success ? (ov.obj ?? null) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 45_000);
    return () => clearInterval(timer);
  }, [reload]);

  const active = Boolean(status?.enabled && status?.status === "active");

  return (
    <PageScaffold>
      <PageHeader
        title={tr("title", "SharX Network")}
        description={tr(
          "subtitle",
          "Exchange server capacity with other independent SharX panels: share a node, earn credits, spend them on other participants' servers.",
        )}
      />
      {error ? (
        <Surface>
          <div className="text-sm text-[var(--danger)]">{error}</div>
        </Surface>
      ) : null}

      {!active ? (
        <OnboardingCard
          status={status ?? { enabled: false, status: "disabled" }}
          manage={manage}
          onChanged={reload}
        />
      ) : (
        <>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={TABS.map((id) => ({
              id,
              label: tr(`tab.${id}`, id[0].toUpperCase() + id.slice(1)),
            }))}
          />
          <TabPanels value={tab} className="mt-5">
            {tab === "overview" ? (
              <OverviewTab overview={overview} status={status ?? { enabled: true, status: "active" }} loading={loading} />
            ) : null}
            {tab === "nodes" ? <NodesTab manage={manage} onChanged={reload} /> : null}
            {tab === "catalog" ? <CatalogTab manage={manage} onChanged={reload} /> : null}
            {tab === "sessions" ? <SessionsTab manage={manage} onChanged={reload} /> : null}
            {tab === "ledger" ? <LedgerTab /> : null}
          </TabPanels>
        </>
      )}
    </PageScaffold>
  );
}
