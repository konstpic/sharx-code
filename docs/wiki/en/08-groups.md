# 8. Groups

[← Clients](./07-clients.md) | [Contents](./README.md) | [Subscription Page →](./09-subscription-page.md)

## Purpose of Groups

A **group** is a logical grouping of clients for:

- filtering the client list;
- bulk application of settings (limits, inbounds, expiry, HWID);
- convenient organization with many users.

A client can belong to **only one** group (or none).

## Group List

**Groups** page (`/panel/groups/`):

| Column | Description |
|--------|-------------|
| **Name** | Group name |
| **Description** | Short description |
| **Clients** | Number of clients in group |
| **Actions** | Edit / Delete |

## Creating a Group

1. Click **Add group**.
2. Fill in:
   - **Group name** * (up to 30 characters);
   - **Description** (up to 100 characters).
3. Click **Create**.

## Editing a Group

Click **Edit** — a modal opens with several sections. One **Save** button applies all changed sections.

### Quick Actions (Icon Panel)

| Action | Description |
|--------|-------------|
| Enable all | Activate all clients in group |
| Disable all | Deactivate all |
| Reset traffic | Zero counters |
| Clear HWID | Remove registered devices |
| Delete all clients | Delete all clients in group |

### Section: Identification

- Group name;
- Description.

### Section: Group Data

- Client count;
- Created / updated date (read-only).

### Section: Expiry

Bulk set **expiration date** for all clients in the group.

If clients have different values — **mixed values** hint is shown.

### Section: Traffic Limit (GB)

Bulk set traffic limit.

### Section: Assign Inbounds

Bulk assign connections to group clients:

- **Replace** — replace current inbound set;
- **Add** — add to existing.

### Section: HWID

Bulk enable/disable HWID restriction and set device limit.

### Section: IP Limit

Bulk enable/disable concurrent IP limit and set maximum.

## Assigning Clients to a Group

Three ways:

### 1. When Creating / Editing a Client

In the client form select a group in the **Group** dropdown.

### 2. Bulk Assignment on Clients Page

1. **Clients** → **Bulk actions**.
2. Select clients with checkboxes.
3. **Assign group** → select group.

A client already in another group will be **moved** (not duplicated).

### 3. Removing from Group

**Bulk actions** → **Assign group** → select "No group" (or use API `group/0/removeClients`).

## Deleting a Group

When deleting a group:

- the group record is removed;
- all clients in that group have `group_id` cleared;
- **clients are not deleted**.

## Filtering by Group

On **Clients** page use **All groups** / specific group filter to show only needed clients.

## Usage Examples

| Scenario | Group | Action |
|----------|-------|--------|
| "Basic" plan | `basic` | 50 GB limit, 1 inbound |
| "Premium" plan | `premium` | Unlimited, all inbounds |
| Test accounts | `test` | 7-day expiry, reset on expiry |
| Corporate | `corp` | HWID = 2, IP limit = 3 |

## Limitations

- Maximum name length: **30** characters.
- Maximum description length: **100** characters.
- Client — **one** group.
- Groups page has no separate "add clients to group" — use bulk assignment on Clients page or group field in client form.

## What's Next

- [Subscription page](./09-subscription-page.md)
- [HWID and limits](./11-hwid-and-limits.md)
