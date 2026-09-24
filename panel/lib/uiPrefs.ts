"use client";

import axios from "axios";
import { panel } from "@/lib/paths";

type UiPrefKey =
  | "panelTheme"
  | "panelMenuStyle"
  | "panelLang"
  | "dashboardWidgets"
  | "hideSecAlert"
  | "clientsTablePrefs";

/**
 * Dedicated client without global 401->reload interceptor.
 * UI prefs can be queried on public/login pages; 401 should be handled quietly.
 */
const uiPrefsApi = axios.create({
  withCredentials: true,
  headers: {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
  },
});

export async function getUiPref(key: UiPrefKey): Promise<string | null> {
  try {
    const res = await uiPrefsApi.post<{ success: boolean; obj?: { value?: unknown } }>(
      panel("setting/ui/get"),
      { key },
    );
    const r = res.data;
    if (!r?.success || !r.obj) return null;
    const value = r.obj.value;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function setUiPref(key: UiPrefKey, value: string): Promise<boolean> {
  try {
    const res = await uiPrefsApi.post<{ success: boolean }>(panel("setting/ui/set"), {
      key,
      value,
    });
    return Boolean(res.data?.success);
  } catch {
    return false;
  }
}
