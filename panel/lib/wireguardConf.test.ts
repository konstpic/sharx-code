import { describe, expect, it } from "vitest";
import {
  extractWireGuardConfBlock,
  firstWireGuardConfFromLinks,
  hasWireGuardSubscription,
  isWgQuickConfProtocol,
  isWireGuardOnlySubscription,
  listWireGuardConfsFromLinks,
  reconstructWireGuardConfFromLinks,
  wgQuickConfFromPanelText,
  wireGuardConfFileName,
  wireGuardConfLabelFromPanelText,
} from "./wireguardConf";

const SAMPLE_PANEL =
  "WireGuard (UDP) — notes\n\n" +
  "Endpoint: 203.0.113.1:51820\n\n" +
  "[Interface]\n" +
  "PrivateKey = abc=\n" +
  "Address = 10.8.0.2/32\n\n" +
  "[Peer]\n" +
  "PublicKey = xyz=\n" +
  "AllowedIPs = 0.0.0.0/0\n";

const SPLIT_LINES = SAMPLE_PANEL.split("\n").map((l) => l.trim()).filter(Boolean);

describe("wireguardConf", () => {
  it("does not treat TCP or WEB Telegram proxies as VPN protocols", () => {
    for (const scheme of ["proxy", "webproxy"]) {
      const link = `tg://${scheme}?server=proxy.example.com&secret=dd00`;
      expect(isWireGuardOnlySubscription([...SPLIT_LINES, link])).toBe(true);
    }
  });

  it("extracts conf from full panel text", () => {
    const conf = extractWireGuardConfBlock(SAMPLE_PANEL);
    expect(conf).toContain("[Interface]");
    expect(conf).toContain("[Peer]");
  });

  it("reconstructs conf from split subscription lines", () => {
    const conf = reconstructWireGuardConfFromLinks(SPLIT_LINES);
    expect(conf).toContain("PrivateKey = abc=");
  });

  it("detects mixed subscription with wireguard block", () => {
    const links = [
      "vless://00000000-0000-0000-0000-000000000000@example.com:443",
      SAMPLE_PANEL,
    ];
    expect(hasWireGuardSubscription(links)).toBe(true);
    expect(isWireGuardOnlySubscription(links)).toBe(false);
  });

  it("detects wg-only subscription from split lines", () => {
    expect(isWireGuardOnlySubscription(SPLIT_LINES)).toBe(true);
    expect(firstWireGuardConfFromLinks(SPLIT_LINES)).not.toBeNull();
  });

  it("recognizes amneziawg as wg-quick protocol", () => {
    expect(isWgQuickConfProtocol("amneziawg")).toBe(true);
    expect(isWgQuickConfProtocol("wireguard")).toBe(true);
    expect(isWgQuickConfProtocol("vless")).toBe(false);
  });

  it("extracts conf from amneziawg panel text for QR", () => {
    const panel =
      "AmneziaWG (UDP) — notes\n\nEndpoint: example.com:51820\n\n" +
      "[Interface]\nPrivateKey = abc=\nJc = 4\n\n[Peer]\nPublicKey = xyz=\n";
    const conf = wgQuickConfFromPanelText(panel);
    expect(conf).toContain("[Interface]");
    expect(conf).not.toContain("AmneziaWG (UDP)");
  });

  it("formats collapsed single-line conf for AmneziaWG import", () => {
    const collapsed =
      "[Interface] PrivateKey = abc= Address = 10.8.0.2/32 [Peer] PublicKey = xyz= AllowedIPs = 0.0.0.0/0";
    const conf = wgQuickConfFromPanelText(collapsed);
    expect(conf).toContain("\nPrivateKey = abc=");
    expect(conf).toContain("\n[Peer]\n");
  });

  it("detects awg-only subscription with obfuscation lines", () => {
    const awgPanel =
      "AmneziaWG (UDP) — notes\nInbound: AWG-DE\n\n" +
      "[Interface]\n" +
      "PrivateKey = abc=\n" +
      "Jc = 4\n" +
      "H1 = 1\n\n" +
      "[Peer]\n" +
      "PublicKey = xyz=\n" +
      "AllowedIPs = 0.0.0.0/0\n";
    const lines = awgPanel.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(isWireGuardOnlySubscription(lines)).toBe(true);
    expect(firstWireGuardConfFromLinks(lines)).toContain("Jc = 4");
  });

  it("uses Inbound line for conf file name, not boilerplate header", () => {
    const panel =
      "AmneziaWG (UDP) — use the .conf block below in the AmneziaWG app (not a v2ray:// link).\n" +
      "Inbound: DE Frankfurt\n\n" +
      "[Interface]\nPrivateKey = abc=\n\n[Peer]\nPublicKey = xyz=\n";
    expect(wireGuardConfLabelFromPanelText(panel)).toBe("DE Frankfurt");
    expect(wireGuardConfFileName("DE Frankfurt")).toBe("DE-Frankfurt.conf");
    const entries = listWireGuardConfsFromLinks([panel]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileName).toBe("DE-Frankfurt.conf");
    expect(entries[0]?.label).toBe("DE Frankfurt");
  });
});
