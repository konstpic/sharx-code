"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { PanelNavLink } from "@/components/panel/PanelNavLink";
import type { NavNode } from "@/components/panel/nav/navModel";

const spring = { type: "spring", stiffness: 420, damping: 32 } as const;

/** Side navigation as cards: click a section and its pages slide out underneath. */
export function MenuSidebarNav({ nodes, onNavigate }: { nodes: NavNode[]; onNavigate?: () => void }) {
  const reduce = useReducedMotion();
  const activeGroupId = nodes.find((n) => n.active && n.children?.length)?.id;
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeGroupId ? [activeGroupId] : []));

  // Entering a section (by link or by address) reveals its pages; other groups keep the user's choice.
  useEffect(() => {
    if (!activeGroupId) return;
    setOpen((prev) => (prev.has(activeGroupId) ? prev : new Set(prev).add(activeGroupId)));
  }, [activeGroupId]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const logout = nodes.find((n) => n.external);
  const main = nodes.filter((n) => !n.external);

  const card = (n: NavNode, expanded: boolean) => {
    const Icon = n.icon;
    return (
      <motion.span
        className="relative flex w-full items-center gap-3 rounded-2xl border border-transparent px-2.5 py-2"
        whileHover={reduce ? undefined : { x: 3 }}
        whileTap={reduce ? undefined : { scale: 0.985 }}
        transition={spring}
      >
        {n.active ? (
          <motion.span
            layoutId="menu-sidebar-active"
            transition={reduce ? { duration: 0 } : spring}
            className="absolute inset-0 rounded-2xl border border-[var(--accent)]"
            style={{
              background: "color-mix(in oklab, var(--accent) 12%, transparent)",
              boxShadow: "0 0 16px -6px color-mix(in oklab, var(--accent) 70%, transparent), inset 0 0 10px -6px var(--accent)",
            }}
          />
        ) : null}
        <span
          className="relative grid size-8 shrink-0 place-items-center rounded-xl"
          style={{
            background: n.active ? "color-mix(in oklab, var(--accent) 20%, transparent)" : "color-mix(in oklab, var(--fg) 7%, transparent)",
          }}
        >
          <Icon size={17} className={n.active ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"} aria-hidden />
        </span>
        <span className={`relative min-w-0 flex-1 truncate text-sm font-medium ${n.active ? "text-[var(--fg)]" : "text-[var(--fg-muted)]"}`}>{n.label}</span>
        {n.children?.length ? (
          <ChevronDown
            size={15}
            className={`relative shrink-0 text-[var(--fg-subtle)] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            aria-hidden
          />
        ) : null}
      </motion.span>
    );
  };

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3 md:pt-3" aria-label="Main">
      {main.map((n) => {
        const hasChildren = !!n.children?.length;
        const expanded = open.has(n.id);
        return (
          <div key={n.id} className="flex flex-col">
            {hasChildren ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggle(n.id)}
                className="rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {card(n, expanded)}
              </button>
            ) : (
              <PanelNavLink href={n.href} onClick={onNavigate} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                {card(n, false)}
              </PanelNavLink>
            )}
            <AnimatePresence initial={false}>
              {hasChildren && expanded ? (
                <motion.div
                  key="children"
                  initial={reduce ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="ml-[22px] mt-1 flex flex-col gap-0.5 border-l border-[var(--border)] pb-1 pl-3">
                    {n.children!.map((c) => (
                      <PanelNavLink
                        key={c.id}
                        href={c.href}
                        onClick={onNavigate}
                        className={`group relative flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[13px] transition-colors ${
                          c.active
                            ? "bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] font-medium text-[var(--fg)]"
                            : "text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)] hover:text-[var(--fg)]"
                        }`}
                      >
                        <span
                          className="size-1.5 shrink-0 rounded-full transition-transform group-hover:scale-125"
                          style={{ background: c.active ? "var(--accent)" : "color-mix(in oklab, var(--fg) 30%, transparent)" }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate">{c.label}</span>
                      </PanelNavLink>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
      {logout ? (
        <a
          id="logout-link"
          href={logout.href}
          onClick={onNavigate}
          className="mt-auto flex items-center gap-3 rounded-2xl border border-[var(--border)] px-2.5 py-2 text-sm font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: "color-mix(in oklab, var(--fg) 7%, transparent)" }}>
            <logout.icon size={17} aria-hidden />
          </span>
          {logout.label}
        </a>
      ) : null}
    </nav>
  );
}
