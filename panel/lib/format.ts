const ONE_GB = 1073741824;

export function sizeFormat(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let b = bytes;
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}

// Adaptive unit (bps..Gbps): real-time speeds of idle-ish clients are in the Kbps range,
// and "0.00 Mbps" hides them entirely.
export function speedMbpsFormat(bitsPerSecond: number): string {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return "0 Kbps";
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let v = bitsPerSecond;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function toFixed(n: number, d: number) {
  return Number(n).toFixed(d);
}

export function formatSecond(s: number): string {
  if (!s || s < 0) return "0s";
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

/**
 * Go/GORM often serializes `createdAt` / `updatedAt` as Unix seconds; other fields may be ms.
 * Values under 1e12 are treated as seconds and converted to ms for `Date`.
 */
export function panelTimestampToMs(t: number | undefined | null): number | undefined {
  if (t == null || t === 0) return undefined;
  if (!Number.isFinite(t)) return undefined;
  if (t > 0 && t < 1_000_000_000_000) return Math.round(t * 1000);
  return t;
}

/**
 * Normalize `datetime-local` input: after date-only selection, browsers often leave time empty.
 * Appends `T00:00` (v1.4.9 behavior) instead of leaving partial values.
 */
export function normalizeDatetimeLocalInput(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00`;
  if (/^\d{4}-\d{2}-\d{2}T$/.test(v)) return `${v}00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(v)) return `${v}:00`;
  return v;
}

export { ONE_GB };
