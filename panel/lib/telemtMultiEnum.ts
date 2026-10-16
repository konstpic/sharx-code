/**
 * Pure helpers for Telemt multi-enum parameters (catalog kind "enumlist", e.g. web.carriers):
 * the value is either unset (Telemt default), the literal `false` (feature off), or a
 * non-empty array of unique options whose ORDER is meaningful (try-order).
 */
export type MultiEnumState = "default" | "disabled" | "custom";

export function multiEnumState(value: unknown): MultiEnumState {
  if (value === false) return "disabled";
  if (Array.isArray(value) && value.length > 0) return "custom";
  return "default";
}

/** Selected values as strings, in order; anything that is not a string array yields []. */
export function multiEnumSelected(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

/** Toggle one option: appends at the end when added (order = click order), removes when present.
 *  Removing the last item returns `undefined` (back to default) — an empty array is invalid. */
export function toggleMultiEnum(value: unknown, option: string): unknown {
  const cur = multiEnumSelected(value);
  const next = cur.includes(option) ? cur.filter((x) => x !== option) : [...cur, option];
  return next.length > 0 ? next : undefined;
}

/** 1-based position of option in the selection, or 0 when not selected. */
export function multiEnumPosition(value: unknown, option: string): number {
  return multiEnumSelected(value).indexOf(option) + 1;
}

/** Client-side mirror of the server rule: false, or a non-empty array of unique allowed values. */
export function isValidMultiEnum(value: unknown, options: string[], allowFalse: boolean): boolean {
  if (value === undefined) return true;
  if (value === false) return allowFalse;
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string" || !options.includes(v) || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}
