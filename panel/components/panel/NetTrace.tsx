"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Full-screen host for the 3D scene. The engine (three.js + game code) is a separate async chunk
 * and is only fetched the first time the overlay is opened.
 */
export function NetTrace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    import("./deepdive")
      .then((m) => {
        if (cancelled || !hostRef.current) return;
        dispose = m.mountNetTrace(hostRef.current, () => closeRef.current());
      })
      .catch((err) => {
        console.error("[nettrace] load failed", err);
        closeRef.current();
      });
    return () => {
      cancelled = true;
      dispose?.();
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-[#05060d]">
      <div className="absolute inset-0 grid place-items-center font-mono text-xs tracking-[0.3em] text-[#64748b]">LOADING…</div>
      <div ref={hostRef} className="absolute inset-0" />
    </div>,
    document.body,
  );
}
