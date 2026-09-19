import { describe, expect, it } from "vitest";
import { getPath, listAt, setPath } from "./jsonPath";

describe("setPath", () => {
  it("sets nested keys immutably and creates containers", () => {
    const src = { a: { b: 1 } };
    const out = setPath(src, ["a", "c", "d"], 2);
    expect(out).toEqual({ a: { b: 1, c: { d: 2 } } });
    expect(src).toEqual({ a: { b: 1 } });
  });

  it("creates arrays for numeric segments and edits them in place", () => {
    const out = setPath({}, ["settings", "vnext", 0, "address"], "1.2.3.4");
    expect(out).toEqual({ settings: { vnext: [{ address: "1.2.3.4" }] } });
    const out2 = setPath(out, ["settings", "vnext", 0, "users", 0, "id"], "u");
    expect(getPath(out2, ["settings", "vnext", 0, "users", 0, "id"])).toBe("u");
    expect(getPath(out2, ["settings", "vnext", 0, "address"])).toBe("1.2.3.4");
  });

  it("undefined deletes the key and prunes emptied parents", () => {
    const out = setPath({ streamSettings: { network: "ws", wsSettings: { path: "/x" } } }, ["streamSettings", "wsSettings", "path"], undefined);
    expect(out).toEqual({ streamSettings: { network: "ws" } });
  });

  it("removes array items and arrays that a delete leaves empty", () => {
    const src = { settings: { servers: [{ users: [{ user: "u" }] }] } };
    expect(setPath(src, ["settings", "servers", 0, "users", 0, "user"], undefined)).toEqual({});
    const withAddress = { settings: { servers: [{ address: "a", users: [{ user: "u" }] }] } };
    expect(setPath(withAddress, ["settings", "servers", 0, "users", 0, "user"], undefined)).toEqual({ settings: { servers: [{ address: "a" }] } });
  });

  it("keeps sibling data in arrays untouched", () => {
    const src = { servers: [{ address: "a", port: 1 }, { address: "b" }] };
    const out = setPath(src, ["servers", 0, "port"], 2);
    expect(out.servers).toEqual([{ address: "a", port: 2 }, { address: "b" }]);
  });
});

describe("listAt", () => {
  it("normalizes string or array values", () => {
    expect(listAt({ a: "x" }, ["a"])).toEqual(["x"]);
    expect(listAt({ a: ["x", 1, "y"] }, ["a"])).toEqual(["x", "y"]);
    expect(listAt({}, ["a"])).toEqual([]);
  });
});
