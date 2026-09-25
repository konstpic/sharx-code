"use client";

import { useEffect, type RefObject } from "react";
import { MOTION_REPLAY_EVENT } from "./motion";

/** Restarts the CSS animation of an element (class rule) without touching React state. */
export function restartAnimation(el: HTMLElement): void {
  el.style.animation = "none";
  void el.offsetWidth; // reflow
  el.style.animation = "";
}

const OBSERVED = ".lm-t-visible,.lm-t-scroll-progress,[data-ptrig='visible']";

/**
 * One controller for a whole rendered layout: marks elements `data-motion="active"` when they should play
 * (visible via IntersectionObserver, click), and replays on the window event `sublyt-motion-replay` (detail: node id or
 * null for all). Hover / focus are pure CSS. In edit mode every trigger plays on load so the preview shows it.
 */
export function useMotionController(rootRef: RefObject<HTMLElement | null>, edit: boolean, deps: unknown[]): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const seen = new WeakSet<Element>();
    let io: IntersectionObserver | null = null;

    const activate = (el: Element) => el.setAttribute("data-motion", "active");
    const scan = () => {
      root.querySelectorAll<HTMLElement>(`${OBSERVED},.lm-t-click`).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (edit || typeof IntersectionObserver === "undefined") {
          activate(el);
          return;
        }
        if (el.matches(OBSERVED)) io?.observe(el);
      });
    };

    if (!edit && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const el = en.target as HTMLElement;
            if (en.isIntersecting) {
              activate(el);
              if (!el.classList.contains("lm-rep")) io?.unobserve(el);
            } else if (el.classList.contains("lm-rep") && el.getAttribute("data-motion") === "active") {
              el.removeAttribute("data-motion");
              restartAnimation(el);
            }
          }
        },
        { threshold: 0.15 },
      );
    }
    scan();

    const onClick = (e: MouseEvent) => {
      if (edit) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(".lm-t-click");
      if (!el || !root.contains(el)) return;
      el.removeAttribute("data-motion");
      restartAnimation(el);
      requestAnimationFrame(() => activate(el));
    };
    root.addEventListener("click", onClick);

    const onReplay = (e: Event) => {
      const id = (e as CustomEvent).detail as string | null;
      const list = id ? Array.from(root.querySelectorAll<HTMLElement>(`[data-lnode="${CSS.escape(id)}"]`)) : Array.from(root.querySelectorAll<HTMLElement>(".lm,[data-ptrig]"));
      // A frame replays its stagger children too.
      if (id) list.forEach((f) => f.querySelectorAll<HTMLElement>(".lm").forEach((c) => list.push(c)));
      for (const el of list) {
        restartAnimation(el);
        // Shadow-hosted css animations restart by re-attaching the host content.
        const sr = el.shadowRoot;
        if (sr) sr.querySelectorAll<HTMLElement>("*").forEach((c) => restartAnimation(c));
      }
    };
    window.addEventListener(MOTION_REPLAY_EVENT, onReplay);

    const mo = new MutationObserver(() => scan());
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      io?.disconnect();
      mo.disconnect();
      root.removeEventListener("click", onClick);
      window.removeEventListener(MOTION_REPLAY_EVENT, onReplay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, edit, ...deps]);
}
