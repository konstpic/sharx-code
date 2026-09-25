"use client";

import { QRCodeSVG } from "qrcode.react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { LanguagePicker } from "../LanguagePicker";
import { SubHeader } from "../SubHeader";
import { renderBlock } from "../blocks";
import type { PublicSubPayload } from "../types";
import type { AppSettings, BlockAddToApp, SharxSubpageConfigV2, SubpageBlock } from "@/lib/sharxSubpageConfig";
import { buildLayoutContext, repeatSourcePath } from "@/lib/subLayout/context";
import { LAYOUT_CONTAINER, cssClass, parentInfoOf, responsiveCss, ROOT_PARENT, styleToCss, type ParentInfo } from "@/lib/subLayout/css";
import { applyStates, hideKey, stateForAction, type PageState } from "@/lib/subLayout/behavior";
import { MOTION_BASE_CSS, motionClass, motionSheet, staggerVars } from "@/lib/subLayout/motion";
import { useMotionController } from "@/lib/subLayout/useMotion";
import { cleanCss } from "@/lib/subLayout/sanitizeHtml";
import { evalCondition, evalExpr, parseExpression, renderTemplate, safeUrl, type Ctx } from "@/lib/subLayout/template";
import type { LNode, LayoutDoc, Motion, OnClick, ParamDef } from "@/lib/subLayout/types";
import { HtmlEmbed } from "./HtmlEmbed";
import { NodeIcon } from "./icons";
import { AppsNode } from "./AppsNode";
import { SceneNode } from "./SceneNode";
import { useCatalogLocale } from "@/lib/subLayout/useCatalogLocale";

export type LayoutMode = "view" | "edit";

type Env = {
  doc: LayoutDoc;
  mode: LayoutMode;
  interactive: boolean;
  lang: string;
  t: TFunction;
  data: PublicSubPayload;
  parents: Map<string, LNode | null>;
  branding: { title: string; logoUrl?: string; brandText?: string; supportUrl?: string };
  showGetLink: boolean;
  showQrCodes: boolean;
  locales: string[];
  appSettings?: AppSettings;
  onCopy: (text: string) => void;
  onShowQr: (url: string, title: string) => void;
  /** Page state store (`state.<key>`). */
  setPageState: (fn: (s: PageState) => PageState) => void;
};

const EnvContext = createContext<Env | null>(null);
const useEnv = (): Env => {
  const e = useContext(EnvContext);
  if (!e) throw new Error("LayoutRenderer context missing");
  return e;
};

/** Parent of every node, for the size rules that depend on the parent's direction. */
export function parentNodeMap(doc: LayoutDoc): Map<string, LNode | null> {
  const m = new Map<string, LNode | null>();
  m.set(doc.root, null);
  for (const n of Object.values(doc.nodes)) for (const c of n.children ?? []) m.set(c, n);
  return m;
}

// ------------------------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------------------------

const TONES: Record<string, { fg: string; bg: string }> = {
  neutral: { fg: "var(--sub-fg-muted, #8b949e)", bg: "rgba(255,255,255,.08)" },
  accent: { fg: "var(--sub-accent, #22d3ee)", bg: "var(--sub-accent-soft, rgba(34,211,238,.14))" },
  success: { fg: "var(--sub-success, #3fb950)", bg: "color-mix(in oklab, var(--sub-success, #3fb950) 16%, transparent)" },
  warning: { fg: "#f0b429", bg: "rgba(240,180,41,.14)" },
  danger: { fg: "var(--sub-danger, #f85149)", bg: "color-mix(in oklab, var(--sub-danger, #f85149) 16%, transparent)" },
};

function tpl(env: Env, scope: Ctx, src: unknown): string {
  return renderTemplate(String(src ?? ""), scope, { lang: env.lang }).out;
}

/** Click behavior of any node except buttons: link, copy, scroll-to and the page state actions. */
function clickHandlers(env: Env, oc: OnClick, scope: Ctx, edit: boolean): Record<string, unknown> | undefined {
  if (edit || !env.interactive) return undefined;
  const run = () => {
    const value = tpl(env, scope, oc.value);
    if (oc.action === "link") {
      const href = safeUrl(value);
      if (href) (oc.newTab ? window.open(href, "_blank", "noopener,noreferrer") : window.location.assign(href));
    } else if (oc.action === "copy") {
      if (value) env.onCopy(value);
    } else if (oc.action === "scroll-to") {
      const el = value ? document.querySelector(`[data-lnode="${CSS.escape(value.trim())}"]`) : null;
      el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    } else {
      env.setPageState((st) => stateForAction(st, { ...oc, value: value.trim(), to: tpl(env, scope, oc.to) }) ?? st);
    }
  };
  return {
    onClick: run,
    role: "button",
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        run();
      }
    },
  };
}

