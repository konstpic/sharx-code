"use client";

import { Check, Cloud, Feather, Lock, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export type InboundScenarioId = "reality" | "xhttp" | "hysteria2" | "trojan" | "shadowsocks";

type Scenario = {
  id: InboundScenarioId;
  icon: LucideIcon;
  /** Approximate 1–3 ratings: how hard it is to detect, how fast it is, how many clients support it. */
  stealth: number;
  speed: number;
  compat: number;
  protocol: string;
  needs?: "domain";
};

const SCENARIOS: Scenario[] = [
  { id: "reality", icon: ShieldCheck, stealth: 3, speed: 3, compat: 2, protocol: "VLESS · Reality · TCP" },
  { id: "hysteria2", icon: Zap, stealth: 1, speed: 3, compat: 2, protocol: "Hysteria 2 · UDP" },
  { id: "xhttp", icon: Cloud, stealth: 3, speed: 2, compat: 2, protocol: "VLESS · XHTTP · TLS", needs: "domain" },
  { id: "trojan", icon: Lock, stealth: 2, speed: 2, compat: 3, protocol: "Trojan · TLS", needs: "domain" },
  { id: "shadowsocks", icon: Feather, stealth: 1, speed: 3, compat: 3, protocol: "Shadowsocks" },
];

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--fg-muted)]">
      <span className="truncate">{label}</span>
      <span className="flex shrink-0 gap-0.5" aria-label={`${value}/3`}>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className="h-1.5 w-3.5 rounded-full"
            style={{ background: n <= value ? "var(--accent)" : "var(--border)" }}
          />
        ))}
      </span>
    </div>
  );
}

export function InboundScenarioPicker({
  value,
  onPick,
}: {
  value: InboundScenarioId | null;
  onPick: (id: InboundScenarioId) => void;
}) {
  const { t } = useTranslation();
  const title = (id: InboundScenarioId) =>
    ({
      reality: t("pages.inbounds.scenario.reality", { defaultValue: "Bypass blocks" }),
      hysteria2: t("pages.inbounds.scenario.hysteria2", { defaultValue: "Maximum speed" }),
      xhttp: t("pages.inbounds.scenario.xhttp", { defaultValue: "Behind CDN or proxy" }),
      trojan: t("pages.inbounds.scenario.trojan", { defaultValue: "Broad compatibility" }),
      shadowsocks: t("pages.inbounds.scenario.shadowsocks", { defaultValue: "Simple and light" }),
    })[id];
  const desc = (id: InboundScenarioId) =>
    ({
      reality: t("pages.inbounds.scenario.realityDesc", {
        defaultValue: "Looks like ordinary HTTPS to a real site. Best default against censorship; no domain or certificate needed.",
      }),
      hysteria2: t("pages.inbounds.scenario.hysteria2Desc", {
        defaultValue: "Fast over lossy links (mobile, long distance). UDP can be blocked on some networks.",
      }),
      xhttp: t("pages.inbounds.scenario.xhttpDesc", {
        defaultValue: "Works through CDNs and reverse proxies. Needs a domain and a TLS certificate.",
      }),
      trojan: t("pages.inbounds.scenario.trojanDesc", {
        defaultValue: "Supported by nearly every client app. Needs a domain and a TLS certificate.",
      }),
      shadowsocks: t("pages.inbounds.scenario.shadowsocksDesc", {
        defaultValue: "Minimal setup and overhead. Easier to detect than the others; fine where blocking is light.",
      }),
    })[id];

  return (
    <div className="mb-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
        {t("pages.inbounds.scenario.title", { defaultValue: "Quick start by scenario" })}
      </div>
      <p className="mb-2 text-[11px] text-[var(--fg-subtle)]">
        {t("pages.inbounds.scenario.hint", {
          defaultValue: "Pick a starting point, it fills protocol and transport. Everything stays editable in the next steps. Ratings are approximate.",
        })}
      </p>
      <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {SCENARIOS.map((s) => {
          const selected = value === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPick(s.id)}
              className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                selected
                  ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] shadow-[0_0_0_1px_var(--accent)]"
                  : "border-[var(--border)] panel-inset hover:border-[var(--border-strong)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-lg"
                  style={{ background: "color-mix(in oklab, var(--accent) 16%, transparent)", color: "var(--accent)" }}
                >
                  <Icon size={16} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--fg)]">{title(s.id)}</div>
                  <div className="truncate font-mono text-[10px] text-[var(--fg-subtle)]">{s.protocol}</div>
                </div>
                {selected ? <Check size={14} className="shrink-0 text-[var(--accent)]" aria-hidden /> : null}
              </div>
              <p className="text-[11px] leading-snug text-[var(--fg-muted)]">{desc(s.id)}</p>
              <div className="flex flex-col gap-1">
                <Meter label={t("pages.inbounds.scenario.stealth", { defaultValue: "Stealth" })} value={s.stealth} />
                <Meter label={t("pages.inbounds.scenario.speed", { defaultValue: "Speed" })} value={s.speed} />
                <Meter label={t("pages.inbounds.scenario.compat", { defaultValue: "Compatibility" })} value={s.compat} />
              </div>
              {s.needs === "domain" ? (
                <span className="w-fit rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                  {t("pages.inbounds.scenario.needsDomain", { defaultValue: "Needs domain + certificate" })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
