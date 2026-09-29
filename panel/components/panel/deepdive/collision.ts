import * as THREE from "three";

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  active: boolean;
  /** Blocks movement but lets bullets pass (low cover). */
  lowCover?: boolean;
}

export function makeBox(cx: number, cz: number, w: number, d: number): Box {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, active: true };
}

/** Push a circle out of all active boxes. Returns true if anything was hit. */
export function resolveCircle(pos: THREE.Vector3, r: number, boxes: Box[]): boolean {
  let hit = false;
  for (let iter = 0; iter < 2; iter++) {
    for (const b of boxes) {
      if (!b.active) continue;
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      let dx = pos.x - cx;
      let dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * r;
        pos.z = cz + (dz / d) * r;
      } else {
        const l = pos.x - b.minX;
        const rr = b.maxX - pos.x;
        const t = pos.z - b.minZ;
        const bt = b.maxZ - pos.z;
        const m = Math.min(l, rr, t, bt);
        if (m === l) pos.x = b.minX - r;
        else if (m === rr) pos.x = b.maxX + r;
        else if (m === t) pos.z = b.minZ - r;
        else pos.z = b.maxZ + r;
        dx = 0;
        dz = 0;
      }
    }
  }
  return hit;
}

export function pointInBoxes(x: number, z: number, boxes: Box[], pad = 0, ignoreLow = false): Box | null {
  for (const b of boxes) {
    if (!b.active || (ignoreLow && b.lowCover)) continue;
    if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return b;
  }
  return null;
}

/** Slab test; returns the entry parameter t in [0,1] or null. */
export function segmentHitsBox(ax: number, az: number, bx: number, bz: number, b: Box): number | null {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  const slab = (p: number, d: number, mn: number, mx: number): boolean => {
    if (Math.abs(d) < 1e-9) return p >= mn && p <= mx;
    let a = (mn - p) / d;
    let c = (mx - p) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    return t0 <= t1;
  };
  if (!slab(ax, dx, b.minX, b.maxX)) return null;
  if (!slab(az, dz, b.minZ, b.maxZ)) return null;
  return t0;
}

/** First blocking hit along the segment (ignoring low cover if asked). */
export function segmentFirstHit(ax: number, az: number, bx: number, bz: number, boxes: Box[], ignoreLow = false): number | null {
  let best: number | null = null;
  for (const b of boxes) {
    if (!b.active || (ignoreLow && b.lowCover)) continue;
    const t = segmentHitsBox(ax, az, bx, bz, b);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}
