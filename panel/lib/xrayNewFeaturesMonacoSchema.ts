/**
 * JSON-schema fragments for options added in Xray 26.9.30 / 26.10.10 (field names verified against
 * infra/conf/*.go at tag v26.10.10): masque, xdrive, finalmask (noise exp, xdns), Lua `script`.
 */

type TLike = (key: string, o?: { defaultValue: string }) => string;

const D = (d: TLike, key: string, defaultValue: string) => d(`pages.xray.jsonSchema.${key}`, { defaultValue });

export function masqueSettingsSchema(d: TLike): object {
  return {
    type: "object",
    additionalProperties: true,
    description: D(d, "masque.settings", "MASQUE transport (Xray ≥ 26.9.30), only for the masque protocol. Needs security tls."),
    properties: {
      host: { type: "string", description: D(d, "masque.host", "Authority of the CONNECT-IP request. With warp: empty = Cloudflare endpoint.") },
      path: {
        type: "string",
        description: D(d, "masque.path", "URI path, must start with /. Variables: {target}, {ipproto}. Default /.well-known/masque/ip/*/*/"),
      },
      user: { type: "string", description: D(d, "masque.user", "Basic auth user (not with warp).") },
      pass: { type: "string", description: D(d, "masque.pass", "Basic auth password (not with warp).") },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: D(d, "masque.headers", 'Extra request headers. "Host" and "Capsule-Protocol" are not allowed.'),
      },
      warp: {
        type: "object",
        additionalProperties: true,
        description: D(d, "masque.warp", "Cloudflare WARP profile. Excludes user/pass."),
        properties: {
          privateKey: { type: "string", description: D(d, "masque.warpPrivateKey", "ECDSA P-256 private key, PEM or base64 (PKCS #8 / SEC 1).") },
          publicKey: { type: "string", description: D(d, "masque.warpPublicKey", "Server public key, PEM or base64 (PKIX). Required by Xray ≥ 26.10.10.") },
          address: { type: "array", items: { type: "string" }, description: D(d, "masque.warpAddress", "Tunnel address(es): at most one IPv4 and one IPv6.") },
        },
      },
    },
  };
}

export function xdriveSettingsSchema(d: TLike): object {
  const num = (key: string, text: string) => ({ type: "integer", minimum: 0, description: D(d, `xdrive.${key}`, text) });
  return {
    type: "object",
    additionalProperties: true,
    description: D(d, "xdrive.settings", "XDRIVE transport (Xray ≥ 26.9.30): traffic is carried through files on remote storage."),
    properties: {
      remoteFolder: { type: "string", description: D(d, "xdrive.remoteFolder", "Folder on the storage; same on both ends.") },
      service: {
        type: "string",
        enum: ["Google Drive", "template", "local"],
        description: D(d, "xdrive.service", 'Backend: "Google Drive" (3 secrets) or "template" (generic HTTP storage).'),
      },
      secrets: {
        type: "array",
        items: { type: "string" },
        description: D(d, "xdrive.secrets", "Google Drive: [ClientID, ClientSecret, RefreshToken]. Template: {secret0}, {secret1}, …"),
      },
      template: {
        type: "object",
        additionalProperties: true,
        description: D(d, "xdrive.template", "service template: put/get/delete/list operations, auth (none|static|basic|oauth2), retry."),
        properties: {
          flatten: { type: "boolean" },
          concurrency: { type: "integer", minimum: 0 },
          auth: { type: "object", additionalProperties: true },
          put: { type: "object", additionalProperties: true },
          get: { type: "object", additionalProperties: true },
          delete: { type: "object", additionalProperties: true },
          list: { type: "object", additionalProperties: true, properties: { namesRegex: { type: "string" } } },
          retry: { type: "object", additionalProperties: true },
        },
      },
      segmentBytes: num("segmentBytes", "Segment size in bytes (default 512 KiB, max 16 MiB)."),
      flushIntervalMs: num("flushIntervalMs", "Default 20."),
      pollIntervalMs: num("pollIntervalMs", "Default 50."),
      maxPollIntervalMs: num("maxPollIntervalMs", "Default 500."),
      sessionTtlSeconds: num("sessionTtlSeconds", "Default 300."),
      concurrency: num("concurrency", "Default 8, max 64."),
      eagerWindowMs: num("eagerWindowMs", "Default 2000."),
      holeTimeoutMs: num("holeTimeoutMs", "Default 30000."),
    },
  };
}

