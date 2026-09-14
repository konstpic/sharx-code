# SharX Panel — Key Page Component Dependency Trees

Trees trace local imports (`@/...` alias and relative) recursively, one level of real component
dependencies deep for the largest pages (which are 1,000-7,000 lines each and pull in dozens of
sub-components); `lib/*` hooks/utilities are listed flat (not expanded further) since they are logic,
not visual components. Third-party packages (`framer-motion`, `lucide-react`, `recharts`, etc.) are
omitted except where relevant to what's rendered.

---

## `/` (Login Page)
Entry: `panel/app/page.tsx` (page component defined inline, not re-exported from `components/`)
Dependencies:
- `@/components/ui` (barrel) →
  - `Button` (`components/ui/button.tsx`)
  - `Input` (`components/ui/input.tsx`)
  - `SelectNative` (`components/ui/select-native.tsx`)
  - `Spinner` (`components/ui/spinner.tsx`)
  - `useToast` (`components/ui/toast-provider.tsx`)
- `@/components/panel` (barrel) →
  - `PanelHeaderAppMeta` (`components/panel/PanelHeaderAppMeta.tsx`)
  - `PanelTelegramNavLink` (`components/panel/PanelTelegramNavLink.tsx`)
  - `Surface` (`components/panel/Surface.tsx`)
- `@/lib/api` — `api`, `postJson`
- `@/lib/i18n` — `changeLanguage`, `panelSelectLangValue`, `supported`
- `@/lib/motion` — `easeStandard`, `durations`
- `@/lib/panelTheme` — `parsePanelTheme`, `applyPanelTheme`
- `@/lib/paths` — `p`
- `@/lib/usePublicAppMeta` — `usePublicAppMeta` hook

Notable: does NOT use `PanelShell`/`PageScaffold`/`PageHeader` — fully bespoke full-screen layout
(`.login-backdrop` CSS vortex).

---

## `/panel/` (Dashboard)
Entry: `panel/app/panel/page.tsx` → `components/DashboardPage.tsx` (2122 lines — the app's operational
home screen)
Dependencies:
- `@/components/panel` (barrel) →
  - `PageScaffold` (`components/panel/PageScaffold.tsx`)
  - `PageHeader` (`components/panel/PageHeader.tsx`)
  - `Surface` (`components/panel/Surface.tsx`)
- `@/components/ui` (barrel) →
  - `AlertBanner`, `Button`, `CheckboxField`, `ConfirmDialog` (→ `Modal`, `Button`), `IconButton`,
    `IconTile`, `Input`, `LinearProgress`, `Modal`, `PillTag`, `Reveal` (→ `Stagger`, `StaggerItem` via
    same file), `SelectNative`, `Spinner`, `Stagger`, `StaggerItem`, `StatBlock`, `useToast`
- `@/lib/api` — `getJson`, `postJson`, `api`
- `@/lib/format` — `formatSecond`, `sizeFormat`, `toFixed`
- `@/lib/panelWebSocket` — `usePanelWebSocket` (live stats feed)
- `@/lib/paths` — `linkP`, `panel`, `p`
- `@/lib/panelTheme` — `usePanelAccentColor`
- `@/lib/useCountUp` — animated number counter hook
- `@/lib/useLogStream` — `useLogStream`, `LogEntry` type (tails backend logs)
- `@/lib/dashboardLayout` — widget order/visibility persistence (`DASHBOARD_WIDGET_ORDER`,
  `encodeDashboardWidgets`, `parseDashboardWidgets`, `toggleDashboardWidget`)
- `@/lib/uiPrefs` — `getUiPref`, `setUiPref`
- `react-window` — `FixedSizeList` (virtualized log list)
- `next/link` — `Link` (quick nav to Inbounds/Clients/Nodes/Settings)

Renders: draggable/toggleable widget grid (traffic stats, CPU/memory `StatBlock`s, node/client counts,
recent-activity log stream), all inside `PageScaffold` → `PageHeader` → `Surface` cards.

---

## `/panel/inbounds/` (Inbounds — largest page, ~6964 lines)
Entry: `panel/app/panel/inbounds/page.tsx` → `components/InboundsPage.tsx`
Dependencies:
- `@/components/panel` (barrel) → `PageScaffold`, `PageHeader`, `SectionHelpModal`
  (`components/panel/SectionHelpModal.tsx`), `Surface`
- `@/components/ui` (barrel) — large subset: `Button`, `Checkbox`/`CheckboxField`
  (`checkbox-field.tsx`), `CheckboxOptionCard`/`CheckboxOptionList`/`SelectionListToolbar`
  (`checkbox-option.tsx`), `Drawer`, `Input`, `Modal`, `SelectNative`, `Switch`, `Tabs`, `Textarea`,
  `useToast`, `HelpTooltip` (`help-tooltip.tsx`)
- `@/components/inbounds/InboundXrayCoreEditor.tsx` — full Xray core JSON editor sub-panel
- `@/components/inbounds/InboundColumnFiltersBar.tsx` — column visibility/sort/filter toolbar
- `@/components/inbounds/InboundTlsCertPinBlock.tsx` — TLS cert pinning fields sub-block
- `@/components/inbounds/InboundListViews.tsx` (implied — table/list rendering, referenced alongside
  filters bar in nearby imports)
