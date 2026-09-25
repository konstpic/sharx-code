"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SubPageShell } from "@/components/sub/SubPageShell";
import { LayoutRenderer } from "@/components/sub/layout/LayoutRenderer";
import type { PublicSubPayload } from "@/components/sub/types";
import type { SharxSubpageConfigV2 } from "@/lib/sharxSubpageConfig";
import { useTranslation } from "react-i18next";
import { BLOCK_DESCRIPTORS } from "../blocks";
import { blockNode } from "@/lib/subLayout/migrate";
import { SNIPPET_IDS, snippetI18n, type SnippetId } from "@/lib/subLayout/presets";
import { CatalogBrowser } from "./CatalogBrowser";
import { newNode, type Subtree } from "@/lib/subLayout/tree";
import type { NodeType } from "@/lib/subLayout/types";
import type { D } from "./i18n";
import { TypeIcon } from "./palette-icons";
import { usePointerAdd } from "./CatalogTile";

type Item = { id: string; label: string; hint: string; icon: NodeType; build: () => Subtree };

const one = (type: NodeType, patch: Parameters<typeof newNode>[1] = {}): Subtree => {
  const n = newNode(type, patch);
  return { root: n.id, nodes: { [n.id]: n } };
};

type Props = {
  d: D;
  lang: string;
  /** Adds at the default place (click). */
  onAdd: (build: () => Subtree) => void;
  /** Starts a pointer drag onto the canvas. */
  onDragStart: (build: () => Subtree, label: string, e: { clientX: number; clientY: number }) => void;
  /** For the hover preview. */
  data: PublicSubPayload;
  config: SharxSubpageConfigV2 | null;
};

type Hover = { build: () => Subtree; label: string; top: number; left: number } | null;
const HoverCtx = { set: (_h: Hover) => {} };

