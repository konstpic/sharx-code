"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { extractSimpleCore, type XraySimpleCore } from "@/lib/xraySimpleCore";
import { Field, FieldGrid, TextField, ToggleChip, ToggleRow, makeTr } from "@/components/xray/configurator/fields";

const LOG_LEVELS = ["debug", "info", "warning", "error", "none"];
const DOMAIN_STRATEGIES = ["AsIs", "IPIfNonMatch", "IPOnDemand"];
const API_SERVICES: { key: "apiHandlerService" | "apiLoggerService" | "apiStatsService"; label: string }[] = [
  { key: "apiHandlerService", label: "HandlerService" },
  { key: "apiLoggerService", label: "LoggerService" },
  { key: "apiStatsService", label: "StatsService" },
];

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
      <div className="border-b border-[var(--border)] px-3 py-2">
        <div className="text-sm font-semibold text-[var(--fg)]">{title}</div>
        {hint ? <div className="mt-0.5 text-[11px] leading-snug text-[var(--fg-subtle)]">{hint}</div> : null}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  );
}

function Chips({ value, options, onPick }: { value: string; options: string[]; onPick: (v: string) => void }) {
  const list = options.includes(value) || value === "" ? options : [value, ...options];
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((o) => (
        <ToggleChip key={o} active={value === o} onClick={() => onPick(o)}>
          {o}
        </ToggleChip>
      ))}
    </div>
  );
}

export function SimpleCoreForm({
  template,
  onPatch,
}: {
  template: string;
  onPatch: (p: Partial<XraySimpleCore>) => void;
}) {
  const { t } = useTranslation();
  const tr = useMemo(() => makeTr(t), [t]);
  const v = useMemo(() => extractSimpleCore(template), [template]);
  const accessToFile = v.access !== "none";

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Group title={tr("qsLogs", "Logs")} hint={tr("qsLogsHint", "How much the core writes and where.")}>
        <Field label={t("pages.xray.logLevel")} hint={t("pages.xray.logLevelDesc")}>
          <Chips value={v.loglevel} options={LOG_LEVELS} onPick={(lvl) => onPatch({ loglevel: lvl })} />
        </Field>
        <ToggleRow
          label={t("pages.xray.accessLogToFile", { defaultValue: "Write access log to a file" })}
          hint={t("pages.xray.accessLogDesc")}
          checked={accessToFile}
          onChange={(on) => onPatch({ access: on ? (v.access !== "none" ? v.access : "/var/log/xray/access.log") : "none" })}
        />
        {accessToFile ? (
          <TextField mono value={v.access === "none" ? "" : v.access} placeholder="/var/log/xray/access.log" onChange={(val) => onPatch({ access: val.trim() || "none" })} />
        ) : null}
        <FieldGrid>
          <Field label={t("pages.xray.errorLog")} hint={t("pages.xray.errorLogDesc")}>
            <TextField mono value={v.error} placeholder="none" onChange={(val) => onPatch({ error: val })} />
          </Field>
          <Field label={t("pages.xray.maskAddress")} hint={t("pages.xray.maskAddressDesc")}>
            <TextField mono value={v.maskAddress} placeholder="quarter | half | full" onChange={(val) => onPatch({ maskAddress: val })} />
          </Field>
        </FieldGrid>
        <ToggleRow
          label={t("pages.xray.dnsLogEnable", { defaultValue: "Enable DNS query logging" })}
          hint={t("pages.xray.dnsLogDesc")}
          checked={v.dnsLog}
          onChange={(on) => onPatch({ dnsLog: on })}
        />
      </Group>

      <div className="space-y-3">
        <Group title={tr("qsRouting", "Routing")} hint={t("pages.xray.RoutingStrategyDesc")}>
          <Field label={t("pages.xray.RoutingStrategy")}>
            <Chips value={v.domainStrategy} options={DOMAIN_STRATEGIES} onPick={(ds) => onPatch({ domainStrategy: ds })} />
          </Field>
        </Group>

        <Group title={t("pages.xray.simpleApiSectionTitle", { defaultValue: "API (gRPC)" })} hint={t("pages.xray.simpleApiSectionHint", { defaultValue: "Handler / Logger / Stats must match the API inbound tag used for the panel." })}>
          <Field label={t("pages.xray.simpleApiTag", { defaultValue: "API tag" })} hint={t("pages.xray.simpleApiTagDesc", { defaultValue: "Same as the API inbound `tag` (e.g. api)." })}>
            <TextField mono value={v.apiTag} onChange={(val) => onPatch({ apiTag: val })} />
          </Field>
          <Field label={t("pages.xray.simpleApiServices", { defaultValue: "API services" })}>
            <div className="flex flex-wrap gap-1.5">
              {API_SERVICES.map((s) => (
                <ToggleChip key={s.key} active={v[s.key]} onClick={() => onPatch({ [s.key]: !v[s.key] })}>
                  {s.label}
                </ToggleChip>
              ))}
            </div>
          </Field>
        </Group>
      </div>

      <div className="lg:col-span-2">
        <Group title={t("pages.xray.simplePolicySectionTitle", { defaultValue: "Policy & stats" })} hint={tr("qsStatsHint", "Which traffic counters the core collects. Fine-tune levels in the Policy section.")}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <ToggleRow label={tr("statsUserUplink", "Count user upload")} checked={v.policyLevel0StatsUserUplink} onChange={(on) => onPatch({ policyLevel0StatsUserUplink: on })} />
            <ToggleRow label={tr("statsUserDownlink", "Count user download")} checked={v.policyLevel0StatsUserDownlink} onChange={(on) => onPatch({ policyLevel0StatsUserDownlink: on })} />
            <ToggleRow label={tr("qsInUp", "Inbound upload")} checked={v.policySystemStatsInboundUplink} onChange={(on) => onPatch({ policySystemStatsInboundUplink: on })} />
            <ToggleRow label={tr("qsInDown", "Inbound download")} checked={v.policySystemStatsInboundDownlink} onChange={(on) => onPatch({ policySystemStatsInboundDownlink: on })} />
            <ToggleRow label={tr("qsOutUp", "Outbound upload")} checked={v.policySystemStatsOutboundUplink} onChange={(on) => onPatch({ policySystemStatsOutboundUplink: on })} />
            <ToggleRow label={tr("qsOutDown", "Outbound download")} checked={v.policySystemStatsOutboundDownlink} onChange={(on) => onPatch({ policySystemStatsOutboundDownlink: on })} />
          </div>
        </Group>
      </div>
    </div>
  );
}