function listFor(scope: Ctx, source: string): unknown[] {
  try {
    const path = repeatSourcePath(source);
    const v = evalExpr(parseExpression(path).e, scope);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function resolveAppLink(scope: Ctx, value: string): string {
  const app = (scope.app ?? {}) as Record<string, { url?: string }>;
  const hit = app[value.replace(/-/g, "_")];
  return hit?.url ?? "";
}

// ------------------------------------------------------------------------------------
// Node views
// ------------------------------------------------------------------------------------

type ViewProps = { id: string; scope: Ctx; parent: ParentInfo; /** Motion inherited from a staggering parent, with the child index. */ inherit?: { motion: Motion; index: number } };

/** Re-renders the caller every `sec` seconds (0 = never): keeps `now`-based values fresh. */
function useTick(sec: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!(sec > 0)) return;
    const t = window.setInterval(() => setTick((n) => n + 1), Math.max(1, sec) * 1000);
    return () => window.clearInterval(t);
  }, [sec]);
  return tick;
}

/** The motion a node really plays: its own, or the parent's when the parent staggers and the node has none. */
function effectiveMotion(node: LNode, inherit: ViewProps["inherit"]): Motion | undefined {
  if (node.motion && (node.motion.stagger ?? 0) > 0) return undefined; // a staggering frame animates through its children
  if (node.motion) return node.motion;
  return inherit?.motion;
}

