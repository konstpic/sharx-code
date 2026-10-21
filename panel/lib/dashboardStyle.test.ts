import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  EMPTY_FRAME_CSS,
  FRAME_PRESETS,
  MY_STYLES_LIMIT,
  STYLE_ICONS,
  STYLE_PRESETS,
  addMyStyle,
  applyAppearance,
  applyAppearanceToTiles,
  countUpValue,
  formatStyledNumber,
  frameStyle,
  isDefaultStyle,
  lastDelta,
  mergeStyle,
  normalizeStyle,
  parseMyStyles,
  parseStyleClip,
  patchStyle,
  pickStyle,
  resetAppearance,
  resolveAccent,
  resolveStyle,
  safeLinkUrl,
  shiftHue,
  styledValueText,
  valueTone,
  type TileStyle,
} from "./dashboardStyle";
import { parseLayout, defaultLayout, type DashboardLayout } from "./dashboardBuilder";
import { sanitizeTile } from "./dashboardModel";

const base = { width: 3, height: 4, view: "default", title: "" };

describe("normalizeStyle", () => {
  it("turns garbage into the default look", () => {
    for (const g of [null, undefined, 5, "x", [], [1], true, {}, { foo: 1 }, { radius: "big" }, { bg: 7 }, { border: [] }]) expect(normalizeStyle(g)).toBeUndefined();
  });
  it("drops invalid fields, keeps valid ones", () => {
    const s = normalizeStyle({ radius: 8, shadow: "huge", accent: "red", hue: "x", border: { width: "thick", style: "dashed" }, evil: 1 });
    expect(s).toEqual({ radius: 8, border: { style: "dashed" } });
  });
  it("clamps numbers to their ranges", () => {
    const s = normalizeStyle({ blur: 99, radius: -5, valueScale: 1000, labelScale: 1, valueWeight: 100, hue: 999, bg: { mode: "solid", angle: 720, opacity: -4 }, spark: { window: 5000, strokeWidth: 9 }, gauge: { thickness: 1 }, barHeight: 100 });
    expect(s).toMatchObject({ blur: 24, radius: 0, valueScale: 300, labelScale: 60, valueWeight: 400, hue: 180, bg: { mode: "solid", angle: 360, opacity: 0 }, spark: { strokeWidth: 4 }, gauge: { thickness: 4 }, barHeight: 40 });
    expect(s?.spark?.window).toBeUndefined(); // 300 is the default
  });
  it("rejects non-finite numbers and bad colours", () => {
    expect(normalizeStyle({ blur: NaN, radius: Infinity, accent: "#12345", valueColor: "#GGGGGG" })).toBeUndefined();
  });
  it("accepts colour tokens only where they make sense", () => {
    expect(normalizeStyle({ bg: { mode: "solid", color: "accent" }, border: { color: "fg" } })).toEqual({ bg: { mode: "solid", color: "accent" }, border: { color: "fg" } });
    expect(normalizeStyle({ accent: "accent", valueColor: "fg" })).toBeUndefined();
  });
  it("limits free text and strips control characters", () => {
    const s = normalizeStyle({ prefix: "x".repeat(50), emptyText: "a\u0000b\n", unit: " GB" });
    expect(s?.prefix).toHaveLength(8);
    expect(s?.emptyText).toBe("ab");
    expect(s?.unit).toBe(" GB");
  });
  it("validates the icon against the curated list", () => {
    expect(normalizeStyle({ icon: "cpu" })).toEqual({ icon: "cpu" });
    expect(normalizeStyle({ icon: "evil-icon" })).toBeUndefined();
    expect(STYLE_ICONS.length).toBeGreaterThanOrEqual(36);
  });
  it("only stores links that are same-origin paths or http(s)", () => {
    expect(normalizeStyle({ url: "/panel/nodes" })).toEqual({ url: "/panel/nodes" });
    expect(normalizeStyle({ url: "https://example.com/a" })).toEqual({ url: "https://example.com/a" });
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.com", "ftp://x", "/a b", "/\\evil"]) expect(normalizeStyle({ url: bad })).toBeUndefined();
    expect(safeLinkUrl("  /ok  ")).toBe("/ok");
  });
  it("is idempotent", () => {
    const once = normalizeStyle({ preset: "glass", radius: 4, blur: 3, spark: { curve: "step" } });
    expect(normalizeStyle(once)).toEqual(once);
  });
});

