"use client";

import { useRef, useState } from "react";
import { useD } from "./designer/i18n";
import type { SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";
import {
  FAVICON_ACCEPT,
  FAVICON_CONFIG_WARN_CHARS,
  appleIconFormatOk,
  appleIconPixelIssues,
  checkFaviconFile,
  dataUrlBytes,
  normalizeDataUrlMime,
  resolvePageMeta,
  sanitizeFaviconUrl,
} from "@/lib/publicPageMeta";

type IconKey = "faviconUrl" | "faviconDark" | "appleTouchIconUrl";
type Branding = Record<string, unknown>;

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated,transparent)] px-2.5 py-1.5 text-[12.5px] text-[var(--fg)] outline-none focus:border-[var(--accent)]";
const btnCls =
  "rounded-lg border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--fg)]";
const labelCls = "mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]";

/**
 * "Browser tab" section: title + favicon of the PUBLIC subscription page (not the admin panel).
 * Edits config.branding.{pageTitle,pageTitleByLocale,faviconUrl,faviconDark,appleTouchIconUrl}.
 * Shared by the Branding tab and the designer's Styles tab.
 */
/** Decodes the picked home-screen icon and reports what iOS will not like (not square, small, transparent). */
async function inspectAppleIcon(src: string, d: (key: string, fallback: string) => string): Promise<string> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    let alpha = false;
    const cv = document.createElement("canvas");
    cv.width = Math.min(w, 64);
    cv.height = Math.min(h, 64);
    const cx = cv.getContext("2d");
    if (cx) {
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      const px = cx.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] < 255) {
          alpha = true;
          break;
        }
      }
    }
    const issues = appleIconPixelIssues(w, h, alpha);
    if (!issues.length) return "";
    const parts = issues.map((i) =>
      i === "square"
        ? d("tab.appleSquare", "the icon is not square")
        : i === "size"
          ? d("tab.appleSmall", "it is smaller than 180x180")
          : d("tab.appleAlpha", "it has transparency (iOS will draw black behind it)"),
    );
    return `${d("tab.appleWarn", "Home-screen icon")} ${w}x${h}: ${parts.join("; ")}.`;
  } catch {
    return "";
  }
}

