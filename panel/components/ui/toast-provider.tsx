"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type ToastItem = {
  id: number;
  type: "success" | "error" | "info";
  message: string;
  /** Optional second line: a hint the user should not miss. */
  note?: string;
};

type ToastApi = {
  success: (message: string, note?: string) => void;
  error: (message: string, note?: string) => void;
  info: (message: string, note?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DURATION = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback(
    (type: ToastItem["type"], message: string, note?: string) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, type, message, note }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, DURATION);
    },
    [],
  );

  const value = useMemo<ToastApi>(
    () => ({
      success: (m, note) => push("success", m, note),
      error: (m, note) => push("error", m, note),
      info: (m, note) => push("info", m, note),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex max-w-sm flex-col gap-2 p-0 sm:bottom-6 sm:right-6">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <Toast key={t.id} item={t} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item }: { item: ToastItem }) {
  const reduce = useReducedMotion();

  const color =
    item.type === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : item.type === "error"
        ? "border-red-500/40 bg-red-500/10 text-red-100"
        : "border-[var(--border)] bg-[var(--bg-elevated)]/95 text-[var(--fg)]";

  const Icon =
    item.type === "success"
      ? CheckCircle2
      : item.type === "error"
        ? AlertTriangle
        : Info;

  return (
    <motion.div
      layout
      className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md ${color}`}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
      transition={
        reduce
          ? { duration: 0 }
          : { type: "spring", stiffness: 480, damping: 32, mass: 0.7 }
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0 opacity-85" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block">{item.message}</span>
        {item.note ? (
          <span className="mt-1 block text-xs opacity-80">{item.note}</span>
        ) : null}
      </span>
    </motion.div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
