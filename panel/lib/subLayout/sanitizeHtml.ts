/**
 * Markup from a custom code node is cleaned with the browser's own parser (an inert document) before it is shown inside
 * a shadow root: scripts, frames, plugin embeds, event handlers and script URLs are removed. Scripts are only ever run
 * inside a sandboxed iframe (see HtmlEmbed), never here.
 */

const DROP_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "noscript", "portal"]);
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "background", "srcset", "data"]);

export function isSafeUrl(v: string): boolean {
  const s = v.replace(/[\u0000- ]+/g, "").toLowerCase();
  if (s.startsWith("javascript:") || s.startsWith("vbscript:") || s.startsWith("file:")) return false;
  if (s.startsWith("data:")) return /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/.test(s);
  return true;
}

export function cleanCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/javascript\s*:/gi, "")
    .replace(/behavior\s*:/gi, "")
    .replace(/-moz-binding\s*:/gi, "")
    .replace(/<\/?style/gi, "");
}

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || name === "srcdoc") {
          child.removeAttribute(attr.name);
        } else if (URL_ATTRS.has(name)) {
          const parts = name === "srcset" ? attr.value.split(",").map((p) => p.trim().split(/\s+/)[0]) : [attr.value];
          if (parts.some((p) => !isSafeUrl(p))) child.removeAttribute(attr.name);
        } else if (name === "style") {
          child.setAttribute("style", cleanCss(attr.value));
        }
      }
      if (tag === "style") child.textContent = cleanCss(child.textContent ?? "");
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
