/** A simple two/three-stop linear gradient: parse from and build to a CSS `linear-gradient(...)` string. */
export type GradStop = { color: string; pos: number };
export type Grad = { angle: number; stops: GradStop[] };

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function isGradient(v: string | undefined): boolean {
  return !!v && /^(repeating-)?(linear|radial|conic)-gradient\(/i.test(v.trim());
}

/** Returns null when the value is not a plain `linear-gradient(<n>deg, color pos%, ...)` of 2-3 stops. */
export function parseGradient(v: string | undefined): Grad | null {
  if (!v) return null;
  const m = /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,([\s\S]*)\)$/i.exec(v.trim());
  if (!m) return null;
  const parts = splitTop(m[2]);
  if (parts.length < 2 || parts.length > 3) return null;
  const stops: GradStop[] = [];
  for (let i = 0; i < parts.length; i++) {
    const pm = /^([\s\S]*?)(?:\s+(-?\d+(?:\.\d+)?)%)?$/.exec(parts[i]);
    const color = pm?.[1]?.trim();
    if (!color) return null;
    stops.push({ color, pos: pm?.[2] !== undefined ? Number(pm[2]) : Math.round((i / (parts.length - 1)) * 100) });
  }
  return { angle: Number(m[1]), stops };
}

export function buildGradient(g: Grad): string {
  const a = Math.round(((g.angle % 360) + 360) % 360);
  return `linear-gradient(${a}deg, ${g.stops.map((s) => `${s.color} ${Math.min(100, Math.max(0, Math.round(s.pos)))}%`).join(", ")})`;
}

export function defaultGradient(from?: string): Grad {
  return { angle: 135, stops: [{ color: from && !isGradient(from) ? from : "var(--sub-accent, #22d3ee)", pos: 0 }, { color: "var(--sub-accent-ambient, #9775fa)", pos: 100 }] };
}
