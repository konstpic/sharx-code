# SharX Panel — Shared Layouts

The panel has two structurally distinct chromes, both gated by `PanelLayoutGate`:

1. **Root layout** (`app/layout.tsx`) — sets fonts, theme attributes (`data-theme="dark"`,
   `data-panel-theme="web"`), and wraps everything in `Providers` (i18n + toast context).
2. **Panel shell** (`components/panel/PanelShell.tsx`) — the authenticated app shell: top navbar +
   collapsible left sidebar nav + scrollable main content area. Applied to every `/panel/*` route
   except the public subscription page (`/panel/sub`), via `PanelLayoutGate`.
3. **Login page** (`app/page.tsx`, the `/` route) has its own bespoke full-screen layout (not reusing
   `PanelShell`) — animated vortex backdrop, centered card.

---

## `panel/app/layout.tsx` — Root layout
Loads Google Fonts (Montserrat = sans, Unbounded = heading, Fira Mono = mono, Sacramento = login
script font, Orbitron + Pathway Gothic One = Star Wars theme display fonts), injects a
`themeInitScript` (from `@/lib/theme-provider`) to avoid FOUC, sets `<html data-theme="dark"
data-panel-theme="web">` and wraps children in `<Providers>`.

```tsx
import type { Metadata } from "next";
import {
  Fira_Mono, Montserrat, Orbitron, Pathway_Gothic_One, Sacramento, Unbounded,
} from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { themeInitScript } from "@/lib/theme-provider";

const montserrat = Montserrat({ variable: "--font-mont", subsets: ["latin", "cyrillic"], display: "swap" });
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin", "cyrillic"], display: "swap" });
const firaMono = Fira_Mono({ variable: "--font-fira", subsets: ["latin", "cyrillic"], weight: ["400", "500", "700"], display: "swap" });
const sacramento = Sacramento({ variable: "--font-sacramento", subsets: ["latin", "latin-ext"], weight: "400", display: "swap" });
const orbitron = Orbitron({ variable: "--font-orbitron", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
const pathwayGothic = Pathway_Gothic_One({ variable: "--font-pathway", subsets: ["latin"], weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: "SharX",
  description: "SharX panel",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" data-panel-theme="web" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#05060a" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${montserrat.variable} ${unbounded.variable} ${firaMono.variable} ${sacramento.variable} ${orbitron.variable} ${pathwayGothic.variable} antialiased`}
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

---

## `panel/app/panel/layout.tsx` — Panel route-group layout
Trivial wrapper that hands off to `PanelLayoutGate`.

```tsx
import { PanelLayoutGate } from "@/components/panel";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <PanelLayoutGate>{children}</PanelLayoutGate>;
}
```

---

## `panel/components/panel/PanelLayoutGate.tsx` — `PanelLayoutGate`
Chooses chrome based on pathname: if the route contains `/panel/sub` (the **public**, unauthenticated
subscription page meant to be shared with end-users), it renders children with zero panel chrome
(`<div className="min-h-screen antialiased">`). Otherwise it wraps children in `PanelWebSocketProvider`
(live data feed) + `PanelShell` (full authenticated app shell).

```tsx
"use client";

import { usePathname } from "next/navigation";
import { PanelShell } from "@/components/panel/PanelShell";
import { PanelWebSocketProvider } from "@/lib/panelWebSocket";

export function PanelLayoutGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const isPublicSub = pathname.includes("/panel/sub");
  if (isPublicSub) {
    return <div className="min-h-screen antialiased">{children}</div>;
  }
  return (
    <PanelWebSocketProvider>
      <PanelShell>{children}</PanelShell>
    </PanelWebSocketProvider>
  );
}
```

---

## `panel/components/panel/PanelShell.tsx` — `PanelShell` (579 lines, full app shell)
The main authenticated layout: fixed-height flex column (`min-h-dvh md:h-dvh md:max-h-dvh
md:overflow-hidden`) with:

- **Cinema background** (`.panel-cinema-bg` — hyperspace/stars/lasers layers, mostly for the Star Wars
  panel theme; harmless no-op visually on other themes).
- **Top navbar** (`<header className="panel-navbar">`) — 64px tall (`h-16`), contains: mobile hamburger
  (`Menu` icon, toggles sidebar on < md), the "SharX / Panel" wordmark (two-line: bold brand + uppercase
  "Panel" subtitle), and a right-aligned cluster of chrome links: `PanelGitHubStarLink`,
  `PanelTelegramNavLink`, `PanelDonateNavLink`, `PanelHeaderAppMeta` (update-available badge / version /
  user menu).
