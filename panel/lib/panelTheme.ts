"use client";

import { useCallback, useEffect, useState } from "react";

const THEME_ATTR = "data-panel-theme";

/** SharX Web first — matches `PANEL_THEME_DEFAULT` and default SSR on `<html>`. */
export const PANEL_THEME_IDS = [
  "web",
  "default",
  "midnight",
  "ember",
  "boreal",
  /** SharX dark “Classic” palette (`--color-primary-100`, `--dark-color-*` in custom.min.css) */
  "xuiClassic",
  /** Deep space + gold / lightsaber accents */
  "starWars",
  /** Light frosted glass — Apple Vision / Liquid Glass */
  "vision",
  /** Light pastel pink/blue, bow motifs */
  "helloKitty",
  /** Dark glam pink/gold, sparkle FX */
  "barbie",
] as const;

export type PanelThemeId = (typeof PANEL_THEME_IDS)[number];

/** Fallback when DB value is missing/invalid. */
export const PANEL_THEME_DEFAULT: PanelThemeId = "web";

const META_THEME: Record<PanelThemeId, string> = {
  default: "#0d1117",
  midnight: "#0a1628",
  ember: "#140f0c",
  boreal: "#0a1412",
  /** SharX WEB marketing site — globals.css :root[data-theme="dark"] + system palette */
  web: "#05060a",
  xuiClassic: "#0a1222",
  starWars: "#030508",
  vision: "#f5f5f7",
  helloKitty: "#fff5f8",
  barbie: "#1a0a14",
};

function isPanelThemeId(s: string | null | undefined): s is PanelThemeId {
  return !!s && (PANEL_THEME_IDS as readonly string[]).includes(s);
}

export function parsePanelTheme(v: string | null | undefined): PanelThemeId {
  if (isPanelThemeId(v)) return v;
  return PANEL_THEME_DEFAULT;
}

function setMetaThemeColor(hex: string) {
  if (typeof document === "undefined") return;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", hex);
}

/**
 * Apply panel palette to `<html>`. `default` clears `data-panel-theme`
 * so :root base tokens from globals apply; `web` and others set the attribute.
 */
export function applyPanelTheme(id: PanelThemeId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", id === "vision" || id === "helloKitty" ? "light" : "dark");
  if (id === "default") {
    root.removeAttribute(THEME_ATTR);
  } else {
    root.setAttribute(THEME_ATTR, id);
  }
  setMetaThemeColor(META_THEME[id] ?? META_THEME.default);
  window.dispatchEvent(new CustomEvent("sharx-panel-theme"));
}

export function usePanelAccentColor(fallback: string = "#22d3ee"): string {
  const [accent, setAccent] = useState(fallback);

  const read = useCallback(() => {
    if (typeof document === "undefined") return;
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();
    if (v) setAccent(v);
  }, []);

  useEffect(() => {
    read();
    const el = document.documentElement;
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: [THEME_ATTR] });
    const onCustom = () => read();
    window.addEventListener("sharx-panel-theme", onCustom);
    return () => {
      obs.disconnect();
      window.removeEventListener("sharx-panel-theme", onCustom);
    };
  }, [read]);

  return accent;
}
