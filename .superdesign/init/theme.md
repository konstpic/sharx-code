# SharX Panel — Design Tokens & Theme

**Framework**: Tailwind CSS v4 (`^4`, via `@tailwindcss/postcss`), no `tailwind.config.js`/`.ts` — v4
is CSS-first, configured entirely inside `panel/app/globals.css` via `@import "tailwindcss";` +
`@theme inline { ... }` + plain CSS custom properties on `:root`. There is no separate component
library (no shadcn/ui) — every visual primitive is bespoke (see `components.md`).

The panel ships **8 selectable palettes**, all dark except two light ones, switched at runtime via
`data-panel-theme="<name>"` and `data-theme="dark"|"light"` attributes on `<html>` (persisted via
`getUiPref`/`applyPanelTheme`, see `lib/panelTheme.ts`). The **default app theme when embedding SharX
marketing content** is `data-panel-theme="web"` (set as the hardcoded default in `app/layout.tsx`) — a
near-black background with a violet/indigo accent pair. This is the theme to treat as "canonical" for a
standalone marketing/landing page design, since it's what ships as the default and is explicitly
labelled for "SharX WEB".

---

## Part 1 — Token Summary

### Font families (`@theme inline` in `globals.css`, Google Fonts loaded in `app/layout.tsx`)
| Token | Value | Used for |
|---|---|---|
| `--font-sans` | `var(--font-mont)` → Montserrat | Body text (default) |
| `--font-heading` | `var(--font-unbounded)` → Unbounded | All headings, nav brand, page titles |
| `--font-mono` | `var(--font-fira)` → Fira Mono | Code blocks |
| `--font-script` | `var(--font-sacramento)` → Sacramento, falls back to `--font-sans` | Login page "Hello" greeting only |
| (Star Wars theme only) `--font-heading` | Orbitron | overridden per-theme in `star-wars-theme.css` |
| (Star Wars theme only) `--font-sans` | Pathway Gothic One → Montserrat | overridden per-theme |

### Color palette — default theme (`:root, :root[data-theme="dark"]`)
| Token | Value | Role |
|---|---|---|
| `--bg` | `#0d1117` | Page background |
| `--bg-elevated` | `#1c2128` | Cards, inputs, modals |
| `--surface` | `rgba(36,44,56,0.55)` | Subtle panels (tab strips, toolbars) |
| `--surface-strong` | `rgba(36,44,56,0.85)` | Hover/active surfaces |
| `--border` | `rgba(139,148,158,0.15)` | Default hairline border |
| `--border-strong` | `rgba(34,211,238,0.25)` | Emphasized border (buttons, focus) |
| `--fg` | `#c9d1d9` | Primary text |
| `--fg-muted` | `#8b949e` | Secondary text |
| `--fg-subtle` | `rgba(201,209,217,0.55)` | Placeholder / tertiary text |
| `--accent` | `#22d3ee` (cyan) | Primary accent / links / focus rings |
| `--accent-ambient` | `#9775fa` (violet) | Secondary accent, gradient partner |
| `--code-bg` | `rgba(36,44,56,0.9)` | Inline code / pre backgrounds |
| `--ifm-color-primary` / `--ifm-color-secondary` | `#22d3ee` / `#9775fa` | Docusaurus-style aliases (legacy naming, still used) |

### Color palette — **`web` theme** (`:root[data-panel-theme="web"]`) — the app default
> Labeled in source as matching "SharX WEB (~/Code/SharX WEB) — dark base + system palette".
> This is the primary brand palette a new marketing site should draw from.

| Token | Value |
|---|---|
| `--bg` | `#05060a` (near-black) |
| `--bg-elevated` | `#0c0f18` |
| `--surface` | `rgba(255,255,255,0.04)` |
| `--surface-strong` | `rgba(255,255,255,0.08)` |
| `--border` | `rgba(255,255,255,0.1)` |
| `--border-strong` | `rgba(255,255,255,0.18)` |
| `--fg` | `#f5f7fb` |
| `--fg-muted` | `rgba(245,247,251,0.66)` |
| `--fg-subtle` | `rgba(245,247,251,0.44)` |
| `--accent` (primary) | `#8577f2` (indigo/violet) |
| `--accent-ambient` (secondary) | `#6c52c7` (deeper purple) |
| `--code-bg` | `rgba(255,255,255,0.06)` |

