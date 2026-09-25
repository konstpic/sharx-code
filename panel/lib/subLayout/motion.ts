import { cleanCss } from "./sanitizeHtml";
import { MOTION_PRESETS, MOTION_TRIGGERS, type Motion, type MotionPreset, type MotionTrigger } from "./types";

/**
 * Motion of a node -> CSS. Pure helpers: a normalized config, a stable key (one class + one @keyframes per distinct
 * config, shared by every node that uses it) and the CSS text. Nothing here reads a user string except
 * `customKeyframes`, which is filtered.
 */

/** Presets that play once by default (entrances); the others loop. */
const ENTRANCE = new Set<MotionPreset>(["fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom", "flip", "blur-in", "typewriter"]);

export const NAMED_EASINGS: Record<string, string> = {
  ease: "ease",
  linear: "linear",
  "ease-in": "ease-in",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  spring: "cubic-bezier(.34,1.56,.64,1)",
};

const CUBIC = /^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$/;
const STEPS = /^steps\(\s*\d{1,3}\s*(,\s*(start|end|jump-start|jump-end|jump-none|jump-both)\s*)?\)$/;

export function isEntrance(p: MotionPreset): boolean {
  return ENTRANCE.has(p);
}

export function safeEasing(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (NAMED_EASINGS[s]) return NAMED_EASINGS[s];
  if (CUBIC.test(s) || STEPS.test(s)) return s.replace(/\s+/g, "");
  return undefined;
}

/** Filters raw @keyframes body text: balanced braces only, no at-rules, urls or markup. Returns "" when unusable. */
export function safeKeyframes(body: unknown): string {
  if (typeof body !== "string") return "";
  const s = cleanCss(body).trim();
  if (!s || s.length > 2000 || /[@<>\\]|url\s*\(/i.test(s)) return "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return "";
  }
  return depth === 0 && s.includes("{") ? s : "";
}

const clamp = (n: unknown, lo: number, hi: number, d: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : d;
  return Math.min(hi, Math.max(lo, v));
};

export type MotionResolved = {
  preset: MotionPreset;
  duration: number;
  delay: number;
  easing: string;
  direction: NonNullable<Motion["direction"]>;
  iterations: number | "infinite";
  fillMode: NonNullable<Motion["fillMode"]>;
  distance: number;
  intensity: number;
  trigger: MotionTrigger;
  repeat: boolean;
  stagger: number;
  playState: "running" | "paused";
  customKeyframes: string;
};

/** Fills every missing field with the default of the preset. */
export function resolveMotion(m: Motion): MotionResolved {
  const preset = MOTION_PRESETS.includes(m.preset) ? m.preset : "none";
  const entrance = ENTRANCE.has(preset);
  const iterations = m.iterations === "infinite" ? "infinite" : typeof m.iterations === "number" && Number.isFinite(m.iterations) ? clamp(m.iterations, 1, 100, 1) : entrance ? 1 : "infinite";
  return {
    preset,
    duration: clamp(m.duration, 1, 60000, preset === "spin" ? 2000 : entrance ? 600 : 1600),
    delay: clamp(m.delay, 0, 60000, 0),
    easing: safeEasing(m.easing) ?? (preset === "spin" ? "linear" : "ease"),
    direction: (["normal", "reverse", "alternate", "alternate-reverse"] as const).includes(m.direction as never) ? (m.direction as MotionResolved["direction"]) : "normal",
    iterations,
    fillMode: (["none", "forwards", "backwards", "both"] as const).includes(m.fillMode as never) ? (m.fillMode as MotionResolved["fillMode"]) : entrance ? "both" : "none",
    distance: clamp(m.distance, 0, 1000, 24),
    intensity: clamp(m.intensity, 0, 100, 50),
    trigger: MOTION_TRIGGERS.includes(m.trigger as MotionTrigger) ? (m.trigger as MotionTrigger) : "load",
    repeat: m.repeat === true,
    stagger: clamp(m.stagger, 0, 5000, 0),
    playState: m.playState === "paused" ? "paused" : "running",
    customKeyframes: m.preset === "custom" ? safeKeyframes(m.customKeyframes) : "",
  };
}

