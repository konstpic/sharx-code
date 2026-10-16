import { describe, expect, it } from "vitest";
import {
  compareXrayVersions,
  isXrayFeatureSupported,
  parseXrayVersion,
  wireguardLocalDnsRemoved,
  xrayFeatureUnsupported,
  xrayVersionAtLeast,
} from "./xrayVersionFeatures";

describe("xrayVersionFeatures", () => {
  it("parses common version spellings", () => {
    expect(parseXrayVersion("v26.10.10")).toEqual([26, 10, 10]);
    expect(parseXrayVersion("Xray 26.9.9 (Xray, Penetrates Everything.)")).toEqual([26, 9, 9]);
    expect(parseXrayVersion("26.10.10-rc1")).toEqual([26, 10, 10]);
    expect(parseXrayVersion("Unknown")).toBeNull();
    expect(parseXrayVersion("")).toBeNull();
    expect(parseXrayVersion(undefined)).toBeNull();
  });

  it("compares numerically, not lexically", () => {
    expect(compareXrayVersions("26.9.30", "26.10.10")).toBe(-1);
    expect(compareXrayVersions("26.10.10", "26.9.30")).toBe(1);
    expect(compareXrayVersions("v26.10.10", "26.10.10")).toBe(0);
    expect(compareXrayVersions("x", "26.10.10")).toBeNull();
  });

  it("gates features by minimum version", () => {
    expect(isXrayFeatureSupported("26.9.9", "masque")).toBe(false);
    expect(isXrayFeatureSupported("26.9.30", "masque")).toBe(true);
    expect(isXrayFeatureSupported("26.9.30", "luaScript")).toBe(false);
    expect(isXrayFeatureSupported("26.10.10", "luaScript")).toBe(true);
    expect(isXrayFeatureSupported("26.9.30", "xdnsNames")).toBe(false);
    expect(isXrayFeatureSupported("26.10.10", "xdrive")).toBe(true);
  });

  it("never reports unsupported for an unknown version", () => {
    expect(isXrayFeatureSupported(null, "luaScript")).toBeNull();
    expect(xrayFeatureUnsupported("Unknown", "luaScript")).toBe(false);
    expect(xrayFeatureUnsupported("26.9.9", "luaScript")).toBe(true);
    expect(xrayVersionAtLeast(undefined, "26.10.10")).toBeNull();
  });

  it("detects the WireGuard breaking change", () => {
    expect(wireguardLocalDnsRemoved("26.9.9")).toBe(false);
    expect(wireguardLocalDnsRemoved("26.9.30")).toBe(true);
    expect(wireguardLocalDnsRemoved("26.10.10")).toBe(true);
    expect(wireguardLocalDnsRemoved(null)).toBe(false);
  });
});