### Other named dark palettes (all set `--bg`/`--fg`/`--accent`/`--accent-ambient` similarly; switch via `data-panel-theme`)
| Theme key | Primary accent | Secondary accent | Background | Flavor |
|---|---|---|---|---|
| `midnight` | `#60a5fa` (blue) | `#818cf8` (indigo) | `#0a1628` | Cool blue |
| `ember` | `#f59e0b` (amber) | `#f472b6` (pink) | `#140f0c` | Warm amber |
| `boreal` | `#14b8a6` (teal) | `#22c55e` (green) | `#0a1412` | Teal/green |
| `xuiClassic` | `#008771` (teal-green) | `#3ad3ba` | `#0a1222` | 3x-ui-compatible dark |
| `starWars` | `#ffe81f` (lightsaber gold) | `#c41e3a` (imperial red) | `#030508` | Themed FX (hyperspace/lasers/starfield), Orbitron display font |
| *(no `data-panel-theme` attr)* default | `#22d3ee` (cyan) | `#9775fa` (violet) | `#0d1117` | Graph-paper grid background |

### Light palettes (`data-theme="light"`)
| Theme key | Primary accent | Background | Notes |
|---|---|---|---|
| *(base light, `data-theme="light"` w/o panel theme)* | `#007aff` (iOS blue) | `#f2f2f7` | Apple-system inspired |
| `vision` | `#007aff` | `#f2f2f7` | Frosted-glass / visionOS mesh — multi-color ambient radial gradients, `backdrop-filter: blur()` on cards/navbar |

