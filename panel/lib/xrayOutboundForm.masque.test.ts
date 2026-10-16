import { describe, expect, it } from "vitest";
import { newOutboundRow, updateRowProtocol } from "./xrayOutboundForm";
import { defaultMasqueInbound, validateMasqueInbound, validateMasqueOutbound } from "./xrayMasque";
import { defaultXdriveSettings, validateXdriveSettings } from "./xrayXdrive";

describe("masque outbound defaults", () => {
  it("creates a masque outbound with the masque transport", () => {
    const row = newOutboundRow("masque");
    expect((row.raw.streamSettings as Record<string, unknown>).network).toBe("masque");
    expect(validateMasqueOutbound(row.raw).map((i) => i.code)).toEqual(["addressMissing"]);
  });

  it("drops the masque transport when the protocol changes", () => {
    const row = updateRowProtocol(newOutboundRow("masque"), "vless");
    expect((row.raw.streamSettings as Record<string, unknown>).network).toBe("tcp");
  });
});

describe("masque inbound validation", () => {
  it("flags missing password, bad prefix and duplicates", () => {
    const ib = defaultMasqueInbound();
    expect(validateMasqueInbound(ib).map((i) => i.code)).toEqual(["userPassMissing"]);
    const bad = { ...ib, settings: { users: [{ email: "a", pass: "x" }, { email: "A", pass: "y" }], address: ["10.0.0.1", "10.0.0.1/24"], mtu: 100 } };
    const codes = validateMasqueInbound(bad).map((i) => i.code);
    expect(codes).toContain("userEmailDuplicate");
    expect(codes).toContain("serverAddressInvalid");
    expect(codes).toContain("mtuRange");
  });
});

describe("xdrive validation", () => {
  it("requires 3 drive secrets and a complete template", () => {
    expect(validateXdriveSettings(defaultXdriveSettings("Google Drive")).map((i) => i.code)).toEqual(["driveSecrets"]);
    expect(validateXdriveSettings({ remoteFolder: "f", service: "Google Drive", secrets: ["a", "b", "c"] })).toEqual([]);
    expect(validateXdriveSettings(defaultXdriveSettings("template"))).toEqual([]);
    expect(validateXdriveSettings({ remoteFolder: "f", service: "template", template: { put: { url: "u" } } }).map((i) => i.code)).toContain("templateOps");
    expect(validateXdriveSettings({ remoteFolder: "f", service: "dropbox" }).map((i) => i.code)).toContain("serviceUnsupported");
  });
});
