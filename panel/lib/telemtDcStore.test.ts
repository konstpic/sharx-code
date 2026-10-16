import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemtStore } from "./telemtDcStore";

const ok = { success: true, obj: [{ kind: "node", nodeId: 1, name: "n", instances: [] }] };
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("telemt shared poller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ref-counts subscribers: one start, one stop, one request per interval", async () => {
    const fetcher = vi.fn(async () => ok);
    const st = createTelemtStore({ fetcher, local: mem, session: mem });
    const u1 = st.subscribe(() => {});
    const u2 = st.subscribe(() => {});
    expect(st.subscriberCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    u1();
    u1(); // idempotent
    expect(st.isRunning()).toBe(true);
    u2();
    expect(st.isRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("dedupes in-flight loads", async () => {
    let release: (v: typeof ok) => void = () => {};
    const fetcher = vi.fn(() => new Promise<typeof ok>((r) => (release = r)));
    const st = createTelemtStore({ fetcher, local: mem, session: mem });
    const u = st.subscribe(() => {});
    void st.refresh();
    void st.refresh();
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(ok);
    await vi.advanceTimersByTimeAsync(0);
    expect(st.getState().sources?.length).toBe(1);
    expect(st.getState().busy).toBe(false);
    u();
  });

  it("interval comes from storage and setPoll reschedules; pause stops requests", async () => {
    const local = mem();
    local.setItem("sharx.telemtDc.poll", "5");
    const fetcher = vi.fn(async () => ok);
    const st = createTelemtStore({ fetcher, local: () => local, session: mem });
    const u = st.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(st.getState().poll).toBe(5);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    st.setPoll(30);
    expect(local.getItem("sharx.telemtDc.poll")).toBe("30");
    st.setPaused(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    u();
  });

  it("keeps last data and reports error on failure", async () => {
    let fail = false;
    const fetcher = vi.fn(async () => (fail ? { success: false, msg: "boom" } : ok));
    const st = createTelemtStore({ fetcher, local: mem, session: mem });
    const u = st.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    await st.refresh();
    expect(st.getState().error).toBe("boom");
    expect(st.getState().sources?.length).toBe(1);
    u();
  });
});
