# Access control (roles and permissions)

Status: implemented. Migration `0064_rbac.sql`, packages `web/rbac`, `web/service/rbac.go`, `web/controller/rbac.go`, UI under
`panel/components/access`.

## Model

```
user ──(role_id)──▶ role ──(permissions)──▶ set of "resource:action" keys
```

* A **permission** is `resource:action` (`clients:update`). The catalogue is in code (`web/rbac/permissions.go`) and is the
  single source of truth: roles store keys as a JSON array, the backend validates them on write and ignores unknown keys
  at evaluation time (a downgrade can never grant something by accident). The UI renders its role editor from
  `GET /panel/rbac/permissions`.
* `*` is the wildcard: it grants everything, including permissions added later. It is held only by the built-in
  **Administrator** role (`roles.is_system`, `system_key = 'administrator'`). Built-in roles cannot be edited or deleted, not even
  by an administrator through the API.
* `read` is the base action of a resource: granting any other action of a resource also grants its `read` (normalised on save).
* `users.enabled` and `users.deleted_at` carry the lifecycle. A disabled user cannot sign in, their open sessions end at once
  and their API tokens are revoked. Deleting a user is a **soft delete**: the row stays (disabled, marked deleted, the name is
  freed), so the audit trail and everything that points at the user remain valid.

## Where it is enforced

All enforcement is on the backend; the UI only hides what would be refused.

