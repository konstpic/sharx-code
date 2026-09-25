"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearTour, readTour, taskDone, writeTour, type TourApi, type TourSnapshot, type TourStep } from "./tourLogic";
import { stepById, trackById } from "./tourSteps";

export type TourPhase = "idle" | "choose" | "run";

export type TourController = ReturnType<typeof useTour>;

/** State machine of the designer tour. `snap` is what the designer currently looks like, `api` lets steps prepare it. */
export function useTour(snap: TourSnapshot, api: TourApi) {
  const [phase, setPhase] = useState<TourPhase>("idle");
  const [trackId, setTrackId] = useState("quick");
  const [index, setIndex] = useState(0);
  const [flash, setFlash] = useState(false);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const apiRef = useRef(api);
  apiRef.current = api;
  const base = useRef(snap);
  const armed = useRef(false);

  const track = trackById(trackId);
  const stepId = track?.steps[index];
  const step: TourStep | undefined = stepId ? stepById(stepId) : undefined;
  const total = track?.steps.length ?? 0;

  const persistStep = useCallback((t: string, i: number) => {
    const cur = readTour();
    writeTour({ ...cur, dismissed: true, track: t, step: i });
  }, []);

  const start = useCallback(
    (id: string, at = 0) => {
      const t = trackById(id);
      if (!t) return;
      const i = Math.max(0, Math.min(at, t.steps.length - 1));
      setTrackId(id);
      setIndex(i);
      setFlash(false);
      setPhase("run");
      persistStep(id, i);
    },
    [persistStep],
  );

  /** Shows the first screen where a track is chosen. `remember` marks it as shown so it never auto-starts again. */
  const openChooser = useCallback((remember = false) => {
    setPhase("choose");
    if (remember) writeTour({ done: false, dismissed: true });
  }, []);

  const close = useCallback(() => {
    setPhase("idle");
    setFlash(false);
    apiRef.current.setModal(null);
  }, []);

  const skip = useCallback(() => {
    writeTour({ done: false, dismissed: true });
    close();
  }, [close]);

  const finish = useCallback(
    (dontShowAgain = true) => {
      writeTour(dontShowAgain ? { done: true, dismissed: true } : { done: false, dismissed: false });
      close();
    },
    [close],
  );

  const goto = useCallback(
    (i: number) => {
      const t = trackById(trackId);
      if (!t) return;
      if (i >= t.steps.length) return finish(true);
      const n = Math.max(0, i);
      setIndex(n);
      setFlash(false);
      persistStep(trackId, n);
    },
    [trackId, finish, persistStep],
  );
  const next = useCallback(() => goto(index + 1), [goto, index]);
  const back = useCallback(() => goto(index - 1), [goto, index]);

  const reset = useCallback(() => {
    clearTour();
  }, []);

  /** A stored, unfinished run (closed the designer mid-tour), if any. */
  const resumeInfo = useCallback((): { track: string; step: number } | null => {
    const s = readTour();
    if (s.track && s.step !== undefined && trackById(s.track)) return { track: s.track, step: s.step };
    return null;
  }, []);

  // entering a step: prepare the designer, then remember the baseline for the hands-on condition
  useEffect(() => {
    if (phase !== "run" || !step) return;
    armed.current = false;
    if (!step.keepModal && snapRef.current.modal) apiRef.current.setModal(null);
    try {
      step.prepare?.(apiRef.current, snapRef.current);
    } catch {
      /* a failed prepare must never block the tour */
    }
    const tm = window.setTimeout(() => {
      base.current = snapRef.current;
      armed.current = true;
      if (step.task && taskDone(step.task, base.current, snapRef.current)) setFlash(true);
    }, 90);
    return () => window.clearTimeout(tm);
  }, [phase, trackId, index, step]);

  // hands-on: watch the designer state
  useEffect(() => {
    if (phase !== "run" || !step?.task || !armed.current || flash) return;
    if (taskDone(step.task, base.current, snap)) setFlash(true);
  }, [snap, phase, step, flash]);

  useEffect(() => {
    if (!flash) return;
    const tm = window.setTimeout(() => next(), 900);
    return () => window.clearTimeout(tm);
  }, [flash, next]);

  return { phase, trackId, index, total, step, flash, start, openChooser, skip, finish, next, back, reset, resumeInfo };
}
