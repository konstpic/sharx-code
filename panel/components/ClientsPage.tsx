"use client";

import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Calendar,
  Filter,
  Clock,
  Columns3,
  Copy,
  ExternalLink,
  KeyRound,
  Layers,
  ListChecks,
  Loader2,
  Mail,
  Megaphone,
  Plus,
  Power,
  QrCode,
  RotateCcw,
  Send,
  Shield,
  Smartphone,
  Trash2,
  Unplug,
  User,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Dispatch, ReactNode, SetStateAction, TextareaHTMLAttributes } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import { usePanelWebSocket } from "@/lib/panelWebSocket";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import {
  normalizeDatetimeLocalInput,
  panelTimestampToMs,
  sizeFormat,
  speedMbpsFormat,
} from "@/lib/format";
import { panel } from "@/lib/paths";
import {
  isWgQuickConfProtocol,
  wgQuickConfFromPanelText,
  wireGuardConfFileName,
} from "@/lib/wireguardConf";
import { getUiPref, setUiPref } from "@/lib/uiPrefs";
import { CompareModeFilterField, type CompareOp } from "@/components/CompareModeFilterField";
import { PageScaffold, PageHeader, SectionHelpModal, Surface } from "@/components/panel";
import {
  Button,
  Checkbox,
  CheckboxField,
  ConfirmDialog,
  HelpTooltip,
  IconButton,
  IconTile,
  Input,
  Modal,
  PillTag,
  Reveal,
  SelectNative,
  Spinner,
  Switch,
  useToast,
} from "@/components/ui";

function TextArea({
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-[72px] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] ${className}`}
      {...rest}
    />
  );
}

/** Strip worker HTTP/RPC noise and return inner error text for classification. */
function extractSessionsErrorInner(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^node returned\s+\d+\s*:\s*/i, "").trim();
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) {
        return j.error.trim();
      }
    } catch {
      const m = s.match(/"error"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        try {
          return JSON.parse(`"${m[1]}"`) as string;
        } catch {
          return m[1].replace(/\\"/g, '"').replace(/\\u003e/gi, ">").replace(/\\u003c/gi, "<");
        }
      }
    }
  }
  return s.replace(/\\u003e/gi, ">").replace(/\\u003c/gi, "<");
}

/** True when the backend/node reports no online-session stats — treat as "no IPs", not an error. */
function isSessionsNoOnlineDataError(raw: string): boolean {
  const inner = extractSessionsErrorInner(raw);
  const low = inner.toLowerCase();
  return (
    low.includes("online not found") ||
    (low.includes("notfound") && low.includes("online"))
  );
}

type InboundBrief = {
  id: number;
  remark: string;
  protocol: string;
  port: number;
  tag: string;
};

function cx(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

function SectionLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <IconTile icon={Icon} tone="accent" size="sm" />
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
        {children}
      </span>
    </div>
  );
}

function InboundCapsuleToggle({
  selected,
  onToggle,
  label,
  sublabel,
}: {
  selected: boolean;
  onToggle: () => void;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cx(
        "inline-flex min-w-0 max-w-full flex-col rounded-full border px-3 py-1.5 text-left text-xs transition-colors",
        selected
          ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--fg)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:border-[var(--fg-subtle)]",
      )}
    >
      <span className="truncate font-medium">{label}</span>
      <span className="truncate text-[10px] text-[var(--fg-subtle)]">
        {sublabel}
      </span>
    </button>
  );
}

function formatClientCardExpiry(ms: number | undefined, noExpiry: string, expired: string): string {
  if (ms == null || ms === 0) return noExpiry;
  if (ms <= Date.now()) return expired;
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Unified panel API shape (see model.ClientCardView). */
type ClientCard = {
  id: number;
  name: string;
  enable: boolean;
  status?: string;
  uuid?: string;
  subId?: string;
  up: number;
  down: number;
  /** Cumulative traffic (bytes), when returned by API. */
  allTime?: number;
  totalGB?: number;
  expiryTime?: number;
  inboundIds?: number[];
  inbounds: InboundBrief[];
  subscriptionUrl?: string;
  /** First-party /panel/sub/ page when different from subscriptionUrl (feed). */
  subscriptionPageUrl?: string;
  subscriptionJsonUrl?: string;
  activeHwidCount: number;
  hwidEnabled?: boolean;
  maxHwid?: number;
  hwids?: HwidRow[];
  comment?: string;
  groupId?: number | null;
  tgId?: number;
  reset?: number;
  announce?: string;
  createdAt?: number;
  updatedAt?: number;
  lastOnline?: number;
  lastConnectedNode?: string;
  upSpeed?: number;
  downSpeed?: number;
  /** Present from API: Xray session online (same as admin "online" list). */
  isOnline?: boolean;
};

type ClientsConfirmAction =
  | null
  | { kind: "deleteOne"; client: ClientCard }
  | { kind: "bulkReset"; clients: ClientCard[] }
  | { kind: "bulkClearHwid"; clients: ClientCard[] }
  | { kind: "bulkDelete"; clients: ClientCard[] };

/** How long a client can disappear from the online batch before the UI flips to offline (avoids flicker on sparse WS ticks). */
const OFFLINE_STATUS_DELAY_MS = 5_000;

function normClientName(s: string) {
  return s.trim().toLowerCase();
}

function normalizePanelIp(s: string): string {
  let t = String(s).trim();
  if (t.startsWith("[") && t.includes("]")) {
    const end = t.indexOf("]");
    t = t.slice(1, end);
  }
  const lower = t.toLowerCase();
  return lower.includes(":") ? lower : t;
}

function countActiveHwidsFromPayload(hw: unknown): number {
  if (!Array.isArray(hw)) return 0;
  return hw.filter(
    (h) =>
      h &&
      typeof h === "object" &&
      (h as { isActive?: boolean }).isActive !== false &&
      (h as { blocked?: boolean }).blocked !== true,
  ).length;
}

type WsClientEntity = Record<string, unknown>;

function entityPayloadId(e: WsClientEntity): number | undefined {
  const raw = (e as { id?: unknown; Id?: unknown }).id ?? (e as { Id?: unknown }).Id;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function mergeClientWithEntity(row: ClientCard, e: WsClientEntity): ClientCard {
  const next: ClientCard = { ...row };
  if (typeof e.up === "number") next.up = e.up;
  if (typeof e.down === "number") next.down = e.down;
  if (typeof e.status === "string") next.status = e.status;
  if (typeof e.lastOnline === "number") next.lastOnline = e.lastOnline;
  if (typeof e.lastConnectedNode === "string") next.lastConnectedNode = e.lastConnectedNode;
  if (typeof e.upSpeed === "number") next.upSpeed = e.upSpeed;
  if (typeof e.downSpeed === "number") next.downSpeed = e.downSpeed;
  if (typeof e.enable === "boolean") next.enable = e.enable;
  if (typeof e.totalGB === "number") next.totalGB = e.totalGB;
  if (typeof e.expiryTime === "number") next.expiryTime = e.expiryTime;
  if (Array.isArray(e.inboundIds)) {
    const ids = (e.inboundIds as unknown[]).filter((x): x is number => typeof x === "number");
    if (ids.length) next.inboundIds = ids;
  }
  if (Array.isArray(e.hwids)) {
    next.activeHwidCount = countActiveHwidsFromPayload(e.hwids);
  }
  return next;
}

function findLastOnlineForName(
  name: string,
  lastOnlineMap: Record<string, unknown>
): number | undefined {
  const k = normClientName(name);
  for (const [key, v] of Object.entries(lastOnlineMap)) {
    if (typeof v !== "number") continue;
    if (normClientName(String(key)) === k) return v;
  }
  return undefined;
}

type PillTone = "green" | "blue" | "neutral" | "amber" | "rose";

/** Read-only: one radio line for the current connection state (not a two-option switch). */
function ReadonlyConnectionState({
  legend,
  label,
  groupName,
  activityText,
  isOnline,
}: {
  legend: string;
  label: string;
  groupName: string;
  activityText?: string;
  isOnline: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
        {legend}
      </div>
      <div role="radiogroup" aria-label={groupName}>
        <span
          role="radio"
          aria-checked
          className={
            isOnline
              ? "inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--accent)_50%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg)] shadow-[0_0_0_1px] shadow-[color-mix(in_oklab,var(--accent)_20%,transparent)]"
              : "inline-flex max-w-full items-center gap-1.5 rounded-full border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-700 shadow-[0_0_0_1px] shadow-rose-500/15 dark:text-rose-200 dark:shadow-rose-500/20"
          }
        >
          <span
            className={
              isOnline
                ? "h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[var(--accent)] bg-[var(--accent)]"
                : "h-2.5 w-2.5 shrink-0 rounded-full border-2 border-rose-500 bg-rose-500 shadow-[0_0_0_2px] shadow-rose-500/25 dark:border-rose-400 dark:bg-rose-400"
            }
            aria-hidden
          />
          {label}
        </span>
      </div>
      {activityText ? (
        <div className="text-[11px] text-[var(--fg-subtle)]">{activityText}</div>
      ) : null}
    </div>
  );
}

/** Account state: disabled | active | expired_traffic | expired_time (not connection). */
function clientAccountStateMeta(
  enable: boolean,
  status: string | undefined,
  t: TFunction,
): { tone: PillTone; label: string } {
  if (!enable) {
    return {
      tone: "neutral",
      label: t("pages.clients.stateDisabled", { defaultValue: "Disabled" }),
    };
  }
  const s = (status || "active").toLowerCase();
  if (s === "expired_traffic") {
    return { tone: "amber", label: t("depleted") };
  }
  if (s === "expired_time") {
    return {
      tone: "rose",
      label: t("pages.clients.cardExpired", { defaultValue: "Expired" }),
    };
  }
  return {
    tone: "green",
    label: t("pages.clients.stateActive", { defaultValue: "Active" }),
  };
}

function ClientConnectionStatus({
  isOnline,
  lastOnline,
  t,
}: {
  isOnline?: boolean;
  lastOnline?: number;
  t: TFunction;
}) {
  const activityText = connectionActivityText(lastOnline, t);
  return (
    <span className="inline-flex min-w-0 flex-col gap-0.5">
      <span
        className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium"
        title={isOnline ? t("online") : t("offline")}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isOnline
              ? "bg-emerald-400 shadow-[0_0_0_2px] shadow-emerald-500/30"
              : "bg-rose-500 shadow-[0_0_0_2px] shadow-rose-500/25 dark:bg-rose-400 dark:shadow-rose-400/30"
          }`}
          aria-hidden
        />
        <span
          className={
            isOnline
              ? "text-emerald-600 dark:text-emerald-300"
              : "text-rose-700 dark:text-rose-300"
          }
        >
          {isOnline ? t("online") : t("offline")}
        </span>
      </span>
      {activityText ? (
        <span className="text-[10px] text-[var(--fg-subtle)]">{activityText}</span>
      ) : null}
    </span>
  );
}

/**
 * Live Xray session online. List + WS traffic handler set `isOnline`; the handler keeps
 * true for OFFLINE_STATUS_DELAY_MS after the client drops from the online batch to avoid flicker.
 * "Last seen" wording stays in {@link connectionActivityText} (was-online) without stretching Online.
 */
function clientIsOnlineConsideringLastSeen(r: ClientCard): boolean {
  return r.isOnline === true;
}

function connectionActivityText(
  lastOnline: number | undefined,
  t: TFunction,
): string {
  const lastSeenMs = panelTimestampToMs(lastOnline);
  if (lastSeenMs == null || lastSeenMs <= 0) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000));
  if (diffSec < 10) {
    return t("pages.clients.activity.justNow", { defaultValue: "Seen just now" });
  }
  if (diffSec < 60) {
    return t("pages.clients.activity.secondsAgo", {
      defaultValue: "Seen {{count}} sec ago",
      count: diffSec,
    });
  }
  if (diffSec < 3600) {
    return t("pages.clients.activity.minutesAgo", {
      defaultValue: "Seen {{count}} min ago",
      count: Math.floor(diffSec / 60),
    });
  }
  if (diffSec < 86400) {
    return t("pages.clients.activity.hoursAgo", {
      defaultValue: "Seen {{count}} h ago",
      count: Math.floor(diffSec / 3600),
    });
  }
  return t("pages.clients.activity.daysAgo", {
    defaultValue: "Seen {{count}} d ago",
    count: Math.floor(diffSec / 86400),
  });
}

type SortDir = "asc" | "desc";

/** Table column order (source of truth for header / body / filter row). */
const DATA_COLUMN_ORDER = [
  "id",
  "name",
  "comment",
  "connection",
  "state",
  "traffic",
  "up",
  "down",
  "allTime",
  "totalGb",
  "expiry",
  "lastOnline",
  "lastConnectedNode",
  "createdAt",
  "updatedAt",
  "speed",
  "inbounds",
  "group",
  "uuid",
  "subId",
  "tgId",
  "reset",
  "hwid",
] as const;

type DataColumnId = (typeof DATA_COLUMN_ORDER)[number];
type ClientSortKey = DataColumnId;

type ColumnFilterId = "name" | "comment" | "traffic" | "expiry" | "hwid";

const DEFAULT_COLUMN_FILTERS: Record<ColumnFilterId, string> = {
  name: "",
  comment: "",
  traffic: "",
  expiry: "",
  hwid: "",
};

const DEFAULT_COLUMN_VISIBILITY: Record<DataColumnId, boolean> = {
  id: false,
  name: true,
  comment: false,
  connection: true,
  state: true,
  traffic: true,
  up: false,
  down: false,
  allTime: false,
  totalGb: false,
  expiry: true,
  lastOnline: false,
  lastConnectedNode: true,
  createdAt: false,
  updatedAt: false,
  speed: false,
  inbounds: true,
  group: true,
  uuid: false,
  subId: false,
  tgId: false,
  reset: false,
  hwid: true,
};

function getDataColumnLabel(col: DataColumnId, t: TFunction): string {
  const d: Record<DataColumnId, { key: string; defaultValue: string }> = {
    id: { key: "pages.clients.colId", defaultValue: "ID" },
    name: { key: "pages.clients.name", defaultValue: "Client name" },
    comment: { key: "pages.clients.colComment", defaultValue: "Name" },
    connection: { key: "pages.clients.connectionStatus", defaultValue: "Status" },
    state: { key: "pages.clients.stateColumn", defaultValue: "State" },
    traffic: { key: "pages.clients.traffic", defaultValue: "Traffic" },
    up: { key: "pages.clients.colUp", defaultValue: "Up" },
    down: { key: "pages.clients.colDown", defaultValue: "Down" },
    allTime: { key: "pages.clients.colAllTime", defaultValue: "All-time" },
    totalGb: { key: "pages.clients.colLimitGb", defaultValue: "Limit (GB)" },
    expiry: { key: "pages.clients.expiryTime", defaultValue: "Expiry" },
    lastOnline: { key: "pages.clients.cardLastOnline", defaultValue: "Last online" },
    lastConnectedNode: { key: "pages.clients.lastConnectedNode", defaultValue: "Last connection node" },
    createdAt: { key: "pages.clients.colCreated", defaultValue: "Created" },
    updatedAt: { key: "pages.clients.colUpdated", defaultValue: "Updated" },
    speed: { key: "pages.clients.colSpeed", defaultValue: "Speed (Mbps)" },
    inbounds: { key: "pages.clients.inbounds", defaultValue: "Inbounds" },
    group: { key: "pages.clients.group", defaultValue: "Group" },
    uuid: { key: "pages.clients.colUuid", defaultValue: "UUID" },
    subId: { key: "pages.clients.colSubId", defaultValue: "Sub ID" },
    tgId: { key: "pages.clients.addModalTgId", defaultValue: "Telegram" },
    reset: { key: "pages.clients.colReset", defaultValue: "Reset (d)" },
    hwid: { key: "pages.clients.colHwid", defaultValue: "HWID" },
  };
  const x = d[col];
  return t(x.key, { defaultValue: x.defaultValue });
}

function rowTsForSort(
  r: ClientCard,
  key: "createdAt" | "updatedAt" | "lastOnline",
): number {
  const v = r[key];
  if (v == null || v === 0) return 0;
  return panelTimestampToMs(v) ?? (typeof v === "number" ? v : 0);
}

type FilterConn = "" | "online" | "offline";
type FilterAcct = "" | "disabled" | "active" | "expired_traffic" | "expired_time";

/** v1: only `columnVisibility`. v2: full table UI prefs. */
const CLIENTS_TABLE_PREFS_V = 2 as const;

type ClientsTablePrefsState = {
  columnVisibility: Record<DataColumnId, boolean>;
  columnFilters: Record<ColumnFilterId, string>;
  filtersVisible: boolean;
  filterConn: FilterConn;
  filterAcct: FilterAcct;
  filterInboundId: string;
  filterGroupId: string;
  trafficCompareOp: CompareOp;
  expiryCompareOp: CompareOp;
  sortKey: ClientSortKey;
  sortDir: SortDir;
};

function defaultClientsTablePrefs(): ClientsTablePrefsState {
  return {
    columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY },
    columnFilters: { ...DEFAULT_COLUMN_FILTERS },
    filtersVisible: false,
    filterConn: "",
    filterAcct: "",
    filterInboundId: "",
    filterGroupId: "",
    trafficCompareOp: "",
    expiryCompareOp: "",
    sortKey: "traffic",
    sortDir: "desc",
  };
}

function mergeStoredColumnVisibility(cv: unknown): Record<DataColumnId, boolean> {
  const next = { ...DEFAULT_COLUMN_VISIBILITY };
  if (!cv || typeof cv !== "object" || Array.isArray(cv)) return next;
  const o = cv as Record<string, unknown>;
  for (const col of DATA_COLUMN_ORDER) {
    if (col in o && typeof o[col] === "boolean") next[col] = o[col];
  }
  return next;
}

function mergeStoredColumnFilters(cf: unknown): Record<ColumnFilterId, string> {
  const out = { ...DEFAULT_COLUMN_FILTERS };
  if (!cf || typeof cf !== "object" || Array.isArray(cf)) return out;
  const o = cf as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_COLUMN_FILTERS) as ColumnFilterId[]) {
    if (k in o && typeof o[k] === "string") out[k] = o[k];
  }
  return out;
}

function isFilterConn(s: string): s is FilterConn {
  return s === "" || s === "online" || s === "offline";
}

function isFilterAcct(s: string): s is FilterAcct {
  return (
    s === "" ||
    s === "disabled" ||
    s === "active" ||
    s === "expired_traffic" ||
    s === "expired_time"
  );
}

