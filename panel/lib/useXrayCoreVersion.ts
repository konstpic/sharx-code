"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";

type StatusObj = { xray?: { version?: string } };

let cached: string | null | undefined;
let inflight: Promise<string | null> | null = null;

function load(): Promise<string | null> {
  if (cached !== undefined) return Promise.resolve(cached);
  inflight ??= getJson<StatusObj>(panel("api/server/status"))
    .then((m) => {
      const v = m.success ? (m.obj?.xray?.version ?? "") : "";
      cached = /\d+\.\d+\.\d+/.test(v) ? v : null;
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Version of the Xray core running on this panel's host (e.g. "26.10.10"), or null while loading / unknown.
 * Null must never block an option: version gates only warn when the version is known (see xrayVersionFeatures).
 * Nodes can run a different core; the hints refer to the panel's own core.
 */
export function useXrayCoreVersion(): string | null {
  const [v, setV] = useState<string | null>(cached ?? null);
  useEffect(() => {
    let alive = true;
    void load().then((r) => {
      if (alive) setV(r);
    });
    return () => {
      alive = false;
    };
  }, []);
  return v;
}
