import { describe, expect, it } from "vitest";
import { extractTgProxyLinks, resolveMtProtoLinks, tgProxyDisplayLabel } from "./types";

const tcp = "tg://proxy?server=tcp.example.com&port=8443&secret=dd00";
const web = "tg://webproxy?server=web.example.com&secret=dd00";

describe("Telegram subscription links", () => {
  it("keeps both TCP and WEB links from bundled legacy entries", () => {
    expect(extractTgProxyLinks([` ${tcp}\n${web} `, "vless://other", "tg://proxy-other?server=x"])).toEqual([tcp, web]);
  });
  it("recognizes WEB case-insensitively without changing the link", () => {
    const upper = web.replace("tg://webproxy", "TG://WEBPROXY");
    expect(extractTgProxyLinks([upper])).toEqual([upper]);
  });
  it("preserves explicit API links and handles the legacy fallback", () => {
    expect(resolveMtProtoLinks({ mtProtoLinks: [web], links: [tcp] })).toEqual([web]);
    expect(resolveMtProtoLinks({ mtProtoLinks: [], links: [web, tcp] })).toEqual([web, tcp]);
  });
  it("labels WEB links with their vhost", () => {
    expect(tgProxyDisplayLabel(web, 0)).toBe("web.example.com");
  });
});
