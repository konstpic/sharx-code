/** Default panel accent (CSS :root; static fallbacks). */
export const DEFAULT_PANEL_ACCENT = "#22d3ee";
export const DEFAULT_PANEL_SECONDARY = "#9775fa";

const META: Record<string, string> = {
  default: "#0d1117",
  midnight: "#0a1628",
  ember: "#140f0c",
  boreal: "#0a1412",
  web: "#05060a",
  xuiClassic: "#0a1222",
  starWars: "#030508",
  barbie: "#1a0a14",
};

/**
 * Early paint: deterministic dark mode + default panel palette.
 * Final user-selected theme is applied after API settings load.
 */
export const themeInitScript = `
(function() {
  try {
    var root = document.documentElement;
    var meta = ${JSON.stringify(META)};
    root.setAttribute("data-theme", "dark");
    var panelThemeId = "web";
    if (panelThemeId) {
      root.setAttribute("data-panel-theme", panelThemeId);
    } else {
      root.removeAttribute("data-panel-theme");
    }
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) {
      var colorKey = panelThemeId || "default";
      m.setAttribute("content", meta[colorKey] || meta["default"]);
    }
  } catch (e) {}
})();
`;
