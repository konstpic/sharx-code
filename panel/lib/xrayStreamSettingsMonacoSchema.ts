/**
 * JSON Schema for Xray `streamSettings` so Monaco can offer enum completion, validation,
 * and hover like VS Code (discriminated by `network` + `security` via if/then).
 */

import { finalmaskSchema, masqueSettingsSchema, xdriveSettingsSchema } from "@/lib/xrayNewFeaturesMonacoSchema";

type TLike = (key: string, o?: { defaultValue: string }) => string;

function D(d: TLike, key: string, defaultValue: string) {
  return d(key, { defaultValue });
}

/** reality (server / client common fields — Xray-core) */
function realitySettingsSchema(d: TLike): object {
  return {
    type: "object",
    additionalProperties: true,
    description: D(
      d,
      "pages.xray.jsonSchema.stream.realitySettings",
      'REALITY transport. Used when security is "reality".',
    ),
    properties: {
      show: {
        type: "boolean",
        description: D(d, "pages.xray.jsonSchema.stream.reality.show", "Show REALITY handshake"),
      },
      dest: { type: "string" },
      xver: {
        type: "integer",
        description: D(d, "pages.xray.jsonSchema.stream.reality.xver", "PROXY protocol version"),
      },
      target: {
        type: "string",
        description: D(d, "pages.xray.jsonSchema.stream.reality.target", "SNI:port e.g. www.example.com:443"),
      },
      serverNames: {
        type: "array",
        items: { type: "string" },
        description: D(d, "pages.xray.jsonSchema.stream.reality.serverNames", "SNI list"),
      },
      privateKey: {
        type: "string",
        description: D(d, "pages.xray.jsonSchema.stream.reality.privateKey", "Server private key (base64url)"),
      },
      minClientVer: { type: "string" },
      maxClientVer: { type: "string" },
      maxTimediff: { type: "number" },
      shortIds: { type: "array", items: { type: "string" } },
      mldsa65Seed: { type: "string" },
      settings: {
        type: "object",
        additionalProperties: true,
        properties: {
          publicKey: { type: "string" },
          fingerprint: { type: "string" },
          serverName: { type: "string" },
          spiderX: { type: "string" },
          mldsa65Verify: { type: "string" },
        },
      },
    },
  };
}

function tlsSettingsSchema(d: TLike): object {
  return {
    type: "object",
    additionalProperties: true,
    description: D(d, "pages.xray.jsonSchema.stream.tlsSettings", "TLS when security is tls or xtls."),
    properties: {
      serverName: { type: "string" },
      alpn: { type: "array", items: { type: "string" } },
      minVersion: { type: "string" },
      maxVersion: { type: "string" },
      pinnedPeerCertSha256: {
        type: "string",
        description: D(
          d,
          "pages.xray.jsonSchema.stream.tls.pinnedPeerCertSha256",
          "SHA-256 certificate pin(s), comma-separated. Replaces deprecated allowInsecure.",
        ),
      },
      certificates: { type: "array" },
      disableSystemRoot: { type: "boolean" },
    },
  };
}

/**
 * `streamSettings` value — merge into inbound/outbound `streamSettings` property.
 */
export function buildXrayStreamSettingsSchema(d: TLike): object {
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      network: {
        type: "string",
        description: D(
          d,
          "pages.xray.jsonSchema.stream.network",
          "Transport layer. Suggestions and validation follow this value.",
        ),
        enum: ["tcp", "kcp", "ws", "http", "quic", "grpc", "xhttp", "httpupgrade", "splithttp", "hysteria", "masque", "xdrive"],
      },
      finalmask: finalmaskSchema(d),
      security: {
        type: "string",
        description: D(
          d,
          "pages.xray.jsonSchema.stream.security",
          "none | tls | reality | xtls. REALITY shows realitySettings; tls shows tlsSettings.",
        ),
        enum: ["none", "tls", "reality", "xtls"],
      },
    },
    allOf: [
      {
        if: { properties: { network: { const: "tcp" } } },
        then: {
          properties: {
            tcpSettings: {
              type: "object",
              additionalProperties: true,
              description: D(d, "pages.xray.jsonSchema.stream.tcpSettings", "Used when network is tcp."),
              properties: {
                acceptProxyProtocol: { type: "boolean" },
                header: {
                  type: "object",
                  properties: { type: { type: "string" } },
                },
              },
            },
          },
        },
      },
      {
        if: { properties: { network: { const: "kcp" } } },
        then: {
          properties: {
            kcpSettings: {
              type: "object",
              additionalProperties: true,
              description: D(d, "pages.xray.jsonSchema.stream.kcpSettings", "KCP options when network is kcp."),
            },
          },
        },
      },
      {
        if: { properties: { network: { const: "ws" } } },
        then: {
          properties: {
            wsSettings: {
              type: "object",
              additionalProperties: true,
              description: D(d, "pages.xray.jsonSchema.stream.wsSettings", "WebSocket path, headers"),
              properties: {
                path: { type: "string" },
                host: { type: "string" },
                headers: { type: "object", additionalProperties: { type: "string" } },
              },
            },
          },
        },
      },
      {
        if: { properties: { network: { const: "http" } } },
        then: {
          properties: {
            httpSettings: { type: "object", additionalProperties: true },
          },
        },
      },
      {
        if: { properties: { network: { const: "quic" } } },
        then: {
          properties: {
            quicSettings: {
              type: "object",
              additionalProperties: true,
              properties: {
                security: { type: "string" },
                key: { type: "string" },
                header: { type: "object" },
              },
            },
          },
        },
      },
      {
        if: { properties: { network: { const: "grpc" } } },
        then: {
          properties: {
            grpcSettings: {
              type: "object",
              additionalProperties: true,
              properties: {
                serviceName: { type: "string" },
                multiMode: { type: "boolean" },
                idleTimeout: { type: "integer" },
                healthCheckTimeout: { type: "integer" },
                permitWithoutStream: { type: "boolean" },
                initialWindowsSize: { type: "integer" },
              },
            },
          },
        },
      },
      {
        if: { properties: { network: { const: "xhttp" } } },
        then: {
          properties: { xhttpSettings: { type: "object", additionalProperties: true } },
        },
      },
      {
        if: { properties: { network: { const: "hysteria" } } },
        then: {
          properties: { hysteriaSettings: { type: "object", additionalProperties: true } },
        },
      },
      {
        if: { properties: { network: { const: "masque" } } },
        then: { properties: { masqueSettings: masqueSettingsSchema(d) } },
      },
      {
        if: { properties: { network: { const: "xdrive" } } },
        then: { properties: { xdriveSettings: xdriveSettingsSchema(d) } },
      },
      {
        if: { properties: { security: { const: "reality" } } },
        then: { properties: { realitySettings: realitySettingsSchema(d) } },
      },
      {
        if: { properties: { security: { const: "tls" } } },
        then: { properties: { tlsSettings: tlsSettingsSchema(d) } },
      },
      {
        if: { properties: { security: { const: "xtls" } } },
        then: { properties: { xtlsSettings: { type: "object", additionalProperties: true } } },
      },
    ],
  };
}
