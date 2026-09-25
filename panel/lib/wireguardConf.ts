/** WireGuard and AmneziaWG subscription keys share the same wg-quick .conf block. */
export function isWgQuickConfProtocol(protocol: string | null | undefined): boolean {
  const p = (protocol ?? "").trim().toLowerCase();
  return p === "wireguard" || p === "amneziawg";
}

const WG_QUICK_KEY =
  "PrivateKey|Address|DNS|MTU|PublicKey|Endpoint|PresharedKey|PersistentKeepalive|AllowedIPs|Jc|Jmin|Jmax|S1|S2|S3|S4|H1|H2|H3|H4";

/** Normalize collapsed panel/QR text into wg-quick lines (AmneziaWG app is strict). */
export function formatWgQuickConfForExport(block: string): string {
  let s = block.trim();
  if (!s) return s;
  s = s.replace(/\s+\[(Peer|Interface)\]\s+/g, "\n\n[$1]\n");
  s = s.replace(
    new RegExp(`\\s+(${WG_QUICK_KEY})\\s*=`, "g"),
    "\n$1 =",
  );
  return s.trim();
}

/** wg-quick block for QR / .conf export from panel or subscription text. */
export function wgQuickConfFromPanelText(text: string): string | null {
  const block = extractWireGuardConfBlock(text);
  return block ? formatWgQuickConfForExport(block) : null;
}

/**
 * Extract the wg-quick `[Interface]` / `[Peer]` block from panel WireGuard info text.
 * Must not match descriptive lines like "Client DNS (for [Interface]):" — only a
 * section header at the start of a line.
 */
export function extractWireGuardConfBlock(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lineStart = /(?:^|\n)\[Interface\]\s*(?:\r?\n|$)/;
  let match = trimmed.match(lineStart);
  if (match && match.index != null) {
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    return trimmed.slice(start).trim();
  }

  // Collapsed single-line panel text (some QR decoders join lines with spaces).
  const inline = /(?:^|\s)\[Interface\]\s+(?=PrivateKey|Address|DNS|MTU|Jc|Jmin|S1|H1)/;
  match = trimmed.match(inline);
  if (match && match.index != null) {
    const start = match.index + match[0].indexOf("[Interface]");
    return trimmed.slice(start).trim();
  }

  if (trimmed.startsWith("[Interface]")) {
    return trimmed;
  }
  return null;
}

/** Join split subscription lines and extract a wg-quick block (GetSubs splits WG panel text by `\n`). */
export function reconstructWireGuardConfFromLinks(links: string[]): string | null {
  // A single link only counts when it is a whole conf. A lone "[Interface]" line (the text was split by "\n") also
  // matches the block extractor but carries no keys, so it must not win over the joined text.
  for (const link of links) {
    const conf = wgQuickConfFromPanelText(link);
    if (conf && /PrivateKey\s*=/i.test(conf)) return conf;
  }
  if (!links.length) return null;
  return wgQuickConfFromPanelText(links.join("\n"));
}

/** First wg-quick block found in subscription link lines. */
export function firstWireGuardConfFromLinks(links: string[]): string | null {
  return reconstructWireGuardConfFromLinks(links);
}

function sanitizeConfFileStem(label: string): string {
  const stem = label
    .trim()
    .replace(/[^\w.\- \u0400-\u04FF]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return stem || "wireguard";
}

/** Safe download filename for a wg-quick .conf (inbound remark). */
export function wireGuardConfFileName(label: string): string {
  return `${sanitizeConfFileStem(label)}.conf`;
}

function isBoilerplateWgHeaderSuffix(suffix: string): boolean {
  const lower = suffix.toLowerCase();
  return (
    lower.includes("v2ray") ||
    lower.includes(".conf block") ||
    lower.includes("use the data below") ||
    lower.includes("use the .conf")
  );
}

/** Human label from panel WireGuard / AmneziaWG subscription text (prefers `Inbound:` line). */
export function wireGuardConfLabelFromPanelText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const inboundLine = trimmed.match(/^Inbound:\s*(.+?)(?:\r?\n|$)/im);
  if (inboundLine?.[1]?.trim()) return inboundLine[1].trim();
  const header = trimmed.match(/^(?:WireGuard|AmneziaWG)\s*\(UDP\)\s*(?:—|-)\s*(.+?)(?:\r?\n|$)/i);
  if (header?.[1]?.trim()) {
    const suffix = header[1].trim();
    if (!isBoilerplateWgHeaderSuffix(suffix)) return suffix;
  }
  if (/^AmneziaWG/i.test(trimmed)) return "AmneziaWG";
  if (/^WireGuard/i.test(trimmed)) return "WireGuard";
  return null;
}