- `@/components/CompareModeFilterField.tsx` — numeric/traffic comparison filter field (`CompareOp` type)
- `@/lib/api` — `getJson`, `postJson`
- `@/lib/amneziawgInbound` — AmneziaWG protocol-specific form helpers
- `@/lib/shadowsocksKeys` — `randomShadowsocksServerPassword`
- `@/lib/format` — `sizeFormat`
- `@/lib/panelWebSocket` — `usePanelWebSocket`
- `@/lib/paths` — `panel`
- `@/lib/inboundTag` — `suggestInboundTag`, `validateInboundTagInput`
- (additional `@/lib/*` config-building helpers for Xray settings/sniffing/stream-settings/flow —
  business logic, not UI)

Renders: multi-protocol (VLESS/VMess/Trojan/Shadowsocks/WireGuard/AmneziaWG) inbound CRUD table with
grid/list view toggle, bulk multi-select actions via `CheckboxOptionList`, create/edit forms in
`Drawer`/`Modal`, tabbed protocol-specific settings via `Tabs`.

---

## `/panel/nodes/` (Nodes — ~2191 lines)
Entry: `panel/app/panel/nodes/page.tsx` → `components/NodesPage.tsx`
Dependencies:
- `@/components/panel` (barrel) → `PageScaffold`, `PageHeader`, `SectionHelpModal`, `Surface`
- `@/components/ui` (barrel) — `Button`, `Modal`, `Drawer`, `Stepper`, `useToast`, etc. (multi-step
  registration wizard uses `Stepper` from `components/ui/stepper.tsx`)
- `@/components/NodeRegisterStep.tsx` — one step of the node registration wizard
- `@/components/NodeResourceDrawer.tsx` — live CPU/RAM/disk usage `Drawer` panel per node
- `@/components/nodes/NodeListViews.tsx` — `NodeListView`, `NodeTilesView`, `NodeViewMode` type
  (table vs. card/tile layout toggle)
- `@/components/nodes/NodeColumnFiltersBar.tsx` — column filter/sort toolbar
- `@/components/nodes/nodeBadges.tsx` — status badge helpers (online/offline/degraded)
- `@/lib/api` — `getJson`, `postJson`
- `@/lib/copyToClipboard` — `copyTextToClipboard`
- `@/lib/nodeAddress` — address/port parsing helpers
- `@/lib/nameFlag` — country-flag-by-name-suffix helpers (`NAME_FLAG_SELECT_OPTIONS`)
- `@/lib/panelWebSocket` — `usePanelWebSocket` (live node status)
- `@/lib/paths` — `panel`

---

## `/panel/clients/` (Clients — ~5177 lines)
Entry: `panel/app/panel/clients/page.tsx` → `components/ClientsPage.tsx`
Dependencies:
- `@/components/panel` (barrel) → `PageScaffold`, `PageHeader`, `SectionHelpModal`, `Surface`
- `@/components/ui` (barrel) — `Button`, `Checkbox`/`CheckboxField`, `Modal`, `Drawer`, `PillTag`,
  `Tabs`, `useToast`, etc.
- `@/components/CompareModeFilterField.tsx` — `CompareModeFilterField`, `CompareOp` type
- `qrcode.react` — `QRCodeSVG` (subscription-link QR codes)
- `@/lib/api` — `getJson`, `postJson`
- `@/lib/panelWebSocket` — `usePanelWebSocket`
- `@/lib/copyToClipboard` — `copyTextToClipboard`
- `@/lib/format` — `normalizeDatetimeLocalInput`, `panelTimestampToMs`, `sizeFormat`,
  `speedMbpsFormat`
- `@/lib/paths` — `panel`
- `@/lib/wireguardConf` — WireGuard `.conf` file generation/parsing helpers
- `@/lib/uiPrefs` — `getUiPref`, `setUiPref`

---

## `/panel/settings/[tab]/` (Settings — ~1926 lines)
Entry: `panel/app/panel/settings/[tab]/page.tsx` → `components/SettingsPage.tsx`
Dependencies:
- `@/components/panel` (barrel) → `PageScaffold`, `PageHeader`, `Surface`
- `@/components/settings/RemarkModelConstructor.tsx` — client-remark template builder
- `@/components/settings/RemarkModelOrderBuilder.tsx`
- `@/components/settings/TgRunTimeField.tsx` — Telegram-bot scheduling field
- `@/components/settings/subscription/SubscriptionBuilder.tsx` — orchestrates the whole
  subscription-page builder tab, itself importing:
  - `BlockCard.tsx`, `BlockListEditor.tsx`, `BlockPaletteModal.tsx` (drag-and-drop block list)
  - `BrandingEditor.tsx`, `CustomRemarksEditor.tsx`, `JsonTemplatesEditor.tsx`,
    `ResponseRulesEditor.tsx`, `RoutingProfilesEditor.tsx`
  - `SubscriptionPreview.tsx` — live device-frame preview (uses `.sub-preview-frame` CSS)
  - `blocks/index.tsx` re-exporting per-block editors: `AddToAppEditor`, `CustomHtmlEditor`,
    `InstallationGuideEditor`, `LinksListEditor`, `MetricsEditor`, `SubscriptionInfoEditor`,
    `SupportCtaEditor`
