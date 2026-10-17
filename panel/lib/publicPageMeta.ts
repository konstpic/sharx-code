/**
 * Pure helpers for the browser-tab title / favicon of the PUBLIC subscription page.
 * No React / DOM access here (unit-tested); the DOM side lives in `usePublicPageMeta`.
 */

/** Max size of an uploaded icon file (bytes). */
export const FAVICON_MAX_BYTES = 100 * 1024;
/** Warn in the admin UI when the icon fields make the page config bigger than this (chars). */
export const FAVICON_CONFIG_WARN_CHARS = 150 * 1024;

export const FAVICON_ACCEPT = ".png,.svg,.ico,.webp,.jpg,.jpeg,image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/webp,image/jpeg";

const DATA_URL_RE =
  /^data:image\/(png|svg\+xml|x-icon|vnd\.microsoft\.icon|webp|jpeg);(base64,[A-Za-z0-9+/]*={0,2}|utf8,[^\s]*|charset=utf-8,[^\s]*)$/i;
const MAX_URL_CHARS = 2 * 1024 * 1024;

export type FaviconRejectReason =
  | "url" | "mime" | "size" | "decode"
  | "svgStart" | "svgScript" | "svgForeign" | "svgEvent" | "svgExternal";

export type FaviconNormalized = { ok: true; value: string } | { ok: false; reason: FaviconRejectReason };

const SVG_START_RE = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+svg[^>[]*>\s*)?<svg[\s>/]/i;