export type WireGuardConfEntry = {
  conf: string;
  label: string;
  fileName: string;
};

/** All distinct wg-quick blocks in subscription order (one per inbound link entry). */
export function listWireGuardConfsFromLinks(links: string[]): WireGuardConfEntry[] {
  const seen = new Set<string>();
  const out: WireGuardConfEntry[] = [];
  let confIndex = 0;
  for (const raw of links) {
    const conf = wgQuickConfFromPanelText(raw);
    if (!conf || seen.has(conf)) continue;
    seen.add(conf);
    const fromText = wireGuardConfLabelFromPanelText(raw);
    const label = fromText ?? `WireGuard ${++confIndex}`;
    out.push({
      conf,
      label,
      fileName: wireGuardConfFileName(label),
    });
  }
  return out;
}

/** Panel WireGuard info lines that are not the wg-quick conf block itself. */
function isWireGuardPanelMetadataLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (extractWireGuardConfBlock(t)) return false;
  if (/^tg:\/\/(?:web)?proxy\?/i.test(t)) return false;
  if (/^\[Interface\]$/.test(t) || /^\[Peer\]$/.test(t)) return true;
  if (new RegExp(`^(${WG_QUICK_KEY})\\s*=`).test(t)) {
    return true;
  }
  if (
    t.startsWith("WireGuard (UDP)") ||
    t.startsWith("AmneziaWG (UDP)") ||
    t.startsWith("Inbound:") ||
    t.startsWith("Endpoint:") ||
    t.startsWith("MTU:") ||
    t.startsWith("noKernelTun:") ||
    t.startsWith("workers:") ||
    t.startsWith("Server tunnel:") ||
    t.startsWith("Client DNS:") ||
    t.startsWith("Server public key:") ||
    t.startsWith("---") ||
    t.startsWith("Peers on the server") ||
    t.startsWith("Configured:") ||
    t.startsWith("No peers in settings") ||
    t.startsWith("Row linked to this client") ||
    t.startsWith("Device public key") ||
    t.startsWith("AllowedIPs:") ||
    t.startsWith("Pre-shared key:") ||
    t.startsWith("PersistentKeepalive:") ||
    t.startsWith("Client private key") ||
    t.startsWith("No peer row is tagged") ||
    t.startsWith("No peers yet") ||
    t.startsWith("No peer row tagged for client") ||
    t.startsWith("(Assign an email")
  ) {
    return true;
  }
  return false;
}

function isNonWireGuardSubscriptionLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (extractWireGuardConfBlock(trimmed)) return false;
  if (/^tg:\/\/(?:web)?proxy\?/i.test(trimmed)) return false;
  if (isWireGuardPanelMetadataLine(trimmed)) return false;
  return true;
}

/** True when subscription includes an extractable WireGuard .conf block. */
export function hasWireGuardSubscription(links: string[]): boolean {
  return firstWireGuardConfFromLinks(links) != null;
}

/** True when every non-empty link is WireGuard panel info (no vless/vmess/etc.). */
export function isWireGuardOnlySubscription(links: string[]): boolean {
  if (!links.length) return false;
  if (hasWireGuardSubscription(links)) {
    return !links.some((line) => isNonWireGuardSubscriptionLine(line));
  }
  return false;
}
