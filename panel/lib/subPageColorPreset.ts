import { z } from "zod";

/**
 * Public subscription page color palettes — aligned with panel themes
 * (see `app/globals.css` [data-panel-theme] and `lib/panelTheme.ts` PANEL_THEME_IDS).
 */
export const SUB_PAGE_COLOR_PRESET_IDS = [
  "web",
  "default",
  "midnight",
  "ember",
  "boreal",
  "xuiClassic",
  "starWars",
  "vision",
  "helloKitty",
  "barbie",
  "neon",
  "sunset",
] as const;

export type SubPageColorPresetId = (typeof SUB_PAGE_COLOR_PRESET_IDS)[number];

/** Matches `PANEL_THEME_DEFAULT` (SharX Web). */
export const SUB_PAGE_COLOR_PRESET_DEFAULT: SubPageColorPresetId = "web";

export const subPageColorPresetSchema = z.enum([
  "web",
  "default",
  "midnight",
  "ember",
  "boreal",
  "xuiClassic",
  "starWars",
  "vision",
  "helloKitty",
  "barbie",
  "neon",
  "sunset",
]);

export function resolveSubPageColorPreset(
  raw: string | null | undefined,
): SubPageColorPresetId {
  if (raw && (SUB_PAGE_COLOR_PRESET_IDS as readonly string[]).includes(raw)) {
    return raw as SubPageColorPresetId;
  }
  return SUB_PAGE_COLOR_PRESET_DEFAULT;
}
