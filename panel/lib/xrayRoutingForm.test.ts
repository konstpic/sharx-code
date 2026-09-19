import { describe, expect, it } from "vitest";
import {
  analyzeRoutingSection,
  isCatchAllRule,
  newEmptyRule,
  parseRoutingSection,
  serializeRoutingSection,
} from "./xrayRoutingForm";

const roundTrip = (obj: unknown) => {
  const { state, needsAdvanced } = parseRoutingSection(JSON.stringify(obj));
  expect(needsAdvanced).toBe(false);
  return JSON.parse(serializeRoutingSection(state!));
};

describe("xrayRoutingForm round trip", () => {
  it("keeps unmodeled rule keys, balancers and top-level extras", () => {
    const input = {
      domainStrategy: "IPIfNonMatch",
      domainMatcher: "mph",
      rules: [
        {
          type: "field",
          outboundTag: "direct",
          domain: ["geosite:cn"],
          attrs: { ":method": "GET" },
          sourcePort: "1000-2000",
          localIP: ["10.0.0.0/8"],
          ruleTag: "cn-direct",
        },
        { type: "field", balancerTag: "auto", ip: ["geoip:ru"] },
      ],
      balancers: [
        {
          tag: "auto",
          selector: ["proxy-"],
          strategy: { type: "leastLoad", settings: { expected: 2, maxRTT: "1s" } },
          fallbackTag: "direct",
        },
      ],
    };
    expect(roundTrip(input)).toEqual(input);
  });

  it("does not send configs with balancers or extras to advanced JSON", () => {
    expect(
      analyzeRoutingSection(
        JSON.stringify({ rules: [{ type: "field", balancerTag: "b", attrs: { a: "b" } }], balancers: [{ tag: "b", selector: [] }] }),
      ),
    ).toBe("visual");
  });

  it("still flags structurally unusable routing as advanced", () => {
    expect(analyzeRoutingSection(JSON.stringify({ rules: "nope" }))).toBe("advanced");
    expect(analyzeRoutingSection(JSON.stringify({ rules: [1] }))).toBe("advanced");
    expect(analyzeRoutingSection(JSON.stringify({ rules: [{ type: "chinasites" }] }))).toBe("advanced");
    expect(analyzeRoutingSection(JSON.stringify({ rules: [{ domain: [{ a: 1 }] }] }))).toBe("advanced");
    expect(analyzeRoutingSection("[]")).toBe("advanced");
  });

  it("accepts routing without a rules key", () => {
    const { state } = parseRoutingSection(JSON.stringify({ domainStrategy: "AsIs" }));
    expect(state?.rules).toEqual([]);
  });

  it("writes user as an array and numeric ports as numbers", () => {
    const out = roundTrip({
      rules: [{ type: "field", outboundTag: "x", user: ["a@b.c", "d@e.f"], port: 443 }, { type: "field", outboundTag: "y", port: "80-90" }],
    });
    expect(out.rules[0].user).toEqual(["a@b.c", "d@e.f"]);
    expect(out.rules[0].port).toBe(443);
    expect(out.rules[1].port).toBe("80-90");
  });

  it("outboundTag wins over balancerTag so a rule never has both", () => {
    const { state } = parseRoutingSection(JSON.stringify({ rules: [{ type: "field", outboundTag: "o", balancerTag: "b" }] }));
    const out = JSON.parse(serializeRoutingSection(state!));
    expect(out.rules[0].outboundTag).toBe("o");
    expect(out.rules[0].balancerTag).toBeUndefined();
  });

  it("drops completely empty rules on serialize but keeps rules with only extras", () => {
    const { state } = parseRoutingSection(JSON.stringify({ rules: [{ type: "field", attrs: { a: "b" } }] }));
    state!.rules.push(newEmptyRule());
    const out = JSON.parse(serializeRoutingSection(state!));
    expect(out.rules).toHaveLength(1);
    expect(out.rules[0].attrs).toEqual({ a: "b" });
  });
});

describe("value shapes", () => {
  it("keeps string ports and single string / array inboundTag exactly as written", () => {
    const input = {
      domainStrategy: "IPIfNonMatch",
      rules: [
        { type: "field", inboundTag: ["api"], outboundTag: "api" },
        { type: "field", inboundTag: "api2", outboundTag: "api" },
        { type: "field", port: "53", network: "udp,tcp", outboundTag: "direct" },
        { type: "field", port: 53, outboundTag: "direct" },
      ],
    };
    expect(roundTrip(input)).toEqual(input);
  });
  it("new rules write arrays and numeric ports", () => {
    const { state } = parseRoutingSection(JSON.stringify({ rules: [] }));
    state!.rules.push({ ...newEmptyRule(), outboundTag: "x", inboundTag: "a", port: "443" });
    const out = JSON.parse(serializeRoutingSection(state!));
    expect(out.rules[0].inboundTag).toEqual(["a"]);
    expect(out.rules[0].port).toBe(443);
  });
});

describe("isCatchAllRule", () => {
  it("is true only when nothing restricts the rule", () => {
    expect(isCatchAllRule({ ...newEmptyRule(), outboundTag: "direct" })).toBe(true);
    expect(isCatchAllRule({ ...newEmptyRule(), outboundTag: "direct", port: "443" })).toBe(false);
    expect(isCatchAllRule({ ...newEmptyRule(), outboundTag: "direct", extra: { attrs: { a: "b" } } })).toBe(false);
    expect(isCatchAllRule({ ...newEmptyRule(), outboundTag: "direct", extra: { ruleTag: "t" } })).toBe(true);
  });
});