describe("serialization keeps only non-default fields", () => {
  it("drops values equal to the default", () => {
    expect(normalizeStyle({ radius: DEFAULT_STYLE.radius, blur: 0, border: { show: true, width: 1, style: "solid", color: "", opacity: 100 }, colorMode: "thresholds", valueScale: 100, spark: { show: true, fill: true } })).toBeUndefined();
  });
  it("sanitizeTile stores no style for a default style and a compact one otherwise", () => {
    expect(sanitizeTile({ ...base, style: { radius: 16 } }, base)).not.toHaveProperty("style");
    expect(sanitizeTile({ ...base, style: { radius: 16, blur: 6 } }, base).style).toEqual({ blur: 6 });
    expect(JSON.stringify(sanitizeTile({ ...base }, base))).not.toContain("style");
  });
  it("keeps a field that deliberately undoes the preset", () => {
    expect(normalizeStyle({ preset: "glass", blur: 0 })).toEqual({ preset: "glass", blur: 0 });
    expect(normalizeStyle({ preset: "glass", blur: 14 })).toEqual({ preset: "glass" });
    expect(normalizeStyle({ preset: "neon", accentGlow: false })).toEqual({ preset: "neon", accentGlow: false });
  });
});

describe("resolveStyle / presets", () => {
  it("default style equals the documented defaults", () => {
    expect(resolveStyle(undefined)).toEqual(DEFAULT_STYLE);
    expect(resolveStyle({})).toEqual(DEFAULT_STYLE);
    expect(DEFAULT_STYLE.colorMode).toBe("thresholds"); // = today's level colouring
    expect(DEFAULT_STYLE.valueWeight).toBe(600); // = font-semibold
  });
  it("precedence: defaults < preset < explicit fields", () => {
    const r = resolveStyle({ preset: "glass", blur: 4, border: { width: 3 } });
    expect(r.blur).toBe(4); // explicit beats the preset (14)
    expect(r.radius).toBe(STYLE_PRESETS.glass.radius); // preset beats the default
    expect(r.border.width).toBe(3);
    expect(r.border.opacity).toBe(STYLE_PRESETS.glass.border?.opacity); // sibling from the preset survives the explicit sibling
    expect(r.shadow).toBe("md");
    expect(r.padding).toBe(DEFAULT_STYLE.padding); // untouched by both
  });
  it("every preset is valid data and survives normalization", () => {
    for (const p of FRAME_PRESETS) {
      if (p === "default") continue;
      const def = STYLE_PRESETS[p];
      expect(normalizeStyle({ ...def })).toBeTruthy();
      expect(normalizeStyle({ ...def, preset: p })).toEqual({ preset: p });
      expect(frameStyle({ preset: p }).tokens).not.toBe("");
    }
    expect(Object.keys(STYLE_PRESETS)).toHaveLength(8);
  });
  it("mergeStyle / patchStyle", () => {
    expect(mergeStyle({ blur: 3 }, { radius: 4 })).toEqual({ blur: 3, radius: 4 });
    expect(mergeStyle({ border: { width: 3 } }, { border: { style: "dotted" } })).toEqual({ border: { width: 3, style: "dotted" } });
    expect(patchStyle({ blur: 3, radius: 4 }, { blur: undefined })).toEqual({ radius: 4 });
    expect(patchStyle(undefined, { bg: { mode: "solid" } })).toEqual({ bg: { mode: "solid" } });
    expect(patchStyle({ radius: 4 }, { radius: undefined })).toBeUndefined();
  });
});

