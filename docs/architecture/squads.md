# Squads: who gets which inbounds, and which hosts they see

Status: analysis and design. Nothing is implemented yet. The migration plan below is the part that must not go wrong:
existing clients keep working, with the same access and the same subscription, without any manual step.

## 1. Why

Today access and delivery are tied to each client one by one:

* the operator picks a list of inbounds **per client** (`client_inbound_mappings`), and nodes push those clients into Xray;
* what the client sees in the subscription is assembled implicitly from the inbound's node bindings, an optional Host
  (one per inbound) and, since the balancer work, balancer pools.

This does not scale to tariffs ("basic", "premium"), cannot say "these 500 clients get the new node", and mixes access
with presentation. The proposal separates three things:

```
placement   inbound on a node, or in a balancer pool          (infrastructure, exists)
squad       a named set of inbounds = access, plus what it shows   (new)
client      belongs to squads                                  (new link, replaces per-client lists)
host        what the client is given: an address the app connects to
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

## 4. Proposed model

### 4.1 Entities

```
squads               id, name, description, enable, sort_order, created_at, updated_at
squad_inbounds       squad_id, inbound_id                            -- access
squad_delivery       id, squad_id, kind, host_id, inbound_id, node_id, pool_id, hidden, sort_order   -- presentation
client_squads        client_id, squad_id, created_at                 -- membership
client_inbound_mappings   + direct BOOLEAN NOT NULL DEFAULT TRUE     -- personal access, see 4.2
```

`squad_delivery.kind` is one of:

* `host`: a stored Host row (custom address, CDN, overrides);
* `placement`: an inbound on one node (virtual: address, port, suffix come from `InboundNodeMapping`, nothing is copied);
* `pool`: a balancer pool (virtual: comes from `balancer_pools`).

Placements and pools are *references*, not copies. There is no sync job and no second source of truth for the published
address or the balancer port. A delivery item must point at an inbound that is in `squad_inbounds` (enforced on save,
optionally auto-added).

### 4.2 Effective access

```
effective(client) = personal access (client_inbound_mappings.direct = true)
                  ∪ inbounds of every enabled squad the client belongs to
