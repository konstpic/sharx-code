/** Pure logic of the designer tour: types, task conditions, persistence and card placement. No React, no '@' imports. */

export type LeftTab = "layers" | "add" | "vars" | "style";

/** What the tour can observe about the designer. Primitives only, so it is cheap to compare. */
export type TourSnapshot = {
  left: string;
  device: string;
  selKey: string;
  nodes: number;
  grid: boolean;
  modal: string | null;
  bp: string;
  enabled: boolean;
};

/** What the tour may do to the designer (passed by SubDesigner). */
export type TourApi = {
  setLeft: (l: LeftTab) => void;
  setDevice: (d: "mobile" | "tablet" | "desktop") => void;
  setModal: (m: null | "presets") => void;
  select: (ids: string[]) => void;
};

export type TaskKind = "device" | "nodeAdded" | "selection" | "grid" | "tab:add" | "tab:vars" | "tab:style" | "modal:presets";

/** True when the hands-on action of a step was performed, judged against the snapshot taken when the step began. */
export function taskDone(kind: TaskKind, base: TourSnapshot, cur: TourSnapshot): boolean {
  switch (kind) {
    case "device":
      return cur.device !== base.device;
    case "nodeAdded":
      return cur.nodes > base.nodes;
    case "selection":
      return cur.selKey !== "" && cur.selKey !== base.selKey;
    case "grid":
      return cur.grid !== base.grid;
    case "tab:add":
      return cur.left === "add";
    case "tab:vars":
      return cur.left === "vars";
    case "tab:style":
      return cur.left === "style";
    case "modal:presets":
      return cur.modal === "presets";
    default:
      return false;
  }
}

export type TourStep = {
  id: string;
  /** data-tour value of the element to highlight; without it (or when missing) the card is centered. */
  target?: string;
  /** Tried when `target` is not on screen. */
  fallback?: string;
  icon: string;
  /** Hands-on: the tour advances by itself when this becomes true. */
  task?: TaskKind;
  /** Keep the templates modal open during this step. */
  keepModal?: boolean;
  /** Shows the "What next?" list. */
  next?: boolean;
  prepare?: (api: TourApi, snap: TourSnapshot) => void;
};

export type TourTrack = { id: string; steps: string[] };

export function validateTour(steps: TourStep[], tracks: TourTrack[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) errs.push(`duplicate step ${s.id}`);
    ids.add(s.id);
  }
  const tids = new Set<string>();
  for (const t of tracks) {
    if (tids.has(t.id)) errs.push(`duplicate track ${t.id}`);
    tids.add(t.id);
    if (!t.steps.length) errs.push(`empty track ${t.id}`);
    for (const id of t.steps) if (!ids.has(id)) errs.push(`track ${t.id}: unknown step ${id}`);
  }
  return errs;
}

// ---- persistence

export const TOUR_KEY = "sharx.designerTour.v1";

export type TourStored = { done: boolean; dismissed: boolean; track?: string; step?: number };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function ls(): Store | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Reads the stored state; anything corrupt or unavailable gives the empty state. */
export function readTour(store: Store | null = ls()): TourStored {
  const empty: TourStored = { done: false, dismissed: false };
  try {
    const raw = store?.getItem(TOUR_KEY);
    if (!raw) return empty;
    const j = JSON.parse(raw) as Partial<TourStored> | null;
    if (!j || typeof j !== "object") return empty;
    const out: TourStored = { done: j.done === true, dismissed: j.dismissed === true };
    if (typeof j.track === "string" && typeof j.step === "number" && Number.isFinite(j.step) && j.step >= 0) {
      out.track = j.track;
      out.step = Math.floor(j.step);
    }
    return out;
  } catch {
    return empty;
  }
}

/** Returns false when storage is unavailable. */
export function writeTour(v: TourStored, store: Store | null = ls()): boolean {
  try {
    if (!store) return false;
    store.setItem(TOUR_KEY, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function clearTour(store: Store | null = ls()): void {
  try {
    store?.removeItem(TOUR_KEY);
  } catch {
    /* ignore */
  }
}

/** Auto-start only on the very first visit, and only if we can remember that it happened. */
export function shouldAutoStart(store: Store | null = ls()): boolean {
  if (!store) return false;
  try {
    store.getItem(TOUR_KEY);
  } catch {
    return false;
  }
  const s = readTour(store);
  return !s.done && !s.dismissed && s.track === undefined;
}

// ---- placement

export type Rect = { x: number; y: number; w: number; h: number };

/** Puts the card next to the target inside the viewport: right, left, bottom, top; else inside the target's lower part. */
export function placeCard(target: Rect | null, card: { w: number; h: number }, vp: { w: number; h: number }, pad = 12, gap = 14): { x: number; y: number } {
  const clampX = (x: number) => Math.max(pad, Math.min(x, vp.w - card.w - pad));
  const clampY = (y: number) => Math.max(pad, Math.min(y, vp.h - card.h - pad));
  if (!target) return { x: clampX((vp.w - card.w) / 2), y: clampY((vp.h - card.h) / 2) };
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const fits = (x: number, y: number) => x >= pad && y >= pad && x + card.w <= vp.w - pad && y + card.h <= vp.h - pad;
  const cands: Array<[number, number]> = [
    [target.x + target.w + gap, cy - card.h / 2],
    [target.x - card.w - gap, cy - card.h / 2],
    [cx - card.w / 2, target.y + target.h + gap],
    [cx - card.w / 2, target.y - card.h - gap],
  ];
  // Prefer bottom/top for wide, short targets (toolbar), sides for tall ones.
  const order = target.h <= 64 || target.w > target.h * 1.5 ? [2, 3, 0, 1] : [0, 1, 2, 3];
  for (const i of order) {
    const [x, y] = cands[i];
    if (fits(x, y)) return { x, y };
    // allow sliding along the free axis
    if (i < 2 && x >= pad && x + card.w <= vp.w - pad) return { x, y: clampY(y) };
    if (i >= 2 && y >= pad && y + card.h <= vp.h - pad) return { x: clampX(x), y };
  }
  return { x: clampX(cx - card.w / 2), y: clampY(target.y + target.h - card.h - 16) };
}