describe("frame CSS", () => {
  it("a default style adds nothing to the tile (existing boards stay pixel-identical)", () => {
    expect(frameStyle(undefined)).toBe(EMPTY_FRAME_CSS);
    expect(frameStyle({})).toBe(EMPTY_FRAME_CSS);
    expect(frameStyle({ radius: 16, blur: 0, shadow: "default", padding: "normal", border: { show: true, width: 1 }, colorMode: "thresholds", valueScale: 100 })).toBe(EMPTY_FRAME_CSS);
    expect(frameStyle(undefined).vars).toEqual({});
    expect(frameStyle(undefined).tokens).toBe("");
    expect(isDefaultStyle({ radius: 16 })).toBe(true);
  });
  it("emits only what changed", () => {
    const f = frameStyle({ radius: 8, blur: 10 });
    expect(f.vars).toEqual({ "--tile-radius": "8px", "--tile-blur": "10px" });
    expect(f.tokens.split(" ").sort()).toEqual(["blur", "radius"]);
  });
  it("background modes", () => {
    expect(frameStyle({ bg: { mode: "transparent" } }).vars["--tile-bg"]).toBe("transparent");
    expect(frameStyle({ bg: { mode: "solid", color: "#112233" } }).vars["--tile-bg"]).toBe("#112233");
    expect(frameStyle({ bg: { mode: "solid", color: "#112233", opacity: 40 } }).vars["--tile-bg"]).toContain("40%");
    expect(frameStyle({ bg: { mode: "gradient", color: "#112233", color2: "#445566", angle: 90 } }).vars["--tile-bg"]).toBe("linear-gradient(90deg, #112233, #445566)");
  });
  it("border, shadow, glow, padding, label options", () => {
    const f = frameStyle({ border: { show: false }, shadow: "lg", accentGlow: true, padding: "roomy", labelColor: "#ffffff", labelScale: 150, uppercaseLabel: true, labelPos: "bottom" });
    expect(f.vars["--tile-border-w"]).toBe("0px");
    expect(f.vars["--tile-shadow"]).toContain("rgba");
    expect(f.vars["--tile-glow"]).toBeTruthy();
    expect(f.vars["--tile-pad-k"]).toBe("1.5");
    expect(f.vars["--tile-label-color"]).toBe("#ffffff");
    expect(f.vars["--tile-label-scale"]).toBe("1.5");
    expect(f.tokens).toContain("upper");
    expect(f.attrs["data-label-pos"]).toBe("bottom");
  });
  it("accent: explicit colour is shifted in JS, a hue alone is applied by CSS on the theme accent", () => {
    expect(frameStyle({ accent: "#ff0000", hue: 120 }, undefined).vars["--accent"]).toBe("#00ff00");
    expect(frameStyle({ hue: 40 }).vars).toMatchObject({ "--tile-hue": "40" });
    expect(frameStyle({ hue: 40 }).vars["--accent"]).toBeUndefined();
    expect(frameStyle({ blur: 3 }, "#ff0000").vars["--accent"]).toBeUndefined(); // the legacy tile colour alone changes nothing
    expect(frameStyle({ hue: 120 }, "#ff0000").vars["--accent"]).toBe("#00ff00");
  });
});

describe("hue shift math", () => {
  it("rotates the primary colours", () => {
    expect(shiftHue("#ff0000", 120)).toBe("#00ff00");
    expect(shiftHue("#ff0000", 240)).toBe("#0000ff");
    expect(shiftHue("#00ff00", -120)).toBe("#ff0000");
    expect(shiftHue("#ff0000", 180)).toBe("#00ffff");
  });
  it("is the identity for 0 / 360 and for greys, keeps invalid input", () => {
    expect(shiftHue("#38bdf8", 0)).toBe("#38bdf8");
    expect(shiftHue("#38bdf8", 360)).toBe("#38bdf8");
    expect(shiftHue("#808080", 77)).toBe("#808080");
    expect(shiftHue("nope", 10)).toBe("nope");
    expect(shiftHue("#ff0000", NaN)).toBe("#ff0000");
  });
  it("round trips and preserves lightness roughly", () => {
    const c = "#38bdf8";
    expect(shiftHue(shiftHue(c, 75), -75)).toBe(c);
    expect(resolveAccent({ hue: 90 }, "#ff0000")).toBe(shiftHue("#ff0000", 90));
    expect(resolveAccent({ accent: "#00ff00" }, "#ff0000")).toBe("#00ff00");
    expect(resolveAccent({ hue: 90 }, undefined)).toBeUndefined();
  });
});

