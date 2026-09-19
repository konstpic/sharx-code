import { isRecord, stringList } from "@/lib/xrayConfigSections";
import type { Tr } from "./fields";

const count = (v: unknown): number => (Array.isArray(v) ? v.length : isRecord(v) ? 1 : 0);

/** One-line description of a section's content for the carousel tile. */
export function sectionSummary(key: string, raw: unknown, tr: Tr): string {
  const o = isRecord(raw) ? raw : {};
  switch (key) {
    case "log":
      return typeof o.loglevel === "string" ? o.loglevel : "";
    case "api":
      return typeof o.tag === "string" ? o.tag : "";
    case "stats":
      return tr("sumOn", "enabled");
    case "policy":
      return tr("sumLevels", "{{n}} levels", { n: isRecord(o.levels) ? Object.keys(o.levels).length : 0 });
    case "dns":
      return tr("sumServers", "{{n}} servers", { n: Array.isArray(o.servers) ? o.servers.length : 0 });
    case "routing":
      return tr("sumRules", "{{n}} rules", { n: Array.isArray(o.rules) ? o.rules.length : 0 });
    case "fakedns":
      return tr("sumPools", "{{n}} pools", { n: count(raw) });
    case "inbounds":
      return tr("sumInbounds", "{{n}} inbounds", { n: count(raw) });
    case "outbounds":
      return tr("sumOutbounds", "{{n}} outbounds", { n: count(raw) });
    case "reverse":
      return tr("sumReverse", "{{b}} bridges · {{p}} portals", {
        b: Array.isArray(o.bridges) ? o.bridges.length : 0,
        p: Array.isArray(o.portals) ? o.portals.length : 0,
      });
    case "observatory":
    case "burstObservatory":
      return tr("sumSelectors", "{{n}} selectors", { n: stringList(o.subjectSelector).length });
    case "metrics":
      return typeof o.listen === "string" ? o.listen : "";
    default:
      return "";
  }
}
