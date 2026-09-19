import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Cable,
  FileText,
  Gauge,
  Globe2,
  LineChart,
  Plug,
  Repeat,
  Route,
  Shuffle,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type XraySectionGroup = "core" | "network" | "endpoints" | "advanced";

export type XraySectionDef = {
  key: string;
  group: XraySectionGroup;
  icon: LucideIcon;
  /** Default JSON value inserted by "Add section". */
  defaultValue: unknown;
  /** Has a visual editor (otherwise JSON only). */
  visual: boolean;
};

/** Known Xray top-level sections in display order. */
export const XRAY_SECTIONS: readonly XraySectionDef[] = [
  { key: "log", group: "core", icon: FileText, defaultValue: { access: "none", error: "", loglevel: "warning", dnsLog: false }, visual: true },
  { key: "api", group: "core", icon: Plug, defaultValue: { tag: "api", services: ["HandlerService", "LoggerService", "StatsService"] }, visual: true },
  { key: "stats", group: "core", icon: BarChart3, defaultValue: {}, visual: true },
  {
    key: "policy",
    group: "core",
    icon: SlidersHorizontal,
    defaultValue: {
      levels: { "0": { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: true, statsInboundDownlink: true, statsOutboundUplink: true, statsOutboundDownlink: true },
    },
    visual: true,
  },
  { key: "dns", group: "network", icon: Globe2, defaultValue: { servers: ["1.1.1.1", "8.8.8.8"] }, visual: true },
  { key: "routing", group: "network", icon: Route, defaultValue: { domainStrategy: "AsIs", rules: [] }, visual: true },
  { key: "fakedns", group: "network", icon: Shuffle, defaultValue: [{ ipPool: "198.18.0.0/15", poolSize: 65535 }], visual: true },
  { key: "inbounds", group: "endpoints", icon: ArrowDownToLine, defaultValue: [], visual: true },
  { key: "outbounds", group: "endpoints", icon: ArrowUpFromLine, defaultValue: [{ tag: "direct", protocol: "freedom", settings: {} }], visual: true },
  { key: "transport", group: "advanced", icon: Cable, defaultValue: {}, visual: false },
  { key: "reverse", group: "advanced", icon: Repeat, defaultValue: { bridges: [], portals: [] }, visual: true },
  { key: "observatory", group: "advanced", icon: Activity, defaultValue: { subjectSelector: [], probeUrl: "https://www.google.com/generate_204", probeInterval: "10s", enableConcurrency: false }, visual: true },
  {
    key: "burstObservatory",
    group: "advanced",
    icon: Gauge,
    defaultValue: { subjectSelector: [], pingConfig: { destination: "https://www.google.com/generate_204", connectivity: "", interval: "1h", sampling: 3, timeout: "30s" } },
    visual: true,
  },
  { key: "metrics", group: "advanced", icon: LineChart, defaultValue: { tag: "metrics", listen: "127.0.0.1:11111" }, visual: true },
];

export const XRAY_SECTION_BY_KEY: Record<string, XraySectionDef> = Object.fromEntries(
  XRAY_SECTIONS.map((s) => [s.key, s]),
);

export const XRAY_GROUP_ORDER: readonly XraySectionGroup[] = ["core", "network", "endpoints", "advanced"];

/** Keys present in the template, known ones first (in display order), then unknown ones alphabetically. */
export function orderedSectionKeys(root: Record<string, unknown> | null): string[] {
  if (!root) return [];
  const present = Object.keys(root);
  const known = XRAY_SECTIONS.map((s) => s.key).filter((k) => present.includes(k));
  const unknown = present.filter((k) => !XRAY_SECTION_BY_KEY[k]).sort();
  return [...known, ...unknown];
}

/** Known sections that the template does not contain yet (offered by "Add section"). */
export function missingSectionKeys(root: Record<string, unknown> | null): string[] {
  if (!root) return [];
  return XRAY_SECTIONS.map((s) => s.key).filter((k) => !(k in root));
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function stringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v) return [v];
  return [];
}

export function tagsOfList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (isRecord(x) && typeof x.tag === "string" ? x.tag.trim() : ""))
    .filter(Boolean);
}
