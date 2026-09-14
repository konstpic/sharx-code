# SharX Panel — Extractable Design Components

Catalog of components/patterns worth reusing (or drawing visual language from) when designing the
standalone marketing/landing page. For each: name, source, category, what should become a prop
(varies per instance/page), and what's hardcoded (fixed brand/copy elements — explicitly NOT props,
since a landing page would replace these with its own brand content).

---

## Layout Components

### `AppShell` (conceptual — actual impl: `PanelShell`)
- Source: `panel/components/panel/PanelShell.tsx`
- Category: Layout
- Description: Top navbar + collapsible left sidebar + scrollable main content shell for the
  authenticated app.
- Extractable props: active nav item/route, nav item list (icons/labels/hrefs), mobile-nav open state,
  multi-node-mode flag (controls whether the "Nodes" nav group renders at all), per-group
  expanded/collapsed state.
- Hardcoded: "SharX" wordmark text + "Panel" subtitle, the specific icon-per-nav-item mapping
  (`LayoutDashboard`, `User`, `Server`, `Network`, `Building2`, `Settings`, `Wrench`, `BookOpen`,
  `LogOut` from `lucide-react`), the fixed nav item ordering/grouping logic itself, sidebar width
  (280px), navbar height (64px/`h-16`).
- **Not directly reusable for a landing page** (it's an authenticated app shell), but its navbar
  pattern (brand wordmark left, icon-link cluster right, `.panel-navbar` glass/blur treatment) is the
  right visual reference for a marketing site's header.

### `NavBar` (top chrome, extracted from `PanelShell` header + `PanelHeaderAppMeta`/`PanelGitHubStarLink`/
`PanelTelegramNavLink`/`PanelDonateNavLink`)
- Source: `panel/components/panel/PanelShell.tsx` (header block), `PanelHeaderAppMeta.tsx`,
  `PanelGitHubStarLink.tsx`, `PanelTelegramNavLink.tsx`, `PanelDonateNavLink.tsx`
- Category: Layout
- Description: Sticky/relative header bar, `.panel-navbar` class (blurred translucent background,
  bottom border, radial glow pseudo-element), brand block + right-aligned icon-link row.
- Extractable props: brand name/subtitle text, list of external links (GitHub star count, Telegram,
  Donate), whether to show a version/update badge.
- Hardcoded: exact link destinations (GitHub repo, Telegram channel, donate page — all product-specific
  URLs), specific icon choices.

### `Footer`
No dedicated footer component exists in the panel (it's an app, not a marketing site — content scrolls
within `<main>`, no persistent footer). A landing page will need to build this from scratch; borrow
`.panel-surface`/border-token treatment for visual consistency if desired.

### `PageHeader` (section/page title block — directly reusable pattern)
- Source: `panel/components/panel/PageHeader.tsx`
- Category: Layout / typography
- Description: Icon tile + eyebrow label + large heading (optionally gradient-text) + description +
  right-aligned actions row. This is the closest existing pattern to a landing-page "hero" text block
  and could be adapted almost directly (swap `h1` size up, drop the icon-tile constraint).
- Extractable props: `title`, `eyebrow`, `description`, `icon`, `iconTone`, `accentTitle` (gradient
  on/off), `actions` (CTA buttons slot).
- Hardcoded: nothing — this component is already fully generic/reusable as-is.

### `SubPageShell` / `SubPageRenderer` (public-facing shell family)
- Source: `panel/components/sub/SubPageShell.tsx`, `SubPageRenderer.tsx`
- Category: Layout
- Description: The only genuinely public/unauthenticated/brandable page shell in the codebase (renders
  the shareable VPN-subscription info page). Supports configurable branding (title/logo/support URL),
  theme, and color preset per deployment — closest existing precedent for "a page meant to be seen by
  people outside the ops team."
- Extractable props: `branding` (title, logoUrl, brandText, supportUrl), `theme`, `colorPreset`.
- Hardcoded: block-based rendering system tied to VPN subscription data (traffic/expiry/links) — not
  reusable content-wise, but the shell/branding-injection *pattern* is worth referencing.

