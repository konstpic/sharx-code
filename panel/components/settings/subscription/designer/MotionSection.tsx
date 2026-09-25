"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { isEntrance, motionCss, NAMED_EASINGS, replayMotion, resolveMotion, safeEasing } from "@/lib/subLayout/motion";
import { MOTION_PRESETS, MOTION_TRIGGERS, type LNode, type Motion, type MotionPreset } from "@/lib/subLayout/types";
import type { D } from "./i18n";
import { CodeEditor, Note } from "./InspectorSections";
import { Check, Num, Pick, Row, Section, Slide, SmallBtn, TplField } from "./ui";

const PRESET_LABEL: Record<MotionPreset, string> = {
  none: "None",
  fade: "Fade in",
  "slide-up": "Slide up",
  "slide-down": "Slide down",
  "slide-left": "Slide from right",
  "slide-right": "Slide from left",
  zoom: "Zoom in",
  flip: "Flip",
  "blur-in": "Blur in",
  bounce: "Bounce",
  pulse: "Pulse",
  float: "Float",
  shake: "Shake",
  spin: "Spin",
  glow: "Glow",
  shimmer: "Shimmer",
  typewriter: "Typewriter",
  custom: "Custom keyframes",
};

const TRIGGER_LABEL: Record<string, string> = { load: "On load", visible: "When visible", hover: "On hover", click: "On click", focus: "On focus", "scroll-progress": "With scroll" };