const NodeView = memo(function NodeView({ id, scope: baseScope, parent, inherit }: ViewProps) {
  const env = useEnv();
  const node = env.doc.nodes[id];
  const tick = useTick(node?.refresh ?? 0);
  const scope = useMemo(() => (node && (node.refresh ?? 0) > 0 ? { ...baseScope, now: Date.now(), tick } : baseScope), [baseScope, node, tick]);
  if (!node) return null;
  const edit = env.mode === "edit";

  if (node.hidden && !edit) return null;
  const cond = evalCondition(node.visibleIf, scope, { lang: env.lang });
  const hiddenByState = (scope.state as PageState | undefined)?.[hideKey(node.id)] === true;
  const dimmed = (node.hidden || !cond.value || hiddenByState) && edit;
  if ((!cond.value || hiddenByState) && !edit) return null;

  const st = applyStates(node.style, node.states, scope, { lang: env.lang });
  const css = styleToCss(st.style, node.type, parent);
  if (st.matched) css.transition = "background-color .3s, color .3s, border-color .3s, opacity .3s, box-shadow .3s, transform .3s, filter .3s";
  if (dimmed) css.opacity = 0.35;
  const motion = effectiveMotion(node, inherit);
  const mvars = motion && inherit ? staggerVars(inherit.motion, inherit.index) : undefined;
  if (mvars) Object.assign(css, mvars);
  const cls = `sublyt-node ${cssClass(node.id)}${motion && motion.preset !== "none" ? " " + motionClass(motion) : motion ? " lm" : ""}`;
  const oc = node.onClick && node.onClick.action !== "none" ? node.onClick : undefined;
  const clickProps = oc && node.type !== "button" ? clickHandlers(env, oc, scope, edit) : undefined;
  if (clickProps && !edit) css.cursor = css.cursor ?? "pointer";
  const common = { className: cls, style: css, "data-lnode": node.id, "data-ltype": node.type, ...(clickProps ?? {}) } as const;
  const own: ParentInfo = { mode: node.style.mode ?? "stack", dir: node.style.dir ?? "column" };
  const stagger = node.motion && (node.motion.stagger ?? 0) > 0 && node.motion.preset !== "none" ? node.motion : undefined;

  const children = (ids: string[] | undefined, sc: Ctx = scope): ReactNode =>
    (ids ?? []).map((cid, i) => <NodeView key={cid} id={cid} scope={sc} parent={own} inherit={stagger ? { motion: stagger, index: i } : undefined} />);

  switch (node.type) {
    case "frame":
      return (
        <div {...common} data-empty={edit && !(node.children ?? []).length ? "true" : undefined}>
          {children(node.children)}
        </div>
      );

    case "repeat": {
      const source = String(node.props.source ?? "devices");
      const limit = Number(node.props.limit ?? 0);
      let items = listFor(scope, source);
      if (limit > 0) items = items.slice(0, limit);
      const empty = String(node.props.emptyText ?? "");
      if (edit) {
        // The designer shows one sample row (an empty object when there is no data) so the template can be styled.
        const sample = items[0] ?? {};
        return (
          <div {...common} data-empty={!(node.children ?? []).length ? "true" : undefined}>
            {children(node.children, { ...scope, item: sample, index: 0, number: 1 })}
          </div>
        );
      }
      if (items.length === 0) {
        return empty ? (
          <div {...common} style={{ ...css, display: "block" }}>
            <span style={{ opacity: 0.7 }}>{tpl(env, scope, empty)}</span>
          </div>
        ) : null;
      }
      return (
        <div {...common}>
          {items.map((it, i) => (
            <RepeatRow key={i} ids={node.children} own={own} scope={{ ...scope, item: it, index: i, number: i + 1 }} />
          ))}
        </div>
      );
    }

    case "text": {
      const tag = (["p", "span", "h1", "h2", "h3", "h4"].includes(String(node.props.tag)) ? String(node.props.tag) : "p") as "p" | "span" | "h1" | "h2" | "h3" | "h4";
      const Tag = tag;
      return (
        <Tag {...common} style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...css }}>
          {tpl(env, scope, node.props.text)}
        </Tag>
      );
    }

    case "image": {
      const src = safeUrl(tpl(env, scope, node.props.src));
      if (!src) {
        return edit ? (
          <div {...common} style={{ ...css, display: "grid", placeItems: "center", background: css.background ?? "rgba(255,255,255,.06)", border: "1px dashed rgba(255,255,255,.25)", color: "rgba(255,255,255,.5)", fontSize: 12 }}>
            <NodeIcon name="star" size={20} />
          </div>
        ) : null;
      }
      // eslint-disable-next-line @next/next/no-img-element
      return <img {...common} src={src} alt={tpl(env, scope, node.props.alt)} style={{ display: "block", objectFit: (node.props.fit as CSSProperties["objectFit"]) ?? "cover", ...css }} />;
    }

    case "button":
      return <ButtonView node={node} common={common} scope={scope} />;

    case "badge": {
      const tone = TONES[String(node.props.tone)] ?? TONES.neutral;
      return (
        <span {...common} style={{ display: "inline-flex", alignItems: "center", alignSelf: "flex-start", padding: "3px 12px 3px 10px", gap: 6, borderRadius: 999, fontWeight: 600, fontSize: 12, letterSpacing: ".02em", whiteSpace: "nowrap", color: tone.fg, background: tone.bg, border: `1px solid color-mix(in oklab, ${tone.fg} 28%, transparent)`, ...css }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: tone.fg, boxShadow: `0 0 8px ${tone.fg}` }} />
          {tpl(env, scope, node.props.text)}
        </span>
      );
    }

    case "divider":
      return <div {...common} style={{ background: "var(--sub-border, rgba(255,255,255,.1))", flexShrink: 0, ...css }} />;

    case "spacer":
      return <div {...common} style={{ flexShrink: 0, minHeight: 4, ...css }} />;

    case "progress": {
      const value = Number(tpl(env, scope, node.props.value)) || 0;
      const max = Number(tpl(env, scope, node.props.max)) || 0;
      const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
      const label = tpl(env, scope, node.props.label);
      const color = String(node.props.color ?? "").trim();
      const fill = color || (pct >= 90 ? "var(--sub-danger, #f85149)" : "var(--sub-accent, #22d3ee)");
      return (
        <div {...common}>
          {node.props.showText !== false && label ? <div style={{ fontSize: 13, marginBottom: 6, color: "var(--sub-fg-muted, #8b949e)" }}>{label}</div> : null}
          <div style={{ height: 10, borderRadius: 999, background: "color-mix(in oklab, var(--sub-fg, #c9d1d9) 10%, transparent)", overflow: "hidden" }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="sublyt-fill" style={{ width: `${max > 0 ? pct : 0}%`, height: "100%", borderRadius: 999, background: color ? fill : `linear-gradient(90deg, ${fill}, color-mix(in oklab, ${fill} 55%, var(--sub-accent-ambient, #9775fa)))`, boxShadow: `0 0 12px -2px ${fill}`, transition: "width .8s cubic-bezier(.2,.8,.2,1)" }} />
          </div>
        </div>
      );
    }

    case "icon":
      return (
        <span {...common} style={{ display: "inline-flex", flexShrink: 0, color: "var(--sub-accent, #22d3ee)", ...css }}>
          <NodeIcon name={String(node.props.name ?? "star")} size={Number(node.props.size) || 24} />
        </span>
      );

    case "qr": {
      const value = tpl(env, scope, node.props.value);
      const size = Number(node.props.size) || 160;
      if (!value) return edit ? <div {...common} style={{ ...css, width: size, height: size, border: "1px dashed rgba(255,255,255,.25)" }} /> : null;
      const fg = String(node.props.fg ?? "") || "#22d3ee";
      const bg = String(node.props.bg ?? "") || "#161b22";
      return (
        <div {...common} style={{ display: "inline-flex", flexShrink: 0, padding: 12, borderRadius: 12, background: bg, ...css }}>
          <QRCodeSVG value={value} size={size} level="M" bgColor={bg} fgColor={fg} />
        </div>
      );
    }

    case "block": {
      const block = node.props.block as SubpageBlock | undefined;
      if (!block || typeof block !== "object" || !("kind" in block)) return null;
      return (
        <section {...common} data-block-kind={block.kind}>
          {renderBlock(block, {
            data: env.data,
            showQrCodes: env.showQrCodes,
            onCopyLink: (url) => env.onCopy(url),
            onShowQr: env.onShowQr,
            interactive: env.interactive && !edit,
            t: env.t,
            appSettings: env.appSettings,
          })}
        </section>
      );
    }

    case "html":
      return (
        <HtmlEmbed
          id={node.id}
          className={cls}
          style={css}
          dataProps={{ "data-lnode": node.id, "data-ltype": "html" }}
          params={Array.isArray(node.props.params) ? (node.props.params as ParamDef[]) : undefined}
          values={node.props.values && typeof node.props.values === "object" ? (node.props.values as Record<string, unknown>) : undefined}
          events={clickProps}
          html={String(node.props.html ?? "")}
          css={String(node.props.css ?? "")}
          js={String(node.props.js ?? "")}
          allowScripts={node.props.allowScripts === true}
          height={Number(node.props.height) || 0}
          ctx={scope}
          lang={env.lang}
        />
      );

    case "header":
      return (
        <div {...common} style={{ ...css }}>
          <SubHeader
            title={env.branding.title}
            logoUrl={env.branding.logoUrl}
            brandText={env.branding.brandText}
            supportUrl={env.branding.supportUrl}
            showGetLink={!!env.data.subscriptionUrl && env.showGetLink && node.props.showGetLink !== false}
            interactive={env.interactive && !edit}
            onGetLink={() => env.onShowQr(env.data.subscriptionUrl, env.t("pages.publicSub.getLink", { defaultValue: "Get link" }))}
            hideLogo={node.props.showLogo === false}
            hideTitle={node.props.showTitle === false}
            hideTagline={node.props.showTagline === false}
            hideSupport={node.props.showSupport === false}
          />
        </div>
      );

    case "scene":
      return <SceneNode id={node.id} props={node.props} scope={scope} lang={env.lang} edit={edit} common={common} css={css} />;

    case "apps":
      return <AppsNode props={node.props} scope={scope} data={env.data} edit={edit} interactive={env.interactive} emptyLabel={env.t("subBuilder.designer.apps.none", { defaultValue: "No apps" })} common={common} css={css} />;

    case "locale-switch":
      return env.locales.length > 1 ? (
        <div {...common}>
          <LanguagePicker locales={env.locales} />
        </div>
      ) : edit ? (
        <div {...common} style={{ ...css, fontSize: 12, opacity: 0.5, textAlign: "center" }}>
          {env.t("subBuilder.designer.localeHint", { defaultValue: "Language switch (needs 2+ languages in the config)" })}
        </div>
      ) : null;
  }
});

