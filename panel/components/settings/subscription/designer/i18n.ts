"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

export type D = (key: string, en: string, vars?: Record<string, unknown>) => string;

/**
 * Designer strings: `subBuilder.designer.<key>` with the English text as the built-in default.
 * Literal braces are written ‹‹ ›› (so translation files never contain {{ }}); variables are written %{name}.
 */
export function useD(): D {
  const { t } = useTranslation();
  return useCallback(
    (key, en, vars) => {
      const s = t(`subBuilder.designer.${key}`, { defaultValue: en, interpolation: { prefix: "%{", suffix: "}", escapeValue: false }, ...(vars ?? {}) }) as string;
      return s.replace(/‹‹/g, "{{").replace(/››/g, "}}");
    },
    [t],
  );
}
