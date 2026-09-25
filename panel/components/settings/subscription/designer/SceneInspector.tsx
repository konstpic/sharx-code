"use client";

import { Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Ctx } from "@/lib/subLayout/template";
import { playScene, readScene, SCENE_TONES } from "@/lib/subLayout/scene";
import type { SceneActor, SceneStep, SceneTone } from "@/lib/subLayout/types";
import type { D } from "./i18n";
import { IconPicker, Note, TplRow } from "./InspectorSections";
import { Check, ColorInput, Num, Pick, Row, Section, Slide, SmallBtn, TplField } from "./ui";

type Props = { nodeId: string; props: Record<string, unknown>; ctx: Ctx; lang: string; d: D; setProps: (p: Record<string, unknown>, key?: string) => void };

const sub = "space-y-2 rounded-lg border border-[var(--border)] p-2";

/** Designer editor of a `scene` node: actors, links, steps and timing. */
export function SceneInspector({ nodeId, props, ctx, lang, d, setProps }: Props) {
  const sc = readScene(props);
  const [openActor, setOpenActor] = useState<string | null>(null);
  const key = (k: string) => `${nodeId}:${k}`;
  const actorOpts = sc.actors.map((a) => ({ id: a.id, label: a.label || a.id }));
  const toneOpts = SCENE_TONES.map((t) => ({ id: t, label: d(`scene.tone.${t}`, t) }));

  const setActors = (actors: SceneActor[], k?: string) => setProps({ actors }, k);
  const patchActor = (i: number, p: Partial<SceneActor>, k?: string) => setActors(sc.actors.map((a, j) => (j === i ? { ...a, ...p } : a)), k);
  const setSteps = (steps: SceneStep[], k?: string) => setProps({ steps }, k);
  const patchStep = (i: number, p: Partial<SceneStep>, k?: string) => setSteps(sc.steps.map((s, j) => (j === i ? { ...s, ...p } : s)), k);
  const toggle = (list: string[] | undefined, id: string) => ((list ?? []).includes(id) ? (list ?? []).filter((x) => x !== id) : [...(list ?? []), id]);

  const addActor = () => {
    let n = sc.actors.length + 1;
    while (sc.actors.some((a) => a.id === `a${n}`)) n++;
    setActors([...sc.actors, { id: `a${n}`, label: d("scene.newActor", "Actor"), icon: "star", x: 50, y: 50 }]);
  };
  const removeActor = (id: string) => {
    setProps({
      actors: sc.actors.filter((a) => a.id !== id),
      links: sc.links.filter(([f, t]) => f !== id && t !== id),
      steps: sc.steps.map((s) => ({ ...s, show: s.show.filter((x) => x !== id), focus: (s.focus ?? []).filter((x) => x !== id), flows: (s.flows ?? []).filter((f) => f.from !== id && f.to !== id) })),
    });
  };

  return (
    <>
      <Section title={d("scene.actors", "Scene actors")}>
        <Note>{d("scene.hint", "Actors are icons placed by X / Y (0-100). Steps choose which of them are shown, focused and connected by moving dots. Texts accept ‹‹ variables ››.")}</Note>
        {sc.actors.map((a, i) => (
          <div key={a.id} className={sub}>
            <div className="flex items-center gap-2">
              <button type="button" className="flex-1 truncate text-left text-[12px] font-medium text-[var(--fg)]" onClick={() => setOpenActor(openActor === a.id ? null : a.id)}>
                {a.label || a.id} <span className="text-[var(--fg-subtle)]">({a.id})</span>
              </button>
              <SmallBtn title={d("scene.remove", "Remove")} onClick={() => removeActor(a.id)}>
                <Trash2 size={13} />
              </SmallBtn>
            </div>
            {openActor === a.id ? (
              <>
                <TplRow label={d("scene.label", "Label")} value={a.label ?? ""} onChange={(v) => patchActor(i, { label: v }, key(`actor${i}`))} ctx={ctx} lang={lang} showResult={false} />
                <div className="text-[11.5px] text-[var(--fg-muted)]">{d("c.icon", "Icon")}</div>
                <IconPicker value={a.icon} onChange={(v) => patchActor(i, { icon: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <Row label="X">
                    <Num value={a.x} min={0} max={100} unit="%" onChange={(n) => patchActor(i, { x: n ?? 0 }, key(`ax${i}`))} />
                  </Row>
                  <Row label="Y">
                    <Num value={a.y} min={0} max={100} unit="%" onChange={(n) => patchActor(i, { y: n ?? 0 }, key(`ay${i}`))} />
                  </Row>
                </div>
                <Row label={d("c.tone", "Tone")}>
                  <Pick value={(a.tone ?? "accent") as SceneTone} onChange={(v) => patchActor(i, { tone: v })} options={toneOpts} />
                </Row>
              </>
            ) : null}
          </div>
        ))}
        <SmallBtn onClick={addActor}>
          <Plus size={13} /> {d("scene.addActor", "Add actor")}
        </SmallBtn>
      </Section>

      <Section title={d("scene.links", "Links")} defaultOpen={false}>
        {sc.links.map(([f, t], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Pick value={f} onChange={(v) => setProps({ links: sc.links.map((l, j) => (j === i ? [v, t] : l)) })} options={actorOpts} className="flex-1" />
            <span className="text-[var(--fg-subtle)]">→</span>
            <Pick value={t} onChange={(v) => setProps({ links: sc.links.map((l, j) => (j === i ? [f, v] : l)) })} options={actorOpts} className="flex-1" />
            <SmallBtn title={d("scene.remove", "Remove")} onClick={() => setProps({ links: sc.links.filter((_, j) => j !== i) })}>
              <Trash2 size={13} />
            </SmallBtn>
          </div>
        ))}
        <SmallBtn disabled={sc.actors.length < 2} onClick={() => setProps({ links: [...sc.links, [sc.actors[0].id, sc.actors[1].id]] })}>
          <Plus size={13} /> {d("scene.addLink", "Add link")}
        </SmallBtn>
      </Section>

      <Section title={d("scene.steps", "Steps")}>
        {sc.steps.map((s, i) => (
          <div key={i} className={sub}>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-[var(--fg-muted)]">{d("scene.step", "Step %{n}", { n: i + 1 })}</span>
              <SmallBtn title={d("scene.remove", "Remove")} onClick={() => setSteps(sc.steps.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </SmallBtn>
            </div>
            <TplRow label={d("scene.caption", "Caption")} value={s.caption ?? ""} onChange={(v) => patchStep(i, { caption: v }, key(`cap${i}`))} ctx={ctx} lang={lang} multiline rows={2} />
            <Row label={d("scene.stepDur", "Duration")} hint={d("scene.stepDurHint", "Overrides the default step duration; empty = default")}>
              <Num value={s.ms} min={300} step={100} unit="ms" placeholder={d("scene.default", "default")} onChange={(n) => patchStep(i, { ms: n && n >= 300 ? n : undefined }, key(`ms${i}`))} />
            </Row>
            <div className="space-y-1">
              <div className="text-[11.5px] text-[var(--fg-muted)]">{d("scene.condition", "Play only if")}</div>
              <TplField value={s.condition ?? ""} onChange={(v) => patchStep(i, { condition: v.trim() ? v : undefined }, key(`cond${i}`))} mono placeholder="user.percentUsed > 80" ariaLabel={d("scene.condition", "Play only if")} />
            </div>
            <div className="text-[11.5px] text-[var(--fg-muted)]">{d("scene.shown", "Shown")}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {sc.actors.map((a) => (
                <Check key={a.id} checked={s.show.includes(a.id)} onChange={() => patchStep(i, { show: toggle(s.show, a.id) })} label={a.label || a.id} />
              ))}
            </div>
            <div className="text-[11.5px] text-[var(--fg-muted)]">{d("scene.focused", "Focused")}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {sc.actors.map((a) => (
                <Check key={a.id} checked={(s.focus ?? []).includes(a.id)} onChange={() => patchStep(i, { focus: toggle(s.focus, a.id) })} label={a.label || a.id} />
              ))}
            </div>
            <div className="text-[11.5px] text-[var(--fg-muted)]">{d("scene.flows", "Moving dots")}</div>
            {(s.flows ?? []).map((f, k) => {
              const setFlow = (p: Partial<typeof f>) => patchStep(i, { flows: (s.flows ?? []).map((x, j) => (j === k ? { ...x, ...p } : x)) });
              return (
                <div key={k} className="flex items-center gap-1.5">
                  <Pick value={f.from} onChange={(v) => setFlow({ from: v })} options={actorOpts} className="flex-1" />
                  <span className="text-[var(--fg-subtle)]">→</span>
                  <Pick value={f.to} onChange={(v) => setFlow({ to: v })} options={actorOpts} className="flex-1" />
                  <Pick value={(f.tone ?? "accent") as SceneTone} onChange={(v) => setFlow({ tone: v })} options={toneOpts} />
                  <SmallBtn title={d("scene.remove", "Remove")} onClick={() => patchStep(i, { flows: (s.flows ?? []).filter((_, j) => j !== k) })}>
                    <Trash2 size={13} />
                  </SmallBtn>
                </div>
              );
            })}
            <SmallBtn disabled={sc.actors.length < 2} onClick={() => patchStep(i, { flows: [...(s.flows ?? []), { from: sc.actors[0].id, to: sc.actors[1].id }] })}>
              <Plus size={13} /> {d("scene.addFlow", "Add dots")}
            </SmallBtn>
          </div>
        ))}
        <SmallBtn onClick={() => setSteps([...sc.steps, { caption: d("scene.newStep", "New step"), show: sc.actors.map((a) => a.id) }])}>
          <Plus size={13} /> {d("scene.addStep", "Add step")}
        </SmallBtn>
      </Section>

      <Section title={d("scene.playback", "Playback")}>
        <SmallBtn onClick={() => playScene(nodeId)}>
          <Play size={13} /> {d("scene.play", "Play scene")}
        </SmallBtn>
        <Check checked={sc.autoplay !== false} onChange={(v) => setProps({ autoplay: v })} label={d("scene.autoplay", "Autoplay")} />
        <Row label={d("scene.start", "Start")}>
          <Pick value={sc.start ?? "load"} onChange={(v) => setProps({ start: v })} options={[{ id: "load", label: d("scene.start.load", "On load") }, { id: "visible", label: d("scene.start.visible", "When visible") }, { id: "click", label: d("scene.start.click", "On click") }]} />
        </Row>
        <Row label={d("scene.loopMode", "Repeat")}>
          <Pick value={sc.loopMode ?? "loop"} onChange={(v) => setProps({ loopMode: v, loop: v !== "once" })} options={[{ id: "loop", label: d("scene.loopMode.loop", "Loop") }, { id: "once", label: d("scene.loopMode.once", "Once") }, { id: "ping-pong", label: d("scene.loopMode.pingpong", "Back and forth") }]} />
        </Row>
        <Check checked={sc.pauseOnHover === true} onChange={(v) => setProps({ pauseOnHover: v || undefined })} label={d("scene.pauseHover", "Pause on hover")} />
        <Check checked={sc.showCaption !== false} onChange={(v) => setProps({ showCaption: v })} label={d("scene.showCaption", "Show captions")} />
        <Check checked={sc.showControls !== false} onChange={(v) => setProps({ showControls: v })} label={d("scene.showControls", "Show controls")} />
        <Check checked={sc.showNumbers === true} onChange={(v) => setProps({ showNumbers: v || undefined })} label={d("scene.showNumbers", "Show step numbers")} />
        <Row label={d("scene.speed", "Speed")} hint={d("scene.speedHint", "Multiplier for step durations and moving dots")}>
          <Slide value={sc.speed ?? 1} min={0.25} max={4} step={0.25} unit="×" onChange={(n) => setProps({ speed: n ?? 1 }, key("speed"))} ariaLabel={d("scene.speed", "Speed")} />
        </Row>
        <Row label={d("scene.stepMs", "Step duration")}>
          <Num value={sc.stepMs} min={600} step={100} unit="ms" onChange={(n) => setProps({ stepMs: n ?? 2600 }, key("stepMs"))} />
        </Row>
        <Row label={d("scene.height", "Height")}>
          <Num value={sc.height} min={80} max={800} unit="px" onChange={(n) => setProps({ height: n ?? 240 }, key("height"))} />
        </Row>
      </Section>

      <Section title={d("scene.look", "Look")} defaultOpen={false}>
        <Row label={d("scene.transition", "Transition")}>
          <Pick value={sc.transition ?? "scale"} onChange={(v) => setProps({ transition: v })} options={[{ id: "fade", label: d("scene.tr.fade", "Fade") }, { id: "slide", label: d("scene.tr.slide", "Slide") }, { id: "scale", label: d("scene.tr.scale", "Scale") }]} />
        </Row>
        <Row label={d("scene.actorSize", "Actor size")}>
          <Slide value={sc.actorSize ?? 44} min={28} max={96} unit="px" onChange={(n) => setProps({ actorSize: n ?? 44 }, key("actorSize"))} ariaLabel={d("scene.actorSize", "Actor size")} />
        </Row>
        <Row label={d("scene.actorShape", "Actor shape")}>
          <Pick value={sc.actorShape ?? "rounded"} onChange={(v) => setProps({ actorShape: v })} options={[{ id: "circle", label: d("scene.shape.circle", "Circle") }, { id: "rounded", label: d("scene.shape.rounded", "Rounded") }, { id: "square", label: d("scene.shape.square", "Square") }]} />
        </Row>
        <Row label={d("scene.lineStyle", "Lines")}>
          <Pick value={sc.lineStyle ?? "dashed"} onChange={(v) => setProps({ lineStyle: v })} options={[{ id: "solid", label: d("scene.line.solid", "Solid") }, { id: "dashed", label: d("scene.line.dashed", "Dashed") }, { id: "animated", label: d("scene.line.animated", "Animated") }]} />
        </Row>
        <Row label={d("scene.flowDir", "Dots go")}>
          <Pick value={sc.flowDir ?? "forward"} onChange={(v) => setProps({ flowDir: v })} options={[{ id: "forward", label: d("scene.fd.forward", "Forward") }, { id: "reverse", label: d("scene.fd.reverse", "Backward") }, { id: "both", label: d("scene.fd.both", "There and back") }]} />
        </Row>
        <Row label={d("scene.flowSpeed", "Dot speed")}>
          <Slide value={sc.flowSpeed ?? 1} min={0.25} max={4} step={0.25} unit="×" onChange={(n) => setProps({ flowSpeed: n ?? 1 }, key("flowSpeed"))} ariaLabel={d("scene.flowSpeed", "Dot speed")} />
        </Row>
        <Row label={d("scene.flowDots", "Dots per link")}>
          <Num value={sc.flowDots} min={1} max={5} onChange={(n) => setProps({ flowDots: n ?? 1 }, key("flowDots"))} />
        </Row>
        <div className="text-[11.5px] text-[var(--fg-muted)]">{d("scene.tones", "Tone colors")}</div>
        {SCENE_TONES.map((t) => (
          <Row key={t} label={d(`scene.tone.${t}`, t)}>
            <ColorInput value={sc.tones?.[t]} onChange={(v) => setProps({ tones: { ...(sc.tones ?? {}), [t]: v } })} placeholder={d("scene.default", "default")} />
          </Row>
        ))}
      </Section>
    </>
  );
}
