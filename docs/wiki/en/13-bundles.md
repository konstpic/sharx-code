# 13. Bundles

[← Settings](./12-settings.md) | [Contents](./README.md) | [Balancers →](./14-balancers.md)

## What a bundle is

A **bundle** is an ordered set of [hosts](./06-hosts.md). A client that belongs to a bundle gets these hosts in the **subscription** and **access to the inbounds** of these hosts.

Since **2.0** this is the only way to give a client access. Before 2.0 you picked a list of inbounds in the client card; bundles replace it.

```
Inbound ──► Host (address + port of one inbound) ──► Bundle (ordered set of hosts) ──► Client
```

The **Bundles** section (`/panel/bundles/`) is always in the sidebar.

## Rules

| Rule | Meaning |
|------|---------|
| **Order** | The order of hosts in a bundle = the order of entries in the subscription. A client's bundles go in the order they were assigned. |
| **Access** | A client's access = the union of inbounds of **every host in every enabled bundle**. It is counted for every host of the bundle, even a hidden or disabled one. |
| **Hide a host** | The "Hide from subscription" icon: the entry is not shown in the subscription, but access to the inbound **stays**. |
| **Enabled / disabled** | The "Enabled" switch of a bundle or a host affects **only what is shown in the subscription**, not access. To take access away, remove the host from the bundle or the client from the bundle. |
| **Auto-add new nodes** | The option "Add new nodes and balancer pools of these inbounds automatically" (`followPlacements`): when an inbound already in the bundle gets a new node or pool, the matching host is appended to the **end** of the bundle. |
| **Auto bundle** | A service bundle (marked "auto"). The API compatibility layer creates it when an integration sends `inboundIds`. It is not managed by hand. |
| **Duplicates** | Hosts are not duplicated in the subscription (the first occurrence wins). Hidden and disabled hosts, hosts of disabled inbounds and unsupported protocols are skipped. |

## Creating a bundle (step by step)

1. **Bundles** → **Create bundle**.
2. **Hosts** tab: enter the **Name** and **Description**, then **Add a host…** and pick hosts (each shows its kind: "Node", "Balancer", "Panel", "Address").
3. Set the order with **Up** / **Down**. The "Show in subscription" / "Hide from subscription" icon toggles a host's visibility, the trash icon removes the host from the bundle.
4. **Options** tab: the **Enabled** switch and the auto-add option for new nodes and pools.
5. The **Clients** tab is available **after the first save** ("Save the bundle first, then add clients"): **Find a client…**, add and remove. Changes apply immediately: the client gains or loses access on the nodes.
6. Before saving a bundle that has clients, the panel shows how many are affected; after saving: "Access changed for N clients".

## Assigning bundles

| To whom | How |
|---------|-----|
| One client | In the client form, the **Bundles** block: a scrollable list, click selects or clears a bundle. Below it "Inbounds this client gets" shows the resulting access. |
| Several clients | The **Clients** tab inside the bundle. |
| A group | In the group form, the **Bundles** section; **Save** sets these bundles for every client of the group ([Groups](./08-groups.md)). Clients' personal access given via the API (`inboundIds`) is kept. |
| Via API | `bundleIds` in `POST /panel/client/add\|update`; `POST /panel/bundle/members/add`; `POST /panel/group/{id}/bulk/assignBundles`. |

The old call with `inboundIds` keeps working: the panel puts the client into an **auto bundle** for that exact ordered set of inbounds. The client's named bundles are not changed; `inboundIds: null` means "leave as is".

## Deleting

Deleting a bundle: clients lose the access that **only** this bundle gave them (the panel shows their number). Hosts, inbounds and nodes are not deleted.

## Limitations

- There is no bulk "add selected clients to a bundle" action on the **Clients** page yet: use the bundle's **Clients** tab, the client form, a group or the API.
- There are no bundle-level subscription templates or "default bundles for a group" yet.
- There is no rollback to the pre-bundle scheme from the panel (only restoring a database backup).
- A host belongs to **one** inbound: two inbounds need two hosts.

## Example

Bundle "Europe": hosts `DE-1 (vless)`, `FI-1 (vless)`, `lb.example.com` (a balancer host). A client in the bundle gets three entries in this order. If you hide `FI-1`, its entry disappears from the subscription, but access to the inbound on FI-1 stays.

Scenario "give a new client access": **Clients → Add client** → in the **Bundles** block pick "Europe" → **Save**.

## How the conversion works when upgrading to 2.0

On the first start of panel 2.0, 1.x data is **converted automatically** to bundles. The bundle scheme is built **beside** the old one and verified before it becomes active:

1. Backup copies of tables are created (`client_inbound_mappings_pre_bundles`, `hosts_pre_bundles`, `host_inbound_mappings_pre_bundles`, `inbound_node_mappings_pre_bundles`).
2. Each inbound-to-node binding gets a "Node" host, each old host and each of its inbounds gets an address host, each balancer pool gets a "Balancer" host. The replace / prepend / append modes become the order of hosts.
3. Clients are grouped by their **exact ordered list** of inbounds; each distinct list becomes one bundle.
4. **Verification for all clients**: access is identical, the subscription is byte-identical (random Reality parameters `sni`, `sid`, `spx` are masked in the comparison), `client_inbound_mappings` rows and per-node client lists are unchanged, every client belongs to a bundle.
5. Only on a full match is the bundle scheme switched on. On **any** mismatch the panel stays on the old scheme and clients lose nothing.

There is no rollback from the panel. The conversion does not modify the old tables; if needed, restore the database backup made **before the upgrade**.

### How to check the result

1. Open **Bundles**. The banner at the top shows the status: "Converted automatically: N clients, M bundles, K subscriptions verified identical", or the reason the scheme did not switch.
2. Or via the API: `GET /panel/bundle/state`. The response has `enabled` and `report` (`status`: `converted` or `failed`; on failure `report.mismatches` lists where exactly the subscription differed: `client`, `check`, `detail`).
3. If the conversion did not switch (`enabled: false`), the panel keeps working on the old scheme. After the cause is fixed press **Convert now** (`POST /panel/bundle/convert`). A failed conversion is not retried on every start, only on a new panel version or on your request.

## What's Next

- [Hosts](./06-hosts.md) — what a bundle consists of
- [Balancers](./14-balancers.md) — a balancer host in a bundle
- [Clients](./07-clients.md), [Groups](./08-groups.md)

---

[← Back to contents](./README.md)
