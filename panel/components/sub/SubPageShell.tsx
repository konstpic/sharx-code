"use client";

import { motion, useReducedMotion } from "framer-motion";
import { type CSSProperties, type ReactNode } from "react";
import type { SharxBranding } from "@/lib/sharxSubpageConfig";
import { durations, easeStandard } from "@/lib/motion";
import { resolveSubPageColorPreset } from "@/lib/subPageColorPreset";
import shell from "./subscription-shell.module.css";

type Props = {
  children: ReactNode;
  className?: string;
  /** Optional branding color overrides — injected as CSS vars on the root. */
  branding?: SharxBranding;
  /** "system" | "dark" | "light" — forwarded as data-theme on root. */
  theme?: string;
  /** Same presets as the panel (default: SharX Web / `web`). */
  colorPreset?: string;
};

function buildCssVars(branding?: SharxBranding): CSSProperties {
  if (!branding) return {};
  const style: Record<string, string> = {};
  const assign = (key: string, value?: string) => {
    if (value && value.trim()) style[key] = value.trim();
  };
  assign("--sub-accent", branding.accentColor);
  assign("--sub-accent-ambient", branding.accentAmbientColor);
  assign("--sub-bg", branding.bgColor);
  assign("--sub-bg-elevated", branding.bgElevatedColor);
  assign("--sub-fg", branding.fgColor);
  assign("--sub-fg-muted", branding.fgMutedColor);
  assign("--sub-border", branding.borderColor);
  assign("--sub-success", branding.successColor);
  assign("--sub-danger", branding.dangerColor);
  return style as CSSProperties;
}

function resolveTheme(theme?: string): "dark" | "light" | undefined {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return undefined;
}

export function SubPageShell({
  children,
  className = "",
  branding,
  theme,
  colorPreset,
}: Props) {
  const style = buildCssVars(branding);
  const dataTheme = resolveTheme(theme);
  const palette = resolveSubPageColorPreset(colorPreset);
  const reduce = useReducedMotion();
  const hasCustomBg = !!(branding?.bgColor && branding.bgColor.trim());

  return (
    <div
      className={`${shell.root} ${className}`}
      style={style}
      data-theme={dataTheme}
      data-color-preset={palette}
      data-has-custom-bg={hasCustomBg ? "true" : "false"}
      data-bg={branding?.background === "plain" ? "plain" : "animated"}
      data-decor={branding?.decorations === false ? "off" : "on"}
    >
      <div className={shell.animatedBg} aria-hidden />
      {reduce ? (
        <div className={shell.content}>{children}</div>
      ) : (
        <motion.div
          className={shell.content}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: durations.slow, ease: easeStandard }}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

export { shell as subShellStyles };
