# 9. Subscription Page

[← Groups](./08-groups.md) | [Contents](./README.md) | [Routing →](./10-routing.md)

## Two Levels of Subscription

SharX separates subscription into two levels:

| Level | Address | For whom |
|-------|---------|----------|
| **Subscription endpoint** | `https://domain:2096/sub/<subId>` | Client applications (Happ, v2rayNG, Clash…) |
| **Public page** | `https://panel-domain/panel/sub/?id=<subId>` | End user's browser |

When a user opens the subscription link **in a browser** (User-Agent with `text/html`), the panel redirects to the public page. Applications receive configuration in machine-readable format.

The `?legacy=1` parameter disables redirect to the public page.

## Response Formats by Client

The panel determines format by User-Agent:

| Client | Format |
|--------|--------|
| **Happ** | Encrypted JSON |
| **v2rayTun** | Encrypted JSON |
| **v2rayNG, Hiddify, Streisand, Shadowrocket, Karing, Nekobox** | Base64 |
| **Clash / Mihomo** | Clash YAML |
| **sing-box** | Xray JSON |
| **INCY** | Base64 |
| **Browser** | Redirect to public page |

Force format: `?format=clash` or `?format=mihomo`.

## Builder Setup (Step by Step)

### Step 1. Branding

1. **Panel Settings → “Subscription & JSON” → “Public subscription page (SharX)”**.
2. **Branding** tab:
   - **Name** — service name (`MyVPN`, `SharX Net`);
   - **Logo** — PNG/SVG URL (e.g. `https://example.com/logo.png`);
   - **Colors** — primary, background, accent (choose contrast for dark/light theme);
   - **Favicon** — browser tab icon.
3. On the right — **preview** of the page.

### Step 2. Blocks

**Blocks** tab → add and order:

| Recommended order | Block |
|-------------------|-------|
| 1 | `subscription-info` — traffic, expiry, status |
| 2 | `add-to-app` — import buttons for Happ / v2rayTun |
| 3 | `links-list` — server list with QR |
| 4 | `installation-guide` — installation instructions |
| 5 | `support-cta` — support link |

Drag blocks to change order.

### Step 3. Response Rules

**Response rules** tab:

| Field | Example | Purpose |
|-------|---------|---------|
| Profile-Title | `MyVPN Premium` | Name in Happ |
| Profile-Update-Interval | `12` | Update every 12 h |
| Announce | `Server updated 01.06` | In-app notification |
| Support-Url | `https://t.me/support` | Support button |
| providerid | Provider UUID | For Happ app-management |

### Step 4. Custom Remarks

**“Subscription remarks”** tab — texts shown when blocked:

```
Expired: "Subscription expired. Contact support."
Traffic limit: "Traffic exhausted. Renew your plan."
HWID: "Device limit exceeded."
```

Enable **Show custom remarks** if you want to hide real servers when restricted.

### Step 5. Save

**Save** button at the bottom of the builder. Verify the page: open `/panel/sub/?id=<subId>` of a test client.

---

## Subscription Page Builder

Configuration: **Panel Settings → “Subscription & JSON” → “Public subscription page (SharX)”** (`/panel/settings/subscription/`).

Visual builder with tabs:

### Branding

Public page appearance:

| Parameter | Description |
|-----------|-------------|
| **Name** | Page title |
| **Logo** | Image URL |
| **Colors** | Primary, background, accent |
| **Font** | Font family |
| **Favicon** | Tab icon |

### Blocks

Block builder — drag, reorder:

| Block | Description |
|-------|-------------|
| **subscription-info** | Subscription info: traffic, expiry, status |
| **installation-guide** | Client app installation instructions |
| **links-list** | Link / config list for import |
| **support-cta** | Support contact button |
| **custom-html** | Arbitrary HTML |
| **metrics** | Usage metrics |
| **add-to-app** | "Add to app" buttons (deeplink) |

Each block is configured individually (title, visibility, parameters).

### Response Rules

HTTP headers and subscription metadata for client applications:

| Parameter | Header | Description |
|-----------|--------|-------------|
| **Profile name** | `Profile-Title` | Subscription name in app |
| **Update interval** | `Profile-Update-Interval` | How often to refresh (hours) |
| **Announcement** | `Announce` | Notification text |
| **Support URL** | `Support-Url` | Support link |
| **Provider ID** | `providerid` | Provider identifier (Happ) |
| **Extra parameters** | Arbitrary headers | Any meta-headers |
| **MTProto on page** | — | Show MTProto on public page |

Additional header delivery settings: headers only / body only / both.

### Custom Remarks

Placeholder texts shown in subscription for certain client states:

| State | Placeholder |
|-------|-------------|
| Expired | Text for EXPIRED |
| Traffic limit | Text for LIMITED |
| Disabled | Text for DISABLED |
| No hosts | Text when no endpoints |
| HWID: limit exceeded | `HWIDMaxDevicesExceeded` |
| HWID: no device ID | `HWIDNotSupported` |

