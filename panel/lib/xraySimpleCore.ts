import { lanAccessAllowed, lanAccessAvailable, withLanAccess } from "./xrayLanAccess";

/**
 * Read/patch a small subset of Xray template JSON for a beginner-friendly UI.
 */

const DEFAULT_API_TAG = "api";
const API_SERVICE_NAMES = [
  "HandlerService",
  "LoggerService",
  "StatsService",
] as const;

export type XraySimpleCore = {
  loglevel: string;
  /** Xray "access" log: "none" or a file path */
  access: string;
  /** error log path; "" or "none" are valid */
  error: string;
  dnsLog: boolean;
  maskAddress: string;
  domainStrategy: string;
  /** gRPC API `tag` (dokodemo-door inbound with same tag) */
  apiTag: string;
  apiHandlerService: boolean;
  apiLoggerService: boolean;
  apiStatsService: boolean;
  policyLevel0StatsUserUplink: boolean;
  policyLevel0StatsUserDownlink: boolean;
  policySystemStatsInboundUplink: boolean;
  policySystemStatsInboundDownlink: boolean;
  policySystemStatsOutboundUplink: boolean;
  policySystemStatsOutboundDownlink: boolean;
  /** Clients may reach private (LAN) addresses through the `direct` outbound. */
  allowPrivateNetworks: boolean;
  /** The template has a `direct` freedom outbound, so the option can be applied. */
  allowPrivateNetworksAvailable: boolean;
};

const DEFAULT_LOG = {
  access: "none",
  dnsLog: false,
  error: "",
  loglevel: "warning",
  maskAddress: "",
} as const;

const DEFAULT_POLICY: {
  policyLevel0StatsUserUplink: boolean;
  policyLevel0StatsUserDownlink: boolean;
  policySystemStatsInboundUplink: boolean;
  policySystemStatsInboundDownlink: boolean;
  policySystemStatsOutboundUplink: boolean;
  policySystemStatsOutboundDownlink: boolean;
} = {
  policyLevel0StatsUserUplink: true,
  policyLevel0StatsUserDownlink: true,
  policySystemStatsInboundUplink: true,
  policySystemStatsInboundDownlink: true,
  policySystemStatsOutboundUplink: true,
  policySystemStatsOutboundDownlink: true,
};

const LOG_LEVELS = ["debug", "info", "warning", "error", "none"] as const;

const DOMAIN_STRATEGIES = ["AsIs", "IPIfNonMatch", "IPOnDemand"] as const;

export function isKnownLogLevel(v: string): boolean {
  return (LOG_LEVELS as readonly string[]).includes(v);
}

export function isKnownDomainStrategy(v: string): boolean {
  return (DOMAIN_STRATEGIES as readonly string[]).includes(v);
}

function defaultSimpleCoreBase(): XraySimpleCore {
  return {
    ...DEFAULT_LOG,
    maskAddress: "",
    domainStrategy: "AsIs",
    apiTag: DEFAULT_API_TAG,
    apiHandlerService: true,
    apiLoggerService: true,
    apiStatsService: true,
    allowPrivateNetworks: false,
    allowPrivateNetworksAvailable: false,
    ...DEFAULT_POLICY,
  };
}

