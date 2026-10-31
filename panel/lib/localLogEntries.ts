export type LogEntry = { source: string; level: string; message: string; ts: number; component?: string; connId?: string };
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export function logLevel(level: string): LogLevel {
  if (level === 'warning') return 'warn';
  return ['debug', 'info', 'warn', 'error'].includes(level) ? level as LogLevel : 'info';
}
/** Same search semantics as the server: all terms required, -term excludes. */
export function queryLocalLogs(entries: LogEntry[], query: { since: number; levels: Set<LogLevel>; components: Set<string>; q: string }) {
  const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = entries.filter(e => e.ts >= query.since && query.levels.has(logLevel(e.level)) &&
    (!query.components.size || query.components.has(e.component || e.source)) &&
    terms.every(term => term.startsWith('-') ? !e.message.toLowerCase().includes(term.slice(1)) : e.message.toLowerCase().includes(term)));
  const buckets = new Map<number, { t: number; debug: number; info: number; warn: number; error: number }>();
  for (const e of matching) {
    const t = Math.floor(e.ts / 60000) * 60000;
    const bucket = buckets.get(t) || { t, debug: 0, info: 0, warn: 0, error: 0 };
    bucket[logLevel(e.level)]++; buckets.set(t, bucket);
  }
  return { entries: [...matching].sort((a,b) => b.ts-a.ts), components: [...new Set(entries.map(e => e.component || e.source))].sort(), volume: [...buckets.values()].sort((a,b) => a.t-b.t), total: matching.length };
}