### Motion tokens
| Token | Value |
|---|---|
| `--motion-fast` | `150ms` |
| `--motion-base` | `220ms` |
| `--motion-slow` | `420ms` |
| `--ease-standard` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--ease-out-soft` | `cubic-bezier(0.16, 1, 0.3, 1)` |

Framer Motion JS-side equivalents (`panel/lib/motion.ts`):
```ts
easeStandard = [0.22, 1, 0.36, 1]
easeOutSoft  = [0.16, 1, 0.3, 1]
durations = { fast: 0.15, base: 0.22, slow: 0.42 }  // seconds
spring = { type: "spring", stiffness: 420, damping: 30, mass: 0.9 }
```
Reusable Framer Motion variants exported: `fadeUp`, `fadeIn`, `scaleIn`, `listContainer`/`listItem`
(staggered list entrance, `staggerChildren: 0.05, delayChildren: 0.04`), `tabContentVariants`.

### Spacing / layout
- `--section-gap`: `2rem` (mobile) → `3rem` at `min-width: 48em` → `4rem` at `min-width: 62em`.
- Page horizontal padding (via `PageScaffold`): `px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12`.
- No custom Tailwind spacing scale — uses Tailwind v4 defaults throughout (`p-3`, `p-5`, `gap-2`, etc).

### Border radius
- `--ifm-global-radius`: `0.75rem` (12px) — the standard card/button radius used almost everywhere
  (`rounded-xl` = 0.75rem in Tailwind v4 defaults). Pills/badges use `rounded-full`. Modals use
  `rounded-2xl` (1rem).

### Shadows
No custom shadow tokens; uses ad-hoc `box-shadow` values inline, e.g.:
- `.panel-surface` / `.panel-card`: `0 4px 24px rgba(0,0,0,0.2)`, hover `0 20px 40px rgba(0,0,0,0.3)`.
- `.panel-navbar`: `0 4px 12px rgba(0,0,0,0.3)` (dark) / `0 1px 3px rgba(0,0,0,0.08)` (light).
- Modals: Tailwind `shadow-2xl`.

### Breakpoints
Tailwind v4 defaults (`sm` 40rem/640px, `md` 48rem/768px, `lg` 64rem/1024px, `xl` 80rem/1280px, `2xl`
96rem/1536px), plus two custom em-based breakpoints used directly in `globals.css` for the
`--section-gap` responsive scale: `48em` (768px) and `62em` (992px). Mobile-specific overrides target
`max-width: 48em`.

### Key reusable CSS utility classes (global, in `globals.css`)
- `.panel-surface`, `.panel-card` — glassy elevated card with top gradient accent line on hover, lift on hover.
- `.panel-btn-primary` — gradient CTA button (`linear-gradient(135deg, var(--ifm-color-primary), var(--ifm-color-secondary))`), shimmer sweep on hover.
- `.text-accent-gradient` / `.accent-gradient` — text/bg gradient using accent + accent-ambient.
- `.status-pill`, `.status-pill--{green|blue|amber|rose|neutral}` — colored status badges.
- `.icon-tile`, `.icon-tile--{accent|info|success|warning|danger|neutral}` — colored icon squares.
- `.panel-menu-link`, `.panel-menu-link--active`, `.panel-menu-link--sub` — sidebar nav link states.
- `.login-backdrop` — animated conic-gradient "vortex" background (login page only), respects
  `prefers-reduced-motion`.
- `.reveal` / `.reveal-in` — scroll-reveal fade+rise+blur utility (700ms).
- `.route-fade` / `.route-fade-in` — opacity-only route-change fade (400ms), used by `PanelShell`.
- `.prose-doc` — full typographic scale for markdown/API-docs content (h1 2.25rem → h4 1rem, code,
  blockquote, table styling).
- `.sub-preview-frame`, `.sub-preview-frame--phone/--desktop` — device-frame mockup for the
  subscription-page builder's live preview.

---

## Part 2 — Raw Source Dumps

### `panel/postcss.config.mjs` (Tailwind v4 entry point — no separate tailwind.config file exists)
```js
const config = {
  plugins: ["@tailwindcss/postcss"],
};
export default config;
```

### `panel/app/globals.css` — full file is 1625 lines. Structure:
1. `@import "tailwindcss";` + `@import "../styles/star-wars-theme.css";`
2. `@theme inline { --font-sans/--font-mono/--font-heading/--font-script }` (Tailwind v4 theme tokens)
3. `@property --accent` / `@property --accent-ambient` (typed CSS custom properties, animatable colors)
4. `:root, :root[data-theme="dark"]` — the default dark token set (IFM aliases + app tokens + panel
   chrome tokens + motion tokens) — see Part 1 tables above for full values.
5. Eight `:root[data-panel-theme="<name>"]` blocks (`midnight`, `ember`, `boreal`, `web`, `xuiClassic`,
   `starWars`, then `:root[data-theme="light"]` base, then `vision`) each overriding the same token set.
6. `html[data-panel-theme="vision"]` — multi-radial-gradient mesh background + glass `backdrop-filter`
   rules specific to the Vision theme.
7. `.login-backdrop` + `::before`/`::after` pseudo-element spiral layers + `@keyframes login-vortex-cw/ccw`
   — the login page's animated vortex, with a `prefers-reduced-motion` static fallback.
8. Responsive `--section-gap` scale (`@media min-width: 48em/62em`).
9. Global resets: `* { box-sizing: border-box }`, `html { background-color: var(--bg) ...}`.
10. Per-theme `html[data-panel-theme="X"]` background-image rules (grid patterns, diagonal gradients) —
    one block per named theme, each with a matching `::before` (fixed haze layer) and `body::after`
    (content wash layer) pair for layered ambient glow effects.
11. Typography base: `a { color: inherit }`, `h1..h6 { font-family: var(--font-heading); font-weight: 600 }`.
12. Panel chrome classes: `.panel-root`, `.panel-main`, `.panel-navbar` (+ light-mode shadow override),
    `.panel-update-badge` (+ `--login`/`--panel` size variants), `.status-pill` + tone variants (+
    light-mode text color overrides), `.panel-navbar-brand`/`.panel-page-title`/`.font-heading`,
    `.font-login-welcome`, `.panel-doc-sidebar`.
13. `@supports (view-transition-name: none)` — named view-transition groups for header/aside/content
    (currently unused since `experimental.viewTransition` is disabled in `next.config.ts`, but CSS is
    kept for future re-enable).
14. Mobile background-size overrides (`@media max-width: 48em`).
15. `.panel-menu-link` (+ shimmer-on-hover `::before`, `--active`, `--sub` variants).
16. `.icon-tile` + 6 tone variants.
17. `.panel-surface`/`.panel-card` (+ hover gradient-line `::before`, hover lift, mobile no-lift).
18. `.panel-btn-primary` (+ shimmer `::before` sweep on hover).
19. Legacy utility classes: `.glass`/`.glass-strong`, `.text-accent`, `.text-accent-gradient`,
    `.accent-gradient`, `section[id] { scroll-margin-top }`.
20. `.route-fade`/`.route-fade-in` + `@keyframes routeFadeInOpacity`.
21. `.reveal`/`.reveal-in` (700ms fade+rise+blur).
22. `::selection` — accent-tinted text selection.
23. `.prose-doc` — full markdown typography scale (h1-h4, p, a, figure/pre code highlighting via
    Shiki CSS vars `--shiki-dark*`, strong, ul/ol/li, code, pre, blockquote, hr, table/th/td, img).
24. `@media (hover: hover) { *::-webkit-scrollbar... }` — custom thin scrollbar styling.
25. `@media (prefers-reduced-motion: reduce)` — global animation kill-switch.
26. `.panel-skeleton` + `@keyframes panel-skeleton-shimmer` — loading shimmer.
27. `.sub-block-draggable`(+ `--dragging`), `.sub-block-drop-before/--after` — drag-and-drop visuals
    for the subscription page builder.
28. `.sub-preview-frame` (+ `--phone`/`--desktop`) — device mockup frame for subscription preview.
29. `.panel-data-table .ant-table*` — Ant Design table style overrides used in the DB inspector table
    view.

(Full byte-for-byte content available at `panel/app/globals.css` — this file was read in full during
analysis; reproduced here as a structural map rather than a raw 1625-line dump to keep this document
navigable. The critical `:root` token block — the part any new design should actually reuse — is
reproduced verbatim below.)

```css
@import "tailwindcss";
@import "../styles/star-wars-theme.css";