function isCompareOpStored(s: string): s is CompareOp {
  return s === "" || s === "gt" || s === "lt" || s === "eq";
}

function isClientSortKey(s: string): s is ClientSortKey {
  return (DATA_COLUMN_ORDER as readonly string[]).includes(s);
}

function isSortDirStored(s: string): s is SortDir {
  return s === "asc" || s === "desc";
}

function parseClientsTablePrefs(raw: string | null | undefined): ClientsTablePrefsState {
  try {
    if (!raw) return defaultClientsTablePrefs();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return defaultClientsTablePrefs();
    const p = parsed as Record<string, unknown>;
    const columnVisibility = mergeStoredColumnVisibility(p.columnVisibility);
    const base = defaultClientsTablePrefs();
    const v = p.v;

    if (v === 1) {
      return { ...base, columnVisibility };
    }
    if (v !== CLIENTS_TABLE_PREFS_V) {
      if (p.columnVisibility != null) {
        return { ...base, columnVisibility };
      }
      return defaultClientsTablePrefs();
    }

    return {
      columnVisibility,
      columnFilters: mergeStoredColumnFilters(p.columnFilters),
      filtersVisible:
        typeof p.filtersVisible === "boolean" ? p.filtersVisible : base.filtersVisible,
      filterConn:
        typeof p.filterConn === "string" && isFilterConn(p.filterConn)
          ? p.filterConn
          : base.filterConn,
      filterAcct:
        typeof p.filterAcct === "string" && isFilterAcct(p.filterAcct)
          ? p.filterAcct
          : base.filterAcct,
      filterInboundId:
        typeof p.filterInboundId === "string" ? p.filterInboundId : base.filterInboundId,
      filterGroupId:
        typeof p.filterGroupId === "string" ? p.filterGroupId : base.filterGroupId,
      trafficCompareOp:
        typeof p.trafficCompareOp === "string" && isCompareOpStored(p.trafficCompareOp)
          ? p.trafficCompareOp
          : base.trafficCompareOp,
      expiryCompareOp:
        typeof p.expiryCompareOp === "string" && isCompareOpStored(p.expiryCompareOp)
          ? p.expiryCompareOp
          : base.expiryCompareOp,
      sortKey:
        typeof p.sortKey === "string" && isClientSortKey(p.sortKey)
          ? p.sortKey
          : base.sortKey,
      sortDir:
        typeof p.sortDir === "string" && isSortDirStored(p.sortDir)
          ? p.sortDir
          : base.sortDir,
    };
  } catch {
    return defaultClientsTablePrefs();
  }
}

function encodeClientsTablePrefs(prefs: ClientsTablePrefsState): string {
  return JSON.stringify({ v: CLIENTS_TABLE_PREFS_V, ...prefs });
}

function parseTrafficFilterBytes(input: string): number | null {
  const s = input.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  const m = s.match(/^([\d.]+)\s*(b|kb|mb|gb|tb)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const u = (m[2] || "gb").toLowerCase();
  const mult: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
  };
  return n * (mult[u] ?? mult.gb);
}

function parseExpiryFilterDayBounds(input: string): {
  start: number;
  end: number;
} | null {
  const s = input.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const start = new Date(y, mo - 1, d).getTime();
    const end = start + 86400000 - 1;
    return { start, end };
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const dt = new Date(t);
  const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const end = start + 86400000 - 1;
  return { start, end };
}

function rowExpiryMsForFilter(r: ClientCard): number | null {
  const ms = panelTimestampToMs(r.expiryTime);
  if (ms == null || ms <= 0) return null;
  return ms;
}

function rowMatchesAccountFilter(r: ClientCard, f: FilterAcct): boolean {
  if (f === "") return true;
  if (f === "disabled") return !r.enable;
  if (!r.enable) return false;
  const s = (r.status || "active").toLowerCase();
  if (f === "active") return s !== "expired_traffic" && s !== "expired_time";
  if (f === "expired_traffic") return s === "expired_traffic";
  if (f === "expired_time") return s === "expired_time";
  return true;
}

function buildClientTextFilterHaystacks(
  r: ClientCard,
  t: TFunction,
  noExpiry: string,
  expired: string,
): Record<ColumnFilterId, string> {
  const up = r.up || 0;
  const down = r.down || 0;
  const used = up + down;
  const limGb = r.totalGB ?? 0;
  const limitBytes = limGb > 0 ? limGb * 1024 * 1024 * 1024 : 0;
  const pct = limitBytes > 0 ? Math.min(100, (used / limitBytes) * 100) : 0;
  const traffic = [
    sizeFormat(up),
    sizeFormat(down),
    sizeFormat(used),
    limGb > 0 ? `${Math.round(pct)}` : "",
    limGb > 0 ? sizeFormat(limitBytes) : "∞",
    String(limGb),
    String(r.allTime ?? 0),
  ]
    .join(" ")
    .toLowerCase();

  const expiryLabel = formatClientCardExpiry(
    r.expiryTime,
    noExpiry,
    expired,
  ).toLowerCase();

  const hwidStr = r.hwidEnabled
    ? `${r.activeHwidCount} ${r.maxHwid != null && r.maxHwid > 0 ? r.maxHwid : ""}`
    : "—";

  return {
    name: r.name.toLowerCase(),
    comment: (r.comment || "").toLowerCase(),
    traffic,
    expiry: expiryLabel,
    hwid: hwidStr.toLowerCase(),
  };
}

function stateSortRank(r: ClientCard): number {
  if (!r.enable) return 0;
  const s = (r.status || "active").toLowerCase();
  if (s === "expired_time") return 1;
  if (s === "expired_traffic") return 2;
  return 3;
}

function expirySortMs(r: ClientCard): number {
  const ms = panelTimestampToMs(r.expiryTime);
  if (ms == null || ms === 0) return Number.POSITIVE_INFINITY;
  return ms;
}

function compareClients(
  a: ClientCard,
  b: ClientCard,
  key: ClientSortKey,
  dir: SortDir,
  groupOptions: GroupOption[],
): number {
  const m = dir === "asc" ? 1 : -1;
  let c = 0;
  switch (key) {
    case "id":
      c = a.id - b.id;
      break;
    case "name":
      c = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      break;
    case "comment":
      c = (a.comment || "").localeCompare(b.comment || "", undefined, {
        sensitivity: "base",
      });
      break;
    case "connection":
      c =
        Number(clientIsOnlineConsideringLastSeen(a)) -
        Number(clientIsOnlineConsideringLastSeen(b));
      break;
    case "state":
      c = stateSortRank(a) - stateSortRank(b);
      break;
    case "traffic":
      c = a.up + a.down - (b.up + b.down);
      break;
    case "up":
      c = a.up - b.up;
      break;
    case "down":
      c = a.down - b.down;
      break;
    case "allTime":
      c = (a.allTime ?? 0) - (b.allTime ?? 0);
      break;
    case "totalGb":
      c = (a.totalGB ?? 0) - (b.totalGB ?? 0);
      break;
    case "expiry":
      c = expirySortMs(a) - expirySortMs(b);
      break;
    case "lastOnline":
      c = rowTsForSort(a, "lastOnline") - rowTsForSort(b, "lastOnline");
      break;
    case "lastConnectedNode":
      c = (a.lastConnectedNode || "").localeCompare(b.lastConnectedNode || "", undefined, {
        sensitivity: "base",
      });
      break;
    case "createdAt":
      c = rowTsForSort(a, "createdAt") - rowTsForSort(b, "createdAt");
      break;
    case "updatedAt":
      c = rowTsForSort(a, "updatedAt") - rowTsForSort(b, "updatedAt");
      break;
    case "speed":
      c =
        (a.upSpeed ?? 0) +
        (a.downSpeed ?? 0) -
        ((b.upSpeed ?? 0) + (b.downSpeed ?? 0));
      break;
    case "inbounds":
      c = (a.inbounds?.length ?? 0) - (b.inbounds?.length ?? 0);
      break;
    case "group":
      c = groupSortKey(a, groupOptions).localeCompare(
        groupSortKey(b, groupOptions),
        undefined,
        { sensitivity: "base" },
      );
      break;
    case "uuid":
      c = (a.uuid || "").localeCompare(b.uuid || "", undefined, {
        sensitivity: "base",
      });
      break;
    case "subId":
      c = (a.subId || "").localeCompare(b.subId || "", undefined, {
        sensitivity: "base",
      });
      break;
    case "tgId":
      c = (a.tgId ?? 0) - (b.tgId ?? 0);
      break;
    case "reset":
      c = (a.reset ?? 0) - (b.reset ?? 0);
      break;
    case "hwid":
      c = (a.activeHwidCount ?? 0) - (b.activeHwidCount ?? 0);
      break;
  }
  return c * m;
}

