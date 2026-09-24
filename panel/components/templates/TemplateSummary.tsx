"use client";

import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export type TemplateSummaryData = Record<string, unknown> | null | undefined;

const SECURITY_STYLE: Record<string, string> = {
  reality: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  tls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  none: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium leading-4 ${className}`}>{children}</span>
  );
}

/** Tiny schematic of what a template configures: protocol -> transport -> protection, or config counts. */
export function TemplateSummary({ kind, summary }: { kind: string; summary: TemplateSummaryData }) {
  const { t } = useTranslation();
  if (!summary || Object.keys(summary).length === 0) return null;
  const s = summary as Record<string, string | number | undefined>;

  if (kind === "xray_config") {
    const parts: string[] = [];
    if (typeof s.outbounds === "number") parts.push(t("pages.templates.sumOutbounds", { defaultValue: "{{n}} outbounds", n: s.outbounds }));
    if (typeof s.rules === "number") parts.push(t("pages.templates.sumRules", { defaultValue: "{{n}} routing rules", n: s.rules }));
    if (typeof s.dnsServers === "number") parts.push(t("pages.templates.sumDns", { defaultValue: "{{n}} DNS servers", n: s.dnsServers }));
    if (parts.length === 0) return null;
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {parts.map((p) => (
          <Chip key={p} className="panel-inset-strong text-[var(--fg-muted)]">
            {p}
          </Chip>
        ))}
      </div>
    );
  }

  const security = typeof s.security === "string" ? s.security : "";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="protocol, transport, security">
      {s.protocol ? (
        <Chip className="bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] uppercase text-[var(--accent)]">{String(s.protocol)}</Chip>
      ) : null}
      {s.network ? (
        <>
          <ArrowRight size={10} className="text-[var(--fg-subtle)]" aria-hidden />
          <Chip className="panel-inset-strong text-[var(--fg-muted)]">{String(s.network)}</Chip>
        </>
      ) : null}
      {security ? (
        <>
          <ArrowRight size={10} className="text-[var(--fg-subtle)]" aria-hidden />
          <Chip className={SECURITY_STYLE[security] ?? "panel-inset-strong text-[var(--fg-muted)]"}>{security}</Chip>
        </>
      ) : null}
      {s.port ? <Chip className="ml-1 text-[var(--fg-subtle)]">:{String(s.port)}</Chip> : null}
    </div>
  );
}
