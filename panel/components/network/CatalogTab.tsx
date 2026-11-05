"use client";

import { Cable, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { Surface } from "@/components/panel";
import { AlertBanner, Button, Input, Modal } from "@/components/ui";
import { countryFlag, formatCredits, shortId } from "./format";
import type { CatalogCandidate, NetworkCatalogResponse } from "@/types/network";

type CatalogTabProps = {
  manage: boolean;
  onChanged: () => void;
};

/** Foreign nodes offered by other participants, ranked by the coordinator score. */
export function CatalogTab({ manage, onChanged }: CatalogTabProps) {
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) =>
    t(`pages.network.${key}`, { defaultValue: fallback });

  const [candidates, setCandidates] = useState<CatalogCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [country, setCountry] = useState("");
  const [connecting, setConnecting] = useState<CatalogCandidate | null>(null);
  const [quotaGB, setQuotaGB] = useState("10");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await getJson<NetworkCatalogResponse>(
        panel(`network/catalog${country ? `?country=${encodeURIComponent(country.toUpperCase())}` : ""}`),
      );
      if (!r.success) throw new Error(r.msg);
      setCandidates(r.obj?.candidates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [country]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const quotaBytes = Math.round(Number(quotaGB) * 1e9);
  const rate = connecting?.node.rate_micros ?? 0;
  const quoteValid = Number.isSafeInteger(quotaBytes) && Number(quotaGB) >= 0.1 && Number(quotaGB) <= 10000 && Number.isSafeInteger(rate) && rate > 0 && !!connecting?.node.tariff_revision;
  const reserveMicros = quoteValid ? Number((BigInt(quotaBytes) * BigInt(rate) + BigInt(999999999)) / BigInt(1000000000)) : 0;
  const open = async () => {
    if (!connecting || !quoteValid) return;
    setBusy(true);
    setError("");
    try {
      const r = await postJson(panel("network/sessions/open"), {
        nodeId: connecting.node.id,
        quotaGB: Number(quotaGB),
        tariffRevision: connecting.node.tariff_revision,
        maxReserveMicros: reserveMicros,
      }, true);
      if (r && (r as { success?: boolean }).success === false) {
        setError((r as { msg?: string }).msg ?? tr("openFailed", "Не удалось арендовать ресурс"));
      } else {
        setConnecting(null);
        onChanged();
        void reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder={tr("catalogCountry", "Country code (e.g. DE)")}
          className="w-44"
        />
        <Button variant="ghost" onClick={() => void reload()}>
          <RefreshCw className="size-3.5" />
          {tr("refresh", "Refresh")}
        </Button>
      </div>
      {error ? <AlertBanner type="error" title={error} /> : null}
      {loading ? (
        <div className="py-10 text-center text-sm text-[var(--fg-muted)]">{tr("loading", "Loading…")}</div>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Cable className="size-8 text-[var(--fg-subtle)]" />
          <div className="text-sm text-[var(--fg-muted)]">
            {tr("catalogEmpty", "No network nodes match the filter yet.")}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--fg-muted)]">
                <th className="py-2 pr-3 font-medium">{tr("colNode", "Node")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colScore", "Score")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colCapacity", "Capacity")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colRemaining", "Traffic left")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colPrice", "Price / GB")}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.node.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium">
                      {countryFlag(String(c.node.country ?? ""))} {c.node.label ?? shortId(String(c.node.id))}
                    </div>
                    <div className="text-xs text-[var(--fg-subtle)]">
                            {String(c.node.country ?? "")} · {(c.node.protocols ?? []).join(", ")}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {Math.round((c.score ?? 0) * 100)}%
                    <div className="text-xs text-[var(--fg-subtle)]">
                      {t("pages.network.scoreHint", {
                        defaultValue: "health {{h}} · latency {{l}}",
                        h: Math.round((c.score_parts?.health ?? 0) * 100),
                        l: Math.round((c.score_parts?.latency ?? 0) * 100),
                      })}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">{c.available_mbps ?? 0} Mbps</td>
                  <td className="py-2.5 pr-3 tabular-nums">{Math.round(c.remaining_traffic_gb ?? 0)} GB</td>
                  <td className="py-2.5 pr-3 tabular-nums">{formatCredits(c.node.price_credits_per_gb)}</td>
                  <td className="py-2.5 text-right">
                    {manage ? (
                      <Button onClick={() => setConnecting(c)}>
                        {tr("connect", "Арендовать")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={connecting !== null}
        onClose={() => setConnecting(null)}
        title={t("pages.network.connectTitle", { defaultValue: "Аренда {{label}}", label: connecting?.node.label ?? "" })}
      >
        <div className="space-y-3">
          {error ? <AlertBanner type="error" title={error} /> : null}
          <p className="text-sm text-[var(--fg-muted)]">
            {tr("rentWithoutClientHint", "Клиент при аренде не выбирается. После открытия сессии объедините ресурсы в bundle, затем отдельно назначьте его клиентам.")}
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--fg-muted)]">{tr("quotaGB", "Квота (ГБ)")}</span>
            <Input value={quotaGB} onChange={(e) => setQuotaGB(e.target.value)} inputMode="decimal" />
          </label>
          <p className="text-sm text-[var(--fg-muted)]" role="status">
            {tr("operatorQuote", "Тариф оператора")}: {(rate / 1e6).toFixed(6)} ₢/GB.<br />
            {tr("reserveQuote", "Будет зарезервировано")}: {(reserveMicros / 1e6).toFixed(6)} ₢.<br />
            {tr("reserveExplanation", "Списание — только за подтверждённый upload + download. Остаток вернётся при закрытии. Изменение тарифа потребует повторного подтверждения.")}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConnecting(null)}>{tr("cancel", "Отмена")}</Button>
            <Button onClick={() => void open()} disabled={busy || !quoteValid}>
              {busy ? tr("opening", "Аренда…") : tr("connect", "Арендовать")}
            </Button>
          </div>
        </div>
      </Modal>
    </Surface>
  );
}