@theme inline {
  --font-sans: var(--font-mont), "Montserrat", system-ui, sans-serif;
  --font-mono: var(--font-fira), "Fira Mono", ui-monospace, monospace;
  --font-heading: var(--font-unbounded), "Unbounded", system-ui, sans-serif;
  --font-script: var(--font-sacramento), var(--font-sans), cursive, serif;
}

@property --accent {
  syntax: "<color>";
  inherits: true;
  initial-value: #22d3ee;
}

@property --accent-ambient {
  syntax: "<color>";
  inherits: true;
  initial-value: #9775fa;
}

:root,
:root[data-theme="dark"] {
  color-scheme: dark;
  --ifm-color-primary: #22d3ee;
  --ifm-color-secondary: #9775fa;
  --ifm-color-content: #c9d1d9;
  --ifm-color-content-secondary: #8b949e;
  --ifm-heading-color: #c9d1d9;
  --ifm-link-color: #22d3ee;
  --ifm-link-hover-color: #67e8f9;
  --ifm-card-background-color: rgba(36, 44, 56, 0.8);
  --ifm-global-radius: 0.75rem;
  --bg: #0d1117;
  --bg-elevated: #1c2128;
  --surface: rgba(36, 44, 56, 0.55);
  --surface-strong: rgba(36, 44, 56, 0.85);
  --border: rgba(139, 148, 158, 0.15);
  --border-strong: rgba(34, 211, 238, 0.25);
  --fg: #c9d1d9;
  --fg-muted: #8b949e;
  --fg-subtle: rgba(201, 209, 217, 0.55);
  --code-bg: rgba(36, 44, 56, 0.9);
  --accent: #22d3ee;
  --accent-ambient: #9775fa;
  --section-gap: 2rem;
  --panel-chrome-fg: rgba(255, 255, 255, 0.92);
  --panel-chrome-fg-muted: rgba(255, 255, 255, 0.55);
  --panel-chrome-fg-subtle: rgba(255, 255, 255, 0.4);
  --panel-chrome-fg-strong: rgba(255, 255, 255, 0.8);
  --panel-chrome-icon: rgba(255, 255, 255, 0.8);
  --panel-chrome-hover-bg: rgba(255, 255, 255, 0.1);
  --panel-chrome-star: rgba(253, 230, 138, 0.85);
  --panel-chrome-star-hover: #fde68a;
  --panel-chrome-donate: rgba(253, 164, 175, 0.85);
  --panel-chrome-donate-hover: #fda4af;
  --motion-fast: 150ms;
  --motion-base: 220ms;
  --motion-slow: 420ms;
  --ease-standard: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out-soft: cubic-bezier(0.16, 1, 0.3, 1);
}

