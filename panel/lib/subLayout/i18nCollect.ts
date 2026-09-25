/**
 * Ready-made elements are written with English and Russian texts. Instead of baking one language into a node, a builder
 * can run in "collect" mode: every text becomes `{{ tr.<key> }}` and both languages are recorded in a dictionary that
 * travels with the inserted elements (see LayoutDoc.i18n), so the page follows the visitor's language.
 */
export type Dict = Record<string, Record<string, string>>;

let current: Dict | null = null;

const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export const collecting = (): boolean => current !== null;

/** Registers a text in both languages and returns its key. */
export function register(en: string, ru: string): string {
  const key = `t${hash(`${en}|${ru}`)}`;
  if (current) {
    (current.en ??= {})[key] = en;
    (current.ru ??= {})[key] = ru;
  }
  return key;
}

/** A text in the current mode: the plain language string, or a `{{ tr.key }}` reference while collecting. */
export function tx(lang: string, en: string, ru: string): string {
  if (!current) return lang === "ru" ? ru : en;
  return `{{ tr.${register(en, ru)} }}`;
}

/** Same, but as a bare expression (for filter arguments such as plural(...)): a quoted literal outside collect mode. */
export function txExpr(lang: string, en: string, ru: string): string {
  if (!current) return JSON.stringify(lang === "ru" ? ru : en);
  return `tr.${register(en, ru)}`;
}

/** The English text behind a `{{ tr.key }}` reference (used for layer names). */
export function plain(text: string): string {
  const m = /^\{\{\s*tr\.(\w+)\s*\}\}$/.exec(text);
  if (m && current?.en?.[m[1]] !== undefined) return current.en[m[1]];
  return text.replace(/\{\{[^}]*\}\}/g, "…");
}

/** Runs a builder in collect mode; returns its result and the dictionary of every text it used. */
export function collect<T>(fn: () => T): { result: T; i18n: Dict } {
  const prev = current;
  current = {};
  try {
    const result = fn();
    return { result, i18n: current };
  } finally {
    current = prev;
  }
}

export function mergeDict(a: Dict | undefined, b: Dict | undefined): Dict | undefined {
  if (!b || !Object.keys(b).length) return a;
  const out: Dict = { ...(a ?? {}) };
  for (const [lang, m] of Object.entries(b)) out[lang] = { ...(out[lang] ?? {}), ...m };
  return out;
}

/** Dictionary for one language: the layout's English, then the bundled texts of that language, then the layout's own. */
export function dictFor(i18n: Dict | undefined, lang: string, bundled?: Record<string, string>): Record<string, string> {
  const base = lang.slice(0, 2);
  return { ...(i18n?.en ?? {}), ...(bundled ?? {}), ...(i18n?.[base] ?? {}), ...(i18n?.[lang] ?? {}) };
}
