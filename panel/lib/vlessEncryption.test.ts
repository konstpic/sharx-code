import { describe, expect, it } from "vitest";
import {
  composeVlessEnc,
  detectVlessEncAuth,
  normalizeVlessEncAuths,
  parseVlessEnc,
  patchVlessEnc,
  validateVlessEnc,
  validateVlessEncPadding,
  vlessEncPairProblems,
} from "./vlessEncryption";

const K = "A".repeat(43);
const SEED = "B".repeat(86);
const CLIENT = "C".repeat(1579);
const dec = `mlkem768x25519plus.native.600s.${SEED}`;
const enc = `mlkem768x25519plus.native.0rtt.${CLIENT}`;

describe("vlessEncryption", () => {
  it("validates none and real values", () => {
    expect(validateVlessEnc("none", "server")).toBeNull();
    expect(validateVlessEnc("", "client")).toBeNull();
    expect(validateVlessEnc(dec, "server")).toBeNull();
    expect(validateVlessEnc(enc, "client")).toBeNull();
    expect(validateVlessEnc(`mlkem768x25519plus.xorpub.300-600s.100-111-1111.75-0-111.50-0-3333.${K}.${SEED}`, "server")).toBeNull();
  });
  it("rejects bad values", () => {
    expect(validateVlessEnc("mlkem768x25519plus.native.600s", "server")).toBe("format");
    expect(validateVlessEnc(`x.native.600s.${K}`, "server")).toBe("prefix");
    expect(validateVlessEnc(`mlkem768x25519plus.foo.600s.${K}`, "server")).toBe("mode");
    expect(validateVlessEnc(`mlkem768x25519plus.native.0rtt.${K}`, "server")).toBe("ticket");
    expect(validateVlessEnc(`mlkem768x25519plus.native.600s.${K}`, "client")).toBe("ticket");
    expect(validateVlessEnc(`mlkem768x25519plus.native.600s.50-111-1111.${K}`, "server")).toBe("padding");
    expect(validateVlessEnc(`mlkem768x25519plus.native.600s.${CLIENT}`, "server")).toBe("key");
    expect(validateVlessEnc("mlkem768x25519plus.native.600s.short", "server")).toBe("padding");
  });
  it("parses, composes and patches", () => {
    const p = parseVlessEnc(dec, "server")!;
    expect(p).toMatchObject({ mode: "native", ticket: "600s", padding: "", keys: [SEED] });
    expect(composeVlessEnc(p)).toBe(dec);
    const patched = patchVlessEnc(dec, "server", { mode: "xorpub", ticket: "300-600s", padding: "100-111-1111.75-0-111" });
    expect(patched).toBe(`mlkem768x25519plus.xorpub.300-600s.100-111-1111.75-0-111.${SEED}`);
    expect(validateVlessEnc(patched, "server")).toBeNull();
    expect(patchVlessEnc("none", "server", { mode: "random" })).toBe("none");
  });
  it("validates padding", () => {
    expect(validateVlessEncPadding("")).toBeNull();
    expect(validateVlessEncPadding("100-111-1111.75-0-111.50-0-3333")).toBeNull();
    expect(validateVlessEncPadding("100-111-1111")).toBeNull();
    expect(validateVlessEncPadding("50-111-1111.75-0-111")).toBe("padding");
    expect(validateVlessEncPadding("100-1-10.75-0-111")).toBe("padding");
    expect(validateVlessEncPadding("100-300-200")).toBe("padding");
    expect(validateVlessEncPadding("abc")).toBe("padding");
  });
  it("detects auth", () => {
    expect(detectVlessEncAuth("none", "server")).toBe("none");
    expect(detectVlessEncAuth(`mlkem768x25519plus.native.600s.${K}`, "server")).toBe("x25519");
    expect(detectVlessEncAuth(dec, "server")).toBe("mlkem768");
    expect(detectVlessEncAuth(enc, "client")).toBe("mlkem768");
    expect(detectVlessEncAuth("garbage", "server")).toBe("invalid");
  });
  it("finds pair problems", () => {
    expect(vlessEncPairProblems("none", "none")).toEqual([]);
    expect(vlessEncPairProblems(dec, enc)).toEqual([]);
    expect(vlessEncPairProblems(dec, "none")).toEqual(["clientMissing"]);
    expect(vlessEncPairProblems("none", enc)).toEqual(["serverMissing"]);
    expect(vlessEncPairProblems(dec, enc.replace("native", "random"))).toEqual(["modeMismatch"]);
  });
  it("normalizes backend payload", () => {
    expect(normalizeVlessEncAuths(null)).toEqual([]);
    expect(
      normalizeVlessEncAuths({ auths: [{ label: "L", decryption: "d", encryption: "e" }, { label: "bad" }] }),
    ).toEqual([{ label: "L", decryption: "d", encryption: "e" }]);
  });
});
