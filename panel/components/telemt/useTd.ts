"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

export type Td = (key: string, def: string, opts?: Record<string, unknown>) => string;

/** Translator scoped to `pages.index.telemtDc.*` with an English fallback. */
export function useTd(): Td {
  const { t } = useTranslation();
  return useCallback((key, def, opts) => t(`pages.index.telemtDc.${key}`, { defaultValue: def, ...(opts ?? {}) }) as string, [t]);
}
