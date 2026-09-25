"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { LayoutDoc } from "@/lib/subLayout/types";

type Hist = { doc: LayoutDoc; sel: string[] };

export type DState = {
  doc: LayoutDoc;
  sel: string[];
  past: Hist[];
  future: Hist[];
  dirty: boolean;
  lastKey?: string;
  lastAt: number;
};

type Action =
  | { type: "commit"; doc: LayoutDoc; sel?: string[]; key?: string }
  | { type: "select"; ids: string[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: LayoutDoc }
  | { type: "saved" };

const LIMIT = 200;
const COALESCE_MS = 900;

function reducer(s: DState, a: Action): DState {
  switch (a.type) {
    case "commit": {
      if (a.doc === s.doc) return a.sel ? { ...s, sel: a.sel } : s;
      const now = Date.now();
      const merge = a.key !== undefined && a.key === s.lastKey && now - s.lastAt < COALESCE_MS && s.past.length > 0;
      const past = merge ? s.past : [...s.past, { doc: s.doc, sel: s.sel }].slice(-LIMIT);
      return { ...s, doc: a.doc, sel: a.sel ?? s.sel, past, future: [], dirty: true, lastKey: a.key, lastAt: now };
    }
    case "select":
      return { ...s, sel: a.ids, lastKey: undefined };
    case "undo": {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { ...s, doc: prev.doc, sel: prev.sel, past: s.past.slice(0, -1), future: [{ doc: s.doc, sel: s.sel }, ...s.future].slice(0, LIMIT), dirty: true, lastKey: undefined };
    }
    case "redo": {
      const next = s.future[0];
      if (!next) return s;
      return { ...s, doc: next.doc, sel: next.sel, past: [...s.past, { doc: s.doc, sel: s.sel }].slice(-LIMIT), future: s.future.slice(1), dirty: true, lastKey: undefined };
    }
    case "reset":
      return { doc: a.doc, sel: [], past: [], future: [], dirty: false, lastAt: 0 };
    case "saved":
      return { ...s, dirty: false };
  }
}

export function useDesignerState(initial: LayoutDoc) {
  const [state, dispatch] = useReducer(reducer, initial, (doc): DState => ({ doc, sel: [], past: [], future: [], dirty: false, lastAt: 0 }));
  const commit = useCallback((doc: LayoutDoc, opts?: { sel?: string[]; key?: string }) => dispatch({ type: "commit", doc, sel: opts?.sel, key: opts?.key }), []);
  const select = useCallback((ids: string[]) => dispatch({ type: "select", ids }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const reset = useCallback((doc: LayoutDoc) => dispatch({ type: "reset", doc }), []);
  const saved = useCallback(() => dispatch({ type: "saved" }), []);
  return useMemo(
    () => ({ state, commit, select, undo, redo, reset, saved, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }),
    [state, commit, select, undo, redo, reset, saved],
  );
}
