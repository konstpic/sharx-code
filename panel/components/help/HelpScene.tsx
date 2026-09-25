"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SCENES, type Scene, type SceneActor, type Tone } from "@/components/help/scenes";

const TONE: Record<Tone, string> = {
  accent: "var(--accent)",
  green: "#22c55e",
  amber: "#f59e0b",
  rose: "#f43f5e",
  blue: "#38bdf8",
};

const STEP_MS = 3800;

function Actor({ actor, visible, focus, down, label, sub }: { actor: SceneActor; visible: boolean; focus: boolean; down: boolean; label: string; sub?: string }) {
  const Icon = actor.icon;
  const color = down ? TONE.rose : TONE[actor.tone ?? "accent"];
  return (
    <motion.div
      className="pointer-events-none absolute z-10 flex w-24 flex-col items-center gap-1 text-center"
      style={{ left: `${actor.x}%`, top: `${actor.y}%`, x: "-50%", y: "-50%" }}
      initial={false}
      animate={{ opacity: visible ? (down ? 0.6 : 1) : 0, scale: visible ? (focus ? 1.08 : 1) : 0.6 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
    >
      <motion.span
        className="relative grid size-11 place-items-center rounded-2xl border bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] backdrop-blur-sm"
        style={{ borderColor: `color-mix(in oklab, ${color} 55%, transparent)`, color }}
        animate={{ boxShadow: focus ? `0 0 0 3px color-mix(in oklab, ${color} 22%, transparent), 0 0 24px color-mix(in oklab, ${color} 45%, transparent)` : "0 0 0 0 transparent" }}
        transition={{ duration: 0.4 }}
      >
        <Icon size={20} strokeWidth={1.9} />
        {down ? (
          <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-rose-500 text-white">
            <X size={11} strokeWidth={3} />
          </span>
        ) : null}
      </motion.span>
      <span className="text-[11px] font-medium leading-tight text-[var(--fg)]">{label}</span>
      {sub ? <span className="text-[10px] leading-tight text-[var(--fg-subtle)]">{sub}</span> : null}
    </motion.div>
  );
}

/** An animated diagram that explains a section: steps with captions, moving packets and highlighted parts. */
export function HelpScene({ sceneId, className = "", compact = false }: { sceneId: string; className?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const scene: Scene | undefined = SCENES[sceneId];
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!scene || !playing || reduce) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % scene.steps.length), STEP_MS);
    return () => window.clearTimeout(id);
  }, [scene, step, playing, reduce]);

  useEffect(() => {
    setStep(0);
    setPlaying(true);
  }, [sceneId]);

  const byId = useMemo(() => new Map((scene?.actors ?? []).map((x) => [x.id, x])), [scene]);
  const replay = useCallback(() => {
    setStep(0);
    setPlaying(true);
  }, []);

  if (!scene) return null;
  const cur = scene.steps[Math.min(step, scene.steps.length - 1)];
  const shown = new Set(cur.show);
  const down = new Set(cur.down ?? []);
  const focus = new Set(cur.focus ?? []);

  return (
    <div className={className}>
      <div
        className="panel-inset relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[var(--border)]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--fg) 9%, transparent) 1px, transparent 0), radial-gradient(60% 60% at 50% 40%, color-mix(in oklab, var(--accent) 10%, transparent), transparent)",
          backgroundSize: "22px 22px, 100% 100%",
        }}
        aria-label={t(scene.titleKey)}
        role="img"
      >
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {scene.links.map(([x, y]) => {
            const A = byId.get(x);
            const B = byId.get(y);
            if (!A || !B) return null;
            const vis = shown.has(x) && shown.has(y);
            const broken = down.has(x) || down.has(y);
            return (
              <motion.line
                key={`${x}-${y}`}
                x1={A.x}
                y1={A.y}
                x2={B.x}
                y2={B.y}
                stroke={broken ? TONE.rose : "var(--fg-subtle)"}
                strokeWidth={1.4}
                strokeDasharray={broken ? "2 3" : "0"}
                vectorEffect="non-scaling-stroke"
                initial={false}
                animate={{ opacity: vis ? (broken ? 0.55 : 0.35) : 0 }}
                transition={{ duration: 0.4 }}
              />
            );
          })}
        </svg>

        {scene.actors.map((actor) => (
          <Actor
            key={actor.id}
            actor={actor}
            visible={shown.has(actor.id)}
            focus={focus.has(actor.id)}
            down={down.has(actor.id)}
            label={t(actor.labelKey)}
            sub={actor.subKey ? t(actor.subKey) : undefined}
          />
        ))}

        {!reduce
          ? (cur.flows ?? []).map((f, i) => {
              const A = byId.get(f.from);
              const B = byId.get(f.to);
              if (!A || !B) return null;
              const color = TONE[f.tone ?? "accent"];
              return (
                <motion.span
                  key={`${step}-${i}`}
                  className="pointer-events-none absolute z-20 size-2.5 rounded-full"
                  style={{ background: color, boxShadow: `0 0 12px 2px ${color}`, x: "-50%", y: "-50%" }}
                  initial={{ left: `${A.x}%`, top: `${A.y}%`, opacity: 0 }}
                  animate={{ left: [`${A.x}%`, `${B.x}%`], top: [`${A.y}%`, `${B.y}%`], opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 0.3, delay: i * 0.22, ease: "easeInOut" }}
                />
              );
            })
          : null}
      </div>

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
              {t(cur.captionKey)}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            aria-label={playing ? t("pages.help.scenes.player.pause") : t("pages.help.scenes.player.play")}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            aria-label={t("pages.help.scenes.player.replay")}
            onClick={replay}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div className="mt-1 flex items-center gap-1.5" role="tablist">
        {scene.steps.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === step}
            aria-label={t("pages.help.scenes.player.step", { n: i + 1 })}
            onClick={() => {
              setStep(i);
              setPlaying(false);
            }}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--fg)_14%,transparent)]"
          >
            <motion.span
              className="block h-full rounded-full bg-[var(--accent)]"
              initial={i === step && playing && !reduce ? { width: "0%" } : false}
              animate={{ width: i <= step ? "100%" : "0%", opacity: i <= step ? 1 : 0 }}
              transition={{ duration: i === step && playing && !reduce ? STEP_MS / 1000 : 0.2, ease: "linear" }}
              key={`${i}-${step === i ? step : "x"}-${playing}`}
              style={{ originX: 0 }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