/** Tiny looping preview of the chosen motion (uses the same CSS generator as the page). */
function Preview({ m, bump }: { m: Motion; bump: number }) {
  const cfg: Motion = useMemo(() => ({ ...m, trigger: "load", playState: "running", delay: 0, stagger: 0, iterations: "infinite", direction: isEntrance(m.preset) ? "alternate" : m.direction, fillMode: "both", duration: Math.min(resolveMotion(m).duration, 2500) }), [m]);
  const { key, css } = useMemo(() => motionCss(cfg), [cfg]);
  return (
    <div className="sublyt-root grid h-14 place-items-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]" aria-hidden>
      <style>{css}</style>
      <div key={`${key}:${bump}`} className={css ? `lm-${key}` : ""} style={{ width: 84, height: 22, borderRadius: 8, background: "linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 50%, #9775fa))", color: "#04141a", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center" }}>
        Sample
      </div>
    </div>
  );
}

export function MotionSection({ node, d, onChange }: { node: LNode; d: D; onChange: (m: Motion | undefined, key: string) => void }) {
  const m = node.motion;
  const [bump, setBump] = useState(0);
  const preset: MotionPreset = m?.preset ?? "none";
  const r = resolveMotion(m ?? { preset: "none" });
  const set = (patch: Partial<Motion>) => onChange({ ...(m ?? { preset: "none" }), ...patch }, `${node.id}:motion:${Object.keys(patch).join(",")}`);
  const strip = (patch: Partial<Motion>) => {
    // A cleared field goes back to the default of the preset.
    const next = { ...(m ?? { preset: "none" }), ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(next as unknown as Motion, `${node.id}:motion:${Object.keys(patch).join(",")}`);
  };
  const isBox = node.type === "frame" || node.type === "repeat";
  const easingId = m?.easing && NAMED_EASINGS[m.easing] ? m.easing : m?.easing ? "custom" : "default";
  const [customEase, setCustomEase] = useState(easingId === "custom" ? (m?.easing ?? "") : "cubic-bezier(.4,0,.2,1)");
  const usesDistance = ["slide-up", "slide-down", "slide-left", "slide-right", "bounce", "float", "shake"].includes(preset);
  const usesIntensity = ["zoom", "flip", "blur-in", "bounce", "pulse", "float", "shake", "glow"].includes(preset);
  const replay = () => {
    setBump((b) => b + 1);
    replayMotion(node.id);
  };

  return (
    <Section title={d("sec.motion", "Animation")} defaultOpen={!!m && preset !== "none"}>
      <Row label={d("mo.preset", "Effect")}>
        <Pick value={preset} onChange={(v) => (v === "none" ? onChange(undefined, `${node.id}:motion:preset`) : set({ preset: v }))} options={MOTION_PRESETS.map((p) => ({ id: p, label: d(`mo.p.${p}`, PRESET_LABEL[p]) }))} />
      </Row>
      {preset === "none" ? <Note>{d("mo.noneHint", "Pick an effect to animate this element.")}</Note> : null}
      {preset !== "none" && m ? (
        <>
          <Preview m={m} bump={bump} />
          <div className="flex gap-1.5">
            <SmallBtn title={d("mo.replay", "Replay")} onClick={replay}>
              <RotateCcw size={14} /> {d("mo.replay", "Replay")}
            </SmallBtn>
            <SmallBtn title={r.playState === "paused" ? d("mo.play", "Play") : d("mo.pause", "Pause")} active={r.playState === "paused"} onClick={() => strip({ playState: r.playState === "paused" ? undefined : "paused" })}>
              {r.playState === "paused" ? <Play size={14} /> : <Pause size={14} />}
            </SmallBtn>
          </div>
          <Row label={d("mo.trigger", "Start")}>
            <Pick value={r.trigger} onChange={(v) => strip({ trigger: v === "load" ? undefined : v })} options={MOTION_TRIGGERS.map((t) => ({ id: t, label: d(`mo.t.${t}`, TRIGGER_LABEL[t]) }))} />
          </Row>
          {r.trigger === "visible" ? <Check checked={r.repeat} onChange={(v) => strip({ repeat: v || undefined })} label={d("mo.repeat", "Replay every time it scrolls into view")} /> : null}
          <Row label={d("mo.duration", "Duration")}>
            <Slide value={m.duration ?? r.duration} min={50} max={5000} step={50} unit="ms" onChange={(n) => strip({ duration: n })} ariaLabel={d("mo.duration", "Duration")} />
          </Row>
          <Row label={d("mo.delay", "Delay")}>
            <Slide value={m.delay ?? 0} min={0} max={5000} step={50} unit="ms" onChange={(n) => strip({ delay: n })} ariaLabel={d("mo.delay", "Delay")} />
          </Row>
          <Row label={d("mo.easing", "Easing")}>
            <Pick
              value={easingId}
              onChange={(v) => strip({ easing: v === "default" ? undefined : v === "custom" ? (safeEasing(customEase) ? customEase : "cubic-bezier(.4,0,.2,1)") : v })}
              options={[{ id: "default", label: d("mo.e.default", "Default") }, ...Object.keys(NAMED_EASINGS).map((e) => ({ id: e, label: e })), { id: "custom", label: d("mo.e.custom", "Custom curve…") }]}
            />
          </Row>
          {easingId === "custom" ? (
            <div className="space-y-1">
              <TplField value={customEase} onChange={(v) => { setCustomEase(v); if (safeEasing(v)) strip({ easing: v }); }} mono placeholder="cubic-bezier(.4,0,.2,1)" ariaLabel={d("mo.e.custom", "Custom curve…")} />
              {!safeEasing(customEase) ? <div className="text-[11px] text-amber-400">{d("mo.e.bad", "Use cubic-bezier(a, b, c, d) or steps(n).")}</div> : null}
            </div>
          ) : null}
          <Row label={d("mo.direction", "Direction")}>
            <Pick value={r.direction} onChange={(v) => strip({ direction: v === "normal" ? undefined : v })} options={[{ id: "normal", label: d("mo.d.normal", "Normal") }, { id: "reverse", label: d("mo.d.reverse", "Reverse") }, { id: "alternate", label: d("mo.d.alternate", "Alternate") }, { id: "alternate-reverse", label: d("mo.d.altrev", "Alternate reverse") }]} />
          </Row>
          <Row label={d("mo.iterations", "Repeat")}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <Num value={r.iterations === "infinite" ? undefined : r.iterations} min={1} max={100} placeholder="∞" disabled={r.iterations === "infinite"} onChange={(n) => strip({ iterations: n ?? 1 })} />
              <Check checked={r.iterations === "infinite"} onChange={(v) => strip({ iterations: v ? "infinite" : 1 })} label={d("mo.loop", "Loop")} />
            </div>
          </Row>
          <Row label={d("mo.fill", "Keep")}>
            <Pick value={r.fillMode} onChange={(v) => strip({ fillMode: v })} options={[{ id: "none", label: d("mo.f.none", "Nothing") }, { id: "forwards", label: d("mo.f.forwards", "End state") }, { id: "backwards", label: d("mo.f.backwards", "Start state") }, { id: "both", label: d("mo.f.both", "Both") }]} />
          </Row>
          {usesDistance ? (
            <Row label={d("mo.distance", "Distance")}>
              <Slide value={m.distance ?? r.distance} min={0} max={200} unit="px" onChange={(n) => strip({ distance: n })} ariaLabel={d("mo.distance", "Distance")} />
            </Row>
          ) : null}
          {usesIntensity ? (
            <Row label={d("mo.intensity", "Intensity")}>
              <Slide value={m.intensity ?? r.intensity} min={0} max={100} onChange={(n) => strip({ intensity: n })} ariaLabel={d("mo.intensity", "Intensity")} />
            </Row>
          ) : null}
          {isBox ? (
            <Row label={d("mo.stagger", "Stagger")} hint={d("mo.staggerHint", "Delay between the children: they play this effect one after another")}>
              <Slide value={m.stagger ?? 0} min={0} max={1000} step={10} unit="ms" onChange={(n) => strip({ stagger: n || undefined })} ariaLabel={d("mo.stagger", "Stagger")} />
            </Row>
          ) : null}
          {preset === "custom" ? (
            <div className="space-y-1">
              <div className="text-[11.5px] text-[var(--fg-muted)]">{d("mo.keyframes", "Keyframes (body of @keyframes)")}</div>
              <CodeEditor value={m.customKeyframes ?? ""} onChange={(v) => strip({ customKeyframes: v || undefined })} language="css" height={120} />
              {!r.customKeyframes && m.customKeyframes ? <div className="text-[11px] text-amber-400">{d("mo.kf.bad", "Not accepted: use balanced braces, no @rules or url().")}</div> : <div className="text-[11px] text-[var(--fg-subtle)]">from{"{"}opacity:0{"}"} 50%{"{"}transform:scale(1.1){"}"} to{"{"}opacity:1{"}"}</div>}
            </div>
          ) : null}
          <Note>{d("mo.reduced", "Visitors who prefer reduced motion see no animation. In the designer the effect plays but pauses under the pointer so you can select the element.")}</Note>
        </>
      ) : null}
    </Section>
  );
}