export function BrowserTabEditor({
  config,
  onChange,
}: {
  config: SharxSubpageConfigV2;
  onChange: (next: SharxSubpageConfigV2) => void;
}) {
  const d = useD();
  const branding = (config.branding ?? {}) as Branding;
  const setBranding = (patch: Branding) =>
    onChange({ ...config, branding: { ...branding, ...patch } } as SharxSubpageConfigV2);
  const [err, setErr] = useState("");
  const [appleNote, setAppleNote] = useState("");

  const pageTitle = typeof branding.pageTitle === "string" ? branding.pageTitle : "";
  const byLocale = (branding.pageTitleByLocale ?? {}) as Record<string, string>;
  const fallback = d("tab.fallbackTitle", "Subscription");
  const meta = resolvePageMeta(branding as never, {
    lang: config.locales?.[0],
    username: d("tab.sampleUser", "client"),
    status: "ACTIVE",
    fallbackTitle: fallback,
  });

  const setLocaleTitle = (loc: string, v: string) => {
    const next = { ...byLocale };
    if (v.trim()) next[loc] = v;
    else delete next[loc];
    setBranding({ pageTitleByLocale: Object.keys(next).length ? next : undefined });
  };

  const onFile = async (key: IconKey, file: File | undefined) => {
    if (!file) return;
    const chk = checkFaviconFile(file);
    if (!chk.ok) {
      setErr(
        chk.reason === "size"
          ? d("tab.errSize", "File is too large (max 100 KB).")
          : chk.reason === "empty"
            ? d("tab.errEmpty", "File is empty.")
            : d("tab.errType", "Unsupported file type. Use PNG, SVG, ICO, WebP or JPG."),
      );
      return;
    }
    const url = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
      r.onerror = () => resolve("");
      r.readAsDataURL(file);
    });
    if (key === "appleTouchIconUrl" && !appleIconFormatOk(normalizeDataUrlMime(url, chk.mime))) {
      setErr(d("tab.errApple", "iOS does not use SVG, ICO or WebP for the home-screen icon. Upload a PNG (180x180, no transparency)."));
      return;
    }
    const fixed = sanitizeFaviconUrl(normalizeDataUrlMime(url, chk.mime));
    if (!fixed) {
      setErr(d("tab.errRead", "Could not read the file."));
      return;
    }
    setErr("");
    setBranding({ [key]: fixed });
    if (key === "appleTouchIconUrl") setAppleNote(await inspectAppleIcon(fixed, d));
    else setAppleNote("");
  };

  const iconChars = (["faviconUrl", "faviconDark", "appleTouchIconUrl"] as IconKey[]).reduce(
    (n, k) => n + (typeof branding[k] === "string" ? (branding[k] as string).length : 0),
    0,
  );
  const warnBig = iconChars > FAVICON_CONFIG_WARN_CHARS;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] p-3" data-testid="browser-tab-editor">
      <div className="text-[12.5px] font-semibold">{d("tab.section", "Browser tab")}</div>
      <p className="text-[11px] text-[var(--fg-subtle)]">
        {d("tab.scope", "Title and icon of the browser tab of the public subscription page that your clients open. The admin panel itself is not affected.")}
      </p>

      <div>
        <div className={labelCls}>{d("tab.title", "Tab title")}</div>
        <input
          className={inputCls}
          value={pageTitle}
          maxLength={200}
          onChange={(e) => setBranding({ pageTitle: e.target.value || undefined })}
          placeholder={String(branding.title || fallback)}
        />
        <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
          {d("tab.titleHint", "Placeholders: {title} - page title, {username} - client name, {status} - subscription status. Empty = page title.")}
        </p>
        {(config.locales ?? []).length > 0 ? (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11.5px] text-[var(--fg-muted)]">
              {d("tab.perLocale", "Different title per language")}
            </summary>
            <div className="mt-1.5 space-y-1.5">
              {(config.locales ?? []).map((loc) => (
                <div key={loc} className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-2">
                  <span className="text-[11.5px] text-[var(--fg-muted)]">{loc}</span>
                  <input
                    className={inputCls}
                    maxLength={200}
                    value={byLocale[loc] ?? ""}
                    onChange={(e) => setLocaleTitle(loc, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <IconField
        label={d("tab.favicon", "Favicon")}
        value={typeof branding.faviconUrl === "string" ? branding.faviconUrl : ""}
        onUrl={(v) => setBranding({ faviconUrl: v || undefined })}
        onFile={(f) => void onFile("faviconUrl", f)}
        d={d}
        showSizes
        hint={d("tab.hintFavicon", "Tab icon: PNG 32x32 or 64x64, or SVG. Up to 100 KB. Formats: PNG, SVG, ICO, WebP, JPG.")}
      />
      <IconField
        label={d("tab.faviconDark", "Favicon for dark browser theme (optional)")}
        value={typeof branding.faviconDark === "string" ? branding.faviconDark : ""}
        onUrl={(v) => setBranding({ faviconDark: v || undefined })}
        onFile={(f) => void onFile("faviconDark", f)}
        d={d}
        hint={d("tab.hintDark", "Same formats as the tab icon. Shown when the browser uses a dark theme (Chrome, Edge, Firefox); Safari shows the ordinary icon.")}
      />
      <IconField
        label={d("tab.apple", "Home-screen icon, apple-touch-icon (optional)")}
        value={typeof branding.appleTouchIconUrl === "string" ? branding.appleTouchIconUrl : ""}
        onUrl={(v) => setBranding({ appleTouchIconUrl: v || undefined })}
        onFile={(f) => void onFile("appleTouchIconUrl", f)}
        d={d}
        showSizes
        sizes={[60]}
        caption={d("tab.appleCaption", "How it looks on the home screen")}
        rounded
        hint={d("tab.hintApple", "Only for iPhone / iPad home screen: PNG 180x180, square, no transparency (iOS fills it with black). SVG, ICO and WebP are ignored by iOS. Up to 100 KB.")}
      />
      {appleNote ? <p className="text-[11.5px] text-[var(--warning,#fbbf24)]">{appleNote}</p> : null}

      {err ? <p className="text-[11.5px] text-[var(--danger,#f87171)]">{err}</p> : null}
      {warnBig ? (
        <p className="text-[11.5px] text-[var(--warning,#fbbf24)]">
          {d("tab.warnBig", "The embedded icons make the page config large (over 150 KB). Prefer a smaller image or an external URL.")}
        </p>
      ) : null}

      <div>
        <div className={labelCls}>{d("tab.mock", "Preview")}</div>
        <div className="inline-flex max-w-full items-center gap-2 rounded-t-lg border border-b-0 border-[var(--border)] bg-[var(--bg-elevated,rgba(255,255,255,.05))] px-3 py-1.5">
          {meta.faviconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.faviconUrl} alt="" width={16} height={16} className="h-4 w-4 shrink-0 object-contain" />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-sm bg-[var(--fg-subtle)] opacity-40" />
          )}
          <span className="max-w-[260px] truncate text-[12px]">{meta.title}</span>
          <span className="text-[11px] text-[var(--fg-subtle)]">x</span>
        </div>
      </div>
    </div>
  );
}

function IconField({
  label,
  value,
  onUrl,
  onFile,
  d,
  showSizes,
  sizes,
  rounded,
  hint,
  caption,
}: {
  label: string;
  value: string;
  onUrl: (v: string) => void;
  onFile: (f: File | undefined) => void;
  d: ReturnType<typeof useD>;
  showSizes?: boolean;
  /** Preview sizes in px (default 16 / 32 / 64). */
  sizes?: number[];
  /** Rounded preview, like an iOS home-screen icon. */
  rounded?: boolean;
  /** Requirements of this particular icon, shown right under the field. */
  hint?: string;
  /** Replaces the pixel size under the preview (one preview only). */
  caption?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isData = value.toLowerCase().startsWith("data:");
  const safe = sanitizeFaviconUrl(value);
  const invalid = !!value.trim() && !safe;
  return (
    <div>
      <div className={labelCls}>{label}</div>
      <div className="flex items-center gap-2">
        <input
          className={inputCls}
          value={isData ? `data:… (${Math.ceil(dataUrlBytes(value) / 1024)} KB)` : value}
          readOnly={isData}
          onChange={(e) => onUrl(e.target.value.trim())}
          placeholder="https://example.com/favicon.png"
          aria-invalid={invalid}
        />
        <input
          ref={fileRef}
          type="file"
          accept={FAVICON_ACCEPT}
          className="hidden"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className={btnCls} onClick={() => fileRef.current?.click()}>
          {d("tab.upload", "Upload image")}
        </button>
        {value ? (
          <button type="button" className={btnCls} onClick={() => onUrl("")}>
            {d("tab.remove", "Remove (use default)")}
          </button>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">{hint}</p> : null}
      {invalid ? (
        <p className="mt-1 text-[11.5px] text-[var(--danger,#f87171)]">
          {d("tab.errUrl", "Only http(s) URLs, paths starting with / and PNG/SVG/ICO/WebP/JPG data URLs are allowed.")}
        </p>
      ) : null}
      {safe && showSizes ? (
        <div className="mt-1.5 flex items-end gap-3">
          {(sizes ?? [16, 32, 64]).map((px) => (
            <div key={px} className="text-center text-[10px] text-[var(--fg-subtle)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={safe} alt="" width={px} height={px} style={{ width: px, height: px }} className={`mx-auto object-contain ${rounded ? "rounded-[22%]" : ""}`} />
              {caption ?? px}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