- **Sidebar nav** (`<aside id="panel-doc-nav">`) — 280px wide, fixed+overlay on mobile (slides in via
  `-translate-x-full` / `translate-x-0`), static in the flex row on `md:`. Contains a flat + grouped nav
  list built from a `NavEntry[]` array combining plain links and expandable groups:
  - Dashboard, Inbounds, **Hosts** (before/after Inbounds), **Nodes** (group — Manage / Statistics /
    Geography, only shown when the panel is in multi-node mode, `multiNodeMode` from
    `panel("setting/all")`), **Clients** (group — Manage / Statistics), Groups, **Settings** (group — one
    sub-link per `SETTINGS_TAB_IDS` tab + DB Inspector), **Xray** (group — Template / Geo-files / Core
    Config Profiles), API Docs, Logout.
  - Each group (`settings`/`nodes`/`xray`/`clients`) has its own local `useState` open/close toggle
    (chevron button) and auto-opens when the current route falls inside that section.
  - Active-link styling via `panel-menu-link` / `panel-menu-link--active` / `panel-menu-link--sub`
    global classes.
- **Main content** — `<main>` with `<div className="route-fade route-fade-in">` wrapping `children`
  (CSS-only fade-in transition on route change; no React remount/key to avoid a flash-of-empty-shell).

Reads panel theme + language preference on mount (`getUiPref`, `applyPanelTheme`, `changeLanguage`),
and listens to the panel WebSocket (`usePanelWebSocket`) to re-sync `multiNodeMode` after a
reconnect.

