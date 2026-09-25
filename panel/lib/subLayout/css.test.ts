import { describe, expect, it } from "vitest";
import { ROOT_PARENT, filterToCss, responsiveCss, safeCssValue, safeImageUrl, shadowsToCss, styleToCss } from "./css";
import { insertNode, newDoc, newNode } from "./tree";
import { MOBILE_BREAKPOINT } from "./types";

describe("safeCssValue", () => {
  it("passes plain values and trims", () => {
    expect(safeCssValue("  #fff ")).toBe("#fff");
    expect(safeCssValue("var(--sub-accent, #22d3ee)")).toBe("var(--sub-accent, #22d3ee)");
  });
  it("rejects injection vectors and oversized values", () => {
    for (const bad of ["red; color:blue", "a}b", "url(http://x)", "expression(alert(1))", "@import 'x'", "javascript:x", "<b>", "a\\b", "-moz-binding:x"]) {
      expect(safeCssValue(bad)).toBe("");
    }
    expect(safeCssValue("")).toBe("");
    expect(safeCssValue("a".repeat(301))).toBe("");
  });
});

describe("safeImageUrl", () => {
  it("allows http(s), data:image base64 and root-relative paths", () => {
    expect(safeImageUrl("https://x.io/a.png")).toBe("https://x.io/a.png");
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safeImageUrl("/img/a.png")).toBe("/img/a.png");
  });
  it("rejects everything else", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,AAAA", 'https://x.io/a".png', "https://x.io/a b", "ftp://x", "img.png", "https://x.io/(a)"]) {
      expect(safeImageUrl(bad)).toBe("");
    }
  });
});

