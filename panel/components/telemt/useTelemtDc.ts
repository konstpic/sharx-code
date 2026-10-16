"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { createTelemtStore, type NoticeFormatter, type TelemtStore } from "@/lib/telemtDcStore";

export type { NoticeFormatter };

let shared: TelemtStore | null = null;
/** One module-level store for the whole page (ref-counted: polls only while something is mounted). */
function sharedStore(): TelemtStore {
  if (!shared) shared = createTelemtStore({ fetcher: () => getJson<unknown>(panel("api/inbounds/telemtDcStatus")) });
  return shared;
}

const SERVER_STATE = createTelemtStore({ fetcher: async () => ({ success: false }) }).getState();

/**
 * Subscribes to the shared Telemt DC poller. Any number of widgets can call it; the endpoint is hit
 * once per interval. Settings (poll interval, pause, alerts) are shared between them too.
 */
export function useTelemtDc(formatNotice?: NoticeFormatter) {
  const store = sharedStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, () => SERVER_STATE);
  useEffect(() => {
    if (formatNotice) store.setFormatter(formatNotice);
  }, [store, formatNotice]);
  const actions = useMemo(
    () => ({
      refresh: () => store.refresh(),
      setPoll: store.setPoll,
      setPaused: store.setPaused,
      setNotify: store.setNotify,
    }),
    [store],
  );
  return { ...state, ...actions };
}
