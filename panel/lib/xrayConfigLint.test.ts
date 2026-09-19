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