export function extractSimpleCore(templateStr: string): XraySimpleCore {
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(templateStr) as Record<string, unknown>;
  } catch {
    return defaultSimpleCoreBase();
  }

  let log = DEFAULT_LOG as unknown as Record<string, unknown>;
  const rawLog = root.log;
  if (rawLog && typeof rawLog === "object" && !Array.isArray(rawLog)) {
    log = { ...DEFAULT_LOG, ...(rawLog as Record<string, unknown>) };
  }

  const loglevel =
    typeof log.loglevel === "string" && log.loglevel ? String(log.loglevel) : DEFAULT_LOG.loglevel;
  const access =
    typeof log.access === "string" ? log.access : String(log.access ?? DEFAULT_LOG.access);
  const error = typeof log.error === "string" ? log.error : String(log.error ?? DEFAULT_LOG.error);
  const dnsLog = Boolean(log.dnsLog);
  const maskAddress =
    typeof log.maskAddress === "string"
      ? log.maskAddress
      : String(log.maskAddress ?? DEFAULT_LOG.maskAddress);

  let domainStrategy = "AsIs";
  const rawR = root.routing;
  if (rawR && typeof rawR === "object" && !Array.isArray(rawR)) {
    const ds = (rawR as Record<string, unknown>).domainStrategy;
    if (typeof ds === "string" && ds) domainStrategy = ds;
  }

  let apiTag = DEFAULT_API_TAG;
  let apiHandlerService = true;
  let apiLoggerService = true;
  let apiStatsService = true;
  const rawApi = root.api;
  if (rawApi && typeof rawApi === "object" && !Array.isArray(rawApi)) {
    const ao = rawApi as Record<string, unknown>;
    if (typeof ao.tag === "string" && ao.tag.trim()) apiTag = ao.tag;
    const sv = ao.services;
    if (Array.isArray(sv)) {
      const set = new Set(sv.map((x) => String(x)));
      apiHandlerService = set.has("HandlerService");
      apiLoggerService = set.has("LoggerService");
      apiStatsService = set.has("StatsService");
    }
  }

  const pol = { ...DEFAULT_POLICY };
  const rawPolicy = root.policy;
  if (rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)) {
    const p = rawPolicy as Record<string, unknown>;
    const sys = p.system;
    if (sys && typeof sys === "object" && !Array.isArray(sys)) {
      const s = sys as Record<string, unknown>;
      if (typeof s.statsInboundUplink === "boolean") {
        pol.policySystemStatsInboundUplink = s.statsInboundUplink;
      }
      if (typeof s.statsInboundDownlink === "boolean") {
        pol.policySystemStatsInboundDownlink = s.statsInboundDownlink;
      }
      if (typeof s.statsOutboundUplink === "boolean") {
        pol.policySystemStatsOutboundUplink = s.statsOutboundUplink;
      }
      if (typeof s.statsOutboundDownlink === "boolean") {
        pol.policySystemStatsOutboundDownlink = s.statsOutboundDownlink;
      }
    }
    const levels = p.levels;
    if (levels && typeof levels === "object" && !Array.isArray(levels)) {
      const l0 = (levels as Record<string, unknown>)["0"];
      if (l0 && typeof l0 === "object" && !Array.isArray(l0)) {
        const z = l0 as Record<string, unknown>;
        if (typeof z.statsUserUplink === "boolean") {
          pol.policyLevel0StatsUserUplink = z.statsUserUplink;
        }
        if (typeof z.statsUserDownlink === "boolean") {
          pol.policyLevel0StatsUserDownlink = z.statsUserDownlink;
        }
      }
    }
  }

  return {
    loglevel,
    access,
    error,
    dnsLog,
    maskAddress,
    domainStrategy,
    apiTag,
    apiHandlerService,
    apiLoggerService,
    apiStatsService,
    allowPrivateNetworks: lanAccessAllowed(root),
    allowPrivateNetworksAvailable: lanAccessAvailable(root),
    ...pol,
  };
}

function asLogObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { ...(v as Record<string, unknown>) };
  }
  return {};
}

function asRoutingObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { ...(v as Record<string, unknown>) };
  }
  return {};
}

function asPolicyObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { ...(v as Record<string, unknown>) };
  }
  return {};
}

function asApiObject(v: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    tag: DEFAULT_API_TAG,
    services: [...API_SERVICE_NAMES] as string[],
  };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { ...base, ...(v as Record<string, unknown>) };
  }
  return { ...base };
}

