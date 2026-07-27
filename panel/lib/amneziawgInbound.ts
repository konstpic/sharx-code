/** Form state for protocol `amneziawg` sidecar inbound (AWG 1.x–3.x, legacy-compatible). */
export type AmneziaWgFormState = {
  mtu: number;
  secretKey: string;
  address: string;
  clientDns: string;
  listenPort: number;
  jc: string;
  jmin: string;
  jmax: string;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  /** Single uint or AWG 3 range "x-y". */
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  i1: string;
  i2: string;
  i3: string;
  i4: string;
  i5: string;
  headerProtectionKey: string;
  contentPaddingAddition: string;
  rekeyAfterTime: string;
  rekeyTimeout: string;
  rejectAfterTime: string;
  keepaliveTimeout: string;
  maxHandshakeAttempts: string;
};

export function defaultAmneziaWgInboundForm(): AmneziaWgFormState {
  return {
    mtu: 1420,
    secretKey: "",
    address: "10.8.0.1/24",
    clientDns: "1.1.1.1",
    listenPort: 51820,
    jc: "4",
    jmin: "40",
    jmax: "70",
    s1: "",
    s2: "",
    s3: "",
    s4: "",
    h1: "",
    h2: "",
    h3: "",
    h4: "",
    i1: "",
    i2: "",
    i3: "",
    i4: "",
    i5: "",
    headerProtectionKey: "",
    contentPaddingAddition: "",
    rekeyAfterTime: "",
    rekeyTimeout: "",
    rejectAfterTime: "",
    keepaliveTimeout: "",
    maxHandshakeAttempts: "",
  };
}

export function randomAmneziaWgObfuscationFields(): Pick<
  AmneziaWgFormState,
  "jc" | "jmin" | "jmax" | "s1" | "s2" | "s3" | "s4" | "h1" | "h2" | "h3" | "h4"
> {
  const rand = () => Math.floor(Math.random() * 0x7fffffff) + 1;
  return {
    jc: "4",
    jmin: "40",
    jmax: "70",
    s1: String(50 + Math.floor(Math.random() * 70)),
    s2: String(Math.floor(Math.random() * 40)),
    s3: "",
    s4: "",
    h1: String(rand()),
    h2: String(rand()),
    h3: String(rand()),
    h4: String(rand()),
  };
}

/** Raise S1–S4 to ≥ 8 when HeaderProtectionKey is set (AWG 3 requirement). */
export function ensureAmneziaWgHeaderProtectionPadding(
  w: AmneziaWgFormState,
): AmneziaWgFormState {
  if (!w.headerProtectionKey.trim()) return w;
  const bump = (s: string) => {
    const n = parseInt(s.trim(), 10);
    if (!Number.isFinite(n) || n < 8) return "8";
    return String(n);
  };
  return {
    ...w,
    s1: bump(w.s1),
    s2: bump(w.s2),
    s3: bump(w.s3),
    s4: bump(w.s4),
  };
}

