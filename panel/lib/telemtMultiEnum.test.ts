import { describe, expect, it } from "vitest";
import {
  isValidMultiEnum,
  multiEnumPosition,
  multiEnumSelected,
  multiEnumState,
  toggleMultiEnum,
} from "./telemtMultiEnum";

describe("telemt multi-enum", () => {
  it("classifies state", () => {
    expect(multiEnumState(undefined)).toBe("default");
    expect(multiEnumState(false)).toBe("disabled");
    expect(multiEnumState(["https"])).toBe("custom");
    expect(multiEnumState([])).toBe("default");
  });

  it("toggle keeps click order and returns to default when emptied", () => {
    let v: unknown = undefined;
    v = toggleMultiEnum(v, "websocket");
    v = toggleMultiEnum(v, "https");
    expect(v).toEqual(["websocket", "https"]);
    expect(multiEnumPosition(v, "https")).toBe(2);
    expect(multiEnumPosition(v, "websocket-lanes")).toBe(0);
    v = toggleMultiEnum(v, "websocket");
    expect(v).toEqual(["https"]);
    expect(toggleMultiEnum(v, "https")).toBeUndefined();
  });

  it("toggling from the disabled state starts a fresh selection", () => {
    expect(toggleMultiEnum(false, "https")).toEqual(["https"]);
    expect(multiEnumSelected(false)).toEqual([]);
  });

  it("validates like the server", () => {
    const opts = ["https", "https-lanes", "websocket", "websocket-lanes"];
    expect(isValidMultiEnum(undefined, opts, true)).toBe(true);
    expect(isValidMultiEnum(false, opts, true)).toBe(true);
    expect(isValidMultiEnum(false, opts, false)).toBe(false);
    expect(isValidMultiEnum([], opts, true)).toBe(false);
    expect(isValidMultiEnum(["https", "https"], opts, true)).toBe(false);
    expect(isValidMultiEnum(["quic"], opts, true)).toBe(false);
    expect(isValidMultiEnum(["websocket", "https"], opts, true)).toBe(true);
  });
});
