"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cleanCss, sanitizeHtml } from "@/lib/subLayout/sanitizeHtml";
import { paramCssVars, paramValues } from "@/lib/subLayout/params";
import { renderTemplate, type Ctx } from "@/lib/subLayout/template";
import type { ParamDef } from "@/lib/subLayout/types";

type Props = {
  html: string;
  css?: string;
  js?: string;
  allowScripts?: boolean;
  /** Height of the frame in px when scripts are allowed (0 = follow the content). */
  height?: number;
  ctx: Ctx;
  lang: string;
  id: string;
  /** Parameters (see lib/subLayout/params.ts): `{{ p.key }}` in the markup and `--p-key` custom properties. */
  params?: ParamDef[];
  values?: Record<string, unknown>;
  /** Extra DOM handlers (click behavior of the node). */
  events?: Record<string, unknown>;
  className?: string;
  style?: React.CSSProperties;
  dataProps?: Record<string, string>;
};

/** JSON that is safe inside a <script> element. */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v ?? null).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * Custom markup with variables. Without scripts it renders in a shadow root (the page's fonts and colors flow in, its
 * styles do not leak either way). With scripts it renders in a sandboxed iframe without same-origin access, so code
 * cannot touch the page, the panel session or the parent document.
 */
export function HtmlEmbed({ html, css = "", js = "", allowScripts, height = 0, ctx, lang, id, className, style, dataProps, params, values, events }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pv = useMemo(() => {
    const v = paramValues(params, values);
    // Text parameters are templates too (`{{ user.username }}`, `{{ tr.key }}`).
    for (const p of params ?? []) if (p.type === "text" && typeof v[p.key] === "string") v[p.key] = renderTemplate(v[p.key] as string, ctx, { lang }).out;
    return v;
  }, [params, values, ctx, lang]);
  const pVars = useMemo(() => paramCssVars(params, values), [params, values]);
  const scope = useMemo(() => (params && params.length ? { ...ctx, p: pv } : ctx), [ctx, params, pv]);
  const rendered = useMemo(() => renderTemplate(html, scope, { escape: "html", lang }).out, [html, scope, lang]);
  const trig = typeof pv.trigger === "string" && pv.trigger !== "load" ? pv.trigger : undefined;
  const hostStyle = useMemo(() => ({ ...style, ...pVars }) as React.CSSProperties, [style, pVars]);
  const rootVars = useMemo(() => `:root{${Object.entries(pVars).map(([k, v]) => `${k}:${v}`).join(";")}}`, [pVars]);
  const [frameHeight, setFrameHeight] = useState(height > 0 ? height : 120);

  useEffect(() => {
    if (allowScripts) return;
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>:host{display:block}${cleanCss(css)}</style>${sanitizeHtml(rendered)}`;
  }, [allowScripts, css, rendered]);

  useEffect(() => {
    if (!allowScripts || height > 0) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { sublytHeight?: number; frame?: string } | null;
      if (d && d.frame === id && typeof d.sublytHeight === "number") setFrameHeight(Math.max(20, Math.min(4000, Math.round(d.sublytHeight))));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [allowScripts, height, id]);

  const srcDoc = useMemo(() => {
    if (!allowScripts) return "";
    const safeJs = js.replace(/<\/script/gi, "<\\/script");
    const data = jsonForScript(scope);
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;background:transparent;color:#c9d1d9;font-family:system-ui,sans-serif}${rootVars}${cleanCss(css)}</style></head><body>${rendered}<script>window.sub=${data};<\/script><script>${safeJs}<\/script><script>(function(){var post=function(){parent.postMessage({sublytHeight:document.documentElement.scrollHeight,frame:${jsonForScript(id)}},"*")};try{new ResizeObserver(post).observe(document.body)}catch(e){}window.addEventListener("load",post);post()})()<\/script></body></html>`;
  }, [allowScripts, css, js, rendered, scope, id, rootVars]);

  if (allowScripts) {
    return (
      <div className={className} style={hostStyle} {...dataProps} {...events}>
        <iframe
          title="custom code"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          style={{ width: "100%", height: height > 0 ? height : frameHeight, border: 0, display: "block", background: "transparent" }}
        />
      </div>
    );
  }
  return <div ref={hostRef} className={className} style={hostStyle} {...dataProps} {...events} data-ptrig={trig} />;
}
