"use client";

import { KeyRound, ShieldOff, Pencil, Plus, ShieldCheck, Trash2, UserCog, UserX, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader, PageScaffold, Surface } from "@/components/panel";
import {
  AlertBanner,
  Button,
  ConfirmDialog,
  IconButton,
  Input,
  Modal,
  PillTag,
  SelectNative,
  Spinner,
  Switch,
  Tabs,
  useToast,
} from "@/components/ui";
import { useRbac, type PermissionGroup } from "@/lib/rbac";
import { PermissionMatrix, usePermissionSummary } from "./PermissionMatrix";
import { ROLE_PRESETS } from "./permLabels";
import { LogExplorer } from "@/components/LogExplorer";
import { rbacApi, type AssignableRole, type Role, type UserRow } from "./rbacApi";

type TabId = "users" | "roles" | "audit";

function fmtDate(ts?: number, ms = false): string {
  if (!ts) return "—";
  return new Date(ms ? ts : ts * 1000).toLocaleString();
}

/** Users, roles and the audit trail of access control. Everything here is also enforced by the backend. */
export function AccessPage() {
  const { t } = useTranslation();
  const { can } = useRbac();
  const tabs = useMemo(
    () =>
      [
        { id: "users" as const, label: t("rbac.tabUsers", { defaultValue: "Users" }), icon: Users, perm: "users:read" },
        { id: "roles" as const, label: t("rbac.tabRoles", { defaultValue: "Roles" }), icon: ShieldCheck, perm: "roles:read" },
        { id: "audit" as const, label: t("rbac.tabAudit", { defaultValue: "Audit log" }), icon: KeyRound, perm: "audit:read" },
      ].filter((x) => can(x.perm)),
    [t, can],
  );
  const [tab, setTab] = useState<TabId>("users");

  // ?tab=roles in the address opens that tab (the menu links to it)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q === "roles" || q === "audit" || q === "users") setTab(q);
  }, []);
  const active = tabs.find((x) => x.id === tab)?.id ?? tabs[0]?.id;

  return (
    <PageScaffold>
      <PageHeader
        title={t("menu.access", { defaultValue: "Users & roles" })}
        description={t("rbac.pageDesc", {
          defaultValue: "Who can sign in to the panel and what each role may do. Every restriction is enforced by the server, not only hidden in the interface.",
        })}
        icon={UserCog}
        iconTone="accent"
      />
      <Tabs
        tabs={tabs}
        active={active ?? "users"}
        onChange={(id) => {
          setTab(id as TabId);
          const url = new URL(window.location.href);
          url.searchParams.set("tab", id);
          window.history.replaceState(null, "", url);
        }}
        className="mb-4"
      />
      {active === "users" ? <UsersTab /> : null}
      {active === "roles" ? <RolesTab /> : null}
      {active === "audit" ? <AuditTab /> : null}
    </PageScaffold>
  );
}

// ---------------------------------------------------------------------------------------------------------------- users

function UsersTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useRbac();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [pwTarget, setPwTarget] = useState<UserRow | null>(null);
  const [delTarget, setDelTarget] = useState<UserRow | null>(null);
  const [tfTarget, setTfTarget] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await rbacApi.users();
    if (r.ok) {
      setRows(r.obj ?? []);
      setError("");
    } else setError(r.msg);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggleEnabled = async (u: UserRow) => {
    setBusy(true);
    const r = await rbacApi.updateUser(u.id, { enabled: !u.enabled });
    setBusy(false);
    if (r.ok) {
      toast.success(u.enabled ? t("rbac.userDisabled", { defaultValue: "User disabled; their sessions were ended" }) : t("rbac.userEnabled", { defaultValue: "User enabled" }));
      void load();
    } else toast.error(r.msg);
  };

  const doDelete = async () => {
    if (!delTarget) return;
    setBusy(true);
    const r = await rbacApi.deleteUser(delTarget.id);
    setBusy(false);
    setDelTarget(null);
    if (r.ok) {
      toast.success(t("rbac.userDeleted", { defaultValue: "User deleted" }));
      void load();
    } else toast.error(r.msg);
  };

  const doResetTwoFactor = async () => {
    if (!tfTarget) return;
    setBusy(true);
    const r = await rbacApi.resetTwoFactor(tfTarget.id);
    setBusy(false);
    setTfTarget(null);
    if (r.ok) {
      toast.success(t("rbac.twoFactorReset", { defaultValue: "Two-factor authentication reset; the user's sessions were ended" }));
      void load();
    } else toast.error(r.msg);
  };

  if (error) return <AlertBanner type="error" title={error} />;
  if (!rows) return <Spinner />;

  return (
    <>
      <div className="mb-3 flex justify-end">
        {can("users:create") ? (
          <Button variant="primary" className="!gap-2" onClick={() => setEditing("new")}>
            <Plus size={16} />
            {t("rbac.addUser", { defaultValue: "Add user" })}
          </Button>
        ) : null}
      </div>
      <Surface padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--fg-subtle)]">
                <th className="px-4 py-2.5 font-semibold">{t("rbac.colUser", { defaultValue: "User" })}</th>
                <th className="px-4 py-2.5 font-semibold">{t("rbac.colRole", { defaultValue: "Role" })}</th>
                <th className="px-4 py-2.5 font-semibold">{t("rbac.colStatus", { defaultValue: "Status" })}</th>
                <th className="px-4 py-2.5 font-semibold">{t("rbac.colLastLogin", { defaultValue: "Last sign-in" })}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((u) => (
                <tr key={u.id} className={u.enabled ? "" : "opacity-60"}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-[var(--fg)]">{u.username}</span>
                    {u.self ? <PillTag tone="blue" className="ml-2">{t("rbac.you", { defaultValue: "you" })}</PillTag> : null}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-muted)]">{u.roleName || "—"}</td>
                  <td className="px-4 py-3">
                    <PillTag tone={u.enabled ? "green" : "rose"}>
                      {u.enabled ? t("rbac.statusActive", { defaultValue: "Active" }) : t("rbac.statusDisabled", { defaultValue: "Disabled" })}
                    </PillTag>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--fg-muted)]">{fmtDate(u.lastLoginAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {can("users:update") && u.manageable ? (
                        <>
                          <IconButton label={t("edit")} onClick={() => setEditing(u)}>
                            <Pencil size={16} />
                          </IconButton>
                          <IconButton label={t("rbac.resetPassword", { defaultValue: "Set a new password" })} onClick={() => setPwTarget(u)}>
                            <KeyRound size={16} />
                          </IconButton>
                          {u.twoFactor ? (
                            <IconButton label={t("rbac.resetTwoFactor", { defaultValue: "Reset two-factor authentication" })} onClick={() => setTfTarget(u)}>
                              <ShieldOff size={16} />
                            </IconButton>
                          ) : null}
                          <IconButton
                            label={u.enabled ? t("rbac.disableUser", { defaultValue: "Disable" }) : t("rbac.enableUser", { defaultValue: "Enable" })}
                            disabled={busy}
                            onClick={() => void toggleEnabled(u)}
                          >
                            <UserX size={16} className={u.enabled ? "" : "text-emerald-400"} />
                          </IconButton>
                        </>
                      ) : null}
                      {can("users:delete") && u.manageable ? (
                        <IconButton label={t("delete")} onClick={() => setDelTarget(u)}>
                          <Trash2 size={16} />
                        </IconButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>

      {editing ? (
        <UserFormModal
          user={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={tfTarget != null}
        danger
        loading={busy}
        title={t("rbac.resetTwoFactor", { defaultValue: "Reset two-factor authentication" })}
        description={t("rbac.resetTwoFactorText", {
          defaultValue: "{{name}} will sign in with a password only until they set up two-factor authentication again. Their sessions end.",
          name: tfTarget?.username ?? "",
        })}
        confirmLabel={t("rbac.resetTwoFactorConfirm", { defaultValue: "Reset" })}
        cancelLabel={t("cancel")}
        onCancel={() => setTfTarget(null)}
        onConfirm={() => void doResetTwoFactor()}
      />
      {pwTarget ? <PasswordModal user={pwTarget} onClose={() => setPwTarget(null)} /> : null}
      <ConfirmDialog
        open={delTarget != null}
        danger
        loading={busy}
        title={t("rbac.deleteUserTitle", { defaultValue: "Delete user?" })}
        description={t("rbac.deleteUserText", {
          defaultValue: "{{name}} will not be able to sign in, and their sessions and API tokens end. What they did stays in the audit log.",
          name: delTarget?.username ?? "",
        })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onConfirm={() => void doDelete()}
        onCancel={() => setDelTarget(null)}
      />
    </>
  );
}

function UserFormModal({ user, onClose, onSaved }: { user: UserRow | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [roles, setRoles] = useState<AssignableRole[] | null>(null);
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<number>(user?.roleId ?? 0);
  const [enabled, setEnabled] = useState(user?.enabled ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isNew = user == null;

  useEffect(() => {
    void (async () => {
      const r = await rbacApi.assignable();
      if (r.ok) {
        const list = r.obj ?? [];
        // when editing, the user's current role stays selectable even if it is not assignable by the editor (it is then shown but locked by the server)
        setRoles(list);
        if (!user && list.length > 0) setRoleId((cur) => cur || list[0].id);
      } else setError(r.msg);
    })();
  }, [user]);

  const save = async () => {
    setError("");
    setSaving(true);
    const r = isNew
      ? await rbacApi.createUser({ username, password, roleId, enabled })
      : await rbacApi.updateUser(user.id, {
          username: username !== user.username ? username : undefined,
          roleId: roleId !== user.roleId ? roleId : undefined,
          enabled: enabled !== user.enabled && !user.self ? enabled : undefined,
        });
    setSaving(false);
    if (r.ok) {
      toast.success(isNew ? t("rbac.userCreated", { defaultValue: "User created" }) : t("rbac.userSaved", { defaultValue: "User saved" }));
      onSaved();
    } else setError(r.msg);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t("rbac.addUser", { defaultValue: "Add user" }) : t("rbac.editUser", { defaultValue: "Edit user" })}
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" loading={saving} disabled={!username.trim() || (isNew && !password) || !roleId} onClick={() => void save()}>
            {t("rbac.save", { defaultValue: "Save" })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <AlertBanner type="error" title={error} /> : null}
        <label className="grid gap-1">
          <span className="text-xs text-[var(--fg-muted)]">{t("rbac.fieldUsername", { defaultValue: "Username" })}</span>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </label>
        {isNew ? (
          <label className="grid gap-1">
            <span className="text-xs text-[var(--fg-muted)]">{t("rbac.fieldPassword", { defaultValue: "Password (at least 8 characters)" })}</span>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
        ) : null}
        <label className="grid gap-1">
          <span className="text-xs text-[var(--fg-muted)]">{t("rbac.fieldRole", { defaultValue: "Role" })}</span>
          {roles == null ? (
            <Spinner />
          ) : (
            <SelectNative value={roleId} disabled={user?.self} onChange={(e) => setRoleId(Number(e.target.value))}>
              {user && !roles.some((r) => r.id === user.roleId) ? <option value={user.roleId}>{user.roleName}</option> : null}
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </SelectNative>
          )}
          <span className="text-[11px] text-[var(--fg-subtle)]">
            {t("rbac.roleListHint", { defaultValue: "Only roles that grant nothing you do not hold yourself are offered." })}
          </span>
        </label>
        <label className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
          <Switch checked={enabled} onChange={setEnabled} disabled={user?.self} ariaLabel="enabled" />
          {t("rbac.fieldEnabled", { defaultValue: "Account is active" })}
        </label>
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await rbacApi.setPassword(user.id, pw);
    setSaving(false);
    if (r.ok) {
      toast.success(t("rbac.passwordSet", { defaultValue: "Password changed; the user's sessions were ended" }));
      onClose();
    } else setError(r.msg);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("rbac.resetPassword", { defaultValue: "Set a new password" })}: ${user.username}`}
      width={460}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" loading={saving} disabled={pw.length < 8} onClick={() => void save()}>
            {t("rbac.save", { defaultValue: "Save" })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <AlertBanner type="error" title={error} /> : null}
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("rbac.fieldPassword", { defaultValue: "Password (at least 8 characters)" })} autoComplete="new-password" />
        <p className="text-xs text-[var(--fg-subtle)]">{t("rbac.passwordResetHint", { defaultValue: "The user is signed out everywhere and must use the new password." })}</p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------- roles

function RolesTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useRbac();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [delTarget, setDelTarget] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const summarize = usePermissionSummary(groups);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([rbacApi.roles(), rbacApi.permissions()]);
    if (r.ok) {
      setRoles(r.obj ?? []);
      setError("");
    } else setError(r.msg);
    if (p.ok && p.obj) setGroups(p.obj.groups);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const doDelete = async () => {
    if (!delTarget) return;
    setBusy(true);
    const r = await rbacApi.deleteRole(delTarget.id);
    setBusy(false);
    setDelTarget(null);
    if (r.ok) {
      toast.success(t("rbac.roleDeleted", { defaultValue: "Role deleted" }));
      void load();
    } else toast.error(r.msg);
  };

  if (error) return <AlertBanner type="error" title={error} />;
  if (!roles) return <Spinner />;

  return (
    <>
      <div className="mb-3 flex justify-end">
        {can("roles:create") ? (
          <Button variant="primary" className="!gap-2" onClick={() => setEditing("new")}>
            <Plus size={16} />
            {t("rbac.addRole", { defaultValue: "Add role" })}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {roles.map((r) => (
          <Surface key={r.id} padding="md" className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-[var(--fg)]">{r.name}</h3>
                  {r.isSystem ? <PillTag tone="amber">{t("rbac.builtIn", { defaultValue: "Built-in" })}</PillTag> : null}
                  <PillTag tone="neutral">{t("rbac.usersCount", { defaultValue: "{{n}} user(s)", n: r.userCount })}</PillTag>
                </div>
                {r.description ? <p className="mt-1 text-xs text-[var(--fg-muted)]">{r.description}</p> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                {can("roles:update") && r.manageable ? (
                  <IconButton label={t("edit")} onClick={() => setEditing(r)}>
                    <Pencil size={16} />
                  </IconButton>
                ) : (
                  <Button variant="ghost" className="!h-8 !text-xs" onClick={() => setEditing(r)}>
                    {t("rbac.view", { defaultValue: "View" })}
                  </Button>
                )}
                {can("roles:delete") && r.manageable ? (
                  <IconButton label={t("delete")} onClick={() => setDelTarget(r)}>
                    <Trash2 size={16} />
                  </IconButton>
                ) : null}
              </div>
            </div>
            <ul className="flex flex-col gap-1 text-xs text-[var(--fg-muted)]">
              {summarize(r.permissions).map((line) => (
                <li key={line.group}>
                  {line.group === "*" ? <b className="text-[var(--fg)]">{line.text}</b> : (
                    <>
                      <span className="font-medium text-[var(--fg)]">{line.group}.</span> {line.text}
                    </>
                  )}
                </li>
              ))}
              {r.permissions.length === 0 ? <li className="italic">{t("rbac.noPermissions", { defaultValue: "No permissions" })}</li> : null}
            </ul>
          </Surface>
        ))}
      </div>
      {editing ? (
        <RoleEditorModal
          role={editing === "new" ? null : editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={delTarget != null}
        danger
        loading={busy}
        title={t("rbac.deleteRoleTitle", { defaultValue: "Delete role?" })}
        description={t("rbac.deleteRoleText", { defaultValue: "The role {{name}} will be removed. Roles that users hold cannot be deleted.", name: delTarget?.name ?? "" })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onConfirm={() => void doDelete()}
        onCancel={() => setDelTarget(null)}
      />
    </>
  );
}

function RoleEditorModal({ role, groups, onClose, onSaved }: { role: Role | null; groups: PermissionGroup[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { me, can } = useRbac();
  const isNew = role == null;
  const readOnly = !isNew && !(role.manageable && can("roles:update"));
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [value, setValue] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // what the editor may put into a role: what they hold, minus what only administrators may grant
  const superOnly = useMemo(() => new Set(["settings:security", "system:backup", "system:database"]), []);
  const canGrant = useCallback(
    (key: string) => Boolean(me?.super || (can(key) && !superOnly.has(key))),
    [me?.super, can, superOnly],
  );
  const everything = role?.permissions.includes("*");

  const applyPreset = (perms: string[]) => setValue(new Set(perms.filter(canGrant)));

  const save = async () => {
    setError("");
    setSaving(true);
    const r = await rbacApi.saveRole(role?.id ?? null, { name, description, permissions: Array.from(value) });
    setSaving(false);
    if (r.ok) {
      toast.success(t("rbac.roleSaved", { defaultValue: "Role saved" }));
      onSaved();
    } else setError(r.msg);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t("rbac.addRole", { defaultValue: "Add role" }) : role.name}
      width="min(1100px, 96vw)"
      footer={
        <div className="flex justify-between gap-2">
          <span className="self-center text-xs text-[var(--fg-subtle)]">
            {everything ? "" : t("rbac.selectedCount", { defaultValue: "{{n}} permission(s) selected", n: value.size })}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {readOnly ? t("close") : t("cancel")}
            </Button>
            {!readOnly ? (
              <Button variant="primary" loading={saving} disabled={!name.trim()} onClick={() => void save()}>
                {t("rbac.save", { defaultValue: "Save" })}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <AlertBanner type="error" title={error} /> : null}
        {role?.isSystem ? (
          <AlertBanner type="info" title={t("rbac.builtInHint", { defaultValue: "Built-in roles cannot be changed. Create a custom role for anything narrower." })} />
        ) : null}
        {readOnly && !role?.isSystem ? (
          <AlertBanner type="info" title={t("rbac.readOnlyRole", { defaultValue: "You can view this role but not change it: it is yours, or it grants permissions you do not hold." })} />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-[var(--fg-muted)]">{t("rbac.fieldRoleName", { defaultValue: "Name" })}</span>
            <Input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--fg-muted)]">{t("rbac.fieldDescription", { defaultValue: "Description" })}</span>
            <Input value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} autoComplete="off" />
          </label>
        </div>
        {isNew ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-muted)]">
            {t("rbac.presets", { defaultValue: "Start from" })}:
            {ROLE_PRESETS.map((p) => (
              <Button key={p.id} variant="secondary" className="!h-7 !text-xs" onClick={() => applyPreset(p.permissions)}>
                {t(`rbac.preset.${p.id}`, { defaultValue: p.label })}
              </Button>
            ))}
            <Button variant="ghost" className="!h-7 !text-xs" onClick={() => setValue(new Set())}>
              {t("rbac.selectNone", { defaultValue: "Clear" })}
            </Button>
          </div>
        ) : null}
        {everything ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--fg)]">
            {t("rbac.everythingText", { defaultValue: "This role grants everything, including permissions added in future versions." })}
          </p>
        ) : (
          <PermissionMatrix groups={groups} value={value} onChange={setValue} canGrant={canGrant} readOnly={readOnly} />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------- audit

function AuditTab() {
  const { t } = useTranslation();
  return (
    <>
      <p className="mb-3 text-sm text-[var(--fg-muted)]">
        {t("rbac.auditHint", {
          defaultValue:
            "Who did what and how it ended: users, roles, two-factor resets and refused attempts. Entries are kept for the log retention period (log rotation, max age in Settings) and removed automatically after that.",
        })}
      </p>
      <LogExplorer source={{ type: "audit", id: 0 }} defaultRange="7d" heightClass="max-h-[64vh]" />
    </>
  );
}
