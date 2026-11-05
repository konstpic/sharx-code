"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { Surface } from "@/components/panel";
import { AlertBanner, Button } from "@/components/ui";
import { bytesToGB, formatCredits, formatDateTimeShort, shortId } from "./format";
import type { LedgerEntry, NetworkLedgerResponse } from "@/types/network";

const DIRECTION_STYLE: Record<string, { sign: string; cls: string }> = {
  credit: { sign: "+", cls: "text-[var(--success)]" },
  bonus: { sign: "+", cls: "text-[var(--success)]" },
  adjustment: { sign: "+", cls: "text-[var(--fg)]" },
  debit: { sign: "−", cls: "text-[var(--danger)]" },
  reserve: { sign: "−", cls: "text-[var(--warning)]" },
  release: { sign: "+", cls: "text-[var(--warning)]" },
};

/** Append-only history of credits: earnings, spendings, reserves and corrections. */
export function LedgerTab() {
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) =>
    t(`pages.network.${key}`, { defaultValue: fallback });

  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (fromCursor: number, append: boolean) => {
    setLoading(true);
    setError("");
    try {
      const r = await getJson<NetworkLedgerResponse>(
        panel(`network/ledger?cursor=${fromCursor}&limit=100`),
      );
      if (!r.success) throw new Error(r.msg);
      const list = r.obj?.entries ?? [];
      setEntries((prev) => (append ? [...prev, ...list] : list));
      const next = Number(r.obj?.nextCursor ?? 0);
      setCursor(Number.isFinite(next) ? next : 0);
      setHasMore(list.length === 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0, false);
  }, [load]);

  return (
    <Surface>
      {error ? <AlertBanner type="error" title={error} /> : null}
      {entries.length === 0 && !loading ? (
        <div className="py-12 text-center text-sm text-[var(--fg-muted)]">
          {tr("ledgerEmpty", "No ledger entries yet.")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--fg-muted)]">
                <th className="py-2 pr-3 font-medium">{tr("colTime", "Time")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colDirection", "Operation")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colAmount", "Credits")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colVolume", "Traffic")}</th>
                <th className="py-2 pr-3 font-medium">{tr("colCounterparty", "Counterparty")}</th>
                <th className="py-2 font-medium">{tr("colReason", "Reason")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const style = DIRECTION_STYLE[e.direction ?? ""] ?? { sign: "", cls: "" };
                return (
                  <tr key={e.entryUid ?? `${e.ts}-${e.direction}`} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2.5 pr-3 text-xs text-[var(--fg-subtle)] whitespace-nowrap">
                      {formatDateTimeShort(e.ts)}
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      <span className={`font-medium ${style.cls}`}>
                        {style.sign} {e.direction}
                      </span>
                      {e.status === "hold" ? (
                        <span className="ml-1.5 rounded bg-[var(--bg)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">
                          {tr("hold", "hold")}
                        </span>
                      ) : null}
                    </td>
                    <td className={`py-2.5 pr-3 tabular-nums ${style.cls}`}>
                      {style.sign}{formatCredits(e.amountCredits)}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-xs text-[var(--fg-muted)]">
                      {bytesToGB(e.amountBytes).toFixed(2)} GB
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{shortId(e.counterpartyParticipantId)}</td>
                    <td className="py-2.5 text-xs text-[var(--fg-muted)]">
                      {e.reason}{e.memo ? ` — ${e.memo}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasMore ? (
        <div className="mt-4 text-center">
          <Button variant="ghost" onClick={() => void load(cursor, true)} disabled={loading}>
            {tr("loadMore", "Load more")}
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}
