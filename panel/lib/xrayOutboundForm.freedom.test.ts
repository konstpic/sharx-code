import { describe, expect, it } from "vitest";
import { FREEDOM_LAN_ALLOW_IPS, freedomAllowsLan, withFreedomLanAllowed } from "./xrayOutboundForm";

describe("freedom: allow private networks", () => {
  const base = { domainStrategy: "AsIs", noises: [] };

  it("adds and removes only its own rule and keeps the other settings", () => {
    const on = withFreedomLanAllowed(base, true);
    expect(freedomAllowsLan(on)).toBe(true);
    expect(freedomAllowsLan(base)).toBe(false);
    const off = withFreedomLanAllowed(on, false);
    expect("finalRules" in off).toBe(false);
    expect(off.domainStrategy).toBe("AsIs");
  });

  it("keeps operator-written rules and does not duplicate itself", () => {
    const custom = { finalRules: [{ action: "block", ip: ["8.8.8.8/32"] }] };
    const both = withFreedomLanAllowed(custom, true);
    expect(both.finalRules).toHaveLength(2);
    expect(withFreedomLanAllowed(both, true).finalRules).toHaveLength(2);
    expect(withFreedomLanAllowed(both, false).finalRules).toHaveLength(1);
  });

  it("does not treat a hand-written partial rule as its own", () => {
    expect(freedomAllowsLan({ finalRules: [{ action: "allow", ip: ["192.168.0.0/16"] }] })).toBe(false);
  });

  it("never allows loopback or link-local", () => {
    expect(FREEDOM_LAN_ALLOW_IPS).not.toContain("127.0.0.0/8");
    expect(FREEDOM_LAN_ALLOW_IPS).not.toContain("169.254.0.0/16");
  });
});
