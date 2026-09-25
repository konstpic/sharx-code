"use client";

import { useTranslation } from "react-i18next";
import { supported } from "@/lib/i18n";

/** Language picker shown at bottom of the page when multiple locales are configured. */
export function LanguagePicker({ locales }: { locales: string[] }) {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.slice(0, 2) ?? "en";

  const LANG_LABELS: Record<string, string> = Object.fromEntries(
    supported.map((s) => [s.code, s.label]),
  );

  return (
    <div className="flex items-center justify-center gap-2">
      {locales.map((locale) => {
        const isActive = locale === currentLang;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => void i18n.changeLanguage(locale)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
              isActive
                ? "bg-[var(--sub-accent-soft,rgba(34,211,238,0.14))] text-[var(--sub-accent,#22d3ee)]"
                : "text-[var(--sub-fg-muted,#8b949e)] hover:text-[var(--sub-fg,#c9d1d9)]"
            }`}
          >
            {LANG_LABELS[locale] ?? locale.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
