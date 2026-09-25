# Bundles: who gets which hosts (and through them which inbounds)

Status: implemented and verified on the test panel (automatic conversion, subscription from hosts, bundle API and UI).
Decisions taken. The entity is called a **bundle** (RU: пакет). "Squad" below refers to the Remnawave
concept it is modelled on. The migration is automatic and must lose nothing: existing clients keep the same access and
the same subscription.

Decisions (from the operator): (1) every delivered entry becomes a stored **host** and delivery is fully host-based;
(2) **no personal inbounds**: a client gets access only through bundles; (3) existing clients are converted
**automatically on upgrade**. Sections 4 to 7 are written for these decisions. The safety net that makes an automatic
conversion acceptable is the shadow-convert, verify, then switch design in section 5.

## 1. Why

Today access and delivery are tied to each client one by one:

* the operator picks a list of inbounds **per client** (`client_inbound_mappings`), and nodes push those clients into Xray;
* what the client sees in the subscription is assembled implicitly from the inbound's node bindings, an optional Host
  (one per inbound) and, since the balancer work, balancer pools.

This does not scale to tariffs ("basic", "premium"), cannot say "these 500 clients get the new node", and mixes access
with presentation. The proposal separates three things:

```
placement   inbound on a node, or in a balancer pool          (infrastructure, exists)
host        one entry the client is given: address + port + link overrides, bound to one inbound
bundle      an ordered set of hosts; access is derived from the hosts' inbounds
client      belongs to bundles (replaces per-client inbound lists)
```

## 2. What Remnawave does (reference)

* **Config profile** is an Xray config; it owns **inbounds**. **Nodes** run a profile and choose active inbounds.
* **Host** is bound to exactly **one** inbound and carries address, port and link overrides (SNI, path, ...). The client's
  app shows the hosts.
* **Internal squad** is a set of inbounds. A user is in any number of squads and gets access to the union of their
  inbounds; the panel provisions the user on those inbounds. Hosts are shown for inbounds the user may use.
* **External squad** (2.2+) overrides presentation: subscription templates and settings per user group.

The lesson worth copying: a squad is the switch for *access*, a host is the unit of *presentation*, and a host belongs to
one inbound. What we should not copy blindly: they have no per-client personal access, and they have no balancer.

## 3. How it works here today (verified in the code)

| Area | Fact | Where |
|---|---|---|
| Access | one row per client and inbound in `client_inbound_mappings`, with `sort_order`, `telemt_secret`, `telemt_ad_tag` | `database/model/model.go`, migrations 0001, 0037, 0039, 0050 |
| Writers | only three paths write it: client add, client update (`inboundIds`), bulk assign; plus deletes | `web/service/client.go:529, 840, 2710` |
| Update semantics | `UpdateClient` with a non-nil `inboundIds` is **authoritative**: `SyncClientInboundAssignments` deletes every row not in the list | `client.go:1411` |
| Row stability | the sync keeps existing rows (ids, Telemt secrets) and only adds or removes | `client.go:1408-1478` |
| Readers | Xray/node config, Telemt config, hysteria traffic, subscription, counts per inbound | `client_traffic.go`, `telemt_config.go`, `sub/subService.go`, `node.go` |
| Derived data | client `flow` is recomputed from the assigned inbound list | `client.go:865-875` |
| Subscription | inbounds by mapping order; per inbound: node entries (`InboundNodeMapping`: published address, port, include flag, suffix), then Host (replace/prepend/append), then balancer pools; **only one Host applies per inbound** | `sub/subService.go:348, 911` |
| Groups | `ClientGroup` is only a label: one nullable `group_id` on the client. No inbound meaning | `client_group.go` |
| Sharing | one UUID/password per client for all inbounds | `ClientEntity` |
| External contract | `POST /panel/client/add|update` with `inboundIds`; API tokens; Telegram bot | `web/docs/API.md` |

Consequences for the design:

1. `client_inbound_mappings` is read by everything that provisions or reports. **It must stay the single table the rest of
   the system reads.** Squads must not change how Xray, Telemt, WireGuard, traffic or the bot find a client's inbounds.
2. Because `inboundIds` on update deletes rows, it cannot keep meaning "the whole list" once squads exist, or a routine
   integration call would strip squad access.
3. Row ids and Telemt secrets must survive. Delete and re-create would rotate secrets and break existing links.

## 4. Model

### 4.1 Entities

```
hosts (extended)     id, name, kind (address | placement | pool), inbound_id, node_id, pool_id,
                     address, port, remark parts, link overrides (existing columns), enable,
                     source (manual | placement | pool | legacy), customized, created_at
bundles              id, name, description, enable, auto, follow_placements, sort_order, created_at
bundle_hosts         bundle_id, host_id, sort_order, hidden
client_bundles       client_id, bundle_id, sort_order
client_inbound_mappings   unchanged table, now the materialised effective access (still read by everything)
```

