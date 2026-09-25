"use client";

import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, BookmarkPlus, Copy, Eye, EyeOff, Lock, Monitor, Smartphone, Trash2, Unlock } from "lucide-react";
import { useMemo } from "react";
import { BlockEditor } from "../blocks";
import { isContainerType, parentOf, shiftNode, updateNode, wrapInFrame } from "@/lib/subLayout/tree";
import type { Ctx } from "@/lib/subLayout/template";
import type { LNode, LayoutDoc, Style } from "@/lib/subLayout/types";
import type { SubpageBlock } from "@/lib/sharxSubpageConfig";
import { repeatSourcePath } from "@/lib/subLayout/context";
import type { D } from "./i18n";
import { AppearanceSection, AppPick, CodeEditor, IconPicker, LayoutSection, Note, SizeSection, TextSection, TplRow, VisibilitySection, type StyleEdit } from "./InspectorSections";
import { AppsInspector } from "./AppsInspector";
import { SceneInspector } from "./SceneInspector";
import { MotionSection } from "./MotionSection";
import { ParamsSection } from "./ParamsSection";
import { StateSection } from "./StateSection";
import { normalizeParams, normalizeValues } from "@/lib/subLayout/params";
import { Check, Pick, Row, Section, Seg, SmallBtn, TplField, Num } from "./ui";

export type InspectorProps = {
  doc: LayoutDoc;
  sel: string[];
  ctx: Ctx;
  lang: string;
  bp: "base" | "mobile";
  setBp: (b: "base" | "mobile") => void;
  commit: (doc: LayoutDoc, opts?: { sel?: string[]; key?: string }) => void;
  d: D;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Opens the "save to library" dialog for the selection. */
  onSaveToLibrary?: () => void;
};

const TEXT_TYPES = new Set(["text", "button", "badge", "progress"]);

export function Inspector(p: InspectorProps) {
  const { doc, sel, d } = p;
  if (sel.length === 0) return <PageInspector {...p} />;
  if (sel.length > 1) return <MultiInspector {...p} />;
  const node = doc.nodes[sel[0]];
  if (!node) return <PageInspector {...p} />;
  return <NodeInspector {...p} node={node} />;
}

// ------------------------------------------------------------------------------------
// Nothing selected: the page itself
// ------------------------------------------------------------------------------------

function PageInspector({ doc, commit, d }: InspectorProps) {
  return (
    <div>
      <Section title={d("page.title", "Page")}>
        <Check checked={doc.enabled} onChange={(v) => commit({ ...doc, enabled: v }, { key: "enabled" })} label={d("page.enabled", "Use this layout on the public page")} />
        <Note>{doc.enabled ? d("page.onHint", "Visitors see this layout. Turn it off to show the classic block list again; the layout is kept.") : d("page.offHint", "The public page shows the classic blocks. Turn this on to publish the layout.")}</Note>
      </Section>
      <Section title={d("page.css", "Page CSS")} defaultOpen={false}>
        <div className="text-[11px] text-[var(--fg-subtle)]">{d("page.cssHint", "Extra CSS for the whole page. It is scoped to the page; use it for hover effects, animations or fonts.")}</div>
        <CodeEditor value={doc.css ?? ""} onChange={(v) => commit({ ...doc, css: v || undefined }, { key: "pagecss" })} language="css" height={180} />
      </Section>
      <Section title={d("page.help", "How it works")} defaultOpen>
        <ul className="list-disc space-y-1 pl-4 text-[11.5px] leading-snug text-[var(--fg-muted)]">
          <li>{d("help.1", "Add elements from the Add tab or drag them onto the canvas.")}</li>
          <li>{d("help.2", "Drag elements to reorder them or move them into another frame.")}</li>
          <li>{d("help.3", "Put ‹‹ variables ›› into texts, links and code: see the Variables tab.")}</li>
          <li>{d("help.4", "Mobile switch: edit how a block looks on phones.")}</li>
        </ul>
      </Section>
    </div>
  );
}