export function Palette({ d, lang, onAdd, onDragStart, data, config }: Props) {
  const [hover, setHover] = useState<Hover>(null);
  HoverCtx.set = setHover;
  const { t, i18n } = useTranslation();
  const L = i18n.language?.startsWith("ru") ? "ru" : "en";
  const basics: Item[] = [
    { id: "frame", label: d("el.frame", "Frame"), hint: d("el.frameHint", "A container: stack, grid or free"), icon: "frame", build: () => one("frame") },
    { id: "text", label: d("el.text", "Text"), hint: d("el.textHint", "Text with variables"), icon: "text", build: () => one("text") },
    { id: "button", label: d("el.button", "Button"), hint: d("el.buttonHint", "Link, copy, QR or add to app"), icon: "button", build: () => one("button") },
    { id: "image", label: d("el.image", "Image"), hint: d("el.imageHint", "Logo or picture"), icon: "image", build: () => one("image") },
    { id: "badge", label: d("el.badge", "Badge"), hint: d("el.badgeHint", "A small status label"), icon: "badge", build: () => one("badge") },
    { id: "progress", label: d("el.progress", "Progress"), hint: d("el.progressHint", "Traffic bar"), icon: "progress", build: () => one("progress") },
    { id: "icon", label: d("el.icon", "Icon"), hint: d("el.iconHint", "A glyph"), icon: "icon", build: () => one("icon") },
    { id: "qr", label: d("el.qr", "QR code"), hint: d("el.qrHint", "QR of any text"), icon: "qr", build: () => one("qr") },
    { id: "divider", label: d("el.divider", "Divider"), hint: d("el.dividerHint", "A line"), icon: "divider", build: () => one("divider") },
    { id: "spacer", label: d("el.spacer", "Spacer"), hint: d("el.spacerHint", "Empty space"), icon: "spacer", build: () => one("spacer") },
    { id: "repeat", label: d("el.repeat", "Repeat"), hint: d("el.repeatHint", "One copy per device, link or app"), icon: "repeat", build: () => one("repeat") },
    { id: "html", label: d("el.html", "Custom code"), hint: d("el.htmlHint", "HTML / CSS / JS with variables"), icon: "html", build: () => one("html") },
    { id: "header", label: d("el.header", "Header"), hint: d("el.headerHint", "Brand bar of the page"), icon: "header", build: () => one("header") },
    { id: "scene", label: d("el.scene", "Scene"), hint: d("el.sceneHint", "Animated explainer"), icon: "scene", build: () => one("scene") },
    { id: "apps", label: d("el.apps", "App buttons"), hint: d("el.appsHint", "Pick apps by hand"), icon: "apps", build: () => one("apps") },
    { id: "locale", label: d("el.locale", "Language switch"), hint: d("el.localeHint", "Visitor's language"), icon: "locale-switch", build: () => one("locale-switch") },
  ];

  const snippetLabel: Record<SnippetId, [string, string]> = {
    card: [d("sn.card", "Card"), d("sn.cardHint", "Frame with title and text")],
    stat: [d("sn.stat", "Stat tile"), d("sn.statHint", "Traffic in a tile")],
    hero: [d("sn.hero", "Hero"), d("sn.heroHint", "Name, status and expiry")],
    devices: [d("sn.devices", "Devices list"), d("sn.devicesHint", "Connected devices")],
    apps: [d("sn.apps", "App buttons"), d("sn.appsHint", "Add to app grid")],
    links: [d("sn.links", "Links list"), d("sn.linksHint", "Every link with Copy")],
    support: [d("sn.support", "Support button"), d("sn.supportHint", "Opens the support link")],
    row: [d("sn.row", "Row"), d("sn.rowHint", "Horizontal frame, a column on phones")],
  };

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("pal.basic", "Basic elements")}</div>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5" data-tour="basic-elements">
          {basics.map((it) => (
            <BasicTile key={it.id} icon={it.icon} label={it.label} hint={it.hint} build={it.build} onAdd={onAdd} onDragStart={onDragStart} />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{d("pal.catalog", "Catalog")}</div>
        <CatalogBrowser d={d} lang={lang} L={L} onAdd={onAdd} onDragStart={onDragStart} data={data} config={config} onHover={setHover} />
      </div>
      <Group title={d("pal.ready", "Ready-made")}>
        {SNIPPET_IDS.map((id) => (
          <Tile key={id} icon={id === "devices" || id === "links" || id === "apps" ? "repeat" : id === "support" ? "button" : "frame"} label={snippetLabel[id][0]} hint={snippetLabel[id][1]} build={() => snippetI18n(id)} onAdd={onAdd} onDragStart={onDragStart} />
        ))}
      </Group>
      <Group title={d("pal.blocks", "Classic blocks")}>
        {BLOCK_DESCRIPTORS.map((b) => (
          <Tile key={b.kind} icon="block" label={t(b.labelKey)} hint={t(b.descriptionKey)} build={() => {
            const n = blockNode(b.create());
            return { root: n.id, nodes: { [n.id]: n } };
          }} onAdd={onAdd} onDragStart={onDragStart} />
        ))}
      </Group>
      {hover ? <Preview hover={hover} data={data} config={config} lang={lang} /> : null}
    </div>
  );
}

function Preview({ hover, data, config, lang }: { hover: NonNullable<Hover>; data: PublicSubPayload; config: SharxSubpageConfigV2 | null; lang: string }) {
  const [doc, setDoc] = useState<import("@/lib/subLayout/types").LayoutDoc | null>(null);
  useEffect(() => {
    const sub = hover.build();
    setDoc({ version: 1, enabled: true, root: sub.root, nodes: sub.nodes, vars: { tg: "https://t.me/example", notice: "…" } } as never);
  }, [hover]);
  if (!doc || typeof document === "undefined") return null;
  const maxTop = Math.max(8, window.innerHeight - 380);
  return createPortal(
    <div className="pointer-events-none fixed z-[450] w-[360px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl" style={{ top: Math.min(hover.top, maxTop), left: hover.left, maxHeight: 420 }} aria-hidden>
      <div className="border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--fg-muted)]">{hover.label}</div>
      <div className="max-h-[380px] overflow-hidden p-3 [&>div]:!min-h-0">
        <SubPageShell className="!min-h-0" branding={config?.branding} theme={config?.theme} colorPreset={config?.colorPreset}>
          <div className="p-2">
            <LayoutRenderer doc={doc} data={data} config={config} mode="view" interactive={false} device="mobile" lang={lang} />
          </div>
        </SubPageShell>
      </div>
    </div>,
    document.body,
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">{title}</div>
      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">{children}</div>
    </div>
  );
}

function Tile({ icon, label, hint, build, onAdd, onDragStart }: { icon: NodeType; label: string; hint: string; build: () => Subtree; onAdd: Props["onAdd"]; onDragStart: Props["onDragStart"] }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (!start.current || dragged) return;
      if (Math.hypot(ev.clientX - start.current.x, ev.clientY - start.current.y) < 5) return;
      dragged = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onDragStart(build, label, ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragged) onAdd(build);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <button type="button" onPointerDown={(e) => { HoverCtx.set(null); down(e); }} onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); HoverCtx.set({ build, label, top: r.top, left: r.right + 12 }); }} onMouseLeave={() => HoverCtx.set(null)} className="flex cursor-grab flex-col items-start gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-left transition-colors hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] active:cursor-grabbing">
      <TypeIcon type={icon} size={16} className="text-[var(--accent)]" />
      <span className="text-[12px] font-medium leading-tight text-[var(--fg)]">{label}</span>
      <span className="line-clamp-2 text-[10.5px] leading-tight text-[var(--fg-subtle)]">{hint}</span>
    </button>
  );
}

function BasicTile({ icon, label, hint, build, onAdd, onDragStart }: { icon: NodeType; label: string; hint: string; build: () => Subtree; onAdd: Props["onAdd"]; onDragStart: Props["onDragStart"] }) {
  const down = usePointerAdd(build, label, { onAdd, onDragStart });
  return (
    <button type="button" data-tour={`basic-${icon}`} title={`${label}: ${hint}`} onPointerDown={down} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAdd(build); } }} className="flex min-w-0 cursor-grab flex-col items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-1 py-2 text-center transition-colors hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] active:cursor-grabbing">
      <TypeIcon type={icon} size={18} className="text-[var(--accent)]" />
      <span className="max-w-full text-[11px] font-medium leading-tight text-[var(--fg)] [overflow-wrap:break-word]">{label}</span>
    </button>
  );
}