function splitListLinesOrCommas(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pickScalar(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  return "";
}

export function parseAmneziaWgSettingsToForm(settingsStr: string): AmneziaWgFormState {
  const base = defaultAmneziaWgInboundForm();
  try {
    const root = JSON.parse(settingsStr || "{}") as Record<string, unknown>;
    if (typeof root.mtu === "number" && root.mtu > 0) base.mtu = root.mtu;
    if (typeof root.secretKey === "string") base.secretKey = root.secretKey;
    const addr = root.address;
    if (Array.isArray(addr)) {
      const lines = addr
        .map((a) => (typeof a === "string" ? a.trim() : ""))
        .filter(Boolean);
      if (lines.length) base.address = lines.join("\n");
    }
    const cd = root.clientDns;
    if (Array.isArray(cd)) {
      const lines = cd
        .map((a) => (typeof a === "string" ? a.trim() : ""))
        .filter(Boolean);
      if (lines.length) base.clientDns = lines.join("\n");
    }
    const obf =
      root.obfuscation != null && typeof root.obfuscation === "object" && !Array.isArray(root.obfuscation)
        ? (root.obfuscation as Record<string, unknown>)
        : null;
    if (obf) {
      const jc = pickNum(obf.jc);
      if (jc > 0) base.jc = String(jc);
      const jmin = pickNum(obf.jmin);
      if (jmin > 0) base.jmin = String(jmin);
      const jmax = pickNum(obf.jmax);
      if (jmax > 0) base.jmax = String(jmax);
      for (const k of ["s1", "s2", "s3", "s4"] as const) {
        const n = pickNum(obf[k]);
        if (n > 0) base[k] = String(n);
      }
      for (const k of ["h1", "h2", "h3", "h4"] as const) {
        const s = pickScalar(obf[k]);
        if (s) base[k] = s;
      }
      for (const k of ["i1", "i2", "i3", "i4", "i5"] as const) {
        const s = pickScalar(obf[k]);
        if (s) base[k] = s;
      }
      base.headerProtectionKey = pickScalar(obf.headerProtectionKey);
      base.contentPaddingAddition = pickScalar(obf.contentPaddingAddition);
      base.rekeyAfterTime = pickScalar(obf.rekeyAfterTime);
      base.rekeyTimeout = pickScalar(obf.rekeyTimeout);
      base.rejectAfterTime = pickScalar(obf.rejectAfterTime);
      base.keepaliveTimeout = pickScalar(obf.keepaliveTimeout);
      base.maxHandshakeAttempts = pickScalar(obf.maxHandshakeAttempts);
    }
  } catch {
    /* use base */
  }
  return base;
}

export type AmneziaWgInboundApiPayload = {
  mtu: number;
  secretKey: string;
  address: string[];
  clientDns: string[];
  obfuscation: {
    jc: number;
    jmin: number;
    jmax: number;
    s1: number;
    s2: number;
    s3: number;
    s4: number;
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    i1?: string;
    i2?: string;
    i3?: string;
    i4?: string;
    i5?: string;
    headerProtectionKey?: string;
    contentPaddingAddition?: string;
    rekeyAfterTime?: string;
    rekeyTimeout?: string;
    rejectAfterTime?: string;
    keepaliveTimeout?: string;
    maxHandshakeAttempts?: string;
  };
};

export function buildAmneziaWgInboundApiPayload(
  w: AmneziaWgFormState,
): AmneziaWgInboundApiPayload {
  const form = ensureAmneziaWgHeaderProtectionPadding(w);
  const addrs = splitListLinesOrCommas(form.address);
  const mtu = Number.isFinite(form.mtu) && form.mtu > 0 ? form.mtu : 1420;
  const num = (s: string) => {
    const n = parseInt(s.trim(), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const opt = (s: string) => {
    const t = s.trim();
    return t || undefined;
  };
  return {
    mtu,
    secretKey: form.secretKey.trim(),
    address: addrs.length > 0 ? addrs : ["10.8.0.1/24"],
    clientDns: splitListLinesOrCommas(form.clientDns),
    obfuscation: {
      jc: num(form.jc) || 4,
      jmin: num(form.jmin) || 40,
      jmax: num(form.jmax) || 70,
      s1: num(form.s1),
      s2: num(form.s2),
      s3: num(form.s3),
      s4: num(form.s4),
      h1: form.h1.trim(),
      h2: form.h2.trim(),
      h3: form.h3.trim(),
      h4: form.h4.trim(),
      i1: opt(form.i1),
      i2: opt(form.i2),
      i3: opt(form.i3),
      i4: opt(form.i4),
      i5: opt(form.i5),
      headerProtectionKey: opt(form.headerProtectionKey),
      contentPaddingAddition: opt(form.contentPaddingAddition),
      rekeyAfterTime: opt(form.rekeyAfterTime),
      rekeyTimeout: opt(form.rekeyTimeout),
      rejectAfterTime: opt(form.rejectAfterTime),
      keepaliveTimeout: opt(form.keepaliveTimeout),
      maxHandshakeAttempts: opt(form.maxHandshakeAttempts),
    },
  };
}
