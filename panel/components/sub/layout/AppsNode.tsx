"use client";

import { useMemo, type CSSProperties } from "react";
import { resolveMtProtoLinks, type PublicSubPayload } from "../types";
import { readApps, resolveNodeApps, type AppsItem } from "@/lib/subLayout/apps";
import { safeUrl, type Ctx } from "@/lib/subLayout/template";
import { NodeIcon } from "./icons";

type Props = {
  props: Record<string, unknown>;
  scope: Ctx;
  data: PublicSubPayload;
  edit: boolean;
  interactive: boolean;
  emptyLabel: string;
  common: Record<string, unknown>;
  css: CSSProperties;
};

const GRADIENT = "linear-gradient(135deg, var(--sub-accent, #22d3ee), color-mix(in oklab, var(--sub-accent, #22d3ee) 60%, var(--sub-accent-ambient, #9775fa)))";

function variantCss(v: string): CSSProperties {
  if (v === "solid") return { background: GRADIENT, color: "var(--sub-on-accent, #04141a)", border: "1px solid transparent", boxShadow: "0 10px 24px -12px var(--sub-accent, #22d3ee)" };
  if (v === "outline") return { background: "transparent", color: "var(--sub-fg-strong, #fff)", border: "1px solid var(--sub-border, rgba(255,255,255,.14))" };
  return { background: "transparent", color: "var(--sub-fg, #c9d1d9)", border: "1px solid transparent" };
}

function AppIcon({ item, size }: { item: AppsItem; size: number }) {
  const src = item.iconUrl ? safeUrl(item.iconUrl) : "";
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: size * 0.22, objectFit: "contain", flexShrink: 0 }} />;
  return <NodeIcon name="smartphone" size={size} />;
}

/** Hand-picked (or config-mirrored) app buttons with real per-client deep links. */
export function AppsNode({ props, scope, data, edit, interactive, emptyLabel, common, css }: Props) {
  const p = useMemo(() => readApps(props), [props]);
  const items = useMemo(
    () => resolveNodeApps(p, { subscriptionUrl: data.subscriptionUrl, subscriptionJsonUrl: data.subscriptionJsonUrl, happEncryptedUrl: data.happEncryptedUrl, v2raytunEncryptedUrl: data.v2raytunEncryptedUrl, links: data.links }, resolveMtProtoLinks(data), scope.apps),
    [p, data, scope.apps],
  );

  if (items.length === 0) {
    if (!edit) return null;
    return (
      <div {...common} style={{ ...css, display: "grid", placeItems: "center", minHeight: 48, border: "1px dashed rgba(255,255,255,.25)", borderRadius: 10, fontSize: 12, opacity: 0.6 }}>
        {emptyLabel}
      </div>
    );
  }

  const { view, variant } = p;
  const wrap: CSSProperties =
    view === "list"
      ? { display: "flex", flexDirection: "column", gap: 8 }
      : view === "tiles"
        ? { display: "grid", gap: 10, gridTemplateColumns: p.cols ? `repeat(${p.cols}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(110px, 1fr))" }
        : p.cols
          ? { display: "grid", gap: 8, gridTemplateColumns: `repeat(${p.cols}, minmax(0, 1fr))` }
          : { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 };

  const itemCss: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: view === "list" ? "flex-start" : "center",
    flexDirection: view === "tiles" ? "column" : "row",
    gap: view === "tiles" ? 8 : 10,
    textAlign: view === "tiles" ? "center" : "left",
    textDecoration: "none",
    cursor: edit ? "default" : "pointer",
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.2,
    position: "relative",
    minWidth: 0,
    padding: view === "tiles" ? "16px 10px" : view === "list" ? "10px 14px" : "10px 18px",
    borderRadius: view === "buttons" ? 999 : 14,
    ...variantCss(view === "tiles" && variant === "ghost" ? "outline" : variant),
  };

  return (
    <div {...common} style={{ ...wrap, ...css }}>
      {items.map((it) => {
        const href = safeUrl(it.href);
        return (
          <a
            key={it.id}
            className="sublyt-app"
            style={itemCss}
            href={href || undefined}
            onClick={(e) => {
              if (edit || !interactive || !href) e.preventDefault();
            }}
          >
            {p.showIcon ? <AppIcon item={it} size={view === "tiles" ? 36 : 22} /> : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: view === "list" ? 1 : undefined }}>{it.label}</span>
            {p.showBadge && it.badge ? (
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 999, background: "color-mix(in oklab, var(--sub-success, #3fb950) 22%, transparent)", color: variant === "solid" ? "inherit" : "var(--sub-success, #3fb950)", border: "1px solid color-mix(in oklab, currentColor 30%, transparent)", ...(view === "tiles" ? { position: "absolute", top: 6, right: 6 } : {}) }}>
                {it.badge}
              </span>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}
