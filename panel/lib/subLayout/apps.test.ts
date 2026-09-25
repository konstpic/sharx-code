import { describe, expect, it } from "vitest";
import { resolveAddToAppButtons } from "../addToAppButtons";
import { buildAppsBlock, defaultAppsProps, readApps } from "./apps";
import { newNode } from "./tree";

describe("apps node", () => {
  it("has usable defaults", () => {
    const n = newNode("apps");
    const p = readApps(n.props);
    expect(p.apps.map((a) => a.app)).toEqual(["happ", "v2raytun", "hiddify", "clash-meta"]);
    expect(p).toMatchObject({ source: "manual", view: "buttons", variant: "solid", showIcon: true, showBadge: true });
  });
  it("repairs junk", () => {
    const p = readApps({ apps: [{ app: "nope" }, { app: "happ" }, { app: "happ" }, 5], view: "x", cols: 99 });
    expect(p.apps).toHaveLength(1);
    expect(p.view).toBe("buttons");
    expect(p.cols).toBe(6);
  });
  it("resolves real deep links from the synthetic block", () => {
    const list = readApps(defaultAppsProps()).apps;
    const out = resolveAddToAppButtons(buildAppsBlock([...list, { app: "happ", enabled: true }]), { subscriptionUrl: "https://s.example/sub/abc", links: [] }, []);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.find((b) => b.app === "happ")?.href).toContain("happ://");
  });
  it("skips disabled apps and returns nothing without a subscription url", () => {
    expect(resolveAddToAppButtons(buildAppsBlock([{ app: "happ", enabled: false }]), { subscriptionUrl: "https://x/y" }, [])).toEqual([]);
    expect(resolveAddToAppButtons(buildAppsBlock([{ app: "happ" }]), {}, [])).toEqual([]);
  });
});
