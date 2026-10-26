import { describe, expect, it } from "vitest";
import { getSharxV2ConfigJsonSchemaForMonaco } from "./sharxV2ConfigJsonSchemaForMonaco";

describe("sharx v2 config JSON schema for the editor", () => {
  it("is built from the zod schema (not the fallback) and lists the config fields", () => {
    const s = getSharxV2ConfigJsonSchemaForMonaco() as { properties?: Record<string, unknown>; required?: string[]; description?: string };
    expect(s.description ?? "").not.toContain("schema build failed");
    expect(Object.keys(s.properties ?? {})).toEqual(expect.arrayContaining(["schemaVersion", "branding", "theme", "blocks", "locales"]));
    // defaults make these optional when writing the JSON; the two without defaults are required
    expect(s.required).toEqual(expect.arrayContaining(["schemaVersion", "branding"]));
    expect(s.required).not.toContain("theme");
  });
});
