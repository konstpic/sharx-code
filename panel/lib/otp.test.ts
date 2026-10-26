import { describe, expect, it } from "vitest";
import { emptyOtp, otpBackspace, otpComplete, otpFromString, otpInsert, otpValue, OTP_LENGTH } from "./otp";

describe("otp cells", () => {
  it("types a digit and moves on, ignoring letters", () => {
    const r = otpInsert(emptyOtp(), 0, "7");
    expect(r.cells[0]).toBe("7");
    expect(r.focus).toBe(1);
    expect(otpInsert(emptyOtp(), 2, "x").cells).toEqual(emptyOtp());
  });

  it("spreads a pasted or autofilled code over the cells", () => {
    const r = otpInsert(emptyOtp(), 0, "123456");
    expect(otpValue(r.cells)).toBe("123456");
    expect(otpComplete(r.cells)).toBe(true);
    expect(r.focus).toBe(OTP_LENGTH - 1);
  });

  it("strips spaces and dashes from a pasted code and ignores the excess", () => {
    expect(otpValue(otpInsert(emptyOtp(), 0, "123 456").cells)).toBe("123456");
    expect(otpValue(otpInsert(emptyOtp(), 0, "12-34-56-78").cells)).toBe("123456");
  });

  it("a paste starting in the middle fills only what is left", () => {
    const r = otpInsert(emptyOtp(), 4, "9999");
    expect(r.cells).toEqual(["", "", "", "", "9", "9"]);
  });

  it("backspace clears the cell, then steps back", () => {
    let c = otpFromString("12");
    let r = otpBackspace(c, 1);
    expect(r.cells).toEqual(["1", "", "", "", "", ""]);
    expect(r.focus).toBe(1);
    r = otpBackspace(r.cells, 1);
    expect(r.cells).toEqual(["", "", "", "", "", ""]);
    expect(r.focus).toBe(0);
    c = otpBackspace(emptyOtp(), 0).cells;
    expect(c).toEqual(emptyOtp());
  });

  it("builds cells from a string", () => {
    expect(otpFromString("12a3")).toEqual(["1", "2", "3", "", "", ""]);
  });
});
