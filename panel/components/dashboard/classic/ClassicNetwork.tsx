"use client";
/**
 * Classic (v2.6) dashboard widget: ClassicNetwork
 * JSX and classes are copied from the v2.6.0 DashboardPage; only the data plumbing differs (the AtomEnv of the
 * current page feeds it, nothing is fetched here). The tile around it is the card, the body scrolls when it is too tall.
 */
import { ArrowDown, ArrowLeftRight, ArrowUp, CloudDownload, CloudUpload, Globe, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton, IconTile, StatBlock } from "@/components/ui";
import { Surface } from "@/components/panel";
import type { AtomEnv } from "@/components/dashboard/BuiltinAtoms";
import { ClassicRoot, CountNumber, CountSize } from "./helpers";

export function ClassicNetwork({ env }: { env: AtomEnv }) {
  const { t } = useTranslation();
  const { st, ipv6Enabled } = env;
  const showIp = env.revealIp;
  const trafficMax = Math.max(1, st.netIO.up, st.netIO.down, st.netTraffic.sent, st.netTraffic.recv);
  return (
    <ClassicRoot>
      <div className="mb-4 flex items-center gap-2">
        <IconTile icon={Network} tone="info" size="sm" />
        <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.networkGroupTitle")}</h3>
      </div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
        {t("pages.index.netCurrentRates")}
      </p>
      <div className="grid gap-3 cl-pair">
        <Surface
          padding="sm"
          className="group relative overflow-hidden border-[var(--border)]/80 bg-gradient-to-b from-[var(--bg-elevated)]/95 via-[var(--surface)]/60 to-[var(--bg)]/50 shadow-sm transition duration-200 hover:shadow-md hover:ring-1 hover:ring-[var(--accent)]/25"
        >
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-emerald-500/25 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100"
            aria-hidden
          />
          <div className="relative">
            <StatBlock
              title={t("pages.index.upload")}
              value={<CountSize value={st.netIO.up} />}
              prefix={<ArrowUp size={16} className="text-emerald-400/90" />}
              suffix="/s"
            />
          </div>
          <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/35">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500/80 to-[var(--accent)] transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(4, (st.netIO.up / trafficMax) * 100)}%` }}
            />
          </div>
        </Surface>
        <Surface
          padding="sm"
          className="group relative overflow-hidden border-[var(--border)]/80 bg-gradient-to-b from-[var(--bg-elevated)]/95 via-[var(--surface)]/60 to-[var(--bg)]/50 shadow-sm transition duration-200 hover:shadow-md hover:ring-1 hover:ring-sky-400/30"
        >
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-sky-500/25 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100"
            aria-hidden
          />
          <div className="relative">
            <StatBlock
              title={t("pages.index.download")}
              value={<CountSize value={st.netIO.down} />}
              prefix={<ArrowDown size={16} className="text-sky-400/90" />}
              suffix="/s"
            />
          </div>
          <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/35">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500/80 to-cyan-400/70 transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(4, (st.netIO.down / trafficMax) * 100)}%` }}
            />
          </div>
        </Surface>
      </div>
      <p className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
        {t("pages.index.netCumulativeTraffic")}
      </p>
      <div className="grid gap-3 cl-pair">
        <Surface
          padding="sm"
          className="group relative overflow-hidden border-[var(--border)]/80 bg-gradient-to-b from-[var(--bg-elevated)]/95 via-[var(--surface)]/60 to-[var(--bg)]/50 shadow-sm transition duration-200 hover:shadow-md hover:ring-1 hover:ring-amber-400/25"
        >
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-amber-500/20 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100"
            aria-hidden
          />
          <div className="relative">
            <StatBlock
              title={t("pages.index.sent")}
              value={<CountSize value={st.netTraffic.sent} />}
              prefix={<CloudUpload size={16} className="text-amber-400/90" />}
            />
          </div>
          <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/35">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500/75 to-orange-500/60 transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(4, (st.netTraffic.sent / trafficMax) * 100)}%` }}
            />
          </div>
        </Surface>
        <Surface
          padding="sm"
          className="group relative overflow-hidden border-[var(--border)]/80 bg-gradient-to-b from-[var(--bg-elevated)]/95 via-[var(--surface)]/60 to-[var(--bg)]/50 shadow-sm transition duration-200 hover:shadow-md hover:ring-1 hover:ring-violet-400/25"
        >
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-violet-500/20 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100"
            aria-hidden
          />
          <div className="relative">
            <StatBlock
              title={t("pages.index.received")}
              value={<CountSize value={st.netTraffic.recv} />}
              prefix={<CloudDownload size={16} className="text-violet-400/90" />}
            />
          </div>
          <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/35">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500/75 to-fuchsia-500/55 transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(4, (st.netTraffic.recv / trafficMax) * 100)}%` }}
            />
          </div>
        </Surface>
      </div>
      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
          {t("pages.index.netSocketsTitle")}
        </p>
        <div className="grid max-w-2xl gap-3 cl-pair">
          <Surface padding="sm">
            <StatBlock
              title={t("pages.index.statTCP")}
              value={<CountNumber value={st.tcpCount} />}
              prefix={<ArrowLeftRight size={16} className="text-[var(--accent)]" />}
            />
          </Surface>
          <Surface padding="sm">
            <StatBlock
              title={t("pages.index.statUDP")}
              value={<CountNumber value={st.udpCount} />}
              prefix={<ArrowLeftRight size={16} className="text-[var(--accent)]" />}
            />
          </Surface>
        </div>
      </div>
      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconTile icon={Globe} tone="info" size="sm" />
            <h3 className="text-sm font-semibold text-[var(--fg)]">{t("pages.index.ipAddresses")}</h3>
          </div>
          <IconButton
            label={t("pages.index.toggleIpVisibility")}
            onClick={env.toggleIp}
          >
            <Globe size={16} />
          </IconButton>
        </div>
        <div className="grid gap-4 cl-pair">
          <StatBlock
            title={t("pages.index.statIPv4")}
            value={showIp ? st.publicIP?.ipv4 : "****"}
          />
          {ipv6Enabled ? (
            <StatBlock
              title={t("pages.index.statIPv6")}
              value={showIp ? st.publicIP?.ipv6 : "****"}
            />
          ) : null}
        </div>
      </div>
    </ClassicRoot>
  );
}
