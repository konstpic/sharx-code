"use client";

import { Globe2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { IconTile } from "@/components/ui";
import { Surface } from "@/components/panel";

type DCRow = {
  dc: number;
  state: "up" | "degraded" | "down" | "unknown";
  rttMs?: number;
  endpoints: number;
  availableEndpoints: number;
  aliveWriters: number;
  requiredWriters: number;
  coveragePct: number;
  load: number;
  ipPreference?: string;
  source: "me" | "upstream";
};

type Instance = {
  inboundId: number;
  tag: string;
  remark: string;
  port: number;
  available: boolean;
  reason?: string;
  meEnabled: boolean;
  upstreams?: { configured: number; healthy: number; unhealthy: number };
  dcs: DCRow[];
  updatedAt: number;
};

type Source = { kind: "panel" | "node"; nodeId: number; name: string; error?: string; instances: Instance[] };

const STANDARD_DCS = [1, 2, 3, 4, 5];
const POLL_MS = 15000;

const stateStyle: Record<DCRow["state"], string> = {
  up: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  degraded: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  down: "border-red-500/40 bg-red-500/10 text-red-400",
  unknown: "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-subtle)]",
};
const dotStyle: Record<DCRow["state"], string> = {
  up: "bg-emerald-400",
  degraded: "bg-amber-400",
  down: "bg-red-400",
  unknown: "bg-[var(--fg-subtle)]",
};

/** Telemt reports media DCs as negative ids and DC 203 is the CDN/non-standard cluster. */
function dcLabel(dc: number) {
  if (dc < 0) return `DC${-dc} media`;
  if (dc === 203) return "DC203 CDN";
  return `DC${dc}`;
}

function DcChip({ dc, row }: { dc: number; row?: DCRow }) {
  const { t } = useTranslation();
  const state = row?.state ?? "unknown";
  const tip = row
    ? [
        `${dcLabel(dc)}: ${t(`pages.index.telemtDc.state.${state}`, { defaultValue: state })}`,
        row.endpoints > 0 ? `${t("pages.index.telemtDc.endpoints", { defaultValue: "Endpoints" })}: ${row.availableEndpoints}/${row.endpoints}` : "",
        row.requiredWriters > 0 ? `${t("pages.index.telemtDc.writers", { defaultValue: "Writers" })}: ${row.aliveWriters}/${row.requiredWriters} (${Math.round(row.coveragePct)}%)` : "",
        row.load > 0 ? `${t("pages.index.telemtDc.load", { defaultValue: "Sessions" })}: ${row.load}` : "",
        row.ipPreference && row.ipPreference !== "unknown" ? `IP: ${row.ipPreference}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `${dcLabel(dc)}: ${t("pages.index.telemtDc.noData", { defaultValue: "no data" })}`;
  return (
    <div title={tip} className={`flex min-w-[76px] flex-col items-center rounded-lg border px-2.5 py-1.5 ${stateStyle[state]}`}>
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        <span className={`h-2 w-2 rounded-full ${dotStyle[state]}`} />
        {dcLabel(dc)}
      </span>
      <span className="font-mono text-[10px] opacity-80">{row?.rttMs != null ? `${Math.round(row.rttMs)} ms` : "—"}</span>
    </div>
  );
}

function InstanceBlock({ inst }: { inst: Instance }) {
  const { t } = useTranslation();
  const byDc = new Map(inst.dcs.map((d) => [d.dc, d]));
  const extra = inst.dcs
    .map((d) => d.dc)
    .filter((d) => !STANDARD_DCS.includes(d))
    .sort((a, b) => (a < 0) === (b < 0) ? Math.abs(a) - Math.abs(b) : a < 0 ? -1 : 1);
  const order = [...STANDARD_DCS, ...extra];
  return (
    <div className="rounded-xl border border-[var(--border)]/80 bg-[var(--bg-elevated)]/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--fg)]">{inst.remark}</p>
          <p className="text-[11px] text-[var(--fg-subtle)]">
            :{inst.port || "—"} · {inst.meEnabled ? "Middle-End" : "Direct"}
            {inst.upstreams ? ` · ${t("pages.index.telemtDc.upstreams", { defaultValue: "upstreams" })} ${inst.upstreams.healthy}/${inst.upstreams.configured}` : ""}
          </p>
        </div>
      </div>
      {inst.available ? (
        <div className="flex flex-wrap gap-2">
          {order.map((dc) => (
            <DcChip key={dc} dc={dc} row={byDc.get(dc)} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--fg-subtle)]">
          {t(`pages.index.telemtDc.reason.${inst.reason ?? "unreachable"}`, {
            defaultValue:
              inst.reason === "api_disabled"
                ? "Control API is disabled for this inbound."
                : inst.reason === "feature_disabled"
                  ? "Minimal runtime stats are disabled (server.api.minimal_runtime_enabled)."
                  : "Telemt did not answer.",
          })}
        </p>
      )}
    </div>
  );
}

/** Telegram datacenter availability as seen by every running Telemt instance (panel and nodes). */
export function TelemtDcStatusCard() {
  const { t } = useTranslation();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await getJson<Source[]>(panel("api/inbounds/telemtDcStatus"));
      if (r.success && Array.isArray(r.obj)) setSources(r.obj);
    } catch {
      /* keep the last snapshot */
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (!sources || sources.length === 0) return null;

  return (
    <Surface>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconTile icon={Globe2} tone="accent" size="sm" />
          <h3 className="text-sm font-semibold text-[var(--fg)]">
            {t("pages.index.telemtDc.title", { defaultValue: "Telegram DC availability (Telemt)" })}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          title={t("common.refresh", { defaultValue: "Refresh" })}
          className="rounded-md p-1.5 text-[var(--fg-subtle)] hover:bg-[var(--surface)] hover:text-[var(--fg)]"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="space-y-4">
        {sources.map((s) => (
          <div key={`${s.kind}-${s.nodeId}`}>
            {sources.length > 1 || s.kind === "node" ? (
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">{s.name}</p>
            ) : null}
            {s.error ? <p className="mb-2 text-xs text-red-400">{s.error}</p> : null}
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
              {s.instances.map((i) => (
                <InstanceBlock key={`${i.inboundId}-${i.tag}`} inst={i} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--fg-subtle)]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />{t("pages.index.telemtDc.state.up", { defaultValue: "available" })}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />{t("pages.index.telemtDc.state.degraded", { defaultValue: "degraded" })}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" />{t("pages.index.telemtDc.state.down", { defaultValue: "unavailable" })}</span>
        <span>{t("pages.index.telemtDc.legendRtt", { defaultValue: "ms = latency from this server to the DC" })}</span>
      </p>
    </Surface>
  );
}