describe("styleToCss", () => {
  it("builds a flex stack with gap and padding", () => {
    const css = styleToCss({ mode: "stack", dir: "row", gap: 8, pad: [1, 2], align: "center" }, "frame", ROOT_PARENT);
    expect(css).toMatchObject({ display: "flex", flexDirection: "row", gap: "8px", padding: "1px 2px", alignItems: "center" });
  });
  it("builds a grid", () => {
    expect(styleToCss({ mode: "grid", cols: 3 }, "frame", ROOT_PARENT).gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(styleToCss({ mode: "grid", colMin: 150 }, "frame", ROOT_PARENT).gridTemplateColumns).toContain("minmax(150px, 1fr)");
  });
  it("fill width depends on the parent direction", () => {
    expect(styleToCss({ w: "fill" }, "frame", { mode: "stack", dir: "row" })).toMatchObject({ flexGrow: 1, flexBasis: 0 });
    expect(styleToCss({ w: "fill" }, "frame", { mode: "stack", dir: "column" }).alignSelf).toBe("stretch");
    expect(styleToCss({ w: "fill" }, "frame", { mode: "grid", dir: "row" }).width).toBe("100%");
  });
  it("positions children of a free parent absolutely", () => {
    expect(styleToCss({ x: 5, y: 7 }, "text", { mode: "free", dir: "column" })).toMatchObject({ position: "absolute", left: "5px", top: "7px" });
  });
  it("drops unsafe colours, backgrounds and shadows", () => {
    const css = styleToCss({ color: "red;x", bg: "url(x)", shadow: "0 0 1px };", bgImage: "javascript:x" }, "frame", ROOT_PARENT);
    expect(css.color).toBeUndefined();
    expect(css.background).toBeUndefined();
    expect(css.boxShadow).toBeUndefined();
    expect(css.backgroundImage).toBeUndefined();
  });
  it("layers a safe background image over the colour", () => {
    const css = styleToCss({ bg: "#000", bgImage: "https://x.io/a.png" }, "frame", ROOT_PARENT);
    expect(css.backgroundImage).toBe('url("https://x.io/a.png"), #000');
    expect(css.background).toBeUndefined();
  });
  it("clamps opacity and handles truncate", () => {
    expect(styleToCss({ opacity: 3 }, "text", ROOT_PARENT).opacity).toBe(1);
    expect(styleToCss({ truncate: true }, "text", ROOT_PARENT)).toMatchObject({ whiteSpace: "nowrap", textOverflow: "ellipsis" });
  });
});

describe("responsiveCss", () => {
  it("is empty without mobile overrides or hide flags", () => {
    const d = newDoc();
    expect(responsiveCss(d, new Map([[d.root, null]]))).toBe("");
  });
  it("emits a container query with only the changed declarations", () => {
    let d = newDoc({ style: { mode: "stack", dir: "column" } });
    const n = newNode("frame", { style: { mode: "stack", pad: 32, gap: 8 }, mobile: { pad: 16 } });
    d = insertNode(d, d.root, 0, n);
    const parents = new Map<string, ReturnType<typeof newNode> | null>([[d.root, null], [n.id, d.nodes[d.root]]]);
    const css = responsiveCss(d, parents);
    expect(css).toContain(`@container sublyt (max-width: ${MOBILE_BREAKPOINT}px)`);
    expect(css).toContain("padding:16px !important");
    expect(css).not.toContain("gap");
  });
  it("hides on mobile and desktop", () => {
    let d = newDoc();
    const a = newNode("text", { hideOn: { mobile: true } });
    const b = newNode("text", { hideOn: { desktop: true } });
    d = insertNode(insertNode(d, d.root, 0, a), d.root, 1, b);
    const css = responsiveCss(d, new Map());
    expect(css).toContain(`max-width: ${MOBILE_BREAKPOINT}px`);
    expect(css).toContain(`min-width: ${MOBILE_BREAKPOINT + 1}px`);
    expect(css.match(/display:none !important/g)).toHaveLength(2);
  });
});

describe("extended style properties", () => {
  it("builds a shadow list with inset and sanitized colors", () => {
    expect(shadowsToCss([{ x: 1, y: 2, blur: 3, spread: 4, color: "#000" }, { x: 0, y: 0, blur: 8, color: "red;x", inset: true }])).toBe("1px 2px 3px 4px #000, inset 0px 0px 8px 0px rgba(0,0,0,.35)");
    expect(styleToCss({ shadows: [{ x: 0, y: 4, blur: 10, color: "#111" }], shadow: "0 0 1px red" }, "frame", ROOT_PARENT).boxShadow).toBe("0px 4px 10px 0px #111");
    expect(shadowsToCss(undefined)).toBe("");
  });
  it("builds filters and skips neutral values", () => {
    expect(filterToCss({ blur: 4, brightness: 100, contrast: 120, hue: 30, grayscale: 0 })).toBe("blur(4px) contrast(120%) hue-rotate(30deg)");
    expect(styleToCss({ filter: { saturate: 150 } }, "text", ROOT_PARENT).filter).toBe("saturate(150%)");
    expect(styleToCss({ filter: {} }, "text", ROOT_PARENT).filter).toBeUndefined();
  });
  it("blend mode, pointer events and visibility", () => {
    const css = styleToCss({ blend: "multiply", pointer: "none", visibility: "hidden" }, "text", ROOT_PARENT);
    expect(css).toMatchObject({ mixBlendMode: "multiply", pointerEvents: "none", visibility: "hidden" });
    expect(styleToCss({ blend: "normal" }, "text", ROOT_PARENT).mixBlendMode).toBeUndefined();
    expect(styleToCss({ blend: "evil" as never }, "text", ROOT_PARENT).mixBlendMode).toBeUndefined();
  });
  it("z-index applies outside free frames too", () => {
    expect(styleToCss({ z: 3 }, "text", ROOT_PARENT).zIndex).toBe(3);
  });
  it("background image fit, position and repeat", () => {
    const css = styleToCss({ bgImage: "https://x.io/a.png", bgSize: "contain", bgPos: "top left", bgRepeat: "repeat-x" }, "frame", ROOT_PARENT);
    expect(css).toMatchObject({ backgroundSize: "contain", backgroundPosition: "top left", backgroundRepeat: "repeat-x" });
    expect(styleToCss({ bgImage: "https://x.io/a.png", bgPos: "1px};x" }, "frame", ROOT_PARENT).backgroundPosition).toBe("center");
  });
  it("per-side border widths, style and color", () => {
    const css = styleToCss({ border: { w: 2, color: "#f00", style: "dashed", sides: [1, 0, 3, 0] } }, "frame", ROOT_PARENT);
    expect(css).toMatchObject({ borderStyle: "dashed", borderColor: "#f00", borderWidth: "1px 0px 3px 0px" });
    expect(css.border).toBeUndefined();
  });
  it("text: family string, decoration, nowrap, clamp, wrap", () => {
    expect(styleToCss({ family: "Inter, sans-serif" }, "text", ROOT_PARENT).fontFamily).toBe("Inter, sans-serif");
    expect(styleToCss({ family: "x;y" }, "text", ROOT_PARENT).fontFamily).toBeUndefined();
    expect(styleToCss({ underline: true, deco: "line-through", nowrap: true, tw: "balance" }, "text", ROOT_PARENT)).toMatchObject({ textDecoration: "line-through", whiteSpace: "nowrap", textWrap: "balance" });
    const c = styleToCss({ clamp: 3 }, "text", ROOT_PARENT) as Record<string, unknown>;
    expect(c).toMatchObject({ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" });
  });
  it("mobile overrides include new properties in the media block", () => {
    const doc = newDoc();
    const n = newNode("text", { style: { fs: 16 }, mobile: { blend: "screen", clamp: 2 } });
    const withN = insertNode(doc, doc.root, 0, n);
    const out = responsiveCss(withN, new Map([[doc.root, null], [n.id, withN.nodes[doc.root]]]));
    expect(out).toContain("mix-blend-mode:screen !important");
    expect(out).toContain("-webkit-line-clamp:2 !important");
  });
});
