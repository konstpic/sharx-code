"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const STEP_MS = 4200;

/** Step state and autoplay shared by every animated scene. */
export function useScenePlayer(count: number, resetKey: string) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || reduce) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % count), STEP_MS);
    return () => window.clearTimeout(id);
  }, [count, step, playing, reduce]);

  useEffect(() => {
    setStep(0);
    setPlaying(true);
  }, [resetKey]);

  const replay = useCallback(() => {
    setStep(0);
    setPlaying(true);
  }, []);

  return { step, setStep, playing, setPlaying, replay, reduce: !!reduce, count };
}

export type ScenePlayer = ReturnType<typeof useScenePlayer>;

/** Caption, play/pause/replay and the step progress bars under a scene. */
export function ScenePlayerBar({ player, caption, compact = false }: { player: ScenePlayer; caption: string; compact?: boolean }) {
  const { t } = useTranslation();
  const { step, playing, reduce } = player;
  return (
    <>
      <div className={`mt-3 flex items-start gap-3 ${compact ? "min-h-[3.25rem]" : "min-h-[3.75rem]"}`}>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={step}
              className="text-sm leading-snug text-[var(--fg)]"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {caption}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            aria-label={playing ? t("pages.help.scenes.player.pause") : t("pages.help.scenes.player.play")}
            onClick={() => player.setPlaying((p) => !p)}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            aria-label={t("pages.help.scenes.player.replay")}
            onClick={player.replay}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1.5" role="tablist">
        {Array.from({ length: player.count }).map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === step}
            aria-label={t("pages.help.scenes.player.step", { n: i + 1 })}
            onClick={() => {
              player.setStep(i);
              player.setPlaying(false);
            }}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_14%,transparent)]"
          >
            <motion.span
              className="block h-full rounded-full bg-[var(--accent)]"
              initial={i === step && playing && !reduce ? { width: "0%" } : false}
              animate={{ width: i <= step ? "100%" : "0%", opacity: i <= step ? 1 : 0 }}
              transition={{ duration: i === step && playing && !reduce ? STEP_MS / 1000 : 0.2, ease: "linear" }}
              key={`${i}-${step === i ? step : "x"}-${playing}`}
            />
          </button>
        ))}
      </div>
    </>
  );
}
