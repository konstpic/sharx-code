import { describe, expect, it } from "vitest";
import { lintXrayConfig } from "./xrayConfigLint";
import { missingSectionKeys, orderedSectionKeys } from "./xrayConfigSections";

const codes = (root: Record<string, unknown>) => lintXrayConfig(root).map((i) => i.code);

describe("lintXrayConfig", () => {
  const base = {
    outbounds: [{ tag: "direct" }, { tag: "proxy-1" }, { tag: "proxy-2" }],
    routing: { rules: [{ type: "field", outboundTag: "direct" }] },
  };

  it("reports nothing for a consistent config", () => {
    expect(lintXrayConfig(base)).toEqual([]);
    expect(lintXrayConfig(null)).toEqual([]);
  });

  it("flags rules that point at unknown outbounds and balancers", () => {
    const out = codes({ ...base, routing: { rules: [{ outboundTag: "nope" }, { balancerTag: "ghost" }] } });
    expect(out).toContain("unknownOutbound");
    expect(out).toContain("unknownBalancer");
  });

  it("treats the API tag as a valid rule target", () => {
    expect(codes({ ...base, api: { tag: "api" }, routing: { rules: [{ inboundTag: ["api"], outboundTag: "api" }] } })).toEqual([]);
  });

  it("does not flag outbound references when the template has no outbounds yet", () => {
    expect(codes({ routing: { rules: [{ outboundTag: "x" }] } })).not.toContain("unknownOutbound");
  });

  it("flags rules with neither outbound nor balancer", () => {
    expect(codes({ ...base, routing: { rules: [{ domain: ["a"] }] } })).toContain("ruleWithoutTarget");
  });

  it("checks balancers: selector, fallback and observatory requirement", () => {
    const routing = {
      rules: [{ balancerTag: "b" }],
      balancers: [{ tag: "b", selector: ["nothing-"], fallbackTag: "gone", strategy: { type: "leastPing" } }],
    };
    const out = codes({ ...base, routing });
    expect(out).toContain("balancerSelectsNothing");
    expect(out).toContain("unknownFallback");
    expect(out).toContain("balancerNeedsObservatory");
    const ok = codes({
      ...base,
      observatory: { subjectSelector: ["proxy-"] },
      routing: { rules: [{ balancerTag: "b" }], balancers: [{ tag: "b", selector: ["proxy-"], fallbackTag: "direct", strategy: { type: "leastPing" } }] },
    });
    expect(ok).toEqual([]);
  });

  it("flags duplicate tags and observatories that select nothing", () => {
    const out = codes({ outbounds: [{ tag: "a" }, { tag: "a" }], inbounds: [{ tag: "i" }, { tag: "i" }], observatory: { subjectSelector: ["zzz"] } });
    expect(out).toEqual(expect.arrayContaining(["duplicateOutbound", "duplicateInbound", "observatorySelectsNothing"]));
  });
});

describe("section ordering", () => {
  it("orders known sections first, then unknown keys alphabetically", () => {
    expect(orderedSectionKeys({ zeta: 1, routing: {}, log: {}, alpha: 1, outbounds: [] })).toEqual(["log", "routing", "outbounds", "alpha", "zeta"]);
  });
  it("lists known sections the template lacks", () => {
    const missing = missingSectionKeys({ log: {}, routing: {} });
    expect(missing).toContain("dns");
    expect(missing).not.toContain("log");
  });
});

