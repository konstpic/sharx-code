"use client";

import { ArrowDown, ArrowUp, Check, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui";

/** Numeric parts of a release tag ("v26.6.1" -> [26,6,1]); non-numeric tails are ignored. */
export function versionParts(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(/[.\-+]/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n));
}

export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function CoreVersionCards({
  versions,
  installed,
  onPick,
}: {
  versions: string[];
  installed?: string;
  onPick: (version: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");

  const latest = useMemo(
    () => versions.reduce<string | null>((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null),
    [versions],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? versions.filter((v) => v.toLowerCase().includes(needle)) : versions;
  }, [versions, q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" />
        <Input
          className="!pl-9"
          value={q}
          placeholder={t("pages.index.versionSearch", { defaultValue: "Search version" })}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
        {shown.map((v) => {
          const isCurrent = !!installed && compareVersions(v, installed) === 0;
          const isLatest = latest !== null && compareVersions(v, latest) === 0;
          const cmp = installed ? compareVersions(v, installed) : 0;
          return (
            <button
              key={v}
              type="button"
              disabled={isCurrent}
              onClick={() => onPick(v)}
              className={`flex flex-col gap-1 rounded-xl border p-2.5 text-left transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-default ${
                isCurrent
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-[var(--border)] panel-inset hover:border-[var(--accent)]"
              }`}
            >
              <span className="font-mono text-sm font-semibold text-[var(--fg)]">{v}</span>
              <span className="flex min-h-4 flex-wrap items-center gap-1 text-[10px]">
                {isCurrent ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/20 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                    <Check size={10} aria-hidden /> {t("pages.index.currentVersionTag", { defaultValue: "Current" })}
                  </span>
                ) : null}
                {isLatest ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] px-1.5 py-0.5 font-medium text-[var(--accent)]">
                    <Sparkles size={10} aria-hidden /> {t("pages.index.latestVersionTag", { defaultValue: "Latest" })}
                  </span>
                ) : null}
                {!isCurrent && installed && cmp > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-[var(--fg-muted)]">
                    <ArrowUp size={10} aria-hidden /> {t("pages.index.versionNewer", { defaultValue: "newer" })}
                  </span>
                ) : null}
                {!isCurrent && installed && cmp < 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-[var(--fg-subtle)]">
                    <ArrowDown size={10} aria-hidden /> {t("pages.index.versionOlder", { defaultValue: "older" })}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
        {shown.length === 0 ? (
          <p className="col-span-full py-6 text-center text-sm text-[var(--fg-muted)]">
            {t("pages.templates.localNoMatch", { defaultValue: "Nothing found." })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
