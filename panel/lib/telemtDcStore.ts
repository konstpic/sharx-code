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
} from "./telemtDc";

/**
 * Shared Telemt DC poller. Every widget (full card, summary, dots) subscribes to ONE store, so the
 * endpoint is requested once per interval no matter how many tiles are on the page. Polling starts
 * with the first subscriber and stops with the last (ref counting); concurrent loads are deduped.
 * Pure TS (no React / DOM imports): fetcher, storages and timers are injectable for tests.
 */

export const LS_POLL = "sharx.telemtDc.poll";
export const LS_NOTIFY = "sharx.telemtDc.notify";
export const SS_HISTORY = "sharx.telemtDc.history";
const FLASH_MS = 4000;

export type FetchResult = { success: boolean; obj?: unknown; msg?: string };
export type Fetcher = () => Promise<FetchResult>;
export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export type NoticeFormatter = (t: Transition) => { title: string; body: string };

export type TelemtState = {
  sources: Source[] | null;
  error: string | null;
  busy: boolean;
  lastOkAt: number | null;
  now: number;
  poll: number;
  paused: boolean;
  notify: boolean;
  notifyDenied: boolean;
  history: History;
  tracker: Tracker;
  events: Transition[];
  flash: Set<string>;
  lastBatch: { id: number; list: Transition[] };
};

export type StoreOptions = {
  fetcher: Fetcher;
  local?: () => KV | null;
  session?: () => KV | null;
  now?: () => number;
};

function safeStore(get: () => KV | null | undefined): KV | null {
  try {
    return get() ?? null;
  } catch {
    return null;
  }
}
function rd(kv: KV | null, k: string): string | null {
  try {
    return kv ? kv.getItem(k) : null;
  } catch {
    return null;
  }
}
function wr(kv: KV | null, k: string, v: string) {
  try {
    kv?.setItem(k, v);
  } catch {
    /* quota / private mode */
  }
}

export function createTelemtStore(opts: StoreOptions) {
  const clock = opts.now ?? (() => Date.now());
  const local = () => safeStore(opts.local ?? (() => (typeof localStorage !== "undefined" ? localStorage : null)));
  const session = () => safeStore(opts.session ?? (() => (typeof sessionStorage !== "undefined" ? sessionStorage : null)));

  let state: TelemtState = {
    sources: null,
    error: null,
    busy: false,
    lastOkAt: null,
    now: clock(),
    poll: normalizePoll(null),
    paused: false,
    notify: false,
    notifyDenied: false,
    history: {},
    tracker: {},
    events: [],
    flash: new Set(),
    lastBatch: { id: 0, list: [] },
  };
  const listeners = new Set<() => void>();
  let inflight: Promise<void> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let batchId = 0;
  let formatter: NoticeFormatter | null = null;
  let running = false;

  const set = (patch: Partial<TelemtState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const hidden = () => typeof document !== "undefined" && document.hidden;

  function notifyTransitions(list: Transition[]) {
    if (!state.notify || typeof Notification === "undefined" || Notification.permission !== "granted" || !formatter) return;
    for (const tr of list.filter(isUpToDown).slice(0, 3)) {
      const n = formatter(tr);
      try {
        new Notification(n.title, { body: n.body, tag: `telemt-dc-${tr.key}` });
      } catch {
        /* some browsers forbid constructor notifications */
      }
    }
  }

  function load(): Promise<void> {
    if (inflight) return inflight;
    set({ busy: true });
    inflight = (async () => {
      try {
        const r = await opts.fetcher();
        if (!r.success || !Array.isArray(r.obj)) {
          set({ error: r.msg || "request failed" });
          return;
        }
        const t = clock();
        const list = (r.obj as Source[]).map((s) => ({ ...s, instances: Array.isArray(s.instances) ? s.instances : [] }));
        const h = recordPoll(state.history, list, t);
        const { next, transitions } = detectTransitions(state.tracker, list, t);
        wr(session(), SS_HISTORY, serializeHistory(h));
        const patch: Partial<TelemtState> = { sources: list, history: h, tracker: next, error: null, lastOkAt: t, now: t };
        if (transitions.length) {
          batchId += 1;
          patch.events = appendEvents(state.events, transitions);
          patch.lastBatch = { id: batchId, list: transitions };
          patch.flash = changedKeys(transitions);
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => set({ flash: new Set() }), FLASH_MS);
        }
        set(patch);
        if (transitions.length) notifyTransitions(transitions);
      } catch (e) {
        set({ error: e instanceof Error ? e.message : "request failed" });
      } finally {
        inflight = null;
        set({ busy: false });
      }
    })();
    return inflight;
  }

  function schedule() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (!running || state.paused) return;
    pollTimer = setInterval(() => {
      if (!hidden()) void load();
    }, state.poll * 1000);
  }

  function onVisible() {
    if (running && !state.paused && !hidden()) void load();
  }

  function start() {
    running = true;
    const ls = local();
    const notifyOn = rd(ls, LS_NOTIFY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
    set({ poll: normalizePoll(rd(ls, LS_POLL)), notify: notifyOn, history: state.sources ? state.history : parseHistory(rd(session(), SS_HISTORY)) });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    clockTimer = setInterval(() => {
      if (!hidden()) set({ now: clock() });
    }, 1000);
    schedule();
    if (!state.paused) void load();
  }

  function stop() {
    running = false;
    if (pollTimer) clearInterval(pollTimer);
    if (clockTimer) clearInterval(clockTimer);
    if (flashTimer) clearTimeout(flashTimer);
    pollTimer = clockTimer = flashTimer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  }

  return {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (listeners.size === 1) start();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    subscriberCount: () => listeners.size,
    isRunning: () => running,
    refresh: load,
    setFormatter(f: NoticeFormatter) {
      formatter = f;
    },
    setPoll(s: number) {
      const v = normalizePoll(s);
      set({ poll: v });
      wr(local(), LS_POLL, String(v));
      schedule();
    },
    setPaused(p: boolean) {
      set({ paused: p });
      schedule();
      if (!p && running) void load();
    },
    async setNotify(on: boolean) {
      if (!on) {
        set({ notify: false });
        wr(local(), LS_NOTIFY, "0");
        return;
      }
      if (typeof Notification === "undefined") {
        set({ notifyDenied: true });
        return;
      }
      let perm = Notification.permission;
      if (perm === "default") perm = await Notification.requestPermission();
      if (perm === "granted") {
        set({ notifyDenied: false, notify: true });
        wr(local(), LS_NOTIFY, "1");
      } else {
        set({ notifyDenied: true, notify: false });
        wr(local(), LS_NOTIFY, "0");
      }
    },
  };
}

export type TelemtStore = ReturnType<typeof createTelemtStore>;