export function patchSimpleCore(templateStr: string, next: Partial<XraySimpleCore>): string {
  const root = JSON.parse(templateStr) as Record<string, unknown>;
  const log = asLogObject(root.log);
  if (next.loglevel !== undefined) log.loglevel = next.loglevel;
  if (next.access !== undefined) log.access = next.access;
  if (next.error !== undefined) log.error = next.error;
  if (next.dnsLog !== undefined) log.dnsLog = next.dnsLog;
  if (next.maskAddress !== undefined) log.maskAddress = next.maskAddress;
  root.log = log;

  if (next.domainStrategy !== undefined) {
    const routing = asRoutingObject(root.routing);
    routing.domainStrategy = next.domainStrategy;
    root.routing = routing;
  }

  const needApi =
    next.apiTag !== undefined ||
    next.apiHandlerService !== undefined ||
    next.apiLoggerService !== undefined ||
    next.apiStatsService !== undefined;
  if (needApi) {
    const cur = extractSimpleCore(templateStr);
    const api = asApiObject(root.api);
    const tag = next.apiTag !== undefined ? next.apiTag.trim() || DEFAULT_API_TAG : cur.apiTag;
    api.tag = tag;
    const h = next.apiHandlerService ?? cur.apiHandlerService;
    const lg = next.apiLoggerService ?? cur.apiLoggerService;
    const st = next.apiStatsService ?? cur.apiStatsService;
    const services: string[] = [];
    if (h) services.push("HandlerService");
    if (lg) services.push("LoggerService");
    if (st) services.push("StatsService");
    api.services = services;
    root.api = api;
  }

  const needPolicy =
    next.policyLevel0StatsUserUplink !== undefined ||
    next.policyLevel0StatsUserDownlink !== undefined ||
    next.policySystemStatsInboundUplink !== undefined ||
    next.policySystemStatsInboundDownlink !== undefined ||
    next.policySystemStatsOutboundUplink !== undefined ||
    next.policySystemStatsOutboundDownlink !== undefined;
  if (needPolicy) {
    const cur = extractSimpleCore(templateStr);
    const policy = asPolicyObject(root.policy);
    let levels = policy.levels;
    if (!levels || typeof levels !== "object" || Array.isArray(levels)) {
      levels = {};
      policy.levels = levels;
    }
    const levelsRec = levels as Record<string, unknown>;
    let z = levelsRec["0"];
    if (!z || typeof z !== "object" || Array.isArray(z)) {
      z = {};
      levelsRec["0"] = z;
    }
    const z0 = z as Record<string, unknown>;
    if (next.policyLevel0StatsUserUplink !== undefined) {
      z0.statsUserUplink = next.policyLevel0StatsUserUplink;
    } else {
      z0.statsUserUplink = cur.policyLevel0StatsUserUplink;
    }
    if (next.policyLevel0StatsUserDownlink !== undefined) {
      z0.statsUserDownlink = next.policyLevel0StatsUserDownlink;
    } else {
      z0.statsUserDownlink = cur.policyLevel0StatsUserDownlink;
    }

    let system = policy.system;
    if (!system || typeof system !== "object" || Array.isArray(system)) {
      system = {};
      policy.system = system;
    }
    const sys = system as Record<string, unknown>;
    const sInU = next.policySystemStatsInboundUplink ?? cur.policySystemStatsInboundUplink;
    const sInD = next.policySystemStatsInboundDownlink ?? cur.policySystemStatsInboundDownlink;
    const sOuU = next.policySystemStatsOutboundUplink ?? cur.policySystemStatsOutboundUplink;
    const sOuD = next.policySystemStatsOutboundDownlink ?? cur.policySystemStatsOutboundDownlink;
    sys.statsInboundUplink = sInU;
    sys.statsInboundDownlink = sInD;
    sys.statsOutboundUplink = sOuU;
    sys.statsOutboundDownlink = sOuD;
    root.policy = policy;
  }

  if (next.allowPrivateNetworks !== undefined) {
    return JSON.stringify(withLanAccess(root, next.allowPrivateNetworks), null, 2);
  }

  return JSON.stringify(root, null, 2);
}