/** Content checks for SVG icons (browsers do not run scripts in icons; we still forbid them). */
export function checkSvgContent(svg: string): FaviconRejectReason | null {
  if (!SVG_START_RE.test(svg)) return "svgStart";
  if (/<script/i.test(svg)) return "svgScript";
  if (/<foreignobject/i.test(svg)) return "svgForeign";
  if (/[\s"'/]on[a-z]+\s*=/i.test(svg)) return "svgEvent";
  if (/<!entity/i.test(svg)) return "svgExternal";
  if (/(?:^|[\s:"'])href\s*=\s*["']?\s*(?:https?:|\/\/|javascript:|data:)/i.test(svg)) return "svgExternal";
  if (/url\(\s*["']?\s*(?:https?:|\/\/)/i.test(svg)) return "svgExternal";
  return null;
}

function utf8Len(s: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;
}

function normalizeSvgDataUrl(v: string): FaviconNormalized {
  const comma = v.indexOf(",");
  if (comma < 0) return { ok: false, reason: "mime" };
  const params = v.slice(0, comma).toLowerCase().split(";").slice(1).map((x) => x.trim());
  let b64 = false;
  for (const p of params) {
    if (p === "base64") b64 = true;
    else if (p !== "utf8" && p !== "charset=utf-8" && p !== "") return { ok: false, reason: "mime" };
  }
  const payload = v.slice(comma + 1);
  let svg: string;
  if (b64) {
    if (!/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(payload)) return { ok: false, reason: "decode" };
    try {
      const bin = atob(payload.replace(/\s+/g, ""));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, reason: "decode" };
    }
  } else {
    try {
      svg = /%[0-9a-f]{2}/i.test(payload) ? decodeURIComponent(payload) : payload;
    } catch {
      return { ok: false, reason: "decode" };
    }
  }
  svg = svg.trim();
  if (utf8Len(svg) > FAVICON_MAX_BYTES) return { ok: false, reason: "size" };
  const bad = checkSvgContent(svg);
  if (bad) return { ok: false, reason: bad };
  if (b64) return { ok: true, value: v.trim() };
  return { ok: true, value: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) };
}

/**
 * Validates an icon value typed / pasted / stored and returns its safe canonical form.
 * Raw `data:image/svg+xml;utf8,<svg ...>` (also charset=utf-8 / percent-encoded) is converted to a
 * percent-encoded data URL; base64 SVG is kept after its content is checked.
 */
export function normalizeFaviconInput(raw: unknown): FaviconNormalized {
  if (typeof raw !== "string") return { ok: false, reason: "url" };
  const v = raw.trim();
  if (!v || v.length > MAX_URL_CHARS) return { ok: false, reason: "url" };
  if (v.toLowerCase().startsWith("data:image/svg+xml")) return normalizeSvgDataUrl(v);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, reason: "url" };
  if (v.toLowerCase().startsWith("data:")) {
    return DATA_URL_RE.test(v) ? { ok: true, value: v } : { ok: false, reason: "mime" };
  }
  if (v.startsWith("/")) {
    if (v.startsWith("//") || v.includes("\\") || /\s/.test(v)) return { ok: false, reason: "url" };
    return { ok: true, value: v };
  }
  if (/\s/.test(v)) return { ok: false, reason: "url" };
  try {
    const u = new URL(v);
    if (u.protocol === "http:" || u.protocol === "https:") return { ok: true, value: v };
  } catch {
    /* not a URL */
  }
  return { ok: false, reason: "url" };
}

/** Returns a safe icon URL (http(s), same-origin path or allowed data: image) or "" when rejected. */
export function sanitizeFaviconUrl(raw: unknown): string {
  const r = normalizeFaviconInput(raw);
  return r.ok ? r.value : "";
}

export function isDataImageUrl(v: string): boolean {
  return v.slice(0, 11).toLowerCase() === "data:image/";
}

/** MIME type for the `type` attribute of <link rel="icon">; undefined if unknown. */
export function faviconMime(url: string): string | undefined {
  const u = url.trim();
  const m = /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(u);
  if (m) {
    const t = m[1].toLowerCase();
    return t === "image/vnd.microsoft.icon" ? "image/x-icon" : t;
  }
  const path = u.split(/[?#]/)[0].toLowerCase();
  const ext = /\.([a-z0-9]+)$/.exec(path)?.[1];
  switch (ext) {
    case "png": return "image/png";
    case "svg": return "image/svg+xml";
    case "ico": return "image/x-icon";
    case "webp": return "image/webp";
    case "jpg":
    case "jpeg": return "image/jpeg";
    default: return undefined;
  }
}

/** Approximate decoded size in bytes of a base64 data URL (or its length for others). */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf("base64,");
  if (i < 0) return dataUrl.length;
  const b64 = dataUrl.slice(i + 7);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
const ALLOWED_MIME = new Set(Object.values(EXT_TO_MIME).concat("image/vnd.microsoft.icon"));

export type FaviconFileCheck =
  | { ok: true; mime: string }
  | { ok: false; reason: "type" | "size" | "empty" };

/** Validates a picked file by name / declared type / size. */
export function checkFaviconFile(file: { name: string; type: string; size: number }): FaviconFileCheck {
  if (!file.size) return { ok: false, reason: "empty" };
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  const declared = (file.type || "").toLowerCase();
  let mime = ALLOWED_MIME.has(declared) ? declared : EXT_TO_MIME[ext];
  if (!mime || (declared && !ALLOWED_MIME.has(declared) && declared !== "application/octet-stream")) {
    return { ok: false, reason: "type" };
  }
  if (mime === "image/vnd.microsoft.icon") mime = "image/x-icon";
  if (file.size > FAVICON_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true, mime };
}

/** Forces the MIME part of a FileReader data URL (browsers often report "" / octet-stream for .ico). */
export function normalizeDataUrlMime(dataUrl: string, mime: string): string {
  const i = dataUrl.indexOf(";base64,");
  if (i < 0) return dataUrl;
  return `data:${mime}${dataUrl.slice(i)}`;
}

export type TitleVars = { title?: string; username?: string; status?: string };

/** Plain string replace of {title} {username} {status}; collapses spaces, trims. No eval. */
export function resolveTitle(template: string, vars: TitleVars): string {
  const map: Record<string, string> = {
    title: vars.title ?? "",
    username: vars.username ?? "",
    status: vars.status ?? "",
  };
  const out = template.replace(/\{(title|username|status)\}/g, (_, k: string) => map[k] ?? "");
  return out.replace(/\s+/g, " ").trim();
}

/** Picks a per-locale value: exact tag (ru-RU), then base language (ru). */
export function pickByLocale(map: unknown, lang: string): string {
  if (!map || typeof map !== "object") return "";
  const m = map as Record<string, unknown>;
  const l = (lang || "").trim();
  const cands = [l, l.replace("_", "-"), l.split(/[-_]/)[0]];
  for (const c of cands) {
    if (!c) continue;
    const key = Object.keys(m).find((k) => k.toLowerCase() === c.toLowerCase());
    const v = key ? m[key] : undefined;
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

type BrandingLike = {
  title?: unknown;
  pageTitle?: unknown;
  pageTitleByLocale?: unknown;
  faviconUrl?: unknown;
  faviconDark?: unknown;
  appleTouchIconUrl?: unknown;
};

export type PageMeta = {
  title: string;
  faviconUrl: string;
  faviconDark: string;
  appleTouchIconUrl: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Resolves the effective tab title and sanitized icon URLs from a branding object. */
export function resolvePageMeta(
  branding: BrandingLike | undefined | null,
  opts: { lang?: string; username?: string; status?: string; fallbackTitle: string },
): PageMeta {
  const b = branding ?? {};
  const brandTitle = str(b.title).trim() || opts.fallbackTitle;
  const template = pickByLocale(b.pageTitleByLocale, opts.lang ?? "") || str(b.pageTitle).trim();
  const resolved = template
    ? resolveTitle(template, { title: brandTitle, username: opts.username, status: opts.status })
    : "";
  return {
    title: resolved || brandTitle,
    faviconUrl: sanitizeFaviconUrl(b.faviconUrl),
    faviconDark: sanitizeFaviconUrl(b.faviconDark),
    appleTouchIconUrl: sanitizeFaviconUrl(b.appleTouchIconUrl),
  };
}

/**
 * Apple home-screen icon: iOS takes PNG (JPEG works too) and ignores SVG, ICO and WebP. Looks at the data: MIME
 * type or the URL extension only; the pixel checks live in the editor (they need the decoded image).
 */
export function appleIconFormatOk(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  const mime = faviconMime(v);
  return mime === undefined || mime === "image/png" || mime === "image/jpeg";
}

/** Notes about a decoded home-screen icon: apple-touch-icon should be a 180x180 (at least) opaque square. */
export function appleIconPixelIssues(w: number, h: number, hasAlpha: boolean): ("square" | "size" | "alpha")[] {
  const out: ("square" | "size" | "alpha")[] = [];
  if (w !== h) out.push("square");
  if (Math.min(w, h) < 180) out.push("size");
  if (hasAlpha) out.push("alpha");
  return out;
}
