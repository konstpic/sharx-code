import { describe, expect, it } from "vitest";
import { buildLayoutContext, type LayoutData } from "./context";

const data: LayoutData = {
  subscriptionUrl: "https://s.example/sub/abc",
  links: ["vless://uuid@host.example:443?x=1#DE%20Node", "trojan://p@h2.example:443#FI"],
  user: { username: "alice", isActive: true, trafficUsedBytes: 1_000_000_000, trafficLimitBytes: 4_000_000_000, daysLeft: 12 },
  devices: { enabled: true, max: 3, count: 1, items: [{ os: "iOS", model: "iPhone" }] },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

describe("buildLayoutContext", () => {
  const ctx = buildLayoutContext(data, { lang: "ru", vars: { bot: "@b" } }) as Obj;

  it("computes traffic figures", () => {
    expect(ctx.user.percentUsed).toBe(25);
    expect(ctx.user.remainingBytes).toBe(3_000_000_000);
    expect(ctx.user.remaining).toMatch(/GB/);
    expect(ctx.user.unlimited).toBe(false);
    expect(ctx.user.neverExpires).toBe(false);
  });
  it("treats no limit as unlimited and clamps percent", () => {
    const u = buildLayoutContext({ user: { trafficUsedBytes: 5, trafficLimitBytes: 0 } }).user as Obj;
    expect(u).toMatchObject({ unlimited: true, percentUsed: 0, remaining: "∞" });
    const o = buildLayoutContext({ user: { trafficUsedBytes: 9, trafficLimitBytes: 3 } }).user as Obj;
    expect(o.percentUsed).toBe(100);
    expect(o.remainingBytes).toBe(0);
  });
  it("marks far-future expiry as never", () => {
    expect((buildLayoutContext({ user: { daysLeft: 99999 } }).user as Obj).neverExpires).toBe(true);
  });
  it("computes devices.left", () => {
    expect(ctx.devices).toMatchObject({ max: 3, count: 1, left: 2, unlimited: false });
    expect(ctx.devices.items[0]).toMatchObject({ number: 1, name: "iPhone · iOS" });
    expect((buildLayoutContext({ devices: { max: 2, count: 5 } }).devices as Obj).left).toBe(0);
    expect(buildLayoutContext({ devices: { max: 0, items: [{}, {}] } }).devices).toMatchObject({ unlimited: true, left: 0, count: 2 });
  });
  it("parses links", () => {
    expect(ctx.links).toHaveLength(2);
    expect(ctx.links[0]).toMatchObject({ protocol: "vless", title: "DE Node", host: "host.example", number: 1 });
  });
  it("exposes apps and app.<id> consistently", () => {
    expect(Array.isArray(ctx.apps)).toBe(true);
    expect(ctx.apps.length).toBeGreaterThan(0);
    for (const a of ctx.apps) {
      expect(a.url).toBeTruthy();
      expect(ctx.app[a.id.replace(/-/g, "_")]).toBe(a);
    }
    const only = buildLayoutContext(data, { enabledApps: [ctx.apps[0].id] }).apps as Obj[];
    expect(only).toHaveLength(1);
  });
  it("carries page, subscription and vars", () => {
    expect(ctx.subscription.url).toBe(data.subscriptionUrl);
    expect(ctx.subscription.pageUrl).toBe(data.subscriptionUrl);
    expect(ctx.page).toMatchObject({ lang: "ru", preview: false, device: "" });
    expect(ctx.vars).toEqual({ bot: "@b" });
  });
  it("works with empty data", () => {
    expect(() => buildLayoutContext({})).not.toThrow();
  });
});
