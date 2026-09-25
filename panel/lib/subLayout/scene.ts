import { safeCssValue } from "./css";
import type { SceneActor, SceneLoopMode, SceneProps, SceneStep, SceneTone } from "./types";

export const SCENE_TONES: SceneTone[] = ["accent", "green", "amber", "rose", "blue"];

/** Defaults of a new scene node: device -> app -> internet. */
export function defaultSceneProps(): SceneProps {
  return {
    actors: [
      { id: "a", label: "Device", icon: "smartphone", x: 14, y: 50 },
      { id: "b", label: "Protected", icon: "shield", x: 50, y: 50, tone: "green" },
      { id: "c", label: "Internet", icon: "globe", x: 86, y: 50, tone: "blue" },
    ],
    links: [["a", "b"], ["b", "c"]],
    steps: [
      { caption: "Your device", show: ["a"], focus: ["a"] },
      { caption: "Traffic is encrypted", show: ["a", "b"], focus: ["b"], flows: [{ from: "a", to: "b" }] },
      { caption: "And reaches the internet", show: ["a", "b", "c"], focus: ["c"], flows: [{ from: "b", to: "c", tone: "green" }] },
    ],
    autoplay: true,
    loop: true,
    stepMs: 2600,
    height: 240,
    showCaption: true,
    showControls: true,
  };
}

/** Reads the loose props map into a safe shape (bad data never throws). */
export function readScene(props: Record<string, unknown>): Required<Pick<SceneProps, "actors" | "links" | "steps">> & Omit<SceneProps, "actors" | "links" | "steps"> {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const actors = (Array.isArray(props.actors) ? props.actors : []).filter((a): a is SceneActor => !!a && typeof a === "object" && typeof (a as SceneActor).id === "string");
  const links = (Array.isArray(props.links) ? props.links : []).filter((l): l is [string, string] => Array.isArray(l) && l.length >= 2);
  const steps = (Array.isArray(props.steps) ? props.steps : []).filter((s): s is SceneStep => !!s && typeof s === "object").map((s) => ({ ...s, show: Array.isArray(s.show) ? s.show : [] }));
  const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : d);
  const clampN = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, num(v, d)));
  const tones: Partial<Record<SceneTone, string>> = {};
  if (props.tones && typeof props.tones === "object") for (const t of SCENE_TONES) {
    const c = (props.tones as Record<string, unknown>)[t];
    if (typeof c === "string" && safeCssValue(c)) tones[t] = safeCssValue(c);
  }
  const loopMode: SceneLoopMode = oneOf(props.loopMode, ["loop", "once", "ping-pong"] as const, props.loop === false ? "once" : "loop");
  return {
    actors,
    links,
    steps: steps.map((s) => ({ ...s, ...(typeof s.ms === "number" && s.ms >= 300 ? { ms: s.ms } : { ms: undefined }), condition: typeof s.condition === "string" && s.condition.trim() ? s.condition : undefined })),
    autoplay: props.autoplay !== false,
    loop: loopMode !== "once",
    loopMode,
    stepMs: Math.max(600, num(props.stepMs, 2600)),
    height: Math.max(80, num(props.height, 240)),
    showCaption: props.showCaption !== false,
    showControls: props.showControls !== false,
    speed: clampN(props.speed, 0.25, 4, 1),
    transition: oneOf(props.transition, ["fade", "slide", "scale"] as const, "scale"),
    flowDir: oneOf(props.flowDir, ["forward", "reverse", "both"] as const, "forward"),
    flowSpeed: clampN(props.flowSpeed, 0.25, 4, 1),
    flowDots: Math.round(clampN(props.flowDots, 1, 5, 1)),
    start: oneOf(props.start, ["load", "visible", "click"] as const, "load"),
    pauseOnHover: props.pauseOnHover === true,
    showNumbers: props.showNumbers === true,
    actorSize: clampN(props.actorSize, 28, 96, 44),
    actorShape: oneOf(props.actorShape, ["circle", "rounded", "square"] as const, "rounded"),
    lineStyle: oneOf(props.lineStyle, ["solid", "dashed", "animated"] as const, "dashed"),
    tones,
  };
}

export const SCENE_PLAY_EVENT = "sublyt-scene-play";
export function playScene(nodeId: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SCENE_PLAY_EVENT, { detail: nodeId }));
}

/** Indexes of the steps that take part now: a step whose `condition` is false is skipped. */
export function activeStepIndexes(steps: SceneStep[], test: (condition: string) => boolean): number[] {
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (!s.condition || test(s.condition)) out.push(i);
  });
  return out;
}

/** Duration of a step in ms after the speed multiplier. */
export function stepDuration(step: SceneStep | undefined, stepMs: number, speed: number): number {
  return Math.max(200, Math.round((step?.ms && step.ms > 0 ? step.ms : stepMs) / Math.max(0.1, speed)));
}

/** Next position inside `count` active steps. `done` = playback ends (mode once at the last step). */
export function nextPosition(pos: number, dir: 1 | -1, count: number, mode: SceneLoopMode): { pos: number; dir: 1 | -1; done: boolean } {
  if (count < 2) return { pos: 0, dir, done: mode === "once" };
  if (mode === "ping-pong") {
    let d = dir;
    if (pos + d >= count) d = -1;
    else if (pos + d < 0) d = 1;
    return { pos: pos + d, dir: d, done: false };
  }
  if (pos < count - 1) return { pos: pos + 1, dir: 1, done: false };
  return mode === "loop" ? { pos: 0, dir: 1, done: false } : { pos, dir: 1, done: true };
}