/* SharX WEB (~/Code/SharX WEB) — dark base + system palette (#8577f2 / #6c52c7) */
:root[data-panel-theme="web"] {
  --ifm-color-primary: #8577f2;
  --ifm-color-secondary: #6c52c7;
  --ifm-link-color: #8577f2;
  --ifm-link-hover-color: #a599f5;
  --ifm-heading-color: #f5f7fb;
  --ifm-color-content: #f5f7fb;
  --ifm-color-content-secondary: rgba(245, 247, 251, 0.66);
  --ifm-card-background-color: rgba(12, 15, 24, 0.72);
  --bg: #05060a;
  --bg-elevated: #0c0f18;
  --surface: rgba(255, 255, 255, 0.04);
  --surface-strong: rgba(255, 255, 255, 0.08);
  --border: rgba(255, 255, 255, 0.1);
  --border-strong: rgba(255, 255, 255, 0.18);
  --fg: #f5f7fb;
  --fg-muted: rgba(245, 247, 251, 0.66);
  --fg-subtle: rgba(245, 247, 251, 0.44);
  --code-bg: rgba(255, 255, 255, 0.06);
  --accent: #8577f2;
  --accent-ambient: #6c52c7;
}
```

Full theme-switching machinery (all 8 `data-panel-theme` blocks + `vision` mesh background + `.login-
backdrop` spiral animation + all per-theme `html[data-panel-theme="X"]` background layers) lives in
`panel/app/globals.css` lines 1–797; read that file directly for exact values of the themes not
reproduced in full above (`midnight`, `ember`, `boreal`, `xuiClassic`, `starWars`, `vision`, base
`light`).

### `panel/styles/star-wars-theme.css` (337 lines)
Theme-specific cinematic FX layered only inside the authenticated panel shell (`.panel-cinema-bg`):
starfield background (inline SVG data-URI star pattern), hyperspace streak layer (`repeating-conic-
gradient`), animated "laser" bolt layers, plus `--font-heading: Orbitron`, `--font-sans: Pathway Gothic
One`, and glow shadow tokens (`--sw-glow`, `--sw-laser-glow`, `--sw-saber-edge`). Not relevant to a
marketing site design system beyond illustrating the codebase's per-theme extensibility pattern; full
source at `panel/styles/star-wars-theme.css`.

### `panel/lib/motion.ts` — Framer Motion tokens/variants (JS-side; imported by nearly every animated component)
```ts
import type { Transition, Variants } from "framer-motion";

export const easeStandard = [0.22, 1, 0.36, 1] as const;
export const easeOutSoft = [0.16, 1, 0.3, 1] as const;

export const durations = {
  fast: 0.15,
  base: 0.22,
  slow: 0.42,
} as const;

export const spring: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 30,
  mass: 0.9,
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: durations.slow, ease: easeStandard } },
  exit: { opacity: 0, y: -4, transition: { duration: durations.fast, ease: easeStandard } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.base, ease: easeStandard } },
  exit: { opacity: 0, transition: { duration: durations.fast, ease: easeStandard } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: durations.base, ease: easeStandard } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: durations.fast, ease: easeStandard } },
};

export const listContainer: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: durations.slow, ease: easeStandard } },
};

export const tabContentVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easeStandard } },
  exit: { /* ...truncated, symmetrical fade+y exit */ },
};
```

### Theme provider script (`panel/lib/theme-provider.ts`, injected inline in `app/layout.tsx <head>`)
Exports `themeInitScript` — a string of vanilla JS injected via `dangerouslySetInnerHTML` before
hydration, whose job is to read the persisted theme preference and set `data-theme`/`data-panel-theme`
on `<html>` synchronously (avoids flash-of-wrong-theme). Not reproduced in full here; see
`panel/lib/theme-provider.ts` and `panel/lib/panelTheme.ts` (`applyPanelTheme`, `parsePanelTheme`) for
the runtime theme-switching implementation used by `PanelShell` and the login page.