* A host is bound to **exactly one inbound** (as in Remnawave). `kind = placement` mirrors an inbound on a node, `pool` an
  inbound in a balancer pool, `address` is a free address (CDN, domain, IP). Existing many-inbound Hosts are split into one
  host per inbound during conversion.
* A `hidden` bundle host is not listed in the subscription but still grants access to its inbound.
* `follow_placements` (default on): when a new placement or pool appears for an inbound that the bundle already covers,
  a host is created for it and appended to the bundle. This keeps today's behaviour "add the inbound to a new node and every
  client of it gets the new entry".
* `auto = true` bundles are created by the API-compatibility layer (4.3) and shown separately.

Placement and pool hosts are kept in sync by an idempotent sync (on placement/pool changes, plus the balancer reconcile loop
as a safety net): create missing, remove hosts whose placement is gone, refresh fields on hosts that are not `customized`.
The moment an operator edits such a host, it becomes `customized` and the sync stops overwriting it.

### 4.2 Effective access

```
effective(client) = ∪ inbound_id of every host in every enabled bundle of the client
```

`client_inbound_mappings` stays the materialised result (one row per effective inbound), maintained by a diff that adds
missing rows and removes uncovered ones, never deleting and re-creating rows (row ids and Telemt secrets survive). Access
is at inbound level: the client is provisioned on all nodes of the inbound, exactly as today; which nodes are *shown* is
delivery (hosts). `sort_order` of the mapping follows the bundle-derived inbound order so legacy readers stay consistent.

### 4.3 API compatibility without personal access

Old integrations call `client add|update` with `inboundIds`. It is kept working: the list is mapped to an **auto bundle**
for that exact ordered set (found or created once, named `auto:<hash>`), and the client is put into it, replacing its
previous auto bundle. Explicit bundle membership is managed through new fields/endpoints. `inboundIds: null` still means
"leave as is". So no integration breaks, and the data model has only bundles.

### 4.4 Subscription

For a client: its enabled bundles in order, each bundle's hosts in order, skipping `hidden`, disabled hosts, disabled
inbounds and unsupported protocols, de-duplicated by host id (first occurrence wins). Each host produces one entry for its
inbound using the same link builders as today. Order across inbounds is now the bundle order, not a per-client list.

### 4.5 Out of scope for now

Groups stay labels. Per-bundle subscription templates (Remnawave external squads) are a follow-up on top of the existing
subscription-page config and response rules.

## 5. Automatic migration without loss

An automatic conversion is only acceptable if it cannot make things worse than not converting. So it never edits the live
scheme in place. It builds the new scheme **beside** the old one, proves equality, and only then switches.

```
upgrade ──► M1 schema (additive) ──► M2 backup tables ──► M3 shadow conversion ──► M4 verify ──► M5 switch
                                                                                     │ mismatch
                                                                                     └──► stay on the old scheme, report
```

### M1 schema
Additive only: new tables, new nullable columns on `hosts`. Nothing reads them yet. The panel behaves as before.

### M2 backup
`CREATE TABLE ... AS SELECT` copies with original ids: `client_inbound_mappings_pre_bundles`, `hosts_pre_bundles`,
`host_inbound_mappings_pre_bundles`, `inbound_node_mappings_pre_bundles`. Skipped if they exist.

### M3 shadow conversion (runs once, in the background after the panel is up, resumable)

1. **Hosts.** For each inbound node binding create a `placement` host (published address, port, suffix, description, include
   flag). For each legacy Host and each inbound it maps, create an `address` host with the same overrides. For each balancer
   pool create a `pool` host. Remark fields are copied so remarks come out identical.
2. **Order per inbound.** Compute, per inbound, the exact entry list today's assembler produces (balancer prepend, Host
   prepend, nodes, Host append, balancer append, with the replace rules). This fixes the host order per inbound.
3. **Bundles.** Group clients by their **exact ordered inbound list** (mapping order). One bundle per distinct list. The
   bundle's hosts are the concatenation, inbound by inbound, of the per-inbound lists from step 2. Clients are attached.
   Typically a handful of bundles.
4. **Effective access** is recomputed into a scratch structure, not into `client_inbound_mappings`.

### M4 verification (blocks the switch)

| Check | Rule |
|---|---|
| Access | for every client the effective inbound set equals its current mapping set |
| Subscription | for every client the bundle-path output is byte-identical to the current path |
| Rows | count, ids, `sort_order`, Telemt secret, ad tag of `client_inbound_mappings` unchanged |
| Node configs | the client lists that would be pushed to each node are identical |
| Coverage | every client is in exactly one bundle; every host is used or intentionally unused |

Everything is compared in-process for **all** clients. One failure of any check aborts the switch: the panel keeps working on
the old scheme, and the reason (client, inbound, diff) is stored and shown in the UI with a **Retry** button. A failed
conversion is not retried on every start, only on a new version or on demand.

### M5 switch
One transaction sets `bundles_enabled = true`. From then on: subscription from bundles, access recomputed from bundles,
client and host screens work on bundles. Client changes keep `client_inbound_mappings` current (still the read model for
Xray, Telemt, WireGuard, traffic), so the old scheme still has valid *access* data.

