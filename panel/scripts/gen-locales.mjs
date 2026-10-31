/**
 * Flattens TOML translation files from web/translation to public/locales JSON for the panel.
 *
 * Transformations applied during flatten:
 *  1. go-i18n template params {{.Param}} → i18next params {{param}}
 *  2. go-i18n plural keys  foo.one / foo.other → i18next keys foo_one / foo_other
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TOML from "@iarna/toml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const transDir = path.join(__dirname, "../../web/translation");
const outDir = path.join(__dirname, "../public/locales");

const files = {
  "en": "translate.en_US.toml",
  "ru": "translate.ru_RU.toml",
  "fa": "translate.fa_IR.toml",
  "zh": "translate.zh_CN.toml",
  "ar": "translate.ar_EG.toml",
  "es": "translate.es_ES.toml",
  "ja": "translate.ja_JP.toml",
  "id": "translate.id_ID.toml",
  "tr": "translate.tr_TR.toml",
  "pt": "translate.pt_BR.toml",
  "uk": "translate.uk_UA.toml",
  "vi": "translate.vi_VN.toml",
  "tw": "translate.zh_TW.toml",
};

// go-i18n plural suffixes that map directly to i18next plural suffixes
const PLURAL_SUFFIXES = new Set(["zero", "one", "two", "few", "many", "other"]);

/**
 * Convert a go-i18n flat key + value to an i18next-compatible key + value.
 * - "foo.bar.one" → key "foo.bar_one"
 * - "{{.Name}}"   → "{{name}}"
 */
function toI18nextEntry(flatKey, rawValue) {
  const value = String(rawValue).replace(/\{\{\.(\w+)\}\}/g, (_, p) => `{{${p.toLowerCase()}}}`);

  const dotIdx = flatKey.lastIndexOf(".");
  if (dotIdx !== -1) {
    const suffix = flatKey.slice(dotIdx + 1);
    if (PLURAL_SUFFIXES.has(suffix)) {
      const base = flatKey.slice(0, dotIdx);
      return { key: `${base}_${suffix}`, value };
    }
  }
  return { key: flatKey, value };
}

function flatten(obj, prefix = "", acc = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, key, acc);
    } else {
      const { key: i18nKey, value } = toI18nextEntry(key, v);
      acc[i18nKey] = value;
    }
  }
  return acc;
}

fs.mkdirSync(outDir, { recursive: true });

const enPath = path.join(transDir, files.en);
let enFlat = {};
if (fs.existsSync(enPath)) {
  enFlat = flatten(TOML.parse(fs.readFileSync(enPath, "utf8")));
}

for (const [lang, file] of Object.entries(files)) {
  const p = path.join(transDir, file);
  if (!fs.existsSync(p)) {
    console.warn("skip", p);
    continue;
  }
  const raw = fs.readFileSync(p, "utf8");
  const data = TOML.parse(raw);
  const flat = flatten(data);
  if (lang !== "en" && Object.keys(enFlat).length > 0) {
    for (const [k, v] of Object.entries(enFlat)) {
      if (!(k in flat)) flat[k] = v;
    }
  }
  // Keep panel-only translations that have not yet been backfilled into TOML.
  // Regenerating locales must not silently remove existing UI strings; TOML wins.
  const outputPath = path.join(outDir, `${lang}.json`);
  const existing = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, "utf8"))
    : {};
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ ...existing, ...flat }, null, 0),
    "utf8"
  );
  console.log("wrote", lang, Object.keys(flat).length, "keys");
}