const RepeatRow = memo(function RepeatRow({ ids, own, scope }: { ids: string[] | undefined; own: ParentInfo; scope: Ctx }) {
  return (
    <>
      {(ids ?? []).map((cid) => (
        <NodeView key={cid} id={cid} scope={scope} parent={own} />
      ))}
    </>
  );
});

function ButtonView({ node, common, scope }: { node: LNode; common: Record<string, unknown>; scope: Ctx }) {
  const env = useEnv();
  const edit = env.mode === "edit";
  const label = tpl(env, scope, node.props.label);
  const value = tpl(env, scope, node.props.value);
  const action = String(node.props.action ?? "link");
  const variant = String(node.props.variant ?? "solid");
  const icon = String(node.props.icon ?? "");
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    cursor: edit ? "default" : "pointer",
    textDecoration: "none",
    fontFamily: "inherit",
    fontSize: 14,
    lineHeight: 1.2,
    ...(variant === "solid"
      ? { background: "linear-gradient(135deg, var(--sub-accent, #22d3ee), color-mix(in oklab, var(--sub-accent, #22d3ee) 60%, var(--sub-accent-ambient, #9775fa)))", color: "var(--sub-on-accent, #04141a)", border: "1px solid transparent", boxShadow: "0 10px 24px -12px var(--sub-accent, #22d3ee)" }
      : variant === "outline"
        ? { background: "transparent", color: "var(--sub-fg-strong, #fff)", border: "1px solid var(--sub-border, rgba(255,255,255,.14))" }
        : { background: "transparent", color: "var(--sub-fg, #c9d1d9)", border: "1px solid transparent" }),
  };
  const style = { ...base, ...(common.style as CSSProperties) };
  const inner = (
    <>
      {icon ? <NodeIcon name={icon} size={16} /> : null}
      <span>{label}</span>
    </>
  );
  const attrs = { className: common.className as string, "data-lnode": common["data-lnode"] as string, "data-ltype": "button", style };

  if (action === "copy") {
    return (
      <button type="button" {...attrs} onClick={() => !edit && env.interactive && value && env.onCopy(value)}>
        {inner}
      </button>
    );
  }
  if (action === "toggle") {
    return (
      <button type="button" {...attrs} onClick={() => !edit && env.interactive && value && env.setPageState((st) => stateForAction(st, { action: "toggle", value: value.trim() }) ?? st)}>
        {inner}
      </button>
    );
  }
  if (action === "qr") {
    return (
      <button type="button" {...attrs} onClick={() => !edit && env.interactive && value && env.onShowQr(value, label)}>
        {inner}
      </button>
    );
  }
  const href = safeUrl(action === "deeplink" ? (value.includes("://") ? value : resolveAppLink(scope, value)) : value);
  return (
    <a
      {...attrs}
      href={href || undefined}
      target={node.props.newTab === true ? "_blank" : undefined}
      rel={node.props.newTab === true ? "noreferrer" : undefined}
      onClick={(e) => {
        if (edit || !env.interactive || !href) e.preventDefault();
      }}
    >
      {inner}
    </a>
  );
}

