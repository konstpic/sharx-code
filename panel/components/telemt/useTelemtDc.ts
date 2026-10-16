"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import {
  appendEvents,
  changedKeys,
  detectTransitions,
  isUpToDown,
  normalizePoll,
  parseHistory,
  recordPoll,
  serializeHistory,
  type History,
  type Source,
  type Tracker,
  type Transition,
} from "@/lib/telemtDc";

const LS_POLL = "sharx.telemtDc.poll";
const LS_NOTIFY = "sharx.telemtDc.notify";
const SS_HISTORY = "sharx.telemtDc.history";
const FLASH_MS = 4000;

function lsGet(k: string): string | null {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}

export type NoticeFormatter = (t: Transition) => { title: string; body: string };

/**
 * Polls the DC status endpoint and derives everything time-based on the client: RTT history,
 * "since" stamps, transitions and the event log. All timers stop on unmount; polling is skipped
 * while the tab is hidden or paused.
 */
export function useTelemtDc(formatNotice: NoticeFormatter) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [poll, setPollState] = useState<number>(15);
  const [paused, setPaused] = useState(false);
  const [notify, setNotifyState] = useState(false);
  const [notifyDenied, setNotifyDenied] = useState(false);
  const [history, setHistory] = useState<History>({});
  const [tracker, setTracker] = useState<Tracker>({});
  const [events, setEvents] = useState<Transition[]>([]);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [lastBatch, setLastBatch] = useState<{ id: number; list: Transition[] }>({ id: 0, list: [] });
  const [now, setNow] = useState<number>(() => Date.now());

  const trackerRef = useRef<Tracker>({});
  const historyRef = useRef<History>({});
  const inflight = useRef(false);
  const notifyRef = useRef(false);
  const fmtRef = useRef(formatNotice);
  const batchId = useRef(0);
  const flashTimer = useRef<number | null>(null);
  fmtRef.current = formatNotice;
  notifyRef.current = notify;

  // restore settings + short history once on mount
  useEffect(() => {
    setPollState(normalizePoll(lsGet(LS_POLL)));
    setNotifyState(lsGet(LS_NOTIFY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted");
    try {
      const h = parseHistory(window.sessionStorage.getItem(SS_HISTORY));
      historyRef.current = h;
      setHistory(h);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const r = await getJson<Source[]>(panel("api/inbounds/telemtDcStatus"));
      if (!r.success || !Array.isArray(r.obj)) {
        setError(r.msg || "request failed");
        return;
      }
      const t = Date.now();
      const list = r.obj.map((s) => ({ ...s, instances: Array.isArray(s.instances) ? s.instances : [] }));
      const h = recordPoll(historyRef.current, list, t);
      historyRef.current = h;
      const { next, transitions } = detectTransitions(trackerRef.current, list, t);
      trackerRef.current = next;
      setSources(list);
      setHistory(h);
      setTracker(next);
      setError(null);
      setLastOkAt(t);
      setNow(t);
      try {
        window.sessionStorage.setItem(SS_HISTORY, serializeHistory(h));
      } catch {
        /* quota / private mode */
      }
      if (transitions.length) {
        setEvents((e) => appendEvents(e, transitions));
        batchId.current += 1;
        setLastBatch({ id: batchId.current, list: transitions });
        setFlash(changedKeys(transitions));
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(new Set()), FLASH_MS);
        if (notifyRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const tr of transitions.filter(isUpToDown).slice(0, 3)) {
            const n = fmtRef.current(tr);
            try {
              new Notification(n.title, { body: n.body, tag: `telemt-dc-${tr.key}` });
            } catch {
              /* some browsers forbid constructor notifications */
            }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  // polling loop
  useEffect(() => {
    if (paused) return;
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, poll * 1000);
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, poll, paused]);

  // 1 s clock for ages / "since"
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, []);

  const setPoll = useCallback((s: number) => {
    const v = normalizePoll(s);
    setPollState(v);
    lsSet(LS_POLL, String(v));
  }, []);

  const setNotify = useCallback(async (on: boolean) => {
    if (!on) {
      setNotifyState(false);
      lsSet(LS_NOTIFY, "0");
      return;
    }
    if (typeof Notification === "undefined") {
      setNotifyDenied(true);
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm === "granted") {
      setNotifyDenied(false);
      setNotifyState(true);
      lsSet(LS_NOTIFY, "1");
    } else {
      setNotifyDenied(true);
      setNotifyState(false);
      lsSet(LS_NOTIFY, "0");
    }
  }, []);

  return { sources, error, busy, lastOkAt, now, poll, setPoll, paused, setPaused, refresh: load, notify, setNotify, notifyDenied, history, tracker, events, flash, lastBatch };
}
