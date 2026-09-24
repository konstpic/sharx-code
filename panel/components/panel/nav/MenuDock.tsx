"use client";

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelNavLink } from "@/components/panel/PanelNavLink";
import type { NavNode } from "@/components/panel/nav/navModel";

const BASE = 46;
const PEAK = 76;
const REACH = 150;

function DockItem({
  node,
  mouseX,
  open,
  onToggle,
  onNavigate,
  onPick,
  reduce,
}: {
  node: NavNode;
  mouseX: MotionValue<number>;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onPick: () => void;
  reduce: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const distance = useTransform(mouseX, (v) => {
    const b = ref.current?.getBoundingClientRect();
    return b ? v - b.x - b.width / 2 : Infinity;
  });
  const sized = useTransform(distance, [-REACH, 0, REACH], [BASE, PEAK, BASE]);
  const size = useSpring(sized, { mass: 0.1, stiffness: 170, damping: 13 });
  const iconScale = useTransform(size, (w) => w / BASE);
  const Icon = node.icon;
  const hasChildren = !!node.children?.length;

  const face = (
    <motion.div
      style={reduce ? { width: BASE, height: BASE } : { width: size, height: size }}
      className={`relative grid place-items-center rounded-2xl border ${
        node.active
          ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] shadow-[0_0_18px_-4px_var(--accent)]"
          : "border-[var(--border)] bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]"
      }`}
    >
      <motion.span style={reduce ? undefined : { scale: iconScale }} className="grid place-items-center">
        <Icon size={22} className={node.active ? "text-[var(--accent)]" : "text-[var(--fg)]"} aria-hidden />
      </motion.span>
    </motion.div>
  );

  return (
    <div
      ref={ref}
      className="relative flex flex-col items-center justify-end"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <AnimatePresence>
        {hover && !open ? (
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="pointer-events-none absolute -top-9 whitespace-nowrap rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 py-1 text-xs font-medium text-[var(--fg)] shadow-lg"
          >
            {node.label}
          </motion.span>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open && hasChildren ? (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-[calc(100%+14px)] z-10 flex min-w-[10rem] flex-col gap-0.5 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl"
          >
            <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{node.label}</div>
            {node.children!.map((c) => (
              <PanelNavLink
                key={c.id}
                href={c.href}
                onClick={onPick}
                className={`rounded-xl px-3 py-1.5 text-sm ${
                  c.active ? "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] font-medium text-[var(--fg)]" : "text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--fg)_8%,transparent)] hover:text-[var(--fg)]"
                }`}
              >
                {c.label}
              </PanelNavLink>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {hasChildren ? (
        <button type="button" aria-label={node.label} aria-expanded={open} onClick={onToggle} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          {face}
        </button>
      ) : node.external ? (
        <a href={node.href} aria-label={node.label} onClick={onNavigate} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          {face}
        </a>
      ) : (
        <PanelNavLink href={node.href} onClick={onNavigate} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          <span aria-label={node.label} className="block">
            {face}
          </span>
        </PanelNavLink>
      )}
      <span
        className="mt-1 h-1 w-1 rounded-full transition-opacity"
        style={{ background: "var(--accent)", opacity: node.active ? 1 : 0 }}
        aria-hidden
      />
    </div>
  );
}

/** Floating dock with macOS-style magnification; groups open a pop-over with their sections. */
export function MenuDock({ nodes }: { nodes: NavNode[] }) {
  const reduce = useReducedMotion() ?? false;
  const mouseX = useMotionValue(Infinity);
  const [openId, setOpenId] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const activeKey = nodes.find((n) => n.active)?.id;
  const [hovering, setHovering] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  // A short grace period keeps the blur steady while the cursor crosses the gaps between icons.
  const enter = useCallback(() => {
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    setHovering(true);
  }, []);
  const leave = useCallback(() => {
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHovering(false), 140);
  }, []);
  useEffect(() => () => {
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
  }, []);
  const focusMode = hovering || openId !== null;

  // mouseleave never fires when the element under the cursor is removed (e.g. the pop-over
  // unmounting after a section is picked), so re-check the real pointer target while focused.
  useEffect(() => {
    if (!focusMode) return;
    const onMove = (e: PointerEvent) => {
      if (wrap.current?.contains(e.target as Node)) enter();
      else leave();
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) leave();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseout", onOut);
    };
  }, [focusMode, enter, leave]);

  useEffect(() => setOpenId(null), [activeKey]);
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  return (
    <>
      <AnimatePresence>
        {focusMode ? (
          <motion.div
            key="dock-focus"
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22 }}
            className="pointer-events-none fixed inset-0 z-[65] hidden md:block"
            style={{
              backdropFilter: "blur(7px) saturate(1.1)",
              WebkitBackdropFilter: "blur(7px) saturate(1.1)",
              background: "color-mix(in oklab, var(--bg) 28%, transparent)",
            }}
          />
        ) : null}
      </AnimatePresence>
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] hidden justify-center md:flex">
      <motion.div
        ref={wrap}
        onMouseEnter={enter}
        initial={reduce ? false : { y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => {
          mouseX.set(Infinity);
          leave();
        }}
        className="panel-dock pointer-events-auto flex items-end gap-2.5 rounded-[26px] border border-[var(--border-strong)] px-3.5 pb-2 pt-2.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        style={{ background: "color-mix(in oklab, var(--bg-elevated) 72%, transparent)" }}
        role="menubar"
      >
        {nodes.map((n) => (
          <DockItem
            key={n.id}
            node={n}
            mouseX={mouseX}
            reduce={reduce}
            open={openId === n.id}
            onToggle={() => setOpenId((cur) => (cur === n.id ? null : n.id))}
            onNavigate={() => setOpenId(null)}
            onPick={() => {
              setOpenId(null);
              mouseX.set(Infinity);
              leave();
            }}
          />
        ))}
      </motion.div>
    </div>
    </>
  );
}
