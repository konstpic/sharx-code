"use client";
import { useEffect, useRef, useState } from "react";
import { countUpValue } from "@/lib/dashboardStyle";

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Animates a number from its previous value (0 on the first render) to `target` in `ms`. Returns `target` itself
 * when disabled, when `prefers-reduced-motion` is set, or while there is nothing to animate.
 */
export function useCountUp(target: number | null, enabled: boolean, ms = 700): number | null {
  const [shown, setShown] = useState<number | null>(null);
  const last = useRef(0);
  useEffect(() => {
    if (!enabled || target == null || !Number.isFinite(target) || prefersReducedMotion()) return;
    const from = last.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = countUpValue(from, target, k);
      last.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, ms]);
  if (!enabled || target == null || !Number.isFinite(target) || prefersReducedMotion()) return target;
  return shown ?? last.current;
}
