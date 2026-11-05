"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { Surface } from "@/components/panel";
import { AlertBanner, Button, Input, Modal, Segmented, SelectNative } from "@/components/ui";
import { bytesToGB, formatDateTimeShort, shortId } from "./format";
import type {
  CreateNetworkBundleResponse,
  NetworkBundle,
  NetworkSession,
  NetworkSessionsResponse,
} from "@/types/network";

type SessionsTabProps = {
  manage: boolean;
  onChanged: () => void;
};

type ClientOption = { id: number; name: string };

const STATUS_TONE: Record<string, string> = {
  active: "text-[var(--success)]",
  provisioning: "text-[var(--warning)]",
  degraded: "text-[var(--warning)]",
  closing: "text-[var(--fg-muted)]",
  closed: "text-[var(--fg-subtle)]",
  disputed: "text-[var(--danger)]",
};

/** Rented resources and sessions; client access is always a separate explicit action. */
export function SessionsTab({ manage, onChanged }: SessionsTabProps) {
  const { t } = useTranslation();
  const tr = useCallback(
    (key: string, fallback: string, options?: Record<string, string | number>) =>
      t(`pages.network.${key}`, { defaultValue: fallback, ...options }),
    [t],
  );

  const [role, setRole] = useState("all");
  const [sessions, setSessions] = useState<NetworkSession[]>([]);
  const [bundles, setBundles] = useState<NetworkBundle[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [selectedClients, setSelectedClients] = useState<number[]>([]);
  const [bundleName, setBundleName] = useState("");
  const [bundleId, setBundleId] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [disputing, setDisputing] = useState<NetworkSession | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await getJson<NetworkSessionsResponse>(
        panel(`network/sessions${role === "all" ? "" : `?role=${role}`}`),
      );
      if (!r.success) throw new Error(r.msg);
      const next = r.obj?.sessions ?? [];
      setSessions(next);
      setSelectedSessions((current) => current.filter((id) => next.some((s) => s.id === id && s.role === "consumer" && (s.status === "active" || s.status === "degraded"))));
      if (manage) {
        const [bundleResult, clientResult] = await Promise.all([
          getJson<NetworkBundle[]>(panel("bundle/list")),
          getJson<ClientOption[]>(panel("client/list")),
        ]);
        const allBundles = bundleResult.success && Array.isArray(bundleResult.obj) ? bundleResult.obj : [];
        setBundles(allBundles.filter((b) => (b.hosts ?? []).some((h) => h.host?.source === "sharx-network")));
        setClients(clientResult.success && Array.isArray(clientResult.obj) ? clientResult.obj : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [manage, role]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleSession = (id: string) => {
    setSelectedSessions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const toggleClient = (id: number) => {
    setSelectedClients((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const createBundle = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await postJson<CreateNetworkBundleResponse>(panel("network/bundles"), {
        name: bundleName.trim(), sessionIds: selectedSessions,
      }, true);
      if (!r.success) throw new Error(r.msg);
      const created = r.obj?.bundle?.id ?? 0;
      setBundleId(created);
      setBundleName("");
      setSelectedSessions([]);
      setNotice(tr("bundleCreated", "Bundle создан. Теперь отдельно выберите клиентов и назначьте им доступ."));
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignBundle = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await postJson(panel("network/bundles/assign"), { bundleId, clientIds: selectedClients }, true);
      if (!r.success) throw new Error(r.msg);
      setSelectedClients([]);
      setNotice(tr("bundleAssigned", "Bundle назначен выбранным клиентам. Их подписки обновлены."));
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = async (s: NetworkSession) => {
    setBusy(true);
    setError("");
    try {
      const r = await postJson(panel("network/sessions/close"), { id: s.id, reason: "admin" }, true);
      if (!r.success) throw new Error(r.msg);
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dispute = async () => {
    if (!disputing) return;
    setBusy(true);
    setError("");
    try {
      const r = await postJson(panel("network/sessions/dispute"), { id: disputing.id, reason }, true);
      if (!r.success) throw new Error(r.msg);
      setDisputing(null);
      setReason("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rentable = sessions.filter((s) => s.role === "consumer" && (s.status === "active" || s.status === "degraded") && s.inboundId && s.hostId);

  return (
    <Surface>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={role}
          onChange={setRole}
          items={[
            { id: "all", label: tr("roleAll", "Все") },
            { id: "provider", label: tr("roleProvider", "Предоставленные") },
            { id: "consumer", label: tr("roleConsumer", "Арендованные") },
          ]}
        />
        <Button variant="ghost" onClick={() => void reload()}>
          <RefreshCw className="size-3.5" />
          {tr("refresh", "Обновить")}
        </Button>
      </div>
      {error ? <AlertBanner type="error" title={error} /> : null}
      {notice ? <div className="mb-4"><AlertBanner type="info" title={notice} /></div> : null}

      {manage && role !== "provider" ? (
        <div className="mb-5 grid gap-4 rounded-lg border border-[var(--border)] p-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">{tr("bundleStep1", "1. Соберите bundle из арендованных нод")}</h3>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              {tr("bundleStep1Hint", "Выберите одну или несколько активных сессий в таблице. На этом шаге клиенты не изменяются.")}
            </p>
            <label htmlFor="network-bundle-name" className="mt-3 block text-xs text-[var(--fg-muted)]">{tr("bundleName", "Название bundle")}</label>
            <Input id="network-bundle-name" value={bundleName} onChange={(e) => setBundleName(e.target.value)} className="mt-1" />
            <Button className="mt-3" onClick={() => void createBundle()} disabled={busy || selectedSessions.length === 0 || !bundleName.trim()}>
              {tr("createBundle", "Создать bundle")} ({selectedSessions.length})
            </Button>
          </div>
          <div>
            <h3 className="text-sm font-medium">{tr("bundleStep2", "2. Явно назначьте bundle клиентам")}</h3>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              {tr("bundleSharedQuota", "Все клиенты bundle используют общие учётные данные и квоту каждой арендованной сессии.")}
            </p>
            <label htmlFor="network-bundle-select" className="mt-3 block text-xs text-[var(--fg-muted)]">{tr("selectBundle", "Bundle")}</label>
            <SelectNative id="network-bundle-select" value={bundleId} onChange={(e) => setBundleId(Number(e.target.value))} className="mt-1">
              <option value={0}>{tr("selectBundlePlaceholder", "Выберите bundle")}</option>
              {bundles.map((b) => <option key={b.id} value={b.id}>{b.name} (#{b.id})</option>)}
            </SelectNative>
            <div className="mt-3 max-h-32 space-y-2 overflow-y-auto rounded-md border border-[var(--border)] p-3">
              {clients.length === 0 ? <span className="text-xs text-[var(--fg-muted)]">{tr("noClients", "Нет доступных клиентов")}</span> : clients.map((client) => (
                <label key={client.id} className="flex min-h-6 items-center gap-2 text-xs">
                  <input type="checkbox" checked={selectedClients.includes(client.id)} onChange={() => toggleClient(client.id)} />
                  <span>{client.name}</span><span className="text-[var(--fg-subtle)]">#{client.id}</span>
                </label>
              ))}
            </div>
            <Button className="mt-3" onClick={() => void assignBundle()} disabled={busy || bundleId <= 0 || selectedClients.length === 0}>
              {tr("assignBundle", "Назначить клиентам")} ({selectedClients.length})
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="py-10 text-center text-sm text-[var(--fg-muted)]">{tr("loading", "Загрузка…")}</div>
      ) : sessions.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--fg-muted)]">{tr("sessionsEmpty", "Сетевых сессий пока нет.")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--fg-muted)]">
                {manage && role !== "provider" ? <th className="py-2 pr-3 font-medium"><span className="sr-only">{tr("select", "Выбор")}</span></th> : null}
                <th className="py-2 pr-3 font-medium">{tr("colResource", "Ресурс")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colInboundHost", "Inbound → host")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colBundles", "Bundles")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colStatus", "Статус")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colUsage", "Трафик / квота")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colOpened", "Открыта")}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const usedGB = bytesToGB((s.usageUpBytes ?? 0) + (s.usageDownBytes ?? 0));
                const closed = s.status === "closed";
                const selectable = rentable.some((item) => item.id === s.id);
                return (
                  <tr key={s.id} className="border-b border-[var(--border)] last:border-0">
                    {manage && role !== "provider" ? (
                      <td className="py-2.5 pr-3">
                        {selectable ? <input type="checkbox" aria-label={tr("selectSession", "Выбрать сессию {{id}}", { id: shortId(s.id) })} checked={selectedSessions.includes(s.id)} onChange={() => toggleSession(s.id)} /> : null}
                      </td>
                    ) : null}
                    <td className="py-2.5 pr-3">
                      <div className="font-mono text-xs">{shortId(s.id)}</div>
                      <div className="text-xs text-[var(--fg-subtle)]">{s.role === "provider" ? tr("roleProvider", "Предоставленная") : tr("roleConsumer", "Арендованная")}</div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{s.inboundId ? `#${s.inboundId} → #${s.hostId ?? "—"}` : "—"}</td>
                    <td className="py-2.5 pr-3 text-xs">{(s.bundleIds ?? []).length ? (s.bundleIds ?? []).map((id) => `#${id}`).join(", ") : tr("notInBundle", "Не добавлен")}</td>
                    <td className={`py-2.5 pr-3 text-xs font-medium ${STATUS_TONE[s.status ?? ""] ?? ""}`}>{s.status}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-xs">{usedGB.toFixed(3)} / {s.quotaGB ?? 0} GB</td>
                    <td className="py-2.5 pr-3 text-xs text-[var(--fg-subtle)]">{formatDateTimeShort(s.openedAt)}</td>
                    <td className="py-2.5 text-right">
                      {manage && !closed ? (
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" onClick={() => setDisputing(s)}>{tr("dispute", "Спор")}</Button>
                          <Button variant="ghost" onClick={() => void close(s)} disabled={busy}>{tr("close", "Закрыть")}</Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={disputing !== null} onClose={() => setDisputing(null)} title={tr("disputeTitle", "Спор по сессии {{id}}", { id: shortId(disputing?.id) })}>
        <div className="space-y-3">
          <p className="text-sm text-[var(--fg-muted)]">{tr("disputeHint", "Сессия будет приостановлена, а оператор сети проверит записи об использовании обеих сторон.")}</p>
          <label htmlFor="network-dispute-reason" className="block text-xs text-[var(--fg-muted)]">{tr("disputeReason", "Причина (обязательно)")}</label>
          <Input id="network-dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDisputing(null)}>{tr("cancel", "Отмена")}</Button>
            <Button onClick={() => void dispute()} disabled={busy || reason.trim().length === 0}>{tr("submit", "Отправить")}</Button>
          </div>
        </div>
      </Modal>
    </Surface>
  );
}
