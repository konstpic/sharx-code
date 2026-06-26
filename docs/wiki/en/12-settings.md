# 12. Panel Settings

[← HWID and Limits](./11-hwid-and-limits.md) | [Contents](./README.md)

The **Settings** section (`/panel/settings/`) has seven tabs.

---

## General

`/panel/settings/general/`

| Parameter | Description |
|-----------|-------------|
| **Domain name** | Public panel domain |
| **Port** | Web interface port (synced with `XUI_WEB_PORT`) |
| **Certificate / key path** | TLS for panel |
| **Subscription domain** | Domain for subscription links |
| **Subscription port** | Subscription service port (`XUI_SUB_PORT`) |
| **Subscription path** | URI path (`XUI_SUB_PATH`) |
| **Multi-Node mode** | Enable distributed architecture |
| **Panel language** | Interface language |
| **Theme** | Light / dark |
| **Timezone** | For date display |
| **Xray version** | Core version management |
| **Panel update** | Check and install updates |

### Multi-Node Mode

When enabled:

- Xray Core **does not run** locally on panel;
- configurations are **sent** to worker nodes;
- inbounds **must be assigned** to nodes;
- subscriptions use **node addresses**.

---

## Security

`/panel/settings/security/`

| Parameter | Description |
|-----------|-------------|
| **Two-factor authentication (2FA)** | TOTP (Google Authenticator, etc.) |
| **API tokens** | Tokens for REST API access without cookie session |
| **HWID mode** | Off / x-hwid / legacy fingerprint |
| **IP limit control** | Global IP check enable |
| **IP check interval** | 5–600 seconds |
| **IP ban duration** | 0 = forever |
| **IP enforcement mode** | Drop / Block / Drop + Block |
| **Excess IP policy** | New / Old |
| **Fail2Ban** | Brute-force protection (via `XUI_ENABLE_FAIL2BAN`) |

### 2FA Setup

1. Enable 2FA.
2. Scan QR code in authenticator app.
3. Enter confirmation code.
4. Save backup codes.

### API Tokens

Create token with description and expiry. Use in header:

```
Authorization: Bearer <token>
```

---

## Telegram

`/panel/settings/telegram/`

| Parameter | Description |
|-----------|-------------|
| **Bot token** | Token from @BotFather |
| **Administrator ID** | Telegram ID for notifications |
| **Notifications** | Panel login, client changes, traffic |
| **Login via Telegram** | Password alternative (when configured) |
| **Client notifications** | By client Telegram ID |

---

## Subscription

`/panel/settings/subscription/`

Visual **subscription page builder**. Details: [Subscription page](./09-subscription-page.md).

Builder tabs:

- Branding
- Blocks
- Response rules
- Custom remarks
- Client routing
- JSON templates
- Raw JSON

---

## LDAP

`/panel/settings/ldap/`

External panel administrator authentication via LDAP / Active Directory.

| Parameter | Description |
|-----------|-------------|
| **Enable LDAP** | Activate |
| **Server address** | host:port |
| **Base DN** | Base DN for search |
| **Bind DN / Password** | Connection credentials |
| **User filter** | LDAP filter |
| **Name attribute** | Username field |

With LDAP enabled, local password is used as fallback.

---

## Grafana

`/panel/settings/grafana/`

Integration with external observability stack (Grafana, Loki, VictoriaMetrics **not included** in default compose).

| Parameter | Description |
|-----------|-------------|
| **Loki URL** | Log shipping |
| **VictoriaMetrics URL** | Metrics shipping |
| **Download dashboard** | Grafana JSON dashboard for import |

Built-in Prometheus metrics: `{basePath}panel/metrics` — restrict access at network or reverse proxy level.

---

## Administrator

`/panel/settings/admin/`

### Administrator Credentials

| Field | Description |
|-------|-------------|
| **Current username** | For confirmation |
| **Current password** | For confirmation |
| **New username** | New login |
| **New password** | New password |

> Current version supports **one** panel administrator. Creating additional admins via UI is not available.

Alternative ways to change credentials:

- CLI flags on startup: `-username`, `-password`;
- First run with empty DB: `admin` / `admin`.

### Restart Panel

**Restart panel** button — restart process without recreating container.

---

## DB Inspector

`/panel/db-inspector/`

PostgreSQL table viewer in read-only mode (use with caution). Tables:

- `users` — administrator;
- `client_entities` — clients;
- `client_groups` — groups;
- `inbounds` — connections;
- `nodes` — nodes;
- and others.

Not intended for everyday use.

---

## Xray (Separate Menu Section)

Not part of Settings, but closely related:

| Subsection | Description |
|------------|-------------|
| **Template** | Base Xray configuration JSON template |
| **Geo files** | Upload geoip.dat, geosite.dat |
| **Core profiles** | Configuration sets for node assignment |

---

## Environment Variables vs Web Settings

| Parameter | Where set |
|-----------|-----------|
| Panel and subscription ports | Env only (`XUI_WEB_PORT`, `XUI_SUB_PORT`) |
| SSL paths | Env or web settings |
| PostgreSQL password | Env only |
| Multi-Node, 2FA, Telegram | Web settings |
| Domain, theme, language | Web settings |

Full reference: `ENV_VARIABLES.md`.

---

## Initial Setup Checklist

```
☐ Change administrator password (Settings → Administrator)
☐ Configure TLS and domain (Settings → General)
☐ Configure subscription domain and port
☐ Enable 2FA (recommended)
☐ Create first inbound
☐ Create test client
☐ Design subscription page (Settings → Subscription)
☐ Verify subscription link in browser and app
☐ (Optional) Enable Multi-Node and add nodes
☐ (Optional) Configure Telegram bot
☐ (Optional) Configure Grafana / metrics
```

---

[← Back to contents](./README.md)
