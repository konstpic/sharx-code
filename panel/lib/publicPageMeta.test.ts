import { describe, expect, it } from "vitest";
import {
  appleIconFormatOk,
  appleIconPixelIssues,
  checkFaviconFile,
  dataUrlBytes,
  normalizeFaviconInput,
  faviconMime,
  normalizeDataUrlMime,
  pickByLocale,
  resolvePageMeta,
  resolveTitle,
  sanitizeFaviconUrl,
} from "./publicPageMeta";

describe("resolveTitle", () => {
  it("replaces placeholders and trims", () => {
    expect(resolveTitle("{title} - {username}", { title: "VPN", username: "bob" })).toBe("VPN - bob");
    expect(resolveTitle("{username} ({status})", { username: "", status: "" })).toBe("()");
    expect(resolveTitle("  {title}  ", { title: "X" })).toBe("X");
  });
  it("leaves unknown placeholders and is not evaluated", () => {
    expect(resolveTitle("{foo} ${1+1} {{title}}", { title: "T" })).toBe("{foo} ${1+1} {T}");
  });
});

describe("sanitizeFaviconUrl", () => {
  it("accepts http(s), same-origin paths and image data URLs", () => {
    expect(sanitizeFaviconUrl("https://a.com/i.png")).toBe("https://a.com/i.png");
    expect(sanitizeFaviconUrl("/icons/a.svg")).toBe("/icons/a.svg");
    expect(sanitizeFaviconUrl("data:image/png;base64,iVBORw0KGgo=")).toContain("data:image/png");
    expect(sanitizeFaviconUrl("data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E")).not.toBe("");
  });
  it("rejects dangerous or unsupported values", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,PGh0bWw+",
      "data:image/gif;base64,AAAA",
      "data:image/png,abc",
      "//evil.com/x.png",
      "/\\evil.com",
      "ftp://a.com/x.png",
      "vbscript:x",
      "https://a.com/a b.png",
      "",
      "   ",
      "relative/path.png",
    ]) {
      expect(sanitizeFaviconUrl(bad)).toBe("");
    }
    expect(sanitizeFaviconUrl(123)).toBe("");
  });
});

describe("faviconMime / data urls", () => {
  it("maps urls and data urls", () => {
    expect(faviconMime("https://a.com/x.PNG?v=1")).toBe("image/png");
    expect(faviconMime("/a.svg")).toBe("image/svg+xml");
    expect(faviconMime("/favicon.ico")).toBe("image/x-icon");
    expect(faviconMime("data:image/vnd.microsoft.icon;base64,AA")).toBe("image/x-icon");
    expect(faviconMime("data:image/webp;base64,AA")).toBe("image/webp");
    expect(faviconMime("https://a.com/icon")).toBeUndefined();
  });
  it("computes size and normalizes mime", () => {
    expect(dataUrlBytes("data:image/png;base64,QUJD")).toBe(3);
    expect(dataUrlBytes("data:image/png;base64,QUI=")).toBe(2);
    expect(normalizeDataUrlMime("data:application/octet-stream;base64,QUJD", "image/x-icon")).toBe(
      "data:image/x-icon;base64,QUJD",
    );
  });
});

describe("checkFaviconFile", () => {
  it("accepts allowed types within the limit", () => {
    expect(checkFaviconFile({ name: "a.png", type: "image/png", size: 100 })).toEqual({ ok: true, mime: "image/png" });
    expect(checkFaviconFile({ name: "a.ico", type: "", size: 100 })).toEqual({ ok: true, mime: "image/x-icon" });
    expect(checkFaviconFile({ name: "a.ico", type: "image/vnd.microsoft.icon", size: 1 })).toEqual({ ok: true, mime: "image/x-icon" });
  });
  it("rejects bad type, size and empty", () => {
    expect(checkFaviconFile({ name: "a.gif", type: "image/gif", size: 10 })).toEqual({ ok: false, reason: "type" });
    expect(checkFaviconFile({ name: "a.png", type: "text/html", size: 10 })).toEqual({ ok: false, reason: "type" });
    expect(checkFaviconFile({ name: "a.png", type: "image/png", size: 100 * 1024 + 1 })).toEqual({ ok: false, reason: "size" });
    expect(checkFaviconFile({ name: "a.png", type: "image/png", size: 0 })).toEqual({ ok: false, reason: "empty" });
  });
});

