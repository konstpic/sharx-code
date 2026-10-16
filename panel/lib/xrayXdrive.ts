/**
 * XDRIVE transport (remote-storage based) for Xray >= 26.9.30.
 * `streamSettings.network = "xdrive"` + `xdriveSettings`, fields from infra/conf/transport_method.go (XDriveConfig, v26.10.10).
 */

export const XDRIVE_SERVICES = ["Google Drive", "template", "local"] as const;
export type XdriveService = (typeof XDRIVE_SERVICES)[number];

/** Optional numeric knobs; 0 / omitted means "use the Xray default". */
export const XDRIVE_NUMERIC_FIELDS = [
  { key: "segmentBytes", def: "512 KiB, max 16 MiB" },
  { key: "flushIntervalMs", def: "20" },
  { key: "pollIntervalMs", def: "50" },
  { key: "maxPollIntervalMs", def: "500" },
  { key: "sessionTtlSeconds", def: "300" },
  { key: "concurrency", def: "8, max 64" },
  { key: "eagerWindowMs", def: "2000" },
  { key: "holeTimeoutMs", def: "30000" },
] as const;

/**
 * Shape taken from the Xray-core tests (transport/internet/xdrive/template_test.go): auth.type is one of
 * none | static | basic | oauth2; URLs may use {folder}, {name}, {secret0..N}; {token} after oauth2.
 */
export const XDRIVE_TEMPLATE_EXAMPLE = {
  flatten: true,
  auth: { type: "static", header: { Authorization: "Bearer {secret0}" } },
  put: { method: "PUT", url: "https://storage.example.com/{folder}/{name}" },
  get: { method: "GET", url: "https://storage.example.com/{folder}/{name}" },
  delete: { method: "DELETE", url: "https://storage.example.com/{folder}/{name}" },
  list: { method: "GET", url: "https://storage.example.com/{folder}/", namesRegex: '"name":"([^"]+)"' },
  retry: { status: [429, 500, 502, 503] },
};

export type XdriveIssueCode =
  | "folderMissing"
  | "serviceUnsupported"
  | "driveSecrets"
  | "templateMissing"
  | "templateInvalid"
  | "templateOps"
  | "templateRegex"
  | "numberInvalid";
export type XdriveIssue = { code: XdriveIssueCode; detail?: string };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

export function defaultXdriveSettings(service: XdriveService = "Google Drive"): Rec {
  const base: Rec = { remoteFolder: "xray", service };
  if (service === "Google Drive") base.secrets = ["", "", ""];
  if (service === "template") base.template = XDRIVE_TEMPLATE_EXAMPLE;
  return base;
}

/** Mirrors XDriveConfig.Build() plus the template checks of newTemplateStorage(). */
export function validateXdriveSettings(xs: unknown): XdriveIssue[] {
  if (!isRec(xs)) return [];
  const out: XdriveIssue[] = [];
  if (typeof xs.remoteFolder !== "string" || !xs.remoteFolder.trim()) out.push({ code: "folderMissing" });
  const service = typeof xs.service === "string" ? xs.service : "";
  if (!(XDRIVE_SERVICES as readonly string[]).includes(service)) {
    out.push({ code: "serviceUnsupported", detail: service });
  }
  if (service === "Google Drive") {
    const secrets = Array.isArray(xs.secrets) ? xs.secrets : [];
    if (secrets.length !== 3 || secrets.some((s) => typeof s !== "string" || !s.trim())) out.push({ code: "driveSecrets" });
  }
  if (service === "template") {
    let tpl: unknown = xs.template;
    if (typeof tpl === "string") {
      try {
        tpl = JSON.parse(tpl);
      } catch {
        out.push({ code: "templateInvalid" });
        tpl = null;
      }
    }
    if (tpl === undefined || tpl === "" || (tpl === null && !out.some((i) => i.code === "templateInvalid"))) {
      out.push({ code: "templateMissing" });
    } else if (isRec(tpl)) {
      for (const op of ["put", "get", "list", "delete"]) {
        const o = tpl[op];
        if (!isRec(o) || typeof o.url !== "string" || !o.url) out.push({ code: "templateOps", detail: op });
      }
      const list = isRec(tpl.list) ? tpl.list : {};
      const rx = typeof list.namesRegex === "string" ? list.namesRegex : "";
      if (!rx) out.push({ code: "templateRegex", detail: "namesRegex is empty" });
      else {
        try {
          // JS and Go (RE2) syntax differ slightly, but a hard syntax error is reported by both.
          const groups = new RegExp(`${rx}|`).exec("")?.length ?? 1;
          if (groups < 2) out.push({ code: "templateRegex", detail: "namesRegex needs one capture group" });
        } catch {
          out.push({ code: "templateRegex", detail: "namesRegex does not compile" });
        }
      }
    }
  }
  for (const { key } of XDRIVE_NUMERIC_FIELDS) {
    const v = xs[key];
    if (v !== undefined && (typeof v !== "number" || !Number.isInteger(v) || v < 0)) out.push({ code: "numberInvalid", detail: key });
  }
  return out;
}

export function describeXdriveIssue(i: XdriveIssue): string {
  const d = i.detail ? ` (${i.detail})` : "";
  switch (i.code) {
    case "folderMissing":
      return '"remoteFolder" is empty';
    case "serviceUnsupported":
      return `unsupported "service"${d}; use "Google Drive" or "template"`;
    case "driveSecrets":
      return 'Google Drive needs 3 secrets in order: ClientID, ClientSecret, RefreshToken';
    case "templateMissing":
      return 'service "template" needs a "template" object';
    case "templateInvalid":
      return '"template" is not valid JSON';
    case "templateOps":
      return `template needs "put", "get", "list" and "delete" operations with a url${d}`;
    case "templateRegex":
      return `template list${d}`;
    case "numberInvalid":
      return `${i.detail ?? "value"} must be a non-negative integer`;
  }
}
