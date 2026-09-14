# SharX — GitHub Pages Landing Page — Design System

## Product context

**SharX** is a self-hosted, multi-node Xray/VPN proxy management platform, Docker-first, aimed at
developers and sysadmins who want to run their own proxy infrastructure instead of a SaaS. This page is
a **standalone marketing/docs landing page for GitHub Pages** — it is NOT part of the admin panel app
and does not reuse the panel's layout/components. It should feel like a premium, technical, "built by
people who ship" product page for a security/networking tool — confident, terminal-adjacent, not generic
SaaS marketing (no soft gradients-and-blobs startup look).

Only the **color palette** should visually tie back to the real SharX panel — layout, composition, and
copy are fully new.

## Source of truth for colors

Pull colors from `data-panel-theme="web"` in `panel/app/globals.css` — this is the palette the codebase
itself labels as "SharX WEB" and treats as the canonical brand palette for marketing surfaces (as opposed
to the in-app default cyan/violet admin theme, which is for the operator UI, not marketing).

```
--bg:            #05060a   near-black page background
--bg-elevated:   #0c0f18   cards / elevated panels
--surface:       rgba(255,255,255,0.04)   subtle panel fill
--surface-strong:rgba(255,255,255,0.08)   hover/active fill
--border:        rgba(255,255,255,0.10)   hairline border
--border-strong: rgba(255,255,255,0.18)   emphasized border
--fg:            #f5f7fb   primary text
--fg-muted:      rgba(245,247,251,0.66)   secondary text
--fg-subtle:     rgba(245,247,251,0.44)   tertiary/placeholder text
--accent:        #8577f2   primary accent (indigo/violet) — CTAs, links, glow
--accent-ambient:#6c52c7   secondary accent — gradient partner, ambient glow
--code-bg:       rgba(255,255,255,0.06)   code block background
```

Secondary accent for small status/protocol chips only (do not use as a primary CTA color): the in-app
cyan `#22d3ee` may appear as a sparing "online / active" signal color, echoing the operator panel's
default theme — think a single terminal-cursor cyan blink among the violet palette, not a second hero
color.

## Typography

- Headings / nav brand / hero: **Unbounded** (Google Font) — geometric, slightly technical/display,
  matches the panel's `--font-heading`.
- Body: **Montserrat** — matches panel's `--font-sans`.
- Code / API examples / env var tables / terminal snippets: **Fira Mono** (or `JetBrains Mono` /
  `IBM Plex Mono` as a close fallback) — matches panel's `--font-mono`. Code blocks are a first-class
  visual element on this page (install one-liner, curl examples, docker-compose, .env) — give them real
  terminal chrome (dot-buttons, subtle scanline/glow, syntax-tinted tokens) rather than plain `<pre>`.

## Motion

