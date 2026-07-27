"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Eye,
  Filter,
  KeyRound,
  LayoutGrid,
  LayoutList,
  Network,
  Plus,
  Server,
  SlidersHorizontal,
  Table2,
  Trash2,
  User,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson, postJson } from "@/lib/api";
import {
  buildAmneziaWgInboundApiPayload,
  defaultAmneziaWgInboundForm,
  ensureAmneziaWgHeaderProtectionPadding,
  parseAmneziaWgSettingsToForm,
  randomAmneziaWgObfuscationFields,
} from "@/lib/amneziawgInbound";
import {
  buildSettingsJson,
  buildSniffingFromForm,
  buildStreamSettingsFromForm,
  effectiveVlessFlow,
  vlessXtlsFlowAllowed,
  buildTelemtSettingsJson,
  buildWireguardInboundApiPayload,
  defaultTelemtForm,
  defaultWireguardForm,
  defaultSniffingForm,
  defaultSniffingString,
  defaultStreamForm,
  defaultStreamFormHysteria,
  defaultStreamSettingsString,
  defaultVlessTrojanFallbackRow,
  getInboundStreamTransportMode,
  isSidecarInboundProtocol,
  sidecarEmptySniffingString,
  hostFromRealityTarget,
  mergeFirstClientIntoSettings,
  newWireGuardSecretKeyBase64,
  parseFirstClientFromSettings,
  parseWireguardSettingsToForm,
  parseSniffingToForm,
  parseStreamSettingsToForm,
  parseTelemtSettingsToForm,
  randomPassword,
  randomQuicKey,
  randomRealityShortIds,
  randomWsPath,
  REALITY_FINGERPRINTS,
  streamPresetShadowsocksWsString,
  streamPresetTcpTlsString,
  suggestRandomTlsSni,
  totalBytesToGbInput,
  XHTTP_MODES,
  type InboundFormProtocol,
  type SniffingFormState,
  type VlessTrojanFallbackFormRow,
  type StreamFormState,
} from "@/lib/inboundDefaults";
import { randomShadowsocksServerPassword } from "@/lib/shadowsocksKeys";
import { sizeFormat } from "@/lib/format";
import {
  joinNameFlag,
  NAME_FLAG_SELECT_OPTIONS,
  splitNameFlag,
} from "@/lib/nameFlag";
import { usePanelWebSocket } from "@/lib/panelWebSocket";
import { panel } from "@/lib/paths";
import { suggestInboundTag, validateInboundTagInput } from "@/lib/inboundTag";
import {
  INBOUNDS_VIEW_MODE_STORAGE_KEY,
  readListViewMode,
  type ListViewMode,
  writeListViewMode,
} from "@/lib/listViewModeStorage";
import { type CompareOp } from "@/components/CompareModeFilterField";
import { InboundXrayCoreEditor } from "@/components/inbounds/InboundXrayCoreEditor";
import {
  InboundListView,
  InboundTilesView,
} from "@/components/inbounds/InboundListViews";
import { InboundColumnFiltersBar } from "@/components/inbounds/InboundColumnFiltersBar";
import { InboundTlsCertPinBlock } from "@/components/inbounds/InboundTlsCertPinBlock";
import {
  roundTripInboundCoreConfig,
  roundTripInboundSniffing,
  roundTripInboundStreamSettings,
} from "@/lib/inboundJsonSanitize";
import { PageScaffold, PageHeader, SectionHelpModal, Surface } from "@/components/panel";
import {
  Button,
  CheckboxField,
  CheckboxOptionCard,
  CheckboxOptionList,
  ConfirmDialog,
  SelectionListToolbar,
  IconButton,
  IconTile,
  Input,
  Modal,
  Reveal,
  SelectNative,
  Segmented,
  Spinner,
  Stepper,
  Switch,
  Tabs,
  useToast,
} from "@/components/ui";