/** Validates untrusted data into a Motion (undefined when there is nothing to keep). */
export function normalizeMotion(raw: unknown): Motion | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.preset !== "string" || !(MOTION_PRESETS as string[]).includes(r.preset)) return undefined;
  const m: Motion = { preset: r.preset as MotionPreset };
  const num = (k: keyof Motion, lo: number, hi: number) => {
    const v = r[k as string];
    if (typeof v === "number" && Number.isFinite(v)) (m as unknown as Record<string, unknown>)[k] = clamp(v, lo, hi, v);
  };
  num("duration", 1, 60000);
  num("delay", 0, 60000);
  num("distance", 0, 1000);
  num("intensity", 0, 100);
  num("stagger", 0, 5000);
  const easing = safeEasing(r.easing);
  if (easing) m.easing = typeof r.easing === "string" && NAMED_EASINGS[r.easing.trim().toLowerCase()] ? r.easing.trim().toLowerCase() : easing;
  if (typeof r.direction === "string" && ["normal", "reverse", "alternate", "alternate-reverse"].includes(r.direction)) m.direction = r.direction as Motion["direction"];
  if (r.iterations === "infinite") m.iterations = "infinite";
  else if (typeof r.iterations === "number" && Number.isFinite(r.iterations)) m.iterations = clamp(r.iterations, 1, 100, 1);
  if (typeof r.fillMode === "string" && ["none", "forwards", "backwards", "both"].includes(r.fillMode)) m.fillMode = r.fillMode as Motion["fillMode"];
  if (typeof r.trigger === "string" && (MOTION_TRIGGERS as string[]).includes(r.trigger)) m.trigger = r.trigger as MotionTrigger;
  if (r.repeat === true) m.repeat = true;
  if (r.playState === "paused") m.playState = "paused";
  if (m.preset === "custom") {
    const kf = safeKeyframes(r.customKeyframes);
    if (kf) m.customKeyframes = kf;
  }
  return m;
}

