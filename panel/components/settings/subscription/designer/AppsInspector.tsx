"use client";

import { ArrowDown, ArrowUp, ChevronDown, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import type { Ctx } from "@/lib/subLayout/template";
import { readApps, type AppsNodeApp } from "@/lib/subLayout/apps";
import { APP_CATALOG, subscriptionApps, type SubscriptionApp } from "@/lib/sharxSubpageConfig";
import type { D } from "./i18n";
import { Note } from "./InspectorSections";
import { Check, Num, Pick, Row, Section, Seg, SmallBtn, TplField } from "./ui";

type Props = { nodeId: string; props: Record<string, unknown>; ctx: Ctx; d: D; setProps: (p: Record<string, unknown>, key?: string) => void };

const sub = "space-y-2 rounded-lg border border-[var(--border)] p-2";
const PICKABLE = subscriptionApps.filter((a) => a !== "custom");

/** Designer editor of an `apps` node: source, hand-picked apps (order, per-app overrides) and look. */
export function AppsInspector({ nodeId, props, ctx, d, setProps }: Props) {
  const p = readApps(props);
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState("");
  const key = (k: string) => `${nodeId}:${k}`;
  const setList = (apps: AppsNodeApp[], k?: string) => setProps({ apps }, k);
  const patch = (i: number, v: Partial<AppsNodeApp>, k?: string) => setList(p.apps.map((a, j) => (j === i ? { ...a, ...v } : a)), k);
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= p.apps.length) return;
    const next = [...p.apps];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  const free = PICKABLE.filter((a) => !p.apps.some((x) => x.app === a));
  const addApp = (id: string) => {
    if (!id) return;
    setList([...p.apps, { app: id as SubscriptionApp, useEncrypted: APP_CATALOG[id as SubscriptionApp]?.supportsEncrypted === true }]);
    setAdd("");
  };
  // The config's add-to-app block is mirrored by the `apps` context variable; its ids are the app ids.
  const cfgIds = (Array.isArray(ctx.apps) ? ctx.apps : []).map((a) => String((a as Record<string, unknown>).id)).filter((id, i, all) => (subscriptionApps as readonly string[]).includes(id) && all.indexOf(id) === i) as SubscriptionApp[];
  const fill = () =>
    setList(cfgIds.map((app) => p.apps.find((x) => x.app === app) ?? { app, useEncrypted: APP_CATALOG[app]?.supportsEncrypted === true }));

  return (
    <>
      <Section title={d("apps.source", "App buttons")}>
        <Seg value={p.source} onChange={(v) => setProps({ source: v })} items={[{ id: "manual", label: d("apps.manual", "My list") }, { id: "config", label: d("apps.config", "From config") }]} />
        {p.source === "config" ? <Note>{d("apps.configHint", "Shows the apps of the page config's Add-to-app block.")}</Note> : null}
      </Section>

      {p.source === "manual" ? (
        <Section title={d("apps.list", "Apps")}>
          {p.apps.map((a, i) => {
            const cat = APP_CATALOG[a.app];
            const isOpen = open === a.app;
            return (
              <div key={a.app} className={sub}>
                <div className="flex items-center gap-1.5">
                  <button type="button" className="flex flex-1 items-center gap-1 truncate text-left text-[12px] font-medium text-[var(--fg)]" onClick={() => setOpen(isOpen ? null : a.app)} aria-expanded={isOpen}>
                    <ChevronDown size={12} className={isOpen ? "" : "-rotate-90"} />
                    {a.label || cat?.label || a.app}
                  </button>
                  <SmallBtn title={d("apps.up", "Move up")} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={13} />
                  </SmallBtn>
                  <SmallBtn title={d("apps.down", "Move down")} disabled={i === p.apps.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={13} />
                  </SmallBtn>
                  <SmallBtn title={d("apps.remove", "Remove")} onClick={() => setList(p.apps.filter((_, j) => j !== i))}>
                    <Trash2 size={13} />
                  </SmallBtn>
                </div>
                {isOpen ? (
                  <>
                    <Row label={d("apps.label", "Label")}>
                      <TplField value={a.label ?? ""} onChange={(v) => patch(i, { label: v || undefined }, key(`l${i}`))} placeholder={cat?.label} />
                    </Row>
                    <Row label={d("apps.icon", "Icon URL")}>
                      <TplField value={a.iconUrl ?? ""} onChange={(v) => patch(i, { iconUrl: v || undefined }, key(`i${i}`))} placeholder="https://…" />
                    </Row>
                    <Row label={d("apps.template", "Deep link")}>
                      <TplField value={a.deepLinkTemplate ?? ""} onChange={(v) => patch(i, { deepLinkTemplate: v || undefined }, key(`t${i}`))} mono placeholder={cat?.deepLinkTemplate} />
                    </Row>
                    {cat?.supportsEncrypted ? <Check checked={a.useEncrypted === true} onChange={(v) => patch(i, { useEncrypted: v })} label={d("apps.encrypted", "Encrypted link (E2E)")} /> : null}
                    <Check checked={a.enabled !== false} onChange={(v) => patch(i, { enabled: v })} label={d("apps.enabled", "Shown")} />
                  </>
                ) : null}
              </div>
            );
          })}
          {free.length ? (
            <Pick value={add} onChange={addApp} options={[{ id: "", label: d("apps.add", "Add an app…") }, ...free.map((a) => ({ id: a as string, label: APP_CATALOG[a].label }))]} />
          ) : null}
          {cfgIds.length ? (
            <SmallBtn title={d("apps.fill", "Fill from the Add-to-app block")} onClick={fill} className="w-full gap-1.5 text-[11.5px]">
              <Wand2 size={13} /> {d("apps.fill", "Fill from the Add-to-app block")}
            </SmallBtn>
          ) : null}
          <Note>{d("apps.listHint", "Deep links are built for each visitor from their own subscription.")}</Note>
        </Section>
      ) : null}

      <Section title={d("apps.look", "Look")}>
        <Row label={d("apps.view", "View")}>
          <Seg value={p.view} onChange={(v) => setProps({ view: v })} items={[{ id: "buttons", label: d("apps.v.buttons", "Buttons") }, { id: "tiles", label: d("apps.v.tiles", "Tiles") }, { id: "list", label: d("apps.v.list", "List") }]} />
        </Row>
        <Row label={d("c.variant", "Style")}>
          <Seg value={p.variant} onChange={(v) => setProps({ variant: v })} items={[{ id: "solid", label: d("v.solid", "Solid") }, { id: "outline", label: d("v.outline", "Outline") }, { id: "ghost", label: d("v.ghost", "Ghost") }]} />
        </Row>
        {p.view !== "list" ? (
          <Row label={d("apps.cols", "Columns")}>
            <Num value={p.cols} min={1} max={6} placeholder={d("c.auto", "auto")} onChange={(n) => setProps({ cols: n || undefined })} />
          </Row>
        ) : null}
        <Check checked={p.showIcon} onChange={(v) => setProps({ showIcon: v })} label={d("apps.showIcon", "Show app icons")} />
        <Check checked={p.showBadge} onChange={(v) => setProps({ showBadge: v })} label={d("apps.showBadge", "Show the E2E badge")} />
      </Section>
    </>
  );
}
