import { describe, expect, it } from "vitest";
import { CATALOG, catalogItem } from "./catalog";
import { itemSearchText, itemTags } from "./catalog-meta";

describe("catalog-meta", () => {
  it("tags every item", () => {
    for (const c of CATALOG) expect(itemTags(c).size, c.id).toBeGreaterThan(0);
  });
  it("detects animated, setup and data", () => {
    for (const id of ["anim-sonar", "step-timeline", "scene-connect"]) {
      const it = catalogItem(id);
      expect(it, id).toBeDefined();
      expect(itemTags(it!).has("animated"), id).toBe(true);
    }
    expect(itemTags(catalogItem("telegram")!).has("setup")).toBe(true);
    expect(itemTags(catalogItem("traffic-bar")!).has("data")).toBe(true);
  });
  it("search text covers both languages", () => {
    const t = itemSearchText(catalogItem("greeting")!);
    expect(t).toContain("greeting");
    expect(t).toContain("приветствие");
  });
});