### Rollback
`bundles_enabled = false` (an admin button, and a script) returns to the old scheme: legacy tables were never modified, the
pre-bundle backups are there, and access data in `client_inbound_mappings` is current. What is lost on rollback: edits to
delivery made in bundle mode (host order, bundle membership). No client loses access. The legacy tables are kept for at
least one release before any cleanup migration.

### What must not change (checked by M4 and by tests)

Row identity of `client_inbound_mappings`; client UUID, password, flow; traffic, HWID, limits; the per-node client lists;
the subscription text of every client.

## 6. Test plan

1. **Unit**: effective access from bundles (overlap, disabled bundle, disabled host, hidden host), diff (add/remove without
   recreating rows), auto-bundle mapping for `inboundIds`, `follow_placements`, dedupe and order.
2. **Golden**: seed a database with clients of many shapes (several inbounds, custom order, Telemt, WireGuard, hysteria,
   Hosts in all three modes, balancer pools, disabled nodes, hidden nodes); convert; compare every subscription byte for
   byte and every node client list.
3. **Database integration tests** against a real PostgreSQL (env `SHARX_TEST_DB`, skipped otherwise), including the M1 SQL
   migration on a copy of the previous schema.
4. **Rehearsal on a production copy**: restore a dump, run the upgrade end to end, read the M4 report. Production is only
   upgraded after a clean rehearsal.
5. **End to end on the test panel** with a real connecting client: convert, connect before and after, add a client to a
   bundle, remove it (refused), add a node placement (new host appears in bundles that follow), pool host through a balancer.
6. **Fan-out**: a bundle with many members changes: node pushes are batched per node.
7. **Fault injection**: fail the conversion midway and after M4; the panel must stay on the old scheme and keep serving
   subscriptions.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Automatic conversion changes what clients see | M4 byte-for-byte check on all clients before the switch; switch is one flag |
| Conversion is slow on a large base | background, resumable, batched; the panel serves the old scheme meanwhile |
| Data anomaly stops conversion forever | reported with the exact client/inbound; retry on demand; old scheme keeps working |
| Editing a bundle removes access from thousands at once | confirm with the affected count; pushes batched per node; a bundle can be disabled reversibly |
| Old integrations send `inboundIds` | auto-bundle mapping (4.3), covered by tests |
| Row recreation rotates Telemt secrets | recompute is a diff, never delete-and-create |
| Two truths for a published address (mapping vs host) | placement hosts are synced from placements until an operator customizes them; the mapping stays the deployment fact |
| Dangling hosts after deleting an inbound, node or pool | sync removes hosts of vanished placements; foreign keys cascade |

## 8. UI

* **Bundles** page: list with member counts; editor: hosts (ordered, drag and drop, hide toggle), members (search, add by
  group), options (enable, follow placements). A banner shows conversion state and the verification report.
* **Hosts** page: one flat list (address, placement, pool hosts) with the inbound, node or pool, and the bundles that use it.
* **Clients**: bundle chips and multi-select; bulk add to bundle; filter by bundle. The inbound field goes away.
* **Inbounds** and **Nodes/Balancers** pages: show the hosts that mirror them.

## 9. Phases

1. Schema (M1), models, bundle service (CRUD), effective access diff, unit tests.
2. Host generalisation, placement and pool sync.
3. Subscription assembly from hosts, golden tests against the old path.
4. Conversion M2 to M5 with the verification report, database integration tests.
5. API compatibility layer, client integration, then the UI.
6. Rehearsal, test panel end to end, release.

## 11. Implementation notes (as built)

* **Where things live.** `web/service/bundle.go` (bundles, access, auto bundles), `bundle_hosts.go` (host CRUD),
  `host_sync.go` (managed hosts), `sub/bundle_entries.go` (subscription from hosts), `sub/bundle_convert.go` (conversion and
  verification), `web/controller/bundle.go` (API), `panel/components/BundlesPage.tsx`, `BundleHostsPage.tsx`.
* **`hidden` is delivery only, `enable` is delivery only.** Access is derived from **every** host in an enabled bundle,
  whatever its flags. To remove access, take the host out of the bundle.
* **Managed host `enable`** mirrors the placement's "include in subscription" flag and the pool's "show in subscription" flag.
* **Verification masks per-request random link parameters** (Reality `sni`, `sid`, `spx`): no two renderings of the same
  subscription agree on them, in the old scheme too. Everything else must be identical. This was found on real data, where
  the first verification run correctly refused to switch.
* **Subscription assembly.** `getAddressesForInbound` uses the client's bundle hosts when the request has them attached
  (`Inbound.SubHosts`), else the old assembly. Each generator applies host overrides per row (`AddressPort.OverrideHost`).
* **Rollback** is `POST /panel/bundle/rollback` or the button on the Bundles page.
* **Not done yet:** a bulk "add clients to bundle" action on the Clients page (single-client and bundle-side membership work),
  bundle-level subscription templates, group-to-bundle defaults.
