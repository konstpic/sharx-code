export type Rec = Record<string, unknown>;
export type Path = (string | number)[];

export function isRec(v: unknown): v is Rec {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function getPath(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (typeof k === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[k];
    } else {
      if (!isRec(cur)) return undefined;
      cur = cur[k];
    }
  }
  return cur;
}

/**
 * Immutable set. `undefined` deletes the key. Missing containers are created (arrays when the
 * next path segment is a number). Empty objects left behind by a delete are pruned so JSON stays clean.
 */
export function setPath(root: Rec, path: Path, value: unknown): Rec {
  if (path.length === 0) return root;
  const [head, ...rest] = path;
  const key = head as string;
  const child = root[key];
  if (rest.length === 0) {
    const next: Rec = { ...root };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  }
  const nextKey = rest[0]!;
  let nextChild: unknown;
  if (typeof nextKey === "number") {
    const arr = Array.isArray(child) ? child.slice() : [];
    const item = arr[nextKey];
    const inner = rest.slice(1);
    if (inner.length === 0) {
      if (value === undefined) arr.splice(nextKey, 1);
      else arr[nextKey] = value;
    } else {
      const updated = setPath(isRec(item) ? item : {}, inner, value);
      if (value === undefined && Object.keys(updated).length === 0) arr.splice(nextKey, 1);
      else arr[nextKey] = updated;
    }
    nextChild = arr;
  } else {
    nextChild = setPath(isRec(child) ? child : {}, rest, value);
  }
  const next: Rec = { ...root, [key]: nextChild };
  const emptied =
    value === undefined &&
    ((isRec(nextChild) && Object.keys(nextChild).length === 0) || (Array.isArray(nextChild) && nextChild.length === 0));
  if (emptied) delete next[key];
  return next;
}

export function strAt(root: unknown, path: Path, fallback = ""): string {
  const v = getPath(root, path);
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}

export function boolAt(root: unknown, path: Path): boolean {
  return getPath(root, path) === true;
}

export function listAt(root: unknown, path: Path): string[] {
  const v = getPath(root, path);
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v) return [v];
  return [];
}