function TextArea({
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-[88px] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-xs text-[var(--fg)] placeholder:text-[var(--fg-subtle)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] ${className}`}
      spellCheck={false}
      {...rest}
    />
  );
}

function InboundFormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
        {title}
      </div>
      {children}
    </div>
  );
}

type Row = {
  id: number;
  remark: string;
  tag: string;
  protocol: string;
  port: number;
  up: number;
  down: number;
  total: number;
  enable: boolean;
};

/** Maps panel API / WebSocket inbounds array to list rows. */
function inboundsPayloadToRows(raw: unknown): Row[] {
  if (!Array.isArray(raw)) return [];
  const out: Row[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "number") continue;
    out.push({
      id: o.id,
      remark: String(o.remark ?? ""),
      tag: String(o.tag ?? ""),
      protocol: String(o.protocol ?? ""),
      port: typeof o.port === "number" ? o.port : 0,
      up: Number(o.up) || 0,
      down: Number(o.down) || 0,
      total: Number(o.total) || 0,
      enable: Boolean(o.enable),
    });
  }
  return out;
}

function cx(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

type InboundSortKey = "id" | "remark" | "tag" | "protocol" | "port" | "used" | "status";
type SortDir = "asc" | "desc";
type InboundFilterStatus = "" | "enabled" | "disabled";

type InboundColumnFilterId = "remark" | "tag" | "protocol" | "port" | "traffic";

const INBOUND_DEFAULT_FILTERS: Record<InboundColumnFilterId, string> = {
  remark: "",
  tag: "",
  protocol: "",
  port: "",
  traffic: "",
};

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

function usedBytes(r: Row): number {
  return r.up + r.down;
}

function inboundTrafficHaystack(r: Row): string {
  const up = r.up || 0;
  const down = r.down || 0;
  return [
    sizeFormat(up),
    sizeFormat(down),
    sizeFormat(usedBytes(r)),
    String(up),
    String(down),
  ]
    .join(" ")
    .toLowerCase();
}

function compareInbounds(
  a: Row,
  b: Row,
  key: InboundSortKey,
  dir: SortDir,
): number {
  const m = dir === "asc" ? 1 : -1;
  let c = 0;
  switch (key) {
    case "id":
      c = a.id - b.id;
      break;
    case "remark":
      c = a.remark.localeCompare(b.remark, undefined, { sensitivity: "base" });
      break;
    case "tag":
      c = a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" });
      break;
    case "protocol":
      c = a.protocol.localeCompare(b.protocol, undefined, { sensitivity: "base" });
      break;
    case "port":
      c = a.port - b.port;
      break;
    case "used":
      c = usedBytes(a) - usedBytes(b);
      break;
    case "status":
      c = (a.enable ? 1 : 0) - (b.enable ? 1 : 0);
      break;
  }
  if (c !== 0) return c * m;
  return (a.id - b.id) * m;
}

function InboundSortableTh({
  label,
  sortKey: sk,
  activeKey,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: InboundSortKey;
  activeKey: InboundSortKey;
  dir: SortDir;
  onSort: (k: InboundSortKey) => void;
  className?: string;
}) {
  const active = activeKey === sk;
  return (
    <th className={cx("p-3", className)}>
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1 text-left font-semibold uppercase tracking-wider text-[var(--fg-subtle)] outline-none hover:text-[var(--fg-muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        onClick={(e) => {
          e.stopPropagation();
          onSort(sk);
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

type NodeRow = { id: number; name: string };

type InboundNodeBindingApi = {
  nodeId: number;
  nodeName?: string;
  publishedAddress?: string;
  publishedPort?: number;
  includeInSubscription?: boolean;
  subscriptionRemarkSuffix?: string;
  serverDescription?: string;
};

type NodeBindingFormRow = {
  nodeId: number;
  publishedAddress: string;
  publishedPort: string;
  includeInSubscription: boolean;
  subscriptionRemarkSuffix: string;
  serverDescription: string;
};

function inboundBindingsToForm(ib: {
  nodeBindings?: InboundNodeBindingApi[];
  nodeIds?: number[];
}): NodeBindingFormRow[] {
  const nb = ib.nodeBindings?.filter((b) => (b.nodeId ?? 0) > 0) ?? [];
  if (nb.length > 0) {
    return nb.map((b) => ({
      nodeId: b.nodeId,
      publishedAddress: (b.publishedAddress ?? "").trim(),
      publishedPort: String(b.publishedPort ?? 0),
      includeInSubscription: b.includeInSubscription !== false,
      subscriptionRemarkSuffix: (b.subscriptionRemarkSuffix ?? "").trim(),
      serverDescription: (b.serverDescription ?? "").trim(),
    }));
  }
  return (ib.nodeIds ?? [])
    .filter((id) => id > 0)
    .map((nodeId) => ({
      nodeId,
      publishedAddress: "",
      publishedPort: "0",
      includeInSubscription: true,
      subscriptionRemarkSuffix: "",
      serverDescription: "",
    }));
}

type InboundDetail = {
  id: number;
  remark: string;
  tag?: string;
  protocol: string;
  port: number;
  listen?: string;
  enable: boolean;
  settings: string;
  streamSettings: string;
  sniffing: string;
  up: number;
  down: number;
  total: number;
  allTime?: number;
  expiryTime: number;
  trafficReset: string;
  nodeIds?: number[];
  nodeBindings?: InboundNodeBindingApi[];
};

function randomPort() {
  return 10000 + Math.floor(Math.random() * 50000);
}

const PROTOCOLS: { value: InboundFormProtocol; label: string }[] = [
  { value: "vless", label: "VLESS" },
  { value: "vmess", label: "VMess" },
  { value: "trojan", label: "Trojan" },
  { value: "shadowsocks", label: "Shadowsocks" },
  { value: "mixed", label: "Mixed" },
  { value: "hysteria2", label: "Hysteria 2" },
  { value: "wireguard", label: "WireGuard" },
  { value: "amneziawg", label: "AmneziaWG" },
  { value: "telemt", label: "Telemt (MTProto)" },
];

const KNOWN_INBOUND_PROTOCOLS = new Set<InboundFormProtocol>([
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "mixed",
  "hysteria",
  "hysteria2",
  "wireguard",
  "amneziawg",
  "telemt",
]);

const TRAFFIC_RESET: { value: string; labelKey: string }[] = [
  { value: "never", labelKey: "pages.inbounds.periodicTrafficReset.never" },
  { value: "hourly", labelKey: "pages.inbounds.periodicTrafficReset.hourly" },
  { value: "daily", labelKey: "pages.inbounds.periodicTrafficReset.daily" },
  { value: "weekly", labelKey: "pages.inbounds.periodicTrafficReset.weekly" },
  { value: "monthly", labelKey: "pages.inbounds.periodicTrafficReset.monthly" },
];

const SS_METHODS = [
  "2022-blake3-aes-256-gcm",
  "2022-blake3-aes-128-gcm",
  "aes-256-gcm",
  "aes-128-gcm",
  "chacha20-poly1305",
  "xchacha20-poly1305",
];

const QUIC_HEADER_TYPES: { value: StreamFormState["quicHeaderType"]; label: string }[] = [
  { value: "none", label: "none" },
  { value: "srtp", label: "srtp (VoIP)" },
  { value: "utp", label: "utp (BitTorrent)" },
  { value: "wechat-video", label: "wechat-video" },
  { value: "dtls", label: "dtls" },
  { value: "wireguard", label: "wireguard" },
];

const KCP_HEADER_TYPES: { value: StreamFormState["kcpHeaderType"]; label: string }[] = [
  { value: "none", label: "none" },
  { value: "srtp", label: "srtp (VoIP)" },
  { value: "utp", label: "utp (BitTorrent)" },
  { value: "wechat-video", label: "wechat-video" },
  { value: "dtls", label: "dtls" },
  { value: "wireguard", label: "wireguard" },
];

function isInboundFormProtocol(s: string): s is InboundFormProtocol {
  return KNOWN_INBOUND_PROTOCOLS.has(s as InboundFormProtocol);
}

type InboundStepId =
  | "basics"
  | "transport"
  | "auth"
  | "sniffing"
  | "nodes";

const INBOUND_STEP_ORDER: InboundStepId[] = [
  "basics",
  "transport",
  "auth",
  "sniffing",
  "nodes",
];

type InboundStepMeta = {
  id: InboundStepId;
  icon: LucideIcon;
  labelKey: string;
  labelDefault: string;
  descriptionKey: string;
  descriptionDefault: string;
};

const INBOUND_STEPS: InboundStepMeta[] = [
  {
    id: "basics",
    icon: SlidersHorizontal,
    labelKey: "pages.inbounds.stepBasics",
    labelDefault: "Basics",
    descriptionKey: "pages.inbounds.stepBasicsDesc",
    descriptionDefault: "Name, port, protocol",
  },
  {
    id: "transport",
    icon: Network,
    labelKey: "pages.inbounds.stepTransport",
    labelDefault: "Transport & security",
    descriptionKey: "pages.inbounds.stepTransportDesc",
    descriptionDefault: "Stream & TLS/Reality",
  },
  {
    id: "auth",
    icon: KeyRound,
    labelKey: "pages.inbounds.stepAuth",
    labelDefault: "Authentication",
    descriptionKey: "pages.inbounds.stepAuthDesc",
    descriptionDefault: "Protocol-specific",
  },
  {
    id: "sniffing",
    icon: Eye,
    labelKey: "pages.inbounds.stepSniffing",
    labelDefault: "Sniffing",
    descriptionKey: "pages.inbounds.stepSniffingDesc",
    descriptionDefault: "Destination override",
  },
  {
    id: "nodes",
    icon: Server,
    labelKey: "pages.inbounds.stepNodes",
    labelDefault: "Nodes",
    descriptionKey: "pages.inbounds.stepNodesDesc",
    descriptionDefault: "Where this inbound runs",
  },
];

const PROTOCOL_TONE: Record<string, "accent" | "info" | "warning" | "success" | "neutral"> = {
  vless: "accent",
  vmess: "info",
  trojan: "warning",
  shadowsocks: "success",
  mixed: "neutral",
  hysteria2: "accent",
  hysteria: "accent",
  wireguard: "success",
  amneziawg: "success",
  telemt: "info",
};

const defaultForm = () => ({
  nameFlag: "",
  remark: "",
  tag: "",
  port: randomPort(),
  listen: "",
  enable: true,
  protocol: "vless" as InboundFormProtocol,
  vlessFlow: "",
  vlessEncryption: "none",
  vlessDecryption: "none",
  trojanPassword: randomPassword(12),
  hysteriaAuth: randomPassword(8),
  ssMethod: "aes-256-gcm",
  ssPassword: randomShadowsocksServerPassword("aes-256-gcm"),
  mixedUser: "proxy",
  mixedPassword: randomPassword(12),
  wireguardForm: defaultWireguardForm(),
  amneziawgForm: defaultAmneziaWgInboundForm(),
  telemtForm: defaultTelemtForm(),
  totalGb: "0",
  trafficReset: "never",
  streamForm: defaultStreamForm(),
  sniffingForm: defaultSniffingForm(),
  vlessTrojanFallbacks: [] as VlessTrojanFallbackFormRow[],
});

export function InboundsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggleEnableBusyId, setToggleEnableBusyId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [inboundModalView, setInboundModalView] = useState<"form" | "preview">("form");
  const [coreConfigDraft, setCoreConfigDraft] = useState("");
  const coreConfigDraftRef = useRef(coreConfigDraft);
  coreConfigDraftRef.current = coreConfigDraft;
  const [coreConfigDraftDirty, setCoreConfigDraftDirty] = useState(false);
  /** Bumped to refetch Xray core preview (e.g. "Reload from form" while draft is not dirty). */
  const [coreConfigPreviewNonce, setCoreConfigPreviewNonce] = useState(0);
  const [xrayPreviewText, setXrayPreviewText] = useState<string | null>(null);
  const [xrayPreviewLoading, setXrayPreviewLoading] = useState(false);
  const [xrayPreviewError, setXrayPreviewError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [fetchingInbound, setFetchingInbound] = useState(false);
  const [step, setStep] = useState<InboundStepId>("basics");
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [nodeBindings, setNodeBindings] = useState<NodeBindingFormRow[]>([]);
  /** When false/loading, the wizard omits the “Nodes” step (standalone / single node). */
  const [multiNodeMode, setMultiNodeMode] = useState<boolean | null>(null);
  const [baselineSettings, setBaselineSettings] = useState("");

  const [preserveTraffic, setPreserveTraffic] = useState({
    up: 0,
    down: 0,
    allTime: 0,
  });

  const [sortKey, setSortKey] = useState<InboundSortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [columnFilters, setColumnFilters] = useState<
    Record<InboundColumnFilterId, string>
  >(() => ({ ...INBOUND_DEFAULT_FILTERS }));
  const [trafficCompareOp, setTrafficCompareOp] = useState<CompareOp>("");
  const [filterStatus, setFilterStatus] = useState<InboundFilterStatus>("");
  const [viewMode, setViewModeState] = useState<ListViewMode>("table");

  useEffect(() => {
    setViewModeState(readListViewMode(INBOUNDS_VIEW_MODE_STORAGE_KEY));
  }, []);

  const setViewMode = useCallback((mode: ListViewMode) => {
    setViewModeState(mode);
    writeListViewMode(INBOUNDS_VIEW_MODE_STORAGE_KEY, mode);
  }, []);

  const ws = usePanelWebSocket();
  const resyncAfterDisconnect = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getJson<Row[]>(panel("api/inbounds/list"));
    setLoading(false);
    if (r.success && r.obj) {
      setRows(inboundsPayloadToRows(r.obj));
    }
  }, []);

  const loadNodes = useCallback(async () => {
    const r = await getJson<{ id: number; name: string }[]>(panel("node/list"));
    if (r.success && Array.isArray(r.obj)) {
      setNodes(
        (r.obj as { id: number; name: string }[]).map((n) => ({
          id: n.id,
          name: n.name || `Node ${n.id}`,
        })),
      );
    } else {
      setNodes([]);
    }
  }, []);

  const loadMultiNodeMode = useCallback(async () => {
    const s = await postJson<Record<string, unknown>>(panel("setting/all"));
    if (s.success && s.obj) {
      setMultiNodeMode(
        Boolean((s.obj as { multiNodeMode?: boolean }).multiNodeMode),
      );
    } else {
      setMultiNodeMode(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!ws) return;
    const onInbounds = (p: unknown) => {
      if (!Array.isArray(p)) return;
      setRows(inboundsPayloadToRows(p));
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
    ws.on("inbounds", onInbounds);
    ws.on("disconnected", onDisc);
    ws.on("connected", onConn);
    return () => {
      ws.off("inbounds", onInbounds);
      ws.off("disconnected", onDisc);
      ws.off("connected", onConn);
    };
  }, [ws, load]);

  useEffect(() => {
    if (modalOpen) {
      void loadNodes();
      void loadMultiNodeMode();
    }
  }, [modalOpen, loadNodes, loadMultiNodeMode]);

  const resetAddForm = useCallback(() => {
    setForm(defaultForm());
    setNodeBindings([]);
    setBaselineSettings("");
    setEditId(null);
    setStep("basics");
    setPreserveTraffic({ up: 0, down: 0, allTime: 0 });
    setInboundModalView("form");
    setCoreConfigDraftDirty(false);
    setCoreConfigDraft("");
    setXrayPreviewText(null);
    setCoreConfigPreviewNonce(0);
  }, []);

  const openAdd = () => {
    resetAddForm();
    setStep("basics");
    setFetchingInbound(false);
    setModalOpen(true);
  };

  const openEdit = useCallback(async (id: number) => {
    setModalOpen(true);
    setInboundModalView("form");
    setFetchingInbound(true);
    setEditId(id);
    setStep("basics");
    try {
      const r = await getJson<InboundDetail>(panel(`api/inbounds/get/${id}`));
      if (!r.success || !r.obj) {
        toast.error((r as { msg?: string }).msg || t("fail"));
        setModalOpen(false);
        setEditId(null);
        return;
      }
      const ib = r.obj as InboundDetail;
      const proto = isInboundFormProtocol(ib.protocol) ? ib.protocol : "vless";
      const parsed = parseFirstClientFromSettings(ib.settings || "{}", proto);
      setBaselineSettings(ib.settings || "{}");
      setPreserveTraffic({
        up: ib.up ?? 0,
        down: ib.down ?? 0,
        allTime: ib.allTime ?? 0,
      });
      const { flag: nameFlag, text: remarkText } = splitNameFlag(
        ib.remark ?? "",
      );
      const streamForm = parseStreamSettingsToForm(
        proto === "telemt" || proto === "amneziawg"
          ? "{}"
          : (ib.streamSettings || defaultStreamSettingsString()),
        proto,
      );
      const vlessEncryption = parsed.vlessEncryption ?? "";
      const vlessFlow =
        proto === "vless"
          ? effectiveVlessFlow(streamForm, parsed.vlessFlow ?? "", vlessEncryption)
          : (parsed.vlessFlow ?? "");
      setForm({
        nameFlag,
        remark: remarkText,
        tag: ib.tag ?? "",
        port: ib.port,
        listen: ib.listen ?? "",
        enable: ib.enable,
        protocol: proto,
        vlessFlow,
        vlessEncryption,
        vlessDecryption: parsed.vlessDecryption ?? "none",
        trojanPassword: parsed.trojanPassword ?? randomPassword(12),
        hysteriaAuth: parsed.hysteriaAuth ?? randomPassword(8),
        ssMethod: parsed.ssMethod ?? "aes-256-gcm",
        ssPassword: parsed.ssPassword ?? randomShadowsocksServerPassword(parsed.ssMethod ?? "aes-256-gcm"),
        mixedUser: parsed.mixedUser ?? "proxy",
        mixedPassword: parsed.mixedPassword ?? randomPassword(12),
        wireguardForm:
          proto === "wireguard"
            ? parseWireguardSettingsToForm(ib.settings || "{}")
            : defaultWireguardForm(),
        amneziawgForm:
          proto === "amneziawg"
            ? parseAmneziaWgSettingsToForm(ib.settings || "{}")
            : defaultAmneziaWgInboundForm(),
        telemtForm:
          proto === "telemt"
            ? parseTelemtSettingsToForm(ib.settings || "{}")
            : defaultTelemtForm(),
        totalGb: totalBytesToGbInput(ib.total ?? 0),
        trafficReset: ib.trafficReset || "never",
        streamForm,
        sniffingForm: parseSniffingToForm(
          proto === "telemt" || proto === "amneziawg"
            ? '{"enabled":false,"destOverride":[],"metadataOnly":false,"routeOnly":false}'
            : (ib.sniffing || defaultSniffingString()),
        ),
        vlessTrojanFallbacks: parsed.vlessTrojanFallbacks ?? ([] as VlessTrojanFallbackFormRow[]),
      });
      setNodeBindings(inboundBindingsToForm(ib));
    } catch {
      toast.error(t("fail"));
      setModalOpen(false);
      setEditId(null);
    } finally {
      setFetchingInbound(false);
    }
  }, [t, toast]);

  const moveNodeBinding = useCallback((idx: number, dir: -1 | 1) => {
    setNodeBindings((rows) => {
      const j = idx + dir;
      if (j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }, []);

  const patchNodeBinding = useCallback(
    (nodeId: number, patch: Partial<NodeBindingFormRow>) => {
      setNodeBindings((rows) =>
        rows.map((r) => (r.nodeId === nodeId ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const applyStreamPresetForProtocol = (protocol: InboundFormProtocol) => {
    if (isSidecarInboundProtocol(protocol)) {
      setCoreConfigDraftDirty(false);
      setCoreConfigDraft("");
    }
    setForm((f) => {
      const isSwitchingToWg = protocol === "wireguard" && f.protocol !== "wireguard";
      const isSwitchingToAwg = protocol === "amneziawg" && f.protocol !== "amneziawg";
      const isSwitchingToTelemt = protocol === "telemt" && f.protocol !== "telemt";
      const isSidecar =
        protocol === "telemt" ||
        protocol === "amneziawg" ||
        protocol === "wireguard";
      const streamForm = isSidecar
        ? parseStreamSettingsToForm("{}", protocol)
        : protocol === "hysteria" || protocol === "hysteria2"
          ? defaultStreamFormHysteria()
          : defaultStreamForm();
      const out = {
        ...f,
        protocol,
        streamForm,
        vlessFlow: isSidecar ? "" : f.vlessFlow,
        wireguardForm: isSwitchingToWg ? defaultWireguardForm() : f.wireguardForm,
        amneziawgForm: isSwitchingToAwg ? defaultAmneziaWgInboundForm() : f.amneziawgForm,
        telemtForm: isSwitchingToTelemt ? defaultTelemtForm() : f.telemtForm,
      };
      if (isSwitchingToTelemt) {
        out.port = 443;
        if (!f.remark.trim()) {
          out.remark = t("pages.inbounds.telemtDefaultRemark", {
            defaultValue: "Telemt MTProto",
          });
        }
        if (!f.listen.trim()) {
          out.listen = "0.0.0.0";
        }
      }
      if (isSwitchingToWg) {
        out.port = 51820;
        if (!f.remark.trim()) {
          out.remark = t("pages.inbounds.wireguardDefaultRemark", {
            defaultValue: "WireGuard",
          });
        }
        if (!f.listen.trim()) {
          out.listen = "0.0.0.0";
        }
      }
      if (isSwitchingToAwg) {
        out.port = 51820;
        if (!f.remark.trim()) {
          out.remark = t("pages.inbounds.amneziawgDefaultRemark", {
            defaultValue: "AmneziaWG",
          });
        }
        if (!f.listen.trim()) {
          out.listen = "0.0.0.0";
        }
        out.amneziawgForm = {
          ...defaultAmneziaWgInboundForm(),
          ...randomAmneziaWgObfuscationFields(),
        };
      }
      return out;
    });
  };

  const applyStreamFormPreset = (preset: "tcp" | "tcpTls") => {
    setForm((f) => {
      const json =
        preset === "tcp"
          ? defaultStreamSettingsString()
          : streamPresetTcpTlsString();
      return {
        ...f,
        streamForm: parseStreamSettingsToForm(json, f.protocol),
      };
    });
  };

  const applyStreamFormPresetShadowsocks = (preset: "tcp" | "ws") => {
    setForm((f) => {
      const json =
        preset === "tcp"
          ? defaultStreamSettingsString()
          : streamPresetShadowsocksWsString();
      return {
        ...f,
        streamForm: parseStreamSettingsToForm(json, f.protocol),
      };
    });
  };

  const setStreamFormField = <K extends keyof StreamFormState>(
    key: K,
    value: StreamFormState[K],
  ) => {
    setForm((f) => {
      const streamForm = { ...f.streamForm, [key]: value };
      let vlessFlow = f.vlessFlow;
      if (f.protocol === "vless") {
        if (key === "network" && value === "xhttp") {
          vlessFlow = "";
        }
        if (!vlessXtlsFlowAllowed(streamForm, f.vlessEncryption)) {
          vlessFlow = "";
        }
      }
      return { ...f, streamForm, vlessFlow };
    });
  };

  const applyVlessFlowChange = (flow: string) => {
    setForm((f) => {
      if (f.protocol !== "vless") {
        return { ...f, vlessFlow: flow };
      }
      let streamForm = f.streamForm;
      if (flow.trim() !== "" && streamForm.network === "xhttp") {
        streamForm = { ...streamForm, network: "tcp" };
      }
      const vlessFlow = effectiveVlessFlow(streamForm, flow, f.vlessEncryption);
      return { ...f, vlessFlow, streamForm };
    });
  };

  const addXhttpHeader = () => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        xhttpHeaders: [...f.streamForm.xhttpHeaders, { name: "", value: "" }],
      },
    }));
  };

  const removeXhttpHeader = (index: number) => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        xhttpHeaders: f.streamForm.xhttpHeaders.filter((_, i) => i !== index),
      },
    }));
  };

  const setXhttpHeaderField = (
    index: number,
    key: "name" | "value",
    value: string,
  ) => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        xhttpHeaders: f.streamForm.xhttpHeaders.map((row, i) =>
          i === index ? { ...row, [key]: value } : row,
        ),
      },
    }));
  };

  const addTcpReqHeader = () => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        tcpHttpRequestHeaders: [...f.streamForm.tcpHttpRequestHeaders, { name: "", value: "" }],
      },
    }));
  };
  const removeTcpReqHeader = (index: number) => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        tcpHttpRequestHeaders: f.streamForm.tcpHttpRequestHeaders.filter((_, i) => i !== index),
      },
    }));
  };
  const setTcpReqHeaderField = (index: number, key: "name" | "value", value: string) => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        tcpHttpRequestHeaders: f.streamForm.tcpHttpRequestHeaders.map((row, i) =>
          i === index ? { ...row, [key]: value } : row,
        ),
      },
    }));
  };

  const addTcpRespHeader = () => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        tcpHttpResponseHeaders: [...f.streamForm.tcpHttpResponseHeaders, { name: "", value: "" }],
      },
    }));
  };
  const removeTcpRespHeader = (index: number) => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        tcpHttpResponseHeaders: f.streamForm.tcpHttpResponseHeaders.filter((_, i) => i !== index),
      },
    }));
  };
  const setTcpRespHeaderField = (index: number, key: "name" | "value", value: string) => {
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        tcpHttpResponseHeaders: f.streamForm.tcpHttpResponseHeaders.map((row, i) =>
          i === index ? { ...row, [key]: value } : row,
        ),
      },
    }));
  };

  const setSniffingFormField = <K extends keyof SniffingFormState>(
    key: K,
    value: SniffingFormState[K],
  ) => {
    setForm((f) => ({
      ...f,
      sniffingForm: { ...f.sniffingForm, [key]: value },
    }));
  };

  const useCoreConfigDraftOnSubmit =
    inboundModalView === "preview" && coreConfigDraftDirty;

  const buildInboundSubmitBody = useCallback(():
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; message: string } => {
    if (!form.port || form.port < 1 || form.port > 65535) {
      return { ok: false, message: t("pages.inbounds.port") + ": 1–65535" };
    }
    const tagTrim = form.tag.trim();
    const tagValidation = validateInboundTagInput(tagTrim);
    if (tagValidation) {
      return { ok: false, message: tagValidation };
    }
    const isSidecar =
      form.protocol === "telemt" || form.protocol === "amneziawg";
    let streamSettingsStr = isSidecar
      ? "{}"
      : buildStreamSettingsFromForm(form.streamForm, form.protocol);
    let sniffingStr = isSidecar
      ? JSON.stringify({
          enabled: false,
          destOverride: [],
          metadataOnly: false,
          routeOnly: false,
        })
      : buildSniffingFromForm(form.sniffingForm);
    let settingsFromCore: string | null = null;
    let coreListen: string | undefined;
    let corePort: number | undefined;
    let coreTag: string | undefined;
    let coreFormPatch: Partial<ReturnType<typeof parseFirstClientFromSettings>> = {};

    if (useCoreConfigDraftOnSubmit && !isSidecar && coreConfigDraftRef.current.trim()) {
      const coreRt = roundTripInboundCoreConfig(
        coreConfigDraftRef.current,
        form.protocol,
        baselineSettings,
      );
      if (!coreRt.ok) {
        return { ok: false, message: coreRt.message };
      }
      streamSettingsStr = coreRt.patch.streamSettingsStr;
      sniffingStr = coreRt.patch.sniffingStr;
      settingsFromCore = coreRt.patch.settingsStr;
      coreListen = coreRt.patch.listen;
      corePort = coreRt.patch.port;
      coreTag = coreRt.patch.tag;
      coreFormPatch = coreRt.patch.formPatch;
      const coreTagValidation = validateInboundTagInput(coreTag);
      if (coreTagValidation) {
        return { ok: false, message: coreTagValidation };
      }
    } else if (!isSidecar) {
      const rt = roundTripInboundStreamSettings(streamSettingsStr, form.protocol);
      if (!rt.ok) {
        return { ok: false, message: rt.message };
      }
      streamSettingsStr = rt.json;
    }
    let streamObj: unknown;
    let sniffObj: unknown;
    try {
      streamObj = JSON.parse(streamSettingsStr);
    } catch {
      return { ok: false, message: t("pages.inbounds.invalidStreamJson") };
    }
    if (!useCoreConfigDraftOnSubmit && !isSidecar) {
      const sn = roundTripInboundSniffing(sniffingStr);
      if (!sn.ok) {
        return { ok: false, message: sn.message };
      }
      sniffingStr = sn.json;
    }
    try {
      sniffObj = JSON.parse(sniffingStr);
    } catch {
      return { ok: false, message: t("pages.inbounds.invalidSniffingJson") };
    }
    if (typeof streamObj !== "object" || streamObj === null) {
      return { ok: false, message: t("pages.inbounds.invalidStreamJson") };
    }
    if (typeof sniffObj !== "object" || sniffObj === null) {
      return { ok: false, message: t("pages.inbounds.invalidSniffingJson") };
    }

    const patch = {
      clientEmail: "",
      vlessFlow: effectiveVlessFlow(
        form.streamForm,
        coreFormPatch.vlessFlow ?? form.vlessFlow,
        coreFormPatch.vlessEncryption ?? form.vlessEncryption,
      ),
      vlessEncryption: coreFormPatch.vlessEncryption ?? form.vlessEncryption,
      vlessDecryption: coreFormPatch.vlessDecryption ?? form.vlessDecryption,
      trojanPassword: coreFormPatch.trojanPassword ?? form.trojanPassword,
      hysteriaAuth: coreFormPatch.hysteriaAuth ?? form.hysteriaAuth,
      ssMethod: coreFormPatch.ssMethod ?? form.ssMethod,
      ssPassword: coreFormPatch.ssPassword ?? form.ssPassword,
      mixedUser: coreFormPatch.mixedUser ?? form.mixedUser,
      mixedPassword: coreFormPatch.mixedPassword ?? form.mixedPassword,
      vlessTrojanFallbacks:
        form.protocol === "vless" || form.protocol === "trojan"
          ? (coreFormPatch.vlessTrojanFallbacks ?? form.vlessTrojanFallbacks)
          : undefined,
    };

    let settings: string;
    if (settingsFromCore != null) {
      settings = settingsFromCore;
    } else if (form.protocol === "wireguard" || form.protocol === "amneziawg") {
      settings = "{}";
    } else if (form.protocol === "telemt") {
      settings = buildTelemtSettingsJson(form.telemtForm);
    } else if (form.protocol === "mixed") {
      // For mixed, accounts are managed entirely via client assignments.
      // Preserve existing settings from DB on edit; require password auth skeleton on create.
      if (editId != null) {
        settings = baselineSettings || JSON.stringify({ auth: "password", udp: true });
      } else {
        settings = JSON.stringify({ auth: "password", udp: true });
      }
    } else if (editId != null) {
      settings = mergeFirstClientIntoSettings(baselineSettings, form.protocol, patch);
    } else {
      settings = buildSettingsJson(form.protocol, patch);
    }

    const tg = parseFloat(form.totalGb);
    const totalBytes =
      Number.isFinite(tg) && tg > 0 ? Math.round(tg * 1024 * 1024 * 1024) : 0;

    const bindingsPayload = nodeBindings
      .filter((b) => b.nodeId > 0)
      .map((b) => ({
        nodeId: b.nodeId,
        publishedAddress: b.publishedAddress.trim(),
        publishedPort: Math.max(0, Math.floor(Number(b.publishedPort)) || 0),
        includeInSubscription: b.includeInSubscription,
        subscriptionRemarkSuffix: b.subscriptionRemarkSuffix.trim(),
        serverDescription: b.serverDescription.trim(),
      }));

    const body: Record<string, unknown> = {
      remark: joinNameFlag(form.nameFlag, form.remark),
      tag: coreTag ?? tagTrim,
      enable: form.enable,
      listen: coreListen ?? form.listen.trim(),
      port: corePort ?? form.port,
      protocol: form.protocol,
      settings,
      streamSettings: streamSettingsStr,
      sniffing: sniffingStr,
      total: totalBytes,
      expiryTime: 0,
      trafficReset: form.trafficReset,
      up: editId != null ? preserveTraffic.up : 0,
      down: editId != null ? preserveTraffic.down : 0,
    };
    if (editId != null) {
      body.allTime = preserveTraffic.allTime;
    }
    if (form.protocol === "wireguard") {
      body.wireguard = buildWireguardInboundApiPayload(form.wireguardForm);
    }
    if (form.protocol === "amneziawg") {
      body.amneziawg = buildAmneziaWgInboundApiPayload(form.amneziawgForm);
    }
    if (bindingsPayload.length > 0) {
      body.nodeBindings = bindingsPayload;
    }
    return { ok: true, body };
  }, [
    baselineSettings,
    editId,
    form,
    nodeBindings,
    preserveTraffic,
    useCoreConfigDraftOnSubmit,
    t,
  ]);

  const inboundApiPayloadPreview = useMemo(
    () => buildInboundSubmitBody(),
    [buildInboundSubmitBody],
  );

  useEffect(() => {
    if (!modalOpen || inboundModalView !== "preview") {
      return;
    }
    if (coreConfigDraftDirty) {
      return;
    }
    if (!inboundApiPayloadPreview.ok) {
      setXrayPreviewText(null);
      setXrayPreviewError(inboundApiPayloadPreview.message);
      setXrayPreviewLoading(false);
      return;
    }
    let alive = true;
    setXrayPreviewLoading(true);
    setXrayPreviewError(null);
    setXrayPreviewText(null);
    const body: Record<string, unknown> = {
      ...inboundApiPayloadPreview.body,
    };
    if (editId != null) {
      body.id = editId;
    }
    const isTelemt = form.protocol === "telemt";
    const isAmneziaWg = form.protocol === "amneziawg";
    const fail = (msg: string) => {
      if (!alive) return;
      setXrayPreviewText(null);
      setXrayPreviewError(msg);
      setXrayPreviewLoading(false);
    };
    void (
      isTelemt
        ? postJson<{ toml: string }>(panel("api/inbounds/previewTelemt"), body, true)
        : isAmneziaWg
          ? postJson<{ conf: string }>(panel("api/inbounds/previewAmneziaWg"), body, true)
          : postJson<unknown>(panel("api/inbounds/previewXray"), body, true)
    ).then(
      (r) => {
        if (!alive) return;
        if (r.success && r.obj != null) {
          if (isTelemt) {
            const tom = (r.obj as { toml?: unknown }).toml;
            if (typeof tom === "string") {
              setXrayPreviewText(tom);
              setXrayPreviewError(null);
            } else {
              fail(t("fail", { defaultValue: "Error" }));
            }
          } else if (isAmneziaWg) {
            const conf = (r.obj as { conf?: unknown }).conf;
            if (typeof conf === "string") {
              setXrayPreviewText(conf);
              setXrayPreviewError(null);
            } else {
              fail(t("fail", { defaultValue: "Error" }));
            }
          } else {
            const text = JSON.stringify(r.obj, null, 2);
            setXrayPreviewText(text);
            setXrayPreviewError(null);
            if (!coreConfigDraftDirty) {
              setCoreConfigDraft(text);
            }
          }
        } else {
          fail((r as { msg?: string }).msg || t("fail", { defaultValue: "Error" }));
        }
        setXrayPreviewLoading(false);
      },
      () => {
        fail(t("fail", { defaultValue: "Error" }));
      },
    );
    return () => {
      alive = false;
    };
  }, [
    modalOpen,
    inboundModalView,
    inboundApiPayloadPreview,
    editId,
    t,
    form.protocol,
    coreConfigDraftDirty,
    coreConfigPreviewNonce,
  ]);

  const reloadCoreConfigFromForm = useCallback(() => {
    setCoreConfigDraftDirty(false);
    setCoreConfigPreviewNonce((n) => n + 1);
  }, []);

  const submitModal = async () => {
    const built = buildInboundSubmitBody();
    if (!built.ok) {
      toast.error(built.message);
      return;
    }
    setModalSubmitting(true);
    try {
      const url =
        editId != null
          ? panel(`api/inbounds/update/${editId}`)
          : panel("api/inbounds/add");
      const r = await postJson<unknown>(url, built.body, true);
      if (r.success) {
        toast.success(
          (r as { msg?: string }).msg || t("success", { defaultValue: "OK" }),
        );
        setModalOpen(false);
        resetAddForm();
        void load();
      } else {
        toast.error(
          (r as { msg?: string }).msg || t("fail", { defaultValue: "Error" }),
        );
      }
    } catch {
      toast.error(t("fail", { defaultValue: "Error" }));
    } finally {
      setModalSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    setDeleting(true);
    const r = await postJson(panel(`api/inbounds/del/${deleteId}`));
    setDeleting(false);
    if (r.success) {
      toast.success(t("success"));
      setDeleteId(null);
      void load();
    } else {
      toast.error((r as { msg?: string }).msg || t("fail"));
    }
  };

  const setInboundEnableFromRow = useCallback(
    async (id: number, nextEnable: boolean) => {
      setToggleEnableBusyId(id);
      try {
        const r = await getJson<InboundDetail>(panel(`api/inbounds/get/${id}`));
        if (!r.success || !r.obj) {
          toast.error((r as { msg?: string }).msg || t("fail"));
          return;
        }
        const ib = r.obj as InboundDetail;
        const proto = isInboundFormProtocol(ib.protocol) ? ib.protocol : "vless";
        const sidecar = isSidecarInboundProtocol(proto);
        const body: Record<string, unknown> = {
          remark: ib.remark ?? "",
          enable: nextEnable,
          listen: (ib.listen ?? "").trim(),
          port: ib.port,
          protocol: ib.protocol,
          settings: ib.settings ?? "{}",
          streamSettings: sidecar
            ? "{}"
            : (ib.streamSettings ?? defaultStreamSettingsString()),
          sniffing: sidecar
            ? sidecarEmptySniffingString()
            : (ib.sniffing ?? defaultSniffingString()),
          total: ib.total ?? 0,
          expiryTime: ib.expiryTime ?? 0,
          trafficReset: ib.trafficReset || "never",
          up: ib.up ?? 0,
          down: ib.down ?? 0,
          allTime: ib.allTime ?? 0,
        };
        const nb = (ib.nodeBindings ?? []).filter((b) => (b.nodeId ?? 0) > 0);
        if (nb.length > 0) {
          body.nodeBindings = nb.map((b) => ({
            nodeId: b.nodeId,
            publishedAddress: (b.publishedAddress ?? "").trim(),
            publishedPort: b.publishedPort ?? 0,
            includeInSubscription: b.includeInSubscription !== false,
            subscriptionRemarkSuffix: (b.subscriptionRemarkSuffix ?? "").trim(),
            serverDescription: (b.serverDescription ?? "").trim(),
          }));
        } else {
          const nids = ib.nodeIds?.filter((n) => n > 0) ?? [];
          if (nids.length > 0) body.nodeIds = nids;
        }
        const up = await postJson<unknown>(panel(`api/inbounds/update/${id}`), body, true);
        if (up.success) {
          toast.success(
            (up as { msg?: string }).msg || t("success", { defaultValue: "OK" }),
          );
          void load();
        } else {
          toast.error((up as { msg?: string }).msg || t("fail"));
        }
      } catch {
        toast.error(t("fail"));
      } finally {
        setToggleEnableBusyId(null);
      }
    },
    [load, t, toast],
  );

  const realityFingerprintOptions = useMemo(() => {
    const fp = form.streamForm.realityFingerprint.trim();
    const list: string[] = [...REALITY_FINGERPRINTS];
    if (fp && !list.includes(fp)) list.unshift(fp);
    return list;
  }, [form.streamForm.realityFingerprint]);

  const hysteriaTlsFingerprintOptions = useMemo(() => {
    const fp = form.streamForm.tlsUtlsFingerprint.trim();
    const list: string[] = [...REALITY_FINGERPRINTS];
    if (fp && !list.includes(fp)) list.unshift(fp);
    return list;
  }, [form.streamForm.tlsUtlsFingerprint]);

  const isEdit = editId != null;

  const inboundStepOrder = useMemo<InboundStepId[]>(() => {
    // mixed: inbounds use client assignments only — no per-protocol auth step.
    // telemt: settings UI lives on the auth step (same slot as other protocols).
    const hasAuth = form.protocol !== "mixed";
    return INBOUND_STEP_ORDER.filter((id) => {
      if (id === "nodes" && multiNodeMode !== true) return false;
      if (id === "auth" && !hasAuth) return false;
      if (id === "sniffing" && (form.protocol === "telemt" || form.protocol === "amneziawg")) return false;
      return true;
    });
  }, [multiNodeMode, form.protocol]);

  useEffect(() => {
    if (inboundStepOrder.length > 0 && !inboundStepOrder.includes(step)) {
      let next: InboundStepId | undefined;
      const idx = INBOUND_STEP_ORDER.indexOf(step);
      for (let i = idx; i >= 0; i--) {
        const id = INBOUND_STEP_ORDER[i];
        if (id && inboundStepOrder.includes(id)) {
          next = id;
          break;
        }
      }
      setStep(next ?? inboundStepOrder[0] ?? "basics");
    }
  }, [inboundStepOrder, step]);

  useEffect(() => {
    if (step === "nodes" && multiNodeMode !== true) {
      setStep("sniffing");
    }
    if (step === "auth" && form.protocol === "mixed") {
      setStep("sniffing");
    }
  }, [step, multiNodeMode, form.protocol]);

  const stepIdx = inboundStepOrder.indexOf(step);
  const isLastStep =
    inboundStepOrder.length > 0 &&
    stepIdx === inboundStepOrder.length - 1;
  const isFirstStep = stepIdx === 0;
  const goNextStep = useCallback(() => {
    setStep((s) => {
      const order = inboundStepOrder;
      const idx = order.indexOf(s);
      if (idx < 0) return order[0] ?? "basics";
      return order[Math.min(idx + 1, order.length - 1)];
    });
  }, [inboundStepOrder]);
  const goPrevStep = useCallback(() => {
    setStep((s) => {
      const order = inboundStepOrder;
      const idx = order.indexOf(s);
      if (idx < 0) return order[0] ?? "basics";
      return order[Math.max(idx - 1, 0)];
    });
  }, [inboundStepOrder]);

  const stepperItems = useMemo(
    () =>
      inboundStepOrder.map((id) => {
        const s = INBOUND_STEPS.find((x) => x.id === id);
        if (!s) {
          return {
            id,
            label: id,
            description: "",
            icon: SlidersHorizontal,
          };
        }
        const isTelemtAuth = id === "auth" && form.protocol === "telemt";
        return {
          id: s.id,
          label: isTelemtAuth
            ? t("pages.inbounds.stepTelemtAuth", { defaultValue: "Telemt (MTProto)" })
            : t(s.labelKey, { defaultValue: s.labelDefault }),
          description: isTelemtAuth
            ? t("pages.inbounds.stepTelemtAuthDesc", {
                defaultValue: "Fake-TLS modes, SNI domain, links, API",
              })
            : t(s.descriptionKey, { defaultValue: s.descriptionDefault }),
          icon: s.icon,
        };
      }),
    [t, inboundStepOrder, form.protocol],
  );

  const tabItems = useMemo(
    () =>
      inboundStepOrder.map((id) => {
        const s = INBOUND_STEPS.find((x) => x.id === id);
        if (!s) {
          return { id, label: id, title: id, icon: SlidersHorizontal };
        }
        const isTelemtAuth = id === "auth" && form.protocol === "telemt";
        const label = isTelemtAuth
          ? t("pages.inbounds.stepTelemtAuth", { defaultValue: "Telemt (MTProto)" })
          : t(s.labelKey, { defaultValue: s.labelDefault });
        const desc = isTelemtAuth
          ? t("pages.inbounds.stepTelemtAuthDesc", {
              defaultValue: "Fake-TLS modes, SNI domain, links, API",
            })
          : t(s.descriptionKey, { defaultValue: s.descriptionDefault });
        return {
          id: s.id,
          label,
          title: desc ? `${label} — ${desc}` : label,
          icon: s.icon,
        };
      }),
    [t, inboundStepOrder, form.protocol],
  );

  const modalHeaderIconTone = PROTOCOL_TONE[form.protocol] ?? "accent";

  const protocolOptions = useMemo(() => {
    const base = PROTOCOLS.map((x) => (
      <option key={x.value} value={x.value}>
        {x.label}
      </option>
    ));
    if (isEdit && form.protocol === "hysteria") {
      return [
        <option key="hysteria-legacy" value="hysteria">
          {t("pages.inbounds.protocolHysteriaV1Legacy", {
            defaultValue: "Hysteria (v1, legacy)",
          })}
        </option>,
        ...base,
      ];
    }
    return base;
  }, [isEdit, form.protocol, t]);

  const fillRealitySniFromTarget = useCallback(() => {
    const host = hostFromRealityTarget(form.streamForm.realityTarget);
    if (!host) {
      toast.error(
        t("pages.inbounds.genRealitySniNeedTarget", {
          defaultValue: "Set target (host:port) first.",
        }),
      );
      return;
    }
    const alt = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    const names = [host, alt].filter((x, i, a) => a.indexOf(x) === i);
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        realityServerNames: names.join(","),
        realitySettingsServerName:
          f.streamForm.realitySettingsServerName.trim() || host,
      },
    }));
  }, [form.streamForm.realityTarget, toast, t]);

  const generateRealityX25519 = useCallback(async () => {
    const r = await getJson<{ privateKey: string; publicKey: string }>(
      panel("api/server/getNewX25519Cert"),
    );
    if (!r.success || !r.obj || typeof r.obj !== "object") {
      toast.error((r as { msg?: string }).msg || t("fail"));
      return;
    }
    const o = r.obj as { privateKey?: string; publicKey?: string };
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        realityPrivateKey: o.privateKey ?? "",
        realityPublicKey: o.publicKey ?? "",
      },
    }));
    toast.success(t("success", { defaultValue: "OK" }));
  }, [toast, t]);

  const generateRealityMldsa65 = useCallback(async () => {
    const r = await getJson<{ seed: string; verify: string }>(
      panel("api/server/getNewmldsa65"),
    );
    if (!r.success || !r.obj || typeof r.obj !== "object") {
      toast.error((r as { msg?: string }).msg || t("fail"));
      return;
    }
    const o = r.obj as { seed?: string; verify?: string };
    setForm((f) => ({
      ...f,
      streamForm: {
        ...f.streamForm,
        realityMldsa65Seed: o.seed ?? "",
        realityMldsa65Verify: o.verify ?? "",
      },
    }));
    toast.success(t("success", { defaultValue: "OK" }));
  }, [toast, t]);

  const defaultDirForInboundKey = (k: InboundSortKey): SortDir => {
    switch (k) {
      case "used":
        return "desc";
      case "id":
      case "remark":
      case "tag":
      case "protocol":
      case "port":
      case "status":
        return "asc";
      default:
        return "asc";
    }
  };

  const toggleInboundSort = useCallback(
    (k: InboundSortKey) => {
      if (k === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(k);
        setSortDir(defaultDirForInboundKey(k));
      }
    },
    [sortKey],
  );

  const filteredInboundRows = useMemo(() => {
    const remarkNeedle = columnFilters.remark.trim().toLowerCase();
    const tagNeedle = columnFilters.tag.trim().toLowerCase();
    const protocolNeedle = columnFilters.protocol.trim().toLowerCase();
    const portNeedle = columnFilters.port.trim().toLowerCase();
    const trafficRaw = columnFilters.traffic.trim();
    const trafficNeedle =
      trafficCompareOp === "" ? trafficRaw.toLowerCase() : "";
    const trafficThreshold =
      trafficCompareOp !== "" ? parseTrafficFilterBytes(trafficRaw) : null;

    return rows.filter((r) => {
      if (filterStatus === "enabled" && !r.enable) return false;
      if (filterStatus === "disabled" && r.enable) return false;

      if (remarkNeedle && !r.remark.toLowerCase().includes(remarkNeedle)) {
        return false;
      }
      if (tagNeedle && !r.tag.toLowerCase().includes(tagNeedle)) {
        return false;
      }
      if (protocolNeedle && !r.protocol.toLowerCase().includes(protocolNeedle)) {
        return false;
      }
      if (portNeedle && !String(r.port).toLowerCase().includes(portNeedle)) {
        return false;
      }

      if (trafficCompareOp === "") {
        if (trafficNeedle && !inboundTrafficHaystack(r).includes(trafficNeedle)) {
          return false;
        }
      } else if (trafficThreshold != null) {
        const used = usedBytes(r);
        if (trafficCompareOp === "gt" && !(used > trafficThreshold)) return false;
        if (trafficCompareOp === "lt" && !(used < trafficThreshold)) return false;
        if (trafficCompareOp === "eq" && used !== trafficThreshold) return false;
      }

      return true;
    });
  }, [rows, columnFilters, trafficCompareOp, filterStatus]);

  const hasActiveInboundFilters = useMemo(() => {
    if (filterStatus !== "" || trafficCompareOp !== "") return true;
    return (Object.keys(columnFilters) as InboundColumnFilterId[]).some(
      (k) => columnFilters[k].trim() !== "",
    );
  }, [columnFilters, filterStatus, trafficCompareOp]);

  const displayedInboundRows = useMemo(() => {
    const next = [...filteredInboundRows];
    next.sort((a, b) => compareInbounds(a, b, sortKey, sortDir));
    return next;
  }, [filteredInboundRows, sortKey, sortDir]);

  const inboundListViewCtx = useMemo(
    () => ({
      t,
      onOpenEdit: (id: number) => void openEdit(id),
      onToggleEnable: (id: number, next: boolean) =>
        void setInboundEnableFromRow(id, next),
      toggleEnableBusyId: toggleEnableBusyId,
      onDelete: (id: number) => setDeleteId(id),
    }),
    [t, openEdit, setInboundEnableFromRow, toggleEnableBusyId],
  );

  const isHysteriaFamily =
    form.protocol === "hysteria" || form.protocol === "hysteria2";
  const streamTransportMode = getInboundStreamTransportMode(form.protocol);
  const suggestedInboundTag = useMemo(
    () =>
      suggestInboundTag(
        form.port,
        form.listen,
        multiNodeMode === true,
        editId ?? undefined,
      ),
    [form.port, form.listen, multiNodeMode, editId],
  );

  return (
    <PageScaffold compact>
      <PageHeader
        title={t("menu.inbounds")}
        icon={User}
        iconTone="accent"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={openAdd}
              className="!gap-2"
            >
              <Plus size={16} />
              {t("pages.inbounds.addInbound")}
            </Button>
            <SectionHelpModal
              titleKey="pages.inbounds.helpModalTitle"
              paragraphKeys={[
                "pages.inbounds.helpModalP1",
                "pages.inbounds.helpModalP2",
                "pages.inbounds.helpModalP3",
                "pages.inbounds.helpModalP4",
              ]}
            />
          </>
        }
      />
      <Reveal>
      {rows.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
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
          {hasActiveInboundFilters ? (
            <Button
              type="button"
              variant="secondary"
              className="!h-9 shrink-0 !gap-2 !text-xs"
              onClick={() => {
                setColumnFilters({ ...INBOUND_DEFAULT_FILTERS });
                setTrafficCompareOp("");
                setFilterStatus("");
              }}
            >
              {t("pages.clients.filterClear", {
                defaultValue: "Reset filters",
              })}
            </Button>
          ) : null}
          </div>
          <Segmented<ListViewMode>
            value={viewMode}
            onChange={setViewMode}
            size="sm"
            layoutId="inbounds-view-mode"
            items={[
              {
                id: "table",
                label: t("pages.inbounds.viewModeTable", { defaultValue: "Table" }),
                icon: Table2,
              },
              {
                id: "list",
                label: t("pages.inbounds.viewModeList", { defaultValue: "List" }),
                icon: LayoutList,
              },
              {
                id: "tiles",
                label: t("pages.inbounds.viewModeTiles", { defaultValue: "Tiles" }),
                icon: LayoutGrid,
              },
            ]}
          />
        </div>
      ) : null}
      {rows.length > 0 && filtersVisible ? (
        <Surface padding="none" className="mb-2 overflow-hidden">
          <InboundColumnFiltersBar
            t={t}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
            trafficCompareOp={trafficCompareOp}
            onTrafficCompareOpChange={setTrafficCompareOp}
            filterStatus={filterStatus}
            onFilterStatusChange={setFilterStatus}
          />
        </Surface>
      ) : null}
      {loading && !rows.length ? (
        <Surface padding="none" className="overflow-hidden">
          <div className="grid min-h-48 place-items-center">
            <Spinner size={32} />
          </div>
        </Surface>
      ) : !rows.length ? (
        <Surface padding="none" className="overflow-hidden">
          <div className="grid min-h-48 place-items-center px-4 py-12">
            <div className="flex flex-col items-center gap-3 text-center">
              <IconTile icon={User} tone="neutral" size="lg" />
              <p className="text-sm text-[var(--fg-muted)]">{t("noData")}</p>
            </div>
          </div>
        </Surface>
      ) : viewMode === "table" ? (
        <Surface padding="none" className="overflow-hidden">
          <div className="panel-data-table overflow-x-auto">
            <table className="w-full min-w-[1020px] table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[18%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[var(--surface)] text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                  <InboundSortableTh
                    label={t("remark")}
                    sortKey="remark"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleInboundSort}
                  />
                  <InboundSortableTh
                    label={t("pages.inbounds.tagColumn", { defaultValue: "Tag" })}
                    sortKey="tag"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleInboundSort}
                  />
                  <InboundSortableTh
                    label={t("protocol")}
                    sortKey="protocol"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleInboundSort}
                  />
                  <InboundSortableTh
                    label={t("host")}
                    sortKey="port"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleInboundSort}
                    className="tabular-nums"
                  />
                  <InboundSortableTh
                    label={t("pages.inbounds.totalDownUp", {
                      defaultValue: "Up / down",
                    })}
                    sortKey="used"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleInboundSort}
                  />
                  <InboundSortableTh
                    label={t("status")}
                    sortKey="status"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={toggleInboundSort}
                  />
                  <th className="p-3">{t("pages.inbounds.operate")}</th>
                </tr>
              </thead>
              <tbody>
                {displayedInboundRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-sm text-[var(--fg-muted)]"
                    >
                      {t("pages.inbounds.filterNoResults", {
                        defaultValue: "No inbounds match the current filters.",
                      })}
                    </td>
                  </tr>
                ) : (
                  displayedInboundRows.map((r) => (
                    <tr
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer border-b border-[var(--border)] text-[var(--fg-muted)] hover:bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]"
                      onClick={() => void openEdit(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void openEdit(r.id);
                        }
                      }}
                    >
                      <td
                        className="truncate p-3 font-medium text-[var(--fg)]"
                        title={r.remark || "—"}
                      >
                        {r.remark || "—"}
                      </td>
                      <td
                        className="truncate p-3 font-mono text-xs text-[var(--fg-muted)]"
                        title={r.tag || "—"}
                      >
                        {r.tag || "—"}
                      </td>
                      <td className="truncate p-3" title={r.protocol}>
                        {r.protocol}
                      </td>
                      <td className="p-3 font-mono tabular-nums">{r.port}</td>
                      <td className="p-3 tabular-nums whitespace-nowrap">
                        {sizeFormat(r.up)} / {sizeFormat(r.down)}
                      </td>
                      <td
                        className="p-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Switch
                          size="sm"
                          checked={r.enable}
                          disabled={toggleEnableBusyId === r.id}
                          onChange={(next) => void setInboundEnableFromRow(r.id, next)}
                          ariaLabel={`${t("enable")} — ${r.remark || `inbound ${r.id}`}`}
                        />
                      </td>
                      <td
                        className="p-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="danger"
                            className="!p-2"
                            onClick={() => setDeleteId(r.id)}
                            aria-label={t("delete")}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Surface>
      ) : viewMode === "list" ? (
        <InboundListView
          rows={displayedInboundRows}
          ctx={inboundListViewCtx}
          emptyLabel={t("pages.inbounds.filterNoResults", {
            defaultValue: "No inbounds match the current filters.",
          })}
        />
      ) : (
        <InboundTilesView
          rows={displayedInboundRows}
          ctx={inboundListViewCtx}
          emptyLabel={t("pages.inbounds.filterNoResults", {
            defaultValue: "No inbounds match the current filters.",
          })}
        />
      )}
      </Reveal>

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!modalSubmitting && !fetchingInbound) {
            setModalOpen(false);
            resetAddForm();
            setFetchingInbound(false);
          }
        }}
        title={isEdit ? t("pages.inbounds.editInbound") : t("pages.inbounds.addInbound")}
        width={isEdit ? 960 : 880}
        dialogClassName="md:max-h-[calc(100dvh-2rem)]"
        footer={
          <div
            className={
              isEdit
                ? "flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                : "flex w-full min-w-0 flex-row items-center justify-end"
            }
          >
            {isEdit ? (
              <span className="min-w-0 text-xs leading-snug text-[var(--fg-subtle)] sm:max-w-[min(100%,24rem)] sm:flex-1 sm:pr-2">
                {t("pages.inbounds.editInboundHint")}
              </span>
            ) : null}
            <div className="inline-flex w-full min-w-0 flex-none flex-wrap items-center justify-end gap-2 sm:w-auto">
              <Button
                variant="secondary"
                type="button"
                disabled={modalSubmitting || fetchingInbound}
                onClick={() => {
                  setModalOpen(false);
                  resetAddForm();
                  setFetchingInbound(false);
                }}
              >
                {t("cancel")}
              </Button>
              {!isEdit && !isFirstStep ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="!gap-1.5"
                  onClick={goPrevStep}
                  disabled={modalSubmitting || fetchingInbound}
                >
                  <ArrowLeft size={14} />
                  {t("pages.inbounds.back", { defaultValue: "Back" })}
                </Button>
              ) : null}
              {!isEdit && !isLastStep ? (
                <Button
                  type="button"
                  variant="primary"
                  className="!gap-1.5"
                  onClick={goNextStep}
                  disabled={modalSubmitting || fetchingInbound}
                >
                  {t("pages.inbounds.next", { defaultValue: "Next" })}
                  <ArrowRight size={14} />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  type="button"
                  loading={modalSubmitting}
                  disabled={fetchingInbound}
                  onClick={() => void submitModal()}
                >
                  {t("pages.inbounds.save", { defaultValue: "Save" })}
                </Button>
              )}
            </div>
          </div>
        }
      >
        {fetchingInbound ? (
          <div className="grid min-h-32 place-items-center">
            <Spinner size={32} />
          </div>
        ) : (
          <div className="space-y-4 pr-1 text-sm">
            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <IconTile
                  icon={
                    INBOUND_STEPS.find((s) => s.id === step)?.icon ?? SlidersHorizontal
                  }
                  tone={modalHeaderIconTone}
                  size="md"
                />
                <div className="text-sm font-semibold text-[var(--fg)]">
                  {joinNameFlag(form.nameFlag, form.remark) ||
                    t("pages.inbounds.addInbound", { defaultValue: "Add inbound" })}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                {form.protocol !== "wireguard" &&
                form.protocol !== "telemt" &&
                form.protocol !== "amneziawg" ? (
                  <div
                    className="inline-flex w-fit shrink-0 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--fg)_4%,transparent)] p-0.5"
                    role="group"
                    aria-label={t("pages.inbounds.payloadViewToggle", {
                      defaultValue: "Form or Xray config",
                    })}
                  >
                    <button
                      type="button"
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        inboundModalView === "form"
                          ? "bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm"
                          : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
                      }`}
                      onClick={() => setInboundModalView("form")}
                    >
                      {t("pages.inbounds.viewForm", { defaultValue: "Form" })}
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        inboundModalView === "preview"
                          ? "bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm"
                          : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
                      }`}
                      onClick={() => {
                        setCoreConfigDraftDirty(false);
                        setInboundModalView("preview");
                      }}
                    >
                      {t("pages.inbounds.viewXrayCorePreview", {
                        defaultValue: "Xray config",
                      })}
                    </button>
                  </div>
                ) : form.protocol === "telemt" || form.protocol === "amneziawg" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-xs"
                    onClick={() => {
                      setCoreConfigDraftDirty(false);
                      setInboundModalView((v) => (v === "preview" ? "form" : "preview"));
                    }}
                  >
                    {inboundModalView === "preview"
                      ? form.protocol === "telemt"
                        ? t("pages.inbounds.viewForm", { defaultValue: "Form" })
                        : t("pages.inbounds.viewForm", { defaultValue: "Form" })
                      : form.protocol === "telemt"
                        ? t("pages.inbounds.viewTelemtTomlPreview", {
                            defaultValue: "Telemt preview",
                          })
                        : t("pages.inbounds.viewAmneziaWgConfPreview", {
                            defaultValue: "AWG preview",
                          })}
                  </Button>
                ) : null}
                <div className="text-xs text-[var(--fg-subtle)] sm:text-right">
                  {t("protocol")}:{" "}
                  <span className="font-mono text-[var(--fg)]">{form.protocol}</span>
                  <span className="mx-2">·</span>
                  {t("pages.inbounds.port")}:{" "}
                  <span className="font-mono text-[var(--fg)]">{form.port}</span>
                </div>
              </div>
            </div>

            {inboundModalView === "preview" ? (
              form.protocol === "telemt" || form.protocol === "amneziawg" ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--fg-muted)]">
                    {form.protocol === "telemt"
                      ? t("pages.inbounds.telemtTomlPreviewHint", {
                          defaultValue:
                            "Generated Telemt config.toml (same as deployed to the node or local data/telemt on standalone). [access.users] is empty until you save the inbound and assign clients; after that it reflects the database.",
                        })
                      : t("pages.inbounds.amneziawgConfPreviewHint", {
                          defaultValue:
                            "Generated server .conf for amneziawg-go (same as deployed to the node or local data/amneziawg on standalone). Peers appear after you assign clients.",
                        })}
                  </p>
                  <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                    {!inboundApiPayloadPreview.ok ? (
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        {inboundApiPayloadPreview.message}
                      </p>
                    ) : xrayPreviewLoading ? (
                      <div className="grid min-h-32 place-items-center">
                        <Spinner size={28} />
                      </div>
                    ) : xrayPreviewError != null ? (
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        {xrayPreviewError}
                      </p>
                    ) : xrayPreviewText != null ? (
                      <pre className="max-h-[min(60dvh,28rem)] overflow-auto text-xs font-mono leading-relaxed text-[var(--fg)] [overflow-wrap:anywhere] whitespace-pre-wrap">
                        {xrayPreviewText}
                      </pre>
                    ) : null}
                  </div>
                </div>
              ) : !inboundApiPayloadPreview.ok ? (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {inboundApiPayloadPreview.message}
                </p>
              ) : (
                <InboundXrayCoreEditor
                  protocol={form.protocol}
                  baselineSettings={baselineSettings}
                  value={coreConfigDraft}
                  loading={xrayPreviewLoading}
                  error={xrayPreviewError}
                  onChange={(text) => {
                    setCoreConfigDraft(text);
                    setCoreConfigDraftDirty(true);
                  }}
                  onReloadFromServer={reloadCoreConfigFromForm}
                  onApplyToForm={({
                    listen,
                    port,
                    tag,
                    streamFormJson,
                    sniffingFormJson,
                    settingsStr,
                    formPatch,
                    strippedKeys,
                  }) => {
                    setForm((f) => ({
                      ...f,
                      listen,
                      port,
                      tag,
                      streamForm: parseStreamSettingsToForm(streamFormJson, f.protocol),
                      sniffingForm: parseSniffingToForm(sniffingFormJson),
                      vlessFlow: formPatch.vlessFlow ?? f.vlessFlow,
                      vlessEncryption: formPatch.vlessEncryption ?? f.vlessEncryption,
                      vlessDecryption: formPatch.vlessDecryption ?? f.vlessDecryption,
                      trojanPassword: formPatch.trojanPassword ?? f.trojanPassword,
                      hysteriaAuth: formPatch.hysteriaAuth ?? f.hysteriaAuth,
                      ssMethod: formPatch.ssMethod ?? f.ssMethod,
                      ssPassword: formPatch.ssPassword ?? f.ssPassword,
                      mixedUser: formPatch.mixedUser ?? f.mixedUser,
                      mixedPassword: formPatch.mixedPassword ?? f.mixedPassword,
                      vlessTrojanFallbacks:
                        formPatch.vlessTrojanFallbacks ?? f.vlessTrojanFallbacks,
                    }));
                    setBaselineSettings(settingsStr);
                    setCoreConfigDraftDirty(false);
                    if (strippedKeys.length > 0) {
                      toast.info(
                        t("pages.inbounds.jsonStrippedKeys", {
                          defaultValue: "Removed unsupported keys: {{keys}}",
                          keys:
                            strippedKeys.slice(0, 8).join(", ") +
                            (strippedKeys.length > 8 ? "…" : ""),
                        }),
                      );
                    }
                  }}
                />
              )
            ) : (
              <>
            {isEdit ? (
              <div className="overflow-x-auto">
                <Tabs
                  tabs={tabItems}
                  active={step}
                  onChange={(id) => setStep(id as InboundStepId)}
                  variant="pill"
                  size="sm"
                  iconOnly
                />
              </div>
            ) : (
              <Stepper
                steps={stepperItems}
                activeId={step}
                onSelect={(id) => setStep(id as InboundStepId)}
                variant="iconsOnly"
              />
            )}

            {step === "basics" ? (
            <InboundFormSection
              title={t("pages.inbounds.sectionBasics", { defaultValue: "Basics" })}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="w-full shrink-0 sm:max-w-[7.5rem]">
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-name-flag"
                  >
                    {t("pages.inbounds.nameFlag")}
                  </label>
                  <SelectNative
                    id="in-name-flag"
                    value={form.nameFlag}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, nameFlag: e.target.value }))
                    }
                  >
                    {NAME_FLAG_SELECT_OPTIONS.map((o) => (
                      <option key={o.value || "none"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div className="min-w-0 flex-1">
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-remark"
                  >
                    {t("remark")}
                  </label>
                  <Input
                    id="in-remark"
                    value={form.remark}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, remark: e.target.value }))
                    }
                    placeholder="eg. Main"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tag">
                  {t("pages.inbounds.tagLabel", { defaultValue: "Xray tag" })}
                </label>
                <Input
                  id="in-tag"
                  className="font-mono text-sm"
                  value={form.tag}
                  onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
                  placeholder={suggestedInboundTag}
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                  {t("pages.inbounds.tagHint", {
                    defaultValue:
                      "String identifier in Xray config (not only numbers). Leave empty for auto: {{suggest}}. Must be unique.",
                    suggest: suggestedInboundTag,
                  })}
                </p>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-port">
                    {t("pages.inbounds.port")} *
                  </label>
                  <Input
                    id="in-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, port: Number(e.target.value) || 0 }))
                    }
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-proto">
                    {t("protocol")} *
                  </label>
                  <SelectNative
                    id="in-proto"
                    value={form.protocol}
                    disabled={isEdit}
                    onChange={(e) => {
                      const p = e.target.value as InboundFormProtocol;
                      applyStreamPresetForProtocol(p);
                    }}
                  >
                    {protocolOptions}
                  </SelectNative>
                </div>
              </div>

              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-listen">
                  {t("pages.inbounds.addInboundListenLabel")}
                </label>
                <Input
                  id="in-listen"
                  value={form.listen}
                  onChange={(e) => setForm((f) => ({ ...f, listen: e.target.value }))}
                  placeholder="0.0.0.0"
                />
                <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                  {t("pages.inbounds.addInboundListenHint")}
                </p>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-totalgb">
                    {t("pages.inbounds.totalFlowGb", { defaultValue: "Total traffic limit (GB)" })}
                  </label>
                  <Input
                    id="in-totalgb"
                    type="number"
                    min={0}
                    step="0.001"
                    value={form.totalGb}
                    onChange={(e) => setForm((f) => ({ ...f, totalGb: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                    {t("pages.inbounds.totalFlowGbHint", { defaultValue: "0 = unlimited" })}
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tr">
                    {t("pages.inbounds.periodicTrafficResetTitle")}
                  </label>
                  <SelectNative
                    id="in-tr"
                    value={form.trafficReset}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, trafficReset: e.target.value }))
                    }
                  >
                    {TRAFFIC_RESET.map((x) => (
                      <option key={x.value} value={x.value}>
                        {t(x.labelKey)}
                      </option>
                    ))}
                  </SelectNative>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--fg-muted)]">{t("enable")}</span>
                <Switch
                  checked={form.enable}
                  onChange={(next) => setForm((f) => ({ ...f, enable: next }))}
                  ariaLabel={t("enable")}
                />
              </div>
            </InboundFormSection>
            ) : null}

            {step === "transport" ? (
            <InboundFormSection
              title={t("pages.inbounds.sectionTransport", {
                defaultValue: "Transport & encryption",
              })}
            >
              <p className="mb-3 text-sm font-medium text-[var(--fg)]">
                {t("pages.inbounds.streamTransport", { defaultValue: "Stream / transport" })}
              </p>
              {isHysteriaFamily ? (
                <div className="space-y-3">
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor="in-hy-udp"
                    >
                      {t("pages.inbounds.hysteriaUdpIdleTimeout", {
                        defaultValue: "UDP idle timeout (sec)",
                      })}
                    </label>
                    <Input
                      id="in-hy-udp"
                      type="number"
                      min={1}
                      max={3600}
                      value={form.streamForm.hysteriaUdpIdleTimeout}
                      onChange={(e) =>
                        setStreamFormField(
                          "hysteriaUdpIdleTimeout",
                          Math.max(1, Number(e.target.value) || 60),
                        )
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                        {t("pages.inbounds.hysteriaObfsType", { defaultValue: "Obfuscation" })}
                      </label>
                      <SelectNative
                        value={form.streamForm.hysteriaObfsType || ""}
                        onChange={(e) =>
                          setStreamFormField(
                            "hysteriaObfsType",
                            e.target.value === "salamander" ? "salamander" : "",
                          )
                        }
                      >
                        <option value="">{t("pages.inbounds.none", { defaultValue: "None" })}</option>
                        <option value="salamander">salamander</option>
                      </SelectNative>
                    </div>
                    {form.streamForm.hysteriaObfsType === "salamander" ? (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                          {t("pages.inbounds.hysteriaObfsPassword", { defaultValue: "Obfuscation password" })}
                        </label>
                        <Input
                          value={form.streamForm.hysteriaObfsPassword}
                          onChange={(e) => setStreamFormField("hysteriaObfsPassword", e.target.value)}
                        />
                        {form.streamForm.hysteriaObfsPassword.trim().length > 0 &&
                          [...form.streamForm.hysteriaObfsPassword.trim()].length < 4 ? (
                          <p className="mt-1 text-xs text-red-500">
                            {t("pages.inbounds.hysteriaObfsPasswordTooShort", { defaultValue: "Password must be at least 4 characters" })}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {form.protocol === "hysteria2" ? (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-hy2-masquerade">
                        {t("pages.inbounds.hysteria2Masquerade", { defaultValue: "Masquerade URL (optional)" })}
                      </label>
                      <Input
                        id="in-hy2-masquerade"
                        className="font-mono text-xs"
                        value={form.streamForm.hysteria2Masquerade}
                        onChange={(e) => setStreamFormField("hysteria2Masquerade", e.target.value)}
                        placeholder="https://example.com"
                      />
                      <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                        {t("pages.inbounds.hysteria2MasqueradeHint", {
                          defaultValue: "When set, Hysteria2 will proxy browser requests to this URL — the server looks like a real HTTPS site.",
                        })}
                      </p>
                    </div>
                  ) : null}
                  <p className="text-xs text-[var(--fg-subtle)]">
                    {t("pages.inbounds.hysteriaTlsHint", {
                      defaultValue:
                        "QUIC uses standard TLS: SNI, ALPN (usually h3), certificate paths (optional — panel default cert is applied if empty).",
                    })}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-sni"
                      >
                        {t("pages.inbounds.tlsServerName", { defaultValue: "Server name (SNI)" })}
                      </label>
                      <Input
                        id="in-hy-sni"
                        className="min-w-0 flex-1"
                        value={form.streamForm.tlsServerName}
                        onChange={(e) =>
                          setStreamFormField("tlsServerName", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-alpn"
                      >
                        {t("pages.inbounds.tlsAlpn", { defaultValue: "ALPN (comma-separated)" })}
                      </label>
                      <Input
                        id="in-hy-alpn"
                        value={form.streamForm.tlsAlpn}
                        onChange={(e) =>
                          setStreamFormField("tlsAlpn", e.target.value)
                        }
                        placeholder="h3"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-tls-min"
                      >
                        {t("pages.inbounds.tlsMinVersion", { defaultValue: "TLS min. version" })}
                      </label>
                      <SelectNative
                        id="in-hy-tls-min"
                        value={form.streamForm.tlsMinVersion}
                        onChange={(e) =>
                          setStreamFormField(
                            "tlsMinVersion",
                            e.target.value as StreamFormState["tlsMinVersion"],
                          )
                        }
                      >
                        <option value="1.2">1.2</option>
                        <option value="1.3">1.3</option>
                      </SelectNative>
                    </div>
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-tls-max"
                      >
                        {t("pages.inbounds.tlsMaxVersion", { defaultValue: "TLS max. version" })}
                      </label>
                      <SelectNative
                        id="in-hy-tls-max"
                        value={
                          form.streamForm.tlsMaxVersion === "1.2" ||
                          form.streamForm.tlsMaxVersion === "1.3"
                            ? form.streamForm.tlsMaxVersion
                            : ""
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setStreamFormField(
                            "tlsMaxVersion",
                            v === "1.2" || v === "1.3"
                              ? v
                              : ("" as StreamFormState["tlsMaxVersion"]),
                          );
                        }}
                      >
                        <option value="">
                          {t("pages.inbounds.tlsMaxVersionOmit", { defaultValue: "— omit —" })}
                        </option>
                        <option value="1.2">1.2</option>
                        <option value="1.3">1.3</option>
                      </SelectNative>
                    </div>
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor="in-hy-ciph"
                    >
                      {t("pages.inbounds.tlsCipherSuites", { defaultValue: "Cipher suites (optional)" })}
                    </label>
                    <Input
                      id="in-hy-ciph"
                      className="font-mono text-xs"
                      value={form.streamForm.tlsCipherSuites}
                      onChange={(e) =>
                        setStreamFormField("tlsCipherSuites", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <CheckboxField
                      checked={form.streamForm.tlsRejectUnknownSni}
                      onChange={(e) =>
                        setStreamFormField("tlsRejectUnknownSni", e.target.checked)
                      }
                      label={t("pages.inbounds.tlsRejectUnknownSni", {
                        defaultValue: "Reject unknown SNI",
                      })}
                    />
                    <CheckboxField
                      checked={form.streamForm.tlsDisableSystemRoot}
                      onChange={(e) =>
                        setStreamFormField("tlsDisableSystemRoot", e.target.checked)
                      }
                      label={t("pages.inbounds.tlsDisableSystemRoot", {
                        defaultValue: "Disable system root CAs",
                      })}
                    />
                    <CheckboxField
                      checked={form.streamForm.tlsEnableSessionResumption}
                      onChange={(e) =>
                        setStreamFormField("tlsEnableSessionResumption", e.target.checked)
                      }
                      label={t("pages.inbounds.tlsEnableSessionResumption", {
                        defaultValue: "TLS session resumption",
                      })}
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor="in-hy-utls"
                    >
                      {t("pages.inbounds.hysteriaUtlsFingerprint", {
                        defaultValue: "uTLS fingerprint (tls.settings)",
                      })}
                    </label>
                    <SelectNative
                      id="in-hy-utls"
                      value={
                        hysteriaTlsFingerprintOptions.includes(
                          form.streamForm.tlsUtlsFingerprint,
                        )
                          ? form.streamForm.tlsUtlsFingerprint
                          : hysteriaTlsFingerprintOptions[0] ?? "chrome"
                      }
                      onChange={(e) =>
                        setStreamFormField("tlsUtlsFingerprint", e.target.value)
                      }
                    >
                      {hysteriaTlsFingerprintOptions.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </SelectNative>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-ech-keys"
                      >
                        {t("pages.inbounds.tlsEchServerKeys", {
                          defaultValue: "ECH server keys (optional)",
                        })}
                      </label>
                      <Input
                        id="in-hy-ech-keys"
                        className="font-mono text-xs"
                        value={form.streamForm.tlsEchServerKeys}
                        onChange={(e) =>
                          setStreamFormField("tlsEchServerKeys", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-ech-fq"
                      >
                        {t("pages.inbounds.tlsEchForceQuery", {
                          defaultValue: "ECH force query",
                        })}
                      </label>
                      <Input
                        id="in-hy-ech-fq"
                        className="font-mono text-xs"
                        value={form.streamForm.tlsEchForceQuery}
                        onChange={(e) =>
                          setStreamFormField("tlsEchForceQuery", e.target.value)
                        }
                        placeholder="none"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor="in-hy-ech-cfg"
                    >
                      {t("pages.inbounds.tlsEchConfigList", {
                        defaultValue: "ECH config list (tls.settings, optional)",
                      })}
                    </label>
                    <Input
                      id="in-hy-ech-cfg"
                      className="font-mono text-xs"
                      value={form.streamForm.tlsEchConfigList}
                      onChange={(e) =>
                        setStreamFormField("tlsEchConfigList", e.target.value)
                      }
                    />
                  </div>
                  <p className="text-xs text-[var(--fg-subtle)]">
                    {t("pages.inbounds.tlsCertHint", {
                      defaultValue:
                        "Use certificate file + key file on the server, or paste PEM blocks below.",
                    })}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-certfile"
                      >
                        {t("pages.inbounds.tlsCertificateFile", {
                          defaultValue: "Certificate file path",
                        })}
                      </label>
                      <Input
                        id="in-hy-certfile"
                        className="font-mono text-xs"
                        value={form.streamForm.tlsCertificateFile}
                        onChange={(e) =>
                          setStreamFormField("tlsCertificateFile", e.target.value)
                        }
                        placeholder="/path/to/fullchain.pem"
                      />
                    </div>
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-keyfile"
                      >
                        {t("pages.inbounds.tlsKeyFile", { defaultValue: "Private key file path" })}
                      </label>
                      <Input
                        id="in-hy-keyfile"
                        className="font-mono text-xs"
                        value={form.streamForm.tlsKeyFile}
                        onChange={(e) =>
                          setStreamFormField("tlsKeyFile", e.target.value)
                        }
                        placeholder="/path/to/privkey.pem"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hy-cert-usage"
                      >
                        {t("pages.inbounds.tlsCertUsage", { defaultValue: "Certificate usage" })}
                      </label>
                      <Input
                        id="in-hy-cert-usage"
                        className="font-mono text-xs"
                        value={form.streamForm.tlsCertUsage}
                        onChange={(e) =>
                          setStreamFormField("tlsCertUsage", e.target.value)
                        }
                        placeholder="encipherment"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <CheckboxField
                      checked={form.streamForm.tlsCertOneTimeLoading}
                      onChange={(e) =>
                        setStreamFormField("tlsCertOneTimeLoading", e.target.checked)
                      }
                      label={t("pages.inbounds.tlsCertOneTimeLoading", {
                        defaultValue: "Certificate one-time loading",
                      })}
                    />
                    <CheckboxField
                      checked={form.streamForm.tlsCertBuildChain}
                      onChange={(e) =>
                        setStreamFormField("tlsCertBuildChain", e.target.checked)
                      }
                      label={t("pages.inbounds.tlsCertBuildChain", {
                        defaultValue: "Build certificate chain",
                      })}
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor="in-hy-pem-cert"
                    >
                      {t("pages.inbounds.tlsCertificatePem", { defaultValue: "Certificate (PEM)" })}
                    </label>
                    <TextArea
                      id="in-hy-pem-cert"
                      className="min-h-[100px]"
                      value={form.streamForm.tlsCertificatePem}
                      onChange={(e) =>
                        setStreamFormField("tlsCertificatePem", e.target.value)
                      }
                      placeholder="-----BEGIN CERTIFICATE-----"
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor="in-hy-pem-key"
                    >
                      {t("pages.inbounds.tlsKeyPem", { defaultValue: "Private key (PEM)" })}
                    </label>
                    <TextArea
                      id="in-hy-pem-key"
                      className="min-h-[100px]"
                      value={form.streamForm.tlsKeyPem}
                      onChange={(e) =>
                        setStreamFormField("tlsKeyPem", e.target.value)
                      }
                      placeholder="-----BEGIN PRIVATE KEY-----"
                    />
                  </div>
                  <InboundTlsCertPinBlock
                    idPrefix="in-hy"
                    streamForm={form.streamForm}
                    setStreamFormField={setStreamFormField}
                    disabled={modalSubmitting}
                  />
                </div>
              ) : streamTransportMode === "wireguard" ? (
                <p className="text-xs leading-relaxed text-[var(--fg-subtle)]">
                  {t("pages.inbounds.wireguardTransportHint", {
                    defaultValue:
                      "WireGuard uses UDP on the inbound port. There is no TCP/WebSocket `streamSettings` — leave the generated empty `{}` and configure `secretKey`, `address`, and `peers` on the next step (same shape as the Xray WireGuard example).",
                  })}
                </p>
              ) : streamTransportMode === "telemt" ? (
                <p className="text-xs leading-relaxed text-[var(--fg-subtle)]">
                  {t("pages.inbounds.telemtTransportHint", {
                    defaultValue:
                      "Telemt does not use Xray `streamSettings`. The process listens on this inbound port with Telemt-specific options on the next step; users and MTProto secrets are created when clients are assigned.",
                  })}
                </p>
              ) : streamTransportMode === "amneziawg" ? (
                <p className="text-xs leading-relaxed text-[var(--fg-subtle)]">
                  {t("pages.inbounds.amneziawgTransportHint", {
                    defaultValue:
                      "AmneziaWG uses UDP on the inbound port via amneziawg-go (sidecar). There is no Xray TCP/TLS/REALITY streamSettings — configure keys and obfuscation on the next step.",
                  })}
                </p>
              ) : streamTransportMode === "mixed" ? (
                <>
                  <p className="mb-3 text-xs text-[var(--fg-subtle)]">
                    {t("pages.inbounds.mixedStreamHint", {
                      defaultValue:
                        "Mixed serves HTTP and SOCKS on one port — plain TCP only. TLS/REALITY and WebSocket do not apply here.",
                    })}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex min-h-[2.5rem] items-end pb-0.5 text-xs leading-snug text-[var(--fg-subtle)]">
                      {t("pages.inbounds.streamSecurityNoneForSs", {
                        defaultValue: "Stream security is none (Xray default for this protocol).",
                      })}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-hdr-mixed"
                      >
                        {t("pages.inbounds.tcpHeaderType", { defaultValue: "TCP header" })}
                      </label>
                      <SelectNative
                        id="in-hdr-mixed"
                        value={form.streamForm.tcpHeaderType}
                        onChange={(e) =>
                          setStreamFormField(
                            "tcpHeaderType",
                            e.target.value as StreamFormState["tcpHeaderType"],
                          )
                        }
                      >
                        <option value="none">none</option>
                        <option value="http">http</option>
                      </SelectNative>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <CheckboxField
                      checked={form.streamForm.acceptProxyProtocol}
                      onChange={(e) =>
                        setStreamFormField("acceptProxyProtocol", e.target.checked)
                      }
                      label={t("pages.inbounds.acceptProxyProtocol", {
                        defaultValue: "Accept proxy protocol",
                      })}
                    />
                  </div>
                </>
              ) : streamTransportMode === "shadowsocks" ? (
                <>
                  <p className="mb-3 text-xs text-[var(--fg-subtle)]">
                    {t("pages.inbounds.shadowsocksStreamHint", {
                          defaultValue:
                            "Shadowsocks already encrypts payload. The stream is plain TCP or WebSocket (no TLS/REALITY here — that applies to VLESS, VMess, Trojan).",
                        })}
                  </p>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => applyStreamFormPresetShadowsocks("tcp")}
                    >
                      {t("pages.inbounds.presetTcp", { defaultValue: "TCP / no TLS" })}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => applyStreamFormPresetShadowsocks("ws")}
                    >
                      {t("pages.inbounds.presetShadowsocksWs", { defaultValue: "WebSocket" })}
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-net-ss"
                      >
                        {t("pages.inbounds.streamNetwork", { defaultValue: "Network" })}
                      </label>
                      <SelectNative
                        id="in-net-ss"
                        value={form.streamForm.network === "ws" ? "ws" : "tcp"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setStreamFormField(
                            "network",
                            (v === "ws" ? "ws" : "tcp") as StreamFormState["network"],
                          );
                        }}
                      >
                        <option value="tcp">TCP</option>
                        <option value="ws">WebSocket</option>
                      </SelectNative>
                    </div>
                    <div className="flex min-h-[2.5rem] items-end pb-0.5 text-xs leading-snug text-[var(--fg-subtle)]">
                      {t("pages.inbounds.streamSecurityNoneForSs", {
                        defaultValue: "Stream security is none (Xray default for this protocol).",
                      })}
                    </div>
                  </div>
                  {form.streamForm.network === "tcp" ? (
                    <>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-hdr-ss"
                          >
                            {t("pages.inbounds.tcpHeaderType", { defaultValue: "TCP header" })}
                          </label>
                          <SelectNative
                            id="in-hdr-ss"
                            value={form.streamForm.tcpHeaderType}
                            onChange={(e) =>
                              setStreamFormField(
                                "tcpHeaderType",
                                e.target.value as StreamFormState["tcpHeaderType"],
                              )
                            }
                          >
                            <option value="none">none</option>
                            <option value="http">http</option>
                          </SelectNative>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <CheckboxField
                          checked={form.streamForm.acceptProxyProtocol}
                          onChange={(e) =>
                            setStreamFormField(
                              "acceptProxyProtocol",
                              e.target.checked,
                            )
                          }
                          label={t("pages.inbounds.acceptProxyProtocol", {
                            defaultValue: "Accept proxy protocol",
                          })}
                        />
                      </div>
                    </>
                  ) : null}
                  {form.streamForm.network === "ws" ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-wspath-ss"
                        >
                          {t("pages.inbounds.wsPath", { defaultValue: "WS path" })}
                        </label>
                        <div className="flex gap-2">
                          <Input
                            id="in-wspath-ss"
                            className="min-w-0 flex-1"
                            value={form.streamForm.wsPath}
                            onChange={(e) =>
                              setStreamFormField("wsPath", e.target.value)
                            }
                            placeholder="/"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            className="shrink-0 text-xs"
                            onClick={() =>
                              setStreamFormField("wsPath", randomWsPath())
                            }
                          >
                            {t("pages.inbounds.genRandomWsPath", {
                              defaultValue: "Random path",
                            })}
                          </Button>
                        </div>
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-wshost-ss"
                        >
                          {t("pages.inbounds.wsHost", { defaultValue: "Host header" })}
                        </label>
                        <Input
                          id="in-wshost-ss"
                          value={form.streamForm.wsHost}
                          onChange={(e) =>
                            setStreamFormField("wsHost", e.target.value)
                          }
                          placeholder="optional"
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => applyStreamFormPreset("tcp")}
                    >
                      {t("pages.inbounds.presetTcp", { defaultValue: "TCP / no TLS" })}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => applyStreamFormPreset("tcpTls")}
                    >
                      {t("pages.inbounds.presetTcpTls", { defaultValue: "TCP / TLS" })}
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-net"
                      >
                        {t("pages.inbounds.streamNetwork", { defaultValue: "Network" })}
                      </label>
                      <SelectNative
                        id="in-net"
                        value={form.streamForm.network}
                        onChange={(e) =>
                          setStreamFormField(
                            "network",
                            e.target.value as StreamFormState["network"],
                          )
                        }
                      >
                        <option value="tcp">TCP</option>
                        <option value="ws">WebSocket</option>
                        <option value="httpupgrade">HTTPUpgrade</option>
                        <option value="grpc">gRPC</option>
                        <option value="xhttp">XHTTP (SplitHTTP)</option>
                        <option value="quic">QUIC</option>
                        <option value="kcp">mKCP</option>
                        <option value="h2">HTTP/2 (h2)</option>
                      </SelectNative>
                    </div>
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                        htmlFor="in-sec"
                      >
                        {t("pages.inbounds.streamSecurity", { defaultValue: "Security" })}
                      </label>
                      <SelectNative
                        id="in-sec"
                        value={form.streamForm.security}
                        onChange={(e) =>
                          setStreamFormField(
                            "security",
                            e.target.value as StreamFormState["security"],
                          )
                        }
                      >
                        <option value="none">{t("pages.inbounds.securityNone", { defaultValue: "None" })}</option>
                        <option value="tls">TLS</option>
                        <option value="reality">
                          {t("pages.inbounds.securityReality", { defaultValue: "REALITY" })}
                        </option>
                      </SelectNative>
                    </div>
                  </div>
                  {form.streamForm.network === "tcp" ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-hdr"
                          >
                            {t("pages.inbounds.tcpHeaderType", { defaultValue: "TCP header" })}
                          </label>
                          <SelectNative
                            id="in-hdr"
                            value={form.streamForm.tcpHeaderType}
                            onChange={(e) =>
                              setStreamFormField(
                                "tcpHeaderType",
                                e.target.value as StreamFormState["tcpHeaderType"],
                              )
                            }
                          >
                            <option value="none">none</option>
                            <option value="http">http</option>
                          </SelectNative>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <CheckboxField
                          checked={form.streamForm.acceptProxyProtocol}
                          onChange={(e) =>
                            setStreamFormField(
                              "acceptProxyProtocol",
                              e.target.checked,
                            )
                          }
                          label={t("pages.inbounds.acceptProxyProtocol", {
                            defaultValue: "Accept proxy protocol",
                          })}
                        />
                      </div>
                      {form.streamForm.tcpHeaderType === "http" ? (
                        <div className="space-y-3 rounded-lg border border-[var(--border)]/60 p-3">
                          <p className="text-xs text-[var(--fg-subtle)]">
                            {t("pages.inbounds.tcpHttpCamouflageHint", {
                              defaultValue: "HTTP header camouflage — disguise traffic as web requests/responses.",
                            })}
                          </p>
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tcp-http-path">
                              {t("pages.inbounds.tcpHttpPath", { defaultValue: "Request path" })}
                            </label>
                            <Input
                              id="in-tcp-http-path"
                              className="font-mono text-xs"
                              value={form.streamForm.tcpHttpPath}
                              onChange={(e) => setStreamFormField("tcpHttpPath", e.target.value)}
                              placeholder="/"
                            />
                          </div>
                          <div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-[var(--fg-muted)]">
                                {t("pages.inbounds.tcpHttpRequestHeaders", { defaultValue: "Request headers" })}
                              </span>
                              <Button type="button" variant="secondary" className="text-xs" onClick={addTcpReqHeader}>
                                <Plus className="mr-1 inline h-3.5 w-3.5" />
                                {t("pages.inbounds.xhttpAddHeader", { defaultValue: "Add" })}
                              </Button>
                            </div>
                            <div className="space-y-2">
                              {form.streamForm.tcpHttpRequestHeaders.map((row, index) => (
                                <div key={index} className="flex gap-2">
                                  <Input
                                    className="min-w-0 flex-1 font-mono text-xs"
                                    value={row.name}
                                    onChange={(e) => setTcpReqHeaderField(index, "name", e.target.value)}
                                    placeholder="Host"
                                    aria-label={`req header name ${index + 1}`}
                                  />
                                  <Input
                                    className="min-w-0 flex-1 font-mono text-xs"
                                    value={row.value}
                                    onChange={(e) => setTcpReqHeaderField(index, "value", e.target.value)}
                                    placeholder="example.com"
                                    aria-label={`req header value ${index + 1}`}
                                  />
                                  <Button type="button" variant="secondary" className="shrink-0 px-2" onClick={() => removeTcpReqHeader(index)} aria-label={t("remove", { defaultValue: "Remove" })}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tcp-resp-status">
                                {t("pages.inbounds.tcpHttpResponseStatus", { defaultValue: "Response status" })}
                              </label>
                              <Input
                                id="in-tcp-resp-status"
                                className="font-mono text-xs"
                                value={form.streamForm.tcpHttpResponseStatus}
                                onChange={(e) => setStreamFormField("tcpHttpResponseStatus", e.target.value)}
                                placeholder="200"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tcp-resp-reason">
                                {t("pages.inbounds.tcpHttpResponseReason", { defaultValue: "Response reason" })}
                              </label>
                              <Input
                                id="in-tcp-resp-reason"
                                className="font-mono text-xs"
                                value={form.streamForm.tcpHttpResponseReason}
                                onChange={(e) => setStreamFormField("tcpHttpResponseReason", e.target.value)}
                                placeholder="OK"
                              />
                            </div>
                          </div>
                          <div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-[var(--fg-muted)]">
                                {t("pages.inbounds.tcpHttpResponseHeaders", { defaultValue: "Response headers" })}
                              </span>
                              <Button type="button" variant="secondary" className="text-xs" onClick={addTcpRespHeader}>
                                <Plus className="mr-1 inline h-3.5 w-3.5" />
                                {t("pages.inbounds.xhttpAddHeader", { defaultValue: "Add" })}
                              </Button>
                            </div>
                            <div className="space-y-2">
                              {form.streamForm.tcpHttpResponseHeaders.map((row, index) => (
                                <div key={index} className="flex gap-2">
                                  <Input
                                    className="min-w-0 flex-1 font-mono text-xs"
                                    value={row.name}
                                    onChange={(e) => setTcpRespHeaderField(index, "name", e.target.value)}
                                    placeholder="Content-Type"
                                    aria-label={`resp header name ${index + 1}`}
                                  />
                                  <Input
                                    className="min-w-0 flex-1 font-mono text-xs"
                                    value={row.value}
                                    onChange={(e) => setTcpRespHeaderField(index, "value", e.target.value)}
                                    placeholder="application/octet-stream"
                                    aria-label={`resp header value ${index + 1}`}
                                  />
                                  <Button type="button" variant="secondary" className="shrink-0 px-2" onClick={() => removeTcpRespHeader(index)} aria-label={t("remove", { defaultValue: "Remove" })}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {form.streamForm.network === "ws" ||
                  form.streamForm.network === "httpupgrade" ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-wspath"
                        >
                          {t("pages.inbounds.wsPath", { defaultValue: "WS path" })}
                        </label>
                        <div className="flex gap-2">
                          <Input
                            id="in-wspath"
                            className="min-w-0 flex-1"
                            value={form.streamForm.wsPath}
                            onChange={(e) =>
                              setStreamFormField("wsPath", e.target.value)
                            }
                            placeholder="/"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            className="shrink-0 text-xs"
                            onClick={() =>
                              setStreamFormField("wsPath", randomWsPath())
                            }
                          >
                            {t("pages.inbounds.genRandomWsPath", {
                              defaultValue: "Random path",
                            })}
                          </Button>
                        </div>
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-wshost"
                        >
                          {t("pages.inbounds.wsHost", { defaultValue: "Host header" })}
                        </label>
                        <Input
                          id="in-wshost"
                          value={form.streamForm.wsHost}
                          onChange={(e) =>
                            setStreamFormField("wsHost", e.target.value)
                          }
                          placeholder="optional"
                        />
                      </div>
                    </div>
                  ) : null}
                  {form.streamForm.network === "grpc" ? (
                    <div className="mt-3 space-y-3">
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-grpc"
                        >
                          {t("pages.inbounds.grpcServiceName", { defaultValue: "gRPC service name" })}
                        </label>
                        <Input
                          id="in-grpc"
                          value={form.streamForm.grpcServiceName}
                          onChange={(e) =>
                            setStreamFormField("grpcServiceName", e.target.value)
                          }
                          placeholder=""
                        />
                      </div>
                      <CheckboxField
                        checked={form.streamForm.grpcMultiMode}
                        onChange={(e) => setStreamFormField("grpcMultiMode", e.target.checked)}
                        label={t("pages.inbounds.grpcMultiMode", { defaultValue: "Multi mode (multiplex streams)" })}
                      />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-grpc-idle">
                            {t("pages.inbounds.grpcIdleTimeout", { defaultValue: "Idle timeout (s, 0=default)" })}
                          </label>
                          <Input
                            id="in-grpc-idle"
                            type="number"
                            min={0}
                            value={String(form.streamForm.grpcIdleTimeout)}
                            onChange={(e) =>
                              setStreamFormField("grpcIdleTimeout", Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-grpc-hc">
                            {t("pages.inbounds.grpcHealthCheckTimeout", { defaultValue: "Health check timeout (s, 0=default)" })}
                          </label>
                          <Input
                            id="in-grpc-hc"
                            type="number"
                            min={0}
                            value={String(form.streamForm.grpcHealthCheckTimeout)}
                            onChange={(e) =>
                              setStreamFormField("grpcHealthCheckTimeout", Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                          />
                        </div>
                      </div>
                      <CheckboxField
                        checked={form.streamForm.grpcPermitWithoutStream}
                        onChange={(e) => setStreamFormField("grpcPermitWithoutStream", e.target.checked)}
                        label={t("pages.inbounds.grpcPermitWithoutStream", { defaultValue: "Permit keepalive without stream" })}
                      />
                    </div>
                  ) : null}
                  {form.streamForm.network === "xhttp" ? (
                    <div className="mt-3 space-y-4">
                      <p className="text-xs text-[var(--fg-subtle)]">
                        {t("pages.inbounds.xhttpHint", {
                          defaultValue:
                            "XHTTP (SplitHTTP) — same fields as Xray xhttpSettings (request headers, mode, padding, session, uplink).",
                        })}
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-xhttp-host"
                          >
                            {t("host", { defaultValue: "Host" })}
                          </label>
                          <Input
                            id="in-xhttp-host"
                            className="font-mono text-xs"
                            value={form.streamForm.xhttpHost}
                            onChange={(e) => setStreamFormField("xhttpHost", e.target.value)}
                            placeholder=""
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-xhttp-path"
                          >
                            {t("path", { defaultValue: "Path" })}
                          </label>
                          <div className="flex gap-2">
                            <Input
                              id="in-xhttp-path"
                              className="min-w-0 flex-1 font-mono text-xs"
                              value={form.streamForm.xhttpPath}
                              onChange={(e) => setStreamFormField("xhttpPath", e.target.value)}
                              placeholder="/"
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              className="shrink-0 text-xs"
                              onClick={() => setStreamFormField("xhttpPath", randomWsPath())}
                            >
                              {t("pages.inbounds.genRandomWsPath", {
                                defaultValue: "Random path",
                              })}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-[var(--fg-muted)]">
                            {t("pages.inbounds.streamTcpRequestHeader", {
                              defaultValue: "Request headers",
                            })}
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            className="text-xs"
                            onClick={addXhttpHeader}
                          >
                            <Plus className="mr-1 inline h-3.5 w-3.5" />
                            {t("pages.inbounds.xhttpAddHeader", { defaultValue: "Add" })}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {form.streamForm.xhttpHeaders.map((row, index) => (
                            <div key={index} className="flex gap-2">
                              <Input
                                className="min-w-0 flex-1 font-mono text-xs"
                                value={row.name}
                                onChange={(e) =>
                                  setXhttpHeaderField(index, "name", e.target.value)
                                }
                                placeholder="name"
                                aria-label={`header name ${index + 1}`}
                              />
                              <Input
                                className="min-w-0 flex-1 font-mono text-xs"
                                value={row.value}
                                onChange={(e) =>
                                  setXhttpHeaderField(index, "value", e.target.value)
                                }
                                placeholder="value"
                                aria-label={`header value ${index + 1}`}
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                className="shrink-0 px-2"
                                onClick={() => removeXhttpHeader(index)}
                                aria-label={t("remove", { defaultValue: "Remove" })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-xhttp-mode"
                          >
                            Mode
                          </label>
                          <SelectNative
                            id="in-xhttp-mode"
                            value={form.streamForm.xhttpMode}
                            onChange={(e) => setStreamFormField("xhttpMode", e.target.value)}
                          >
                            {XHTTP_MODES.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </SelectNative>
                        </div>
                        {form.streamForm.xhttpMode === "packet-up" ? (
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-sc-max-posts"
                            >
                              Max buffered upload
                            </label>
                            <Input
                              id="in-xhttp-sc-max-posts"
                              type="number"
                              min={0}
                              className="font-mono text-xs"
                              value={String(form.streamForm.xhttpScMaxBufferedPosts)}
                              onChange={(e) =>
                                setStreamFormField(
                                  "xhttpScMaxBufferedPosts",
                                  Math.max(0, parseInt(e.target.value, 10) || 0),
                                )
                              }
                            />
                          </div>
                        ) : null}
                        {form.streamForm.xhttpMode === "packet-up" ? (
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-sc-max-bytes"
                            >
                              Max upload size (bytes)
                            </label>
                            <Input
                              id="in-xhttp-sc-max-bytes"
                              className="font-mono text-xs"
                              value={form.streamForm.xhttpScMaxEachPostBytes}
                              onChange={(e) =>
                                setStreamFormField("xhttpScMaxEachPostBytes", e.target.value)
                              }
                            />
                          </div>
                        ) : null}
                        {form.streamForm.xhttpMode === "stream-up" ? (
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-sc-stream-up"
                            >
                              Stream-Up server
                            </label>
                            <Input
                              id="in-xhttp-sc-stream-up"
                              className="font-mono text-xs"
                              value={form.streamForm.xhttpScStreamUpServerSecs}
                              onChange={(e) =>
                                setStreamFormField("xhttpScStreamUpServerSecs", e.target.value)
                              }
                              placeholder="20-80"
                            />
                          </div>
                        ) : null}
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-xhttp-pad-bytes"
                          >
                            Padding bytes
                          </label>
                          <Input
                            id="in-xhttp-pad-bytes"
                            className="font-mono text-xs"
                            value={form.streamForm.xhttpPaddingBytes}
                            onChange={(e) =>
                              setStreamFormField("xhttpPaddingBytes", e.target.value)
                            }
                            placeholder="100-1000"
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <CheckboxField
                          checked={form.streamForm.xhttpPaddingObfs}
                          onChange={(e) =>
                            setStreamFormField("xhttpPaddingObfs", e.target.checked)
                          }
                          label="Padding obfs mode"
                        />
                      </div>
                      {form.streamForm.xhttpPaddingObfs ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-pad-key"
                            >
                              Padding key
                            </label>
                            <Input
                              id="in-xhttp-pad-key"
                              className="font-mono text-xs"
                              value={form.streamForm.xhttpPaddingKey}
                              onChange={(e) =>
                                setStreamFormField("xhttpPaddingKey", e.target.value)
                              }
                              placeholder="x_padding"
                            />
                          </div>
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-pad-hdr"
                            >
                              Padding header
                            </label>
                            <Input
                              id="in-xhttp-pad-hdr"
                              className="font-mono text-xs"
                              value={form.streamForm.xhttpPaddingHeader}
                              onChange={(e) =>
                                setStreamFormField("xhttpPaddingHeader", e.target.value)
                              }
                              placeholder="X-Padding"
                            />
                          </div>
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-pad-pl"
                            >
                              Padding placement
                            </label>
                            <SelectNative
                              id="in-xhttp-pad-pl"
                              value={form.streamForm.xhttpPaddingPlacement}
                              onChange={(e) =>
                                setStreamFormField("xhttpPaddingPlacement", e.target.value)
                              }
                            >
                              <option value="">Default (queryInHeader)</option>
                              <option value="queryInHeader">queryInHeader</option>
                              <option value="header">header</option>
                              <option value="cookie">cookie</option>
                              <option value="query">query</option>
                            </SelectNative>
                          </div>
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-pad-meth"
                            >
                              Padding method
                            </label>
                            <SelectNative
                              id="in-xhttp-pad-meth"
                              value={form.streamForm.xhttpPaddingMethod}
                              onChange={(e) =>
                                setStreamFormField("xhttpPaddingMethod", e.target.value)
                              }
                            >
                              <option value="">Default (repeat-x)</option>
                              <option value="repeat-x">repeat-x</option>
                              <option value="tokenish">tokenish</option>
                            </SelectNative>
                          </div>
                        </div>
                      ) : null}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-xhttp-up-meth"
                          >
                            Uplink HTTP method
                          </label>
                          <SelectNative
                            id="in-xhttp-up-meth"
                            value={form.streamForm.xhttpUplinkHttpMethod}
                            onChange={(e) =>
                              setStreamFormField("xhttpUplinkHttpMethod", e.target.value)
                            }
                          >
                            <option value="">Default (POST)</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="GET">GET (packet-up only)</option>
                          </SelectNative>
                        </div>
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-xhttp-sess-pl"
                          >
                            Session placement
                          </label>
                          <SelectNative
                            id="in-xhttp-sess-pl"
                            value={form.streamForm.xhttpSessionPlacement}
                            onChange={(e) =>
                              setStreamFormField("xhttpSessionPlacement", e.target.value)
                            }
                          >
                            <option value="">Default (path)</option>
                            <option value="path">path</option>
                            <option value="header">header</option>
                            <option value="cookie">cookie</option>
                            <option value="query">query</option>
                          </SelectNative>
                        </div>
                        {form.streamForm.xhttpSessionPlacement &&
                        form.streamForm.xhttpSessionPlacement !== "path" ? (
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-sess-key"
                            >
                              Session key
                            </label>
                            <Input
                              id="in-xhttp-sess-key"
                              className="font-mono text-xs"
                              value={form.streamForm.xhttpSessionKey}
                              onChange={(e) =>
                                setStreamFormField("xhttpSessionKey", e.target.value)
                              }
                              placeholder="x_session"
                            />
                          </div>
                        ) : null}
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-xhttp-seq-pl"
                          >
                            Sequence placement
                          </label>
                          <SelectNative
                            id="in-xhttp-seq-pl"
                            value={form.streamForm.xhttpSeqPlacement}
                            onChange={(e) =>
                              setStreamFormField("xhttpSeqPlacement", e.target.value)
                            }
                          >
                            <option value="">Default (path)</option>
                            <option value="path">path</option>
                            <option value="header">header</option>
                            <option value="cookie">cookie</option>
                            <option value="query">query</option>
                          </SelectNative>
                        </div>
                        {form.streamForm.xhttpSeqPlacement &&
                        form.streamForm.xhttpSeqPlacement !== "path" ? (
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-seq-key"
                            >
                              Sequence key
                            </label>
                            <Input
                              id="in-xhttp-seq-key"
                              className="font-mono text-xs"
                              value={form.streamForm.xhttpSeqKey}
                              onChange={(e) => setStreamFormField("xhttpSeqKey", e.target.value)}
                              placeholder="x_seq"
                            />
                          </div>
                        ) : null}
                      </div>
                      {form.streamForm.xhttpMode === "packet-up" ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-xhttp-ud-pl"
                            >
                              Uplink data placement
                            </label>
                            <SelectNative
                              id="in-xhttp-ud-pl"
                              value={form.streamForm.xhttpUplinkDataPlacement}
                              onChange={(e) =>
                                setStreamFormField("xhttpUplinkDataPlacement", e.target.value)
                              }
                            >
                              <option value="">Default (body)</option>
                              <option value="body">body</option>
                              <option value="header">header</option>
                              <option value="cookie">cookie</option>
                              <option value="query">query</option>
                            </SelectNative>
                          </div>
                          {form.streamForm.xhttpUplinkDataPlacement &&
                          form.streamForm.xhttpUplinkDataPlacement !== "body" ? (
                            <>
                              <div>
                                <label
                                  className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                                  htmlFor="in-xhttp-ud-key"
                                >
                                  Uplink data key
                                </label>
                                <Input
                                  id="in-xhttp-ud-key"
                                  className="font-mono text-xs"
                                  value={form.streamForm.xhttpUplinkDataKey}
                                  onChange={(e) =>
                                    setStreamFormField("xhttpUplinkDataKey", e.target.value)
                                  }
                                  placeholder="x_data"
                                />
                              </div>
                              <div>
                                <label
                                  className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                                  htmlFor="in-xhttp-ud-chunk"
                                >
                                  Uplink chunk size
                                </label>
                                <Input
                                  id="in-xhttp-ud-chunk"
                                  type="number"
                                  min={0}
                                  className="font-mono text-xs"
                                  value={String(form.streamForm.xhttpUplinkChunkSize)}
                                  onChange={(e) =>
                                    setStreamFormField(
                                      "xhttpUplinkChunkSize",
                                      Math.max(0, parseInt(e.target.value, 10) || 0),
                                    )
                                  }
                                  placeholder="0"
                                />
                              </div>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      <div>
                        <CheckboxField
                          checked={form.streamForm.xhttpNoSseHeader}
                          onChange={(e) =>
                            setStreamFormField("xhttpNoSseHeader", e.target.checked)
                          }
                          label="No SSE header"
                        />
                      </div>
                    </div>
                  ) : null}
                  {form.streamForm.network === "kcp" ? (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-[var(--fg-subtle)]">
                        {t("pages.inbounds.kcpHint", {
                          defaultValue: "mKCP — UDP-based transport with header obfuscation to disguise traffic as other protocols.",
                        })}
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-kcp-hdr">
                            {t("pages.inbounds.kcpHeaderType", { defaultValue: "Header obfuscation" })}
                          </label>
                          <SelectNative
                            id="in-kcp-hdr"
                            value={form.streamForm.kcpHeaderType}
                            onChange={(e) =>
                              setStreamFormField("kcpHeaderType", e.target.value as StreamFormState["kcpHeaderType"])
                            }
                          >
                            {KCP_HEADER_TYPES.map((x) => (
                              <option key={x.value} value={x.value}>{x.label}</option>
                            ))}
                          </SelectNative>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-kcp-seed">
                            {t("pages.inbounds.kcpSeed", { defaultValue: "Seed (encryption key)" })}
                          </label>
                          <Input
                            id="in-kcp-seed"
                            className="font-mono text-xs"
                            value={form.streamForm.kcpSeed}
                            onChange={(e) => setStreamFormField("kcpSeed", e.target.value)}
                            placeholder=""
                          />
                        </div>
                      </div>
                      <CheckboxField
                        checked={form.streamForm.kcpCongestion}
                        onChange={(e) => setStreamFormField("kcpCongestion", e.target.checked)}
                        label={t("pages.inbounds.kcpCongestion", { defaultValue: "Congestion control" })}
                      />
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-kcp-mtu">
                            MTU
                          </label>
                          <Input id="in-kcp-mtu" type="number" min={576} max={1460} value={String(form.streamForm.kcpMtu)} onChange={(e) => setStreamFormField("kcpMtu", Math.max(576, parseInt(e.target.value, 10) || 1350))} />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-kcp-tti">
                            TTI (ms)
                          </label>
                          <Input id="in-kcp-tti" type="number" min={1} max={100} value={String(form.streamForm.kcpTti)} onChange={(e) => setStreamFormField("kcpTti", Math.max(1, parseInt(e.target.value, 10) || 20))} />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-kcp-up">
                            {t("pages.inbounds.kcpUplinkCapacity", { defaultValue: "Uplink (MB/s)" })}
                          </label>
                          <Input id="in-kcp-up" type="number" min={0} value={String(form.streamForm.kcpUplinkCapacity)} onChange={(e) => setStreamFormField("kcpUplinkCapacity", Math.max(0, parseInt(e.target.value, 10) || 50))} />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-kcp-dn">
                            {t("pages.inbounds.kcpDownlinkCapacity", { defaultValue: "Downlink (MB/s)" })}
                          </label>
                          <Input id="in-kcp-dn" type="number" min={0} value={String(form.streamForm.kcpDownlinkCapacity)} onChange={(e) => setStreamFormField("kcpDownlinkCapacity", Math.max(0, parseInt(e.target.value, 10) || 20))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-kcp-rbuf">
                            {t("pages.inbounds.kcpReadBuffer", { defaultValue: "Read buffer (MB)" })}
                          </label>
                          <Input id="in-kcp-rbuf" type="number" min={1} value={String(form.streamForm.kcpReadBuffer)} onChange={(e) => setStreamFormField("kcpReadBuffer", Math.max(1, parseInt(e.target.value, 10) || 2))} />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-kcp-wbuf">
                            {t("pages.inbounds.kcpWriteBuffer", { defaultValue: "Write buffer (MB)" })}
                          </label>
                          <Input id="in-kcp-wbuf" type="number" min={1} value={String(form.streamForm.kcpWriteBuffer)} onChange={(e) => setStreamFormField("kcpWriteBuffer", Math.max(1, parseInt(e.target.value, 10) || 2))} />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {form.streamForm.network === "h2" ? (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-[var(--fg-subtle)]">
                        {t("pages.inbounds.h2Hint", {
                          defaultValue: "HTTP/2 transport — disguises traffic as standard HTTPS API calls. Requires TLS security.",
                        })}
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-h2-host">
                            {t("host", { defaultValue: "Host" })}
                            <span className="ml-1 text-[var(--fg-subtle)]">(comma-separated)</span>
                          </label>
                          <Input
                            id="in-h2-host"
                            className="font-mono text-xs"
                            value={form.streamForm.h2Host}
                            onChange={(e) => setStreamFormField("h2Host", e.target.value)}
                            placeholder="example.com"
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-h2-path">
                            {t("path", { defaultValue: "Path" })}
                          </label>
                          <Input
                            id="in-h2-path"
                            className="font-mono text-xs"
                            value={form.streamForm.h2Path}
                            onChange={(e) => setStreamFormField("h2Path", e.target.value)}
                            placeholder="/"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-h2-idle">
                            {t("pages.inbounds.h2ReadIdleTimeout", { defaultValue: "Read idle timeout (s)" })}
                          </label>
                          <Input id="in-h2-idle" type="number" min={0} value={String(form.streamForm.h2ReadIdleTimeout)} onChange={(e) => setStreamFormField("h2ReadIdleTimeout", Math.max(0, parseInt(e.target.value, 10) || 10))} />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-h2-hc">
                            {t("pages.inbounds.h2HealthCheckTimeout", { defaultValue: "Health check timeout (s)" })}
                          </label>
                          <Input id="in-h2-hc" type="number" min={0} value={String(form.streamForm.h2HealthCheckTimeout)} onChange={(e) => setStreamFormField("h2HealthCheckTimeout", Math.max(0, parseInt(e.target.value, 10) || 15))} />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {form.streamForm.network === "quic" ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-quic-sec"
                          >
                            {t("pages.inbounds.quicSecurity", { defaultValue: "QUIC encryption" })}
                          </label>
                          <SelectNative
                            id="in-quic-sec"
                            value={form.streamForm.quicSecurity}
                            onChange={(e) =>
                              setStreamFormField(
                                "quicSecurity",
                                e.target.value as StreamFormState["quicSecurity"],
                              )
                            }
                          >
                            <option value="none">none</option>
                            <option value="aes-128-gcm">aes-128-gcm</option>
                            <option value="chacha20-poly1305">chacha20-poly1305</option>
                          </SelectNative>
                        </div>
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-quic-hdr"
                          >
                            {t("pages.inbounds.quicHeaderType", { defaultValue: "QUIC header type" })}
                          </label>
                          <SelectNative
                            id="in-quic-hdr"
                            value={form.streamForm.quicHeaderType}
                            onChange={(e) =>
                              setStreamFormField(
                                "quicHeaderType",
                                e.target.value as StreamFormState["quicHeaderType"],
                              )
                            }
                          >
                            {QUIC_HEADER_TYPES.map((x) => (
                              <option key={x.value} value={x.value}>
                                {x.label}
                              </option>
                            ))}
                          </SelectNative>
                        </div>
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-quic-key"
                        >
                          {t("pages.inbounds.quicKey", { defaultValue: "QUIC key (if encryption enabled)" })}
                        </label>
                        <div className="flex gap-2">
                          <Input
                            id="in-quic-key"
                            className="min-w-0 flex-1 font-mono text-xs"
                            value={form.streamForm.quicKey}
                            onChange={(e) =>
                              setStreamFormField("quicKey", e.target.value)
                            }
                            autoComplete="off"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            className="shrink-0 text-xs"
                            disabled={form.streamForm.quicSecurity === "none"}
                            onClick={() =>
                              setStreamFormField("quicKey", randomQuicKey())
                            }
                          >
                            {t("pages.inbounds.genQuicKey", {
                              defaultValue: "Generate",
                            })}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {form.streamForm.network !== "tcp" ? (
                    <div className="mt-3">
                      <CheckboxField
                        checked={form.streamForm.acceptProxyProtocol}
                        onChange={(e) =>
                          setStreamFormField("acceptProxyProtocol", e.target.checked)
                        }
                        label={t("pages.inbounds.acceptProxyProtocol", {
                          defaultValue: "Accept proxy protocol",
                        })}
                      />
                    </div>
                  ) : null}
                  {form.streamForm.security === "tls" ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-sni"
                          >
                            {t("pages.inbounds.tlsServerName", { defaultValue: "Server name (SNI)" })}
                          </label>
                          <div className="flex gap-2">
                            <Input
                              id="in-sni"
                              className="min-w-0 flex-1"
                              value={form.streamForm.tlsServerName}
                              onChange={(e) =>
                                setStreamFormField("tlsServerName", e.target.value)
                              }
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              className="shrink-0 text-xs"
                              onClick={() =>
                                setStreamFormField(
                                  "tlsServerName",
                                  suggestRandomTlsSni(
                                    form.streamForm.wsHost,
                                    form.streamForm.tlsServerName,
                                  ),
                                )
                              }
                            >
                              {t("pages.inbounds.genRandomTlsSni", {
                                defaultValue: "Random SNI",
                              })}
                            </Button>
                          </div>
                        </div>
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-alpn"
                          >
                            {t("pages.inbounds.tlsAlpn", { defaultValue: "ALPN (comma-separated)" })}
                          </label>
                          <Input
                            id="in-alpn"
                            value={form.streamForm.tlsAlpn}
                            onChange={(e) =>
                              setStreamFormField("tlsAlpn", e.target.value)
                            }
                            placeholder="http/1.1"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-tlsmv"
                          >
                            {t("pages.inbounds.tlsMinVersion", { defaultValue: "TLS min. version" })}
                          </label>
                          <SelectNative
                            id="in-tlsmv"
                            value={form.streamForm.tlsMinVersion}
                            onChange={(e) =>
                              setStreamFormField(
                                "tlsMinVersion",
                                e.target.value as StreamFormState["tlsMinVersion"],
                              )
                            }
                          >
                            <option value="1.2">1.2</option>
                            <option value="1.3">1.3</option>
                          </SelectNative>
                        </div>
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-tls-ciph"
                        >
                          {t("pages.inbounds.tlsCipherSuites", { defaultValue: "Cipher suites (optional)" })}
                        </label>
                        <Input
                          id="in-tls-ciph"
                          className="font-mono text-xs"
                          value={form.streamForm.tlsCipherSuites}
                          onChange={(e) =>
                            setStreamFormField("tlsCipherSuites", e.target.value)
                          }
                          placeholder=""
                        />
                      </div>
                      <p className="text-xs text-[var(--fg-subtle)]">
                        {t("pages.inbounds.tlsCertHint", {
                          defaultValue:
                            "Use certificate file + key file on the server, or paste PEM blocks below.",
                        })}
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-tls-certfile"
                          >
                            {t("pages.inbounds.tlsCertificateFile", { defaultValue: "Certificate file path" })}
                          </label>
                          <Input
                            id="in-tls-certfile"
                            className="font-mono text-xs"
                            value={form.streamForm.tlsCertificateFile}
                            onChange={(e) =>
                              setStreamFormField("tlsCertificateFile", e.target.value)
                            }
                            placeholder="/path/to/fullchain.pem"
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-tls-keyfile"
                          >
                            {t("pages.inbounds.tlsKeyFile", { defaultValue: "Private key file path" })}
                          </label>
                          <Input
                            id="in-tls-keyfile"
                            className="font-mono text-xs"
                            value={form.streamForm.tlsKeyFile}
                            onChange={(e) =>
                              setStreamFormField("tlsKeyFile", e.target.value)
                            }
                            placeholder="/path/to/privkey.pem"
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-tls-pem-cert"
                        >
                          {t("pages.inbounds.tlsCertificatePem", { defaultValue: "Certificate (PEM)" })}
                        </label>
                        <TextArea
                          id="in-tls-pem-cert"
                          className="min-h-[100px]"
                          value={form.streamForm.tlsCertificatePem}
                          onChange={(e) =>
                            setStreamFormField("tlsCertificatePem", e.target.value)
                          }
                          placeholder="-----BEGIN CERTIFICATE-----"
                        />
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-tls-pem-key"
                        >
                          {t("pages.inbounds.tlsKeyPem", { defaultValue: "Private key (PEM)" })}
                        </label>
                        <TextArea
                          id="in-tls-pem-key"
                          className="min-h-[100px]"
                          value={form.streamForm.tlsKeyPem}
                          onChange={(e) =>
                            setStreamFormField("tlsKeyPem", e.target.value)
                          }
                          placeholder="-----BEGIN PRIVATE KEY-----"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tls-ocsp">
                            {t("pages.inbounds.tlsOcspStapling", { defaultValue: "OCSP stapling cache (s, 0=off)" })}
                          </label>
                          <Input
                            id="in-tls-ocsp"
                            type="number"
                            min={0}
                            value={String(form.streamForm.tlsOcspStapling)}
                            onChange={(e) =>
                              setStreamFormField("tlsOcspStapling", Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <CheckboxField
                          checked={form.streamForm.tlsVerifyClientCertificate}
                          onChange={(e) => setStreamFormField("tlsVerifyClientCertificate", e.target.checked)}
                          label={t("pages.inbounds.tlsVerifyClientCertificate", { defaultValue: "Require client certificate (mTLS)" })}
                        />
                      </div>
                      <InboundTlsCertPinBlock
                        idPrefix="in-tls"
                        streamForm={form.streamForm}
                        setStreamFormField={setStreamFormField}
                        disabled={modalSubmitting}
                      />
                    </div>
                  ) : null}
                  {form.streamForm.security === "reality" ? (
                    <div className="mt-3 space-y-3">
                      <CheckboxField
                        checked={form.streamForm.realityShow}
                        onChange={(e) =>
                          setStreamFormField("realityShow", e.target.checked)
                        }
                        label={t("pages.inbounds.realityShow", { defaultValue: "Show" })}
                      />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-rxver"
                          >
                            {t("pages.inbounds.realityXver", { defaultValue: "Xver" })}
                          </label>
                          <Input
                            id="in-rxver"
                            type="number"
                            min={0}
                            value={form.streamForm.realityXver}
                            onChange={(e) =>
                              setStreamFormField(
                                "realityXver",
                                Math.max(0, Number(e.target.value) || 0),
                              )
                            }
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-rfp"
                          >
                            {t("pages.inbounds.realityFingerprint", { defaultValue: "uTLS fingerprint" })}
                          </label>
                          <SelectNative
                            id="in-rfp"
                            value={
                              realityFingerprintOptions.includes(
                                form.streamForm.realityFingerprint,
                              )
                                ? form.streamForm.realityFingerprint
                                : realityFingerprintOptions[0] ?? "chrome"
                            }
                            onChange={(e) =>
                              setStreamFormField("realityFingerprint", e.target.value)
                            }
                          >
                            {realityFingerprintOptions.map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </SelectNative>
                        </div>
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-rdest"
                        >
                          {t("pages.inbounds.realityTarget", { defaultValue: "Target (host:port)" })}
                        </label>
                        <Input
                          id="in-rdest"
                          value={form.streamForm.realityTarget}
                          onChange={(e) =>
                            setStreamFormField("realityTarget", e.target.value)
                          }
                          placeholder="www.example.com:443"
                        />
                      </div>
                      <div className="rounded-lg border border-[var(--border)]/80 p-3">
                        <label
                          className="mb-2 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-rsni"
                        >
                          {t("pages.inbounds.realityServerNames", {
                            defaultValue: "SNI / server names (comma-separated)",
                          })}
                        </label>
                        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                          <Input
                            id="in-rsni"
                            className="min-w-0 flex-1 font-mono text-xs"
                            value={form.streamForm.realityServerNames}
                            onChange={(e) =>
                              setStreamFormField("realityServerNames", e.target.value)
                            }
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            className="shrink-0 text-xs"
                            onClick={fillRealitySniFromTarget}
                          >
                            {t("pages.inbounds.genRealitySniFromTarget", {
                              defaultValue: "SNI from target",
                            })}
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-rmtd"
                          >
                            {t("pages.inbounds.realityMaxTimeDiff", {
                              defaultValue: "Max time diff (ms)",
                            })}
                          </label>
                          <Input
                            id="in-rmtd"
                            type="number"
                            min={0}
                            value={form.streamForm.realityMaxTimeDiff}
                            onChange={(e) =>
                              setStreamFormField(
                                "realityMaxTimeDiff",
                                Math.max(0, Number(e.target.value) || 0),
                              )
                            }
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-rspx"
                          >
                            {t("pages.inbounds.realitySpiderX", { defaultValue: "SpiderX" })}
                          </label>
                          <Input
                            id="in-rspx"
                            value={form.streamForm.realitySpiderX}
                            onChange={(e) =>
                              setStreamFormField("realitySpiderX", e.target.value)
                            }
                            placeholder="/"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-rminv"
                          >
                            {t("pages.inbounds.realityMinClientVer", {
                              defaultValue: "Min client version",
                            })}
                          </label>
                          <Input
                            id="in-rminv"
                            value={form.streamForm.realityMinClientVer}
                            onChange={(e) =>
                              setStreamFormField("realityMinClientVer", e.target.value)
                            }
                            placeholder="25.9.11"
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                            htmlFor="in-rmaxv"
                          >
                            {t("pages.inbounds.realityMaxClientVer", {
                              defaultValue: "Max client version",
                            })}
                          </label>
                          <Input
                            id="in-rmaxv"
                            value={form.streamForm.realityMaxClientVer}
                            onChange={(e) =>
                              setStreamFormField("realityMaxClientVer", e.target.value)
                            }
                            placeholder="25.9.11"
                          />
                        </div>
                      </div>
                      <div>
                        <div className="rounded-lg border border-[var(--border)]/80 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <label
                              className="text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-rsid"
                            >
                              {t("pages.inbounds.realityShortIds", {
                                defaultValue: "Short IDs (comma-separated)",
                              })}
                            </label>
                            <Button
                              type="button"
                              variant="secondary"
                              className="shrink-0 text-xs"
                              onClick={() =>
                                setForm((f) => ({
                                  ...f,
                                  streamForm: {
                                    ...f.streamForm,
                                    realityShortIds: randomRealityShortIds(),
                                  },
                                }))
                              }
                            >
                              {t("pages.inbounds.genRealityShortIds", {
                                defaultValue: "Generate",
                              })}
                            </Button>
                          </div>
                          <TextArea
                            id="in-rsid"
                            className="min-h-[72px]"
                            value={form.streamForm.realityShortIds}
                            onChange={(e) =>
                              setStreamFormField("realityShortIds", e.target.value)
                            }
                            placeholder=""
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                          htmlFor="in-rssn"
                        >
                          {t("pages.inbounds.realitySettingsServerName", {
                            defaultValue: "settings.serverName (optional)",
                          })}
                        </label>
                        <Input
                          id="in-rssn"
                          value={form.streamForm.realitySettingsServerName}
                          onChange={(e) =>
                            setStreamFormField("realitySettingsServerName", e.target.value)
                          }
                        />
                      </div>
                      <div className="rounded-lg border border-[var(--border)]/80 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[var(--fg-muted)]">
                            {t("pages.inbounds.realityX25519Section", {
                              defaultValue: "REALITY (X25519) key pair",
                            })}
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            className="shrink-0 text-xs"
                            onClick={() => void generateRealityX25519()}
                          >
                            {t("pages.inbounds.genRealityX25519", {
                              defaultValue: "Generate key pair",
                            })}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-rpbk"
                            >
                              {t("pages.inbounds.publicKey", { defaultValue: "Public key" })}
                            </label>
                            <TextArea
                              id="in-rpbk"
                              className="min-h-[72px] font-mono text-xs"
                              value={form.streamForm.realityPublicKey}
                              onChange={(e) =>
                                setStreamFormField("realityPublicKey", e.target.value)
                              }
                            />
                          </div>
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-rpvk"
                            >
                              {t("pages.inbounds.privatekey", { defaultValue: "Private key" })}
                            </label>
                            <TextArea
                              id="in-rpvk"
                              className="min-h-[88px] font-mono text-xs"
                              value={form.streamForm.realityPrivateKey}
                              onChange={(e) =>
                                setStreamFormField("realityPrivateKey", e.target.value)
                              }
                            />
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-[var(--border)]/80 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[var(--fg-muted)]">
                            {t("pages.inbounds.realityMldsa65Section", {
                              defaultValue: "ML-DSA-65 (optional)",
                            })}
                          </span>
                          <Button
                            type="button"
                            variant="secondary"
                            className="shrink-0 text-xs"
                            onClick={() => void generateRealityMldsa65()}
                          >
                            {t("pages.inbounds.genRealityMldsa65", {
                              defaultValue: "Generate",
                            })}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-rmldsa-seed"
                            >
                              {t("pages.inbounds.realityMldsa65Seed", {
                                defaultValue: "mldsa65 seed (optional)",
                              })}
                            </label>
                            <TextArea
                              id="in-rmldsa-seed"
                              className="min-h-[64px] font-mono text-xs"
                              value={form.streamForm.realityMldsa65Seed}
                              onChange={(e) =>
                                setStreamFormField("realityMldsa65Seed", e.target.value)
                              }
                            />
                          </div>
                          <div>
                            <label
                              className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                              htmlFor="in-rmldsa-v"
                            >
                              {t("pages.inbounds.realityMldsa65Verify", {
                                defaultValue: "mldsa65 verify (optional)",
                              })}
                            </label>
                            <TextArea
                              id="in-rmldsa-v"
                              className="min-h-[64px] font-mono text-xs"
                              value={form.streamForm.realityMldsa65Verify}
                              onChange={(e) =>
                                setStreamFormField("realityMldsa65Verify", e.target.value)
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {streamTransportMode === "full" ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)]/60 p-3">
                      <p className="text-xs font-medium text-[var(--fg-muted)]">
                        {t("pages.inbounds.sockoptSection", { defaultValue: "Sockopt (inbound)" })}
                      </p>
                      {/* Checkboxes in their own row so they don't mix heights with labeled inputs */}
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <CheckboxField
                          checked={form.streamForm.sockoptTcpFastOpen}
                          onChange={(e) => setStreamFormField("sockoptTcpFastOpen", e.target.checked)}
                          label={t("pages.inbounds.sockoptTcpFastOpen", { defaultValue: "TCP Fast Open" })}
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-sockopt-tproxy">
                            {t("pages.inbounds.sockoptTproxy", { defaultValue: "TProxy" })}
                          </label>
                          <SelectNative
                            id="in-sockopt-tproxy"
                            value={form.streamForm.sockoptTproxy}
                            onChange={(e) =>
                              setStreamFormField("sockoptTproxy", e.target.value as StreamFormState["sockoptTproxy"])
                            }
                          >
                            <option value="off">off</option>
                            <option value="redirect">redirect</option>
                            <option value="tproxy">tproxy</option>
                          </SelectNative>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-sockopt-mark">
                            {t("pages.inbounds.sockoptMark", { defaultValue: "SO_MARK (0=off)" })}
                          </label>
                          <Input
                            id="in-sockopt-mark"
                            type="number"
                            min={0}
                            value={String(form.streamForm.sockoptMark)}
                            onChange={(e) =>
                              setStreamFormField("sockoptMark", Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-sockopt-keepalive">
                            {t("pages.inbounds.sockoptTcpKeepAlive", { defaultValue: "TCP keepalive interval (s, 0=default)" })}
                          </label>
                          <Input
                            id="in-sockopt-keepalive"
                            type="number"
                            min={0}
                            value={String(form.streamForm.sockoptTcpKeepAlive)}
                            onChange={(e) =>
                              setStreamFormField("sockoptTcpKeepAlive", Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-sockopt-tcpmss">
                            {t("pages.inbounds.sockoptTcpMss", { defaultValue: "TCP MSS (0=default)" })}
                          </label>
                          <Input
                            id="in-sockopt-tcpmss"
                            type="number"
                            min={0}
                            value={String(form.streamForm.sockoptTcpMss)}
                            onChange={(e) =>
                              setStreamFormField("sockoptTcpMss", Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </InboundFormSection>
            ) : null}

            {step === "auth" ? (
            <InboundFormSection
              title={
                form.protocol === "telemt"
                  ? t("pages.inbounds.sectionTelemt", {
                      defaultValue: "Telemt (MTProto) & Fake-TLS",
                    })
                  : t("pages.inbounds.sectionAuth", {
                      defaultValue: "Protocol authentication",
                    })
              }
            >
            {form.protocol === "vless" ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-flow">
                    {t("pages.inbounds.addInboundVlessFlowLabel")}
                  </label>
                  <SelectNative
                    id="in-flow"
                    value={form.vlessFlow}
                    disabled={!vlessXtlsFlowAllowed(form.streamForm, form.vlessEncryption)}
                    onChange={(e) => applyVlessFlowChange(e.target.value)}
                  >
                    <option value="">{t("pages.inbounds.addInboundVlessFlowNone")}</option>
                    <option value="xtls-rprx-vision">xtls-rprx-vision</option>
                    <option value="xtls-rprx-vision-udp443">xtls-rprx-vision-udp443</option>
                  </SelectNative>
                  {!vlessXtlsFlowAllowed(form.streamForm, form.vlessEncryption) ? (
                    <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
                      {form.streamForm.network === "xhttp"
                        ? t("pages.inbounds.vlessFlowDisabledXhttp", {
                            defaultValue:
                              "XTLS flow is not used with XHTTP. Choose TCP + TLS or REALITY, or clear flow.",
                          })
                        : t("pages.inbounds.vlessFlowDisabledTransport", {
                            defaultValue:
                              "XTLS flow requires TCP with TLS or REALITY (or VLESS Encryption).",
                          })}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                      Encryption
                    </label>
                    <Input
                      value={form.vlessEncryption}
                      placeholder="none"
                      onChange={(e) =>
                        setForm((f) => {
                          const vlessEncryption = e.target.value;
                          const vlessFlow = effectiveVlessFlow(
                            f.streamForm,
                            f.vlessFlow,
                            vlessEncryption,
                          );
                          return { ...f, vlessEncryption, vlessFlow };
                        })
                      }
                      disabled={Boolean(form.vlessTrojanFallbacks.length != 0)}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                      Decryption
                    </label>
                    <Input
                      className="font-mono text-xs"
                      placeholder="none"
                      value={form.vlessDecryption}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          vlessDecryption: e.target.value,
                        }))
                      }
                      disabled={Boolean(form.vlessTrojanFallbacks.length != 0)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {form.protocol === "trojan" ? (
              <div>
                <label
                  className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                  htmlFor="in-trojan"
                >
                  {t("password")}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="in-trojan"
                    className="flex-1 font-mono text-xs"
                    value={form.trojanPassword}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, trojanPassword: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setForm((f) => ({ ...f, trojanPassword: randomPassword(12) }))
                    }
                  >
                    {t("pages.inbounds.addInboundTrojanRegen")}
                  </Button>
                </div>
              </div>
            ) : null}

            {form.protocol === "vless" || form.protocol === "trojan" ? (
              <div className="space-y-3 border-t border-[var(--border)] pt-4">
                <div>
                  <p className="text-xs font-semibold text-[var(--fg)]">
                    {t("pages.inbounds.fallbacksTitle", {
                      defaultValue: "TCP/TLS fallbacks (Xray)",
                    })}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
                    {t("pages.inbounds.fallbacksHint", {
                      defaultValue:
                        "Non-VLESS/TCP+TLS traffic can be forwarded to another service (often nginx on port 80). Requires TCP transport with TLS. Rows without Dest are skipped when saving.",
                    })}
                  </p>
                  <p className="mt-2 text-[10px] font-mono leading-relaxed text-[var(--fg-subtle)]">
                    {t("pages.inbounds.fallbacksFieldLegend", {
                      defaultValue:
                        "Fields map to Xray: name=SNI, alpn, path, dest, xver (PROXY protocol).",
                    })}
                  </p>
                </div>
                <div className="space-y-3">
                  {form.vlessTrojanFallbacks.map((row, idx) => (
                    <div
                      key={idx}
                      className="relative space-y-2 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--fg)_3%,transparent)] p-3"
                    >
                      <div className="absolute right-2 top-2">
                        <IconButton
                          type="button"
                          label={t("pages.inbounds.fallbacksRemove", {
                            defaultValue: "Remove fallback",
                          })}
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              vlessTrojanFallbacks: f.vlessTrojanFallbacks.filter(
                                (_, i) => i !== idx,
                              ),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </IconButton>
                      </div>
                      <div className="grid grid-cols-1 gap-2 pr-10 sm:grid-cols-2 lg:grid-cols-5">
                        <div>
                          <label
                            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]"
                            htmlFor={`fb-name-${idx}`}
                          >
                            {t("pages.inbounds.fallbacksSni", { defaultValue: "SNI (name)" })}
                          </label>
                          <Input
                            id={`fb-name-${idx}`}
                            className="font-mono text-xs"
                            value={row.name}
                            placeholder="example.com"
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                vlessTrojanFallbacks: f.vlessTrojanFallbacks.map((r, i) =>
                                  i === idx ? { ...r, name: e.target.value } : r,
                                ),
                              }))
                            }
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]"
                            htmlFor={`fb-alpn-${idx}`}
                          >
                            {t("pages.inbounds.fallbacksAlpn", { defaultValue: "ALPN" })}
                          </label>
                          <Input
                            id={`fb-alpn-${idx}`}
                            className="font-mono text-xs"
                            value={row.alpn}
                            placeholder="h2"
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                vlessTrojanFallbacks: f.vlessTrojanFallbacks.map((r, i) =>
                                  i === idx ? { ...r, alpn: e.target.value } : r,
                                ),
                              }))
                            }
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]"
                            htmlFor={`fb-path-${idx}`}
                          >
                            {t("pages.inbounds.fallbacksPath", { defaultValue: "Path" })}
                          </label>
                          <Input
                            id={`fb-path-${idx}`}
                            className="font-mono text-xs"
                            value={row.path}
                            placeholder="/ws"
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                vlessTrojanFallbacks: f.vlessTrojanFallbacks.map((r, i) =>
                                  i === idx ? { ...r, path: e.target.value } : r,
                                ),
                              }))
                            }
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]"
                            htmlFor={`fb-dest-${idx}`}
                          >
                            {t("pages.inbounds.fallbacksDest", { defaultValue: "Dest" })}
                            <span className="normal-case text-[var(--fg-subtle)]"> *</span>
                          </label>
                          <Input
                            id={`fb-dest-${idx}`}
                            className="font-mono text-xs"
                            value={row.dest}
                            placeholder="80 / 127.0.0.1:8080"
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                vlessTrojanFallbacks: f.vlessTrojanFallbacks.map((r, i) =>
                                  i === idx ? { ...r, dest: e.target.value } : r,
                                ),
                              }))
                            }
                            autoComplete="off"
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]"
                            htmlFor={`fb-xver-${idx}`}
                          >
                            {t("pages.inbounds.fallbacksXver", { defaultValue: "xVer" })}
                          </label>
                          <SelectNative
                            id={`fb-xver-${idx}`}
                            className="font-mono text-xs"
                            value={row.xver}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                vlessTrojanFallbacks: f.vlessTrojanFallbacks.map((r, i) =>
                                  i === idx ? { ...r, xver: e.target.value } : r,
                                ),
                              }))
                            }
                          >
                            <option value="0">0</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                          </SelectNative>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2 disabled:opacity-50"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      vlessTrojanFallbacks: [...f.vlessTrojanFallbacks, defaultVlessTrojanFallbackRow()],
                    }))
                  }
                 disabled={Boolean(form.vlessDecryption != "none")}
                 
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  {t("pages.inbounds.fallbacksAddRow", { defaultValue: "Add fallback" })}
                </Button>
              </div>
            ) : null}

            {form.protocol === "mixed" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-mixed-user"
                  >
                    {t("pages.inbounds.mixedAccountUser", {
                      defaultValue: "Account user (SOCKS/HTTP)",
                    })}
                  </label>
                  <Input
                    id="in-mixed-user"
                    className="font-mono text-xs"
                    value={form.mixedUser}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, mixedUser: e.target.value }))
                    }
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-mixed-pass"
                  >
                    {t("password")}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="in-mixed-pass"
                      className="min-w-0 flex-1 font-mono text-xs"
                      value={form.mixedPassword}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, mixedPassword: e.target.value }))
                      }
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setForm((f) => ({ ...f, mixedPassword: randomPassword(12) }))
                      }
                    >
                      {t("pages.inbounds.addInboundTrojanRegen")}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-[var(--fg-subtle)] sm:col-span-2">
                  {t("pages.inbounds.mixedAuthHint", {
                    defaultValue:
                      "First saved account in settings; panel clients map email local-part to this user when syncing to Xray.",
                  })}
                </p>
              </div>
            ) : null}

            {(form.protocol === "hysteria" || form.protocol === "hysteria2") ? (
              <div>
                <label
                  className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                  htmlFor="in-hy-auth"
                >
                  {t("pages.inbounds.hysteriaAuth")}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="in-hy-auth"
                    className="flex-1 font-mono text-xs"
                    value={form.hysteriaAuth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, hysteriaAuth: e.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setForm((f) => ({ ...f, hysteriaAuth: randomPassword(8) }))
                    }
                  >
                    {t("pages.inbounds.addInboundTrojanRegen")}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                  {t("pages.inbounds.hysteriaAuthDesc")}
                </p>
              </div>
            ) : null}

            {form.protocol === "shadowsocks" ? (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-ssm">
                    {t("pages.inbounds.addInboundSSMethod")}
                  </label>
                  <SelectNative
                    id="in-ssm"
                    value={form.ssMethod}
                    onChange={(e) => {
                      const method = e.target.value;
                      setForm((f) => ({
                        ...f,
                        ssMethod: method,
                        ssPassword: randomShadowsocksServerPassword(method),
                      }));
                    }}
                  >
                    {SS_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-ssp">
                    {t("pages.inbounds.addInboundSSPassword")}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="in-ssp"
                      className="flex-1 font-mono text-xs"
                      value={form.ssPassword}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, ssPassword: e.target.value }))
                      }
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          ssPassword: randomShadowsocksServerPassword(f.ssMethod),
                        }))
                      }
                    >
                      {t("pages.inbounds.addInboundTrojanRegen")}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
            {form.protocol === "telemt" ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--fg-subtle)]">
                  {t("pages.inbounds.telemtSettingsHint", {
                    defaultValue:
                      "Open this wizard step from the left: «Telemt (MTProto)». Here you configure Telemt [general], [general.modes] (Fake-TLS = tls), [censorship] SNI/masking, links and API. Client MTProto secrets are created when users are assigned to this inbound.",
                  })}
                </p>
                <CheckboxField
                  checked={form.telemtForm.useMiddleProxy}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      telemtForm: { ...f.telemtForm, useMiddleProxy: e.target.checked },
                    }))
                  }
                  label={t("pages.inbounds.telemtUseMiddleProxy", {
                    defaultValue: "use_middle_proxy",
                  })}
                />
                <CheckboxField
                  checked={form.telemtForm.proxyProtocol}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      telemtForm: { ...f.telemtForm, proxyProtocol: e.target.checked },
                    }))
                  }
                  label={t("pages.inbounds.telemtProxyProtocol", {
                    defaultValue: "proxy_protocol (accept PROXY Protocol from upstream)",
                  })}
                />
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-tm-log"
                  >
                    {t("pages.inbounds.telemtLogLevel", { defaultValue: "log_level" })}
                  </label>
                  <Input
                    id="in-tm-log"
                    className="font-mono text-xs"
                    value={form.telemtForm.logLevel}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, logLevel: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-tm-adtag"
                  >
                    {t("pages.inbounds.telemtAdTag", {
                      defaultValue: "ad_tag (optional, @MTProxybot)",
                    })}
                  </label>
                  <Input
                    id="in-tm-adtag"
                    className="font-mono text-xs"
                    placeholder="32 hex from MTProxybot"
                    value={form.telemtForm.adTag}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, adTag: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                  {t("pages.inbounds.telemtModes", { defaultValue: "Modes" })}
                </p>
                <p className="text-xs text-[var(--fg-subtle)]">
                  {t("pages.inbounds.telemtModesExplain", {
                    defaultValue:
                      "tls = Fake-TLS (Telegram `ee…` links). secure = `dd…` prefix. classic = plain MTProto secret. Official reference: github.com/telemt/telemt — config.toml & docs.",
                  })}
                </p>
                <div className="flex flex-wrap gap-4">
                  <CheckboxField
                    checked={form.telemtForm.modesClassic}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, modesClassic: e.target.checked },
                      }))
                    }
                    label={t("pages.inbounds.telemtModeClassic", { defaultValue: "classic" })}
                  />
                  <CheckboxField
                    checked={form.telemtForm.modesSecure}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, modesSecure: e.target.checked },
                      }))
                    }
                    label={t("pages.inbounds.telemtModeSecure", { defaultValue: "secure" })}
                  />
                  <CheckboxField
                    checked={form.telemtForm.modesTls}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, modesTls: e.target.checked },
                      }))
                    }
                    label={t("pages.inbounds.telemtModeTls", {
                      defaultValue: "tls (Fake-TLS, ee links)",
                    })}
                  />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                  {t("pages.inbounds.telemtLinks", { defaultValue: "Links (optional)" })}
                </p>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-tm-show"
                  >
                    {t("pages.inbounds.telemtLinksShow", { defaultValue: "show" })}
                  </label>
                  <Input
                    id="in-tm-show"
                    className="font-mono text-xs"
                    value={form.telemtForm.linksShow}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, linksShow: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor="in-tm-ph"
                    >
                      {t("pages.inbounds.telemtPublicHost", {
                        defaultValue: "public_host (optional)",
                      })}
                    </label>
                    <Input
                      id="in-tm-ph"
                      className="font-mono text-xs"
                      value={form.telemtForm.linksPublicHost}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          telemtForm: { ...f.telemtForm, linksPublicHost: e.target.value },
                        }))
                      }
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                      htmlFor="in-tm-pp"
                    >
                      {t("pages.inbounds.telemtPublicPort", {
                        defaultValue: "public_port (optional)",
                      })}
                    </label>
                    <Input
                      id="in-tm-pp"
                      className="font-mono text-xs"
                      value={form.telemtForm.linksPublicPort}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          telemtForm: { ...f.telemtForm, linksPublicPort: e.target.value },
                        }))
                      }
                      spellCheck={false}
                    />
                  </div>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                  {t("pages.inbounds.telemtCensorship", { defaultValue: "Censorship" })}
                </p>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-tm-domain"
                  >
                    {t("pages.inbounds.telemtTlsDomain", {
                    defaultValue: "SNI domain (tls_domain)",
                  })}
                  </label>
                  <p className="mb-1.5 text-[11px] text-[var(--fg-subtle)]">
                    {t("pages.inbounds.telemtTlsDomainHint", {
                      defaultValue:
                        "Fake-TLS fronting hostname written to Telemt [censorship] tls_domain. Optional JSON key censorship.sni is accepted as an alias when importing configs.",
                    })}
                  </p>
                  <Input
                    id="in-tm-domain"
                    className="font-mono text-xs"
                    value={form.telemtForm.censorshipTlsDomain}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, censorshipTlsDomain: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <div className="flex flex-wrap gap-4">
                  <CheckboxField
                    checked={form.telemtForm.censorshipMask}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, censorshipMask: e.target.checked },
                      }))
                    }
                    label={t("pages.inbounds.telemtMask", { defaultValue: "mask" })}
                  />
                  <CheckboxField
                    checked={form.telemtForm.censorshipTlsEmulation}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: {
                          ...f.telemtForm,
                          censorshipTlsEmulation: e.target.checked,
                        },
                      }))
                    }
                    label={t("pages.inbounds.telemtTlsEmulation", {
                      defaultValue: "tls_emulation",
                    })}
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-tm-front"
                  >
                    {t("pages.inbounds.telemtTlsFrontDir", {
                      defaultValue: "tls_front_dir",
                    })}
                  </label>
                  <Input
                    id="in-tm-front"
                    className="font-mono text-xs"
                    value={form.telemtForm.censorshipTlsFrontDir}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, censorshipTlsFrontDir: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-tm-unknown-sni"
                  >
                    {t("pages.inbounds.telemtUnknownSniAction", {
                      defaultValue: "unknown_sni_action",
                    })}
                  </label>
                  <p className="mb-1.5 text-[11px] text-[var(--fg-subtle)]">
                    {t("pages.inbounds.telemtUnknownSniActionHint", {
                      defaultValue:
                        "Telemt [censorship]: how to treat an SNI mismatch. Default (empty) follows Telemt defaults. mask / reject_handshake when you need explicit policy.",
                    })}
                  </p>
                  <SelectNative
                    id="in-tm-unknown-sni"
                    inputSize="sm"
                    className="w-full min-w-0 font-mono shadow-none"
                    value={form.telemtForm.censorshipUnknownSniAction}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: {
                          ...f.telemtForm,
                          censorshipUnknownSniAction: e.target.value,
                        },
                      }))
                    }
                  >
                    <option value="">
                      {t("pages.inbounds.telemtUnknownSniDefault", {
                        defaultValue: "(default / omit)",
                      })}
                    </option>
                    <option value="mask">mask</option>
                    <option value="reject_handshake">reject_handshake</option>
                  </SelectNative>
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-tm-metrics"
                  >
                    {t("pages.inbounds.telemtMetricsPort", {
                      defaultValue: "metrics_port (optional)",
                    })}
                  </label>
                  <p className="mb-1.5 text-[11px] text-[var(--fg-subtle)]">
                    {t("pages.inbounds.telemtMetricsPortHint", {
                      defaultValue: "[server] Prometheus/HTTP metrics listener port; leave empty to omit.",
                    })}
                  </p>
                  <Input
                    id="in-tm-metrics"
                    type="number"
                    min={1}
                    max={65535}
                    className="font-mono text-xs"
                    placeholder="e.g. 9182"
                    value={form.telemtForm.metricsPort}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, metricsPort: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
                  {t("pages.inbounds.telemtApi", { defaultValue: "Server API" })}
                </p>
                <CheckboxField
                  checked={form.telemtForm.apiEnabled}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      telemtForm: { ...f.telemtForm, apiEnabled: e.target.checked },
                    }))
                  }
                  label={t("pages.inbounds.telemtApiEnabled", { defaultValue: "api enabled" })}
                />
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-tm-apil"
                  >
                    {t("pages.inbounds.telemtApiListen", { defaultValue: "api listen" })}
                  </label>
                  <Input
                    id="in-tm-apil"
                    className="font-mono text-xs"
                    value={form.telemtForm.apiListen}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        telemtForm: { ...f.telemtForm, apiListen: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>

                <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)] [&::-webkit-details-marker]:hidden">
                    {t("pages.inbounds.telemtSectionAdvanced", { defaultValue: "Advanced (general)" })}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {(
                      [
                        ["fastMode", "fast_mode"],
                        ["me2dcFallback", "me2dc_fallback"],
                        ["me2dcFast", "me2dc_fast"],
                      ] as const
                    ).map(([field, label]) => (
                      <div key={field}>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                          {label}
                        </label>
                        <SelectNative
                          inputSize="sm"
                          className="w-full min-w-0 font-mono shadow-none"
                          value={form.telemtForm[field]}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              telemtForm: {
                                ...f.telemtForm,
                                [field]: e.target.value as "" | "true" | "false",
                              },
                            }))
                          }
                        >
                          <option value="">
                            {t("pages.inbounds.telemtUseDefault", { defaultValue: "(default / omit)" })}
                          </option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </SelectNative>
                      </div>
                    ))}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tm-nat-ip">
                        middle_proxy_nat_ip
                      </label>
                      <Input
                        id="in-tm-nat-ip"
                        className="font-mono text-xs"
                        value={form.telemtForm.middleProxyNatIp}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            telemtForm: { ...f.telemtForm, middleProxyNatIp: e.target.value },
                          }))
                        }
                        spellCheck={false}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tm-tg-connect">
                        tg_connect (seconds)
                      </label>
                      <Input
                        id="in-tm-tg-connect"
                        type="number"
                        min={1}
                        className="font-mono text-xs"
                        value={form.telemtForm.tgConnect}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            telemtForm: { ...f.telemtForm, tgConnect: e.target.value },
                          }))
                        }
                        spellCheck={false}
                      />
                    </div>
                  </div>
                </details>

                <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)] [&::-webkit-details-marker]:hidden">
                    {t("pages.inbounds.telemtSectionNetwork", { defaultValue: "Network" })}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {(
                      [
                        ["networkIpv4", "ipv4"],
                        ["networkIpv6", "ipv6"],
                      ] as const
                    ).map(([field, label]) => (
                      <div key={field}>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                          {label}
                        </label>
                        <SelectNative
                          inputSize="sm"
                          className="w-full min-w-0 font-mono shadow-none"
                          value={form.telemtForm[field]}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              telemtForm: {
                                ...f.telemtForm,
                                [field]: e.target.value as "" | "true" | "false",
                              },
                            }))
                          }
                        >
                          <option value="">
                            {t("pages.inbounds.telemtUseDefault", { defaultValue: "(default / omit)" })}
                          </option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </SelectNative>
                      </div>
                    ))}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]">
                        prefer
                      </label>
                      <SelectNative
                        inputSize="sm"
                        className="w-full min-w-0 font-mono shadow-none"
                        value={form.telemtForm.networkPrefer}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            telemtForm: {
                              ...f.telemtForm,
                              networkPrefer: e.target.value as "" | "4" | "6",
                            },
                          }))
                        }
                      >
                        <option value="">
                          {t("pages.inbounds.telemtUseDefault", { defaultValue: "(default / omit)" })}
                        </option>
                        <option value="4">4</option>
                        <option value="6">6</option>
                      </SelectNative>
                    </div>
                  </div>
                </details>

                <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)] [&::-webkit-details-marker]:hidden">
                    {t("pages.inbounds.telemtSectionTimeouts", { defaultValue: "Timeouts" })}
                  </summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["timeoutsClientHandshake", "client_handshake", "in-tm-th"],
                        ["timeoutsClientFirstByteIdleSecs", "client_first_byte_idle_secs", "in-tm-tfb"],
                        ["timeoutsClientKeepalive", "client_keepalive", "in-tm-tk"],
                        ["timeoutsClientAck", "client_ack", "in-tm-ta"],
                      ] as const
                    ).map(([field, label, id]) => (
                      <div key={field}>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor={id}>
                          {label}
                        </label>
                        <Input
                          id={id}
                          type="number"
                          min={0}
                          className="font-mono text-xs"
                          value={form.telemtForm[field]}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              telemtForm: { ...f.telemtForm, [field]: e.target.value },
                            }))
                          }
                          spellCheck={false}
                        />
                      </div>
                    ))}
                  </div>
                </details>

                <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)] [&::-webkit-details-marker]:hidden">
                    {t("pages.inbounds.telemtSectionCensorshipExtra", {
                      defaultValue: "Censorship (mask upstream)",
                    })}
                  </summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tm-mask-host">
                        mask_host
                      </label>
                      <Input
                        id="in-tm-mask-host"
                        className="font-mono text-xs"
                        value={form.telemtForm.censorshipMaskHost}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            telemtForm: { ...f.telemtForm, censorshipMaskHost: e.target.value },
                          }))
                        }
                        spellCheck={false}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tm-mask-port">
                        mask_port
                      </label>
                      <Input
                        id="in-tm-mask-port"
                        type="number"
                        min={1}
                        max={65535}
                        className="font-mono text-xs"
                        value={form.telemtForm.censorshipMaskPort}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            telemtForm: { ...f.telemtForm, censorshipMaskPort: e.target.value },
                          }))
                        }
                        spellCheck={false}
                      />
                    </div>
                  </div>
                </details>

                <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)] [&::-webkit-details-marker]:hidden">
                    {t("pages.inbounds.telemtSectionAccess", { defaultValue: "Access (global limits)" })}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <CheckboxField
                      checked={form.telemtForm.accessIgnoreTimeSkew}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          telemtForm: { ...f.telemtForm, accessIgnoreTimeSkew: e.target.checked },
                        }))
                      }
                      label={t("pages.inbounds.telemtIgnoreTimeSkew", {
                        defaultValue: "ignore_time_skew",
                      })}
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tm-max-ips">
                          user_max_unique_ips_global_each
                        </label>
                        <Input
                          id="in-tm-max-ips"
                          type="number"
                          min={0}
                          className="font-mono text-xs"
                          value={form.telemtForm.accessUserMaxUniqueIpsGlobalEach}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              telemtForm: {
                                ...f.telemtForm,
                                accessUserMaxUniqueIpsGlobalEach: e.target.value,
                              },
                            }))
                          }
                          spellCheck={false}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-tm-max-tcp">
                          user_max_tcp_conns_global_each
                        </label>
                        <Input
                          id="in-tm-max-tcp"
                          type="number"
                          min={0}
                          className="font-mono text-xs"
                          value={form.telemtForm.accessUserMaxTcpConnsGlobalEach}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              telemtForm: {
                                ...f.telemtForm,
                                accessUserMaxTcpConnsGlobalEach: e.target.value,
                              },
                            }))
                          }
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            ) : null}
            {form.protocol === "wireguard" ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--fg-subtle)]">
                  {t("pages.inbounds.wireguardSettingsHint", {
                    defaultValue:
                      "Server-side WireGuard (UDP): MTU, server secret key, tunnel `address` (CIDRs), optional client DNS (shown in the user’s .conf and subscription), noKernelTun, optional workers. Peers (keys, PSK, AllowedIPs) are created when you assign a client to this inbound.",
                  })}
                </p>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-wg-mtu"
                  >
                    {t("pages.inbounds.wireguardMtu", { defaultValue: "MTU" })}
                  </label>
                  <Input
                    id="in-wg-mtu"
                    type="number"
                    className="font-mono text-xs"
                    min={1280}
                    max={9000}
                    value={form.wireguardForm.mtu}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setForm((f) => ({
                        ...f,
                        wireguardForm: {
                          ...f.wireguardForm,
                          mtu: Number.isFinite(n) && n > 0 ? n : 1420,
                        },
                      }));
                    }}
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-wg-sk"
                  >
                    {t("pages.inbounds.wireguardSecretKey", {
                      defaultValue: "Secret key (server private, base64)",
                    })}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="in-wg-sk"
                      className="flex-1 font-mono text-xs"
                      value={form.wireguardForm.secretKey}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          wireguardForm: {
                            ...f.wireguardForm,
                            secretKey: e.target.value,
                          },
                        }))
                      }
                      spellCheck={false}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 text-xs"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          wireguardForm: {
                            ...f.wireguardForm,
                            secretKey: newWireGuardSecretKeyBase64(),
                          },
                        }))
                      }
                    >
                      {t("pages.inbounds.wireguardRegenKey", {
                        defaultValue: "Regenerate key",
                      })}
                    </Button>
                  </div>
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-wg-addr"
                  >
                    {t("pages.inbounds.wireguardAddress", {
                      defaultValue: "Tunnel address (CIDR, one per line)",
                    })}
                  </label>
                  <TextArea
                    id="in-wg-addr"
                    className="min-h-[68px] font-mono text-xs"
                    value={form.wireguardForm.address}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        wireguardForm: {
                          ...f.wireguardForm,
                          address: e.target.value,
                        },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-wg-dns"
                  >
                    {t("pages.inbounds.wireguardClientDns", {
                      defaultValue: "Client DNS (for user .conf)",
                    })}
                  </label>
                  <TextArea
                    id="in-wg-dns"
                    className="min-h-[56px] font-mono text-xs"
                    placeholder={t("pages.inbounds.wireguardClientDnsPlaceholder", {
                      defaultValue: "e.g. 1.1.1.1, 8.8.8.8 or one per line (optional)",
                    })}
                    value={form.wireguardForm.clientDns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        wireguardForm: {
                          ...f.wireguardForm,
                          clientDns: e.target.value,
                        },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <CheckboxField
                  checked={form.wireguardForm.noKernelTun}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      wireguardForm: {
                        ...f.wireguardForm,
                        noKernelTun: e.target.checked,
                      },
                    }))
                  }
                  label={t("pages.inbounds.wireguardNoKernelTun", {
                    defaultValue: "noKernelTun (userspace; recommended on some hosts)",
                  })}
                />
                <div>
                  <label
                    className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]"
                    htmlFor="in-wg-workers"
                  >
                    {t("pages.inbounds.wireguardWorkers", {
                      defaultValue: "Workers (optional)",
                    })}
                  </label>
                  <Input
                    id="in-wg-workers"
                    type="number"
                    className="font-mono text-xs"
                    min={1}
                    placeholder={t("pages.inbounds.wireguardWorkersPlaceholder", {
                      defaultValue: "Leave empty to omit",
                    })}
                    value={form.wireguardForm.workers}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        wireguardForm: {
                          ...f.wireguardForm,
                          workers: e.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-xs"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        wireguardForm: defaultWireguardForm(),
                      }))
                    }
                  >
                    {t("pages.inbounds.wireguardResetDefaults", {
                      defaultValue: "Reset to defaults (new private key)",
                    })}
                  </Button>
                </div>
              </div>
            ) : null}
            {form.protocol === "amneziawg" ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--fg-subtle)]">
                  {t("pages.inbounds.amneziawgSettingsHint", {
                    defaultValue:
                      "AmneziaWG sidecar (amneziawg-go): UDP tunnel with obfuscation (Jc/H/S). Peers are created when you assign clients. Not part of Xray JSON.",
                  })}
                </p>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-awg-mtu">
                    {t("pages.inbounds.wireguardMtu", { defaultValue: "MTU" })}
                  </label>
                  <Input
                    id="in-awg-mtu"
                    type="number"
                    className="font-mono text-xs"
                    min={1280}
                    max={9000}
                    value={form.amneziawgForm.mtu}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setForm((f) => ({
                        ...f,
                        amneziawgForm: {
                          ...f.amneziawgForm,
                          mtu: Number.isFinite(n) && n > 0 ? n : 1420,
                        },
                      }));
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-awg-sk">
                    {t("pages.inbounds.wireguardSecretKey", {
                      defaultValue: "Secret key (server private, base64)",
                    })}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="in-awg-sk"
                      className="flex-1 font-mono text-xs"
                      value={form.amneziawgForm.secretKey}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          amneziawgForm: { ...f.amneziawgForm, secretKey: e.target.value },
                        }))
                      }
                      spellCheck={false}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 text-xs"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          amneziawgForm: {
                            ...f.amneziawgForm,
                            secretKey: newWireGuardSecretKeyBase64(),
                          },
                        }))
                      }
                    >
                      {t("pages.inbounds.wireguardRegenKey", { defaultValue: "Regenerate key" })}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-awg-addr">
                    {t("pages.inbounds.wireguardAddress", {
                      defaultValue: "Tunnel address (CIDR, one per line)",
                    })}
                  </label>
                  <TextArea
                    id="in-awg-addr"
                    className="min-h-[68px] font-mono text-xs"
                    value={form.amneziawgForm.address}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        amneziawgForm: { ...f.amneziawgForm, address: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-awg-dns">
                    {t("pages.inbounds.wireguardClientDns", { defaultValue: "Client DNS (for user .conf)" })}
                  </label>
                  <TextArea
                    id="in-awg-dns"
                    className="min-h-[56px] font-mono text-xs"
                    value={form.amneziawgForm.clientDns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        amneziawgForm: { ...f.amneziawgForm, clientDns: e.target.value },
                      }))
                    }
                    spellCheck={false}
                  />
                </div>
                <div className="rounded-xl border border-[var(--border)] p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-[var(--fg-muted)]">
                      {t("pages.inbounds.amneziawgObfuscation", {
                        defaultValue: "Obfuscation (Jc / H / S)",
                      })}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs shrink-0"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          amneziawgForm: {
                            ...f.amneziawgForm,
                            ...randomAmneziaWgObfuscationFields(),
                          },
                        }))
                      }
                    >
                      {t("pages.inbounds.amneziawgRegenObfuscation", {
                        defaultValue: "Randomize",
                      })}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(
                      [
                        "jc",
                        "jmin",
                        "jmax",
                        "s1",
                        "s2",
                        "s3",
                        "s4",
                        "h1",
                        "h2",
                        "h3",
                        "h4",
                      ] as const
                    ).map((key) => (
                      <div key={key}>
                        <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--fg-subtle)]">
                          {key}
                          {key.startsWith("h") ? " (n or n-m)" : ""}
                        </label>
                        <Input
                          className="font-mono text-xs"
                          value={form.amneziawgForm[key]}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              amneziawgForm: {
                                ...f.amneziawgForm,
                                [key]: e.target.value,
                              },
                            }))
                          }
                          spellCheck={false}
                          placeholder={key.startsWith("h") ? "123 or 10-99" : undefined}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 border-t border-[var(--border)] pt-3">
                    <p className="text-xs font-medium text-[var(--fg-muted)]">
                      {t("pages.inbounds.amneziawg3HeaderProtection", {
                        defaultValue: "AWG 3 — Header protection",
                      })}
                    </p>
                    <p className="text-[11px] text-[var(--fg-subtle)]">
                      {t("pages.inbounds.amneziawg3HeaderProtectionHint", {
                        defaultValue:
                          "Server-side key (same on client). Requires S1–S4 ≥ 8. Leave empty for legacy AWG.",
                      })}
                    </p>
                    <div className="flex gap-2">
                      <Input
                        className="font-mono text-xs"
                        value={form.amneziawgForm.headerProtectionKey}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            amneziawgForm: ensureAmneziaWgHeaderProtectionPadding({
                              ...f.amneziawgForm,
                              headerProtectionKey: e.target.value,
                            }),
                          }))
                        }
                        spellCheck={false}
                        placeholder="awg genkey"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        className="shrink-0 text-xs"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            amneziawgForm: ensureAmneziaWgHeaderProtectionPadding({
                              ...f.amneziawgForm,
                              headerProtectionKey: newWireGuardSecretKeyBase64(),
                            }),
                          }))
                        }
                      >
                        {t("pages.inbounds.amneziawgGenHeaderKey", {
                          defaultValue: "Generate",
                        })}
                      </Button>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--fg-subtle)]">
                        ContentPaddingAddition
                      </label>
                      <Input
                        className="font-mono text-xs"
                        value={form.amneziawgForm.contentPaddingAddition}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            amneziawgForm: {
                              ...f.amneziawgForm,
                              contentPaddingAddition: e.target.value,
                            },
                          }))
                        }
                        spellCheck={false}
                        placeholder="16 or 8-32"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-[var(--border)] pt-3">
                    <p className="text-xs font-medium text-[var(--fg-muted)]">
                      {t("pages.inbounds.amneziawg3Timings", {
                        defaultValue: "AWG 3 — Timings (optional)",
                      })}
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {(
                        [
                          ["rekeyAfterTime", "RekeyAfterTime"],
                          ["rekeyTimeout", "RekeyTimeout"],
                          ["rejectAfterTime", "RejectAfterTime"],
                          ["keepaliveTimeout", "KeepaliveTimeout"],
                          ["maxHandshakeAttempts", "MaxHandshakeAttempts"],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field}>
                          <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--fg-subtle)]">
                            {label}
                          </label>
                          <Input
                            className="font-mono text-xs"
                            value={form.amneziawgForm[field]}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                amneziawgForm: {
                                  ...f.amneziawgForm,
                                  [field]: e.target.value,
                                },
                              }))
                            }
                            spellCheck={false}
                            placeholder="sec or min-max"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-[var(--border)] pt-3">
                    <p className="text-xs font-medium text-[var(--fg-muted)]">
                      {t("pages.inbounds.amneziawg3Signatures", {
                        defaultValue: "AWG 3 — Signature packets I1–I5 (optional)",
                      })}
                    </p>
                    <p className="text-[11px] text-[var(--fg-subtle)]">
                      {t("pages.inbounds.amneziawg3SignaturesHint", {
                        defaultValue:
                          "Usually client-only. Tags: <b 0x..>, <r N>, <rd N>, <rc N>, <t>",
                      })}
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {(["i1", "i2", "i3", "i4", "i5"] as const).map((key) => (
                        <div key={key} className="flex items-center gap-2">
                          <label className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-[var(--fg-subtle)]">
                            {key}
                          </label>
                          <Input
                            className="font-mono text-xs"
                            value={form.amneziawgForm[key]}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                amneziawgForm: {
                                  ...f.amneziawgForm,
                                  [key]: e.target.value,
                                },
                              }))
                            }
                            spellCheck={false}
                            placeholder="<b 0xdead><r 10>"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      amneziawgForm: {
                        ...defaultAmneziaWgInboundForm(),
                        ...randomAmneziaWgObfuscationFields(),
                      },
                    }))
                  }
                >
                  {t("pages.inbounds.amneziawgResetDefaults", { defaultValue: "Reset to defaults" })}
                </Button>
              </div>
            ) : null}

            {form.protocol !== "vless" &&
            form.protocol !== "trojan" &&
            !isHysteriaFamily &&
            form.protocol !== "shadowsocks" &&
            form.protocol !== "mixed" &&
            form.protocol !== "wireguard" &&
            form.protocol !== "telemt" ? (
              <p className="text-xs text-[var(--fg-subtle)]">
                {t("pages.inbounds.sectionAuthNone", {
                  defaultValue:
                    "No protocol-specific secrets on this screen (e.g. VMess uses client UUIDs in settings).",
                })}
              </p>
            ) : null}
            </InboundFormSection>
            ) : null}

            {step === "sniffing" ? (
            <InboundFormSection
              title={t("pages.inbounds.sniffingSection", { defaultValue: "Sniffing" })}
            >
              <CheckboxField
                checked={form.sniffingForm.enabled}
                onChange={(e) =>
                  setSniffingFormField("enabled", e.target.checked)
                }
                label={t("pages.inbounds.sniffingEnabled", { defaultValue: "Enabled" })}
              />
              <p className="mb-2 mt-3 text-xs font-medium text-[var(--fg-muted)]">
                {t("pages.inbounds.sniffingDestOverride", { defaultValue: "Destination override" })}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <CheckboxField
                  checked={form.sniffingForm.destHttp}
                  onChange={(e) =>
                    setSniffingFormField("destHttp", e.target.checked)
                  }
                  label="http"
                />
                <CheckboxField
                  checked={form.sniffingForm.destTls}
                  onChange={(e) =>
                    setSniffingFormField("destTls", e.target.checked)
                  }
                  label="tls"
                />
                <CheckboxField
                  checked={form.sniffingForm.destQuic}
                  onChange={(e) =>
                    setSniffingFormField("destQuic", e.target.checked)
                  }
                  label="quic"
                />
                <CheckboxField
                  checked={form.sniffingForm.destFakedns}
                  onChange={(e) =>
                    setSniffingFormField("destFakedns", e.target.checked)
                  }
                  label="fakedns"
                />
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <CheckboxField
                  checked={form.sniffingForm.metadataOnly}
                  onChange={(e) =>
                    setSniffingFormField("metadataOnly", e.target.checked)
                  }
                  label={t("pages.inbounds.sniffingMetadataOnly", {
                    defaultValue: "Metadata only",
                  })}
                />
                <CheckboxField
                  checked={form.sniffingForm.routeOnly}
                  onChange={(e) =>
                    setSniffingFormField("routeOnly", e.target.checked)
                  }
                  label={t("pages.inbounds.sniffingRouteOnly", {
                    defaultValue: "Route only",
                  })}
                />
              </div>
              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="in-sniff-excluded">
                  {t("pages.inbounds.sniffingDomainsExcluded", { defaultValue: "Excluded domains (one per line)" })}
                </label>
                <TextArea
                  id="in-sniff-excluded"
                  className="min-h-[64px] font-mono text-xs"
                  value={form.sniffingForm.domainsExcluded}
                  onChange={(e) => setSniffingFormField("domainsExcluded", e.target.value)}
                  placeholder="domain:example.com"
                />
                <p className="mt-1 text-xs text-[var(--fg-subtle)]">
                  {t("pages.inbounds.sniffingDomainsExcludedHint", {
                    defaultValue: "Domains matching these rules will not have their destination overridden.",
                  })}
                </p>
              </div>
            </InboundFormSection>
            ) : null}

            {step === "nodes" && nodes.length > 0 ? (
              <InboundFormSection
                title={t("pages.inbounds.addInboundNodesLabel")}
              >
                <p className="mb-2 text-xs text-[var(--fg-muted)]">
                  {t("pages.inbounds.addInboundNodesHint")}
                </p>
                {nodeBindings.length > 0 ? (
                  <div className="mb-3 space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                      {t("pages.inbounds.subscriptionNodeOrder", {
                        defaultValue: "Subscription order & overrides",
                      })}
                    </p>
                    {nodeBindings.map((row, idx) => {
                      const meta = nodes.find((x) => x.id === row.nodeId);
                      const title = meta?.name ?? `Node ${row.nodeId}`;
                      return (
                        <div
                          key={row.nodeId}
                          className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--fg)]">
                              {title}{" "}
                              <span className="font-normal text-[var(--fg-muted)]">
                                (id: {row.nodeId})
                              </span>
                            </span>
                            <div className="flex items-center gap-0.5">
                              <IconButton
                                type="button"
                                label={t("pages.inbounds.moveBindingUp", {
                                  defaultValue: "Move up",
                                })}
                                disabled={idx === 0}
                                onClick={() => moveNodeBinding(idx, -1)}
                              >
                                <ArrowUp size={16} />
                              </IconButton>
                              <IconButton
                                type="button"
                                label={t("pages.inbounds.moveBindingDown", {
                                  defaultValue: "Move down",
                                })}
                                disabled={idx >= nodeBindings.length - 1}
                                onClick={() => moveNodeBinding(idx, 1)}
                              >
                                <ArrowDown size={16} />
                              </IconButton>
                            </div>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="grid gap-1">
                              <span className="text-[11px] text-[var(--fg-muted)]">
                                {t("pages.inbounds.nodePublishedAddress", {
                                  defaultValue: "Published address (optional)",
                                })}
                              </span>
                              <Input
                                value={row.publishedAddress}
                                onChange={(e) =>
                                  patchNodeBinding(row.nodeId, {
                                    publishedAddress: e.target.value,
                                  })
                                }
                                placeholder={t("pages.inbounds.nodePublishedAddressPh", {
                                  defaultValue: "Empty = node address",
                                })}
                              />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-[11px] text-[var(--fg-muted)]">
                                {t("pages.inbounds.nodePublishedPort", {
                                  defaultValue: "Published port (0 = inbound)",
                                })}
                              </span>
                              <Input
                                type="number"
                                min={0}
                                value={row.publishedPort}
                                onChange={(e) =>
                                  patchNodeBinding(row.nodeId, {
                                    publishedPort: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>
                          <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1">
                            <CheckboxField
                              align="start"
                              label={t("pages.inbounds.includeInSubscription", {
                                defaultValue: "Include in subscription",
                              })}
                              checked={row.includeInSubscription}
                              onChange={(e) =>
                                patchNodeBinding(row.nodeId, {
                                  includeInSubscription: e.target.checked,
                                })
                              }
                            />
                          </div>
                          <label className="mt-2 grid gap-1">
                            <span className="text-[11px] text-[var(--fg-muted)]">
                              {t("pages.inbounds.subscriptionRemarkSuffix", {
                                defaultValue: "Remark suffix (optional)",
                              })}
                            </span>
                            <Input
                              value={row.subscriptionRemarkSuffix}
                              onChange={(e) =>
                                patchNodeBinding(row.nodeId, {
                                  subscriptionRemarkSuffix: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="mt-2 grid gap-1">
                            <span className="text-[11px] text-[var(--fg-muted)]">
                              {t("pages.inbounds.serverDescription", {
                                defaultValue: "Server description (optional, max 30)",
                              })}
                            </span>
                            <Input
                              maxLength={30}
                              value={row.serverDescription}
                              onChange={(e) =>
                                patchNodeBinding(row.nodeId, {
                                  serverDescription: e.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <CheckboxOptionList
                  layout="grid"
                  header={
                    <SelectionListToolbar
                      selectedCount={nodeBindings.length}
                      totalCount={nodes.length}
                      onSelectAll={() =>
                        setNodeBindings(
                          nodes.map((n) => ({
                            nodeId: n.id,
                            publishedAddress: "",
                            publishedPort: "0",
                            includeInSubscription: true,
                            subscriptionRemarkSuffix: "",
                            serverDescription: "",
                          })),
                        )
                      }
                      onSelectNone={() => setNodeBindings([])}
                      selectAllLabel={t("pages.inbounds.selectAllNodes", {
                        defaultValue: "Select all",
                      })}
                      selectNoneLabel={t("pages.inbounds.selectNoneNodes", {
                        defaultValue: "Clear",
                      })}
                    />
                  }
                >
                  {nodes.map((n) => {
                    const checked = nodeBindings.some((b) => b.nodeId === n.id);
                    return (
                      <CheckboxOptionCard
                        key={n.id}
                        icon={Server}
                        checked={checked}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setNodeBindings((rows) => {
                            if (on) {
                              if (rows.some((r) => r.nodeId === n.id)) return rows;
                              return [
                                ...rows,
                                {
                                  nodeId: n.id,
                                  publishedAddress: "",
                                  publishedPort: "0",
                                  includeInSubscription: true,
                                  subscriptionRemarkSuffix: "",
                                  serverDescription: "",
                                },
                              ];
                            }
                            return rows.filter((r) => r.nodeId !== n.id);
                          });
                        }}
                        heading={n.name}
                        description={t("pages.inbounds.nodeIdLabel", {
                          defaultValue: "Node id: {{id}}",
                          id: n.id,
                        })}
                      />
                    );
                  })}
                </CheckboxOptionList>
              </InboundFormSection>
            ) : null}

            {step === "nodes" && nodes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--fg-subtle)]">
                {t("pages.inbounds.addInboundNodesEmpty", {
                  defaultValue: "No nodes configured yet. Inbound will run on the main server.",
                })}
              </p>
            ) : null}
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteId != null}
        title={t("sure")}
        description={
          deleteId != null
            ? rows.find((x) => x.id === deleteId)?.remark?.trim() || `#${deleteId}`
            : undefined
        }
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onCancel={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        danger
        loading={deleting}
      />
    </PageScaffold>
  );
}
