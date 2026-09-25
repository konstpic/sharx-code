/**
 * Bundled translations of the ready-made elements' texts (keys are the same `{{ tr.key }}` keys the catalog writes).
 * English and Russian travel inside every layout; the other languages are loaded on demand for the visitor's language
 * and sit below anything the admin wrote in the layout's own dictionary.
 */
const LOADERS: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  uk: () => import("./uk.json"),
  es: () => import("./es.json"),
  tr: () => import("./tr.json"),
  pt: () => import("./pt.json"),
  id: () => import("./id.json"),
  vi: () => import("./vi.json"),
  zh: () => import("./zh.json"),
  tw: () => import("./tw.json"),
  ja: () => import("./ja.json"),
  ar: () => import("./ar.json"),
  fa: () => import("./fa.json"),
};

/** The bundled file for a page language ("zh-TW" → tw), or null for English, Russian and unknown languages. */
export function catalogLocaleFile(lang: string): string | null {
  const l = lang.toLowerCase().replace("_", "-");
  if (l.startsWith("zh-tw") || l.startsWith("zh-hk") || l === "tw") return "tw";
  const base = l.slice(0, 2);
  return base in LOADERS ? base : null;
}

const cache = new Map<string, Record<string, string>>();

export async function loadCatalogLocale(lang: string): Promise<Record<string, string>> {
  const file = catalogLocaleFile(lang);
  if (!file) return {};
  const hit = cache.get(file);
  if (hit) return hit;
  const mod = await LOADERS[file]();
  cache.set(file, mod.default);
  return mod.default;
}
