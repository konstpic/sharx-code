import { ONE_GB, panelTimestampToMs } from "@/lib/format";

/** Preserve microcredit precision while keeping at least two decimal places. */
export function formatCredits(v: number | undefined | null): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false });
}

/** Traffic counters already arrive in GB from the coordinator. */
export function formatGB(v: number | undefined | null): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}

export function bytesToGB(bytes: number | undefined | null): number {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / ONE_GB;
}

/** Short, human-readable peer/counterparty reference: first 8 chars of the UUID. */
export function shortId(id: string | undefined | null): string {
  const s = (id ?? "").trim();
  if (!s) return "—";
  return s.slice(0, 8);
}

/** ISO country code ("DE") → flag emoji ("🇩🇪"); empty/garbage → neutral globe. */
export function countryFlag(code: string | undefined | null): string {
  const c = (code ?? "").trim().toUpperCase();
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return "🌐";
  return String.fromCodePoint(
    ...[...c].map((ch) => 127397 + ch.charCodeAt(0)),
  );
}

/** Unix seconds or ms → locale date-time; undefined/0 → em dash. */
export function formatDateTime(ts: number | undefined | null): string {
  const ms = panelTimestampToMs(ts ?? undefined);
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function formatDateTimeShort(ts: number | undefined | null): string {
  const ms = panelTimestampToMs(ts ?? undefined);
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