- `@/components/ui/help-tooltip.tsx` — `HelpKey` type
- `@/lib/allSetting` — `AllSetting` type, `normalizeAllSetting`
- `@/lib/api` — `getJson`, `postJson`
- `@/lib/copyToClipboard`, `@/lib/panelTimeZones`, `@/lib/i18n`, `@/lib/paths`, `@/lib/settingsTabs`,
  `@/lib/uiPrefs`

This is the single most deeply-nested feature area in the codebase (subscription page visual builder).

---

## `/panel/xray/` and `/panel/xray/geo/` (Xray Config — ~988 lines)
Entry: `panel/app/panel/xray/page.tsx` / `.../xray/geo/page.tsx` → `components/XrayPage.tsx`
(`initialView` prop differs)
Dependencies:
- `@/components/panel` (barrel) → `PageScaffold`, `PageHeader`, `Surface`
- `@/components/XrayTemplateNav.tsx` — `XrayTemplateNav`, `XrayTemplateNavId` type (section nav)
- `@/components/xray/sectionButtonLabel.ts` — label helper
- `@/components/xray/SimpleCoreForm.tsx` — simplified/guided Xray core config form
- `@/components/xray/XrayTemplateSectionContent.tsx` — advanced per-section JSON editor content
  (wraps `MonacoJsonEditor`)
- `@/components/ui` (barrel) → `Button`, `ConfirmDialog`, `Spinner`, `Stepper`, `useToast`, `Input`,
  `Modal`, `Switch`
- `@/lib/api` — `api`, `getJson`, `postJson`
- `@/lib/xraySimpleCore` — `patchSimpleCore`, `XraySimpleCore` type
- `@/lib/paths` — `linkP`, `panel`
- `@/lib/allSetting` — `normalizeAllSetting`

---

## `/panel/db-inspector/` (DB Inspector — smaller but structurally distinct)
Entry: `panel/app/panel/db-inspector/page.tsx` → `components/DatabaseInspectorPage.tsx` (170 lines)
Dependencies:
- `@/components/database/TableSidebar.tsx` — table list nav
- `@/components/database/TableViewer.tsx` — paginated data grid
  - `@/components/database/EditableCell.tsx` (used inside `TableViewer`)
- `@/components/panel/PageHeader.tsx` (imported directly, not via barrel)
- `@/components/ui/button.tsx`, `@/components/ui/toast-provider.tsx` (imported directly)
- `@/lib/useDatabaseTables` — `useDatabaseTables` hook
- `@/lib/useTableData` — `useTableData` hook

Notable: imports individual component files rather than the `@/components/ui` / `@/components/panel`
barrels — the only key page that does so.

---

## Summary table (all `/panel/*` pages, entry → primary component)

| Route | Entry | Component | Lines |
|---|---|---|---|
| `/` | `app/page.tsx` | inline `LoginPage` | 269 |
| `/panel/` | `app/panel/page.tsx` | `DashboardPage` | 2122 |
| `/panel/inbounds/` | `app/panel/inbounds/page.tsx` | `InboundsPage` | 6964 |
| `/panel/nodes/` | `app/panel/nodes/page.tsx` | `NodesPage` | 2191 |
| `/panel/clients/` | `app/panel/clients/page.tsx` | `ClientsPage` | 5177 |
| `/panel/settings/[tab]/` | `app/panel/settings/[tab]/page.tsx` | `SettingsPage` | 1926 |
| `/panel/xray/`, `/panel/xray/geo/` | `app/panel/xray/page.tsx` | `XrayPage` | 988 |
| `/panel/hosts/` | `app/panel/hosts/page.tsx` | `HostsPage` | 1666 |
| `/panel/groups/` | `app/panel/groups/page.tsx` | `GroupsPage` | 1378 |
| `/panel/nodes/geography/` | `app/panel/nodes/geography/page.tsx` | `NodesGeographyPage` | 833 |
| `/panel/xray-core-config-profiles/` | `app/panel/xray-core-config-profiles/page.tsx` | `XrayCoreConfigProfilesPage` | 578 |
| `/panel/clients/statistics/` | `app/panel/clients/statistics/page.tsx` | `ClientsStatisticsPage` | 471 |
| `/panel/nodes/statistics/` | `app/panel/nodes/statistics/page.tsx` | `NodesStatisticsPage` | 416 |
| `/panel/api-docs/` | `app/panel/api-docs/page.tsx` | `ApiDocsPage` | 196 |
| `/panel/db-inspector/` | `app/panel/db-inspector/page.tsx` | `DatabaseInspectorPage` | 170 |
| `/panel/outbounds/` | `app/panel/outbounds/page.tsx` | inline wrapper of `SimpleListPage` | 98 (SimpleListPage) |
