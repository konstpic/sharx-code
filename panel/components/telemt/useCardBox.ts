"use client";

import { useContext } from "react";
import { TileBoxContext, useElementBox } from "@/components/dashboard/useTileBox";

/**
 * Size of the box the widget lives in. Inside a dashboard tile this is the measured tile BODY (definite
 * width/height, published by GridTile). Elsewhere it falls back to the widget's parent element. The
 * widget's own size is never used, so there is no feedback loop between layout mode and size.
 * `style` pins the root to the measured height when known (so nothing depends on an ancestor CSS height).
 */
export function useCardBox() {
  const ctx = useContext(TileBoxContext);
  const own = useElementBox();
  const ref = ctx ? undefined : (el: HTMLElement | null) => own.ref(el ? el.parentElement : null);
  const width = ctx ? ctx.width : own.width;
  const height = ctx ? ctx.height : own.height;
  return {
    width,
    height,
    hideTitle: ctx ? ctx.hideTitle : false,
    inTile: !!ctx,
    ref,
    style: ctx && height > 0 ? ({ height } as const) : undefined,
  };
}
