import { z } from "zod";
import { sharxSubpageConfigV2Schema } from "./sharxSubpageConfig";

let cached: object | null = null;

const SUB_RAW_URI = "https://sharx.internal/sharx-subpage-config-v2.json";
export const SHARX_SUB_RAW_MONACO_PATH = "sharx-subscription-config-v2.json";

const fallback: object = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  description: "sharx-v2 subscription page config (schema build failed; edit JSON and save).",
  additionalProperties: true,
};

/**
 * JSON Schema (draft-7) for the v2 subscription page config — used by Monaco (hover / validation).
 */
export function getSharxV2ConfigJsonSchemaForMonaco(): object {
  if (cached) return cached;
  try {
    // io "input": fields with defaults are optional for the person writing the JSON; custom (layout) is "any"
    const json = z.toJSONSchema(sharxSubpageConfigV2Schema, {
      target: "draft-7",
      io: "input",
      unrepresentable: "any",
      reused: "inline",
    }) as object;
    cached = {
      $schema: "http://json-schema.org/draft-07/schema#",
      ...json,
    };
  } catch {
    cached = fallback;
  }
  return cached;
}

export function getSharxV2ConfigMonacoEntry() {
  return {
    uri: SUB_RAW_URI,
    fileName: SHARX_SUB_RAW_MONACO_PATH,
    schema: getSharxV2ConfigJsonSchemaForMonaco(),
  };
}