**Show custom remarks** toggle:

- **On** — when restricted, placeholder text is shown instead of real servers;
- **Off** — real nodes are delivered even when restricted.

### Client Routing

Happ-format routing profiles. See [Routing](./10-routing.md#client-routing-happ).

### JSON Templates

Additional routing rules added to JSON subscription (for sing-box, Xray JSON).

### Raw JSON

Direct editing of subscription page configuration in JSON with syntax highlighting and schema validation.

## Visual Designer (2.1.0)

Starting with release 2.1.0 the subscription page can be built not only from classic blocks but also in the **visual designer**: you move elements with the mouse, nest them, show them conditionally, animate them and fill them with the data of a specific client. Full guide (in Russian): [Subscription page designer](../../subscription-designer.md).

**Opening and publishing.** Settings → “Subscription” → “Visual designer” card → “Open designer”. Build the page (you can start from one of 21 templates with the **Templates** button), turn on the **Use on page** switch and press **Save**. While the switch is off, clients see the classic blocks and the layout is kept. You can return to the classic page by turning the switch off.

**What is inside:**

- **Layout** of frames (stack, grid, free positioning) and elements: text, button, image, badge, progress, QR, repeat, header, app buttons, scene, custom code.
- **Canvas**: Phone / Tablet / Desktop frames, zoom, grid and snapping, drag and drop; drop an element on the left or right edge of another one to place them side by side.
- **Inspector**: layout, size, appearance, text, visibility, Motion, Data & behavior, and a separate **mobile view** editing mode.
- **Variables and templates**: `{{ user.username }}`, `{{ devices.count }}`, filters, `{{#if}}`, `{{#each}}`, your own `vars.*` and translations `tr.*` (13 languages: English and Russian live inside the layout, 11 more come from bundled dictionaries; English is the fallback).
- **Catalog** of 108 ready-made elements (profile, traffic, devices, connect, guides, scenes, animations and more) with search, filters and previews.
- **Styles tab**: 12 palettes (including Hello Kitty, Barbie, Neon, Sunset), Auto / Light / Dark mode, Animated or Plain background, decorations, custom colors.
- **My library**: save your own elements and page templates on the server, shared by all administrators.
- **Onboarding tour** (the **Tour** button in the toolbar): Quick start, Full tour and short guides.

**What changed in the settings.** The Branding tab now holds content only (title, logo, brand text, support link, languages); palette, colors, theme and background are set in the designer, on the Styles tab. The Blocks tab is hidden while a layout is in use. The Colors / Font rows of the Branding table above describe the previous interface.

**API.** The public response `GET /panel/api/public/subscription` gains a `devices` object (`enabled`, `max`, `count`, `items[]`; the HWID itself is never returned) and the fields `user.group`, `createdAt`, `lastOnline`, `ipLimit`, `maxIPs`, `resetCadence`. The layout is stored in the config as `layout`; appearance uses `colorPreset`, `theme`, `branding.background` and `branding.decorations`.

**Security.** The template engine does not use `eval`, values are escaped in HTML and `javascript:` links are blocked. Custom code is cleaned by a sanitizer; scripts (opt-in only) run in an isolated `iframe` with no access to the page.

> **Limitation: the designer has no mobile adaptation.** The editor is desktop-only: you cannot edit the page from a phone or tablet. The page it produces is responsive, though: you can preview it in the Phone frame on the canvas and set a separate look for narrow screens. Bundled animations respect `prefers-reduced-motion`.

## Public Page

URL: `/panel/sub/?id=<subId>`

Displayed without panel sidebar — only content assembled in the builder.

Data loaded via API: `GET /panel/api/public/subscription`.

### What the User Sees

- Branding (logo, colors);
- Subscription status (active / expired / limit);
- Remaining traffic and expiry;
- Server list with Import / QR / Copy buttons;
- Installation instructions;
- "Add to Happ" / "Add to v2rayTun" buttons, etc.;
- AmneziaWG configs (.conf) for import into AmneziaVPN.

## Preview

The builder has **preview** — page display with test Sub ID without publishing.

## Saving

**Save** button writes configuration to the database. Changes apply to all clients (page configuration is shared; client data is substituted by `subId`).

## Subscription Link for Client

Formed from settings:

```
https://<XUI_SUB_DOMAIN>:<XUI_SUB_PORT><XUI_SUB_PATH><subId>
```

Example:

```
https://sub.example.com:2096/sub/a1b2c3d4e5f6g7h8
```

Sub ID is unique per client and shown in the edit form.

## Recommendations

1. Configure **branding** before giving links to clients.
2. Add **installation-guide** block with instructions for your client app.
3. Use **add-to-app** for deeplink import into Happ / v2rayTun.
4. Configure **response rules** for correct display in Happ (Profile-Title, providerid).
5. **Custom remarks** — inform users about block reasons in clear text.

## What's Next

- [Routing](./10-routing.md)
- [HWID and limits](./11-hwid-and-limits.md)