(Full 579-line source in `panel/components/panel/PanelShell.tsx` — key structural excerpt below; the
per-group JSX blocks for settings/xray/clients/nodes repeat the same pattern of "link + chevron toggle +
collapsible sub-list".)

```tsx
"use client";
// imports: lucide-react icons, usePathname, useTranslation, postJson, changeLanguage,
// applyPanelTheme/parsePanelTheme, usePanelWebSocket, linkP/panel/p/stripBasePath,
// SETTINGS_TAB_IDS/tSettingsTabLabel, getUiPref, PanelHeaderAppMeta, PanelNavLink,
// PanelTelegramNavLink, PanelDonateNavLink, PanelGitHubStarLink

type NavItem = { key: string; href: string; icon: React.ReactNode; label: string };
type NavEntry = NavItem | { kind: "settings" } | { kind: "nodes" } | { kind: "xray" } | { kind: "clients" };

export function PanelShell({ children }: { children: React.ReactNode }) {
  // ...local state: multi (multiNodeMode), mobileNav, settingsOpen, nodesOpen, clientsOpen, xrayOpen
  // ...effects: load multiNodeMode, apply panel theme + language, resync on WS reconnect, close mobile nav on route change
  // ...items: useMemo NavEntry[] built from t() labels + multi flag

  return (
    <div className="panel-root flex min-h-dvh flex-col text-[var(--fg)] md:h-dvh md:max-h-dvh md:overflow-hidden">
      <div className="panel-cinema-bg" aria-hidden>
        <span className="panel-cinema-bg__hyperspace" />
        <span className="panel-cinema-bg__stars" />
        <span className="panel-cinema-bg__lasers" />
      </div>
      <header className="panel-navbar relative z-[60] shrink-0">
        <div className="mx-auto flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* mobile hamburger */}
            <div className="panel-navbar-brand font-heading min-w-0">
              <span className="block truncate text-base font-bold tracking-[-0.5px] text-[var(--panel-chrome-fg)]">SharX</span>
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--panel-chrome-fg-muted)]">Panel</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <PanelGitHubStarLink />
            <PanelTelegramNavLink />
            <PanelDonateNavLink />
            <PanelHeaderAppMeta />
          </div>
        </div>
      </header>

      {/* mobile nav scrim (button) */}

      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row md:overflow-hidden">
        <aside id="panel-doc-nav" className="panel-doc-sidebar fixed left-0 top-16 z-50 flex h-[calc(100dvh-4rem)] w-[min(280px,92vw)] shrink-0 flex-col overflow-hidden border border-[var(--border)] shadow-2xl transition-transform duration-200 ease-out md:static md:top-auto md:z-20 md:h-full md:min-h-0 md:max-h-none md:w-[280px] md:translate-x-0 md:border-0 md:border-r md:border-[var(--border)] md:shadow-none md:transition-none">
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3 md:pt-2">
            {/* items.map(...) — plain links + settings/xray/clients/nodes expandable groups + logout */}
          </nav>
        </aside>

        <div className="panel-main relative z-10 flex min-h-0 min-w-0 flex-1 flex-col md:z-10">
          <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="route-fade route-fade-in min-h-0 min-w-0">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
```

---

## `panel/components/panel/PageScaffold.tsx` — `PageScaffold`
Per-page content wrapper used inside `PanelShell`'s `<main>`. Fluid, centered, max-width-free container
with responsive side padding (`px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12`) and vertical rhythm
(`space-y-8`, or `space-y-4` when `compact`). Animates its **direct children** in sequence on mount using
framer-motion `listContainer`/`listItem` variants (staggered fade+rise), skipped under
`prefers-reduced-motion`.

```tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { listContainer, listItem } from "@/lib/motion";

type PageScaffoldProps = { children: ReactNode; compact?: boolean };

export function PageScaffold({ children, compact }: PageScaffoldProps) {
  const reduce = useReducedMotion();
  const outer = `mx-auto w-full px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12 ${
    compact ? "space-y-4 pt-3 pb-2 sm:pt-4 sm:pb-3 lg:pt-5 lg:pb-4" : "space-y-8 pt-4 pb-3 sm:pt-5 sm:pb-4 lg:pt-6 lg:pb-5"
  }`;
  if (reduce) return <div className={outer}>{children}</div>;
  return (
    <motion.div className={outer} initial="hidden" animate="visible" variants={listContainer}>
      {Children.map(children, (child, index) =>
        isValidElement(child) ? (
          <motion.div key={child.key ?? `page-block-${index}`} variants={listItem} className="min-w-0">
            {child}
          </motion.div>
        ) : (
          <Fragment key={`page-text-${index}`}>{child}</Fragment>
        ),
      )}
    </motion.div>
  );
}
```

---

## `panel/components/panel/PageHeader.tsx` — `PageHeader`
Standard page-title block used at the top of every panel page (inside `PageScaffold`). Left side:
optional `IconTile` + eyebrow label (small dot + uppercase caption) + `<h1>` (optionally gradient text
via `accentTitle`) + optional description paragraph. Right side: `actions` slot (buttons), wraps on
mobile.

```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";

type PageHeaderProps = {
  title: string; eyebrow?: string; description?: string; actions?: ReactNode;
  accentTitle?: boolean; icon?: LucideIcon; iconTone?: IconTileTone;
};

export function PageHeader({
  title, eyebrow, description, actions, accentTitle, icon: HeaderIcon, iconTone = "accent",
}: PageHeaderProps) {
  const titleRow = (
    <div className="flex min-w-0 flex-row items-start gap-4">
      {HeaderIcon ? <IconTile icon={HeaderIcon} tone={iconTone} size="lg" className="shrink-0" /> : null}
      <div className="min-w-0">
        {eyebrow ? (
          <span className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-muted)]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            {eyebrow}
          </span>
        ) : null}
        <h1 className={`font-heading text-balance text-2xl font-semibold tracking-tight sm:text-3xl ${accentTitle ? "text-accent-gradient" : "text-[var(--fg)]"}`}>
          {title}
        </h1>
        {description ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--fg-muted)]">{description}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">{titleRow}</div>
      {actions ? (
        <div className="flex w-full min-w-0 max-w-full flex-row flex-wrap items-center justify-end gap-x-2 gap-y-2 sm:max-w-[min(100%,56rem)] sm:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
```

---

## `panel/components/panel/Surface.tsx` — `Surface`
Card/panel container. Wraps `.panel-surface` global class (glassy elevated background, hover-lift
border glow — see `theme.md`). Props: `padding?: "none"|"sm"|"md"|"lg"`.

```tsx
import type { ReactNode } from "react";

type SurfaceProps = { children: ReactNode; className?: string; padding?: "none" | "sm" | "md" | "lg" };

const pad: Record<NonNullable<SurfaceProps["padding"]>, string> = {
  none: "", sm: "p-3", md: "p-5", lg: "p-6 sm:p-8",
};

export function Surface({ children, className = "", padding = "md" }: SurfaceProps) {
  return <div className={`panel-surface ${pad[padding]} ${className}`}>{children}</div>;
}
```

---

## `panel/components/panel/PanelNavLink.tsx` — `PanelNavLink`
Nav-link wrapper choosing between Next `<Link>` (client-side transitions) and a plain `<a>` (full page
navigation), depending on whether a runtime base path is injected by the Go backend — needed because the
Next client router's RSC-flight fetch breaks against an unprefixed URL in that case.

```tsx
"use client";

import Link from "next/link";
import { getBasePath } from "@/lib/paths";

type Props = { href: string; className?: string; onClick?: () => void; children: React.ReactNode };

export function PanelNavLink({ href, className, onClick, children }: Props) {
  if (getBasePath()) {
    return <a href={href} className={className} onClick={onClick}>{children}</a>;
  }
  return <Link href={href} className={className} onClick={onClick}>{children}</Link>;
}
```

---

## `panel/components/panel/StatusPill.tsx` — `StatusPill`
Boolean-state pill (e.g. enabled/disabled), simpler cousin of `PillTag` with a fixed 2-state accent/
neutral styling. Props: `active`, `activeLabel`, `inactiveLabel`.

---

## Navbar chrome sub-components (used inside `PanelShell` header / login header)
- `PanelHeaderAppMeta.tsx` (272 lines) — update-available badge, version pill, user/account menu; has a
  `variant="login"` mode for the unauthenticated header.
- `PanelGitHubStarLink.tsx` (105 lines) — GitHub star-count link/button.
- `PanelTelegramNavLink.tsx` (22 lines) — Telegram support link icon.
- `PanelDonateNavLink.tsx` (23 lines) — donate link icon.

## Public subscription page shell (separate mini-layout family, not part of `PanelShell`)
`panel/components/sub/SubPageShell.tsx` + `SubPageRenderer.tsx` — used only by `app/panel/sub/page.tsx`
(the public, unauthenticated, brandable subscription page loaded via `PanelLayoutGate`'s bare-chrome
branch). Not analyzed in full here since it's a self-contained "mini site" rather than shared app chrome,
but worth knowing about since it's the panel's own closest analog to a public marketing/landing page.
