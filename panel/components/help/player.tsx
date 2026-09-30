"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getBasePath } from "@/lib/paths";

export const STEP_MS = 4200;

/** Scenes that have a recorded Russian voice-over (public/assets/help-audio/ru/<scene>-<step>.mp3). */
const VOICED_SCENES = new Set(["welcome", "inbounds", "nodes", "balancers", "bundles", "hosts", "clients", "groups", "subpage"]);
/** Pause after a clip before the scene moves on to the next step. */
const VOICE_GAP_MS = 450;
const VOICE_KEY = "sharx.helpVoice";

function readVoicePref(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeVoicePref(on: boolean) {
  try {
    window.localStorage.setItem(VOICE_KEY, on ? "1" : "0");
  } catch {
    /* private mode: the choice just is not remembered */
  }
}

export function voiceClipUrl(scene: string, step: number): string {
  return `${getBasePath()}/assets/help-audio/ru/${scene}-${step + 1}.mp3`;
}

/** Step state and autoplay shared by every animated scene. */
export function useScenePlayer(count: number, resetKey: string) {
  const reduce = useReducedMotion();
  const { i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  // The voice-over is Russian only; it is opt-in (never starts on its own) and remembered per browser.
  // The button is offered in every UI language so it can be found; its label says the voice is Russian.
  const voiceAvailable = VOICED_SCENES.has(resetKey);
  const voiceRu = (i18n.language ?? "").toLowerCase().startsWith("ru");
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const [stepMs, setStepMs] = useState(STEP_MS);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => setVoiceOn(readVoicePref()), []);

  const voiceActive = voiceAvailable && voiceOn && !voiceFailed && playing;

  // Silent autoplay: a fixed time per step. With the voice on, the clip length drives the pace instead.
  useEffect(() => {
    if (!playing || reduce || voiceActive) return;
    setStepMs(STEP_MS);
    const id = window.setTimeout(() => setStep((s) => (s + 1) % count), STEP_MS);
    return () => window.clearTimeout(id);
  }, [count, step, playing, reduce, voiceActive]);

  // Voice-over: one clip per step; its end moves the scene on (and stops after the last step).
  useEffect(() => {
    if (!voiceActive) return;
    const audio = new Audio(voiceClipUrl(resetKey, step));
    audioRef.current = audio;
    let next: number | undefined;
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration)) setStepMs(Math.round(audio.duration * 1000) + VOICE_GAP_MS);
    });
    audio.addEventListener("ended", () => {
      next = window.setTimeout(() => {
        if (step + 1 < count) setStep(step + 1);
        else setPlaying(false);
      }, VOICE_GAP_MS);
    });
    audio.addEventListener("error", () => setVoiceFailed(true));
    audio.play().catch(() => {
      // Autoplay blocked (no user gesture yet) or the file is missing: fall back to the silent mode.
      setVoiceOn(false);
    });
    return () => {
      if (next !== undefined) window.clearTimeout(next);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [voiceActive, resetKey, step, count]);

  useEffect(() => {
    setStep(0);
    setPlaying(true);
    setVoiceFailed(false);
  }, [resetKey]);

  const replay = useCallback(() => {
    setStep(0);
    setPlaying(true);
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceFailed(false);
    setVoiceOn((on) => {
      writeVoicePref(!on);
      return !on;
    });
    setPlaying(true);
  }, []);

  return { step, setStep, playing, setPlaying, replay, reduce: !!reduce, count, voiceAvailable, voiceRu, voiceOn: voiceOn && !voiceFailed, toggleVoice, stepMs };
}

export type ScenePlayer = ReturnType<typeof useScenePlayer>;

/** Caption, play/pause/replay and the step progress bars under a scene. */
export function ScenePlayerBar({ player, caption, compact = false }: { player: ScenePlayer; caption: string; compact?: boolean }) {
  const { t } = useTranslation();
  const { step, playing, reduce, stepMs } = player;
  const voiceLabel = player.voiceOn
    ? t("pages.help.scenes.player.voiceOff", { defaultValue: player.voiceRu ? "Выключить озвучку" : "Turn the voice-over off" })
    : t("pages.help.scenes.player.voiceOn", { defaultValue: player.voiceRu ? "Включить озвучку" : "Voice-over (in Russian)" });
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
          {player.voiceAvailable ? (
            <button
              type="button"
              className={`grid size-8 place-items-center rounded-lg border text-[var(--fg-muted)] hover:text-[var(--fg)] ${
                player.voiceOn ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)]"
              }`}
              aria-pressed={player.voiceOn}
              aria-label={voiceLabel}
              title={voiceLabel}
              onClick={player.toggleVoice}
            >
              {player.voiceOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
          ) : null}
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
              // With the voice on the chosen step is narrated and the scene carries on from there.
              player.setPlaying(player.voiceOn);
            }}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_14%,transparent)]"
          >
            <motion.span
              className="block h-full rounded-full bg-[var(--accent)]"
              initial={i === step && playing && !reduce ? { width: "0%" } : false}
              animate={{ width: i <= step ? "100%" : "0%", opacity: i <= step ? 1 : 0 }}
              transition={{ duration: i === step && playing && !reduce ? stepMs / 1000 : 0.2, ease: "linear" }}
              key={`${i}-${step === i ? step : "x"}-${playing}-${step === i ? stepMs : 0}`}
            />
          </button>
        ))}
      </div>
    </>
  );
}
