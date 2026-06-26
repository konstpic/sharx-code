# 11. HWID and Limits

[← Routing](./10-routing.md) | [Contents](./README.md) | [Settings →](./12-settings.md)

All limits in SharX apply to **clients** (end users), not panel administrators.

## Overview of Restriction Types

| Type | Level | Description |
|------|-------|-------------|
| **Traffic limit** | Client | Maximum data volume (GB) |
| **Expiry** | Client | Account expiration date |
| **HWID** | Client | Maximum registered devices |
| **IP limit** | Client | Maximum concurrent unique IPs |
| **Node traffic limit** | Node | Total traffic through worker |
| **Traffic reset** | Client / Inbound | Periodic counter reset |

---

## Traffic Limit

### At Client Level

| Field | Description |
|-------|-------------|
| **Traffic limit (GB)** | 0 = unlimited |
| **Reset (days)** | Automatic counter reset period |

When limit is exceeded, client status changes to **LIMITED**. Custom remark may appear in subscription (if configured).

**Manual reset:** client menu → **Reset traffic**; or bulk via group / bulk actions.

### At Inbound Level

When creating inbound: **Traffic reset** — never / hourly / daily / weekly / monthly. Resets inbound counter (not client).

### At Node Level

**Traffic limit (GB)** field when adding node. 0 = unlimited.

---

## Expiry

| Field | Description |
|-------|-------------|
| **Expiry** | Date and time of expiration |

- Empty value = **no expiry**.
- On expiry status → **EXPIRED**.
- Bulk expiry: via **group** → Expiry section.

---

## HWID (Device Restriction)

> **Beta feature.** Works only with **Happ** and **v2rayTun** clients. Other apps may not support HWID registration.

### Purpose

**HWID (Hardware ID)** — unique device identifier. HWID restriction protects against subscription leaks: even if the link becomes known to third parties, only registered devices can connect.

### Client Configuration

In client form, **HWID settings** section:

| Field | Description |
|-------|-------------|
| **Enable HWID restriction** | Activate check |
| **Maximum devices (HWID)** | 0 = unlimited |

### Global HWID Mode

**Settings → Security → HWID mode**:

| Mode | Description |
|------|-------------|
| **Off** | HWID not checked globally |
| **Client header (x-hwid)** | Registration via `x-hwid` / `X-HWID` header (recommended) |
| **Legacy fingerprint** | Deprecated method |

### How Registration Works

1. Client app (Happ / v2rayTun) on subscription request sends headers:
   - `x-hwid` / `X-HWID` — device identifier (required);
   - `x-device-os` — operating system;
   - `x-device-model` — device model;
   - `x-ver-os` — OS version.

2. Panel registers device in `client_hw_ids` table.

3. If device count exceeds `maxHwid` → subscription returns **403 Forbidden** or custom remark `HWIDMaxDevicesExceeded`.

4. If HWID enabled but header not sent → `HWIDNotSupported`.

### Viewing Devices

In client form or list row: **Registered devices (HWID)** — modal with list:

- HWID;
- OS and model;
- Registration date.

Display: **Devices: N / M** (registered / limit).

### HWID Management

| Action | Where |
|--------|-------|
| **Clear HWID** | Client form / bulk actions |
| **Clear all HWID** | Clients page menu |
| **Set HWID limit** | Bulk for all clients |
| **Clear HWID** | Group → quick actions |

### Telemt (MTProto)

For Telemt clients HWID limit may be translated to `MaxUniqueIPs` in Telemt sidecar configuration.

---

## Concurrent IP Limit

Separate mechanism from HWID. Limits the number of **concurrent unique IP addresses** from which the client is connected.

### Client Configuration

**IP limit** section:

| Field | Description |
|-------|-------------|
| **Limit concurrent IPs** | Enable check |
| **Max unique IPs** | Minimum 1 when enabled |

### Global Settings

**Settings → Security**:

| Parameter | Description |
|-----------|-------------|
| **Enable IP limit control** | Background check job |
| **Check interval (sec)** | 5–600 seconds |
| **IP ban duration (sec)** | 0 = until manual unblock |
| **Enforcement mode** | Drop / Block / Drop + Block |
| **Excess IP policy** | Disable new / Disable old |

### Enforcement Modes

| Mode | Action |
|------|--------|
| **Drop connections only** | Terminates active sessions from "extra" IPs |
| **Block IP in subscription** | Denies subscription and routing for IP |
| **Drop and block** | Both actions |

### Excess IP Policy

| Policy | Description |
|--------|-------------|
| **Disable new IPs** | When limit exceeded, latest connections blocked |
| **Disable old IPs** | First connections blocked |

### How It Works

1. Background job `CheckClientIPLimitJob` periodically checks online sessions.
2. When `maxIPs` exceeded, selected mode is applied.
3. In Block mode panel hot-pushes routing rules to nodes to block IP.

---

## Client States Under Restrictions

| Status | Cause | Subscription behavior |
|--------|-------|----------------------|
| **ACTIVE** | All OK | Full subscription |
| **DISABLED** | Disabled by admin | Placeholder or empty (depends on settings) |
| **EXPIRED** | Expired | Custom remark |
| **LIMITED** | Traffic exhausted | Custom remark |
| HWID exceeded | Too many devices | 403 or `HWIDMaxDevicesExceeded` |
| IP exceeded | Too many IPs | Drop/Block per settings |

**Show custom remarks** toggle (Settings → Subscription) determines whether to show placeholder or real servers when restricted.

---

## Bulk Limit Management

### Via Groups

Edit group → sections: Expiry, Traffic, HWID, IP limit.

### Via Bulk Actions (Clients)

- Reset traffic;
- Clear HWID;
- Set HWID limit (globally).

### Via API

```
POST /panel/client/setHwidLimitAll
POST /panel/client/clearAllHwids
POST /panel/client/clearHwid/:id
POST /panel/group/:id/bulk/setTrafficLimit
POST /panel/group/:id/bulk/setExpiry
```

---

## HWID vs IP Limit Comparison

| | HWID | IP Limit |
|---|------|----------|
| **What it limits** | Number of devices | Number of concurrent IPs |
| **When checked** | On subscription request | Background job (periodically) |
| **Clients** | Happ, v2rayTun | All |
| **Leak protection** | Yes (device bound) | Partial (IPs can change) |
| **Status** | Beta | Stable |

Using **both** mechanisms is recommended for maximum protection.

---

## Recommendations

1. **HWID** — enable for clients at risk of subscription leak; warn that Happ or v2rayTun is required.
2. **IP limit** — protect against account sharing; start with 2–3 IPs.
3. **Traffic + expiry** — basic limits for any plan.
4. **Custom remarks** — write clear texts for each restriction state.
5. For "doesn't work" complaints — check status, HWID devices, and blocked IPs.

## What's Next

- [Panel settings](./12-settings.md)
