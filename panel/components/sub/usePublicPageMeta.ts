"use client";

import { useEffect, useMemo } from "react";
import { resolvePageMeta, faviconMime, type PageMeta } from "@/lib/publicPageMeta";

type BrandingLike = Parameters<typeof resolvePageMeta>[0];

const ICON_RELS = ["icon", "shortcut icon", "apple-touch-icon", "apple-touch-icon-precomposed"];

function isIconLink(el: Element): boolean {
  const rel = (el.getAttribute("rel") || "").toLowerCase().split(/\s+/).join(" ");
  return ICON_RELS.includes(rel);
}

/**
 * Computes the browser-tab title / favicons of the public subscription page from the page config
 * and (only when `applyToDocument` is true) applies them to document.head, restoring on unmount.
 * The designer / admin previews pass nothing and therefore never touch the admin panel's own tab.
 */
export function usePublicPageMeta(
  branding: BrandingLike,
  opts: { lang?: string; username?: string; status?: string; fallbackTitle: string; applyToDocument?: boolean },
): PageMeta {
  const { lang, username, status, fallbackTitle, applyToDocument } = opts;
  const meta = useMemo(
    () => resolvePageMeta(branding, { lang, username, status, fallbackTitle }),
    [branding, lang, username, status, fallbackTitle],
  );
  const { title, faviconUrl, faviconDark, appleTouchIconUrl } = meta;

  useEffect(() => {
    if (!applyToDocument || typeof document === "undefined") return;
    const prevTitle = document.title;
    document.title = title;
    return () => {
      document.title = prevTitle;
    };
  }, [applyToDocument, title]);

  useEffect(() => {
    if (!applyToDocument || typeof document === "undefined") return;
    if (!faviconUrl && !faviconDark && !appleTouchIconUrl) return;
    const head = document.head;
    const existing = Array.from(head.querySelectorAll("link")).filter(isIconLink);
    const defaultIcon = existing.find((l) => /(^|\s)icon$/i.test(l.getAttribute("rel") || ""));
    const defaultHref = defaultIcon?.getAttribute("href") || "/favicon.ico";
    const created: HTMLLinkElement[] = [];
    const add = (rel: string, href: string, media?: string) => {
      const l = document.createElement("link");
      l.rel = rel;
      l.href = href;
      const type = rel === "apple-touch-icon" ? undefined : faviconMime(href);
      if (type) l.type = type;
      if (media) l.media = media;
      l.setAttribute("data-sharx-page-meta", "1");
      head.appendChild(l);
      created.push(l);
    };

    const replaceIcon = !!(faviconUrl || faviconDark);
    const removed: { el: Element; next: Node | null }[] = [];
    if (replaceIcon) {
      for (const el of existing) {
        const isApple = /apple-touch/i.test(el.getAttribute("rel") || "");
        if (isApple && !appleTouchIconUrl) continue;
        removed.push({ el, next: el.nextSibling });
        el.remove();
      }
      const light = faviconUrl || defaultHref;
      if (faviconDark) {
        add("icon", light, "(prefers-color-scheme: light)");
        add("icon", faviconDark, "(prefers-color-scheme: dark)");
      } else {
        add("icon", light);
        add("shortcut icon", light);
      }
    } else if (appleTouchIconUrl) {
      for (const el of existing) {
        if (/apple-touch/i.test(el.getAttribute("rel") || "")) {
          removed.push({ el, next: el.nextSibling });
          el.remove();
        }
      }
    }
    if (appleTouchIconUrl) add("apple-touch-icon", appleTouchIconUrl);

    return () => {
      for (const l of created) l.remove();
      for (const r of removed) {
        if (r.next && r.next.parentNode === head) head.insertBefore(r.el, r.next);
        else head.appendChild(r.el);
      }
    };
  }, [applyToDocument, faviconUrl, faviconDark, appleTouchIconUrl]);

  return meta;
}
