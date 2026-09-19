import { describe, expect, it } from "vitest";
import { autoAssumedTags, collectGeoTags, evaluateRule, ipInCidr, isPrivateIp, knownGeositeTags, parseIp, portMatches, simulateRouting, type SimRequest } from "./xrayRouteSim";

const req = (p: Partial<SimRequest> = {}): SimRequest => ({ domain: "", ip: "", port: "443", network: "tcp", protocol: "", inboundTag: "", sourceIp: "", user: "", ...p });
const none = new Set<string>();

describe("ip helpers", () => {
  it("parses v4 and v6 and matches CIDRs", () => {
    expect(parseIp("10.0.0.1")?.v).toBe(4);
    expect(parseIp("::1")?.v).toBe(6);
    expect(parseIp("2001:db8::1")?.v).toBe(6);
    expect(parseIp("999.1.1.1")).toBeNull();
    expect(ipInCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("11.1.2.3", "10.0.0.0/8")).toBe(false);
    expect(ipInCidr("2001:db8::5", "2001:db8::/32")).toBe(true);
    expect(ipInCidr("1.1.1.1", "1.1.1.1")).toBe(true);
  });
  it("knows private ranges", () => {
    for (const ip of ["192.168.1.5", "10.9.9.9", "172.20.0.1", "127.0.0.1", "100.64.1.1", "::1", "fd00::1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("matches ports and ranges", () => {
    expect(portMatches("443", "443")).toBe(true);
    expect(portMatches("80-90,443", "85")).toBe(true);
    expect(portMatches("80-90", "443")).toBe(false);
    expect(portMatches("443", "")).toBe(false);
  });
});

describe("evaluateRule", () => {
  it("matches domain patterns like Xray does", () => {
    const rule = { domain: ["domain:example.com", "full:exact.org", "keyword:ads", "regexp:^cdn\\d+\\.x\\.io$"] };
    expect(evaluateRule(rule, req({ domain: "www.example.com" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule(rule, req({ domain: "example.com" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule(rule, req({ domain: "notexample.com" }), none, "AsIs").matched).toBe(false);
    expect(evaluateRule(rule, req({ domain: "exact.org" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule(rule, req({ domain: "sub.exact.org" }), none, "AsIs").matched).toBe(false);
    expect(evaluateRule(rule, req({ domain: "myads.net" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule(rule, req({ domain: "cdn12.x.io" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule({ domain: ["plain"] }, req({ domain: "an-plain-thing.com" }), none, "AsIs").matched).toBe(true);
  });

  it("requires every present condition (AND) and any value within one (OR)", () => {
    const rule = { domain: ["domain:a.com"], port: "443", network: "tcp", protocol: ["tls", "http"] };
    expect(evaluateRule(rule, req({ domain: "a.com", protocol: "tls" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule(rule, req({ domain: "a.com", protocol: "quic" }), none, "AsIs").matched).toBe(false);
    expect(evaluateRule(rule, req({ domain: "a.com", protocol: "tls", port: "80" }), none, "AsIs").matched).toBe(false);
    expect(evaluateRule(rule, req({ domain: "a.com", protocol: "tls", network: "udp" }), none, "AsIs").matched).toBe(false);
  });

  it("evaluates inboundTag, source and user", () => {
    expect(evaluateRule({ inboundTag: ["api"] }, req({ inboundTag: "api" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule({ inboundTag: ["api"] }, req({ inboundTag: "inbound-1" }), none, "AsIs").matched).toBe(false);
    expect(evaluateRule({ source: ["10.0.0.0/8"] }, req({ sourceIp: "10.2.3.4" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule({ user: ["a@b.c"] }, req({ user: "a@b.c" }), none, "AsIs").matched).toBe(true);
  });

  it("reports geo tags it cannot evaluate and honours assumptions", () => {
    const rule = { domain: ["geosite:cn"] };
    const miss = evaluateRule(rule, req({ domain: "baidu.com" }), none, "AsIs");
    expect(miss.matched).toBe(false);
    expect(miss.unknownTags).toEqual(["geosite:cn"]);
    expect(evaluateRule(rule, req({ domain: "baidu.com" }), new Set(["geosite:cn"]), "AsIs").matched).toBe(true);
  });

  it("geoip:private is computed, other geoip needs an assumption", () => {
    expect(evaluateRule({ ip: ["geoip:private"] }, req({ ip: "192.168.0.1" }), none, "AsIs").matched).toBe(true);
    expect(evaluateRule({ ip: ["geoip:private"] }, req({ ip: "8.8.8.8" }), none, "AsIs").matched).toBe(false);
    const r = evaluateRule({ ip: ["geoip:ru"] }, req({ ip: "77.88.8.8" }), none, "AsIs");
    expect(r.matched).toBe(false);
    expect(r.unknownTags).toEqual(["geoip:ru"]);
  });

  it("ip rules do not match a bare domain under AsIs", () => {
    const v = evaluateRule({ ip: ["1.1.1.0/24"] }, req({ domain: "one.one" }), none, "AsIs");
    expect(v.matched).toBe(false);
    expect(v.checks[0]!.detail).toContain("AsIs");
  });

  it("does not pretend to evaluate conditions it cannot (attrs, sourcePort, …)", () => {
    expect(evaluateRule({ attrs: { ":method": "GET" } }, req({ protocol: "tls" }), none, "AsIs").matched).toBe(false);
    expect(evaluateRule({ attrs: { ":method": "GET" } }, req({ protocol: "http" }), none, "AsIs").matched).toBe(true);
    const v = evaluateRule({ sourcePort: "1000-2000" }, req(), none, "AsIs");
    expect(v.matched).toBe(false);
    expect(v.checks[0]!.cond).toBe("unsupported");
  });

  it("a rule without conditions matches everything", () => {
    expect(evaluateRule({ outboundTag: "direct" }, req(), none, "AsIs").matched).toBe(true);
  });
});

describe("simulateRouting", () => {
  const routing = {
    domainStrategy: "IPIfNonMatch",
    rules: [
      { inboundTag: ["api"], outboundTag: "api" },
      { protocol: ["bittorrent"], outboundTag: "blocked" },
      { domain: ["geosite:google"], balancerTag: "auto" },
      { ip: ["geoip:private"], outboundTag: "direct" },
    ],
  };

  it("stops at the first match and reports its target", () => {
    const r = simulateRouting(routing, "direct", req({ protocol: "bittorrent" }), none);
    expect(r.matchedIndex).toBe(1);
    expect(r.steps.map((s) => s.verdict.matched)).toEqual([false, true]);
    expect(r.target).toEqual({ kind: "outbound", tag: "blocked" });
  });

  it("resolves a balancer target", () => {
    const r = simulateRouting(routing, "direct", req({ domain: "youtube.com" }), new Set(["geosite:google"]));
    expect(r.target).toEqual({ kind: "balancer", tag: "auto" });
    expect(r.matchedIndex).toBe(2);
  });

  it("falls back to the default outbound when nothing matches", () => {
    const r = simulateRouting(routing, "direct", req({ domain: "unknown.example" }), none);
    expect(r.matchedIndex).toBe(-1);
    expect(r.steps).toHaveLength(4);
    expect(r.target).toEqual({ kind: "default", tag: "direct" });
  });
});

describe("geo helpers", () => {
  it("knows popular domains", () => {
    expect(knownGeositeTags("www.youtube.com")).toEqual(expect.arrayContaining(["geosite:youtube", "geosite:google"]));
    expect(knownGeositeTags("printer.local")).toContain("geosite:private");
    expect(knownGeositeTags("shop.example.ru")).toContain("geosite:category-ru");
    expect(knownGeositeTags("baidu.com")).not.toContain("geosite:geolocation-!cn");
  });
  it("collects referenced geo tags and pre-selects the known ones", () => {
    const tags = collectGeoTags({ rules: [{ domain: ["geosite:google", "domain:x.com"], ip: ["geoip:private", "geoip:ru"] }, { domain: ["geosite:cn"] }] });
    expect(tags.sort()).toEqual(["geoip:ru", "geosite:cn", "geosite:google"]);
    const auto = autoAssumedTags(req({ domain: "youtube.com" }), tags);
    expect([...auto]).toEqual(["geosite:google"]);
  });
});