Subtle, fast, restrained — this is an infra tool, not a game. Use the panel's own motion tokens as
guidance: `150ms` fast / `220ms` base / `420ms` slow, ease `cubic-bezier(0.22,1,0.36,1)`. Fade+rise
scroll-reveal on sections (like the panel's `.reveal`/`.reveal-in`), a soft ambient ~violet radial glow
that drifts very slowly behind the hero, hover-lift on cards, a shimmer sweep on the primary CTA button
(mirrors the panel's `.panel-btn-primary` gradient+shimmer). No parallax gimmicks, no bouncy easings.

## Border radius / shadows

- Standard card/button radius `0.75rem` (12px), pills/badges `rounded-full`, larger surfaces up to `1rem`.
- Soft dark shadows only: `0 4px 24px rgba(0,0,0,0.35)` resting, `0 20px 40px rgba(0,0,0,0.45)` hover —
  no colored/neon shadows except a restrained accent-colored glow directly behind the hero CTA / logo.

## Required page structure

Single-page, long-scroll, static HTML/CSS (must run standalone on GitHub Pages — no build step, no
server, all fonts via Google Fonts `<link>`, all icons inline SVG or a CDN icon font).

1. **Nav** — logo/wordmark, in-page anchor links (Features, Protocols, Deploy, API, Config, Docs), GitHub
   link (star count style badge), primary CTA "Get Started" / "Deploy in 60s".
2. **Hero** — product name, one-line positioning ("multi-node Xray management, self-hosted"), a short
   supporting line, two CTAs (primary: one-line install command in a copyable terminal snippet; secondary:
   GitHub repo link), ambient background glow, maybe a stylized terminal/dashboard mockup or abstract
   network-node graphic (no literal screenshot needed — this can be abstract/illustrative).
3. **Feature grid** — multi-node architecture (one panel, many workers), visual subscription page builder,
   Docker one-line install, PostgreSQL + observability (Prometheus/Loki/Grafana), HWID device protection,
   encrypted cookie sessions. Icon + short headline + 1-2 line description per card.
4. **Protocols section** — call out supported protocols/inbounds with emphasis on **AmneziaWG** (DPI-
   resistant WireGuard fork, v3.1 obfuscation params: Jc/Jmin/Jmax, H1-H4, HeaderProtectionKey,
   RandomTrailers, DisableCookies) and **Telemt** (MTProto proxy) alongside standard Xray protocols
   (VLESS/VMess/Trojan/Shadowsocks/Hysteria2) — present as a technical badge/tag grid or small protocol
   cards, not marketing fluff; a couple of real obfuscation parameter names as inline `code` chips adds
   credibility for this audience.
5. **Deploy / install section** — the one-line curl install command and a `docker-compose.yml` snippet,
   presented as real terminal/code blocks with copy buttons (visual only — no JS required to render, but
   style it like a copyable code block).
6. **API reference section** — this is a real informational section, not just a link-out. Summarize:
   base URL config, cookie-session + Bearer JWT auth, and a compact list of the API's 22 resource groups
   (Login & Session, Inbounds, Server, Settings, Migration, Xray Settings, Outbounds, Xray Core Config
   Profiles, Nodes, Clients, Client Groups, Client HWID, Hosts, Node Push API, Subscription Server,
   WebSocket, Backup, API Docs, Worker Node HTTP API, Public Panel API, DB Inspector, Prometheus Metrics)
   — render as a compact two/three-column tag list or table, not 22 huge cards. Include ONE real example
   request/response as a terminal code block (e.g. `POST /login`) for credibility, plus a link to the
   full docs.
7. **Environment variables / configuration section** — a real reference table (not a stub) grouped by:
   Web Panel (`XUI_WEB_PORT`, `XUI_WEB_LISTEN`, `XUI_WEB_DOMAIN`, `XUI_WEB_BASE_PATH`,
   `XUI_WEB_CERT_FILE`/`XUI_WEB_KEY_FILE`), Subscription (`XUI_SUB_PORT`, `XUI_SUB_PATH`,
   `XUI_SUB_DOMAIN`), Database (`XUI_DB_HOST`, `XUI_DB_PORT`, `XUI_DB_USER`, `XUI_DB_PASSWORD`,
   `XUI_DB_NAME`, `XUI_DB_SSLMODE`), Logging (`XUI_LOG_LEVEL`, `XUI_DEBUG`), Xray
   (`XRAY_VMESS_AEAD_FORCED`), Security (`XUI_ENABLE_FAIL2BAN`). A clean monospace table (var name /
   description / default) reads better here than prose — style it like a man-page or `.env.example` file
   in a code block, with the table underneath for scannability.
8. **Footer** — GitHub link, license, docs link, small print.

## Tone / copy guidance

Short, confident, technical sentences. No "revolutionize", "seamless", "game-changer", "unlock your
potential" SaaS-speak. Prefer concrete facts ("one panel, unlimited worker nodes", "Docker image, live in
under a minute") over adjectives. It's fine to sound a little "for operators, by operators".
