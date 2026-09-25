/**
 * Which section help modals this browser has already shown for the current release. A big release bumps
 * HELP_REVISION: every section then opens its help once on the first visit, and stays quiet afterwards.
 */
export const HELP_REVISION = "1.11";

const KEY = "sharx.helpSeen";

type Stored = { rev: string; sections: string[] };

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Stored>;
      if (v && v.rev === HELP_REVISION && Array.isArray(v.sections)) return { rev: v.rev, sections: v.sections.map(String) };
    }
  } catch {
    /* private mode or corrupt value: treat as nothing seen */
  }
  return { rev: HELP_REVISION, sections: [] };
}

/** True when the help for this section was already shown in the current revision. Without storage it counts as seen, so nothing pops up on every visit. */
export function helpSeen(section: string): boolean {
  try {
    window.localStorage.getItem(KEY);
  } catch {
    return true;
  }
  return read().sections.includes(section);
}

export function markHelpSeen(section: string): void {
  try {
    const cur = read();
    if (!cur.sections.includes(section)) cur.sections.push(section);
    window.localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}
