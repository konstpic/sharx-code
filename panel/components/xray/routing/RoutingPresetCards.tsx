"use client";

import { ArrowRight, Ban, Check, Globe2, Plus, ShieldOff, Unplug, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FieldRuleFormRow } from "@/lib/xrayRoutingForm";

export type RoutingPresetRule = { domain?: string[]; ip?: string[]; protocol?: string[] };

export type RoutingPreset = {
  id: string;
  icon: LucideIcon;
  target: "block" | "direct";
  rules: RoutingPresetRule[];
};

export const ROUTING_PRESETS: RoutingPreset[] = [
  { id: "ads", icon: ShieldOff, target: "block", rules: [{ domain: ["geosite:category-ads-all"] }] },
  { id: "torrent", icon: Unplug, target: "block", rules: [{ protocol: ["bittorrent"] }] },
  { id: "lan", icon: Globe2, target: "direct", rules: [{ ip: ["geoip:private"] }] },
  { id: "ru", icon: Globe2, target: "direct", rules: [{ domain: ["geosite:category-ru"] }, { ip: ["geoip:ru"] }] },
  { id: "cn", icon: Globe2, target: "direct", rules: [{ domain: ["geosite:cn"] }, { ip: ["geoip:cn"] }] },
];

const lines = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

function sameSet(have: string[], want: string[] | undefined) {
  const w = want ?? [];
  return have.length === w.length && w.every((x) => have.includes(x));
}

/** True when the form already contains every rule of the preset (to the given outbound). */
export function presetPresent(rules: FieldRuleFormRow[], preset: RoutingPreset, outboundTag: string): boolean {
  return preset.rules.every((pr) =>
    rules.some(
      (r) =>
        r.outboundTag === outboundTag &&
        sameSet(lines(r.domainLines), pr.domain) &&
        sameSet(lines(r.ipLines), pr.ip) &&
        sameSet(lines(r.protocolLines), pr.protocol),
    ),
  );
}

export function RoutingPresetCards({
  rules,
  outboundTags,
  readOnly,
  onAdd,
}: {
  rules: FieldRuleFormRow[];
  outboundTags: string[];
  readOnly: boolean;
  onAdd: (preset: RoutingPreset, outboundTag: string) => void;
}) {
  const { t } = useTranslation();
  const tagFor = (target: "block" | "direct") =>
    target === "direct" ? "direct" : (["block", "blocked"].find((x) => outboundTags.includes(x)) ?? "block");

  const label = (id: string) =>
    ({
      ads: t("pages.xray.routingBuilder.presetAds", { defaultValue: "Block ads and trackers" }),
      torrent: t("pages.xray.routingBuilder.presetTorrent", { defaultValue: "Block BitTorrent" }),
      lan: t("pages.xray.routingBuilder.presetLan", { defaultValue: "Local network direct" }),
      ru: t("pages.xray.routingBuilder.presetRu", { defaultValue: "Russia direct" }),
      cn: t("pages.xray.routingBuilder.presetCn", { defaultValue: "China direct" }),
    })[id] ?? id;
  const traffic = (id: string) =>
    ({
      ads: t("pages.xray.routingBuilder.trafficAds", { defaultValue: "ads, trackers" }),
      torrent: t("pages.xray.routingBuilder.trafficTorrent", { defaultValue: "BitTorrent" }),
      lan: t("pages.xray.routingBuilder.trafficLan", { defaultValue: "LAN, private IPs" }),
      ru: t("pages.xray.routingBuilder.trafficRu", { defaultValue: "RU sites and IPs" }),
      cn: t("pages.xray.routingBuilder.trafficCn", { defaultValue: "CN sites and IPs" }),
    })[id] ?? id;

  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-[var(--fg)]">
        {t("pages.xray.routingBuilder.presetsTitle", { defaultValue: "Rule presets" })}
      </div>
      <p className="mb-2 text-xs text-[var(--fg-subtle)]">
        {t("pages.xray.routingBuilder.presetsHint", {
          defaultValue: "One click adds ready-made rules. They are placed before a catch-all rule, and you can edit or remove them below.",
        })}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ROUTING_PRESETS.map((p) => {
          const tag = tagFor(p.target);
          const present = presetPresent(rules, p, tag);
          const Icon = p.icon;
          const block = p.target === "block";
          return (
            <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-[var(--border)] panel-inset p-3">
              <div className="flex items-center gap-2">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-lg"
                  style={{
                    background: block ? "rgba(239,68,68,0.14)" : "color-mix(in oklab, var(--accent) 16%, transparent)",
                    color: block ? "rgb(239,68,68)" : "var(--accent)",
                  }}
                >
                  {block && p.id === "torrent" ? <Ban size={16} aria-hidden /> : <Icon size={16} aria-hidden />}
                </span>
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--fg)]">{label(p.id)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]" aria-hidden>
                <span className="rounded-md panel-inset-strong px-1.5 py-0.5 font-mono text-[var(--fg-muted)]">{traffic(p.id)}</span>
                <ArrowRight size={11} className="text-[var(--fg-subtle)]" />
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono font-semibold uppercase ${
                    block ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {tag}
                </span>
              </div>
              <button
                type="button"
                disabled={readOnly || present}
                onClick={() => onAdd(p, tag)}
                className={`mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-default ${
                  present
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-[var(--border-strong)] text-[var(--fg)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                }`}
              >
                {present ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />}
                {present
                  ? t("pages.xray.routingBuilder.presetAdded", { defaultValue: "Added" })
                  : t("pages.xray.routingBuilder.presetAdd", { defaultValue: "Add rules" })}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