function MultiInspector({ doc, sel, commit, d, onDelete, onDuplicate, onSaveToLibrary }: InspectorProps) {
  const sameParent = new Set(sel.map((id) => parentOf(doc, id))).size === 1;
  return (
    <div>
      <Section title={d("multi.title", "%{n} selected", { n: sel.length })}>
        <div className="flex flex-wrap gap-1.5">
          <SmallBtn title={d("act.group", "Group into a frame")} disabled={!sameParent} onClick={() => {
            const r = wrapInFrame(doc, sel);
            if (r) commit(r.doc, { sel: [r.id] });
          }}>
            {d("act.groupShort", "Group")}
          </SmallBtn>
          {onSaveToLibrary ? <SmallBtn title={d("lib.saveTip", "Save to library (⇧⌘S)")} onClick={onSaveToLibrary}><BookmarkPlus size={14} /></SmallBtn> : null}
          <SmallBtn title={d("act.duplicate", "Duplicate")} onClick={onDuplicate}><Copy size={14} /></SmallBtn>
          <SmallBtn title={d("act.delete", "Delete")} onClick={onDelete}><Trash2 size={14} /></SmallBtn>
        </div>
        {!sameParent ? <Note>{d("multi.hint", "To group, select elements that share the same parent.")}</Note> : null}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------------------------
// One node
// ------------------------------------------------------------------------------------

function NodeInspector({ doc, node, ctx, lang, bp, setBp, commit, d, onDelete, onDuplicate, onSaveToLibrary }: InspectorProps & { node: LNode }) {
  const id = node.id;
  const isRoot = id === doc.root;
  const parentId = parentOf(doc, id);
  const parent = parentId ? doc.nodes[parentId] : undefined;
  const parentFree = parent?.type === "frame" && (parent.style.mode ?? "stack") === "free";
  const box = isContainerType(node.type);

  const style: Style = bp === "mobile" ? { ...node.style, ...(node.mobile ?? {}) } : node.style;
  const edit: StyleEdit = {
    style,
    bp,
    parentFree,
    set: (patch) => {
      const key = `${id}:${bp}:${Object.keys(patch).join(",")}`;
      commit(updateNode(doc, id, bp === "mobile" ? { mobile: patch } : { style: patch }), { key });
    },
  };
  const setProps = (props: Record<string, unknown>, key?: string) => commit(updateNode(doc, id, { props }), { key: key ?? `${id}:p:${Object.keys(props).join(",")}` });
  const P = node.props;
  const str = (k: string): string => (typeof P[k] === "string" ? (P[k] as string) : "");

  const showText = TEXT_TYPES.has(node.type) || node.type === "frame" || node.type === "repeat";

  return (
    <div>
      {/* header */}
      <div className="space-y-2 border-b border-[var(--border)] px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--accent)]">{node.type}</span>
          <input
            value={node.name ?? ""}
            onChange={(e) => commit(updateNode(doc, id, { name: e.target.value }), { key: `${id}:name` })}
            className="h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 text-[13px] font-medium text-[var(--fg)] outline-none hover:border-[var(--border)] focus:border-[var(--accent)]"
            aria-label={d("name", "Name")}
          />
        </div>
        <div className="select-all font-mono text-[10px] text-[var(--fg-subtle)]" title={d("id.hint", "Element id (for “Scroll to” and “Show / hide” actions)")}>{d("id.label", "id")}: {id}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SmallBtn title={node.hidden ? d("act.show", "Show") : d("act.hide", "Hide")} active={!!node.hidden} onClick={() => commit(updateNode(doc, id, { hidden: node.hidden ? undefined : true }))}>
            {node.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </SmallBtn>
          <SmallBtn title={node.locked ? d("act.unlock", "Unlock") : d("act.lock", "Lock")} active={!!node.locked} onClick={() => commit(updateNode(doc, id, { locked: node.locked ? undefined : true }))}>
            {node.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </SmallBtn>
          {onSaveToLibrary ? <SmallBtn title={d("lib.saveTip", "Save to library (⇧⌘S)")} disabled={isRoot} onClick={onSaveToLibrary}><BookmarkPlus size={14} /></SmallBtn> : null}
          <SmallBtn title={d("act.duplicate", "Duplicate")} disabled={isRoot} onClick={onDuplicate}><Copy size={14} /></SmallBtn>
          <SmallBtn title={d("act.delete", "Delete")} disabled={isRoot} onClick={onDelete}><Trash2 size={14} /></SmallBtn>
          <div className="ml-auto w-[112px]" data-tour="inspector-mobile-switch">
            <Seg
              value={bp}
              onChange={setBp}
              items={[
                { id: "base", icon: <Monitor size={14} />, title: d("bp.base", "Edit for all screens") },
                { id: "mobile", icon: <Smartphone size={14} />, title: d("bp.mobile", "Edit the mobile look (narrow screens)") },
              ]}
            />
          </div>
        </div>
        {bp === "mobile" ? (
          <Note>
            {d("bp.note", "Mobile mode: changes below apply only on narrow screens (up to 640px).")}{" "}
            {node.mobile ? (
              <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => commit(updateNode(doc, id, { mobile: null }))}>
                {d("bp.reset", "Reset mobile overrides")}
              </button>
            ) : null}
          </Note>
        ) : null}
      </div>

      {/* content */}
      {bp === "base" ? <ContentSection node={node} doc={doc} ctx={ctx} lang={lang} d={d} setProps={setProps} str={str} commit={commit} /> : null}

      {(box || node.type === "frame") && node.type !== "repeat" ? <LayoutSection e={edit} d={d} /> : null}
      {node.type === "repeat" ? <LayoutSection e={edit} d={d} /> : null}
      {!isRoot ? <SizeSection e={edit} d={d} /> : <SizeSection e={edit} d={d} />}
      {showText || node.type === "image" || node.type === "icon" || node.type === "html" ? <AppearanceSection e={edit} d={d} /> : <AppearanceSection e={edit} d={d} />}
      {showText ? <TextSection e={edit} d={d} /> : null}
      {bp === "base" && !isRoot && parentId ? (
        <Section title={d("sec.layers", "Layers")} defaultOpen={false}>
          <div className="grid grid-cols-4 gap-1">
            <SmallBtn title={d("ly.front", "Bring to front")} onClick={() => commit(shiftNode(doc, id, 9999))}><ChevronsUp size={14} /></SmallBtn>
            <SmallBtn title={d("ly.forward", "Bring forward")} onClick={() => commit(shiftNode(doc, id, 1))}><ArrowUp size={14} /></SmallBtn>
            <SmallBtn title={d("ly.backward", "Send backward")} onClick={() => commit(shiftNode(doc, id, -1))}><ArrowDown size={14} /></SmallBtn>
            <SmallBtn title={d("ly.back", "Send to back")} onClick={() => commit(shiftNode(doc, id, -9999))}><ChevronsDown size={14} /></SmallBtn>
          </div>
          <Note>{d("ly.hint", "Order among siblings: later elements are drawn on top. Use the z-index in Size for finer control.")}</Note>
        </Section>
      ) : null}
      {bp === "base" && node.type === "html" ? (
        <ParamsSection
          nodeId={id}
          params={normalizeParams(P.params)}
          values={normalizeValues(P.values)}
          d={d}
          onChange={(patch, key) => commit(updateNode(doc, id, { props: patch as Record<string, unknown> }), { key })}
        />
      ) : null}
      {bp === "base" ? <div data-tour="inspector-motion"><MotionSection node={node} d={d} onChange={(m, key) => commit(updateNode(doc, id, { motion: m }), { key })} /></div> : null}
      {bp === "base" && !isRoot ? (
        <VisibilitySection node={node} ctx={ctx} lang={lang} d={d} onCond={(v) => commit(updateNode(doc, id, { visibleIf: v.trim() ? v : undefined }), { key: `${id}:vis` })} onHide={(h) => commit(updateNode(doc, id, { hideOn: h && (h.mobile || h.desktop) ? h : undefined }))} />
      ) : null}
      {bp === "base" ? <StateSection node={node} ctx={ctx} lang={lang} d={d} onPatch={(patch, key) => commit(updateNode(doc, id, patch), { key })} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------
// Per-type content
// ------------------------------------------------------------------------------------

function ContentSection({ node, doc, ctx, lang, d, setProps, str, commit }: { node: LNode; doc: LayoutDoc; ctx: Ctx; lang: string; d: D; setProps: (p: Record<string, unknown>, key?: string) => void; str: (k: string) => string; commit: InspectorProps["commit"] }) {
  const P = node.props;
  const T = (label: string, key: string, opts: { multiline?: boolean; rows?: number; mono?: boolean; placeholder?: string; result?: boolean } = {}) => (
    <TplRow label={label} value={str(key)} onChange={(v) => setProps({ [key]: v }, `${node.id}:${key}`)} ctx={ctx} lang={lang} multiline={opts.multiline} rows={opts.rows} mono={opts.mono} placeholder={opts.placeholder} showResult={opts.result !== false} />
  );

  switch (node.type) {
    case "text":
      return (
        <Section title={d("sec.content", "Content")}>
          {T(d("c.text", "Text"), "text", { multiline: true, rows: 4 })}
          <Row label={d("c.tag", "Tag")}>
            <Pick value={String(P.tag ?? "p")} onChange={(v) => setProps({ tag: v })} options={[{ id: "p", label: d("tag.p", "Paragraph") }, { id: "span", label: d("tag.span", "Inline") }, { id: "h1", label: "H1" }, { id: "h2", label: "H2" }, { id: "h3", label: "H3" }, { id: "h4", label: "H4" }]} />
          </Row>
        </Section>
      );
    case "image":
      return (
        <Section title={d("sec.content", "Content")}>
          {T(d("c.src", "Image URL"), "src", { placeholder: "https://…" })}
          {T(d("c.alt", "Alt text"), "alt")}
          <Row label={d("c.fit", "Fit")}>
            <Pick value={String(P.fit ?? "cover")} onChange={(v) => setProps({ fit: v })} options={[{ id: "cover", label: d("fit.cover", "Cover") }, { id: "contain", label: d("fit.contain", "Contain") }, { id: "fill", label: d("fit.fill", "Stretch") }]} />
          </Row>
        </Section>
      );
    case "button": {
      const action = String(P.action ?? "link");
      return (
        <Section title={d("sec.content", "Content")}>
          {T(d("c.label", "Label"), "label")}
          <Row label={d("c.action", "Action")}>
            <Pick
              value={action}
              onChange={(v) => setProps({ action: v, value: v === "deeplink" ? "happ" : str("value") })}
              options={[{ id: "link", label: d("act.link", "Open a link") }, { id: "copy", label: d("act.copy", "Copy text") }, { id: "qr", label: d("act.qr", "Show a QR code") }, { id: "deeplink", label: d("act.deeplink", "Add to an app") }, { id: "toggle", label: d("act.toggle", "Toggle a state (state.<key>)") }]}
            />
          </Row>
          {action === "deeplink" ? (
            <Row label={d("c.app", "App")}>
              <AppPick value={str("value") || "happ"} onChange={(v) => setProps({ value: v })} />
            </Row>
          ) : (
            T(action === "link" ? d("c.url", "URL") : action === "toggle" ? d("st.key", "State key") : d("c.value", "Text"), "value", { placeholder: action === "link" ? "https://…" : action === "toggle" ? "faq1" : "{{ subscription.url }}" })
          )}
          <Row label={d("c.variant", "Style")}>
            <Seg value={String(P.variant ?? "solid")} onChange={(v) => setProps({ variant: v })} items={[{ id: "solid", label: d("v.solid", "Solid") }, { id: "outline", label: d("v.outline", "Outline") }, { id: "ghost", label: d("v.ghost", "Ghost") }]} />
          </Row>
          <div className="space-y-1">
            <div className="text-[11.5px] text-[var(--fg-muted)]">{d("c.icon", "Icon")}</div>
            <IconPicker value={str("icon")} onChange={(v) => setProps({ icon: v === str("icon") ? "" : v })} />
          </div>
          {action === "link" ? <Check checked={P.newTab === true} onChange={(v) => setProps({ newTab: v })} label={d("c.newTab", "Open in a new tab")} /> : null}
        </Section>
      );
    }
    case "badge":
      return (
        <Section title={d("sec.content", "Content")}>
          {T(d("c.text", "Text"), "text")}
          <Row label={d("c.tone", "Tone")}>
            <Pick value={String(P.tone ?? "accent")} onChange={(v) => setProps({ tone: v })} options={[{ id: "neutral", label: d("t.neutral", "Neutral") }, { id: "accent", label: d("t.accent", "Accent") }, { id: "success", label: d("t.success", "Success") }, { id: "warning", label: d("t.warning", "Warning") }, { id: "danger", label: d("t.danger", "Danger") }]} />
          </Row>
        </Section>
      );
    case "progress":
      return (
        <Section title={d("sec.content", "Content")}>
          {T(d("c.value", "Value"), "value")}
          {T(d("c.max", "Maximum"), "max")}
          {T(d("c.label", "Label"), "label")}
          <Check checked={P.showText !== false} onChange={(v) => setProps({ showText: v })} label={d("c.showLabel", "Show the label")} />
          <Row label={d("c.color", "Bar color")}>
            <TplField value={str("color")} onChange={(v) => setProps({ color: v })} placeholder="auto" />
          </Row>
        </Section>
      );
    case "icon":
      return (
        <Section title={d("sec.content", "Content")}>
          <IconPicker value={str("name")} onChange={(v) => setProps({ name: v })} />
          <Row label={d("c.size", "Size")}>
            <Num value={Number(P.size) || 24} min={8} max={200} unit="px" onChange={(n) => setProps({ size: n ?? 24 })} />
          </Row>
        </Section>
      );
    case "qr":
      return (
        <Section title={d("sec.content", "Content")}>
          {T(d("c.value", "Text"), "value")}
          <Row label={d("c.size", "Size")}>
            <Num value={Number(P.size) || 160} min={64} max={600} unit="px" onChange={(n) => setProps({ size: n ?? 160 })} />
          </Row>
        </Section>
      );
    case "repeat": {
      const source = String(P.source ?? "devices");
      const known = ["devices", "links", "apps", "mtProto"].includes(source);
      return (
        <Section title={d("sec.content", "Repeat")}>
          <Note>{d("c.repeatHint", "The children are drawn once per item. Use ‹‹ item.name ››, ‹‹ item.url ››, ‹‹ number ›› inside.")}</Note>
          <Row label={d("c.source", "For each")}>
            <Pick value={known ? source : "custom"} onChange={(v) => setProps({ source: v === "custom" ? "devices.items" : v })} options={[{ id: "devices", label: d("src.devices", "Device") }, { id: "links", label: d("src.links", "Link") }, { id: "apps", label: d("src.apps", "App") }, { id: "mtProto", label: d("src.mtproto", "Telegram proxy") }, { id: "custom", label: d("src.custom", "Custom list…") }]} />
          </Row>
          {!known ? (
            <Row label={d("c.list", "List")}>
              <TplField value={source} onChange={(v) => setProps({ source: v })} mono placeholder="devices.items" />
            </Row>
          ) : null}
          <div className="text-[10.5px] text-[var(--fg-subtle)]">{d("c.listPath", "List: %{path}", { path: repeatSourcePath(source) })}</div>
          <Row label={d("c.limit", "Limit")}>
            <Num value={Number(P.limit) || undefined} min={0} placeholder={d("c.noLimit", "all")} onChange={(n) => setProps({ limit: n ?? 0 })} />
          </Row>
          {T(d("c.empty", "Text when empty"), "emptyText")}
        </Section>
      );
    }
    case "block": {
      const block = P.block as SubpageBlock | undefined;
      return (
        <Section title={d("sec.block", "Block settings")}>
          <Note>{d("c.blockHint", "A ready-made block of the classic page. Its own settings are below; size, spacing and visibility work like for any element.")}</Note>
          {block && typeof block === "object" && "kind" in block ? (
            <BlockEditor block={block} onChange={(next) => commit(updateNode(doc, node.id, { props: { block: next, kind: next.kind } }), { key: `${node.id}:block` })} />
          ) : null}
        </Section>
      );
    }
    case "html":
      return (
        <Section title={d("sec.code", "Custom code")}>
          <Note>{d("c.htmlHint", "HTML with ‹‹ variables ››, plus CSS. Values are escaped, so client data cannot inject markup.")}</Note>
          <div className="text-[11.5px] text-[var(--fg-muted)]">HTML</div>
          <CodeEditor value={str("html")} onChange={(v) => setProps({ html: v }, `${node.id}:html`)} language="html" height={200} />
          <div className="text-[11.5px] text-[var(--fg-muted)]">CSS</div>
          <CodeEditor value={str("css")} onChange={(v) => setProps({ css: v }, `${node.id}:css`)} language="css" height={140} />
          <Check checked={P.allowScripts === true} onChange={(v) => setProps({ allowScripts: v })} label={d("c.scripts", "Allow JavaScript (runs in a sandbox)")} />
          {P.allowScripts === true ? (
            <>
              <Note>{d("c.scriptHint", "The script runs in an isolated frame: it cannot touch the page. Data is in window.sub (window.sub.user.username …).")}</Note>
              <div className="text-[11.5px] text-[var(--fg-muted)]">JavaScript</div>
              <CodeEditor value={str("js")} onChange={(v) => setProps({ js: v }, `${node.id}:js`)} language="javascript" height={140} />
              <Row label={d("c.frameH", "Frame height")}>
                <Num value={Number(P.height) || undefined} min={0} unit="px" placeholder={d("c.auto", "auto")} onChange={(n) => setProps({ height: n ?? 0 })} />
              </Row>
            </>
          ) : null}
        </Section>
      );
    case "header":
      return (
        <Section title={d("sec.content", "Header")}>
          <Check checked={P.showLogo !== false} onChange={(v) => setProps({ showLogo: v })} label={d("h.logo", "Logo")} />
          <Check checked={P.showTitle !== false} onChange={(v) => setProps({ showTitle: v })} label={d("h.title", "Title")} />
          <Check checked={P.showTagline !== false} onChange={(v) => setProps({ showTagline: v })} label={d("h.tagline", "Tagline")} />
          <Check checked={P.showGetLink !== false} onChange={(v) => setProps({ showGetLink: v })} label={d("h.getLink", "“Get link” button")} />
          <Check checked={P.showSupport !== false} onChange={(v) => setProps({ showSupport: v })} label={d("h.support", "Support button")} />
          <Note>{d("h.hint", "Logo, title, tagline and support link come from the Branding tab.")}</Note>
        </Section>
      );
    case "scene":
      return <SceneInspector nodeId={node.id} props={P} ctx={ctx} lang={lang} d={d} setProps={setProps} />;
    case "apps":
      return <AppsInspector nodeId={node.id} props={P} ctx={ctx} d={d} setProps={setProps} />;
    case "locale-switch":
      return (
        <Section title={d("sec.content", "Language switch")}>
          <Note>{d("c.localeHint", "Shown when two or more languages are enabled in the page config.")}</Note>
        </Section>
      );
    default:
      return null;
  }
}

export function useNodeCount(doc: LayoutDoc) {
  return useMemo(() => Object.keys(doc.nodes).length, [doc]);
}
