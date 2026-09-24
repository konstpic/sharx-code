/** Mirrors `entity.AllSetting` JSON from `POST /panel/setting/all`. */

export type AllSetting = {
  webListen: string;
  webDomain: string;
  webPort: number;
  webCertFile: string;
  webKeyFile: string;
  webBasePath: string;
  sessionMaxAge: number;
  pageSize: number;
  expireDiff: number;
  trafficDiff: number;
  remarkModel: string;
  datepicker: string;
  tgBotEnable: boolean;
  tgBotToken: string;
  tgBotProxy: string;
  tgBotAPIServer: string;
  tgBotChatId: string;
  tgRunTime: string;
  tgBotBackup: boolean;
  tgBotLoginNotify: boolean;
  tgCpu: number;
  tgLang: string;
  timeLocation: string;
  twoFactorEnable: boolean;
  twoFactorToken: string;
  twoFactorTelegram: boolean;
  tgTwoFactorEnable: boolean;
  subEnable: boolean;
  subJsonEnable: boolean;
  subTitle: string;
  subListen: string;
  subPort: number;
  subPath: string;
  subDomain: string;
  subCertFile: string;
  subKeyFile: string;
  subUpdates: number;
  externalTrafficInformEnable: boolean;
  externalTrafficInformURI: string;
  subEncrypt: boolean;
  subShowInfo: boolean;
  subURI: string;
  subPageURI: string;
  subJsonPath: string;
  subJsonURI: string;
  subJsonFragment: string;
  subJsonNoises: string;
  subJsonMux: string;
  subJsonRules: string;
  subHeaders: string;
  subProviderID: string;
  subProviderIDMethod: string;
  subPageTheme: string;
  subPageLogoUrl: string;
  subPageBrandText: string;
  subPageBackgroundUrl: string;
  ldapEnable: boolean;
  ldapHost: string;
  ldapPort: number;
  ldapUseTLS: boolean;
  ldapBindDN: string;
  ldapPassword: string;
  ldapBaseDN: string;
  ldapUserFilter: string;
  ldapUserAttr: string;
  ldapVlessField: string;
  ldapSyncCron: string;
  ldapFlagField: string;
  ldapTruthyValues: string;
  ldapInvertFlag: boolean;
  ldapInboundTags: string;
  ldapAutoCreate: boolean;
  ldapAutoDelete: boolean;
  ldapDefaultTotalGB: number;
  ldapDefaultExpiryDays: number;
  ldapDefaultLimitIP: number;
  multiNodeMode: boolean;
  enableIPv6: boolean;
  /** Seconds between worker stats polls (multi-node). */
  nodeStatsCollectionIntervalSec: number;
  /** Seconds between GET /health when node is online. */
  nodeHealthCheckIntervalSec: number;
  /** Seconds between GET /health when node is offline/error (until recovery). */
  nodeHealthCheckDegradedIntervalSec: number;
  ipLimitGlobalEnable: boolean;
  ipLimitCheckIntervalSec: number;
  ipLimitBanDurationSec: number;
  ipLimitEnforcement: string;
  ipLimitExcessPolicy: string;
  hwidMode: string;
  grafanaLokiUrl: string;
  grafanaVictoriaMetricsUrl: string;
  grafanaEnable: boolean;
  panelLogLevel: string;
  logRotateMaxSizeMB: number;
  logRotateMaxAgeDays: number;
  logRotateMaxBackups: number;
  logRotateCompress: boolean;
  geofileAutoUpdateEnable: boolean;
  geofileAutoUpdateIntervalHours: number;
  /** How many old (inactive) revisions of each geofile type to keep before auto-pruning. */
  geofileRetentionCount: number;
  /** Session IP must have been seen within this many seconds to count toward the IP limit. */
  ipLimitRecencyWindowSec: number;
  subAppGateEnable: boolean;
  subAppGateRequireKnownApp: boolean;
  /** Comma-separated app keys (see sub.UAClient.Key() on the backend), e.g. "incy". */
  subAppGateBlockedApps: string;
  subAppGateAllowedApps: string;
};

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  return false;
}

function toInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function toStr(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
}

/** Coerce API `obj` (mixed number/string/bool) into a typed `AllSetting`. */
export function normalizeAllSetting(raw: Record<string, unknown>): AllSetting {
  return {
    webListen: toStr(raw.webListen),
    webDomain: toStr(raw.webDomain),
    webPort: toInt(raw.webPort, 2053),
    webCertFile: toStr(raw.webCertFile),
    webKeyFile: toStr(raw.webKeyFile),
    webBasePath: toStr(raw.webBasePath, "/"),
    sessionMaxAge: toInt(raw.sessionMaxAge, 360),
    pageSize: toInt(raw.pageSize, 25),
    expireDiff: toInt(raw.expireDiff, 0),
    trafficDiff: toInt(raw.trafficDiff, 0),
    remarkModel: toStr(raw.remarkModel, "-ieo"),
    datepicker: toStr(raw.datepicker, "gregorian"),
    tgBotEnable: toBool(raw.tgBotEnable),
    tgBotToken: toStr(raw.tgBotToken),
    tgBotProxy: toStr(raw.tgBotProxy),
    tgBotAPIServer: toStr(raw.tgBotAPIServer),
    tgBotChatId: toStr(raw.tgBotChatId),
    tgRunTime: toStr(raw.tgRunTime, "@daily"),
    tgBotBackup: toBool(raw.tgBotBackup),
    tgBotLoginNotify: toBool(raw.tgBotLoginNotify),
    tgCpu: toInt(raw.tgCpu, 80),
    tgLang: toStr(raw.tgLang, "en-US"),
    timeLocation: toStr(raw.timeLocation, "Local"),
    twoFactorEnable: toBool(raw.twoFactorEnable),
    twoFactorToken: toStr(raw.twoFactorToken),
    twoFactorTelegram: toBool(raw.twoFactorTelegram),
    tgTwoFactorEnable: toBool(raw.tgTwoFactorEnable),
    subEnable: toBool(raw.subEnable),
    subJsonEnable: toBool(raw.subJsonEnable),
    subTitle: toStr(raw.subTitle),
    subListen: toStr(raw.subListen),
    subPort: toInt(raw.subPort, 2096),
    subPath: toStr(raw.subPath, "/sub/"),
    subDomain: toStr(raw.subDomain),
    subCertFile: toStr(raw.subCertFile),
    subKeyFile: toStr(raw.subKeyFile),
    subUpdates: toInt(raw.subUpdates, 12),
    externalTrafficInformEnable: toBool(raw.externalTrafficInformEnable),
    externalTrafficInformURI: toStr(raw.externalTrafficInformURI),
    subEncrypt: toBool(raw.subEncrypt),
    subShowInfo: toBool(raw.subShowInfo),
    subURI: toStr(raw.subURI),
    subPageURI: toStr(raw.subPageURI),
    subJsonPath: toStr(raw.subJsonPath, "/json/"),
    subJsonURI: toStr(raw.subJsonURI),
    subJsonFragment: toStr(raw.subJsonFragment),
    subJsonNoises: toStr(raw.subJsonNoises),
    subJsonMux: toStr(raw.subJsonMux),
    subJsonRules: toStr(raw.subJsonRules),
    subHeaders: toStr(raw.subHeaders, "{}"),
    subProviderID: toStr(raw.subProviderID),
    subProviderIDMethod: toStr(raw.subProviderIDMethod, "url"),
    subPageTheme: toStr(raw.subPageTheme),
    subPageLogoUrl: toStr(raw.subPageLogoUrl),
    subPageBrandText: toStr(raw.subPageBrandText),
    subPageBackgroundUrl: toStr(raw.subPageBackgroundUrl),
    ldapEnable: toBool(raw.ldapEnable),
    ldapHost: toStr(raw.ldapHost),
    ldapPort: toInt(raw.ldapPort, 389),
    ldapUseTLS: toBool(raw.ldapUseTLS),
    ldapBindDN: toStr(raw.ldapBindDN),
    ldapPassword: toStr(raw.ldapPassword),
    ldapBaseDN: toStr(raw.ldapBaseDN),
    ldapUserFilter: toStr(raw.ldapUserFilter, "(objectClass=person)"),
    ldapUserAttr: toStr(raw.ldapUserAttr, "mail"),
    ldapVlessField: toStr(raw.ldapVlessField, "vless_enabled"),
    ldapSyncCron: toStr(raw.ldapSyncCron, "@every 1m"),
    ldapFlagField: toStr(raw.ldapFlagField),
    ldapTruthyValues: toStr(raw.ldapTruthyValues, "true,1,yes,on"),
    ldapInvertFlag: toBool(raw.ldapInvertFlag),
    ldapInboundTags: toStr(raw.ldapInboundTags),
    ldapAutoCreate: toBool(raw.ldapAutoCreate),
    ldapAutoDelete: toBool(raw.ldapAutoDelete),
    ldapDefaultTotalGB: toInt(raw.ldapDefaultTotalGB, 0),
    ldapDefaultExpiryDays: toInt(raw.ldapDefaultExpiryDays, 0),
    ldapDefaultLimitIP: toInt(raw.ldapDefaultLimitIP, 0),
    multiNodeMode: toBool(raw.multiNodeMode),
    enableIPv6: toBool(raw.enableIPv6),
    nodeStatsCollectionIntervalSec: toInt(raw.nodeStatsCollectionIntervalSec, 3),
    nodeHealthCheckIntervalSec: toInt(raw.nodeHealthCheckIntervalSec, 15),
    nodeHealthCheckDegradedIntervalSec: toInt(raw.nodeHealthCheckDegradedIntervalSec, 5),
    ipLimitGlobalEnable: toBool(raw.ipLimitGlobalEnable !== undefined ? raw.ipLimitGlobalEnable : true),
    ipLimitCheckIntervalSec: toInt(raw.ipLimitCheckIntervalSec, 30),
    ipLimitBanDurationSec: toInt(raw.ipLimitBanDurationSec, 3600),
    ipLimitEnforcement: toStr(raw.ipLimitEnforcement, "drop_and_block"),
    ipLimitExcessPolicy: toStr(raw.ipLimitExcessPolicy, "newest"),
    hwidMode: toStr(raw.hwidMode, "client_header"),
    grafanaLokiUrl: toStr(raw.grafanaLokiUrl),
    grafanaVictoriaMetricsUrl: toStr(raw.grafanaVictoriaMetricsUrl),
    grafanaEnable: toBool(raw.grafanaEnable),
    panelLogLevel: toStr(raw.panelLogLevel, "info"),
    logRotateMaxSizeMB: toInt(raw.logRotateMaxSizeMB, 50),
    logRotateMaxAgeDays: toInt(raw.logRotateMaxAgeDays, 14),
    logRotateMaxBackups: toInt(raw.logRotateMaxBackups, 5),
    logRotateCompress: toBool(raw.logRotateCompress !== undefined ? raw.logRotateCompress : true),
    geofileAutoUpdateEnable: toBool(raw.geofileAutoUpdateEnable),
    geofileAutoUpdateIntervalHours: toInt(raw.geofileAutoUpdateIntervalHours, 24),
    geofileRetentionCount: toInt(raw.geofileRetentionCount, 5),
    ipLimitRecencyWindowSec: toInt(raw.ipLimitRecencyWindowSec, 600),
    subAppGateEnable: toBool(raw.subAppGateEnable),
    subAppGateRequireKnownApp: toBool(raw.subAppGateRequireKnownApp),
    subAppGateBlockedApps: toStr(raw.subAppGateBlockedApps),
    subAppGateAllowedApps: toStr(raw.subAppGateAllowedApps),
  };
}
