# 7. Clients

[← Hosts](./06-hosts.md) | [Contents](./README.md) | [Groups →](./08-groups.md)

## Client vs Administrator

| | Client | Administrator |
|---|--------|---------------|
| Purpose | End VPN/proxy user | Panel login |
| Where created | **Clients** → Add client | On first install; change in **Settings → Administrator** |
| DB table | `client_entities` | `users` |
| Count | Many | One (in current version) |

In the interface the section is called **Clients** (or **Users** in statistics).

## Client List

**Clients** page (`/panel/clients/`):

### Summary Tiles

- **Total users** — total client count.
- **Online** — active connections.
- **Offline** — inactive.
- **Shown by filters** — count after applying filters.

### Table

| Column | Description |
|--------|-------------|
| ID | Identifier |
| Name | Unique client name (Latin, lowercase) |
| Comment | Arbitrary comment |
| Status | ACTIVE / DISABLED / EXPIRED / LIMITED |
| State | Enabled / disabled |
| Traffic ↑/↓ | Used / limit |
| Expiry | Expiration date |
| Group | Group membership |
| Inbounds | Assigned connections |
| UUID | Protocol identifier |
| Sub ID | Subscription identifier |

Search, group filter, and column sorting are available.

## Creating a Client (Step by Step)

### Step 1. Open Form

**Clients** → **Add client**. A side panel opens on the right.

### Step 2. Fill Required Fields

Minimum for a working subscription:

1. **Client name** — Latin, lowercase (`ivanov`, `user001`). Unique within the panel.
2. **Inbounds** — select at least one connection. Without an inbound the subscription will be empty.

### Step 3. Configure Limits (Optional)

- **Traffic limit (GB)** — e.g. `100` or `0` (unlimited).
- **Expiry** — end date or empty (no expiry).
- **HWID** / **IP limit** — see [section 11](./11-hwid-and-limits.md).

### Step 4. Save

Click **Save**. UUID is copied to clipboard. Form switches to edit mode — from there you can copy **Sub ID** and subscription link.

### Form Sections

#### Identification

| Field | Required | Description |
|-------|----------|-------------|
| **Client name** | Yes | Unique name (on create; cannot change after save) |
| **Comment** | No | Up to 100 characters |
| **UUID** | Auto | Generated automatically; copied to clipboard after creation |

#### Contacts

| Field | Description |
|-------|-------------|
| **Telegram ID** | For notifications via Telegram bot |
| **Subscription ID** | Automatically 16 characters; set only on creation |

#### Expiry

| Field | Description |
|-------|-------------|
| **Expiry** | Date and time of expiration; empty = no expiry |

#### Traffic and Reset

| Field | Description |
|-------|-------------|
| **Traffic limit (GB)** | 0 = unlimited |
| **Reset (days)** | Traffic counter reset period |

#### Inbounds

Select one or more **connections** the client can access. With two or more inbounds you can set **subscription order**.

#### Group

Select a group from the dropdown (optional).

#### HWID Settings

See [HWID and limits](./11-hwid-and-limits.md#hwid-device-restriction).

#### IP Limit

See [HWID and limits](./11-hwid-and-limits.md#concurrent-ip-limit).

#### Announcement

Announcement text (up to 200 characters) that may appear in the client's subscription.

## Editing a Client

Click a client row — the same side panel opens in edit mode.

Additionally shows **Account data** block:

- Subscription ID (read-only);
- Created / updated date;
- Last online;
- Upload / download speeds.

**Client name** cannot be changed after creation.

## Subscription Link

Each client has a unique **Sub ID**. Subscription link is formed as:

```
https://<subscription-domain>:2096/sub/<subId>
```

or with path from settings (`XUI_SUB_PATH`).

When opened in a browser, the user is redirected to the **public subscription page**:

```
https://<panel-domain>/panel/sub/?id=<subId>
```

Client applications (Happ, v2rayNG, Clash, etc.) receive configuration in a format depending on User-Agent.

## Client States

| Status | Condition |
|--------|-----------|
| **ACTIVE** | Enabled, traffic within limit, not expired |
| **DISABLED** | Disabled by administrator |
| **EXPIRED** | Expiry date passed |
| **LIMITED** | Traffic limit exhausted |

## Bulk Actions

Click **Bulk actions** → select clients with checkboxes:

| Action | Description |
|--------|-------------|
| **Assign group** | Move to selected group |
| **Reset traffic** | Zero counter |
| **Clear HWID** | Remove registered devices |
| **Delete** | Delete selected clients |

> Confirm bulk operations carefully — they apply to all selected accounts.

## HWID Management

In client row or edit form:

- **Devices: N / M** — registered / limit.
- **Registered devices (HWID)** button — modal with device list (OS, model, HWID, registration date).
- **Clear HWID** — reset all registered devices.

Global actions (page menu):

- **Clear all HWID** — for all clients;
- **Set HWID limit** — bulk set device limit.

## Client Statistics

**Clients → Statistics** (`/panel/clients/statistics/`) — charts and tables of traffic per client.

## Recommendations

1. **Client name** — use clear names (`user123`, `ivanov`).
2. **Assign inbounds** on creation — without them subscription is empty.
3. **Sub ID** — don't change unnecessarily; client apps cache the link.
4. **Limits** — align traffic, expiry, and HWID with your plan.
5. **Groups** — use for organization with many clients.

## Example: Client with One VLESS Inbound

| Field | Value |
|-------|-------|
| Name | `testuser` |
| Inbound | `VLESS-REALITY-443` |
| Traffic limit | `50` GB |
| Expiry | +30 days |
| HWID | Off |

After save the client gets a subscription like:

```
https://sub.example.com:2096/sub/abc123def4567890
```

In Happ / v2rayNG — **Add subscription** → paste URL.

## What's Next

- [Groups](./08-groups.md)
- [Subscription page](./09-subscription-page.md)
- [HWID and limits](./11-hwid-and-limits.md)
