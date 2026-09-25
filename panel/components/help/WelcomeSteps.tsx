"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { linkP } from "@/lib/paths";

const STEPS: { key: string; def: string; href: string }[] = [
  { key: "welcomeStep1", def: "Add nodes", href: "panel/nodes" },
  { key: "welcomeStep2", def: "Create inbounds", href: "panel/inbounds" },
  { key: "welcomeStep3", def: "Check hosts", href: "panel/hosts" },
  { key: "welcomeStep4", def: "Make bundles", href: "panel/bundles" },
  { key: "welcomeStep5", def: "Add clients", href: "panel/clients" },
];

/** The setup order as links, shown under the welcome scene. */
export function WelcomeSteps({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <ol className="mt-5 grid gap-2 sm:grid-cols-2">
      {STEPS.map((s, i) => (
        <li key={s.key}>
          <Link
            href={linkP(s.href)}
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--fg)] transition-colors hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-xs font-semibold text-[var(--accent)]">
              {i + 1}
            </span>
            {t(`pages.index.${s.key}`, { defaultValue: s.def })}
          </Link>
        </li>
      ))}
    </ol>
  );
}
