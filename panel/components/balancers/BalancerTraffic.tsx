"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";

type Sample = {
  t: number;
  rx: number;
  tx: number;
  conns?: Record<string, number>;
  pools?: Record<string, { in: number; out: number }>;
};
type MetricsResp = { intervalMs: number; now: number; samples: Sample[] };

type PoolInfo = { id: number; label: string; port: number };

const MAX_SAMPLES = 900;
const POLL_MS = 3000;

function fmtRate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return "—";
  const units = ["bit/s", "Kbit/s", "Mbit/s", "Gbit/s"];
  let v = bps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

type Point = { t: number; label: string; toClients: number; fromClients: number; conns: number };

/** Live traffic of one balancer: throughput (Mbit/s) and client connections, polled from the agent history. */
export function BalancerTraffic({ balancerId, pools }: { balancerId: number; pools: PoolInfo[] }) {
  const { t } = useTranslation();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState("");
  const since = useRef(0);

  useEffect(() => {
    let stop = false;
    since.current = 0;
    setSamples([]);
    const tick = async () => {
      const r = await getJson<MetricsResp>(panel(`balancer/metrics/${balancerId}?since=${since.current}`));
      if (stop) return;
      if (!r.success || !r.obj) {
        setError(r.msg || "");
        return;
      }
      setError("");
      const fresh = r.obj.samples ?? [];
      if (fresh.length === 0) return;
      since.current = fresh[fresh.length - 1].t;
      setSamples((prev) => [...prev, ...fresh].slice(-MAX_SAMPLES));
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [balancerId]);

  const { points, exact } = useMemo(() => {
    const out: Point[] = [];
    let exact = false;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      let toC = 0;
      let fromC = 0;
      const ids = b.pools ? Object.keys(b.pools).filter((k) => a.pools?.[k]) : [];
      if (ids.length > 0) {
        exact = true;
        for (const k of ids) {
          toC += Math.max(0, b.pools![k].out - a.pools![k].out);
          fromC += Math.max(0, b.pools![k].in - a.pools![k].in);
        }
      } else {
        // nginx exposes no per-listener counters: half of the interface traffic is the client-facing leg.
        toC = Math.max(0, b.tx - a.tx) / 2;
        fromC = Math.max(0, b.rx - a.rx) / 2;
      }
      const conns = Object.values(b.conns ?? {}).reduce((s, n) => s + n, 0);
      out.push({
        t: b.t,
        label: new Date(b.t).toLocaleTimeString(),
        toClients: (toC * 8) / dt,
        fromClients: (fromC * 8) / dt,
        conns,
      });
    }
    return { points: out, exact };
  }, [samples]);

  const last = points[points.length - 1];
  const peak = useMemo(() => points.reduce((m, p) => Math.max(m, p.toClients + p.fromClients), 0), [points]);

  const perPool = useMemo(() => {
    const a = samples[samples.length - 2];
    const b = samples[samples.length - 1];
    if (!a || !b) return [];
    const dt = (b.t - a.t) / 1000;
    return pools.map((p) => {
      const k = String(p.id);
      const pb = b.pools?.[k];
      const pa = a.pools?.[k];
      return {
        ...p,
        conns: b.conns?.[k] ?? null,
        down: pb && pa && dt > 0 ? (Math.max(0, pb.out - pa.out) * 8) / dt : null,
        up: pb && pa && dt > 0 ? (Math.max(0, pb.in - pa.in) * 8) / dt : null,
      };
    });
  }, [samples, pools]);

  const tone = { toClients: "var(--chart-green, #22c55e)", fromClients: "var(--chart-purple, #a78bfa)" };

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
      {error ? (
        <p className="py-6 text-center text-xs text-[var(--fg-subtle)]">{error}</p>
      ) : points.length < 2 ? (
        <p className="py-6 text-center text-xs text-[var(--fg-subtle)]">
          {t("pages.balancers.collecting", { defaultValue: "Collecting samples…" })}
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--fg-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ background: tone.toClients }} />
              {t("pages.balancers.toClients", { defaultValue: "To clients" })}: <b className="text-[var(--fg)]">{fmtRate(last.toClients)}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ background: tone.fromClients }} />
              {t("pages.balancers.fromClients", { defaultValue: "From clients" })}: <b className="text-[var(--fg)]">{fmtRate(last.fromClients)}</b>
            </span>
            <span>
              {t("pages.balancers.connections", { defaultValue: "Connections" })}: <b className="text-[var(--fg)]">{last.conns}</b>
            </span>
            <span>
              {t("pages.balancers.peak", { defaultValue: "Peak" })}: <b className="text-[var(--fg)]">{fmtRate(peak)}</b>
            </span>
            {!exact ? (
              <span className="text-[var(--fg-subtle)]" title={t("pages.balancers.approxHint", { defaultValue: "nginx has no per-port counters: half of the server's network traffic is shown." })}>
                ≈ {t("pages.balancers.approx", { defaultValue: "estimate" })}
              </span>
            ) : null}
          </div>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--fg-muted)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={(v: number) => fmtRate(v)} tick={{ fontSize: 10, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} width={68} />
                <Tooltip
                  formatter={(v, name) => [fmtRate(Number(v)), String(name)]}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="toClients" name={t("pages.balancers.toClients", { defaultValue: "To clients" })} stroke={tone.toClients} fill={tone.toClients} fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="fromClients" name={t("pages.balancers.fromClients", { defaultValue: "From clients" })} stroke={tone.fromClients} fill={tone.fromClients} fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis dataKey="label" hide />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  formatter={(v) => [String(v), t("pages.balancers.connections", { defaultValue: "Connections" })]}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                />
                <Line type="stepAfter" dataKey="conns" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {perPool.length > 0 ? (
            <div className="mt-3 grid gap-1 text-xs">
              {perPool.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1 text-[var(--fg-muted)]">
                  <span className="truncate text-[var(--fg)]">
                    {p.label} <span className="font-mono text-[var(--fg-subtle)]">:{p.port}</span>
                  </span>
                  <span className="flex gap-4">
                    <span>{p.conns == null ? "—" : `${p.conns} ${t("pages.balancers.connShort", { defaultValue: "conn." })}`}</span>
                    <span>↓ {p.down == null ? "—" : fmtRate(p.down)}</span>
                    <span>↑ {p.up == null ? "—" : fmtRate(p.up)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
