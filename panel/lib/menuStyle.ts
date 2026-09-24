"use client";

import { useCallback, useEffect, useState } from "react";
import { getUiPref, setUiPref } from "@/lib/uiPrefs";

export const MENU_STYLE_IDS = ["sidebar", "carousel", "dock"] as const;
export type MenuStyleId = (typeof MENU_STYLE_IDS)[number];
export const MENU_STYLE_DEFAULT: MenuStyleId = "sidebar";

const LS_KEY = "sharx.menuStyle";
const EVENT = "sharx-menu-style";

export function parseMenuStyle(v: string | null | undefined): MenuStyleId {
  return (MENU_STYLE_IDS as readonly string[]).includes(v ?? "") ? (v as MenuStyleId) : MENU_STYLE_DEFAULT;
}

function readCached(): MenuStyleId {
  try {
    return parseMenuStyle(window.localStorage.getItem(LS_KEY));
  } catch {
    return MENU_STYLE_DEFAULT;
  }
}

/** Current menu style: cached value first (no flash), then the saved panel preference. */
export function useMenuStyle(): [MenuStyleId, (next: MenuStyleId) => void] {
  const [style, setStyle] = useState<MenuStyleId>(MENU_STYLE_DEFAULT);

  useEffect(() => {
    setStyle(readCached());
    let cancelled = false;
    void getUiPref("panelMenuStyle").then((v) => {
      if (cancelled || v == null) return;
      const parsed = parseMenuStyle(v);
      setStyle(parsed);
      try {
        window.localStorage.setItem(LS_KEY, parsed);
      } catch {
        /* cache only */
      }
    });
    const onChange = () => setStyle(readCached());
    window.addEventListener(EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  const set = useCallback((next: MenuStyleId) => {
    setStyle(next);
    try {
      window.localStorage.setItem(LS_KEY, next);
    } catch {
      /* cache only */
    }
    window.dispatchEvent(new CustomEvent(EVENT));
    void setUiPref("panelMenuStyle", next);
  }, []);

  return [style, set];
}