describe("value tone / colour mode", () => {
  const r = resolveStyle({});
  it("thresholds (default) = today's behaviour", () => {
    expect(valueTone(r, "#38bdf8", "crit", 0.9)).toBe("#ef4444");
    expect(valueTone(r, "#38bdf8", "warn", 0.5)).toBe("#f59e0b");
    expect(valueTone(r, "#38bdf8", "ok", 0.1)).toBe("#38bdf8");
    expect(valueTone(r, "#38bdf8", null, 0.1, "auto-colour")).toBe("auto-colour");
  });
  it("fixed ignores the level; custom level colours are honoured", () => {
    expect(valueTone(resolveStyle({ colorMode: "fixed" }), "#38bdf8", "crit", 1)).toBe("#38bdf8");
    expect(valueTone(resolveStyle({ levelColors: { crit: "#111111", ok: "#222222" } }), "#38bdf8", "crit", 1)).toBe("#111111");
    expect(valueTone(resolveStyle({ levelColors: { ok: "#222222" } }), "#38bdf8", "ok", 0)).toBe("#222222");
  });
  it("gradient-by-value interpolates ok -> warn -> crit", () => {
    const g = resolveStyle({ colorMode: "gradient-by-value" });
    expect(valueTone(g, "#38bdf8", null, 0)).toBe("#38bdf8");
    expect(valueTone(g, "#38bdf8", null, 0.5)).toContain("#f59e0b 100%");
    expect(valueTone(g, "#38bdf8", null, 1)).toBe("#ef4444");
    expect(valueTone(g, "#38bdf8", null, 0.75)).toContain("#ef4444 50%");
    expect(valueTone(g, "#38bdf8", null, NaN)).toBe("#38bdf8");
  });
});

describe("number formatting", () => {
  it("decimals and prefix / suffix", () => {
    expect(formatStyledNumber(12.3456, { decimals: 2 }, "en-US")).toBe("12.35");
    expect(formatStyledNumber(12, { decimals: 0, prefix: "~", suffix: " req" }, "en-US")).toBe("~12 req");
    expect(formatStyledNumber(-3.2, { decimals: 1 }, "en-US")).toBe("-3.2");
  });
  it("abbreviates k / M / G / T", () => {
    expect(formatStyledNumber(999, { abbreviate: true, decimals: 1 }, "en-US")).toBe("999");
    expect(formatStyledNumber(1500, { abbreviate: true, decimals: 1 }, "en-US")).toBe("1.5k");
    expect(formatStyledNumber(2_400_000, { abbreviate: true, decimals: 1 }, "en-US")).toBe("2.4M");
    expect(formatStyledNumber(7e9, { abbreviate: true, decimals: 0 }, "en-US")).toBe("7G");
    expect(formatStyledNumber(3e12, { abbreviate: true, decimals: 0 }, "en-US")).toBe("3T");
    expect(formatStyledNumber(-2500, { abbreviate: true, decimals: 1 }, "en-US")).toBe("-2.5k");
  });
  it("thousands separators are forced, whatever the locale", () => {
    expect(formatStyledNumber(1234567.5, { decimals: 1, thousands: "space" }, "en-US")).toBe("1 234 567.5");
    expect(formatStyledNumber(1234567.5, { decimals: 1, thousands: "comma" }, "de-DE")).toBe("1,234,567,5"); // the locale decimal comma is kept
    expect(formatStyledNumber(1234567, { decimals: 0, thousands: "none" }, "en-US")).toBe("1234567");
    expect(formatStyledNumber(1234, { decimals: 0 }, "en-US")).toBe("1,234");
    expect(formatStyledNumber(999, { decimals: 0, thousands: "space" }, "en-US")).toBe("999");
  });
  it("non-finite numbers render a dash", () => {
    expect(formatStyledNumber(NaN)).toBe("—");
    expect(formatStyledNumber(Infinity)).toBe("—");
  });
  it("styledValueText: plain units are reformatted, special units only wrapped", () => {
    const r = resolveStyle({ abbreviate: true, prefix: "≈", suffix: "!" });
    expect(styledValueText({ value: 12500, unit: "count" }, "12,500", r, 1, "en-US")).toBe("≈12.5k!");
    expect(styledValueText({ value: 55, unit: "percent" }, "55%", resolveStyle({ unit: " pct" }), 1, "en-US")).toBe("55 pct");
    expect(styledValueText({ value: 55, unit: "percent" }, "55%", resolveStyle({ abbreviate: true }), 1, "en-US")).toBe("55%");
    expect(styledValueText({ value: 1024, unit: "bytes" }, "1 KB", resolveStyle({ prefix: "[", suffix: "]", abbreviate: true }), 1)).toBe("[1 KB]");
    expect(styledValueText({ value: 7, unit: "count" }, "7", resolveStyle({}), 1)).toBe("7");
  });
  it("empty text and hide-when-zero", () => {
    expect(styledValueText({ value: null, unit: "count" }, "—", resolveStyle({ emptyText: "n/a" }), 1)).toBe("n/a");
    expect(styledValueText({ value: null, unit: "count" }, "—", resolveStyle({}), 1)).toBe("—");
    expect(styledValueText({ value: 0, unit: "count" }, "0", resolveStyle({ hideWhenZero: true }), 1)).toBe("");
    expect(styledValueText({ value: 0, unit: "count" }, "0", resolveStyle({ hideWhenZero: true, emptyText: "none" }), 1)).toBe("none");
    expect(styledValueText({ value: 0, unit: "count" }, "0", resolveStyle({}), 1)).toBe("0");
  });
  it("count-up and delta helpers", () => {
    expect(countUpValue(0, 100, 0)).toBe(0);
    expect(countUpValue(0, 100, 1)).toBe(100);
    expect(countUpValue(0, 100, 0.5)).toBeGreaterThan(50);
    expect(countUpValue(10, 20, 9)).toBe(20);
    expect(lastDelta([{ value: 1 }, { value: 4 }])).toBe(3);
    expect(lastDelta([{ value: 1 }])).toBeNull();
    expect(lastDelta(undefined)).toBeNull();
    expect(lastDelta([{ value: NaN }, { value: 2 }])).toBeNull();
  });
});