1. **One gate.** `BaseController.authorize` runs after the existing login check for both authenticated route groups
   (`/panel/*` and `/panel/api/*`, including API tokens, which carry their owner's permissions). It reloads the user and the
   role from the database on every request (a ≤3 s cache that is dropped on every change made through the service), so a role
   change or a disabled account takes effect on the next request, not at the end of the session.
2. **A route table** (`web/rbac/routes.go`) maps `METHOD /route/pattern` to the permissions it needs. A route with no entry
   is **administrators-only** (default deny). `TestEveryAuthenticatedRouteHasAPermissionEntry` builds the real routers and fails
   if a route has no entry or an entry has no route, so a new endpoint cannot ship unprotected.
3. **Data-dependent rules** live in handlers or the service where a route-level check is not enough: settings redaction
   (`setting/all` without `settings:read`), the node list without `inbounds:read`, per-entity journals, security settings
   (`settings:security`), and every user/role mutation.
4. **WebSocket.** Every push topic has a read permission (`wsTopicPerms`); a socket receives a message only if the user's
   current role allows it. A topic that is not listed is not delivered.

### Who may do what to whom (privilege escalation)

* A role may contain only permissions the editor holds themselves (`Covers`). Permissions that are practically equivalent to full
  control (`settings:security`, `system:backup`, `system:database`) can be put into a role only by an administrator.
* A user may be given only a role the caller fully covers; a user may be edited, disabled, deleted or have a password reset only
  if the caller covers that user's current role.
* Nobody can change their own role, disable themselves, delete themselves, or edit the role they hold. Built-in roles are immutable.
* The **last enabled administrator** cannot be disabled, demoted (by changing the user's role or the role's permissions) or
  deleted. All access-control writes run under one database advisory lock, so two concurrent requests cannot remove the last
  administrator together.
* Refused attempts are written to the audit trail (`result = denied`).

## Data ownership (important)

The panel stores inbounds, clients, groups, hosts, bundles and the like with a `user_id` column and filtered every query by the
signed-in user. With one administrator that was invisible; with roles a second user would have seen an empty panel. Data
operations are therefore done on behalf of the **panel owner** (`service.PanelOwnerID`, the first user, who owns all
existing data) via `dataUser(c)`; per-user things (password, sessions, API tokens, UI preferences) still use the real user.

## Audit

The panel had no audit mechanism, so a small append-only table `audit_log` was added: actor (id and name snapshot), action,
target, before/after state (never passwords), IP, `ok`/`denied`. Recorded: `user.create`, `user.update`, `user.role_change`,
`user.disable`, `user.enable`, `user.password_reset`, `user.delete`, `role.create`, `role.update`, `role.delete`. Read in the
UI (Users & roles → Audit log, `audit:read`).

## Migration and rollback

* `0064_rbac.sql` is idempotent. It creates `roles`, `audit_log`, adds `role_id`, `enabled`, `deleted_at`, `created_at`,
  `updated_at`, `last_login_at` to `users`, creates the Administrator role and **makes every existing user an Administrator**,
  so nobody loses access.
* On every start `database.EnsureAdminAccess` guarantees the panel is never left without a signed-in administrator: users
  without a role (created by an older binary) become administrators, and if no enabled administrator exists the first user is
  restored. The command-line recovery (`x-ui setting -username … -password …`) also re-enables the account and restores the role.
* **Rollback:** deploy the previous version. It reads and writes `users(id, username, password)` by column name, so the new
  columns and tables are ignored (verified by `TestRBACMigrationOnAnExistingDatabase`). Roles and audit data stay in the
  database and are used again after an upgrade. Dropping them is optional; the statements are in the migration header.
* Existing API clients keep working: tokens belong to a user, and existing users are administrators. A token of a user who later
  gets a narrower role gets exactly that role's permissions.

## Known limits

* Two-factor sign-in is a single panel-wide setting (not per user); it applies to everyone. Changing a password only resets it
  for administrators (the historic behaviour for the single administrator).
* Inbound settings contain client credentials, so `inbounds:read` is flagged sensitive; `inbounds:update` edits settings
  that include the client list.
* Telegram bot administrators are configured separately from panel users.

## Permission coverage

| Section | Permission | UI restriction | Backend restriction | Tests |
|---|---|---|---|---|
| Overview & logs | `dashboard:read` | Dashboard page; menu item hidden without it; non-permitted users are sent to their first allowed page | 7 route(s): GET api/server/cpuHistory/:bucket; GET api/server/diskHistory/:bucket; GET api/server/getTelemtVersion; GET api/server/getXrayVersion; GE… | `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing`, `TestWebSocketTopicsFollowReadPermissions` |
| Overview & logs | `logs:read` | Dashboard "Logs" card, node and balancer "Logs" buttons | 6 route(s): GET api/server/logs/entity/:type/:id; GET api/server/logs/stream; GET api/server/logs/unified/:count; POST api/server/logs/:count; POST a… | `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing`, `TestWebSocketTopicsFollowReadPermissions` |
| Inbounds | `inbounds:read` | Inbounds page and menu; inbound settings are redacted in the node list without it | 4 route(s): GET api/inbounds/get/:id; GET api/inbounds/list; GET api/inbounds/telemtDcStatus; GET api/inbounds/telemtParams | route table test, `TestDirectAPICall…` (read/write refusals), `TestWebSocketTopicsFollowReadPermissions` |
| Inbounds | `inbounds:create` | "Add inbound" and the template gallery are hidden | 13 route(s): GET api/server/getNewUUID; GET api/server/getNewVlessEnc; GET api/server/getNewX25519Cert; GET api/server/getNewmldsa65; GET api/server/g… | route table test, `TestDirectAPICall…` (read/write refusals), `TestWebSocketTopicsFollowReadPermissions` |
| Inbounds | `inbounds:update` | Enable switches disabled, drag-and-drop off, edit form read-only, no Save | 13 route(s): GET api/server/getNewUUID; GET api/server/getNewVlessEnc; GET api/server/getNewX25519Cert; GET api/server/getNewmldsa65; GET api/server/g… | route table test, `TestDirectAPICall…` (read/write refusals), `TestWebSocketTopicsFollowReadPermissions` |
| Inbounds | `inbounds:delete` | Delete buttons hidden | 1 route(s): POST api/inbounds/del/:id | route table test, `TestDirectAPICall…` (read/write refusals), `TestWebSocketTopicsFollowReadPermissions` |
| Clients | `clients:read` | Clients pages and menu | 12 route(s): GET api/inbounds/getClientTraffics/:email; GET api/inbounds/getClientTrafficsById/:id; GET client/get/:id; GET client/hwid/list/:clientId… | route table test, `TestDirectAPICall…` (client delete/bulk/reset refused), `TestWebSocketTopicsFollowReadPermissions` |
| Clients | `clients:create` | "Add client" hidden; the new-client form cannot be saved | 3 route(s): GET api/server/getNewUUID; POST api/inbounds/addClient; POST client/add | route table test, `TestDirectAPICall…` (client delete/bulk/reset refused), `TestWebSocketTopicsFollowReadPermissions` |
| Clients | `clients:update` | Client form read-only, no Update; bulk assign-to-group hidden | 13 route(s): GET api/server/getNewUUID; POST api/inbounds/updateClient/:clientId; POST client/bulk/enable; POST client/bulk/setHwidLimit; POST client/… | route table test, `TestDirectAPICall…` (client delete/bulk/reset refused), `TestWebSocketTopicsFollowReadPermissions` |
| Clients | `clients:delete` | Delete (row, card, bulk) hidden | 7 route(s): POST api/inbounds/:id/delClient/:clientId; POST api/inbounds/:id/delClientByEmail/:email; POST api/inbounds/delDepletedClients/:id; POST … | route table test, `TestDirectAPICall…` (client delete/bulk/reset refused), `TestWebSocketTopicsFollowReadPermissions` |
| Clients | `clients:operate` | Reset traffic, clear HWID, session drop/block and device controls hidden or disabled; bulk reset/clear hidden | 22 route(s): POST api/inbounds/:id/resetClientTraffic/:email; POST api/inbounds/clearClientIps/:email; POST api/inbounds/resetAllClientTraffics/:id; P… | route table test, `TestDirectAPICall…` (client delete/bulk/reset refused), `TestWebSocketTopicsFollowReadPermissions` |
| Client groups | `groups:read` | Groups page and menu | 14 route(s): GET group/:id/clients; GET group/:id/effectiveSettings; GET group/get/:id; GET group/list; POST group/:id/bulk/assignBundles; POST group/… | `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` (delete refused, data unchanged; allowed delete works), `TestRoleChangeAppliesToTheNextRequestWithoutNewSignIn` |
| Client groups | `groups:create` | "Add group" hidden | 1 route(s): POST group/add | `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` (delete refused, data unchanged; allowed delete works), `TestRoleChangeAppliesToTheNextRequestWithoutNewSignIn` |
| Client groups | `groups:update` | Group edit form read-only, no Save | 3 route(s): POST group/:id/assignClients; POST group/:id/removeClients; POST group/update/:id | `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` (delete refused, data unchanged; allowed delete works), `TestRoleChangeAppliesToTheNextRequestWithoutNewSignIn` |
| Client groups | `groups:delete` | Delete hidden | 1 route(s): POST group/del/:id | `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` (delete refused, data unchanged; allowed delete works), `TestRoleChangeAppliesToTheNextRequestWithoutNewSignIn` |
| Subscriptions (bundles, hosts) | `bundles:read` | Bundles page and menu | 7 route(s): GET bundle/client/:id; GET bundle/get/:id; GET bundle/hosts; GET bundle/hosts/suppressed; GET bundle/list; GET bundle/members/:id; GET bu… | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Subscriptions (bundles, hosts) | `bundles:create` | "Create bundle" hidden | 1 route(s): POST bundle/add | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Subscriptions (bundles, hosts) | `bundles:update` | Editor read-only, convert / cleanup hidden | 6 route(s): POST bundle/cleanup-unused-auto; POST bundle/client/:id/set; POST bundle/convert; POST bundle/members/add; POST bundle/members/remove; PO… | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Subscriptions (bundles, hosts) | `bundles:delete` | Delete hidden | 1 route(s): POST bundle/del/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Subscriptions (bundles, hosts) | `hosts:read` | Hosts page and menu | 4 route(s): GET bundle/hosts; GET bundle/hosts/suppressed; GET host/get/:id; GET host/list | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Subscriptions (bundles, hosts) | `hosts:create` | "Add host" hidden | 2 route(s): POST bundle/hosts/add; POST host/add | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Subscriptions (bundles, hosts) | `hosts:update` | Enable switch disabled, edit drawer read-only, restore hidden | 5 route(s): POST bundle/hosts/reset/:id; POST bundle/hosts/restore/:id; POST bundle/hosts/update/:id; POST host/subscription-bindings/:id; POST host/… | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Subscriptions (bundles, hosts) | `hosts:delete` | Delete hidden | 2 route(s): POST bundle/hosts/del/:id; POST host/del/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `nodes:read` | Nodes pages and menu | 8 route(s): GET node/client-traffic-per-node; GET node/geography; GET node/get/:id; GET node/list; GET node/status/:id; POST node/check/:id; POST nod… | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `nodes:create` | "Add node" hidden (also covers SSH install) | 5 route(s): GET node/ssh-provision-status/:taskId; POST node/add; POST node/check-connection; POST node/ssh-hostkey; POST node/ssh-provision | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `nodes:update` | Enable switch, reorder and edit drawer read-only | 4 route(s): POST node/check-connection; POST node/reorder; POST node/update/:id; POST xray-core-config-profile/assign-nodes/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `nodes:delete` | Delete hidden | 1 route(s): POST node/del/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `nodes:operate` | Core stop/restart controls hidden | 11 route(s): POST api/server/installTelemtOnNodes/:version; POST api/server/installXrayOnNodes/:version; POST node/reload/:id; POST node/reloadAll; PO… | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `nodes:secret` | Pairing secret is not shown | 1 route(s): GET node/secret | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `balancers:read` | Balancers page and menu | 2 route(s): GET balancer/list; GET balancer/metrics/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `balancers:create` | "Add balancer", SSH install hidden | 2 route(s): POST balancer/add; POST balancer/ssh-install/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `balancers:update` | Edit, pool edit/delete, enable switch, reorder hidden | 5 route(s): POST balancer/enable/:id; POST balancer/pool/del/:id; POST balancer/pool/save; POST balancer/reorder; POST balancer/update/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `balancers:delete` | Delete hidden | 1 route(s): POST balancer/del/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Servers (nodes, balancers) | `balancers:operate` | Refresh and push-config hidden | 3 route(s): POST balancer/apply/:id; POST balancer/log-level/:id; POST balancer/refresh/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Xray & routing | `xray:read` | Xray, geo-files and core-profile pages and menu | 11 route(s): GET api/server/downloadGeofileTask/:taskID; GET api/server/geofileAssets/:fileName; GET api/server/getConfigJson; GET setting/getDefaultJ… | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Xray & routing | `xray:update` | Template editor read-only, Save/Reset/Templates hidden; profile add/set-default/reset/delete hidden | 9 route(s): POST xray-core-config-profile/add; POST xray-core-config-profile/assign-nodes/:id; POST xray-core-config-profile/del/:id; POST xray-core-… | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Xray & routing | `xray:operate` | Geo-file section read-only; stop/restart/version buttons on the dashboard hidden | 18 route(s): POST api/server/downloadGeofileByUrl/:fileName; POST api/server/geofileAssets/apply/:id; POST api/server/geofileAssets/delete/:id; POST a… | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Xray & routing | `outbounds:read` | Outbounds page | 2 route(s): GET outbound/get/:id; GET outbound/list | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Xray & routing | `outbounds:create` | (no create UI in the list view) | 1 route(s): POST outbound/add | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Xray & routing | `outbounds:update` | (no edit UI in the list view) | 1 route(s): POST outbound/update/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Xray & routing | `outbounds:delete` | (no delete UI in the list view) | 1 route(s): POST outbound/del/:id | `TestEveryAuthenticatedRouteHasAPermissionEntry`, `TestDirectAPICallBypassingTheUIIsRefusedAndChangesNothing` |
| Settings | `settings:read` | Settings tabs General/Telegram/Subscription/LDAP/Grafana visible; without it only the account tab and a redacted shell | 12 route(s): GET setting/grafana/dashboard; POST setting/designerLibrary/get; POST setting/subscriptionPageConfig/get; POST setting/subscriptionPageCo… | `TestSettingsAreRedactedAndSecuritySettingsAreSeparate` |
| Settings | `settings:update` | General and Subscription tabs read-only without it; template share hidden | 11 route(s): POST setting/designerLibrary/save; POST setting/subscriptionPageConfig/save; POST setting/templates/delete; POST setting/templates/local/… | `TestSettingsAreRedactedAndSecuritySettingsAreSeparate` |
| Settings | `settings:security` | Telegram/LDAP/Grafana tabs read-only; 2FA and secret-path sections hidden | 6 route(s): GET setting/secretPathsMeta; POST setting/generateSecretPaths; POST setting/saveSecretPaths; POST setting/twoFactor/begin; POST setting/t… | `TestSettingsAreRedactedAndSecuritySettingsAreSeparate` |
| System | `system:update` | Panel update button not offered | 10 route(s): GET api/server/updater; GET api/server/updater/job; GET api/server/updater/plan; POST api/server/updater/job/start; POST api/server/updat… | route table test, `TestDirectAPICall…` (getDb, importDB, db inspector refused); super-only grant: `TestPrivilegeEscalationThroughRoles` |
| System | `system:backup` | Backup card on the dashboard hidden | 5 route(s): GET api/backuptotgbot; GET api/server/getDb; POST api/server/importDB; POST setting/migration/execute; POST setting/migration/preview | route table test, `TestDirectAPICall…` (getDb, importDB, db inspector refused); super-only grant: `TestPrivilegeEscalationThroughRoles` |
| System | `system:database` | Database inspector page and menu entry hidden | 6 route(s): GET db/tables; GET db/tables/:table/rows; GET db/tables/:table/schema; POST db/tables/:table/rows; POST db/tables/:table/rows/:pk; POST d… | route table test, `TestDirectAPICall…` (getDb, importDB, db inspector refused); super-only grant: `TestPrivilegeEscalationThroughRoles` |
| Users & roles | `users:read` | Access page, Users tab | 1 route(s): GET rbac/users | `TestPrivilegeEscalationThroughUsers`, `TestLastAdministratorIsProtected`, `TestDisabledUserLosesEverythingAtOnce`, `TestDeletedUserKeepsTheAuditTrailAndFreesTheName`, `TestPrivilegeEscalationOverHTTP` |
| Users & roles | `users:create` | "Add user" hidden; role list limited to assignable roles | 2 route(s): GET rbac/assignable-roles; POST rbac/users | `TestPrivilegeEscalationThroughUsers`, `TestLastAdministratorIsProtected`, `TestDisabledUserLosesEverythingAtOnce`, `TestDeletedUserKeepsTheAuditTrailAndFreesTheName`, `TestPrivilegeEscalationOverHTTP` |
| Users & roles | `users:update` | Edit, password reset, disable hidden (and only for users within the caller's permissions) | 3 route(s): GET rbac/assignable-roles; POST rbac/users/:id/password; POST rbac/users/:id/update | `TestPrivilegeEscalationThroughUsers`, `TestLastAdministratorIsProtected`, `TestDisabledUserLosesEverythingAtOnce`, `TestDeletedUserKeepsTheAuditTrailAndFreesTheName`, `TestPrivilegeEscalationOverHTTP` |
| Users & roles | `users:delete` | Delete hidden | 1 route(s): POST rbac/users/:id/delete | `TestPrivilegeEscalationThroughUsers`, `TestLastAdministratorIsProtected`, `TestDisabledUserLosesEverythingAtOnce`, `TestDeletedUserKeepsTheAuditTrailAndFreesTheName`, `TestPrivilegeEscalationOverHTTP` |
| Users & roles | `roles:read` | Access page, Roles tab | 2 route(s): GET rbac/permissions; GET rbac/roles | `TestPrivilegeEscalationThroughRoles`, `TestRoleChangeTakesEffectImmediately`, `TestRoleDeleteRules`, `TestPrivilegeEscalationOverHTTP` |
| Users & roles | `roles:create` | "Add role" hidden; matrix disables permissions the caller lacks | 1 route(s): POST rbac/roles | `TestPrivilegeEscalationThroughRoles`, `TestRoleChangeTakesEffectImmediately`, `TestRoleDeleteRules`, `TestPrivilegeEscalationOverHTTP` |
| Users & roles | `roles:update` | Role editor read-only; built-in and own role never editable | 1 route(s): POST rbac/roles/:id/update | `TestPrivilegeEscalationThroughRoles`, `TestRoleChangeTakesEffectImmediately`, `TestRoleDeleteRules`, `TestPrivilegeEscalationOverHTTP` |
| Users & roles | `roles:delete` | Delete hidden | 1 route(s): POST rbac/roles/:id/delete | `TestPrivilegeEscalationThroughRoles`, `TestRoleChangeTakesEffectImmediately`, `TestRoleDeleteRules`, `TestPrivilegeEscalationOverHTTP` |
| Users & roles | `audit:read` | Access page, Audit tab | 1 route(s): GET rbac/audit | `TestAuditRecordsBeforeAndAfterAndNeverPasswords` |

Routes that need no permission, only a signed-in enabled user: page shells, the user's own account (`setting/updateUser`,
`setting/sessions/*`, `setting/ui/*`, `api/tokens/*`), `setting/all` (redacted), `rbac/me`.
