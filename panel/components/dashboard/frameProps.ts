import type { CSSProperties } from "react";
import { frameStyle } from "@/lib/dashboardStyle";

/**
 * Attributes + CSS variables a tile root gets from its style (see lib/dashboardStyle.ts `frameStyle`).
 * A default style yields `{}` for both, so such a tile renders exactly as before the styling feature.
 */
export function frameProps(style: unknown, legacyColor?: string): { attrs: Record<string, string>; vars: CSSProperties } {
  const f = frameStyle(style, legacyColor);
  const attrs: Record<string, string> = { ...f.attrs };
  if (f.tokens) attrs["data-ts"] = f.tokens;
  return { attrs, vars: f.vars as CSSProperties };
}