// ------------------------------------------------------------------------------------
// Root
// ------------------------------------------------------------------------------------

export type LayoutRendererProps = {
  doc: LayoutDoc;
  data: PublicSubPayload;
  config: SharxSubpageConfigV2 | null;
  mode?: LayoutMode;
  interactive?: boolean;
  /** Designer: "mobile" | "tablet" | "desktop". */
  device?: string;
  onCopy?: (text: string) => void;
  onShowQr?: (url: string, title: string) => void;
  fallbackTitle?: string;
  /** Overrides the language taken from i18n (designer preview). */
  lang?: string;
};

export function LayoutRenderer({ doc, data, config, mode = "view", interactive = true, device = "", onCopy, onShowQr, fallbackTitle = "Subscription", lang: langProp }: LayoutRendererProps) {
  const { t, i18n } = useTranslation();
  const lang = langProp ?? (i18n.language?.slice(0, 2) || "en");

  const branding = useMemo(
    () => ({
      title: config?.branding?.title || fallbackTitle,
      logoUrl: config?.branding?.logoUrl?.trim() || undefined,
      brandText: config?.branding?.brandText?.trim() || undefined,
      supportUrl: config?.branding?.supportUrl?.trim() || undefined,
    }),
    [config?.branding, fallbackTitle],
  );

  const bundledTr = useCatalogLocale(lang);
  const addToAppBlock = useMemo(() => (config?.blocks ?? []).find((b) => b.kind === "add-to-app" && b.enabled !== false) as BlockAddToApp | undefined, [config?.blocks]);
  const ctx = useMemo(
    () =>
      buildLayoutContext(data, {
        lang,
        preview: mode === "edit",
        device,
        vars: doc.vars,
        branding,
        enabledApps: config?.deepLinks?.enabledApps,
        addToApp: addToAppBlock,
        i18n: doc.i18n,
        bundledTr,
      }),
    [data, lang, mode, device, doc.vars, doc.i18n, bundledTr, branding, config?.deepLinks?.enabledApps, addToAppBlock],
  );

  const [pageState, setPageState] = useState<PageState>({});
  const ctxS = useMemo(() => ({ ...ctx, state: pageState }), [ctx, pageState]);
  const rootRef = useRef<HTMLDivElement>(null);
  useMotionController(rootRef, mode === "edit", [doc]);
  const setPS = useCallback((fn: (s: PageState) => PageState) => setPageState(fn), []);

  const parents = useMemo(() => parentNodeMap(doc), [doc]);
  const linksBlock = (config?.blocks ?? []).find((b) => b.kind === "links-list" && b.enabled !== false) as { showCopy?: boolean; showQr?: boolean } | undefined;
  const showGetLink = !linksBlock || linksBlock.showCopy !== false || linksBlock.showQr !== false;

  const env: Env = useMemo(
    () => ({
      doc,
      mode,
      interactive,
      lang,
      t,
      data,
      parents,
      branding,
      showGetLink,
      showQrCodes: config?.showQrCodes !== false,
      locales: config?.locales ?? [],
      appSettings: config?.appSettings,
      onCopy: onCopy ?? (() => undefined),
      onShowQr: onShowQr ?? (() => undefined),
      setPageState: setPS,
    }),
    [doc, mode, interactive, lang, t, data, parents, branding, showGetLink, config?.showQrCodes, config?.locales, config?.appSettings, onCopy, onShowQr, setPS],
  );

  const respCss = useMemo(() => responsiveCss(doc, parents), [doc, parents]);
  const motionCssText = useMemo(() => motionSheet(Object.values(doc.nodes).flatMap((n) => (n.motion ? [n.motion] : []))), [doc.nodes]);
  const userCss = useMemo(() => (doc.css ? `.sublyt-root{${cleanCss(doc.css)}}` : ""), [doc.css]);

  return (
    <EnvContext.Provider value={env}>
      <div ref={rootRef} className="sublyt-root" style={{ containerType: "inline-size", containerName: LAYOUT_CONTAINER, width: "100%", color: "var(--sub-fg, inherit)", ...(mode === "edit" ? { background: "var(--sub-bg)" } : {}) }} data-sublyt={mode}>
        <style>{`.sublyt-root [data-empty="true"]{min-height:44px;outline:1px dashed rgba(255,255,255,.22);outline-offset:-1px}
.sublyt-root button[data-ltype="button"],.sublyt-root a[data-ltype="button"]{transition:transform .2s cubic-bezier(.2,.8,.2,1),filter .2s ease,box-shadow .2s ease}
.sublyt-root button[data-ltype="button"]:hover,.sublyt-root a[data-ltype="button"]:hover{transform:translateY(-2px);filter:brightness(1.08)}
.sublyt-root button[data-ltype="button"]:active,.sublyt-root a[data-ltype="button"]:active{transform:translateY(0) scale(.98)}
.sublyt-root a.sublyt-app{transition:transform .2s cubic-bezier(.2,.8,.2,1),filter .2s ease}
.sublyt-root a.sublyt-app:hover{transform:translateY(-2px);filter:brightness(1.08)}
.sublyt-root a.sublyt-app:active{transform:translateY(0) scale(.98)}
.sublyt-root .sublyt-fill{position:relative;overflow:hidden}
.sublyt-root .sublyt-fill::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.45) 50%,transparent 70%);transform:translateX(-100%);animation:sublyt-shine 2.8s ease-in-out infinite}
@keyframes sublyt-shine{60%,100%{transform:translateX(100%)}}
@keyframes sublyt-in{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
.sublyt-root[data-sublyt="view"] [data-ltype="frame"]>[data-lnode]:not(.lm){animation:sublyt-in .6s cubic-bezier(.2,.8,.2,1) both}
.sublyt-root[data-sublyt="view"] [data-ltype="frame"]>[data-lnode]:not(.lm):nth-child(2){animation-delay:.07s}
.sublyt-root[data-sublyt="view"] [data-ltype="frame"]>[data-lnode]:not(.lm):nth-child(3){animation-delay:.14s}
.sublyt-root[data-sublyt="view"] [data-ltype="frame"]>[data-lnode]:not(.lm):nth-child(4){animation-delay:.21s}
.sublyt-root[data-sublyt="view"] [data-ltype="frame"]>[data-lnode]:not(.lm):nth-child(n+5){animation-delay:.28s}
@media (prefers-reduced-motion:reduce){.sublyt-root *{animation:none!important;transition:none!important}}${MOTION_BASE_CSS}${motionCssText}${respCss}${userCss}`}</style>
        <NodeView id={doc.root} scope={ctxS} parent={ROOT_PARENT} />
      </div>
    </EnvContext.Provider>
  );
}

export { parentInfoOf };
