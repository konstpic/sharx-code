"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelNavLink } from "@/components/panel/PanelNavLink";
import type { NavNode } from "@/components/panel/nav/navModel";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

/** Top navigation strip: snap-scrolling cards with a gliding active marker and a sub-menu row. */
export function MenuCarousel({ nodes, onNavigate }: { nodes: NavNode[]; onNavigate?: () => void }) {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure, nodes.length]);

  const activeId = nodes.find((n) => n.active)?.id;
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [activeId, reduce]);

  const scrollBy = (dx: number) => scroller.current?.scrollBy({ left: dx, behavior: "smooth" });
  const active = nodes.find((n) => n.active && n.children?.length);

  return (
    <div className="panel-menu-carousel relative z-[55] hidden shrink-0 border-b border-[var(--border)] md:block">
      <div className="relative mx-auto flex w-full max-w-[1800px] items-center gap-1 px-3 py-2">
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-360)}
          className={`grid size-8 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[var(--accent)] ${
            edges.left ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <ChevronLeft size={16} />
        </button>
        <div
          ref={scroller}
          role="menubar"
          className="flex min-w-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-2 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            maskImage: `linear-gradient(90deg, ${edges.left ? "transparent, #000 28px" : "#000, #000 0"}, #000 calc(100% - 28px), ${edges.right ? "transparent" : "#000"})`,
            WebkitMaskImage: `linear-gradient(90deg, ${edges.left ? "transparent, #000 28px" : "#000, #000 0"}, #000 calc(100% - 28px), ${edges.right ? "transparent" : "#000"})`,
          }}
        >
          {nodes.map((n) => {
            const Icon = n.icon;
            const body = (
              <motion.span
                className="relative flex min-h-[64px] w-[92px] shrink-0 snap-center flex-col items-center justify-center gap-1 rounded-2xl border border-transparent px-1.5 py-1.5 text-center"
                whileHover={reduce ? undefined : { y: -2, scale: 1.04, rotateX: 5 }}
                whileTap={reduce ? undefined : { scale: 0.96 }}
                transition={spring}
                style={{ transformPerspective: 500 }}
              >
                {n.active ? (
                  <motion.span
                    layoutId="menu-carousel-active"
                    transition={reduce ? { duration: 0 } : spring}
                    className="absolute inset-0 rounded-2xl border border-[var(--accent)]"
                    style={{
                      background: "color-mix(in oklab, var(--accent) 14%, transparent)",
                      boxShadow: "0 0 14px -4px color-mix(in oklab, var(--accent) 65%, transparent), inset 0 0 12px -6px var(--accent)",
                    }}
                  />
                ) : null}
                <Icon size={20} className={`relative ${n.active ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}`} aria-hidden />
                <span className={`relative line-clamp-2 max-w-full break-words text-[11px] font-medium leading-tight ${n.active ? "text-[var(--fg)]" : "text-[var(--fg-muted)]"}`}>
                  {n.label}
                </span>
              </motion.span>
            );
            return n.external ? (
              <a key={n.id} href={n.href} role="menuitem" data-active={n.active} onClick={onNavigate} className="shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-2xl">
                {body}
              </a>
            ) : (
              <PanelNavLink key={n.id} href={n.href} className="shrink-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" onClick={onNavigate}>
                <span role="menuitem" data-active={n.active} className="block">
                  {body}
                </span>
              </PanelNavLink>
            );
          })}
        </div>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(360)}
          className={`grid size-8 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--fg-muted)] transition hover:text-[var(--accent)] ${
            edges.right ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {active ? (
          <motion.div
            key={active.id}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center gap-1.5 px-4 pb-2">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{active.label}</span>
              {active.children!.map((c) => (
                <PanelNavLink
                  key={c.id}
                  href={c.href}
                  onClick={onNavigate}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    c.active
                      ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--fg)]"
                      : "border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
                  }`}
                >
                  {c.label}
                </PanelNavLink>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