function ClientTrafficMiniCell({ r }: { r: ClientCard }) {
  const up = r.up || 0;
  const down = r.down || 0;
  const used = up + down;
  const limGb = r.totalGB ?? 0;
  const limitBytes = limGb > 0 ? limGb * 1024 * 1024 * 1024 : 0;
  const pct =
    limitBytes > 0 ? Math.min(100, (used / limitBytes) * 100) : null;
  const over = limitBytes > 0 && used > limitBytes;
  const title = `${sizeFormat(up)} ↑ / ${sizeFormat(down)} ↓` +
    (limitBytes > 0 ? ` · ${Math.round(pct ?? 0)}% / ${sizeFormat(limitBytes)}` : " · ∞");

  return (
    <div className="min-w-[8.5rem] max-w-[13rem]" title={title}>
      {limitBytes > 0 ? (
        <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--border)_85%,transparent)]">
          <div
            className={cx(
              "h-full max-w-full rounded-full transition-[width]",
              over
                ? "bg-rose-500"
                : (pct ?? 0) > 90
                  ? "bg-amber-500"
                  : "bg-[var(--accent)]",
            )}
            style={{ width: `${Math.min(100, pct ?? 0)}%` }}
          />
        </div>
      ) : null}
      <div className="space-y-0.5 text-[10px] leading-tight tabular-nums text-[var(--fg-muted)]">
        <div>
          {sizeFormat(up)} ↑ · {sizeFormat(down)} ↓
        </div>
        <div className="text-[var(--fg-subtle)]">
          {limitBytes > 0 ? (
            <>
              {Math.round(pct ?? 0)}% · {sizeFormat(limitBytes)}
            </>
          ) : (
            <span title="∞">∞</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ClientDataCell({
  col,
  r,
  t,
  groupOptions,
  noExpiry,
  expired,
}: {
  col: DataColumnId;
  r: ClientCard;
  t: TFunction;
  groupOptions: { id: number; name: string; description: string }[];
  noExpiry: string;
  expired: string;
}) {
  switch (col) {
    case "id":
      return (
        <span className="tabular-nums text-[var(--fg)]">{r.id}</span>
      );
    case "name":
      return (
        <span
          className="block max-w-full truncate font-medium text-[var(--fg)]"
          title={r.name}
        >
          {r.name}
        </span>
      );
    case "comment":
      return (
        <span
          className="max-w-[12rem] truncate"
          title={r.comment || undefined}
        >
          {r.comment?.trim() ? r.comment : "—"}
        </span>
      );
    case "connection":
      return (
        <ClientConnectionStatus
          isOnline={clientIsOnlineConsideringLastSeen(r)}
          lastOnline={r.lastOnline}
          t={t}
        />
      );
    case "state": {
      const sm = clientAccountStateMeta(r.enable, r.status, t);
      return (
        <PillTag tone={sm.tone} className="inline-flex max-w-full">
          <span className="truncate">{sm.label}</span>
        </PillTag>
      );
    }
    case "traffic":
      return <ClientTrafficMiniCell r={r} />;
    case "up":
      return <span className="tabular-nums">{sizeFormat(r.up || 0)}</span>;
    case "down":
      return <span className="tabular-nums">{sizeFormat(r.down || 0)}</span>;
    case "allTime":
      return <span className="tabular-nums">{sizeFormat(r.allTime ?? 0)}</span>;
    case "totalGb":
      return (
        <span className="tabular-nums">{(r.totalGB ?? 0) > 0 ? String(r.totalGB) : "∞"}</span>
      );
    case "expiry":
      return (
        <span className="tabular-nums whitespace-nowrap">
          {formatClientCardExpiry(r.expiryTime, noExpiry, expired)}
        </span>
      );
    case "lastOnline":
      return (
        <span className="tabular-nums whitespace-nowrap">
          {formatCardDateTime(
            r.lastOnline,
            t("pages.clients.cardNoDate", { defaultValue: "—" }),
          )}
        </span>
      );
    case "lastConnectedNode":
      return (
        <span
          className="block max-w-[12rem] truncate text-[var(--fg)]"
          title={r.lastConnectedNode || undefined}
        >
          {r.lastConnectedNode?.trim() ? r.lastConnectedNode : "—"}
        </span>
      );
    case "createdAt":
      return (
        <span className="tabular-nums whitespace-nowrap">
          {formatCardDateTime(
            r.createdAt,
            t("pages.clients.cardNoDate", { defaultValue: "—" }),
          )}
        </span>
      );
    case "updatedAt":
      return (
        <span className="tabular-nums whitespace-nowrap">
          {formatCardDateTime(
            r.updatedAt,
            t("pages.clients.cardNoDate", { defaultValue: "—" }),
          )}
        </span>
      );
    case "speed": {
      const u = r.upSpeed ?? 0;
      const d = r.downSpeed ?? 0;
      if (u <= 0 && d <= 0) {
        return <span className="text-[var(--fg-muted)]">—</span>;
      }
      return (
        <span className="text-[10px] leading-tight tabular-nums text-[var(--fg-muted)]">
          {speedMbpsFormat(u)} ↑ · {speedMbpsFormat(d)} ↓
        </span>
      );
    }
    case "inbounds": {
      const ib = r.inbounds ?? [];
      const inboundSummary =
        ib.length === 0
          ? "—"
          : ib.length === 1
            ? `${ib[0]!.remark || ib[0]!.tag} · ${ib[0]!.protocol}`
            : `${ib[0]!.remark || ib[0]!.tag || ib[0]!.protocol} +${ib.length - 1}`;
      const inboundTitle = ib.length
        ? ib
            .map((x) => `${x.remark || x.tag} · ${x.protocol}:${x.port}`)
            .join("\n")
        : undefined;
      return (
        <span className="max-w-[12rem] truncate" title={inboundTitle}>
          {inboundSummary}
        </span>
      );
    }
    case "group":
      return (
        <span
          className="max-w-[10rem] truncate"
          title={
            r.groupId != null
              ? groupOptions.find((g) => g.id === r.groupId)?.name
              : undefined
          }
        >
          {r.groupId != null
            ? groupOptions.find((g) => g.id === r.groupId)?.name ?? `#${r.groupId}`
            : "—"}
        </span>
      );
    case "uuid":
      return (
        <span
          className="max-w-[9rem] truncate font-mono text-[11px]"
          title={r.uuid}
        >
          {r.uuid || "—"}
        </span>
      );
    case "subId":
      return (
        <span
          className="max-w-[8rem] truncate font-mono text-[11px]"
          title={r.subId}
        >
          {r.subId || "—"}
        </span>
      );
    case "tgId":
      return (
        <span className="tabular-nums">
          {r.tgId != null && r.tgId !== 0 ? String(r.tgId) : "—"}
        </span>
      );
    case "reset":
      return (
        <span className="tabular-nums">
          {r.reset != null && r.reset > 0 ? String(r.reset) : "—"}
        </span>
      );
    case "hwid":
      return (
        <span className="tabular-nums whitespace-nowrap">
          {r.hwidEnabled
            ? `${r.activeHwidCount}${r.maxHwid != null && r.maxHwid > 0 ? ` / ${r.maxHwid}` : ""}`
            : "—"}
        </span>
      );
    default: {
      const _u: never = col;
      return _u;
    }
  }
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: ClientSortKey;
  activeKey: ClientSortKey;
  dir: SortDir;
  onSort: (k: ClientSortKey) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={cx("p-3", className)}>
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1 text-left font-semibold uppercase tracking-wider text-[var(--fg-subtle)] outline-none hover:text-[var(--fg-muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        onClick={(e) => {
          e.stopPropagation();
          onSort(sortKey);
        }}
      >
        <span className="truncate">{label}</span>
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="size-3.5 shrink-0 opacity-90" aria-hidden />
          ) : (
            <ArrowDown className="size-3.5 shrink-0 opacity-90" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="size-3.5 shrink-0 opacity-35" aria-hidden />
        )}
      </button>
    </th>
  );
}

function ClientsColumnFilterInput({
  value,
  onChange,
  placeholder,
  className = "",
  prefix,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  /** Shown before the field (e.g. &gt;, &lt;, =) when comparing numeric / date filters. */
  prefix?: string;
}) {
  const input = (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      placeholder={placeholder}
      className={
        prefix
          ? `!h-8 min-w-0 flex-1 !border-0 !bg-transparent !px-2 !py-1 !text-xs ${className}`
          : `!h-8 w-full min-w-[4.5rem] !px-2 !py-1 !text-xs ${className}`
      }
    />
  );
  if (!prefix) return input;
  return (
    <div
      className={`flex min-w-0 items-stretch overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] ${className}`}
    >
      <span
        className="flex shrink-0 items-center border-r border-[var(--border)] bg-[color-mix(in_oklab,var(--border)_35%,transparent)] px-1.5 font-mono text-xs font-semibold text-[var(--fg-muted)]"
        aria-hidden
      >
        {prefix}
      </span>
      {input}
    </div>
  );
}

type ShareLinkRow = {
  inboundId: number;
  remark: string;
  protocol: string;
  link: string;
  wgConf?: string;
};

type HwidRow = {
  id: number;
  hwid: string;
  deviceModel?: string;
  deviceOs?: string;
  userAgent?: string;
  isActive?: boolean;
  /** Admin block (subscription/HWID checks deny this device). */
  blocked?: boolean;
};

type InboundOption = { id: number; remark: string; protocol: string; port: number };

type GroupOption = { id: number; name: string; description: string };

function groupSortKey(r: ClientCard, options: GroupOption[]): string {
  if (r.groupId == null) return "";
  const g = options.find((x) => x.id === r.groupId);
  return (g?.name ?? `id:${r.groupId}`).toLowerCase();
}

type ClientSheetMode = "create" | "edit";

type ClientSessionsResponse = {
  name: string;
  blockedSessionIps?: string[];
  results: {
    nodeId?: number;
    nodeName: string;
    /** IPs on blocklist but missing from live Xray stats — unblock toggle still works */
    isOfflineBlockedGroup?: boolean;
    sessions: {
      ip: string;
      lastSeen: number;
      protocol?: string;
      remark?: string;
    }[];
    dropAvailable: boolean;
    error?: string;
  }[] | null;
};

type ClientDetail = {
  id: number;
  name: string;
  enable: boolean;
  totalGB: number;
  expiryTime: number;
  groupId?: number | null;
  inboundIds?: number[];
  comment?: string;
  announce?: string;
  reset?: number;
  tgId?: number;
  subId?: string;
  security?: string;
  flow?: string;
  /** VMess/VLESS */
  uuid?: string;
  hwidEnabled?: boolean;
  maxHwid?: number;
  ipLimitEnabled?: boolean;
  maxIPs?: number;
  telemtAdTags?: Record<string, string>;
};

type ClientFormState = {
  name: string;
  enable: boolean;
  totalGB: string;
  expiryLocal: string;
  groupId: string;
  comment: string;
  reset: string;
  tgId: string;
  /** Subscription id (пустой на сервере = сгенерировать при создании) */
  subId: string;
  announce: string;
  hwidEnabled: boolean;
  maxHwid: string;
  ipLimitEnabled: boolean;
  maxIPs: string;
};

const FORM_DEFAULT: ClientFormState = {
  name: "",
  enable: true,
  totalGB: "0",
  expiryLocal: "",
  groupId: "",
  comment: "",
  reset: "0",
  tgId: "",
  subId: "",
  announce: "",
  hwidEnabled: false,
  maxHwid: "0",
  ipLimitEnabled: false,
  maxIPs: "1",
};

function msToDatetimeLocal(ms: number): string {
  if (!ms) return "";
  const n = panelTimestampToMs(ms) ?? ms;
  const d = new Date(n);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatCardDateTime(ms: number | undefined, emptyLabel: string): string {
  const normalized = ms != null && ms !== 0 ? panelTimestampToMs(ms) : undefined;
  if (normalized == null || normalized === 0) return emptyLabel;
  try {
    return new Date(normalized).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Short hint under expiry datetime (expired, or soon). */
function clientExpiryHint(
  ms: number | undefined,
  t: TFunction,
): string | null {
  if (ms == null || ms === 0) return null;
  const now = Date.now();
  if (ms <= now) {
    return t("pages.clients.cardExpiryHintEnded", {
      defaultValue: "This period has ended.",
    });
  }
  const days = Math.ceil((ms - now) / 86400000);
  if (days <= 14) {
    return t("pages.clients.cardExpiryHintDaysLeft", {
      defaultValue: "{{count}} days remaining",
      count: days,
    });
  }
  return null;
}

/** 0 = no expiry / invalid */
function expiryMsFromForm(form: ClientFormState): number {
  if (form.expiryLocal.trim() === "") return 0;
  const ms = new Date(form.expiryLocal).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function totalGbFromForm(form: ClientFormState): number {
  const n = Number(form.totalGB);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

type ClientUnifiedCardProps = {
  variant: "create" | "existing";
  r?: ClientCard;
  t: TFunction;
  copyText: (text: string) => void;
  fieldIdPrefix: string;
  form: ClientFormState;
  setForm: Dispatch<SetStateAction<ClientFormState>>;
  inboundIds: Record<number, boolean>;
  inboundSubscriptionOrder: number[];
  onToggleInboundId: (id: number) => void;
  onMoveInboundSubscription: (idx: number, dir: -1 | 1) => void;
  inbounds: InboundOption[];
  telemtAdTags: Record<string, string>;
  setTelemtAdTags: Dispatch<SetStateAction<Record<string, string>>>;
  groups: GroupOption[];
  isEdit: boolean;
  sheetActionBusy: "reset" | "clearHwid" | null;
  onResetTraffic: () => void;
  onClearHwid: () => void;
  onDelete: () => void;
  onOpenKeys: () => void;
  onOpenHwid: () => void;
  onOpenSessions: () => void;
  onShowSubscriptionQr: (url: string) => void;
};

/** Two-column client card: identity (left) and policy (right). */
function ClientUnifiedCard({
  variant,
  r,
  t,
  copyText,
  fieldIdPrefix,
  form,
  setForm,
  inboundIds,
  inboundSubscriptionOrder,
  onToggleInboundId,
  onMoveInboundSubscription,
  inbounds,
  telemtAdTags,
  setTelemtAdTags,
  groups,
  isEdit,
  sheetActionBusy,
  onResetTraffic,
  onClearHwid,
  onDelete,
  onOpenKeys,
  onOpenHwid,
  onOpenSessions,
  onShowSubscriptionQr,
}: ClientUnifiedCardProps) {
  const id = (s: string) => `${fieldIdPrefix}-${s}`;
  const expiryMs = expiryMsFromForm(form);
  const totalGb = totalGbFromForm(form);
  const limitLabel =
    totalGb > 0
      ? t("pages.clients.cardTrafficLimitGb", {
          defaultValue: "{{n}} GB limit",
          n: totalGb,
        })
      : t("pages.clients.cardTrafficUnlimited", {
          defaultValue: "Unlimited traffic",
        });
  const usedTotal =
    variant === "existing" && r ? (r.up || 0) + (r.down || 0) : 0;
  const upDown =
    variant === "existing" && r
      ? { up: r.up || 0, down: r.down || 0 }
      : { up: 0, down: 0 };
  const limitBytes = totalGb > 0 ? totalGb * 1024 * 1024 * 1024 : 0;
  const trafficPct =
    limitBytes > 0 ? Math.min(100, (usedTotal / limitBytes) * 100) : 0;
  const expiryHint = expiryMs > 0 ? clientExpiryHint(expiryMs, t) : null;

  const maxHwidParsed = parseInt(form.maxHwid, 10);
  const maxHwidSuffix =
    form.hwidEnabled && !Number.isNaN(maxHwidParsed) && maxHwidParsed > 0
      ? ` / ${maxHwidParsed}`
      : variant === "existing" && r?.maxHwid != null && r.maxHwid > 0
        ? ` / ${r.maxHwid}`
        : "";

  const showExistingChrome = variant === "existing" && r != null;
  const subFeedUrl = showExistingChrome ? r.subscriptionUrl : undefined;
  const subPageOpenUrl =
    showExistingChrome && r
      ? (r.subscriptionPageUrl?.trim() || r.subscriptionUrl)
      : undefined;
  const accMeta =
    showExistingChrome && r ? clientAccountStateMeta(r.enable, r.status, t) : null;

  return (
    <div
      className={cx(
        "relative flex flex-col overflow-visible rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm",
        !form.enable && "opacity-[0.92]",
      )}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="space-y-3 border-b border-[var(--border)] pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
            <div className="min-w-0 flex-1 space-y-3">
              {showExistingChrome && r && accMeta ? (
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 sm:gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                      {t("pages.clients.stateColumn", {
                        defaultValue: "State",
                      })}
                    </div>
                    <PillTag tone={accMeta.tone} className="max-w-full sm:inline-flex">
                      <span className="truncate">{accMeta.label}</span>
                    </PillTag>
                  </div>
                  <ReadonlyConnectionState
                    legend={t("pages.clients.fieldConnectionState", {
                      defaultValue: "Connection",
                    })}
                    label={
                      clientIsOnlineConsideringLastSeen(r) ? t("online") : t("offline")
                    }
                    groupName={t("pages.clients.fieldConnectionState", {
                      defaultValue: "Connection",
                    })}
                    activityText={connectionActivityText(r.lastOnline, t)}
                    isOnline={clientIsOnlineConsideringLastSeen(r)}
                  />
                </div>
              ) : (
                <p className="text-xs text-[var(--fg-subtle)]">
                  {t("pages.clients.cardNewClientHint", {
                    defaultValue:
                      "After saving, account status and live connection will appear here.",
                  })}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {form.hwidEnabled ? (
                  <PillTag tone="green">
                    <Shield size={11} className="mr-1" />
                    HWID
                  </PillTag>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-0.5 lg:pt-0.5">
            <IconButton
              type="button"
              label={
                form.enable
                  ? t("pages.clients.disableClient", { defaultValue: "Disable client" })
                  : t("pages.clients.enableClient", { defaultValue: "Enable client" })
              }
              disabled={variant === "existing" && sheetActionBusy != null}
              className={
                form.enable
                  ? "!text-emerald-600 hover:!text-emerald-700 dark:!text-emerald-400 dark:hover:!text-emerald-300"
                  : "!text-[var(--fg-subtle)]"
              }
              onClick={() => setForm((f) => ({ ...f, enable: !f.enable }))}
            >
              <Power size={18} />
            </IconButton>
            {subFeedUrl ? (
              <>
                <IconButton
                  type="button"
                  label={t("pages.clients.openSub", { defaultValue: "Open subscription" })}
                  className="!text-[var(--accent)]"
                  onClick={() =>
                    window.open(subPageOpenUrl || subFeedUrl, "_blank", "noreferrer")
                  }
                >
                  <ExternalLink size={18} />
                </IconButton>
                <IconButton
                  type="button"
                  label={t("pages.clients.showSubscriptionQr", {
                    defaultValue: "Subscription QR code",
                  })}
                  onClick={() => onShowSubscriptionQr(subFeedUrl)}
                >
                  <QrCode size={18} />
                </IconButton>
              </>
            ) : null}
            {showExistingChrome ? (
              <IconButton
                type="button"
                label={t("pages.clients.viewKeys", {
                  defaultValue: "View and copy connection keys",
                })}
                onClick={() => onOpenKeys()}
              >
                <KeyRound size={18} />
              </IconButton>
            ) : null}
            {showExistingChrome ? (
              <IconButton
                type="button"
                label={t("pages.clients.sessions.openModal", {
                  defaultValue: "Active sessions (IPs)",
                })}
                onClick={() => onOpenSessions()}
              >
                <Unplug size={18} />
              </IconButton>
            ) : null}
            {showExistingChrome ? (
              <>
                <IconButton
                  type="button"
                  label={t("pages.clients.resetTraffic", { defaultValue: "Reset traffic" })}
                  disabled={sheetActionBusy != null}
                  onClick={() => onResetTraffic()}
                >
                  {sheetActionBusy === "reset" ? (
                    <Loader2 size={18} className="animate-spin text-[var(--accent)]" aria-hidden />
                  ) : (
                    <RotateCcw size={18} />
                  )}
                </IconButton>
                <IconButton
                  type="button"
                  label={t("pages.clients.clearHwid", {
                    defaultValue: "Clear all registered device (HWID) limits",
                  })}
                  disabled={sheetActionBusy != null}
                  className="!text-red-600 hover:!text-red-700 dark:!text-red-400 dark:hover:!text-red-300"
                  onClick={() => onClearHwid()}
                >
                  {sheetActionBusy === "clearHwid" ? (
                    <Loader2 size={18} className="animate-spin text-red-500" aria-hidden />
                  ) : (
                    <Smartphone size={18} />
                  )}
                </IconButton>
                <IconButton
                  type="button"
                  label={t("pages.clients.deleteClient", {
                    defaultValue: "Delete this client permanently",
                  })}
                  disabled={sheetActionBusy != null}
                  className="!text-red-600 hover:!text-red-700 dark:!text-red-400 dark:hover:!text-red-300"
                  onClick={() => onDelete()}
                >
                  <Trash2 size={18} />
                </IconButton>
              </>
            ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-5 text-sm">
            {/* --- Identity group --- */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <SectionLabel icon={User}>
                {t("pages.clients.identityBlockTitle", { defaultValue: "Identity" })}
              </SectionLabel>
              <div className="space-y-4">
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor={id("client-name")}
                  >
                    {t("pages.clients.name", { defaultValue: "Client name" })} *
                  </label>
                  <Input
                    id={id("client-name")}
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    autoComplete="off"
                    readOnly={isEdit}
                    aria-readonly={isEdit}
                    className={isEdit ? "cursor-default bg-[var(--bg-muted)]/40" : undefined}
                  />
                  {isEdit ? (
                    <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                      {t("pages.clients.nameImmutableHint", {
                        defaultValue: "Client name cannot be changed after the client is created.",
                      })}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor={id("comment")}
                  >
                    {t("pages.clients.comment", { defaultValue: "Comment" })}
                  </label>
                  <Input
                    id={id("comment")}
                    value={form.comment}
                    maxLength={100}
                    onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                    placeholder={t("comment")}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-xs text-[var(--fg-subtle)]">{form.comment.length}/100</p>
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-[var(--fg-muted)]">
                    {t("pages.clients.uuidReadonly", { defaultValue: "UUID" })}
                  </div>
                  {showExistingChrome && r.uuid ? (
                    <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 font-mono text-xs text-[var(--fg)]">
                      <span className="min-w-0 flex-1 break-all" title={r.uuid}>
                        {r.uuid}
                      </span>
                      <IconButton
                        type="button"
                        label={t("pages.clients.copyUuid", { defaultValue: "Copy UUID" })}
                        onClick={() => copyText(r.uuid!)}
                      >
                        <Copy size={14} />
                      </IconButton>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--fg-subtle)]">
                      {t("pages.clients.uuidAfterCreate", {
                        defaultValue: "Assigned by the server after the client is created.",
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* --- Contacts group --- */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <SectionLabel icon={Mail}>
                {t("pages.clients.contactsSection", { defaultValue: "Contacts" })}
              </SectionLabel>
              <div className="space-y-4">
                <div>
                  <label
                    className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor={id("tgid")}
                  >
                    <Send size={12} />
                    {t("pages.clients.addModalTgId")}
                  </label>
                  <Input
                    id={id("tgid")}
                    type="text"
                    inputMode="numeric"
                    value={form.tgId}
                    onChange={(e) => setForm((f) => ({ ...f, tgId: e.target.value }))}
                    placeholder="0"
                    autoComplete="off"
                  />
                  <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                    {t("pages.clients.addModalTgIdHint")}
                  </p>
                </div>

                {variant === "create" ? (
                  <div>
                    <label
                      className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor={id("subid-new")}
                    >
                      {t("pages.clients.subId", { defaultValue: "Subscription ID" })}
                      <HelpTooltip helpKey="clients.remark" />
                    </label>
                    <Input
                      id={id("subid-new")}
                      className="font-mono text-xs"
                      value={form.subId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, subId: e.target.value }))
                      }
                      placeholder={t("pages.clients.subIdPlaceholder", {
                        defaultValue: "Auto if empty (on create)",
                      })}
                      maxLength={64}
                      autoComplete="off"
                    />
                    <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                      {t("pages.clients.subIdHint", {
                        defaultValue: "Optional. If empty, a random ID is generated.",
                      })}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* --- Account details (existing only) --- */}
            {showExistingChrome ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
                <SectionLabel icon={Clock}>
                  {t("pages.clients.cardMetaTitle", { defaultValue: "Account details" })}
                </SectionLabel>
                <ul className="space-y-2.5 text-xs">
                  <li className="space-y-1.5 border-b border-dashed border-[var(--border)] pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        className="text-[var(--fg-muted)]"
                        htmlFor={id("subid")}
                      >
                        {t("pages.clients.subId", { defaultValue: "Subscription ID" })}
                      </label>
                      {form.subId.trim() ? (
                        <IconButton
                          type="button"
                          label={t("pages.clients.copySubId", {
                            defaultValue: "Copy subscription ID to clipboard",
                          })}
                          onClick={() => copyText(form.subId.trim())}
                        >
                          <Copy size={12} />
                        </IconButton>
                      ) : null}
                    </div>
                    <Input
                      id={id("subid")}
                      className="font-mono text-xs"
                      value={form.subId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, subId: e.target.value }))
                      }
                      placeholder={t("pages.clients.subIdPlaceholder", {
                        defaultValue: "Auto if empty (on create)",
                      })}
                      maxLength={64}
                      autoComplete="off"
                    />
                  </li>
                  <li className="flex flex-wrap justify-between gap-2">
                    <span className="text-[var(--fg-muted)]">
                      {t("pages.clients.cardCreatedAt", { defaultValue: "Created" })}
                    </span>
                    <span className="text-[var(--fg)]">
                      {formatCardDateTime(
                        r.createdAt,
                        t("pages.clients.cardNoDate", { defaultValue: "—" }),
                      )}
                    </span>
                  </li>
                  <li className="flex flex-wrap justify-between gap-2">
                    <span className="text-[var(--fg-muted)]">
                      {t("pages.clients.cardUpdatedAt", { defaultValue: "Updated" })}
                    </span>
                    <span className="text-[var(--fg)]">
                      {formatCardDateTime(
                        r.updatedAt,
                        t("pages.clients.cardNoDate", { defaultValue: "—" }),
                      )}
                    </span>
                  </li>
                  <li className="flex flex-wrap justify-between gap-2">
                    <span className="text-[var(--fg-muted)]">
                      {t("pages.clients.cardLastOnline", { defaultValue: "Last online" })}
                    </span>
                    <span className="text-[var(--fg)]">
                      {formatCardDateTime(
                        r.lastOnline,
                        t("pages.clients.cardNoDate", { defaultValue: "—" }),
                      )}
                    </span>
                  </li>
                  {form.hwidEnabled && r ? (
                    <li className="flex flex-wrap justify-between gap-2">
                      <span className="text-[var(--fg-muted)]">
                        {t("pages.clients.viewHwid", { defaultValue: "Devices" })}
                      </span>
                      <span className="text-[var(--fg)]">
                        {t("pages.clients.cardHwidCounts", {
                          defaultValue: "Devices: {{active}}{{suffix}}",
                          active: r.activeHwidCount,
                          suffix: maxHwidSuffix,
                        })}
                      </span>
                    </li>
                  ) : null}
                  {r.upSpeed != null && r.upSpeed > 0 ? (
                    <li className="flex flex-wrap justify-between gap-2">
                      <span className="text-[var(--fg-muted)]">
                        {t("pages.clients.cardUpSpeed", { defaultValue: "Upload speed" })}
                      </span>
                      <span className="text-[var(--fg)]">{speedMbpsFormat(r.upSpeed)}</span>
                    </li>
                  ) : null}
                  {r.downSpeed != null && r.downSpeed > 0 ? (
                    <li className="flex flex-wrap justify-between gap-2">
                      <span className="text-[var(--fg-muted)]">
                        {t("pages.clients.cardDownSpeed", { defaultValue: "Download speed" })}
                      </span>
                      <span className="text-[var(--fg)]">{speedMbpsFormat(r.downSpeed)}</span>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="space-y-5 text-sm">
            {/* --- Expiry section --- */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <SectionLabel icon={Calendar}>
                {t("pages.clients.expiryTime")}
                <HelpTooltip helpKey="clients.expireDate" />
              </SectionLabel>
              <Input
                id={id("expiry")}
                type="datetime-local"
                value={form.expiryLocal}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    expiryLocal: normalizeDatetimeLocalInput(e.target.value),
                  }))
                }
              />
              <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                {t("pages.clients.expiryTimeHint")}
              </p>
              {expiryHint ? (
                <p className="mt-1 text-xs text-amber-600/90 dark:text-amber-400/90">
                  {expiryHint}
                </p>
              ) : null}
            </div>

            {/* --- Traffic & reset section --- */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <SectionLabel icon={Activity}>
                {t("pages.clients.traffic")}
                <HelpTooltip helpKey="clients.trafficLimit" />
              </SectionLabel>
              <div className="mb-3 space-y-1.5 text-xs text-[var(--fg-muted)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t("pages.clients.trafficRowMode", { defaultValue: "Traffic mode" })}</span>
                  <span className="text-[var(--fg)]">{limitLabel}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t("usage")}</span>
                  <span className="text-[var(--fg)]">
                    {sizeFormat(upDown.up)} ↑ / {sizeFormat(upDown.down)} ↓
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t("pages.clients.cardTrafficTotalUsed", { defaultValue: "Total used" })}
                  </span>
                  <span className="text-[var(--fg)]">
                    {t("pages.clients.cardTrafficUsedOnly", {
                      defaultValue: "{{used}}",
                      used: sizeFormat(usedTotal),
                    })}
                  </span>
                </div>
              </div>
              {limitBytes > 0 ? (
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--fg-muted)]">
                  <span>{t("pages.clients.cardTrafficFractionLabel", { defaultValue: "Usage ratio" })}</span>
                  <span className="font-medium text-[var(--fg)]">
                    {t("pages.clients.cardTrafficFraction", {
                      defaultValue: "{{used}} / {{limit}} ({{pct}}%)",
                      used: sizeFormat(usedTotal),
                      limit: sizeFormat(limitBytes),
                      pct: String(Math.round(trafficPct)),
                    })}
                  </span>
                </div>
              ) : null}
              {limitBytes > 0 ? (
                <div
                  className="mb-3 h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--border)_85%,transparent)]"
                  role="progressbar"
                  aria-valuenow={Math.round(trafficPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={cx(
                      "h-full rounded-full transition-[width]",
                      usedTotal > limitBytes
                        ? "bg-[color-mix(in_oklab,#c0392b_85%,var(--accent))]"
                        : "bg-[var(--accent)]",
                    )}
                    style={{ width: `${trafficPct}%` }}
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor={id("totalgb")}
                  >
                    {t("pages.clients.trafficLimitGB")}
                    <HelpTooltip helpKey="clients.trafficLimit" />
                  </label>
                  <Input
                    id={id("totalgb")}
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.totalGB}
                    onChange={(e) => setForm((f) => ({ ...f, totalGB: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                    {t("pages.clients.trafficLimitGBHint")}
                  </p>
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor={id("reset")}
                  >
                    {t("pages.clients.addModalResetDays")}
                  </label>
                  <Input
                    id={id("reset")}
                    type="number"
                    min={0}
                    step={1}
                    value={form.reset}
                    onChange={(e) => setForm((f) => ({ ...f, reset: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                    {t("pages.clients.addModalResetHint")}
                  </p>
                </div>
              </div>
            </div>

            {/* --- Inbounds section --- */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <SectionLabel icon={Layers}>
                {t("pages.clients.selectInbounds")}
              </SectionLabel>
              {inbounds.length === 0 ? (
                <p className="text-xs text-[var(--fg-subtle)]">{t("noData")}</p>
              ) : (
                <div className="max-h-52 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label={t("pages.clients.selectInbounds")}
                  >
                    {inbounds.map((ib) => {
                      const capLabel = ib.remark?.trim() || `Inbound ${ib.id}`;
                      const capSub = `${ib.protocol} · ${ib.port}`;
                      return (
                        <InboundCapsuleToggle
                          key={ib.id}
                          selected={!!inboundIds[ib.id]}
                          onToggle={() => onToggleInboundId(ib.id)}
                          label={capLabel}
                          sublabel={capSub}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
              {inbounds.length > 0 && inboundSubscriptionOrder.length >= 2 ? (
                <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                    {t("pages.clients.subscriptionInboundOrder", {
                      defaultValue: "Subscription order",
                    })}
                  </p>
                  {inboundSubscriptionOrder.map((iid, idx) => {
                    const ib = inbounds.find((x) => x.id === iid);
                    const label = ib?.remark?.trim() || `Inbound ${iid}`;
                    return (
                      <div
                        key={iid}
                        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg)]">
                          {label}
                        </span>
                        <IconButton
                          type="button"
                          label={t("pages.clients.moveInboundUp", {
                            defaultValue: "Move up",
                          })}
                          disabled={idx === 0}
                          onClick={() => onMoveInboundSubscription(idx, -1)}
                        >
                          <ArrowUp size={14} />
                        </IconButton>
                        <IconButton
                          type="button"
                          label={t("pages.clients.moveInboundDown", {
                            defaultValue: "Move down",
                          })}
                          disabled={idx >= inboundSubscriptionOrder.length - 1}
                          onClick={() => onMoveInboundSubscription(idx, 1)}
                        >
                          <ArrowDown size={14} />
                        </IconButton>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {inboundSubscriptionOrder.some((iid) => {
                const ib = inbounds.find((x) => x.id === iid);
                return ib?.protocol === "telemt" && inboundIds[iid];
              }) ? (
                <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                    {t("pages.clients.telemtAdTagsTitle", {
                      defaultValue: "Telemt AD tags (per inbound)",
                    })}
                  </p>
                  <p className="text-xs text-[var(--fg-subtle)]">
                    {t("pages.clients.telemtAdTagsHint", {
                      defaultValue:
                        "Optional 32 hex chars from @MTProxybot per Telemt inbound. Overrides the inbound global ad_tag for this client only.",
                    })}
                  </p>
                  {inboundSubscriptionOrder
                    .filter((iid) => {
                      const ib = inbounds.find((x) => x.id === iid);
                      return ib?.protocol === "telemt" && inboundIds[iid];
                    })
                    .map((iid) => {
                      const ib = inbounds.find((x) => x.id === iid);
                      const label = ib?.remark?.trim() || `Inbound ${iid}`;
                      const key = String(iid);
                      return (
                        <div key={iid}>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor={id(`telemt-ad-${iid}`)}
                          >
                            {label}
                          </label>
                          <Input
                            id={id(`telemt-ad-${iid}`)}
                            className="font-mono text-xs"
                            placeholder="32 hex from MTProxybot"
                            value={telemtAdTags[key] ?? ""}
                            onChange={(e) =>
                              setTelemtAdTags((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                            spellCheck={false}
                          />
                        </div>
                      );
                    })}
                </div>
              ) : null}
              {isEdit ? (
                <p className="mt-2 text-xs text-[var(--fg-subtle)]">
                  {t("pages.clients.editInboundsHint", {
                    defaultValue: "Changing inbounds replaces all assignments for this client.",
                  })}
                </p>
              ) : null}
            </div>

            {/* --- Group section --- */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <SectionLabel icon={Users}>
                {t("pages.clients.group")}
              </SectionLabel>
              <SelectNative
                id={id("group")}
                value={form.groupId}
                onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
              >
                <option value="">{t("none")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </SelectNative>
              <p className="mt-1 text-xs text-[var(--fg-subtle)]">{t("pages.clients.selectGroup")}</p>
            </div>

            {/* --- HWID section --- */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <SectionLabel icon={Shield}>
                {t("hwidSettings")}
              </SectionLabel>
              <CheckboxField
                checked={form.hwidEnabled}
                onChange={(e) => setForm((f) => ({ ...f, hwidEnabled: e.target.checked }))}
                label={t("hwidEnabled")}
              />
              <div className="mt-3">
                <label
                  className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                  htmlFor={id("max-hwid")}
                >
                  {t("maxHwid")}
                </label>
                <Input
                  id={id("max-hwid")}
                  type="number"
                  min={0}
                  step={1}
                  value={form.maxHwid}
                  disabled={!form.hwidEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, maxHwid: e.target.value }))}
                />
                <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                  {t("pages.clients.maxHwidDesc")}
                </p>
              </div>
              {showExistingChrome ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3 !h-9 !gap-2 !text-xs"
                  onClick={() => onOpenHwid()}
                >
                  <Smartphone size={14} />
                  {t("pages.clients.viewHwid", { defaultValue: "Devices" })}
                </Button>
              ) : null}
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <SectionLabel icon={Shield}>
                {t("pages.clients.ipLimitTitle", { defaultValue: "IP limit" })}
              </SectionLabel>
              <CheckboxField
                checked={form.ipLimitEnabled}
                onChange={(e) => setForm((f) => ({ ...f, ipLimitEnabled: e.target.checked }))}
                label={t("pages.clients.ipLimitEnabled", { defaultValue: "Limit concurrent IPs" })}
              />
              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor={id("max-ips")}>
                  {t("pages.clients.maxIPs", { defaultValue: "Max unique IPs" })}
                </label>
                <Input
                  id={id("max-ips")}
                  type="number"
                  min={1}
                  disabled={!form.ipLimitEnabled}
                  value={form.maxIPs}
                  onChange={(e) => setForm((f) => ({ ...f, maxIPs: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-[var(--border)] pt-4">
          <div>
            <label
              className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[var(--fg-muted)]"
              htmlFor={id("announce")}
            >
              <Megaphone size={12} />
              {t("pages.clients.addModalAnnounce")}
            </label>
            <TextArea
              id={id("announce")}
              value={form.announce}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, announce: e.target.value }))}
            />
            <p className="mt-1 text-xs text-[var(--fg-subtle)]">
              {t("pages.clients.addModalAnnounceHint")} · {form.announce.length}/200
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClientsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const ws = usePanelWebSocket();
  const tablePrefsReadyRef = useRef(false);
  const resyncAfterDisconnect = useRef(false);
  /** key: client id — debounce offline after traffic drops the email from the online set. */
  const offlineStatusTimersRef = useRef<
    Map<number, ReturnType<typeof setTimeout>>
  >(new Map());
  const [rows, setRows] = useState<ClientCard[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheetMode, setSheetMode] = useState<ClientSheetMode | null>(null);
  const [sheetClientId, setSheetClientId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [fetchingClient, setFetchingClient] = useState(false);
  const [inbounds, setInbounds] = useState<InboundOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [form, setForm] = useState<ClientFormState>(FORM_DEFAULT);
  const [inboundIds, setInboundIds] = useState<Record<number, boolean>>({});
  const [inboundSubscriptionOrder, setInboundSubscriptionOrder] = useState<number[]>([]);
  const [telemtAdTags, setTelemtAdTags] = useState<Record<string, string>>({});

  const [keysModalClientId, setKeysModalClientId] = useState<number | null>(null);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysRows, setKeysRows] = useState<ShareLinkRow[]>([]);

  const [hwidModalClientId, setHwidModalClientId] = useState<number | null>(null);
  const [hwidLoading, setHwidLoading] = useState(false);
  const [hwidRows, setHwidRows] = useState<HwidRow[]>([]);
  const [hwidDeleteRow, setHwidDeleteRow] = useState<HwidRow | null>(null);
  const [hwidDeleteBusy, setHwidDeleteBusy] = useState(false);
  const [hwidBlockBusyId, setHwidBlockBusyId] = useState<number | null>(null);

  const [sessionsModalClientId, setSessionsModalClientId] = useState<number | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsData, setSessionsData] = useState<ClientSessionsResponse | null>(null);
  const [sessionsDropBusy, setSessionsDropBusy] = useState(false);
  const [sessionIpBlockBusy, setSessionIpBlockBusy] = useState<string | null>(null);

  const [sheetInlineBusy, setSheetInlineBusy] = useState<"reset" | "clearHwid" | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const defaultTablePrefs = useMemo(() => defaultClientsTablePrefs(), []);
  const [filtersVisible, setFiltersVisible] = useState(defaultTablePrefs.filtersVisible);
  const [columnFilters, setColumnFilters] = useState<Record<ColumnFilterId, string>>(
    defaultTablePrefs.columnFilters,
  );
  const [filterConn, setFilterConn] = useState<FilterConn>(defaultTablePrefs.filterConn);
  const [filterAcct, setFilterAcct] = useState<FilterAcct>(defaultTablePrefs.filterAcct);
  const [filterInboundId, setFilterInboundId] = useState<string>(
    defaultTablePrefs.filterInboundId,
  );
  const [filterGroupId, setFilterGroupId] = useState<string>(
    defaultTablePrefs.filterGroupId,
  );
  const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);
  const [inboundFilterOptions, setInboundFilterOptions] = useState<InboundOption[]>(
    [],
  );
  const [columnVisibility, setColumnVisibility] = useState<
    Record<DataColumnId, boolean>
  >(defaultTablePrefs.columnVisibility);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  const [trafficCompareOp, setTrafficCompareOp] = useState<CompareOp>(
    defaultTablePrefs.trafficCompareOp,
  );
  const [expiryCompareOp, setExpiryCompareOp] = useState<CompareOp>(
    defaultTablePrefs.expiryCompareOp,
  );
  const [sortKey, setSortKey] = useState<ClientSortKey>(defaultTablePrefs.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultTablePrefs.sortDir);
  const headerSelectRef = useRef<HTMLInputElement>(null);
  const [subscriptionQrUrl, setSubscriptionQrUrl] = useState<string | null>(null);
  const [subscriptionEncryptionData, setSubscriptionEncryptionData] = useState<{
    happEncryptedUrl?: string;
    v2raytunEncryptedUrl?: string;
  } | null>(null);
  /** Full connection key / share link text to show as QR (same as copy). */
  const [connectionKeyQrText, setConnectionKeyQrText] = useState<string | null>(null);
  const [clientsConfirmAction, setClientsConfirmAction] = useState<ClientsConfirmAction>(null);
  const [clientsConfirmBusy, setClientsConfirmBusy] = useState(false);
  const [bulkAssignGroupOpen, setBulkAssignGroupOpen] = useState(false);
  const [bulkAssignGroupId, setBulkAssignGroupId] = useState("");
  const [bulkAssignGroupBusy, setBulkAssignGroupBusy] = useState(false);
  const sheetClient =
    sheetClientId != null ? rows.find((x) => x.id === sheetClientId) : undefined;
  const keysModalClient =
    keysModalClientId != null ? rows.find((c) => c.id === keysModalClientId) : undefined;
  const keysModalInboundCount = keysModalClient?.inbounds?.length ?? 0;

  const toggleInboundSelection = useCallback((ibId: number) => {
    setInboundIds((m) => {
      const willSelect = !m[ibId];
      setInboundSubscriptionOrder((order) => {
        if (willSelect) {
          if (order.includes(ibId)) return order;
          return [...order, ibId];
        }
        return order.filter((x) => x !== ibId);
      });
      return { ...m, [ibId]: willSelect };
    });
  }, []);

  const moveInboundSubscription = useCallback((idx: number, dir: -1 | 1) => {
    setInboundSubscriptionOrder((o) => {
      const j = idx + dir;
      if (j < 0 || j >= o.length) return o;
      const n = [...o];
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });
  }, []);

  const copyText = (text: string) => {
    void copyTextToClipboard(text)
      .then(() => {
        toast.success(t("copySuccess"));
      })
      .catch(() => {
        toast.error(t("pages.publicSub.copyFailed", { defaultValue: "Could not copy." }));
      });
  };

  const load = useCallback(async () => {
    offlineStatusTimersRef.current.forEach((tid) => clearTimeout(tid));
    offlineStatusTimersRef.current.clear();
    setLoading(true);
    const r = await getJson<ClientCard[]>(panel("client/list"));
    setLoading(false);
    if (r.success && r.obj) {
      const list = (r.obj as ClientCard[]) || [];
      setRows(
        list.map((c) => ({
          ...c,
          inbounds: Array.isArray(c.inbounds) ? c.inbounds : [],
          activeHwidCount: c.activeHwidCount ?? 0,
        })),
      );
    } else {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await getUiPref("clientsTablePrefs");
      if (cancelled) return;
      const prefs = parseClientsTablePrefs(raw);
      setFiltersVisible(prefs.filtersVisible);
      setColumnFilters(prefs.columnFilters);
      setFilterConn(prefs.filterConn);
      setFilterAcct(prefs.filterAcct);
      setFilterInboundId(prefs.filterInboundId);
      setFilterGroupId(prefs.filterGroupId);
      setColumnVisibility(prefs.columnVisibility);
      setTrafficCompareOp(prefs.trafficCompareOp);
      setExpiryCompareOp(prefs.expiryCompareOp);
      setSortKey(prefs.sortKey);
      setSortDir(prefs.sortDir);
      tablePrefsReadyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tablePrefsReadyRef.current) return;
    const timer = window.setTimeout(() => {
      void setUiPref(
        "clientsTablePrefs",
        encodeClientsTablePrefs({
          columnVisibility,
          columnFilters,
          filtersVisible,
          filterConn,
          filterAcct,
          filterInboundId,
          filterGroupId,
          trafficCompareOp,
          expiryCompareOp,
          sortKey,
          sortDir,
        }),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    columnVisibility,
    columnFilters,
    filtersVisible,
    filterConn,
    filterAcct,
    filterInboundId,
    filterGroupId,
    trafficCompareOp,
    expiryCompareOp,
    sortKey,
    sortDir,
  ]);

  useEffect(() => {
    if (!ws) return;
    const offlineTimers = offlineStatusTimersRef.current;
    const onClients = (p: unknown) => {
      if (!Array.isArray(p) || p.length === 0) return;
      setRows((prev) => {
        if (!prev.length) return prev;
        const byId = new Map<number, WsClientEntity>();
        for (const e of p as WsClientEntity[]) {
          if (!e || typeof e !== "object") continue;
          const id = entityPayloadId(e);
          if (id == null) continue;
          byId.set(id, e);
        }
        if (byId.size === 0) return prev;
        return prev.map((row) => {
          const e = byId.get(row.id);
          if (!e) return row;
          return mergeClientWithEntity(row, e);
        });
      });
    };
    const onTraffic = (p: unknown) => {
      if (!p || typeof p !== "object") return;
      const pl = p as Record<string, unknown>;
      if (!("onlineClients" in pl) && !("lastOnlineMap" in pl)) return;
      const lastOnlineMap =
        pl.lastOnlineMap && typeof pl.lastOnlineMap === "object"
          ? (pl.lastOnlineMap as Record<string, unknown>)
          : {};
      const onlineList = Array.isArray(pl.onlineClients) ? pl.onlineClients : [];
      const onlineSet = new Set(
        onlineList
          .filter((e): e is string => typeof e === "string")
          .map(normClientName),
      );
      setRows((prev) =>
        prev.map((row) => {
          const k = normClientName(row.name);
          const serverOnline = onlineSet.has(k);
          const lo = findLastOnlineForName(row.name, lastOnlineMap);
          const base: ClientCard = {
            ...row,
            ...(lo != null ? { lastOnline: lo } : {}),
          };

          if (serverOnline) {
            const existing = offlineStatusTimersRef.current.get(row.id);
            if (existing != null) {
              clearTimeout(existing);
              offlineStatusTimersRef.current.delete(row.id);
            }
            return { ...base, isOnline: true };
          }

          if (row.isOnline !== true) {
            return { ...base, isOnline: false };
          }

          if (!offlineStatusTimersRef.current.has(row.id)) {
            const clientId = row.id;
            const tid = setTimeout(() => {
              setRows((cur) =>
                cur.map((r) =>
                  r.id === clientId ? { ...r, isOnline: false } : r,
                ),
              );
              offlineStatusTimersRef.current.delete(clientId);
            }, OFFLINE_STATUS_DELAY_MS);
            offlineStatusTimersRef.current.set(row.id, tid);
          }
          return { ...base, isOnline: true };
        }),
      );
    };
    const onDisc = () => {
      resyncAfterDisconnect.current = true;
    };
    const onConn = () => {
      if (resyncAfterDisconnect.current) {
        resyncAfterDisconnect.current = false;
        void load();
      }
    };
    ws.on("clients", onClients);
    ws.on("traffic", onTraffic);
    ws.on("disconnected", onDisc);
    ws.on("connected", onConn);
    return () => {
      offlineTimers.forEach((tid) => clearTimeout(tid));
      offlineTimers.clear();
      ws.off("clients", onClients);
      ws.off("traffic", onTraffic);
      ws.off("disconnected", onDisc);
      ws.off("connected", onConn);
    };
  }, [ws, load]);

  const openSessionsModal = async (clientId: number) => {
    setSessionsModalClientId(clientId);
    setSessionsData(null);
    setSessionsLoading(true);
    try {
      const r = await getJson<ClientSessionsResponse>(
        panel(`client/sessions/${clientId}`),
      );
      if (r.success && r.obj) {
        setSessionsData(r.obj as ClientSessionsResponse);
      } else {
        toast.error(
          (r as { msg?: string }).msg ||
            t("pages.clients.sessions.loadError", {
              defaultValue: "Failed to load sessions",
            }),
        );
      }
    } catch {
      toast.error(
        t("pages.clients.sessions.loadError", {
          defaultValue: "Failed to load sessions",
        }),
      );
    } finally {
      setSessionsLoading(false);
    }
  };

  const refreshSessionsModal = async () => {
    if (sessionsModalClientId == null) return;
    setSessionsLoading(true);
    try {
      const r = await getJson<ClientSessionsResponse>(
        panel(`client/sessions/${sessionsModalClientId}`),
      );
      if (r.success && r.obj) setSessionsData(r.obj as ClientSessionsResponse);
    } finally {
      setSessionsLoading(false);
    }
  };

  const dropAllSessions = async () => {
    if (sessionsModalClientId == null) return;
    setSessionsDropBusy(true);
    try {
      const r = await postJson(panel(`client/sessions/drop/${sessionsModalClientId}`), {});
      if (r.success) {
        toast.success(
          t("pages.clients.sessions.dropSuccess", {
            defaultValue: "Connections dropped",
          }),
        );
        await refreshSessionsModal();
      } else {
        toast.error((r as { msg?: string }).msg || t("fail"));
      }
    } catch {
      toast.error(t("fail"));
    } finally {
      setSessionsDropBusy(false);
    }
  };

  const dropSessionIp = async (ip: string) => {
    if (sessionsModalClientId == null) return;
    setSessionsDropBusy(true);
    try {
      const r = await postJson(panel(`client/sessions/drop/${sessionsModalClientId}`), {
        ips: [ip],
      });
      if (r.success) {
        toast.success(
          t("pages.clients.sessions.dropSuccess", {
            defaultValue: "Connections dropped",
          }),
        );
        await refreshSessionsModal();
      } else {
        toast.error((r as { msg?: string }).msg || t("fail"));
      }
    } catch {
      toast.error(t("fail"));
    } finally {
      setSessionsDropBusy(false);
    }
  };

  const isSessionIpBlocked = (ip: string, blocked?: string[]) => {
    const n = normalizePanelIp(ip);
    if (!blocked?.length) return false;
    return blocked.some((b) => normalizePanelIp(b) === n);
  };

  const toggleSessionIpBlocked = async (ip: string, blocked: boolean) => {
    if (sessionsModalClientId == null) return;
    setSessionIpBlockBusy(ip);
    try {
      const r = await postJson(
        panel(`client/sessions/block/${sessionsModalClientId}`),
        { ip, blocked },
        true,
      );
      if (r.success) {
        await refreshSessionsModal();
        void load();
      } else {
        toast.error((r as { msg?: string }).msg || t("fail"));
      }
    } catch {
      toast.error(t("fail"));
    } finally {
      setSessionIpBlockBusy(null);
    }
  };

  const toggleHwidBlocked = async (h: HwidRow) => {
    if (hwidModalClientId == null) return;
    const next = !h.blocked;
    setHwidBlockBusyId(h.id);
    try {
      const r = await postJson(panel(`client/hwid/block/${h.id}`), { blocked: next }, true);
      if (r.success) {
        setHwidRows((rows) =>
          rows.map((x) => (x.id === h.id ? { ...x, blocked: next } : x)),
        );
        void load();
      } else {
        toast.error((r as { msg?: string }).msg || t("fail"));
      }
    } catch {
      toast.error(t("fail"));
    } finally {
      setHwidBlockBusyId(null);
    }
  };

  const openKeysModal = async (clientId: number) => {
    setKeysModalClientId(clientId);
    setKeysLoading(true);
    setKeysRows([]);
    try {
      const r = await getJson<ShareLinkRow[]>(panel(`client/links/${clientId}`));
      if (r.success && Array.isArray(r.obj)) {
        setKeysRows(r.obj as ShareLinkRow[]);
      } else {
        setKeysRows([]);
      }
    } catch {
      toast.error(t("pages.clients.addError"));
      setKeysRows([]);
    } finally {
      setKeysLoading(false);
    }
  };

  const openHwidModal = async (clientId: number) => {
    setHwidModalClientId(clientId);
    setHwidLoading(true);
    setHwidRows([]);
    try {
      const r = await getJson<HwidRow[]>(panel(`client/hwid/list/${clientId}`));
      if (r.success && Array.isArray(r.obj)) {
        setHwidRows(r.obj as HwidRow[]);
      } else {
        setHwidRows([]);
      }
    } catch {
      toast.error(t("pages.clients.addError"));
      setHwidRows([]);
    } finally {
      setHwidLoading(false);
    }
  };

  const openDeleteClientConfirm = (c: ClientCard) => {
    setClientsConfirmAction({ kind: "deleteOne", client: c });
  };

  const resetTraffic = (c: ClientCard) => {
    const forSheet = sheetClientId === c.id;
    if (forSheet) setSheetInlineBusy("reset");
    void (async () => {
      try {
        const r = await postJson(panel(`client/resetTraffic/${c.id}`));
        if (r.success) {
          toast.success(
            (r as { msg?: string }).msg ||
              t("pages.inbounds.toasts.resetInboundClientTrafficSuccess", {
                defaultValue: "Traffic reset.",
              }),
          );
          void load();
        } else {
          toast.error((r as { msg?: string }).msg || t("pages.clients.addError"));
        }
      } finally {
        if (forSheet) setSheetInlineBusy(null);
      }
    })();
  };

  const clearHwid = (c: ClientCard) => {
    const forSheet = sheetClientId === c.id;
    if (forSheet) setSheetInlineBusy("clearHwid");
    void (async () => {
      try {
        const r = await postJson(panel(`client/clearHwid/${c.id}`));
        if (r.success) {
          toast.success(
            (r as { msg?: string }).msg ||
              t("pages.clients.hwidCleared", { defaultValue: "HWID records cleared." }),
          );
          void load();
        } else {
          toast.error((r as { msg?: string }).msg || t("pages.clients.addError"));
        }
      } finally {
        if (forSheet) setSheetInlineBusy(null);
      }
    })();
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (
      sheetMode === "edit" &&
      sheetClientId != null &&
      !rows.some((r) => r.id === sheetClientId)
    ) {
      setSheetMode(null);
      setSheetClientId(null);
      setForm({ ...FORM_DEFAULT });
      setInboundIds({});
      setInboundSubscriptionOrder([]);
      setEditingId(null);
      setFetchingClient(false);
    }
  }, [rows, sheetMode, sheetClientId]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (rows.some((r) => r.id === id)) next.add(id);
      }
      return next;
    });
  }, [rows]);

  useEffect(() => {
    if (!bulkMode) setSelectedIds(new Set());
  }, [bulkMode]);

  useEffect(() => {
    void (async () => {
      const [gR, iR] = await Promise.all([
        getJson<GroupOption[]>(panel("group/list")),
        getJson<InboundOption[]>(panel("api/inbounds/list")),
      ]);
      if (gR.success && Array.isArray(gR.obj)) {
        setGroupOptions(
          (gR.obj as GroupOption[]).map((x) => ({
            id: x.id,
            name: x.name ?? `Group ${x.id}`,
            description: x.description ?? "",
          })),
        );
      }
      if (iR.success && Array.isArray(iR.obj)) {
        setInboundFilterOptions(
          (iR.obj as InboundOption[]).map((x) => ({
            id: x.id,
            remark: x.remark || `Inbound ${x.id}`,
            protocol: x.protocol,
            port: x.port,
          })),
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (!columnsMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (
        columnsMenuRef.current &&
        !columnsMenuRef.current.contains(e.target as Node)
      ) {
        setColumnsMenuOpen(false);
      }
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [columnsMenuOpen]);

  const filteredRows = useMemo(() => {
    const noExpiryLabel = t("pages.clients.cardNoExpiry", {
      defaultValue: "No expiry",
    });
    const expiredLabel = t("pages.clients.cardExpired", {
      defaultValue: "Expired",
    });
    const nameNeedle = columnFilters.name.trim().toLowerCase();
    const commentNeedle = columnFilters.comment.trim().toLowerCase();
    const hwidNeedle = columnFilters.hwid.trim().toLowerCase();
    const trafficRaw = columnFilters.traffic.trim();
    const expiryRaw = columnFilters.expiry.trim();
    const trafficNeedle = trafficCompareOp === "" ? trafficRaw.toLowerCase() : "";
    const expiryNeedle = expiryCompareOp === "" ? expiryRaw.toLowerCase() : "";
    const trafficThreshold =
      trafficCompareOp !== "" ? parseTrafficFilterBytes(trafficRaw) : null;
    const expiryBounds =
      expiryCompareOp !== "" ? parseExpiryFilterDayBounds(expiryRaw) : null;

    const anySelectFilter =
      filterConn !== "" ||
      filterAcct !== "" ||
      filterInboundId !== "" ||
      filterGroupId !== "";
    const anyTextHaystack =
      nameNeedle.length > 0 ||
      commentNeedle.length > 0 ||
      hwidNeedle.length > 0 ||
      trafficNeedle.length > 0 ||
      expiryNeedle.length > 0;
    const anyTrafficCmp =
      trafficCompareOp !== "" && trafficThreshold != null;
    const anyExpiryCmp = expiryCompareOp !== "" && expiryBounds != null;

    return rows.filter((r) => {
      const isOnline = clientIsOnlineConsideringLastSeen(r);
      if (filterConn === "online" && !isOnline) return false;
      if (filterConn === "offline" && isOnline) return false;
      if (!rowMatchesAccountFilter(r, filterAcct)) return false;

      if (filterInboundId === "none") {
        if ((r.inbounds?.length ?? 0) > 0) return false;
      } else if (filterInboundId !== "") {
        const iid = Number(filterInboundId);
        if (
          !Number.isFinite(iid) ||
          !(r.inbounds ?? []).some((x) => x.id === iid)
        ) {
          return false;
        }
      }

      if (filterGroupId === "none") {
        if (r.groupId != null) return false;
      } else if (filterGroupId !== "") {
        const gid = Number(filterGroupId);
        if (!Number.isFinite(gid) || r.groupId !== gid) return false;
      }

      if (
        !anySelectFilter &&
        !anyTextHaystack &&
        !anyTrafficCmp &&
        !anyExpiryCmp
      ) {
        return true;
      }

      const hay = buildClientTextFilterHaystacks(
        r,
        t,
        noExpiryLabel,
        expiredLabel,
      );

      if (nameNeedle && !hay.name.includes(nameNeedle)) return false;
      if (commentNeedle && !hay.comment.includes(commentNeedle)) return false;
      if (hwidNeedle && !hay.hwid.includes(hwidNeedle)) return false;

      if (trafficCompareOp === "") {
        if (trafficNeedle && !hay.traffic.includes(trafficNeedle)) return false;
      } else if (trafficThreshold != null) {
        const used = r.up + r.down;
        if (trafficCompareOp === "gt" && !(used > trafficThreshold))
          return false;
        if (trafficCompareOp === "lt" && !(used < trafficThreshold))
          return false;
        if (trafficCompareOp === "eq" && used !== trafficThreshold)
          return false;
      }

      if (expiryCompareOp === "") {
        if (expiryNeedle && !hay.expiry.includes(expiryNeedle)) return false;
      } else if (expiryBounds != null) {
        const ems = rowExpiryMsForFilter(r);
        if (ems == null) return false;
        const { start, end } = expiryBounds;
        if (expiryCompareOp === "gt" && !(ems > end)) return false;
        if (expiryCompareOp === "lt" && !(ems < start)) return false;
        if (expiryCompareOp === "eq" && !(ems >= start && ems <= end))
          return false;
      }

      return true;
    });
  }, [
    rows,
    columnFilters,
    filterConn,
    filterAcct,
    filterInboundId,
    filterGroupId,
    trafficCompareOp,
    expiryCompareOp,
    t,
  ]);

  const hasActiveFilters = useMemo(() => {
    if (
      filterConn !== "" ||
      filterAcct !== "" ||
      filterInboundId !== "" ||
      filterGroupId !== "" ||
      trafficCompareOp !== "" ||
      expiryCompareOp !== ""
    ) {
      return true;
    }
    return (Object.keys(columnFilters) as ColumnFilterId[]).some(
      (k) => columnFilters[k].trim() !== "",
    );
  }, [
    columnFilters,
    filterConn,
    filterAcct,
    filterInboundId,
    filterGroupId,
    trafficCompareOp,
    expiryCompareOp,
  ]);

  const displayedRows = useMemo(() => {
    const next = [...filteredRows];
    next.sort((a, b) =>
      compareClients(a, b, sortKey, sortDir, groupOptions),
    );
    return next;
  }, [filteredRows, sortKey, sortDir, groupOptions]);

  const visibleDataColumnCount = useMemo(
    () => DATA_COLUMN_ORDER.filter((k) => columnVisibility[k]).length,
    [columnVisibility],
  );

  useEffect(() => {
    if (!columnVisibility[sortKey]) {
      setSortKey("name");
      setSortDir("asc");
    }
  }, [columnVisibility, sortKey]);

  const displayedIds = useMemo(
    () => displayedRows.map((r) => r.id),
    [displayedRows],
  );

  const clientsStats = useMemo(() => {
    const total = rows.length;
    const online = rows.reduce(
      (acc, r) => acc + (clientIsOnlineConsideringLastSeen(r) ? 1 : 0),
      0,
    );
    return {
      total,
      online,
      offline: Math.max(0, total - online),
      filtered: displayedRows.length,
    };
  }, [rows, displayedRows.length]);

  const hwidUserAgentStats = useMemo(() => {
    const unknownLabel = t("pages.clients.hwidUserAgentUnknown", {
      defaultValue: "Unknown",
    });
    const byUserAgent = new Map<string, number>();
    let total = 0;
    for (const row of hwidRows) {
      const label = row.userAgent?.trim() ? row.userAgent.trim() : unknownLabel;
      byUserAgent.set(label, (byUserAgent.get(label) ?? 0) + 1);
      total += 1;
    }
    return Array.from(byUserAgent.entries())
      .map(([label, count]) => {
        const percentRaw = total > 0 ? (count / total) * 100 : 0;
        const percentRounded = Math.round(percentRaw * 10) / 10;
        const percentLabel = `${Number.isInteger(percentRounded) ? percentRounded.toFixed(0) : percentRounded.toFixed(1)}%`;
        return { label, count, percentRaw, percentLabel };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [hwidRows, t]);

  const hwidUserAgentPieData = useMemo(() => {
    const palette = [
      "#3b82f6",
      "#8b5cf6",
      "#14b8a6",
      "#f59e0b",
      "#ef4444",
      "#10b981",
      "#06b6d4",
      "#a855f7",
      "#f97316",
      "#84cc16",
    ];
    let current = 0;
    const parts = hwidUserAgentStats.map((item, index) => {
      const start = current;
      current += item.percentRaw;
      return {
        ...item,
        color: palette[index % palette.length],
        start,
        end: current,
      };
    });
    const gradient =
      parts.length > 0
        ? `conic-gradient(${parts
            .map((part) => `${part.color} ${part.start}% ${part.end}%`)
            .join(", ")})`
        : "conic-gradient(var(--border) 0% 100%)";
    return { parts, gradient };
  }, [hwidUserAgentStats]);

  const selectedOnPage = useMemo(
    () => displayedIds.filter((id) => selectedIds.has(id)),
    [displayedIds, selectedIds],
  );

  const allPageSelected =
    displayedIds.length > 0 && selectedOnPage.length === displayedIds.length;
  const somePageSelected =
    selectedOnPage.length > 0 && selectedOnPage.length < displayedIds.length;

  useEffect(() => {
    const el = headerSelectRef.current;
    if (el) el.indeterminate = somePageSelected;
  }, [somePageSelected]);

  const defaultDirForKey = (k: ClientSortKey): SortDir => {
    switch (k) {
      case "id":
      case "name":
      case "comment":
      case "expiry":
      case "state":
      case "group":
      case "uuid":
      case "subId":
        return "asc";
      default:
        return "desc";
    }
  };

  const toggleSort = (k: ClientSortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(defaultDirForKey(k));
    }
  };

  const bulkSelectedClients = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds],
  );

  const runBulkResetTraffic = () => {
    const list = bulkSelectedClients;
    if (!list.length) {
      toast.error(t("pages.clients.noClientsSelected"));
      return;
    }
    setClientsConfirmAction({ kind: "bulkReset", clients: [...list] });
  };

  const runBulkClearHwid = () => {
    const list = bulkSelectedClients;
    if (!list.length) {
      toast.error(t("pages.clients.noClientsSelected"));
      return;
    }
    setClientsConfirmAction({ kind: "bulkClearHwid", clients: [...list] });
  };

  const runBulkDelete = () => {
    const list = bulkSelectedClients;
    if (!list.length) {
      toast.error(t("pages.clients.noClientsSelected"));
      return;
    }
    setClientsConfirmAction({ kind: "bulkDelete", clients: [...list] });
  };

  const openBulkAssignGroup = () => {
    const list = bulkSelectedClients;
    if (!list.length) {
      toast.error(t("pages.clients.noClientsSelected"));
      return;
    }
    setBulkAssignGroupId("");
    setBulkAssignGroupOpen(true);
  };

  const submitBulkAssignGroup = async () => {
    const list = bulkSelectedClients;
    if (!list.length) {
      toast.error(t("pages.clients.noClientsSelected"));
      return;
    }
    if (bulkAssignGroupId === "") {
      toast.error(t("pages.clients.selectGroup"));
      return;
    }
    const clientIds = list.map((c) => c.id);
    setBulkAssignGroupBusy(true);
    try {
      let r: { success?: boolean; msg?: string };
      if (bulkAssignGroupId === "none") {
        r = await postJson(panel("group/0/removeClients"), { clientIds }, true);
      } else {
        const gid = Number(bulkAssignGroupId);
        if (!Number.isFinite(gid) || gid <= 0) {
          toast.error(t("pages.clients.selectGroup"));
          return;
        }
        r = await postJson(panel(`group/${gid}/assignClients`), { clientIds }, true);
      }
      if (r.success) {
        toast.success(
          r.msg ||
            (bulkAssignGroupId === "none"
              ? t("pages.clients.groupRemoved")
              : t("pages.clients.groupAssigned")),
        );
        setBulkAssignGroupOpen(false);
        setSelectedIds(new Set());
        void load();
      } else {
        toast.error(r.msg || t("pages.clients.addError"));
      }
    } catch {
      toast.error(t("pages.clients.addError"));
    } finally {
      setBulkAssignGroupBusy(false);
    }
  };

  const loadModalData = useCallback(async () => {
    const [inR, gR] = await Promise.all([
      getJson<InboundOption[]>(panel("api/inbounds/list")),
      getJson<GroupOption[]>(panel("group/list")),
    ]);
    if (inR.success && Array.isArray(inR.obj)) {
      setInbounds(
        (inR.obj as InboundOption[]).map((x) => ({
          id: x.id,
          remark: x.remark || `Inbound ${x.id}`,
          protocol: x.protocol,
          port: x.port,
        })),
      );
    } else {
      setInbounds([]);
    }
    if (gR.success && Array.isArray(gR.obj)) {
      setGroups(
        (gR.obj as GroupOption[]).map((x) => ({
          id: x.id,
          name: x.name ?? `Group ${x.id}`,
          description: x.description ?? "",
        })),
      );
    } else {
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    if (sheetMode === "create" || sheetMode === "edit") {
      void loadModalData();
    }
  }, [sheetMode, loadModalData]);

  const resetModal = useCallback(() => {
    setForm({ ...FORM_DEFAULT });
    setInboundIds({});
    setInboundSubscriptionOrder([]);
    setTelemtAdTags({});
    setEditingId(null);
    setFetchingClient(false);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetMode(null);
    setSheetClientId(null);
    setSheetInlineBusy(null);
    setSubscriptionQrUrl(null);
    resetModal();
  }, [resetModal]);

  const executeClientsConfirm = useCallback(async () => {
    if (!clientsConfirmAction) return;
    setClientsConfirmBusy(true);
    try {
      if (clientsConfirmAction.kind === "deleteOne") {
        const c = clientsConfirmAction.client;
        const r = await postJson(panel(`client/del/${c.id}`));
        if (r.success) {
          toast.success(
            (r as { msg?: string }).msg ||
              t("pages.clients.toasts.clientDeleteSuccess", { defaultValue: "Client deleted." }),
          );
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(c.id);
            return next;
          });
          if (sheetClientId === c.id) {
            closeSheet();
          }
          void load();
        } else {
          toast.error((r as { msg?: string }).msg || t("pages.clients.addError"));
        }
        return;
      }
      const list = clientsConfirmAction.clients;
      if (clientsConfirmAction.kind === "bulkReset") {
        let ok = 0;
        for (const c of list) {
          const r = await postJson(panel(`client/resetTraffic/${c.id}`));
          if (r.success) ok++;
        }
        if (ok === list.length) {
          toast.success(
            t("pages.clients.bulkOkReset", {
              count: ok,
              defaultValue: "Traffic reset for {{count}} clients.",
            }),
          );
        } else {
          toast.error(
            t("pages.clients.bulkPartial", {
              ok,
              fail: list.length - ok,
              defaultValue: "{{ok}} succeeded, {{fail}} failed.",
            }),
          );
        }
        setSelectedIds(new Set());
        void load();
        return;
      }
      if (clientsConfirmAction.kind === "bulkClearHwid") {
        let ok = 0;
        for (const c of list) {
          const r = await postJson(panel(`client/clearHwid/${c.id}`));
          if (r.success) ok++;
        }
        if (ok === list.length) {
          toast.success(
            t("pages.clients.bulkOkClearHwid", {
              count: ok,
              defaultValue: "HWID cleared for {{count}} clients.",
            }),
          );
        } else {
          toast.error(
            t("pages.clients.bulkPartial", {
              ok,
              fail: list.length - ok,
              defaultValue: "{{ok}} succeeded, {{fail}} failed.",
            }),
          );
        }
        setSelectedIds(new Set());
        void load();
        return;
      }
      let ok = 0;
      for (const c of list) {
        const r = await postJson(panel(`client/del/${c.id}`));
        if (r.success) ok++;
      }
      if (ok === list.length) {
        toast.success(
          t("pages.clients.bulkOkDelete", {
            count: ok,
            defaultValue: "{{count}} clients deleted.",
          }),
        );
      } else {
        toast.error(
          t("pages.clients.bulkPartial", {
            ok,
            fail: list.length - ok,
            defaultValue: "{{ok}} succeeded, {{fail}} failed.",
          }),
        );
      }
      setSelectedIds(new Set());
      if (sheetClientId != null && list.some((c) => c.id === sheetClientId)) {
        closeSheet();
      }
      void load();
    } finally {
      setClientsConfirmBusy(false);
      setClientsConfirmAction(null);
    }
  }, [clientsConfirmAction, closeSheet, load, sheetClientId, t, toast]);

  const openAdd = () => {
    resetModal();
    setSheetMode("create");
    setSheetClientId(null);
  };

  const loadClientIntoForm = async (id: number) => {
    setEditingId(id);
    setFetchingClient(true);
    try {
      const r = await getJson<ClientDetail>(panel(`client/get/${id}`));
      if (!r.success || !r.obj) {
        toast.error((r as { msg?: string }).msg || t("pages.clients.addError"));
        closeSheet();
        return;
      }
      const c = r.obj as ClientDetail;
      setForm({
        name: c.name ?? "",
        enable: c.enable !== false,
        totalGB: String(c.totalGB ?? 0),
        expiryLocal: msToDatetimeLocal(c.expiryTime ?? 0),
        groupId: c.groupId != null && c.groupId > 0 ? String(c.groupId) : "",
        comment: c.comment ?? "",
        reset: String(c.reset ?? 0),
        tgId: c.tgId != null && c.tgId > 0 ? String(c.tgId) : "",
        subId: c.subId ?? "",
        announce: c.announce ?? "",
        hwidEnabled: !!c.hwidEnabled,
        maxHwid: String(c.maxHwid ?? 0),
        ipLimitEnabled: !!c.ipLimitEnabled,
        maxIPs: String(c.maxIPs ?? 1),
      });
      const ids = (c.inboundIds ?? []).filter((iid) => iid > 0);
      const m: Record<number, boolean> = {};
      for (const iid of ids) {
        m[iid] = true;
      }
      setInboundIds(m);
      setInboundSubscriptionOrder(ids);
      setTelemtAdTags(
        c.telemtAdTags && typeof c.telemtAdTags === "object" ? { ...c.telemtAdTags } : {},
      );
    } catch {
      toast.error(t("pages.clients.addError"));
      closeSheet();
    } finally {
      setFetchingClient(false);
    }
  };

  const openSheetEdit = async (id: number) => {
    setSheetClientId(id);
    setSheetMode("edit");
    await loadClientIntoForm(id);
  };

  const submitClient = async () => {
    const name = form.name.trim().toLowerCase();
    if (!name) {
      toast.error(t("pages.clients.emailRequired"));
      return;
    }
    const comment = form.comment.trim();
    if (comment.length > 100) {
      toast.error(t("pages.clients.addModalCommentTooLong"));
      return;
    }
    const announce = form.announce.trim();
    if (announce.length > 200) {
      toast.error(t("pages.clients.addModalAnnounceTooLong"));
      return;
    }
    const selectedInboundIds = inboundSubscriptionOrder.filter((id) => inboundIds[id]);

    const telemtAdTagsPayload: Record<string, string> = {};
    for (const iid of selectedInboundIds) {
      const ib = inbounds.find((x) => x.id === iid);
      if (ib?.protocol !== "telemt") continue;
      const raw = (telemtAdTags[String(iid)] ?? "").trim();
      if (raw === "") {
        telemtAdTagsPayload[String(iid)] = "";
        continue;
      }
      if (!/^[0-9a-fA-F]{32}$/.test(raw)) {
        toast.error(
          t("pages.clients.telemtAdTagInvalid", {
            defaultValue: "Telemt AD tag must be empty or exactly 32 hex characters.",
          }),
        );
        return;
      }
      telemtAdTagsPayload[String(iid)] = raw.toLowerCase();
    }

    const totalGB = Number(form.totalGB);
    if (Number.isNaN(totalGB) || totalGB < 0) {
      toast.error(t("pages.clients.addError"));
      return;
    }

    const expiryTime =
      form.expiryLocal.trim() === ""
        ? 0
        : new Date(form.expiryLocal).getTime();
    if (form.expiryLocal.trim() !== "" && Number.isNaN(expiryTime)) {
      toast.error(t("pages.clients.addError"));
      return;
    }

    const groupIdNum =
      form.groupId === "" ? null : Number(form.groupId);
    if (groupIdNum != null && (Number.isNaN(groupIdNum) || groupIdNum <= 0)) {
      toast.error(t("pages.clients.addError"));
      return;
    }

    let maxHwid = 0;
    if (form.hwidEnabled) {
      maxHwid = parseInt(form.maxHwid, 10);
      if (Number.isNaN(maxHwid) || maxHwid < 0) {
        toast.error(t("pages.clients.addError"));
        return;
      }
    }

    const resetVal = parseInt(form.reset, 10);
    if (Number.isNaN(resetVal) || resetVal < 0) {
      toast.error(t("pages.clients.addError"));
      return;
    }

    let tgId = 0;
    if (form.tgId.trim() !== "") {
      tgId = parseInt(form.tgId, 10);
      if (Number.isNaN(tgId) || tgId < 0) {
        toast.error(t("pages.clients.addError"));
        return;
      }
    }

    setModalSubmitting(true);
    try {
      const isEdit = editingId != null;

      const subIdTrim = form.subId.trim();
      const body: Record<string, unknown> = {
        name,
        enable: form.enable,
        totalGB,
        expiryTime,
        hwidEnabled: form.hwidEnabled,
        maxHwid,
        ipLimitEnabled: form.ipLimitEnabled,
        maxIPs: form.ipLimitEnabled ? Math.max(1, parseInt(form.maxIPs, 10) || 1) : 0,
        reset: resetVal,
        tgId,
        subId: subIdTrim,
        comment,
        announce,
      };
      if (isEdit) {
        body.groupId = groupIdNum;
        body.inboundIds = selectedInboundIds;
      } else {
        if (groupIdNum != null) {
          body.groupId = groupIdNum;
        }
        if (selectedInboundIds.length > 0) {
          body.inboundIds = selectedInboundIds;
        }
      }
      if (Object.keys(telemtAdTagsPayload).length > 0) {
        body.telemtAdTags = telemtAdTagsPayload;
      }

      const url = isEdit
        ? panel(`client/update/${editingId}`)
        : panel("client/add");

      const r = await postJson<unknown>(url, body, true);
      if (r.success) {
        const msg = (r as { msg?: string }).msg;
        const obj = (r as { obj?: { id?: number; uuid?: string; subId?: string } }).obj;
        if (!isEdit && obj?.uuid) {
          try {
            await copyTextToClipboard(obj.uuid);
            toast.success(
              msg ||
                t("pages.clients.createdWithUuidCopied", {
                  defaultValue: "Client created. UUID copied to clipboard.",
                }),
            );
          } catch {
            toast.success(
              msg || `${t("pages.clients.addSuccess")} · UUID: ${obj.uuid}`,
            );
          }
        } else {
          toast.success(msg || (isEdit ? t("pages.clients.editSuccess", { defaultValue: "Client updated." }) : t("pages.clients.addSuccess")));
        }
        if (!isEdit && obj?.id) {
          setSheetClientId(obj.id);
          setSheetMode("edit");
          await load();
          await loadClientIntoForm(obj.id);
        } else {
          void load();
        }
      } else {
        toast.error(
          (r as { msg?: string }).msg || t("pages.clients.addError"),
        );
      }
    } catch {
      toast.error(t("pages.clients.addError"));
    } finally {
      setModalSubmitting(false);
    }
  };

  const isEdit = editingId != null;
  const sheetOpen = sheetMode !== null;

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("menu.clients")}
        icon={Users}
        iconTone="info"
        actions={
          <>
            <Button
              variant={bulkMode ? "primary" : "secondary"}
              onClick={() => setBulkMode((v) => !v)}
              className="!gap-2"
            >
              <ListChecks size={16} />
              {bulkMode
                ? t("pages.clients.bulkDone", { defaultValue: "Done" })
                : t("pages.clients.bulkActions", { defaultValue: "Bulk actions" })}
            </Button>
            <Button variant="secondary" onClick={openAdd} className="!gap-2">
              <Plus size={16} />
              {t("pages.clients.addClient")}
            </Button>
            <SectionHelpModal
              titleKey="pages.clients.helpModalTitle"
              paragraphKeys={[
                "pages.clients.helpModalP1",
                "pages.clients.helpModalP2",
                "pages.clients.helpModalP3",
                "pages.clients.helpModalP4",
              ]}
            />
          </>
        }
      />
      <Reveal>
      {rows.length > 0 ? (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Surface className="p-3">
            <p className="text-[11px] uppercase tracking-wider text-[var(--fg-subtle)]">
              {t("pages.clients.statsUsersTotal", { defaultValue: "Users total" })}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--fg)]">
              {clientsStats.total}
            </p>
          </Surface>
          <Surface className="p-3">
            <p className="text-[11px] uppercase tracking-wider text-[var(--fg-subtle)]">
              {t("pages.clients.statsUsersOnline", { defaultValue: "Online users" })}
            </p>
            <p className="mt-1 text-lg font-semibold text-emerald-500">
              {clientsStats.online}
            </p>
          </Surface>
          <Surface className="p-3">
            <p className="text-[11px] uppercase tracking-wider text-[var(--fg-subtle)]">
              {t("pages.clients.statsUsersOffline", { defaultValue: "Offline users" })}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--fg)]">
              {clientsStats.offline}
            </p>
          </Surface>
          <Surface className="p-3">
            <p className="text-[11px] uppercase tracking-wider text-[var(--fg-subtle)]">
              {t("pages.clients.statsUsersShown", { defaultValue: "Shown by filters" })}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--fg)]">
              {clientsStats.filtered}
            </p>
          </Surface>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
              <IconButton
                type="button"
                label={
                  filtersVisible
                    ? t("pages.clients.filterToggleHide", {
                        defaultValue: "Hide column filters",
                      })
                    : t("pages.clients.filterToggleShow", {
                        defaultValue: "Show column filters",
                      })
                }
                aria-pressed={filtersVisible}
                className={
                  filtersVisible
                    ? "!border-[color-mix(in_oklab,var(--accent)_40%,var(--border))] !bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] !text-[var(--accent)]"
                    : undefined
                }
                onClick={() => setFiltersVisible((v) => !v)}
              >
                <Filter size={18} />
              </IconButton>
              <div className="relative" ref={columnsMenuRef}>
                <IconButton
                  type="button"
                  label={t("pages.clients.columnsToggle", {
                    defaultValue: "Show / hide columns",
                  })}
                  aria-expanded={columnsMenuOpen}
                  className={
                    columnsMenuOpen
                      ? "!border-[color-mix(in_oklab,var(--accent)_40%,var(--border))] !bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] !text-[var(--accent)]"
                      : undefined
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setColumnsMenuOpen((o) => !o);
                  }}
                >
                  <Columns3 size={18} />
                </IconButton>
                {columnsMenuOpen ? (
                  <div
                    className="absolute left-0 z-30 mt-1 min-w-[16rem] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] py-2 shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                    role="menu"
                  >
                    <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                      {t("pages.clients.columnsMenuTitle", {
                        defaultValue: "Columns",
                      })}
                    </p>
                    {DATA_COLUMN_ORDER.map((colId) => (
                      <label
                        key={colId}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]"
                      >
                        <Checkbox
                          checked={columnVisibility[colId]}
                          disabled={colId === "name"}
                          onChange={(e) => {
                            if (colId === "name") return;
                            setColumnVisibility((v) => ({
                              ...v,
                              [colId]: e.target.checked,
                            }));
                          }}
                        />
                        <span className="truncate" title={colId}>
                          {getDataColumnLabel(colId, t)}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-9 shrink-0 !gap-2 !text-xs"
                  onClick={() => {
                    setColumnFilters({ ...DEFAULT_COLUMN_FILTERS });
                    setFilterConn("");
                    setFilterAcct("");
                    setFilterInboundId("");
                    setFilterGroupId("");
                    setTrafficCompareOp("");
                    setExpiryCompareOp("");
                  }}
                >
                  {t("pages.clients.filterClear", {
                    defaultValue: "Reset filters",
                  })}
                </Button>
              ) : null}
        </div>
      ) : null}
      <Surface padding="none" className="overflow-visible">
        {loading && !rows.length ? (
          <div className="grid min-h-48 place-items-center">
            <Spinner size={32} />
          </div>
        ) : !rows.length ? (
          <div className="grid min-h-48 place-items-center px-4 py-12">
            <div className="flex flex-col items-center gap-3 text-center">
              <IconTile icon={Users} tone="neutral" size="lg" />
              <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
              <Button variant="primary" onClick={openAdd} className="!gap-2">
                <Plus size={16} />
                {t("pages.clients.addClient")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {bulkMode ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] px-3 py-2.5 sm:px-4">
                <span className="text-xs font-medium text-[var(--fg-muted)]">
                  {t("pages.clients.selectedCount")}: {selectedIds.size}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-8 !px-2.5 !text-xs"
                  disabled={!displayedIds.length}
                  onClick={() => setSelectedIds(new Set(displayedIds))}
                >
                  {t("pages.clients.selectAllFiltered", {
                    defaultValue: "Select all (filtered)",
                  })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-8 !px-2.5 !text-xs"
                  disabled={!selectedIds.size}
                  onClick={() => setSelectedIds(new Set())}
                >
                  {t("pages.clients.clearSelection")}
                </Button>
                <span className="mx-1 hidden h-4 w-px bg-[var(--border)] sm:inline" aria-hidden />
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-8 !gap-1.5 !px-2.5 !text-xs"
                  disabled={!selectedIds.size}
                  onClick={() => openBulkAssignGroup()}
                >
                  <Building2 size={14} />
                  {t("pages.clients.assignGroup")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-8 !gap-1.5 !px-2.5 !text-xs"
                  disabled={!selectedIds.size}
                  onClick={() => void runBulkResetTraffic()}
                >
                  <RotateCcw size={14} />
                  {t("pages.clients.resetTraffic", { defaultValue: "Reset traffic" })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-8 !gap-1.5 !px-2.5 !text-xs"
                  disabled={!selectedIds.size}
                  onClick={() => void runBulkClearHwid()}
                >
                  <Smartphone size={14} />
                  {t("pages.clients.clearHwid", { defaultValue: "Clear HWIDs" })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!h-8 !gap-1.5 !px-2.5 !text-xs text-red-600 dark:text-red-400"
                  disabled={!selectedIds.size}
                  onClick={() => void runBulkDelete()}
                >
                  <Trash2 size={14} />
                  {t("delete")}
                </Button>
              </div>
            ) : null}
            <div className="panel-data-table overflow-x-auto">
              <table className="w-full min-w-[1200px] border-collapse text-left text-sm">
                <thead>
                  <tr className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[var(--surface)]">
                    {bulkMode ? (
                      <th className="w-10 p-3">
                        <Checkbox
                          ref={headerSelectRef}
                          checked={allPageSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (e.target.checked) {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                for (const id of displayedIds) next.add(id);
                                return next;
                              });
                            } else {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                for (const id of displayedIds) next.delete(id);
                                return next;
                              });
                            }
                          }}
                          aria-label={t("pages.clients.selectAllFiltered", {
                            defaultValue: "Select all (filtered)",
                          })}
                        />
                      </th>
                    ) : null}
                    {DATA_COLUMN_ORDER.map((col) => {
                      if (!columnVisibility[col]) return null;
                      return (
                        <SortableTh
                          key={col}
                          label={getDataColumnLabel(col, t)}
                          sortKey={col}
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={toggleSort}
                          className={
                            col === "id"
                              ? "w-14 tabular-nums"
                              : col === "uuid" || col === "subId"
                                ? "min-w-[7.5rem]"
                                : undefined
                          }
                        />
                      );
                    })}
                  </tr>
                  {filtersVisible ? (
                    <tr className="border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]">
                      {bulkMode ? (
                        <th className="p-2 align-top" aria-hidden />
                      ) : null}
                      {DATA_COLUMN_ORDER.map((col) => {
                        if (!columnVisibility[col]) return null;
                        if (col === "name") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <ClientsColumnFilterInput
                                value={columnFilters.name}
                                onChange={(v) =>
                                  setColumnFilters((f) => ({ ...f, name: v }))
                                }
                                placeholder={t("pages.clients.filterColEmail", {
                                  defaultValue: "Contains…",
                                })}
                              />
                            </th>
                          );
                        }
                        if (col === "comment") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <ClientsColumnFilterInput
                                value={columnFilters.comment}
                                onChange={(v) =>
                                  setColumnFilters((f) => ({ ...f, comment: v }))
                                }
                                placeholder={t("pages.clients.filterColComment", {
                                  defaultValue: "Contains…",
                                })}
                              />
                            </th>
                          );
                        }
                        if (col === "connection") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <SelectNative
                                className="!h-8 w-full min-w-0 !px-2 !text-xs"
                                value={filterConn}
                                onChange={(e) =>
                                  setFilterConn(e.target.value as FilterConn)
                                }
                                onClick={(e) => e.stopPropagation()}
                                aria-label={t("pages.clients.filterConnection", {
                                  defaultValue: "Connection",
                                })}
                              >
                                <option value="">
                                  {t("pages.clients.filterConnAll", {
                                    defaultValue: "All",
                                  })}
                                </option>
                                <option value="online">{t("online")}</option>
                                <option value="offline">{t("offline")}</option>
                              </SelectNative>
                            </th>
                          );
                        }
                        if (col === "state") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <SelectNative
                                className="!h-8 w-full min-w-0 !px-2 !text-xs"
                                value={filterAcct}
                                onChange={(e) =>
                                  setFilterAcct(e.target.value as FilterAcct)
                                }
                                onClick={(e) => e.stopPropagation()}
                                aria-label={t("pages.clients.filterAccountState", {
                                  defaultValue: "Account state",
                                })}
                              >
                                <option value="">
                                  {t("pages.clients.filterStateAll", {
                                    defaultValue: "All states",
                                  })}
                                </option>
                                <option value="active">
                                  {clientAccountStateMeta(true, "active", t).label}
                                </option>
                                <option value="disabled">
                                  {t("pages.clients.stateDisabled", {
                                    defaultValue: "Disabled",
                                  })}
                                </option>
                                <option value="expired_traffic">
                                  {
                                    clientAccountStateMeta(
                                      true,
                                      "expired_traffic",
                                      t,
                                    ).label
                                  }
                                </option>
                                <option value="expired_time">
                                  {
                                    clientAccountStateMeta(
                                      true,
                                      "expired_time",
                                      t,
                                    ).label
                                  }
                                </option>
                              </SelectNative>
                            </th>
                          );
                        }
                        if (col === "traffic") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <CompareModeFilterField
                                mode="traffic"
                                compareOp={trafficCompareOp}
                                onCompareOpChange={setTrafficCompareOp}
                                value={columnFilters.traffic}
                                onValueChange={(v) =>
                                  setColumnFilters((f) => ({ ...f, traffic: v }))
                                }
                                placeholder={
                                  trafficCompareOp === ""
                                    ? t("pages.clients.filterColTraffic", {
                                        defaultValue: "Contains…",
                                      })
                                    : t("pages.clients.filterTrafficAmount", {
                                        defaultValue: "e.g. 10 gb",
                                      })
                                }
                                className="w-full"
                              />
                            </th>
                          );
                        }
                        if (col === "expiry") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <CompareModeFilterField
                                mode="expiry"
                                compareOp={expiryCompareOp}
                                onCompareOpChange={setExpiryCompareOp}
                                value={columnFilters.expiry}
                                onValueChange={(v) =>
                                  setColumnFilters((f) => ({ ...f, expiry: v }))
                                }
                                placeholder={
                                  expiryCompareOp === ""
                                    ? t("pages.clients.filterColExpiry", {
                                        defaultValue: "Contains…",
                                      })
                                    : t("pages.clients.filterExpiryDate", {
                                        defaultValue: "YYYY-MM-DD",
                                      })
                                }
                                className="w-full"
                              />
                            </th>
                          );
                        }
                        if (col === "inbounds") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <SelectNative
                                className="!h-8 w-full min-w-0 !px-2 !text-xs"
                                value={filterInboundId}
                                onChange={(e) =>
                                  setFilterInboundId(e.target.value)
                                }
                                onClick={(e) => e.stopPropagation()}
                                aria-label={t("pages.clients.inbounds")}
                              >
                                <option value="">
                                  {t("pages.clients.filterInboundAll", {
                                    defaultValue: "All inbounds",
                                  })}
                                </option>
                                <option value="none">
                                  {t("pages.clients.filterInboundNone", {
                                    defaultValue: "None assigned",
                                  })}
                                </option>
                                {inboundFilterOptions.map((ib) => (
                                  <option key={ib.id} value={String(ib.id)}>
                                    {ib.remark || `${ib.protocol}:${ib.port}`}
                                  </option>
                                ))}
                              </SelectNative>
                            </th>
                          );
                        }
                        if (col === "group") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <SelectNative
                                className="!h-8 w-full min-w-0 !px-2 !text-xs"
                                value={filterGroupId}
                                onChange={(e) => setFilterGroupId(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={t("pages.clients.group")}
                              >
                                <option value="">
                                  {t("pages.clients.filterGroupAll", {
                                    defaultValue: "All groups",
                                  })}
                                </option>
                                <option value="none">
                                  {t("pages.clients.filterGroupNone", {
                                    defaultValue: "No group",
                                  })}
                                </option>
                                {groupOptions.map((g) => (
                                  <option key={g.id} value={String(g.id)}>
                                    {g.name}
                                  </option>
                                ))}
                              </SelectNative>
                            </th>
                          );
                        }
                        if (col === "hwid") {
                          return (
                            <th
                              key={col}
                              className="p-2 align-top font-normal"
                            >
                              <ClientsColumnFilterInput
                                value={columnFilters.hwid}
                                onChange={(v) =>
                                  setColumnFilters((f) => ({ ...f, hwid: v }))
                                }
                                placeholder={t("pages.clients.filterColHwid", {
                                  defaultValue: "Contains…",
                                })}
                              />
                            </th>
                          );
                        }
                        return <th key={col} className="p-2" aria-hidden />;
                      })}
                    </tr>
                  ) : null}
                </thead>
                <tbody>
                  {displayedRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          (bulkMode ? 1 : 0) + visibleDataColumnCount
                        }
                        className="px-4 py-10 text-center text-sm text-[var(--fg-muted)]"
                      >
                        {t("pages.clients.filterNoResults", {
                          defaultValue: "No clients match the current filters.",
                        })}
                      </td>
                    </tr>
                  ) : (
                    displayedRows.map((r) => {
                      const noExpiryL = t("pages.clients.cardNoExpiry", {
                        defaultValue: "No expiry",
                      });
                      const expiredL = t("pages.clients.cardExpired", {
                        defaultValue: "Expired",
                      });
                      return (
                        <tr
                          key={r.id}
                          onClick={() => void openSheetEdit(r.id)}
                          className="cursor-pointer border-b border-[var(--border)] text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]"
                        >
                          {bulkMode ? (
                            <td
                              className="p-3 align-middle"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={selectedIds.has(r.id)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const on = e.target.checked;
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (on) next.add(r.id);
                                    else next.delete(r.id);
                                    return next;
                                  });
                                }}
                                aria-label={r.name}
                              />
                            </td>
                          ) : null}
                          {DATA_COLUMN_ORDER.map((col) => {
                            if (!columnVisibility[col]) return null;
                            return (
                              <td
                                key={col}
                                className={cx(
                                  "p-3 align-middle",
                                  col === "name" &&
                                    "max-w-[14rem] font-medium text-[var(--fg)]",
                                )}
                              >
                                <ClientDataCell
                                  col={col}
                                  r={r}
                                  t={t}
                                  groupOptions={groupOptions}
                                  noExpiry={noExpiryL}
                                  expired={expiredL}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Surface>
      </Reveal>

      <Modal
        open={sheetOpen}
        onClose={() => {
          if (!modalSubmitting && !fetchingClient) {
            closeSheet();
          }
        }}
        title={
          sheetMode === "edit"
            ? form.name.trim() ||
              t("pages.clients.editClient", { defaultValue: "Edit client" })
            : t("pages.clients.addClient")
        }
        width={960}
        dialogClassName="!max-h-[calc(100dvh-2rem)]"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={modalSubmitting || fetchingClient}
              onClick={closeSheet}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={modalSubmitting}
              disabled={fetchingClient}
              onClick={() => void submitClient()}
            >
              {modalSubmitting
                ? null
                : isEdit
                  ? t("update")
                  : t("create")}
            </Button>
          </div>
        }
      >
        {fetchingClient ? (
          <div className="grid min-h-48 place-items-center">
            <Spinner size={32} />
          </div>
        ) : (
          <ClientUnifiedCard
            variant={sheetMode === "edit" ? "existing" : "create"}
            r={sheetMode === "edit" ? sheetClient : undefined}
            t={t}
            copyText={copyText}
            fieldIdPrefix={isEdit ? `edit-${editingId ?? "x"}` : "new"}
            form={form}
            setForm={setForm}
            inboundIds={inboundIds}
            inboundSubscriptionOrder={inboundSubscriptionOrder}
            onToggleInboundId={toggleInboundSelection}
            onMoveInboundSubscription={moveInboundSubscription}
            inbounds={inbounds}
            telemtAdTags={telemtAdTags}
            setTelemtAdTags={setTelemtAdTags}
            groups={groups}
            isEdit={isEdit}
            sheetActionBusy={sheetInlineBusy}
            onResetTraffic={() =>
              sheetClient != null ? resetTraffic(sheetClient) : undefined
            }
            onClearHwid={() =>
              sheetClient != null ? clearHwid(sheetClient) : undefined
            }
            onDelete={() =>
              sheetClient != null ? openDeleteClientConfirm(sheetClient) : undefined
            }
            onOpenKeys={() => {
              if (sheetClient != null) void openKeysModal(sheetClient.id);
            }}
            onOpenHwid={() => {
              if (sheetClient != null) void openHwidModal(sheetClient.id);
            }}
            onOpenSessions={() => {
              if (sheetClient != null) void openSessionsModal(sheetClient.id);
            }}
            onShowSubscriptionQr={(url) => {
               setSubscriptionQrUrl(url);
               const id = new URL(url).pathname.split("/").filter(Boolean).pop();
               if(!id) return;
               fetch(`/panel/api/public/subscription?id=${id}`).then(res => res.json())
                  .then(res => {
                    if(res?.success) setSubscriptionEncryptionData(res.obj);
                    else console.error("API Err", res);
               }).catch(console.error);
            }}
          />
        )}
      </Modal>

      <Modal
        open={subscriptionQrUrl != null}
        onClose={() => setSubscriptionQrUrl(null)}
        title={t("pages.clients.subscriptionQrTitle", {
          defaultValue: "Subscription QR",
        })}
        width={360}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSubscriptionQrUrl(null)}
            >
              {t("close", { defaultValue: "Close" })}
            </Button>
            {subscriptionQrUrl ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => copyText(subscriptionQrUrl)}
              >
                <Copy size={14} className="mr-1 inline" />
                {t("pages.clients.copySubscriptionUrl", {
                  defaultValue: "Copy link",
                })}
              </Button>
            ) : null}
          </div>
        }
      >
        {subscriptionQrUrl ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="rounded-xl border border-[var(--border)] bg-white p-3 dark:bg-[var(--bg-elevated)]">
              <QRCodeSVG value={subscriptionQrUrl} size={200} level="M" onClick={() => copyText(subscriptionQrUrl)}/>
            </div>
            <p className="max-w-full break-all text-center font-mono text-[11px] text-[var(--fg-muted)]">
              {subscriptionQrUrl}
            </p>
          </div>
        ) : null}
        {subscriptionEncryptionData && (
          <div className="flex flex-col gap-6">
          {subscriptionEncryptionData.happEncryptedUrl && (
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="rounded-xl border border-[var(--border)] bg-white p-3 dark:bg-[var(--bg-elevated)]">
                 <QRCodeSVG value={subscriptionEncryptionData.happEncryptedUrl} size={200} level="M" onClick={() => copyText(subscriptionEncryptionData.happEncryptedUrl!)}/>
              </div>
              <p className="text-xs text-[var(--fg-muted)]">
                Happ Encrypted
              </p>
            </div>
          )}
          {subscriptionEncryptionData.v2raytunEncryptedUrl && (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="rounded-xl border border-[var(--border)] bg-white p-3 dark:bg-[var(--bg-elevated)]">
              <QRCodeSVG value={subscriptionEncryptionData.v2raytunEncryptedUrl} size={200} level="M" onClick={() => copyText(subscriptionEncryptionData.v2raytunEncryptedUrl!)} />
            </div>
            <p className="max-w-full break-all text-center font-mono text-[11px] text-[var(--fg-muted)]">
              V2RayTun Encrypted
            </p>
          </div>
          )}
         </div>
        )}
      </Modal>

      <Modal
        open={connectionKeyQrText != null}
        onClose={() => setConnectionKeyQrText(null)}
        title={t("pages.clients.connectionKeyQrTitle", {
          defaultValue: "Connection key QR",
        })}
        width={400}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConnectionKeyQrText(null)}
            >
              {t("close", { defaultValue: "Close" })}
            </Button>
            {connectionKeyQrText ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => copyText(connectionKeyQrText)}
              >
                <Copy size={14} className="mr-1 inline" />
                {t("copy")}
              </Button>
            ) : null}
          </div>
        }
      >
        {connectionKeyQrText ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="rounded-xl border border-[var(--border)] bg-white p-3 dark:bg-[var(--bg-elevated)]">
              <QRCodeSVG
                value={connectionKeyQrText}
                size={220}
                level="M"
              />
            </div>
            <p className="max-h-24 max-w-full overflow-y-auto break-all text-center font-mono text-[11px] text-[var(--fg-muted)]">
              {connectionKeyQrText}
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={keysModalClientId != null}
        onClose={() => {
          setKeysModalClientId(null);
          setKeysRows([]);
        }}
        title={t("pages.clients.keysModalTitle", {
          defaultValue: "Share links by inbound",
        })}
        width={560}
        footer={
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setKeysModalClientId(null);
              setKeysRows([]);
            }}
          >
            {t("close", { defaultValue: "Close" })}
          </Button>
        }
      >
        {keysLoading ? (
          <div className="grid min-h-40 place-items-center">
            <Spinner size={32} />
          </div>
        ) : !keysRows.length ? (
          <div className="space-y-2 text-sm text-[var(--fg-muted)]">
            <p>
              {keysModalInboundCount === 0
                ? t("pages.clients.keysEmptyNoInbounds", {
                    defaultValue:
                      "This client has no inbounds assigned. Assign inbounds in the client editor, then try again.",
                  })
                : t("pages.clients.keysEmptyCannotBuild", {
                    defaultValue:
                      "No share links could be built for the assigned inbounds (unsupported protocol, missing client password/UUID for this protocol, or host settings). Check inbound type and client credentials.",
                  })}
            </p>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto text-sm">
            {keysRows.map((row) => {
              // WireGuard / AmneziaWG QR must contain only the wg-quick [Interface]/[Peer] block.
              const usesWgQuickConf = isWgQuickConfProtocol(row.protocol);
              const wgConfText = usesWgQuickConf
                ? (row.wgConf?.trim() || wgQuickConfFromPanelText(row.link))
                : null;
              const qrText = wgConfText ?? row.link;
              const keyQrTooLong = qrText.length > 2500;
              return (
              <div
                key={`${row.inboundId}-${row.protocol}`}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
              >
                <div className="mb-2 text-xs font-semibold text-[var(--fg)]">
                  {row.remark || `Inbound ${row.inboundId}`} · {row.protocol}
                </div>
                {row.protocol === "wireguard" ? (
                  <p className="mb-2 text-xs text-[var(--fg-subtle)]">
                    {t("pages.clients.keysWireGuardHint", {
                      defaultValue:
                        "WireGuard does not use a v2ray:// link. The block is server + setup notes. In the inbound’s WireGuard peers, add each device’s public key; set optional email on a peer to match this client and show that row in this card.",
                    })}
                  </p>
                ) : null}
                {row.protocol === "amneziawg" ? (
                  <p className="mb-2 text-xs text-[var(--fg-subtle)]">
                    {t("pages.clients.keysAmneziaWgHint", {
                      defaultValue:
                        "AmneziaWG uses a WireGuard-style .conf block. QR encodes only [Interface]/[Peer] for the AmneziaWG app — import the .conf file if scanning fails.",
                    })}
                  </p>
                ) : null}
                {row.protocol === "telemt" ? (
                  <p className="mb-2 text-xs text-[var(--fg-subtle)]">
                    {t("pages.clients.keysTelemtHint", {
                      defaultValue:
                        "Telemt MTProto: open the tg://proxy link in Telegram (or copy the proxy URL from your subscription). Secrets are tied to this client on this inbound.",
                    })}
                  </p>
                ) : null}
                <pre
                  className={cx(
                    "overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--surface)] p-2 font-mono text-[11px] text-[var(--fg-muted)]",
                    usesWgQuickConf ? "max-h-[min(50vh,22rem)]" : "max-h-36",
                  )}
                >
                  {row.link}
                </pre>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="!h-8 !text-xs"
                    onClick={() => copyText(row.link)}
                  >
                    <Copy size={12} className="mr-1 inline" />
                    {usesWgQuickConf
                      ? t("pages.clients.copyWireGuardDetails", { defaultValue: "Copy" })
                      : t("copy")}
                  </Button>
                  {usesWgQuickConf ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="!h-8 !text-xs"
                      onClick={() => {
                        const conf =
                          row.wgConf?.trim() ||
                          wgQuickConfFromPanelText(row.link) ||
                          row.link;
                        const blob = new Blob([conf], { type: "text/plain;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = wireGuardConfFileName(
                          row.remark?.trim() || `inbound-${row.inboundId}`,
                        );
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      {t("pages.clients.downloadWireGuardConf", { defaultValue: "Download .conf" })}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    className="!h-8 !text-xs"
                    disabled={keyQrTooLong}
                    title={
                      keyQrTooLong
                        ? t("pages.clients.keyQrTooLong", {
                            defaultValue:
                              "Text is too long for a QR code. Use copy, or open on a device with a smaller key.",
                          })
                        : t("pages.clients.keyQrButtonTitle", {
                            defaultValue: "Show QR code for this connection string",
                          })
                    }
                    onClick={() => setConnectionKeyQrText(qrText)}
                  >
                    <QrCode size={12} className="mr-1 inline" />
                    {t("qrCode")}
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={sessionsModalClientId != null}
        onClose={() => {
          setSessionsModalClientId(null);
          setSessionsData(null);
        }}
        title={t("pages.clients.sessions.modalTitle", {
          defaultValue: "Active sessions",
        })}
        width={640}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-[min(100%,28rem)] text-xs text-[var(--fg-muted)]">
              {t("pages.clients.sessions.natWarning", {
                defaultValue:
                  "Dropping traffic by IP affects all connections using that IP (shared NAT may impact other users).",
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={sessionsDropBusy}
                onClick={() => void refreshSessionsModal()}
              >
                {t("pages.clients.sessions.refresh")}
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={sessionsDropBusy}
                disabled={
                  sessionsLoading ||
                  !sessionsData?.results?.some((x) => x.dropAvailable)
                }
                onClick={() => void dropAllSessions()}
              >
                {t("pages.clients.sessions.dropAll")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSessionsModalClientId(null);
                  setSessionsData(null);
                }}
              >
                {t("close", { defaultValue: "Close" })}
              </Button>
            </div>
          </div>
        }
      >
        {sessionsLoading && !sessionsData ? (
          <div className="grid min-h-40 place-items-center">
            <Spinner size={32} />
          </div>
        ) : sessionsData ? (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto text-sm">
            {(sessionsData.results ?? []).some((b) =>
              (b.sessions ?? []).some((s) => s.protocol === "mtproto"),
            ) ? (
              <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[11px] text-[var(--fg-muted)]">
                {t("pages.clients.sessions.mtprotoBlockHint", {
                  defaultValue:
                    "MTProto (Telemt): Block uses the same switch as for Xray — the IP is added to the session blocklist (subscription requests from that IP are denied). Xray routing rules also apply where this client uses Xray. For MTProto traffic, the panel additionally tries to drop active TCP for that IP (conntrack on the panel host or worker nodes), same idea as Disconnect.",
                })}
              </p>
            ) : null}
            {(sessionsData.results ?? []).map((block) => (
              <div
                key={
                  block.isOfflineBlockedGroup
                    ? "offline-blocked-session-ips"
                    : `${block.nodeId ?? "local"}-${block.nodeName}`
                }
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--fg)]">
                    {block.isOfflineBlockedGroup
                      ? t("pages.clients.sessions.offlineBlockedGroup", {
                          defaultValue: "Blocked IPs (not in live stats)",
                        })
                      : block.nodeName === "Local"
                        ? t("pages.clients.sessions.localNode", {
                            defaultValue: "Local",
                          })
                        : block.nodeName}
                  </span>
                  {!block.error && !block.dropAvailable ? (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                      {t("pages.clients.sessions.dropUnavailable", {
                        defaultValue: "Drop unavailable (need Linux + conntrack + NET_ADMIN)",
                      })}
                    </span>
                  ) : null}
                </div>
                {block.error && !isSessionsNoOnlineDataError(block.error) ? (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {t("pages.clients.sessions.errorNodeBrief")}
                  </p>
                ) : !block.sessions?.length ? (
                  <p className="text-xs text-[var(--fg-muted)]">
                    {t("pages.clients.sessions.empty")}
                  </p>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--fg-subtle)]">
                        <th className="p-2">IP</th>
                        <th className="p-2 whitespace-nowrap text-center">
                          {t("pages.clients.blockToggle", { defaultValue: "Block" })}
                        </th>
                        <th className="p-2">
                          {t("pages.clients.sessions.lastSeen", {
                            defaultValue: "Last seen",
                          })}
                        </th>
                        <th className="p-2 w-28" />
                      </tr>
                    </thead>
                    <tbody>
                      {block.sessions.map((s, si) => (
                        <tr
                          key={`${block.nodeName}-${s.ip}-${s.protocol ?? "xray"}-${s.remark ?? ""}-${si}`}
                          className="border-b border-[var(--border)] text-[var(--fg-muted)]"
                        >
                          <td className="p-2 align-top">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-[11px]">
                                {s.ip?.trim() ? s.ip : "—"}
                              </span>
                              {s.protocol === "mtproto" ? (
                                <span className="inline-flex w-fit rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                                  {t("pages.clients.sessions.mtproto", {
                                    defaultValue: "MTProto (Telemt)",
                                  })}
                                </span>
                              ) : null}
                              {s.remark ? (
                                <span className="text-[10px] text-[var(--fg-subtle)]">{s.remark}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-2 text-center align-middle">
                            <Switch
                              size="sm"
                              checked={isSessionIpBlocked(s.ip, sessionsData.blockedSessionIps)}
                              disabled={
                                !s.ip?.trim() ||
                                sessionIpBlockBusy === s.ip ||
                                sessionsDropBusy ||
                                sessionsLoading
                              }
                              ariaLabel={t("pages.clients.sessions.blockIpToggle", {
                                defaultValue: "Block subscription from this IP",
                              })}
                              onChange={(next) => void toggleSessionIpBlocked(s.ip, next)}
                            />
                          </td>
                          <td className="p-2">
                            {s.lastSeen > 0
                              ? new Date(s.lastSeen * 1000).toLocaleString()
                              : "—"}
                          </td>
                          <td className="p-2 text-right">
                            <Button
                              type="button"
                              variant="secondary"
                              className="!h-7 !px-2 !text-[10px]"
                              disabled={sessionsDropBusy || !block.dropAvailable || !s.ip?.trim()}
                              onClick={() => void dropSessionIp(s.ip)}
                            >
                              {t("pages.clients.sessions.dropOne", {
                                defaultValue: "Disconnect",
                              })}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
        )}
      </Modal>

      <Modal
        open={hwidModalClientId != null}
        onClose={() => {
          setHwidModalClientId(null);
          setHwidRows([]);
          setHwidDeleteRow(null);
        }}
        title={t("pages.clients.hwidModalTitle", {
          defaultValue: "Registered devices (HWID)",
        })}
        width={720}
        footer={
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setHwidModalClientId(null);
              setHwidRows([]);
              setHwidDeleteRow(null);
            }}
          >
            {t("close", { defaultValue: "Close" })}
          </Button>
        }
      >
        {hwidLoading ? (
          <div className="grid min-h-40 place-items-center">
            <Spinner size={32} />
          </div>
        ) : !hwidRows.length ? (
          <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                {t("pages.clients.hwidUserAgentShareTitle", {
                  defaultValue: "User-Agent distribution by HWID",
                })}
              </p>
              <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
                {t("pages.clients.hwidUserAgentShareHint", {
                  defaultValue: "Share of registered devices by User-Agent.",
                })}
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-[auto,1fr] sm:items-start">
                <div className="mx-auto w-fit">
                  <div
                    className="relative h-36 w-36 rounded-full border border-[var(--border)]"
                    style={{ background: hwidUserAgentPieData.gradient }}
                    aria-label={t("pages.clients.hwidUserAgentShareTitle", {
                      defaultValue: "User-Agent distribution by HWID",
                    })}
                  >
                    <div className="absolute inset-[22%] rounded-full bg-[var(--bg-elevated)]" />
                  </div>
                </div>
                <div className="space-y-2">
                  {hwidUserAgentPieData.parts.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate font-mono text-[var(--fg-muted)]">
                          {item.label}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-[var(--fg)]">
                        {item.percentLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--fg-subtle)]">
                  <th className="p-2 align-bottom">HWID</th>
                  <th className="p-2 align-bottom">
                    {t("pages.clients.device", { defaultValue: "Device" })}
                  </th>
                  <th className="p-2 align-bottom min-w-[8rem]">
                    {t("pages.clients.hwidUserAgent", { defaultValue: "User-Agent" })}
                  </th>
                  <th className="p-2 align-bottom whitespace-nowrap text-center">
                    {t("pages.clients.blockToggle", { defaultValue: "Block" })}
                  </th>
                  <th className="p-2 align-bottom whitespace-nowrap">{t("status")}</th>
                  <th className="p-2 align-bottom w-12" aria-label={t("delete")} />
                </tr>
              </thead>
              <tbody>
                {hwidRows.map((h) => (
                  <tr key={h.id} className="border-b border-[var(--border)] text-[var(--fg-muted)]">
                    <td className="p-2 font-mono text-[10px] break-all align-top">{h.hwid}</td>
                    <td className="p-2 align-top">
                      {[h.deviceModel, h.deviceOs].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="p-2 align-top font-mono text-[10px] leading-snug break-all text-[var(--fg-muted)]">
                      {h.userAgent?.trim() ? h.userAgent.trim() : "—"}
                    </td>
                    <td className="p-2 align-middle text-center">
                      <Switch
                        size="sm"
                        checked={!!h.blocked}
                        disabled={hwidBlockBusyId === h.id}
                        ariaLabel={t("pages.clients.hwidBlockToggle", {
                          defaultValue: "Block this device",
                        })}
                        onChange={() => void toggleHwidBlocked(h)}
                      />
                    </td>
                    <td className="p-2 align-top whitespace-nowrap">
                      {h.blocked
                        ? t("pages.clients.hwidBlockedStatus", { defaultValue: "Blocked" })
                        : h.isActive
                          ? t("enabled")
                          : t("disabled")}
                    </td>
                    <td className="p-2 align-top text-right">
                      <IconButton
                        type="button"
                        label={t("pages.clients.hwidRemoveDevice", {
                          defaultValue: "Remove device",
                        })}
                        className="!h-8 !w-8 text-[var(--fg-subtle)] hover:text-red-400"
                        onClick={() => setHwidDeleteRow(h)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={hwidDeleteRow != null}
        title={t("pages.clients.hwidDeleteConfirmTitle", {
          defaultValue: "Remove this registered device?",
        })}
        description={
          hwidDeleteRow
            ? [
                [hwidDeleteRow.deviceModel, hwidDeleteRow.deviceOs].filter(Boolean).join(" · ") ||
                  t("pages.clients.hwidUnknownDevice", { defaultValue: "Unknown device" }),
                hwidDeleteRow.hwid,
              ].join(" — ")
            : undefined
        }
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        loading={hwidDeleteBusy}
        onCancel={() => {
          if (!hwidDeleteBusy) setHwidDeleteRow(null);
        }}
        onConfirm={async () => {
          if (!hwidDeleteRow) return;
          const id = hwidDeleteRow.id;
          setHwidDeleteBusy(true);
          try {
            const r = await postJson(panel(`client/hwid/del/${id}`));
            if (r.success) {
              toast.success(
                (r as { msg?: string }).msg ||
                  t("pages.clients.hwidDeviceRemoved", {
                    defaultValue: "Device removed.",
                  }),
              );
              setHwidDeleteRow(null);
              setHwidRows((prev) => prev.filter((x) => x.id !== id));
              void load();
            } else {
              toast.error((r as { msg?: string }).msg || t("pages.clients.addError"));
            }
          } catch {
            toast.error(t("pages.clients.addError"));
          } finally {
            setHwidDeleteBusy(false);
          }
        }}
      />

      <Modal
        open={bulkAssignGroupOpen}
        onClose={() => {
          if (!bulkAssignGroupBusy) setBulkAssignGroupOpen(false);
        }}
        title={t("pages.clients.bulkAssignGroupConfirm", {
          count: bulkSelectedClients.length,
          defaultValue: "Assign group for {{count}} clients",
        })}
        width={440}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={bulkAssignGroupBusy}
              onClick={() => setBulkAssignGroupOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={bulkAssignGroupBusy}
              onClick={() => void submitBulkAssignGroup()}
            >
              {t("confirm")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-[var(--fg-muted)]">
            {t("pages.clients.bulkAssignGroupHint", {
              defaultValue:
                "Clients already in another group will be moved to the selected group.",
            })}
          </p>
          <SelectNative
            value={bulkAssignGroupId}
            onChange={(e) => setBulkAssignGroupId(e.target.value)}
            aria-label={t("pages.clients.selectGroup")}
          >
            <option value="">{t("pages.clients.selectGroup")}</option>
            <option value="none">{t("pages.clients.filterGroupNone")}</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </SelectNative>
        </div>
      </Modal>

      <ConfirmDialog
        open={clientsConfirmAction != null}
        title={
          clientsConfirmAction == null
            ? ""
            : clientsConfirmAction.kind === "deleteOne"
              ? t("pages.clients.confirmDelete", {
                  defaultValue: "Delete this client? This cannot be undone.",
                })
              : clientsConfirmAction.kind === "bulkReset"
                ? t("pages.clients.bulkConfirmReset", {
                    count: clientsConfirmAction.clients.length,
                    defaultValue: "Reset traffic for {{count}} clients?",
                  })
                : clientsConfirmAction.kind === "bulkClearHwid"
                  ? t("pages.clients.bulkConfirmClearHwid", {
                      count: clientsConfirmAction.clients.length,
                      defaultValue: "Clear HWID for {{count}} clients?",
                    })
                  : t("pages.clients.bulkConfirmDelete", {
                      count: clientsConfirmAction.clients.length,
                      defaultValue:
                        "Permanently delete {{count}} clients? This cannot be undone.",
                    })
        }
        description={
          clientsConfirmAction?.kind === "deleteOne"
            ? clientsConfirmAction.client.name
            : undefined
        }
        confirmLabel={
          clientsConfirmAction?.kind === "bulkDelete" ||
          clientsConfirmAction?.kind === "deleteOne"
            ? t("delete")
            : t("confirm")
        }
        cancelLabel={t("cancel")}
        danger={
          clientsConfirmAction?.kind === "bulkDelete" ||
          clientsConfirmAction?.kind === "deleteOne"
        }
        loading={clientsConfirmBusy}
        onCancel={() => setClientsConfirmAction(null)}
        onConfirm={() => void executeClientsConfirm()}
      />
    </PageScaffold>
  );
}