---

## Basic Components

### `Button`
- Source: `panel/components/ui/button.tsx`
- Category: Basic / interactive
- Description: 5 variants (primary/secondary/ghost/danger/link), loading spinner state.
- Extractable props: `variant`, `loading`, `disabled`, `children`, all native button attrs.
- Hardcoded: the exact gradient stops for `primary` (`.panel-btn-primary` — `var(--ifm-color-primary)`
  → `var(--ifm-color-secondary)`), border-radius (`rounded-xl` = 12px), sizing (`px-4 py-2 text-sm`).
  **Directly reusable** for landing-page CTAs — this is the component to base "Get Started" / "Star on
  GitHub" buttons on.

### `PillTag` / `StatusPill`
- Source: `panel/components/ui/pill-tag.tsx`, `panel/components/panel/StatusPill.tsx`
- Category: Basic / badge
- Description: Small rounded status/label chips, 5 color tones (green/blue/neutral/amber/rose) via
  `.status-pill--{tone}` classes.
- Extractable props: `tone`, `children` (PillTag); `active`/`activeLabel`/`inactiveLabel` (StatusPill).
- Hardcoded: the 5 fixed tone-to-color mappings (defined in `globals.css`, not overridable per-instance
  without editing CSS). Good candidate for landing-page feature badges ("Self-hosted", "Open Source",
  "Multi-node").

### `IconTile`
- Source: `panel/components/ui/icon-tile.tsx`
- Category: Basic / iconography
- Description: Colored rounded-square icon container, 6 tones, 3 sizes.
- Extractable props: `icon` (any Lucide icon), `tone`, `size`.
- Hardcoded: the tone→color CSS mappings in `globals.css` (`.icon-tile--accent/info/success/warning/
  danger/neutral`). Directly reusable for a landing-page "features grid" (icon + heading + description
  cards) — this is a strong candidate to carry over as-is.

### `Surface` (card container)
- Source: `panel/components/panel/Surface.tsx`
- Category: Basic / container
- Description: `.panel-surface` glass card (blurred elevated background, subtle border, hover lift +
  gradient top-line reveal, box-shadow).
- Extractable props: `padding` (`none`/`sm`/`md`/`lg`), `children`, `className`.
- Hardcoded: the hover-lift/gradient-line animation baked into the global `.panel-surface` CSS class
  (not a prop). Good base for landing-page feature/pricing cards.

### `Input` / `Textarea` / `SelectNative`
- Source: `panel/components/ui/input.tsx`, `textarea.tsx`, `select-native.tsx`
- Category: Basic / forms
- Description: Consistently styled form controls (rounded, elevated background, accent focus ring).
- Extractable props: standard HTML attrs + `inputSize`.
- Hardcoded: chevron SVG data-URI in `SelectNative` (color `#94a3b8` baked in, doesn't follow theme
  tokens — would need updating for light themes). Useful if the landing page includes an email-capture
  or contact form.

### `Checkbox` / `CheckboxField` / `Switch`
- Source: `panel/components/ui/checkbox-field.tsx`, `switch.tsx`
- Category: Basic / forms
- Description: Custom-styled checkbox (sr-only input + animated check icon) and toggle switch
  (framer-motion spring dot).
- Extractable props: `checked`, `onChange`, `label` (CheckboxField), `size` (Switch).
- Hardcoded: check/dot colors via `--accent`/`--accent-fg` tokens (theme-aware, portable as-is).

### `Tabs` / `Segmented`
- Source: `panel/components/ui/tabs.tsx`, `segmented.tsx`
- Category: Basic / navigation
- Description: Animated pill/underline tab strips with `layoutId`-based sliding active indicator.
- Extractable props: `tabs`/`items`, `active`/`value`, `onChange`, `size`, `variant`.
- Hardcoded: nothing structural — both are fully generic and portable. Could be used for a landing-page
  feature-comparison or pricing-tier switcher.

