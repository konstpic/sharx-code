import type { ResolvedStyle, TileStyle } from "@/lib/dashboardStyle";

/** Accent swatches of the editor (the theme accent is the "Theme" button). */
export const ACCENT_SWATCHES = ["#38bdf8", "#a78bfa", "#f472b6", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6", "#64748b"] as const;

/** What every style tab receives. */
export type TabProps = {
  /** The stored (sparse) style of the tile being edited. */
  style: TileStyle | undefined;
  /** Effective values: defaults < preset < explicit. */
  r: ResolvedStyle;
  /** Sets top-level fields (nested objects merge, `undefined` clears a field back to its default). */
  patch: (p: Partial<Record<keyof TileStyle, unknown>>) => void;
  /** A metric tile: value-level options (typography of the value, numbers, charts) apply. Other tiles only take the frame. */
  metric: boolean;
};

export type TabId = "data" | "look" | "appearance" | "colors" | "text" | "charts" | "behavior";
