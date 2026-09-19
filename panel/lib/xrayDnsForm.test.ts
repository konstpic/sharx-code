import { describe, expect, it } from "vitest";
import { parseDnsSection, serializeDnsSection } from "./xrayDnsForm";

const roundTrip = (obj: unknown) => JSON.parse(serializeDnsSection(parseDnsSection(JSON.stringify(obj)).state));

describe("xrayDnsForm", () => {
  it("keeps string servers, object servers, hosts forms and unknown keys", () => {
    const input = {
      servers: [
        "1.1.1.1",
        "https+local://1.1.1.1/dns-query",
        { address: "8.8.8.8", port: 53, domains: ["geosite:google"], expectedIPs: ["geoip:us"], skipFallback: true, timeoutMs: 4000 },
        "fakedns",
      ],
      hosts: { "domain:example.com": "1.2.3.4", "geosite:category-ads-all": ["127.0.0.1"], "alias.test": "real.test" },
      queryStrategy: "UseIPv4",
      tag: "dns_inbound",
      disableCache: true,
      serveStale: true,
      disableFallbackIfMatch: true,
    };
    expect(roundTrip(input)).toEqual(input);
  });

  it("null means disabled and round-trips as null", () => {
    const { state } = parseDnsSection("null");
    expect(state.enabled).toBe(false);
    expect(serializeDnsSection(state)).toBe("null");
  });

  it("drops empty host rows on serialize", () => {
    const { state } = parseDnsSection(JSON.stringify({ servers: ["1.1.1.1"], hosts: { a: "1.1.1.1" } }));
    state.hosts.push({ id: "x", key: "", values: [""], asArray: false });
    state.hosts.push({ id: "y", key: "b", values: [""], asArray: false });
    expect(JSON.parse(serializeDnsSection(state)).hosts).toEqual({ a: "1.1.1.1" });
  });

  it("reports invalid JSON", () => {
    expect(parseDnsSection("{").error).toBe("invalid");
    expect(parseDnsSection("[]").error).toBe("not-object");
  });
});