describe("copy / paste / apply to all", () => {
  const src: TileStyle = { preset: "neon", accent: "#ff0000", hue: 20, valueScale: 150, labelPos: "bottom", spark: { curve: "step" }, prefix: "$", onClick: "link", url: "/x", countUp: true };
  it("pickStyle copies appearance only", () => {
    const p = pickStyle(src);
    expect(p).toMatchObject({ preset: "neon", accent: "#ff0000", hue: 20, valueScale: 150, labelPos: "bottom" });
    expect(p).not.toHaveProperty("spark");
    expect(p).not.toHaveProperty("prefix");
    expect(p).not.toHaveProperty("onClick");
    expect(pickStyle(undefined)).toBeUndefined();
  });
  it("applyAppearance replaces appearance, keeps the tile's data options, syncs the legacy colour", () => {
    const tile = { color: "#00ff00", style: { preset: "glass" as const, blur: 3, prefix: "~", spark: { show: false }, hue: 90 } };
    const out = applyAppearance(tile, src);
    expect(out.color).toBe("#ff0000");
    expect(out.style?.preset).toBe("neon");
    expect(out.style?.blur).toBeUndefined(); // old frame field is gone
    expect(out.style?.prefix).toBe("~"); // data option stays
    expect(out.style?.spark).toEqual({ show: false });
    expect(out.style?.hue).toBe(20);
    expect(tile.style.blur).toBe(3); // input untouched
  });
  it("pasting a default style clears the appearance", () => {
    const out = applyAppearance({ style: { blur: 4, countUp: true } }, undefined);
    expect(out.style).toEqual({ countUp: true });
    expect(applyAppearance({ style: { blur: 4 } }, undefined)).not.toHaveProperty("style");
  });
  it("applyAppearanceToTiles: all tiles, or only the selected", () => {
    const tiles: Record<string, { style?: TileStyle; color?: string }> = { a: { style: { blur: 2 } }, b: {}, c: { color: "#111111" } };
    const all = applyAppearanceToTiles(tiles, { preset: "flat" });
    expect(Object.values(all).every((t) => t.style?.preset === "flat")).toBe(true);
    const some = applyAppearanceToTiles(tiles, { preset: "flat" }, ["b", "nope"]);
    expect(some.a).toBe(tiles.a);
    expect(some.b.style?.preset).toBe("flat");
    expect(Object.keys(some)).toEqual(["a", "b", "c"]);
  });
  it("resetAppearance drops the whole style", () => {
    expect(resetAppearance({ color: "#fff000", style: { blur: 3 } })).toEqual({ color: "#fff000" });
  });
  it("clipboard parsing is safe", () => {
    expect(parseStyleClip(null)).toBeUndefined();
    expect(parseStyleClip("{bad json")).toBeUndefined();
    expect(parseStyleClip(JSON.stringify({ radius: 99, x: 1 }))).toEqual({ radius: 32 });
  });
});