/** Stable short hash of the resolved config: the same look shares one class and one @keyframes rule. */
export function motionKey(m: Motion): string {
  const r = resolveMotion(m);
  const s = JSON.stringify(r);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const motionClass = (m: Motion): string => `lm lm-${motionKey(m)} lm-t-${resolveMotion(m).trigger}${resolveMotion(m).repeat ? " lm-rep" : ""}`;

const n = (v: number) => String(Math.round(v * 100) / 100);

/** Body of the @keyframes rule of a preset ("" for none). */
export function keyframesBody(r: MotionResolved): string {
  const d = r.distance;
  const k = r.intensity / 50; // 1 = default strength
  switch (r.preset) {
    case "fade":
      return "from{opacity:0}to{opacity:1}";
    case "slide-up":
      return `from{opacity:0;transform:translateY(${n(d)}px)}to{opacity:1;transform:none}`;
    case "slide-down":
      return `from{opacity:0;transform:translateY(${n(-d)}px)}to{opacity:1;transform:none}`;
    case "slide-left":
      return `from{opacity:0;transform:translateX(${n(d)}px)}to{opacity:1;transform:none}`;
    case "slide-right":
      return `from{opacity:0;transform:translateX(${n(-d)}px)}to{opacity:1;transform:none}`;
    case "zoom":
      return `from{opacity:0;transform:scale(${n(Math.max(0.05, 1 - 0.45 * k))})}to{opacity:1;transform:none}`;
    case "flip":
      return `from{opacity:0;transform:perspective(600px) rotateY(${n(Math.min(180, 90 * k))}deg)}to{opacity:1;transform:perspective(600px) rotateY(0)}`;
    case "blur-in":
      return `from{opacity:0;filter:blur(${n(10 * k)}px)}to{opacity:1;filter:blur(0)}`;
    case "bounce":
      return `0%,100%{transform:translateY(0);animation-timing-function:cubic-bezier(.2,.7,.4,1)}50%{transform:translateY(${n(-d * k)}px);animation-timing-function:cubic-bezier(.6,0,.8,.3)}`;
    case "pulse":
      return `0%,100%{transform:scale(1)}50%{transform:scale(${n(1 + 0.08 * k)})}`;
    case "float":
      return `0%,100%{transform:translateY(0)}50%{transform:translateY(${n(-d * 0.5 * k)}px)}`;
    case "shake":
      return `0%,100%{transform:translateX(0)}20%{transform:translateX(${n(-d * 0.25 * k)}px)}40%{transform:translateX(${n(d * 0.25 * k)}px)}60%{transform:translateX(${n(-d * 0.15 * k)}px)}80%{transform:translateX(${n(d * 0.15 * k)}px)}`;
    case "spin":
      return "from{transform:rotate(0)}to{transform:rotate(360deg)}";
    case "glow":
      return `0%,100%{filter:drop-shadow(0 0 0 transparent)}50%{filter:drop-shadow(0 0 ${n(10 * k)}px var(--sub-accent,#22d3ee))}`;
    case "shimmer":
      return "from{-webkit-mask-position:150% 0;mask-position:150% 0}to{-webkit-mask-position:-50% 0;mask-position:-50% 0}";
    case "typewriter":
      return "from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}";
    case "custom":
      return r.customKeyframes;
    default:
      return "";
  }
}

/** CSS rules of one config under the given key (class `.lm-<key>`). Empty for preset none / unusable custom. */
export function motionCss(m: Motion): { key: string; css: string } {
  const key = motionKey(m);
  const r = resolveMotion(m);
  const body = keyframesBody(r);
  if (!body) return { key, css: "" };
  const name = `lmk-${key}`;
  const easing = r.preset === "typewriter" && !safeEasing(m.easing) ? "steps(24,end)" : r.easing;
  const anim = `${name} ${r.duration}ms ${easing} calc(${r.delay}ms + var(--lm-i,0) * var(--lm-st,0ms)) ${r.iterations} ${r.direction} ${r.fillMode}`;
  const extra = r.preset === "shimmer" ? "-webkit-mask-image:linear-gradient(110deg,#000 38%,rgba(0,0,0,.35) 50%,#000 62%);mask-image:linear-gradient(110deg,#000 38%,rgba(0,0,0,.35) 50%,#000 62%);-webkit-mask-size:250% 100%;mask-size:250% 100%;" : "";
  const c = `.sublyt-root .lm-${key}`;
  const paused = r.playState === "paused" ? "animation-play-state:paused!important;" : "";
  let css = `@keyframes ${name}{${body}}`;
  switch (r.trigger) {
    case "hover":
      css += `${c}:hover{animation:${anim};${extra}${paused}}`;
      break;
    case "focus":
      css += `${c}:focus-within{animation:${anim};${extra}${paused}}`;
      break;
    case "load":
      css += `${c}{animation:${anim};${extra}${paused}}`;
      break;
    case "scroll-progress":
      css += `${c}{animation:${anim};${extra}animation-play-state:paused}${c}[data-motion="active"]{animation-play-state:running}`;
      css += `@supports (animation-timeline:view()){${c}{animation-timeline:view();animation-range:entry 0% cover 40%;animation-play-state:running;animation-fill-mode:both}}${paused ? `${c}{${paused}}` : ""}`;
      break;
    default: // visible, click: paused until the controller marks it active
      css += `${c}{animation:${anim};${extra}animation-play-state:paused}${c}[data-motion="active"]{animation-play-state:running}${paused ? `${c}{${paused}}` : ""}`;
  }
  return { key, css };
}

/** One stylesheet for many motions (deduplicated). */
export function motionSheet(motions: Motion[]): string {
  const seen = new Set<string>();
  let out = "";
  for (const m of motions) {
    if (!m || m.preset === "none") continue;
    const { key, css } = motionCss(m);
    if (!css || seen.has(key)) continue;
    seen.add(key);
    out += css;
  }
  return out;
}

/** Static rules shared by all motions (edit-mode hit-testing safety, replay). */
export const MOTION_BASE_CSS =
  `.sublyt-root[data-sublyt="edit"] .lm-t-load:hover,.sublyt-root[data-sublyt="edit"] .lm-t-visible:hover,.sublyt-root[data-sublyt="edit"] .lm-t-click:hover,.sublyt-root[data-sublyt="edit"] .lm-t-scroll-progress:hover{animation-play-state:paused!important}`;

export const MOTION_REPLAY_EVENT = "sublyt-motion-replay";
export function replayMotion(nodeId?: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MOTION_REPLAY_EVENT, { detail: nodeId ?? null }));
}

/** Per-child variables for the stagger of a frame (index in order). */
export function staggerVars(parent: Motion | undefined, index: number): Record<string, string | number> | undefined {
  if (!parent) return undefined;
  const st = resolveMotion(parent).stagger;
  if (st <= 0 || parent.preset === "none") return undefined;
  return { "--lm-i": index, "--lm-st": `${st}ms` };
}
