"use client";

import { FileText, Pencil, Plus, Server, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { PageScaffold, PageHeader, Surface } from "@/components/panel";
import {
  XrayConfigTemplateEditor,
  type XrayConfigTemplateEditorHandle,
} from "@/components/xray/XrayConfigTemplateEditor";
import {
  Button,
  CheckboxOptionCard,
  CheckboxOptionList,
  SelectionListToolbar,
  ConfirmDialog,
  Input,
  Modal,
  Spinner,
  useToast,
} from "@/components/ui";

type Profile = {
  id: number;
  name: string;
  description: string;
  configJson: string;
  isDefault: boolean;
  createdAt?: number;
  updatedAt?: number;
  nodeIds?: number[];
};

type NodeRow = { id: number; name: string; address: string };

function formatTs(ts: number | undefined, locale: string): string {
  if (ts == null || !Number.isFinite(ts)) return "—";
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    return new Date(ms).toLocaleString(locale);
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Renders count + node names; avoids showing raw DB ids like "5" (one node with id 5). */
function formatProfileAssignmentsLine(
  nodeIds: number[] | undefined,
  nodeRows: NodeRow[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!nodeIds?.length) return "";
  const parts = nodeIds.map((id) => {
    const n = nodeRows.find((x) => x.id === id);
    const name = n?.name?.trim();
    return name ? `${name} (ID ${id})` : `ID ${id}`;
  });
  const list = parts.join(", ");
  const countLabel =
    nodeIds.length === 1
      ? t("pages.xrayCoreConfigProfiles.assignedNodesCountOne")
      : t("pages.xrayCoreConfigProfiles.assignedNodesCountMany", { count: nodeIds.length });
  return `${countLabel}: ${list}`;
}

export function XrayCoreConfigProfilesPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const editorRef = useRef<XrayConfigTemplateEditorHandle>(null);

  const [multiNode, setMultiNode] = useState<boolean | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [configJson, setConfigJson] = useState("{}");
  const [baselineConfig, setBaselineConfig] = useState("{}");
  const [editorSyncKey, setEditorSyncKey] = useState(0);
  const [saveProfileLoading, setSaveProfileLoading] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignProfileId, setAssignProfileId] = useState<number | null>(null);
  const [assignSelected, setAssignSelected] = useState<Record<number, boolean>>({});
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadFlags = useCallback(async () => {
    const s = await postJson<Record<string, unknown>>(panel("setting/all"));
    if (s.success && s.obj) {
      setMultiNode(Boolean((s.obj as { multiNodeMode?: boolean }).multiNodeMode));
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    const r = await getJson<Profile[]>(panel("xray-core-config-profile/list"));
    setLoading(false);
    if (r.success && Array.isArray(r.obj)) {
      setProfiles(r.obj);
    } else {
      setProfiles([]);
      if (!r.success) {
        toast.error(r.msg || t("fail"));
      }
    }
  }, [t, toast]);

  const loadNodes = useCallback(async () => {
    const r = await getJson<NodeRow[]>(panel("node/list"));
    if (r.success && Array.isArray(r.obj)) {
      setNodes(r.obj as NodeRow[]);
    } else {
      setNodes([]);
    }
  }, []);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  useEffect(() => {
    void loadProfiles();
    void loadNodes();
  }, [loadProfiles, loadNodes]);

  const openEdit = async (id: number) => {
    setEditId(id);
    setEditOpen(true);
    setEditLoading(true);
    const r = await getJson<Profile>(panel(`xray-core-config-profile/get/${id}`));
    setEditLoading(false);
    if (!r.success || !r.obj) {
      toast.error(r.msg || t("fail"));
      setEditOpen(false);
      return;
    }
    const pObj = r.obj as Profile;
    setEditName(pObj.name);
    setEditDescription(pObj.description ?? "");
    const pretty = prettyJson(pObj.configJson || "{}");
    setConfigJson(pretty);
    setBaselineConfig(pretty);
    setEditorSyncKey((k) => k + 1);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditId(null);
  };

  const configDirty = configJson !== baselineConfig;
  const metaDirty =
    editId != null &&
    profiles.find((x) => x.id === editId) &&
    (editName !== (profiles.find((x) => x.id === editId)?.name ?? "") ||
      editDescription !== (profiles.find((x) => x.id === editId)?.description ?? ""));
  const editDirty = configDirty || metaDirty;

  const saveEdit = async () => {
    if (editId == null) return;
    const json = editorRef.current?.getJsonForSave();
    if (json == null) {
      toast.error(t("pages.xrayCoreConfigProfiles.invalidJson"));
      return;
    }
    setSaveProfileLoading(true);
    const r = await postJson(
      panel(`xray-core-config-profile/update/${editId}`),
      {
        name: editName.trim(),
        description: editDescription.trim(),
        configJson: json,
      },
      true,
    );
    setSaveProfileLoading(false);
    if (r.success) {
      toast.success(r.msg || t("success"));
      const next = prettyJson(json);
      setConfigJson(next);
      setBaselineConfig(next);
      setEditorSyncKey((k) => k + 1);
      await loadProfiles();
    } else {
      toast.error(r.msg || t("fail"));
    }
  };

  const setDefault = async (id: number) => {
    const r = await postJson(panel(`xray-core-config-profile/set-default/${id}`));
    if (r.success) {
      toast.success(r.msg || t("success"));
      await loadProfiles();
    } else {
      toast.error(r.msg || t("fail"));
    }
  };

  const resetProfile = async (id: number) => {
    const r = await postJson<Profile>(panel(`xray-core-config-profile/reset-to-default/${id}`));
    if (r.success && r.obj) {
      toast.success(r.msg || t("success"));
      const pObj = r.obj as Profile;
      if (editOpen && editId === id) {
        const pretty = prettyJson(pObj.configJson || "{}");
        setConfigJson(pretty);
        setBaselineConfig(pretty);
        setEditorSyncKey((k) => k + 1);
      }
      await loadProfiles();
    } else {
      toast.error(r.msg || t("fail"));
    }
  };

  const openAssign = (id: number) => {
    const pr = profiles.find((x) => x.id === id);
    const sel: Record<number, boolean> = {};
    for (const n of nodes) {
      sel[n.id] = Boolean(pr?.nodeIds?.includes(n.id));
    }
    setAssignSelected(sel);
    setAssignProfileId(id);
    setAssignOpen(true);
  };

  const submitAssign = async () => {
    if (assignProfileId == null) return;
    const nodeIds = Object.entries(assignSelected)
      .filter(([, on]) => on)
      .map(([id]) => parseInt(id, 10));
    setAssignSubmitting(true);
    const r = await postJson(panel(`xray-core-config-profile/assign-nodes/${assignProfileId}`), { nodeIds }, true);
    setAssignSubmitting(false);
    if (r.success) {
      toast.success(r.msg || t("success"));
      setAssignOpen(false);
      await loadProfiles();
    } else {
      toast.error(r.msg || t("fail"));
    }
  };

  const submitAdd = async () => {
    const name = addName.trim();
    if (!name) {
      toast.error(t("pages.xrayCoreConfigProfiles.nameRequired"));
      return;
    }
    const defaultP = profiles.find((x) => x.isDefault);
    const baseJson = defaultP?.configJson ?? profiles[0]?.configJson ?? "{}";
    setAddSubmitting(true);
    const r = await postJson<Profile>(
      panel("xray-core-config-profile/add"),
      {
        name,
        description: addDescription.trim(),
        configJson: prettyJson(baseJson),
        isDefault: false,
      },
      true,
    );
    setAddSubmitting(false);
    if (r.success) {
      toast.success(r.msg || t("success"));
      setAddOpen(false);
      setAddName("");
      setAddDescription("");
      await loadProfiles();
    } else {
      toast.error(r.msg || t("fail"));
    }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    setDeleting(true);
    const r = await postJson(panel(`xray-core-config-profile/del/${deleteId}`));
    setDeleting(false);
    setDeleteId(null);
    if (r.success) {
      toast.success(r.msg || t("success"));
      await loadProfiles();
    } else {
      toast.error(r.msg || t("fail"));
    }
  };

  const locale = i18n.language || "en";

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id - b.id),
    [profiles],
  );

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("menu.xrayCoreConfigProfiles")}
        description={t("pages.xrayCoreConfigProfiles.pageDesc", {
          defaultValue:
            "Templates for Xray on nodes. Assign a profile to each node; edit by section or General.",
        })}
        icon={FileText}
        iconTone="neutral"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => setAddOpen(true)}
              className="!gap-2"
            >
              <Plus size={16} />
              {t("pages.xrayCoreConfigProfiles.addProfile")}
            </Button>
          </div>
        }
      />


      <Surface padding="none" className="overflow-hidden">
        {loading && !profiles.length ? (
          <div className="grid min-h-48 place-items-center">
            <Spinner size={32} />
          </div>
        ) : !profiles.length ? (
          <div className="px-4 py-12 text-center text-sm text-[var(--fg-muted)]">{t("noData")}</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {sortedProfiles.map((pr) => (
              <div
                key={pr.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-[var(--fg)]">{pr.name}</h3>
                    {pr.isDefault ? (
                      <span className="rounded-md bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                        {t("pages.xrayCoreConfigProfiles.default")}
                      </span>
                    ) : null}
                  </div>
                  {pr.description ? (
                    <p className="mt-1 text-sm text-[var(--fg-muted)]">{pr.description}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-[var(--fg-subtle)]">
                    {multiNode ? (
                      <>
                        {t("pages.xrayCoreConfigProfiles.assignedNodes")}:{" "}
                        {(pr.nodeIds?.length ?? 0) === 0
                          ? t("pages.xrayCoreConfigProfiles.nodesNone", { defaultValue: "none assigned" })
                          : formatProfileAssignmentsLine(pr.nodeIds, nodes, t)}
                        {" · "}
                      </>
                    ) : null}
                    {t("pages.xrayCoreConfigProfiles.updatedLabel", { defaultValue: "Updated" })}{" "}
                    {formatTs(pr.updatedAt, locale)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!pr.isDefault ? (
                    <Button type="button" variant="secondary" className="!gap-1.5 !text-xs" onClick={() => void setDefault(pr.id)}>
                      {t("pages.xrayCoreConfigProfiles.setAsDefault")}
                    </Button>
                  ) : null}
                  {multiNode ? (
                    <Button type="button" variant="secondary" className="!gap-1.5 !text-xs" onClick={() => openAssign(pr.id)}>
                      <Users size={14} />
                      {t("pages.xrayCoreConfigProfiles.assignNodes")}
                    </Button>
                  ) : null}
                  <Button type="button" variant="secondary" className="!gap-1.5 !text-xs" onClick={() => void resetProfile(pr.id)}>
                    {t("pages.xrayCoreConfigProfiles.resetToDefaultTemplate")}
                  </Button>
                  <Button type="button" variant="secondary" className="!gap-1.5 !text-xs" onClick={() => void openEdit(pr.id)}>
                    <Pencil size={14} />
                    {t("edit")}
                  </Button>
                  {!pr.isDefault ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="!gap-1.5 !text-xs text-rose-300 hover:bg-rose-500/10"
                      onClick={() => setDeleteId(pr.id)}
                    >
                      <Trash2 size={14} />
                      {t("delete")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Surface>

      <Modal
        open={editOpen}
        onClose={closeEdit}
        title={t("pages.xrayCoreConfigProfiles.editProfile")}
        width="min(96vw, 1200px)"
        dialogClassName="h-[min(90vh,900px)]"
        bodyClassName="!overflow-hidden"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={closeEdit}>
              {t("cancel")}
            </Button>
            <Button variant="primary" loading={saveProfileLoading} disabled={!editDirty} onClick={() => void saveEdit()}>
              {t("save")}
            </Button>
          </div>
        }
      >
        {editLoading ? (
          <div className="grid min-h-[200px] place-items-center">
            <Spinner size={36} />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="grid shrink-0 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
                  {t("pages.xrayCoreConfigProfiles.name")}
                </label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
                  {t("pages.xrayCoreConfigProfiles.descriptionField")}
                </label>
                <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="w-full" />
              </div>
            </div>
            <XrayConfigTemplateEditor
              ref={editorRef}
              template={configJson}
              onTemplateChange={setConfigJson}
              syncKey={editorSyncKey}
              loading={false}
              fillHeight
            />
          </div>
        )}
      </Modal>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title={t("pages.xrayCoreConfigProfiles.assignNodesTitle", { defaultValue: "Assign nodes" })}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="primary" loading={assignSubmitting} onClick={() => void submitAssign()}>
              {t("apply")}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-xs text-[var(--fg-subtle)]">{t("pages.xrayCoreConfigProfiles.assignNodesHint")}</p>
        {nodes.length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">
            {t("pages.xrayCoreConfigProfiles.noNodesInPanel", { defaultValue: "No nodes yet." })}
          </p>
        ) : (
          <CheckboxOptionList
            layout="grid"
            header={
              <SelectionListToolbar
                selectedCount={nodes.filter((n) => assignSelected[n.id]).length}
                totalCount={nodes.length}
                onSelectAll={() =>
                  setAssignSelected(Object.fromEntries(nodes.map((n) => [n.id, true])))
                }
                onSelectNone={() => setAssignSelected({})}
                selectAllLabel={t("pages.xrayCoreConfigProfiles.selectAllNodes", {
                  defaultValue: "Select all",
                })}
                selectNoneLabel={t("pages.xrayCoreConfigProfiles.selectNoneNodes", {
                  defaultValue: "Clear",
                })}
              />
            }
          >
            {nodes.map((n) => (
              <CheckboxOptionCard
                key={n.id}
                icon={Server}
                checked={Boolean(assignSelected[n.id])}
                onChange={(e) =>
                  setAssignSelected((prev) => ({
                    ...prev,
                    [n.id]: e.target.checked,
                  }))
                }
                heading={n.name}
                description={n.address}
              />
            ))}
          </CheckboxOptionList>
        )}
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t("pages.xrayCoreConfigProfiles.addProfile")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="primary" loading={addSubmitting} onClick={() => void submitAdd()}>
              {t("create")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
              {t("pages.xrayCoreConfigProfiles.name")}
            </label>
            <Input value={addName} onChange={(e) => setAddName(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">
              {t("pages.xrayCoreConfigProfiles.descriptionField")}
            </label>
            <Input value={addDescription} onChange={(e) => setAddDescription(e.target.value)} className="w-full" />
          </div>
          <p className="text-xs text-[var(--fg-subtle)]">
            {t("pages.xrayCoreConfigProfiles.addHint", {
              defaultValue:
                "Config is copied from the default profile (or the first one). Edit it after creation.",
            })}
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId != null}
        title={t("pages.xrayCoreConfigProfiles.deleteProfile")}
        description={t("pages.xrayCoreConfigProfiles.deleteProfileDetail", {
          defaultValue: "This cannot be undone. Profiles used by outbounds cannot be deleted.",
        })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        loading={deleting}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void confirmDelete()}
      />
    </PageScaffold>
  );
}
