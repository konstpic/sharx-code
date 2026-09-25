import { describe, expect, it } from "vitest";
import { LAN_ROUTE_TAG, lanAccessAllowed, lanAccessAvailable, withLanAccess } from "./xrayLanAccess";

const template = () => ({
  outbounds: [
    { tag: "direct", protocol: "freedom", settings: { domainStrategy: "AsIs" } },
    { tag: "blocked", protocol: "blackhole" },
  ],
  routing: {
    rules: [
      { type: "field", inboundTag: ["api"], outboundTag: "api" },
      { type: "field", outboundTag: "blocked", ip: ["geoip:private"] },
      { type: "field", outboundTag: "blocked", protocol: ["bittorrent"] },
    ],
  },
});

describe("allow private networks (routing + freedom)", () => {
  it("turns on: freedom rule plus a routing rule placed before the private block", () => {
    const on = withLanAccess(template(), true) as ReturnType<typeof template>;
    expect(lanAccessAllowed(on)).toBe(true);
    const rules = on.routing.rules as Array<Record<string, unknown>>;
    const at = rules.findIndex((r) => r.ruleTag === LAN_ROUTE_TAG);
    const block = rules.findIndex((r) => Array.isArray(r.ip) && (r.ip as string[]).includes("geoip:private"));
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(block);
    expect(rules[at].outboundTag).toBe("direct");
    expect(JSON.stringify(rules[at].ip)).not.toContain("127.0.0.0");
  });

  it("turns off cleanly and leaves everything else alone", () => {
    const back = withLanAccess(withLanAccess(template(), true), false) as ReturnType<typeof template>;
    expect(back).toEqual(template());
  });

  it("does not duplicate on repeated toggles and keeps operator rules", () => {
    const custom = template();
    (custom.outbounds[0].settings as Record<string, unknown>).finalRules = [{ action: "block", ip: ["8.8.8.8/32"] }];
    const once = withLanAccess(custom, true) as ReturnType<typeof template>;
    const twice = withLanAccess(once, true) as ReturnType<typeof template>;
    expect(twice.routing.rules.filter((r) => (r as Record<string, unknown>).ruleTag === LAN_ROUTE_TAG)).toHaveLength(1);
    const off = withLanAccess(twice, false) as ReturnType<typeof template>;
    expect((off.outbounds[0].settings as Record<string, unknown>).finalRules).toHaveLength(1);
  });

  it("without a private-block rule it goes right after the API rule", () => {
    const t = template();
    t.routing.rules.splice(1, 1);
    const on = withLanAccess(t, true) as ReturnType<typeof template>;
    expect((on.routing.rules[1] as Record<string, unknown>).ruleTag).toBe(LAN_ROUTE_TAG);
  });

  it("is unavailable without a direct freedom outbound", () => {
    expect(lanAccessAvailable({ outbounds: [{ tag: "x", protocol: "vless" }] })).toBe(false);
    expect(lanAccessAvailable(template())).toBe(true);
    expect(lanAccessAllowed(template())).toBe(false);
  });
});
