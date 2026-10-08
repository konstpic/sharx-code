"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Surface } from "@/components/panel";
import { AlertBanner, Button, ConfirmDialog, IconButton, Input, Modal, SelectNative, Spinner, useToast } from "@/components/ui";
import { useRbac } from "@/lib/rbac";
import { orgApi, type GroupRow, type OrgRow } from "./rbacApi";

/** Organizations: tenants that own client groups. An account in an organization sees only its groups and their clients. */
export function OrgsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useRbac();
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<OrgRow | "new" | null>(null);
  const [del, setDel] = useState<OrgRow | null>(null);

  const load = useCallback(async () => {
    const [o, g] = await Promise.all([orgApi.list(), can("groups:read") ? orgApi.groups() : Promise.resolve({ ok: true, msg: "", obj: [] as GroupRow[] })]);
    if (!o.ok) {
      setError(o.msg);
      return;
    }
    setError("");
    setOrgs(o.obj ?? []);
    setGroups(g.obj ?? []);
  }, [can]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <AlertBanner type="error" title={error} />;
  if (!orgs) return <Spinner />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--fg-muted)]">
        {t("rbac.orgs.intro", {
          defaultValue:
            "An organization owns client groups. A user assigned to it (Users → edit) sees and manages only those groups and the clients in them, and can use nothing else: no nodes, inbounds, settings or other organizations. Creating and editing clients and assigning inbounds stay with administrators.",
        })}
      </p>
      <Surface padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-base font-semibold text-[var(--fg)]">{t("rbac.orgs.title", { defaultValue: "Organizations" })}</h2>
          {can("orgs:create") ? (
            <Button variant="primary" onClick={() => setEdit("new")}>
              <Plus size={16} /> {t("rbac.orgs.add", { defaultValue: "Add organization" })}
            </Button>
          ) : null}
        </div>
        {orgs.length === 0 ? (
          <p className="p-4 text-sm text-[var(--fg-muted)]">{t("rbac.orgs.none", { defaultValue: "No organizations yet." })}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {orgs.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--fg)]">{o.name}</div>
                  {o.description ? <div className="text-xs text-[var(--fg-muted)]">{o.description}</div> : null}
                </div>
                <span className="text-xs text-[var(--fg-subtle)]">
                  {t("rbac.orgs.counts", { defaultValue: "{{u}} user(s) · {{g}} group(s)", u: o.users, g: o.groups })}
                </span>
                {can("orgs:update") ? (
                  <IconButton label={t("edit")} onClick={() => setEdit(o)}>
                    <Pencil size={16} />
                  </IconButton>
                ) : null}
                {can("orgs:delete") ? (
                  <IconButton label={t("delete")} onClick={() => setDel(o)}>
                    <Trash2 size={16} />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Surface>

      {can("groups:read") ? (
        <Surface padding="none" className="overflow-hidden">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-base font-semibold text-[var(--fg)]">{t("rbac.orgs.groupsTitle", { defaultValue: "Client groups and their organization" })}</h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">{t("rbac.orgs.groupsHint", { defaultValue: "The clients of a group follow it. A group without an organization is visible only to accounts that are not limited." })}</p>
          </div>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[var(--fg)]">{g.name}</span>
                <SelectNative
                  className="max-w-[14rem]"
                  disabled={!can("orgs:update") || !can("groups:update")}
                  value={g.orgId ?? 0}
                  onChange={async (e) => {
                    const v = Number(e.target.value);
                    const r = await orgApi.setGroupOrg(g.id, v === 0 ? null : v);
                    if (r.ok) void load();
                    else toast.error(r.msg);
                  }}
                >
                  <option value={0}>{t("rbac.orgs.noOrg", { defaultValue: "— none —" })}</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </SelectNative>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}

      {edit ? (
        <OrgModal
          org={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void load();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={del != null}
        danger
        title={t("rbac.orgs.delete", { defaultValue: "Delete the organization?" })}
        description={t("rbac.orgs.deleteText", { defaultValue: "{{name}} must have no users and no groups.", name: del?.name ?? "" })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          const r = await orgApi.remove(del.id);
          setDel(null);
          if (r.ok) void load();
          else toast.error(r.msg);
        }}
      />
    </div>
  );
}

function OrgModal({ org, onClose, onSaved }: { org: OrgRow | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(org?.name ?? "");
  const [description, setDescription] = useState(org?.description ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={org ? t("rbac.orgs.edit", { defaultValue: "Edit organization" }) : t("rbac.orgs.add", { defaultValue: "Add organization" })}
      width={440}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!name.trim()}
            onClick={async () => {
              setSaving(true);
              const r = await orgApi.save(org?.id ?? null, { name, description });
              setSaving(false);
              if (r.ok) onSaved();
              else setError(r.msg);
            }}
          >
            {t("rbac.save", { defaultValue: "Save" })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <AlertBanner type="error" title={error} /> : null}
        <label className="grid gap-1">
          <span className="text-xs text-[var(--fg-muted)]">{t("rbac.fieldRoleName", { defaultValue: "Name" })}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-[var(--fg-muted)]">{t("rbac.fieldDescription", { defaultValue: "Description" })}</span>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
