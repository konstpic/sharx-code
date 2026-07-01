/**
 * server-side basePath from env (e.g. "" or /prefix); must match SharX `webBasePath` when building the panel.
 * At runtime the Go server may inject `window.__SHARX_BASE_PATH__` for secret-path mode without rebuild.
 */
declare global {
  interface Window {
    __SHARX_BASE_PATH__?: string;
  }
}

function normalizeBasePath(raw: string): string {
  const b = raw.trim();
  if (!b || b === "/") return "";
  return b.startsWith("/") ? b.replace(/\/$/, "") : `/${b.replace(/\/$/, "")}`;
}

function runtimeBasePath(): string {
  if (typeof window !== "undefined" && window.__SHARX_BASE_PATH__) {
    return normalizeBasePath(window.__SHARX_BASE_PATH__);
  }
  return normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH || "");
}

export function getBasePath(): string {
  return runtimeBasePath();
}

/**
 * Path for `next/link` `href` only. When runtime base path is injected, prepend it here
 * (Next build-time basePath stays `/`). Use `p()` / `panel()` for API URLs.
 *
 * Must match `next.config` `trailingSlash: true`: without a final `/`, Next (or the server) may
 * issue a redirect — the browser then loads a new `Document` and the whole panel flashes like F5.
 */
export function linkP(path: string): string {
  let s = path.startsWith("/") ? path : `/${path}`;
  if (s.length > 1 && !s.endsWith("/")) {
    s += "/";
  }
  const base = getBasePath();
  return base ? `${base}${s}` : s;
}

/** Absolute web path, e.g. p("login") -> /login or /prefix/login */
export function p(path: string): string {
  const base = getBasePath();
  const s = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${s}` : s;
}

/** After webBasePath, e.g. `panel/...` or `ws`. */
export function panel(path: string): string {
  const rest = path.startsWith("/") ? path.slice(1) : path;
  return p(`panel/${rest}`);
}
