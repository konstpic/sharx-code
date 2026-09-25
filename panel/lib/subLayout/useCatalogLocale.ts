"use client";

import { useEffect, useState } from "react";
import { catalogLocaleFile, loadCatalogLocale } from "./locales";

/** The bundled element texts for the visitor's language (empty for English/Russian, which the layout carries itself). */
export function useCatalogLocale(lang: string): Record<string, string> | undefined {
  const [dict, setDict] = useState<{ lang: string; d: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!catalogLocaleFile(lang)) return;
    void loadCatalogLocale(lang).then((d) => alive && setDict({ lang, d }));
    return () => {
      alive = false;
    };
  }, [lang]);
  return dict && dict.lang === lang ? dict.d : undefined;
}
