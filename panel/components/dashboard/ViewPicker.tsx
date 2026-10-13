"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { METRIC_VIEWS, type MetricView } from "@/components/dashboard/CustomMetricPanel";

const W = 64;
const H = 40;

/** Tiny drawn preview of each look (cheap, no live data), tinted with the current colour. */
export function ViewThumb({ view }: { view: MetricView | string }) {
  const c = "currentColor";
  const dim = "color-mix(in oklab, currentColor 22%, transparent)";
  const body: Record<string, ReactNode> = {
    stat: (
      <>
        <rect x="6" y="8" width="22" height="3" rx="1.5" fill={dim} />
        <rect x="6" y="14" width="30" height="9" rx="2" fill={c} />
        <path d="M6 33 C16 26 22 36 32 28 S50 30 58 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
    hero: <rect x="12" y="13" width="40" height="14" rx="3" fill={c} />,
    spark: (
      <>
        <path d="M4 32 C14 20 20 34 30 22 S46 26 60 10 L60 38 L4 38Z" fill={dim} />
        <path d="M4 32 C14 20 20 34 30 22 S46 26 60 10" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    line: <path d="M4 30 L14 20 L24 26 L36 12 L48 22 L60 8" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
    area: (
      <>
        <path d="M4 30 L14 20 L24 26 L36 12 L48 22 L60 8 L60 38 L4 38Z" fill={dim} />
        <path d="M4 30 L14 20 L24 26 L36 12 L48 22 L60 8" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    bar: [8, 20, 14, 28, 22, 34].map((h, i) => <rect key={i} x={6 + i * 9.5} y={38 - h} width="6" height={h} rx="1.5" fill={c} opacity={0.5 + i * 0.1} />),
    gauge: (
      <>
        <path d="M14 33 A18 18 0 1 1 50 33" fill="none" stroke={dim} strokeWidth="5" strokeLinecap="round" />
        <path d="M14 33 A18 18 0 0 1 34 14" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" />
      </>
    ),
    semi: (
      <>
        <path d="M10 32 A22 22 0 0 1 54 32" fill="none" stroke={dim} strokeWidth="5" strokeLinecap="round" />
        <path d="M10 32 A22 22 0 0 1 40 12" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" />
      </>
    ),
    radial: (
      <>
        <circle cx="32" cy="20" r="14" fill="none" stroke={dim} strokeWidth="5" />
        <circle cx="32" cy="20" r="14" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" strokeDasharray="52 100" transform="rotate(-90 32 20)" />
      </>
    ),
    donut: (
      <>
        <circle cx="32" cy="20" r="13" fill="none" stroke={dim} strokeWidth="10" />
        <circle cx="32" cy="20" r="13" fill="none" stroke={c} strokeWidth="10" strokeDasharray="46 100" transform="rotate(-90 32 20)" />
      </>
    ),
    progress: (
      <>
        <rect x="6" y="14" width="52" height="10" rx="5" fill={dim} />
        <rect x="6" y="14" width="32" height="10" rx="5" fill={c} />
      </>
    ),
    segments: Array.from({ length: 10 }, (_, i) => <rect key={i} x={5 + i * 5.6} y={26 - i * 1.6} width="3.6" height={10 + i * 1.6} rx="1" fill={i < 6 ? c : dim} />),
    tank: (
      <>
        <rect x="22" y="5" width="20" height="30" rx="5" fill="none" stroke={dim} strokeWidth="2" />
        <rect x="24" y="19" width="16" height="14" rx="3" fill={c} />
      </>
    ),
    split: (
      <>
        <rect x="6" y="16" width="52" height="9" rx="4.5" fill={dim} />
        <rect x="6" y="16" width="34" height="9" rx="4.5" fill={c} />
        <circle cx="10" cy="33" r="2" fill={c} />
        <circle cx="42" cy="33" r="2" fill={dim} />
      </>
    ),
    status: (
      <>
        <rect x="10" y="12" width="44" height="16" rx="8" fill={dim} />
        <circle cx="21" cy="20" r="3.5" fill={c} />
        <rect x="28" y="18" width="19" height="4" rx="2" fill={c} />
      </>
    ),
    table: [10, 19, 28].map((y) => (
      <g key={y}>
        <rect x="6" y={y} width="30" height="3" rx="1.5" fill={dim} />
        <rect x="42" y={y} width="16" height="3" rx="1.5" fill={c} />
      </g>
    )),
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" aria-hidden>
      {body[view] ?? body.stat}
    </svg>
  );
}

/** Visual picker for a metric tile's look: thumbnails with labels. */
export function ViewPicker({ value, onChange, views = METRIC_VIEWS, color }: { value: string; onChange: (v: string) => void; views?: readonly string[]; color?: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {views.map((v) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            className={`group flex flex-col items-stretch gap-1.5 rounded-xl border p-2 text-center transition ${on ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] shadow-[0_0_0_1px_var(--accent)]" : "border-[var(--border)] hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]"}`}
          >
            <span className={`block h-10 ${on ? "" : "text-[var(--fg-muted)] group-hover:text-[var(--fg)]"}`} style={on ? { color: color ?? "var(--accent)" } : undefined}>
              <ViewThumb view={v} />
            </span>
            <span className={`truncate text-[11px] ${on ? "font-semibold text-[var(--fg)]" : "text-[var(--fg-muted)]"}`}>{t("pages.builder." + v, { defaultValue: v })}</span>
          </button>
        );
      })}
    </div>
  );
}