### `Modal` / `Drawer` / `ConfirmDialog`
- Source: `panel/components/ui/modal.tsx`, `drawer.tsx`, `confirm-dialog.tsx`
- Category: Basic / overlay
- Description: Portal-rendered dialogs with backdrop blur and framer-motion entrance/exit.
- Extractable props: `open`, `onClose`, `title`, `children`, `footer`, `width`.
- Hardcoded: z-index values (`z-[90]`/`z-[95]`), backdrop color/blur amount. Could support a landing-page
  video/demo modal or newsletter signup.

### `AlertBanner`
- Source: `panel/components/ui/alert-banner.tsx`
- Category: Basic / feedback
- Description: Inline banner, 3 types (error/warning/info).
- Extractable props: `type`, `title`, `description`, `onClose`.
- Hardcoded: color mappings per type (red/amber/neutral-surface). Could work as a landing-page
  announcement banner ("New: v2.0 released").

### `Spinner` / `Skeleton` / `LinearProgress`
- Source: `panel/components/ui/spinner.tsx`, `skeleton.tsx`, `linear-progress.tsx`
- Category: Basic / feedback
- Description: Loading indicators.
- Extractable props: `size` (Spinner), `rounded` (Skeleton), `percent`/`strokeColor` (LinearProgress).
- Hardcoded: spin animation via Tailwind `animate-spin`; shimmer keyframes in global CSS
  (`panel-skeleton-shimmer`).

### `StatBlock`
- Source: `panel/components/ui/stat-block.tsx`
- Category: Basic / data display
- Description: Label + large tabular-nums value, optional prefix/suffix (units/icons).
- Extractable props: `title`, `value`, `prefix`, `suffix`.
- Hardcoded: nothing. Directly usable for a landing-page stats row ("10k+ nodes deployed", "99.9%
  uptime").

### `Reveal` / `Stagger` / `StaggerItem`
- Source: `panel/components/ui/reveal.tsx`
- Category: Basic / motion utility
- Description: Scroll-triggered fade+rise entrance animations (`whileInView`), and staggered list
  entrance. Both respect `prefers-reduced-motion`.
- Extractable props: `delay`, `once`, `amount` (Reveal); `staggerChildren`, `delayChildren` (Stagger).
- Hardcoded: nothing — fully generic. **Highly relevant** for a landing page's scroll-reveal sections
  (hero → features → CTA), since this is exactly the "content fades in as you scroll" pattern landing
  pages use.

### `Stepper`
- Source: `panel/components/ui/stepper.tsx`
- Category: Basic / navigation
- Description: Horizontal animated step indicator (done/current/pending/error dots + connecting lines),
  mobile-collapsed summary.
- Extractable props: `steps`, `activeId`, `onSelect`, `allowJump`, `variant`.
- Hardcoded: dot color-per-state mapping. Could work for an "How it works" 1-2-3 landing-page section
  if adapted to be non-interactive/scroll-linked instead of click-driven.

---

## Global Visual Language Worth Reusing (CSS, not components)

- **`.panel-btn-primary`** — the signature CTA gradient-shimmer button treatment (`--accent` →
  `--accent-ambient` diagonal gradient + hover shimmer sweep). This is the single most distinctive
  visual signature in the codebase and should likely define the landing page's primary CTA style.
- **`.text-accent-gradient`** — gradient text-clip utility, good for a hero headline word/phrase.
- **`.panel-surface`/`.panel-card`** hover-lift + top gradient-line reveal — good for feature/pricing
  cards.
- **`web` theme palette** (`--bg: #05060a`, `--accent: #8577f2`, `--accent-ambient: #6c52c7`) — the
  default/canonical brand palette (see `theme.md`) and the one to build the landing page around, since
  it's explicitly labeled in source as the "SharX WEB" system palette.
- **`.login-backdrop`** animated vortex/spiral CSS background — a strong candidate for a hero-section
  background treatment (pure CSS, no images, theme-token-driven via `--accent`/`--accent-ambient`,
  already has a `prefers-reduced-motion` fallback).
- **Fonts**: Unbounded (headings) + Montserrat (body) is the established type pairing; a landing page
  should keep this pairing for brand consistency rather than introducing new fonts.