describe("pickByLocale / resolvePageMeta", () => {
  it("falls back from tag to base language", () => {
    expect(pickByLocale({ ru: "Привет" }, "ru-RU")).toBe("Привет");
    expect(pickByLocale({ "ru-RU": "A", ru: "B" }, "ru-RU")).toBe("A");
    expect(pickByLocale({ en: "x" }, "de")).toBe("");
    expect(pickByLocale(undefined, "de")).toBe("");
  });
  it("defaults to branding.title / fallback", () => {
    expect(resolvePageMeta({ title: "VPN" }, { fallbackTitle: "Subscription" }).title).toBe("VPN");
    expect(resolvePageMeta({ title: "" }, { fallbackTitle: "Subscription" }).title).toBe("Subscription");
    expect(resolvePageMeta(null, { fallbackTitle: "S" })).toMatchObject({ title: "S", faviconUrl: "" });
  });
  it("applies template, locale override and sanitizes icons", () => {
    const m = resolvePageMeta(
      {
        title: "VPN",
        pageTitle: "{title} · {username}",
        pageTitleByLocale: { ru: "{username} - мой VPN" },
        faviconUrl: "javascript:1",
        faviconDark: "/d.png",
      },
      { lang: "ru", username: "bob", fallbackTitle: "S" },
    );
    expect(m.title).toBe("bob - мой VPN");
    expect(m.faviconUrl).toBe("");
    expect(m.faviconDark).toBe("/d.png");
    expect(resolvePageMeta({ title: "VPN", pageTitle: "{title} · {username}" }, { lang: "en", username: "bob", fallbackTitle: "S" }).title).toBe("VPN · bob");
  });
});

describe("normalizeFaviconInput (svg)", () => {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><rect width='8' height='8' fill='red'/></svg>";
  const enc = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  it("normalizes raw / utf8 / charset / percent-encoded forms", () => {
    for (const raw of [
      "data:image/svg+xml;utf8," + svg,
      "data:image/svg+xml;charset=utf-8," + svg,
      "data:image/svg+xml," + svg,
      "data:image/svg+xml;utf8," + encodeURIComponent(svg),
      enc,
    ]) {
      expect(normalizeFaviconInput(raw)).toEqual({ ok: true, value: enc });
    }
    expect(normalizeFaviconInput(enc)).toEqual({ ok: true, value: enc });
    expect(normalizeFaviconInput("data:image/svg+xml;base64," + btoa(svg)).ok).toBe(true);
  });
  it("gives specific reasons", () => {
    const r = (x: string) => {
      const o = normalizeFaviconInput("data:image/svg+xml;utf8," + x);
      return o.ok ? "ok" : o.reason;
    };
    expect(r("<div></div>")).toBe("svgStart");
    expect(r("<svg><script>alert(1)</script></svg>")).toBe("svgScript");
    expect(r("<svg><foreignObject/></svg>")).toBe("svgForeign");
    expect(r("<svg onload='x()'></svg>")).toBe("svgEvent");
    expect(r("<svg><image href='https://e.com/a.png'/></svg>")).toBe("svgExternal");
    expect(r("<svg><use xlink:href=\"http://e.com/a.svg#a\"/></svg>")).toBe("svgExternal");
    expect(r("%E0%A4%A")).toBe("decode");
    expect(r("<svg>" + "a".repeat(101 * 1024) + "</svg>")).toBe("size");
    expect(normalizeFaviconInput("data:image/svg+xml;foo=1," + svg)).toEqual({ ok: false, reason: "mime" });
    expect(normalizeFaviconInput("data:image/svg+xml;base64," + btoa("<svg><script/></svg>"))).toEqual({ ok: false, reason: "svgScript" });
  });
});

describe("apple home-screen icon", () => {
  it("accepts PNG / JPEG and unknown extensions, refuses what iOS ignores", () => {
    expect(appleIconFormatOk("")).toBe(true);
    expect(appleIconFormatOk("data:image/png;base64,AAAA")).toBe(true);
    expect(appleIconFormatOk("https://a.test/touch.png?v=2")).toBe(true);
    expect(appleIconFormatOk("https://a.test/touch")).toBe(true);
    expect(appleIconFormatOk("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E")).toBe(false);
    expect(appleIconFormatOk("/touch.ico")).toBe(false);
    expect(appleIconFormatOk("https://a.test/touch.webp")).toBe(false);
  });
  it("reports non-square, small and transparent icons", () => {
    expect(appleIconPixelIssues(180, 180, false)).toEqual([]);
    expect(appleIconPixelIssues(512, 512, false)).toEqual([]);
    expect(appleIconPixelIssues(64, 64, true)).toEqual(["size", "alpha"]);
    expect(appleIconPixelIssues(200, 180, false)).toEqual(["square"]);
  });
});
