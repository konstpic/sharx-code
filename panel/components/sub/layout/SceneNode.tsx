"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { activeStepIndexes, nextPosition, readScene, SCENE_PLAY_EVENT, stepDuration } from "@/lib/subLayout/scene";
import { evalCondition, renderTemplate, type Ctx } from "@/lib/subLayout/template";
import type { SceneTone } from "@/lib/subLayout/types";
import { NodeIcon } from "./icons";

const TONE: Record<SceneTone, string> = {
  accent: "var(--sub-accent, #22d3ee)",
  green: "var(--sub-success, #3fb950)",
  amber: "#f0b429",
  rose: "var(--sub-danger, #f85149)",
  blue: "#38bdf8",
};

type Props = {
  id: string;
  props: Record<string, unknown>;
  scope: Ctx;
  lang: string;
  edit: boolean;
  common: Record<string, unknown>;
  css: CSSProperties;
};

/** Animated explainer scene driven entirely by node props (actors, links, steps). */
export function SceneNode({ id, props, scope, lang, edit, common, css }: Props) {
  const sc = useMemo(() => readScene(props), [props]);
  const reduce = useReducedMotion() === true;
  const boxRef = useRef<HTMLDivElement>(null);
  const tones = useMemo(() => ({ ...TONE, ...sc.tones }) as Record<SceneTone, string>, [sc.tones]);

  // Steps whose condition is false are skipped (data-driven scenes).
  const active = useMemo(() => activeStepIndexes(sc.steps, (c) => evalCondition(c, scope, { lang }).value), [sc.steps, scope, lang]);
  const n = active.length;
  const [pos, setPos] = useState(reduce ? Math.max(0, n - 1) : 0);
  const dirRef = useRef<1 | -1>(1);
  const startsOnLoad = edit || sc.start === "load";
  const [playing, setPlaying] = useState(sc.autoplay !== false && !reduce && startsOnLoad);
  const [round, setRound] = useState(0);
  const [hover, setHover] = useState(false);
  const cur = Math.min(pos, Math.max(0, n - 1));
  const stepIdx = active[cur] ?? -1;
  const step0 = stepIdx >= 0 ? sc.steps[stepIdx] : undefined;
  const running = playing && !(sc.pauseOnHover && hover && !edit);

  const tpl = useCallback((s: unknown) => renderTemplate(String(s ?? ""), scope, { lang }).out, [scope, lang]);

  useEffect(() => {
    if (!running || reduce || n < 2) return;
    const t = window.setTimeout(() => {
      const nx = nextPosition(cur, dirRef.current, n, sc.loopMode ?? "loop");
      dirRef.current = nx.dir;
      setPos(nx.pos);
      if (nx.done) setPlaying(false);
    }, stepDuration(step0, sc.stepMs ?? 2600, sc.speed ?? 1));
    return () => window.clearTimeout(t);
  }, [running, reduce, cur, n, sc.loopMode, sc.stepMs, sc.speed, step0]);

  // Start when the scene scrolls into view.
  useEffect(() => {
    if (edit || sc.start !== "visible" || sc.autoplay === false || reduce) return;
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setPlaying(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setPlaying(true);
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [edit, sc.start, sc.autoplay, reduce]);

  useEffect(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent).detail !== id) return;
      setPos(0);
      dirRef.current = 1;
      setRound((r) => r + 1);
      setPlaying(true);
    };
    window.addEventListener(SCENE_PLAY_EVENT, h);
    return () => window.removeEventListener(SCENE_PLAY_EVENT, h);
  }, [id]);

  const byId = useMemo(() => new Map(sc.actors.map((a) => [a.id, a])), [sc.actors]);
  const shown = new Set(step0?.show ?? []);
  const focus = new Set(step0?.focus ?? []);
  const caption = step0 ? tpl(step0.caption) : "";
  const pct = (v: number) => `${Math.min(100, Math.max(0, Number(v) || 0))}%`;
  const size = sc.actorSize ?? 44;
  const radius = sc.actorShape === "circle" ? "50%" : sc.actorShape === "square" ? 4 : Math.round(size * 0.36);
  const trans = sc.transition ?? "scale";
  const dots = sc.flowDots ?? 1;
  const flowDur = 1.5 / ((sc.flowSpeed ?? 1) * (sc.speed ?? 1));
  const line = sc.lineStyle ?? "dashed";

  return (
    <div {...common} style={{ ...css, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div
        ref={boxRef}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          if (!edit && sc.start === "click" && !playing) setPlaying(true);
        }}
        style={{
          position: "relative",
          width: "100%",
          height: sc.height,
          overflow: "hidden",
          borderRadius: 20,
          border: "1px solid var(--sub-border, rgba(255,255,255,.12))",
          background: "radial-gradient(60% 70% at 50% 45%, color-mix(in oklab, var(--sub-accent-ambient, #9775fa) 14%, transparent), transparent), var(--sub-surface, rgba(255,255,255,.05))",
          pointerEvents: edit ? "none" : undefined,
          cursor: !edit && sc.start === "click" && !playing ? "pointer" : undefined,
        }}
        role="img"
        aria-label={caption}
      >
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {sc.links.map(([f, t]) => {
            const A = byId.get(f);
            const B = byId.get(t);
            if (!A || !B) return null;
            const vis = shown.has(f) && shown.has(t);
            return (
              <motion.line
                key={`${f}-${t}`}
                x1={A.x}
                y1={A.y}
                x2={B.x}
                y2={B.y}
                stroke="var(--sub-fg-muted, #8b949e)"
                strokeWidth={1.4}
                strokeDasharray={line === "solid" ? undefined : "3 3"}
                vectorEffect="non-scaling-stroke"
                initial={false}
                animate={{ opacity: vis ? 0.45 : 0, ...(line === "animated" && !reduce ? { strokeDashoffset: [0, -6] } : {}) }}
                transition={{ opacity: { duration: reduce ? 0 : 0.4 }, strokeDashoffset: { duration: 0.8 / (sc.speed ?? 1), repeat: Infinity, ease: "linear" } }}
              />
            );
          })}
        </svg>

        {sc.actors.map((a) => {
          const visible = shown.has(a.id);
          const isFocus = focus.has(a.id);
          const color = tones[a.tone ?? "accent"] ?? tones.accent;
          const dim = visible && focus.size > 0 && !isFocus;
          return (
            <motion.div
              key={a.id}
              style={{ position: "absolute", left: pct(a.x), top: pct(a.y), width: 96, marginLeft: -48, marginTop: -(size / 2 + 4), display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textAlign: "center", zIndex: 2 }}
              initial={false}
              animate={{
                opacity: visible ? (dim ? 0.5 : 1) : 0,
                scale: trans === "scale" ? (visible ? (isFocus ? 1.1 : 1) : 0.6) : isFocus ? 1.08 : 1,
                y: trans === "slide" ? (visible ? 0 : 16) : 0,
              }}
              transition={reduce ? { duration: 0 } : trans === "fade" ? { duration: 0.45 } : { type: "spring", stiffness: 260, damping: 22 }}
            >
              <motion.span
                style={{ display: "grid", placeItems: "center", width: size, height: size, borderRadius: radius, color, border: `1px solid color-mix(in oklab, ${color} 55%, transparent)`, background: "var(--sub-surface, #161b22)" }}
                animate={{ boxShadow: isFocus ? `0 0 0 3px color-mix(in oklab, ${color} 22%, transparent), 0 0 24px color-mix(in oklab, ${color} 45%, transparent)` : "0 0 0 0 transparent" }}
                transition={{ duration: reduce ? 0 : 0.4 }}
              >
                <NodeIcon name={a.icon} size={Math.round(size * 0.45)} />
              </motion.span>
              <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, color: "var(--sub-fg, #c9d1d9)" }}>{tpl(a.label)}</span>
            </motion.div>
          );
        })}

        {!reduce
          ? (step0?.flows ?? []).flatMap((f, i) => {
              const A0 = byId.get(f.from);
              const B0 = byId.get(f.to);
              if (!A0 || !B0) return [];
              const A = sc.flowDir === "reverse" ? B0 : A0;
              const B = sc.flowDir === "reverse" ? A0 : B0;
              const both = sc.flowDir === "both";
              const color = tones[f.tone ?? "accent"] ?? tones.accent;
              return Array.from({ length: dots }, (_, k) => (
                <motion.span
                  key={`${round}-${cur}-${i}-${k}`}
                  style={{ position: "absolute", zIndex: 3, width: 10, height: 10, borderRadius: 99, background: color, boxShadow: `0 0 12px 2px ${color}`, marginLeft: -5, marginTop: -5 }}
                  initial={{ left: pct(A.x), top: pct(A.y), opacity: 0 }}
                  animate={{
                    left: both ? [pct(A.x), pct(B.x), pct(A.x)] : [pct(A.x), pct(B.x)],
                    top: both ? [pct(A.y), pct(B.y), pct(A.y)] : [pct(A.y), pct(B.y)],
                    opacity: both ? [0, 1, 1, 1, 0] : [0, 1, 1, 0],
                  }}
                  transition={{ duration: both ? flowDur * 2 : flowDur, repeat: Infinity, repeatDelay: 0.3, delay: i * 0.22 + (k * flowDur) / dots, ease: "easeInOut" }}
                />
              ));
            })
          : null}
      </div>

      {sc.showCaption !== false ? (
        <div style={{ minHeight: 22, textAlign: "center", fontSize: 14, color: "var(--sub-fg, #c9d1d9)" }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${cur}:${caption}`} initial={{ opacity: 0, y: reduce ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.25 }}>
              {sc.showNumbers && n > 1 ? `${cur + 1}/${n}  ` : ""}
              {caption}
            </motion.div>
          </AnimatePresence>
        </div>
      ) : null}

      {sc.showControls !== false && n > 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, pointerEvents: edit ? "none" : undefined }}>
          {!reduce ? (
            <>
              <button type="button" aria-label={running ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} style={ctl}>
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                type="button"
                aria-label="Replay"
                onClick={() => {
                  setPos(0);
                  dirRef.current = 1;
                  setRound((r) => r + 1);
                  setPlaying(true);
                }}
                style={ctl}
              >
                <RotateCcw size={14} />
              </button>
            </>
          ) : null}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {active.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Step ${i + 1}`}
                onClick={() => {
                  setPos(i);
                  setPlaying(false);
                }}
                style={
                  sc.showNumbers
                    ? { minWidth: 20, height: 20, padding: "0 4px", border: 0, borderRadius: 99, cursor: "pointer", fontSize: 10, fontWeight: 700, transition: "all .25s", color: i <= cur ? "var(--sub-on-accent, #04141a)" : "var(--sub-fg-muted, #8b949e)", background: i <= cur ? "var(--sub-accent, #22d3ee)" : "var(--sub-border, rgba(255,255,255,.2))" }
                    : { width: i === cur ? 22 : 8, height: 8, padding: 0, border: 0, borderRadius: 99, cursor: "pointer", transition: "all .25s", background: i <= cur ? "var(--sub-accent, #22d3ee)" : "var(--sub-border, rgba(255,255,255,.2))" }
                }
              >
                {sc.showNumbers ? i + 1 : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ctl: CSSProperties = { display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 99, cursor: "pointer", color: "var(--sub-fg, #c9d1d9)", background: "var(--sub-surface, rgba(255,255,255,.06))", border: "1px solid var(--sub-border, rgba(255,255,255,.12))" };