describe("my styles", () => {
  it("adds, replaces by name and stops at the limit", () => {
    let list = addMyStyle([], "  Night ", { preset: "neon", prefix: "$" }, "s1");
    expect(list).toEqual([{ id: "s1", name: "Night", style: { preset: "neon" } }]); // data options are not part of a saved style
    list = addMyStyle(list, "Night", { preset: "glass" }, "s2");
    expect(list).toHaveLength(1);
    expect(list[0].style.preset).toBe("glass");
    expect(addMyStyle(list, "", { preset: "glass" }, "x")).toHaveLength(1);
    expect(addMyStyle(list, "Empty", undefined, "x")).toHaveLength(1);
    for (let i = 0; i < 40; i++) list = addMyStyle(list, "n" + i, { radius: i % 30 }, "id" + i);
    expect(list).toHaveLength(MY_STYLES_LIMIT);
  });
  it("parseMyStyles validates, dedupes ids, limits", () => {
    const raw = [
      { id: "a", name: "A", style: { blur: 5 } },
      { id: "a", name: "dup", style: { blur: 6 } },
      { id: "b", name: "", style: { blur: 5 } },
      { id: "c", name: "C", style: {} },
      { id: 4, name: "D", style: { blur: 5 } },
      null,
      ...Array.from({ length: 60 }, (_, i) => ({ id: "x" + i, name: "n", style: { radius: 5 } })),
    ];
    const out = parseMyStyles(raw);
    expect(out).toHaveLength(MY_STYLES_LIMIT);
    expect(out[0]).toEqual({ id: "a", name: "A", style: { blur: 5 } });
    expect(out[1]).toEqual({ id: "b", name: "Style", style: { blur: 5 } });
    expect(parseMyStyles("x")).toEqual([]);
  });
});

describe("parseLayout round trip", () => {
  const raw = (tiles: Record<string, unknown>) =>
    JSON.stringify({ version: 1, order: ["custom-a"], gridVersion: 4, tiles, panels: [{ id: "custom-a", title: "A", kind: "metric", metrics: ["cpu"], code: "", url: "", text: "" }], grid: [{ id: "custom-a", x: 0, y: 0, w: 3, h: 4 }] });
  it("old layouts (no style) parse without a style and re-serialize without one", () => {
    const l = parseLayout(JSON.stringify(defaultLayout()));
    for (const t of Object.values(l.tiles)) expect(t).not.toHaveProperty("style");
    expect(JSON.stringify(l)).not.toContain('"style"');
    const again = parseLayout(JSON.stringify(l));
    expect(again.tiles).toEqual(l.tiles);
  });
  it("keeps a valid style, repairs a broken one", () => {
    const ok = parseLayout(raw({ "custom-a": { width: 3, height: 4, view: "stat", title: "", style: { preset: "glass", radius: 99, evil: 1, spark: { curve: "step" } } } }));
    expect(ok.tiles["custom-a"].style).toEqual({ preset: "glass", radius: 32, spark: { curve: "step" } });
    const bad = parseLayout(raw({ "custom-a": { width: 3, height: 4, view: "stat", title: "", style: "garbage" } }));
    expect(bad.tiles["custom-a"]).not.toHaveProperty("style");
    const again = parseLayout(JSON.stringify(ok) as string);
    expect((again as DashboardLayout).tiles["custom-a"].style).toEqual(ok.tiles["custom-a"].style);
  });
});