```

`client_inbound_mappings` stays the materialised result: one row per effective inbound. `direct` says whether the operator
gave that inbound to the client personally. A row is deleted only when it is neither direct nor covered by any squad.
Everything downstream keeps reading the same table.

Changes:

* client add/update with `inboundIds` now sets the **direct** set only, then recomputes. Old integrations keep working
  unchanged: they manage personal access and no longer touch squad access. `inboundIds: null` still means "leave as is".
* squad member added or removed, squad inbound added or removed, squad enabled or disabled: recompute the affected clients.
* recompute is a *diff* (add missing rows, remove uncovered rows) and never reorders or recreates existing rows, so row ids
  and Telemt secrets survive. It reuses the node-push code of the assign/unassign path.

### 4.3 Delivery in the subscription

Per inbound the client can use:

1. if any of the client's squads has delivery items for that inbound: show exactly those items, in squad order and item
   order, dropping `hidden` ones (a hidden item still grants access, it just is not listed);
2. otherwise: the current assembly (node entries, Host, balancer pools).

This is the compatibility keystone. A squad with no delivery items is a pure access group and the subscription of its
members is **byte-identical** to today. Delivery can be adopted inbound by inbound, at the operator's pace.

### 4.4 What squads deliberately do not do (yet)

* No per-node restriction inside an inbound: access is by inbound (as now, the client is provisioned on all nodes of it).
  Node choice is a presentation matter, handled by delivery items.
* Groups stay labels. An optional "default squad per group" is a later, separate step.
* Remnawave's external squads (subscription templates per group) map to our existing subscription-page config and response
  rules; a per-squad override of those is a follow-up, not part of this change.

## 5. Migration without loss

Principle: **additive schema, dark code, opt-in conversion, proven equality, instant rollback.**

### Phase M1: schema only

Migration `00xx_squads.sql`: create the four tables, add `client_inbound_mappings.direct DEFAULT TRUE`. Every existing row
becomes `direct = true`. Nothing reads the new tables yet. Behaviour is unchanged by construction: with no squads,
`effective = direct = all existing rows`.

### Phase M2: code deploy, still dark

Recompute, the new delivery path and the new API ship behind the setting `squads_enabled` (default off) plus the natural
guard "no squads exist". With zero squads every code path reduces to today's, which the golden tests prove (section 6).

### Phase M3: conversion tool (never automatic)

The operator opens **Squads → Create from existing clients**. The tool:

1. groups clients by their exact inbound set; proposes one squad per distinct set (typically a handful), with member counts;
2. lets the operator rename, merge or skip proposals;
3. **dry run**: for every client shows `before` and `after` (effective inbound set, subscription entry list, node config
   impact). Any difference is a blocker;
4. **apply** in batches, resumable and idempotent: create squad, add inbounds, attach members, then set `direct = false`
   *only on rows the squad now covers*, inside one transaction per batch, after re-checking that the effective set equals the
   one recorded before. On any mismatch the batch rolls back and reports;
5. writes a backup table `client_inbound_mappings_pre_squads` (all columns, original ids) before the first batch.

Clients not converted keep `direct = true` and behave exactly as before. A mixed state (some converted, some not) is
supported permanently, not just during the migration.

### Rollback

* per batch: the transaction;
* global: `UPDATE client_inbound_mappings SET direct = true` restores personal access for everyone; turn `squads_enabled`
  off. Squad tables can stay unused. No data was deleted, so nothing has to be restored from backup.

### What must not change (invariants checked by tests and by the conversion tool)

| Invariant | How it is verified |
|---|---|
| Same rows: count, ids, `sort_order`, `telemt_secret`, `telemt_ad_tag` | row-level comparison before and after |
| Same access per client | set equality of effective inbounds |
| Same node configs | per-node `configSha256` (the panel already computes it) equal before and after conversion |
| Same subscription | golden output of every client's subscription equal before and after |
| Same credentials | client UUID, password, flow untouched (flow is recomputed from the same set) |
| Same counters | traffic, HWID, limits live on the client and are not touched |

## 6. Test plan

1. **Unit**: effective-access diff (add, remove, direct plus squad overlap, disabled squad, client disabled/expired);
   delivery selection per inbound with and without squad hosts; `inboundIds` semantics (null, empty, list).
2. **Golden subscription**: snapshot the subscription output of every client on a seeded database, run the conversion,
   compare byte for byte.
3. **Config equality**: node config hash before and after conversion.
4. **Rehearsal on a production copy**: restore a dump, run M1 to M3 end to end, run all invariants. Nothing is applied to
   production before this passes, and production conversion is then done in small batches with the dry-run report saved.
5. **End to end on the test panel** with a real connecting client: add squad, add member, connect, remove member, connection
   refused; delivery item shows in the subscription and connects through a node and through a balancer pool.
6. **Fan-out**: squad with many members changes an inbound: measure the number of node pushes (must be one per node, not
   one per client).

## 7. Risks

| Risk | Mitigation |
|---|---|
| Editing a squad removes access from thousands at once | confirm dialog with the number of affected clients; changes are queued and pushed per node in one batch; "disable squad" is reversible |
| Old integrations send `inboundIds` and strip squad access | `inboundIds` now edits only personal access (4.2), covered by a test |
| Row recreation rotates Telemt secrets or WireGuard data | recompute never deletes-and-recreates; only diff |
| Subscription order changes | conversion dry run compares the entry list, order included; mixed mode keeps current order for non-delivery inbounds |
| Deleting an inbound, node or balancer pool leaves dangling squad items | foreign keys with cascade; delivery items to a removed placement disappear; UI warns before delete |
| Large recompute blocks the panel | run in a background job with progress; per-client transactions |
| Operators confused by two ways to give access | UI shows both ("personal" chip and squad chips) and a "convert" hint |

## 8. UI

* **Squads** page: list with member counts; editor with three tabs: inbounds (access), delivery (ordered items: hosts,
  placements, pools, with hide toggles and drag-and-drop), members (search, bulk add by group, remove).
* **Clients**: squad chips, a multi-select in the client form, bulk "add to squad", filter by squad. "Inbounds" field is
  labelled as personal access.
* **Inbounds** and **Hosts** pages: show which squads use them.
* **Squads → Create from existing clients**: the conversion tool with dry run report.

## 9. Phases

1. M1 + backend model + recompute + tests (no UI).
2. Delivery selection in the subscription + golden tests.
3. Squads UI + client integration.
4. Conversion tool + rehearsal on a production copy.
5. Test panel end-to-end, then production rollout in batches.

## 10. Decisions needed

1. **Delivery model.** Recommended: virtual references (hosts, placements, pools) with per-inbound fallback to the current
   assembly (4.3). Alternative: every entry becomes a stored Host row (more explicit, but needs a sync job and a big data
   migration).
2. **Personal access.** Recommended: keep it (4.2), so old integrations and one-off cases keep working. Alternative:
   squads only, which forces every client into a squad and breaks the current API.
3. **Conversion.** Recommended: operator-driven tool with dry run (M3). Alternative: automatic at upgrade (fewer steps,
   but no chance to review and no per-client rollback).