describe("lintXrayConfig: Xray 26.9.30 / 26.10.10 features", () => {
  const masqueOut = {
    tag: "m",
    protocol: "masque",
    settings: { address: "example.com", port: 443 },
    streamSettings: { network: "masque", security: "tls", masqueSettings: {} },
  };
  const run = (root: Record<string, unknown>, v?: string) => lintXrayConfig(root, v);

  it("accepts a valid masque outbound", () => {
    expect(run({ outbounds: [masqueOut] }, "26.10.10")).toEqual([]);
  });

  it("flags a masque outbound without address/port and with mux", () => {
    const bad = { ...masqueOut, settings: {}, mux: { enabled: true } };
    const out = run({ outbounds: [bad] });
    expect(out.filter((i) => i.code === "masqueInvalid").length).toBeGreaterThanOrEqual(3);
  });

  it("requires warp.publicKey only from 26.10.10", () => {
    const warp = { ...masqueOut, streamSettings: { network: "masque", masqueSettings: { warp: { privateKey: "k", address: ["172.16.0.2/32"] } } } };
    expect(run({ outbounds: [warp] }, "26.9.30").map((i) => i.code)).not.toContain("masqueInvalid");
    expect(run({ outbounds: [warp] }, "26.10.10").map((i) => i.code)).toContain("masqueInvalid");
  });

  it("flags the masque transport on another protocol", () => {
    const ob = { tag: "v", protocol: "vless", streamSettings: { network: "masque" } };
    expect(run({ outbounds: [ob] }).map((i) => i.code)).toContain("masqueTransportMisuse");
  });

  it("warns when the running core is too old", () => {
    expect(run({ outbounds: [masqueOut] }, "26.9.9").map((i) => i.code)).toContain("featureNeedsVersion");
    expect(run({ routing: { script: "route.lua" } }, "26.9.30").map((i) => i.code)).toContain("featureNeedsVersion");
    expect(run({ routing: { script: "route.lua" } }, "26.10.10")).toEqual([]);
    expect(run({ routing: { script: "route.lua" } })).toEqual([]);
  });

  it("validates xdrive settings", () => {
    const ob = { tag: "x", protocol: "vless", streamSettings: { network: "xdrive", xdriveSettings: { remoteFolder: "f", service: "Google Drive", secrets: ["a"] } } };
    expect(run({ outbounds: [ob] }, "26.10.10").map((i) => i.code)).toContain("xdriveInvalid");
  });

  it("flags WireGuard options removed in 26.9.30", () => {
    const wg = { tag: "wg", protocol: "wireguard", settings: { remoteDNS: ["local"], domainStrategy: "ForceIPv4", peers: [] } };
    expect(run({ outbounds: [wg] }, "26.9.9")).toEqual([]);
    expect(run({ outbounds: [wg] })).toEqual([]);
    const codes2 = run({ outbounds: [wg] }, "26.10.10").map((i) => i.code);
    expect(codes2).toContain("wireguardLocalDns");
    expect(codes2).toContain("wireguardDomainStrategy");
  });

  it("recognises XDNS field generations", () => {
    const mk = (settings: unknown) => ({ tag: "k", protocol: "vless", streamSettings: { finalmask: { udp: [{ type: "xdns", settings }] } } });
    const legacy = mk({ domains: [{ name: "a.example" }], resolvers: [{ type: "udp", settings: { addr: "1.1.1.1" } }] });
    const modern = mk({ domains: [{ names: ["a.example"] }], resolvers: [{ addrs: ["1.1.1.1"] }] });
    expect(run({ outbounds: [legacy] }, "26.10.10").map((i) => i.code)).toContain("xdnsLegacyFields");
    expect(run({ outbounds: [modern] }, "26.10.10")).toEqual([]);
    expect(run({ outbounds: [modern] }, "26.9.30").map((i) => i.code)).toContain("featureNeedsVersion");
  });

  it("gates noise type exp", () => {
    const ob = { tag: "n", protocol: "vless", streamSettings: { finalmask: { udp: [{ type: "noise", settings: { noise: [{ type: "exp", packet: "<t>" }] } }] } } };
    expect(run({ outbounds: [ob] }, "26.9.9").map((i) => i.code)).toContain("featureNeedsVersion");
    expect(run({ outbounds: [ob] }, "26.9.30")).toEqual([]);
  });
});