const maskItem = (d: TLike, types: string[]) => ({
  type: "object",
  additionalProperties: true,
  properties: {
    type: { type: "string", enum: types, description: D(d, "finalmask.type", "Mask type.") },
    settings: { type: "object", additionalProperties: true },
  },
  required: ["type"],
  allOf: [
    {
      if: { properties: { type: { const: "noise" } } },
      then: {
        properties: {
          settings: {
            type: "object",
            properties: {
              reset: { description: D(d, "finalmask.noiseReset", "Reset interval (number or range).") },
              noise: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      description: D(
                        d,
                        "finalmask.noiseType",
                        'Packet encoding: str | hex | base64 | array, or "exp" (Xray ≥ 26.9.30) — "packet" is a template string like "<b 0x1234><r 16><t><c>"; tokens: b (hex bytes), r / rc / rd (random bytes / ASCII / digits, size or range), t, c, n.',
                      ),
                    },
                    packet: {},
                    rand: {},
                    randRange: {},
                    delay: {},
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      if: { properties: { type: { const: "xdns" } } },
      then: {
        properties: {
          settings: {
            type: "object",
            properties: {
              domains: {
                type: "array",
                description: D(d, "finalmask.xdnsDomains", "Xray ≥ 26.10.10: [{ names: [..], lenLimit, labelLimit, types: [..], edns0 }] (older cores: name / plain strings)."),
                items: {
                  type: "object",
                  properties: {
                    names: { type: "array", items: { type: "string" } },
                    lenLimit: { type: "integer" },
                    labelLimit: { type: "integer" },
                    types: { type: "array", items: { type: "integer" } },
                    edns0: { type: "integer" },
                  },
                },
              },
              resolvers: {
                type: "array",
                description: D(d, "finalmask.xdnsResolvers", "Xray ≥ 26.10.10: [{ addrs: [\"1.1.1.1\", \"tcp://1.1.1.1:53\"] }] (udp:// by default, port 53 by default)."),
                items: { type: "object", properties: { addrs: { type: "array", items: { type: "string" } } } },
              },
              extraPoll: { type: "integer", minimum: 0, maximum: 3 },
            },
          },
        },
      },
    },
  ],
});

/** `streamSettings.finalmask` (tcp / udp mask lists + quicParams). */
export function finalmaskSchema(d: TLike): object {
  return {
    type: "object",
    additionalProperties: true,
    description: D(d, "finalmask.root", "Final obfuscation layer applied under the transport."),
    properties: {
      tcp: {
        type: "array",
        items: maskItem(d, ["header-custom", "fragment", "sudoku", "xmc"]),
      },
      udp: {
        type: "array",
        items: maskItem(d, ["header-custom", "mkcp-legacy", "noise", "salamander", "sudoku", "xdns", "xicmp", "realm", "udphop"]),
      },
      quicParams: { type: "object", additionalProperties: true },
    },
  };
}

/** Lua `script` property for the `dns` and `routing` sections (Xray ≥ 26.10.10). */
export function luaScriptProperty(d: TLike): object {
  return {
    type: "string",
    description: D(
      d,
      "luaScript",
      "Xray ≥ 26.10.10: path of a Lua script (resolved by Xray, e.g. relative to the asset directory) that decides DNS / routing. The panel does not edit or upload Lua files.",
    ),
  };
}
