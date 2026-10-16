import type { MonacoJsonSchemaEntry } from "@/lib/monacoJson";
import { luaScriptProperty } from "@/lib/xrayNewFeaturesMonacoSchema";
import { buildXrayStreamSettingsSchema } from "@/lib/xrayStreamSettingsMonacoSchema";

type TLike = (key: string, o?: { defaultValue: string }) => string;

const BASE = "https://sharx.internal/xray";

export function getXrayEditorFileName(section: string): string {
  const s = section.replace(/[^a-zA-Z0-9-]/g, "-");
  return `sharx-xray--${s || "section"}.json`;
}

function logProperties(d: TLike): Record<string, object> {
  return {
    loglevel: {
      type: "string",
      description: d("pages.xray.jsonSchema.logLoglevel", {
        defaultValue:
          "Granularity of stderr logging: debug, info, warning, error, none. Typical production: warning.",
      }),
    },
    error: {
      type: "string",
      description: d("pages.xray.jsonSchema.logError", {
        defaultValue: "Path to error log file, or \"none\" to disable file error logging.",
      }),
    },
    access: {
      type: "string",
      description: d("pages.xray.jsonSchema.logAccess", {
        defaultValue: "Path to access log file, or \"none\" to disable access logs.",
      }),
    },
    dnsLog: {
      type: "boolean",
      description: d("pages.xray.jsonSchema.logDnsLog", {
        defaultValue: "When true, DNS resolution activity is included in logging output.",
      }),
    },
    maskAddress: {
      type: "string",
      description: d("pages.xray.jsonSchema.logMaskAddress", {
        defaultValue:
          "Replace IP addresses in logs for privacy (Xray log masking). Empty string = no masking.",
      }),
    },
  };
}

/** Log object schema without $schema/title (for embedding in full config). */
function logValueSchema(d: TLike): object {
  return {
    type: "object",
    description: d("pages.xray.jsonSchema.logBlockDesc", {
      defaultValue: "Core logging: levels, log file paths, DNS log toggle, optional address masking.",
    }),
    additionalProperties: true,
    properties: logProperties(d),
  };
}

function buildLogSchema(d: TLike, title: string): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title,
    ...logValueSchema(d),
  };
}

function apiValueSchema(d: TLike): object {
  return {
    type: "object",
    description: d("pages.xray.jsonSchema.apiBlockDesc", {
      defaultValue:
        "gRPC API exposed via a dedicated inbound (often protocol \"tunnel\"). Enables remote stats and control.",
    }),
    additionalProperties: true,
    properties: {
      tag: {
        type: "string",
        description: d("pages.xray.jsonSchema.apiTag", {
          defaultValue: "Tag of the inbound that serves the API; routing rules often reference this tag.",
        }),
      },
      services: {
        type: "array",
        items: { type: "string" },
        description: d("pages.xray.jsonSchema.apiServices", {
          defaultValue:
            "Enabled gRPC services, e.g. HandlerService, LoggerService, StatsService, RoutingService, ObservatoryService.",
        }),
      },
    },
  };
}

function buildApiSchema(d: TLike, title: string): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title,
    ...apiValueSchema(d),
  };
}

function statsValueSchema(d: TLike): object {
  return {
    type: "object",
    description: d("pages.xray.jsonSchema.statsBlockDesc", {
      defaultValue:
        "Stats placeholder; counters are enabled via policy.* and consumed through StatsService / metrics.",
    }),
    additionalProperties: true,
  };
}

function buildStatsSchema(d: TLike, title: string): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title,
    ...statsValueSchema(d),
  };
}

function policyLevelProperties(d: TLike): Record<string, object> {
  return {
    statsUserUplink: {
      type: "boolean",
      description: d("pages.xray.jsonSchema.policyStatsUserUplink", {
        defaultValue: "Collect per-user upload (uplink) statistics for this user level.",
      }),
    },
    statsUserDownlink: {
      type: "boolean",
      description: d("pages.xray.jsonSchema.policyStatsUserDownlink", {
        defaultValue: "Collect per-user download (downlink) statistics for this user level.",
      }),
    },
    handshake: {
      type: "number",
      description: d("pages.xray.jsonSchema.policyHandshake", {
        defaultValue: "Handshake timeout in seconds for connections at this policy level.",
      }),
    },
    connIdle: {
      type: "number",
      description: d("pages.xray.jsonSchema.policyConnIdle", {
        defaultValue: "Idle connection timeout in seconds.",
      }),
    },
    uplinkOnly: {
      type: "boolean",
      description: d("pages.xray.jsonSchema.policyUplinkOnly", {
        defaultValue: "If true, only uplink is processed (rare; advanced).",
      }),
    },
    downlinkOnly: {
      type: "boolean",
      description: d("pages.xray.jsonSchema.policyDownlinkOnly", {
        defaultValue: "If true, only downlink is processed (rare; advanced).",
      }),
    },
    bufferSize: {
      type: "number",
      description: d("pages.xray.jsonSchema.policyBufferSize", {
        defaultValue: "Internal buffer size hint for this level (bytes).",
      }),
    },
  };
}

function policyValueSchema(d: TLike): object {
  return {
    type: "object",
    description: d("pages.xray.jsonSchema.policyBlockDesc", {
      defaultValue: "Connection policies: per-user level (e.g. \"0\") and global system stats toggles.",
    }),
    additionalProperties: true,
    properties: {
      levels: {
        type: "object",
        description: d("pages.xray.jsonSchema.policyLevels", {
          defaultValue:
            "Map of user level id (string, often \"0\") to limits and stats flags for that level.",
        }),
        additionalProperties: {
          type: "object",
          additionalProperties: true,
          properties: policyLevelProperties(d),
        },
      },
      system: {
        type: "object",
        description: d("pages.xray.jsonSchema.policySystem", {
          defaultValue: "Global statistics switches for all inbounds/outbounds.",
        }),
        additionalProperties: true,
        properties: {
          statsInboundUplink: {
            type: "boolean",
            description: d("pages.xray.jsonSchema.policySysInboundUp", {
              defaultValue: "Enable uplink stats aggregation for all inbounds.",
            }),
          },
          statsInboundDownlink: {
            type: "boolean",
            description: d("pages.xray.jsonSchema.policySysInboundDown", {
              defaultValue: "Enable downlink stats aggregation for all inbounds.",
            }),
          },
          statsOutboundUplink: {
            type: "boolean",
            description: d("pages.xray.jsonSchema.policySysOutboundUp", {
              defaultValue: "Enable uplink stats for all outbounds.",
            }),
          },
          statsOutboundDownlink: {
            type: "boolean",
            description: d("pages.xray.jsonSchema.policySysOutboundDown", {
              defaultValue: "Enable downlink stats for all outbounds.",
            }),
          },
        },
      },
    },
  };
}

function buildPolicySchema(d: TLike, title: string): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title,
    ...policyValueSchema(d),
  };
}

function routingRuleItem(d: TLike): object {
  return {
    type: "object",
    additionalProperties: true,
    description: d("pages.xray.jsonSchema.routingRuleDesc", {
      defaultValue:
        "One routing rule. First matching rule wins. type \"field\" matches on domain, ip, port, inboundTag, protocol, etc.",
    }),
    properties: {
      type: {
        type: "string",
        description: d("pages.xray.jsonSchema.routingRuleType", {
          defaultValue: "Usually \"field\" for matcher-based rules.",
        }),
      },
      domain: {
        type: "array",
        items: { type: "string" },
        description: d("pages.xray.jsonSchema.routingRuleDomain", {
          defaultValue: "Domain matchers: plain, regexp:, domain:, full:, geosite:...",
        }),
      },
      ip: {
        type: "array",
        items: { type: "string" },
        description: d("pages.xray.jsonSchema.routingRuleIp", {
          defaultValue: "CIDR or geoip:cn, geoip:private, etc.",
        }),
      },
      port: {
        type: "string",
        description: d("pages.xray.jsonSchema.routingRulePort", {
          defaultValue: "Destination port or range as string, e.g. \"443\" or \"1000-2000\".",
        }),
      },
      sourcePort: {
        type: "string",
        description: d("pages.xray.jsonSchema.routingRuleSourcePort", {
          defaultValue: "Client source port filter.",
        }),
      },
      network: {
        type: "string",
        description: d("pages.xray.jsonSchema.routingRuleNetwork", {
          defaultValue: "tcp, udp, or tcp,udp",
        }),
      },
      source: {
        type: "array",
        items: { type: "string" },
        description: d("pages.xray.jsonSchema.routingRuleSource", {
          defaultValue: "Source IP CIDR list.",
        }),
      },
      user: {
        type: "array",
        items: { type: "string" },
        description: d("pages.xray.jsonSchema.routingRuleUser", {
          defaultValue: "Inbound user emails / ids this rule applies to.",
        }),
      },
      inboundTag: {
        type: "array",
        items: { type: "string" },
        description: d("pages.xray.jsonSchema.routingRuleInboundTag", {
          defaultValue: "Restrict rule to specific inbound tag(s).",
        }),
      },
      outboundTag: {
        type: "string",
        description: d("pages.xray.jsonSchema.routingRuleOutboundTag", {
          defaultValue: "Send matching traffic to this outbound tag (or use balancerTag).",
        }),
      },
      balancerTag: {
        type: "string",
        description: d("pages.xray.jsonSchema.routingRuleBalancerTag", {
          defaultValue: "Send matching traffic to this load balancer.",
        }),
      },
      protocol: {
        type: "array",
        items: { type: "string" },
        description: d("pages.xray.jsonSchema.routingRuleProtocol", {
          defaultValue: "Layer-7 protocol sniffing result, e.g. bittorrent, http, tls.",
        }),
      },
      attrs: {
        type: "string",
        description: d("pages.xray.jsonSchema.routingRuleAttrs", {
          defaultValue: "Optional attribute expression (advanced).",
        }),
      },
      domainMatcher: {
        type: "string",
        description: d("pages.xray.jsonSchema.routingRuleDomainMatcher", {
          defaultValue: "hybrid, linear, mph — domain list matching algorithm.",
        }),
      },
    },
  };
}

function routingProperties(d: TLike): Record<string, object> {
  return {
    domainStrategy: {
      type: "string",
      description: d("pages.xray.jsonSchema.routingDomainStrategy", {
        defaultValue:
          "How domains are resolved for routing: AsIs, IPIfNonMatch, IPOnDemand (and variants).",
      }),
    },
    rules: {
      type: "array",
      items: routingRuleItem(d),
      description: d("pages.xray.jsonSchema.routingRules", {
        defaultValue: "Ordered rules; evaluation stops at the first match.",
      }),
    },
    balancers: {
      type: "array",
      description: d("pages.xray.jsonSchema.routingBalancers", {
        defaultValue: "Load balancers referenced by balancerTag in rules.",
      }),
    },
    script: luaScriptProperty(d),
  };
}

function routingValueSchema(d: TLike): object {
  return {
    type: "object",
    description: d("pages.xray.jsonSchema.routingRoot", {
      defaultValue: "domainStrategy, rules, balancers",
    }),
    additionalProperties: true,
    properties: routingProperties(d),
  };
}

function buildRoutingSchema(d: TLike, title: string): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title,
    ...routingValueSchema(d),
  };
}

function metricsValueSchema(d: TLike): object {
  return {
    type: "object",
    description: d("pages.xray.jsonSchema.metricsBlockDesc", {
      defaultValue: "Optional Prometheus / metrics listener for core statistics.",
    }),
    additionalProperties: true,
    properties: {
      tag: {
        type: "string",
        description: d("pages.xray.jsonSchema.metricsTag", {
          defaultValue: "Tag for the internal metrics outbound path.",
        }),
      },
      listen: {
        type: "string",
        description: d("pages.xray.jsonSchema.metricsListen", {
          defaultValue: "HTTP listen address, e.g. 127.0.0.1:11111",
        }),
      },
    },
  };
}

function buildMetricsSchema(d: TLike, title: string): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title,
    ...metricsValueSchema(d),
  };
}

function inboundSettingsSchema(d: TLike): object {
  return {
    type: "object",
    additionalProperties: true,
    description: d("pages.xray.jsonSchema.inboundSettings", {
      defaultValue:
        "Protocol-specific inbound settings. VMess/VLESS: clients[].id, alterId (VMess), flow (VLESS xtls). Trojan: clients[].password. Shadowsocks: method, password. WireGuard: secretKey, peers[], mtu. HTTP/SOCKS: accounts. dokodemo-door: address, port, network. tunnel (API): address to forward gRPC to.",
    }),
    properties: {
      address: {
        oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description: d("pages.xray.jsonSchema.inboundSettingsAddress", {
          defaultValue:
            "dokodemo-door target or tunnel forward address (often 127.0.0.1 for local API). masque: tunnel prefixes, e.g. [\"10.77.0.1/24\"].",
        }),
      },
      port: {
        type: "integer",
        description: d("pages.xray.jsonSchema.inboundSettingsPort", {
          defaultValue: "Target port for dokodemo-door / forwarding when applicable.",
        }),
      },
      network: {
        type: "string",
        description: d("pages.xray.jsonSchema.inboundSettingsNetwork", {
          defaultValue: "tcp, udp, tcp,udp — for dokodemo-door and similar.",
        }),
      },
      clients: {
        type: "array",
        description: d("pages.xray.jsonSchema.inboundSettingsClients", {
          defaultValue: "User entries for VMess, VLESS, Trojan, etc.",
        }),
      },
      method: {
        type: "string",
        description: d("pages.xray.jsonSchema.inboundSettingsMethod", {
          defaultValue: "Shadowsocks encryption method (e.g. aes-128-gcm).",
        }),
      },
      password: {
        type: "string",
        description: d("pages.xray.jsonSchema.inboundSettingsPassword", {
          defaultValue: "Shadowsocks password or shared secret where applicable.",
        }),
      },
      secretKey: {
        type: "string",
        description: d("pages.xray.jsonSchema.inboundSettingsSecretKey", {
          defaultValue: "WireGuard server private key (base64).",
        }),
      },
      peers: {
        type: "array",
        description: d("pages.xray.jsonSchema.inboundSettingsPeers", {
          defaultValue: "WireGuard peer definitions (publicKey, allowedIPs, etc.).",
        }),
      },
      decryption: {
        type: "string",
        description: d("pages.xray.jsonSchema.inboundSettingsDecryption", {
          defaultValue: "VLESS server decryption mode (e.g. none).",
        }),
      },
      fallbacks: {
        type: "array",
        description: d("pages.xray.jsonSchema.inboundSettingsFallbacks", {
          defaultValue: "TCP fallbacks when TLS ALPN/SNI multiplexing is used.",
        }),
      },
    },
  };
}

function outboundSettingsSchema(d: TLike): object {
  return {
    type: "object",
    additionalProperties: true,
    description: d("pages.xray.jsonSchema.outboundSettings", {
      defaultValue:
        "Protocol-specific outbound settings. VLESS/VMess: vnext[] with address, port, users. Trojan/Shadowsocks: servers[]. WireGuard: secretKey, address[], peers. HTTP: servers. freedom: domainStrategy (AsIs, UseIP, …), redirect, noises. blackhole: response type. dns: network, address. loopback: inboundTag.",
    }),
    properties: {
      domainStrategy: {
        type: "string",
        description: d("pages.xray.jsonSchema.outFreedomDomainStrategy", {
          defaultValue: "freedom only: AsIs, UseIP, UseIPv4, UseIPv6, …",
        }),
      },
      redirect: {
        type: "string",
        description: d("pages.xray.jsonSchema.outFreedomRedirect", {
          defaultValue: "freedom: optional address rewrite (advanced).",
        }),
      },
      noises: {
        type: "array",
        description: d("pages.xray.jsonSchema.outFreedomNoises", {
          defaultValue: "freedom: noise injection entries {type, packet, delay, …}.",
        }),
      },
      response: {
        type: "object",
        description: d("pages.xray.jsonSchema.outBlackholeResponse", {
          defaultValue: "blackhole: {type: none|http|tcp}",
        }),
      },
      vnext: {
        type: "array",
        description: d("pages.xray.jsonSchema.outVnext", {
          defaultValue: "VMess/VLESS remote endpoints and user objects.",
        }),
      },
      servers: {
        type: "array",
        description: d("pages.xray.jsonSchema.outServers", {
          defaultValue: "Trojan, Shadowsocks, HTTP outbound server list.",
        }),
      },
      secretKey: {
        type: "string",
        description: d("pages.xray.jsonSchema.outWgSecretKey", {
          defaultValue: "WireGuard client private key.",
        }),
      },
      address: {
        oneOf: [{ type: "array", items: { type: "string" } }, { type: "string" }],
        description: d("pages.xray.jsonSchema.outWgAddress", {
          defaultValue: "WireGuard tunnel interface IPs (CIDR); masque: server host (string).",
        }),
      },
      remoteDNS: {
        type: "array",
        items: { type: "string" },
        description: d("pages.xray.jsonSchema.outRemoteDns", {
          defaultValue: 'wireguard / masque: DNS server IPs inside the tunnel. wireguard "local" was removed in Xray 26.9.30.',
        }),
      },
      peers: {
        type: "array",
        description: d("pages.xray.jsonSchema.outWgPeers", {
          defaultValue: "WireGuard peers (endpoint, publicKey, keepAlive, …).",
        }),
      },
      inboundTag: {
        type: "string",
        description: d("pages.xray.jsonSchema.outLoopbackInboundTag", {
          defaultValue: "loopback only: tag of the inbound whose traffic is re-injected into routing.",
        }),
      },
    },
  };
}

const outboundObject = (d: TLike) => ({
  type: "object" as const,
  additionalProperties: true,
  properties: {
    tag: {
      type: "string",
      description: d("pages.xray.jsonSchema.outboundTag", { defaultValue: "Unique tag used by routing." }),
    },
    protocol: {
      type: "string",
      description: d("pages.xray.jsonSchema.outboundProtocol", {
        defaultValue:
          "Outbounds: vmess, vless, trojan, shadowsocks, shadowsocks-2022, socks, http, wireguard, masque (Xray ≥ 26.9.30), freedom, blackhole, dns, loopback, hysteria, …",
      }),
    },
    sendThrough: {
      type: "string",
      description: d("pages.xray.jsonSchema.outboundSendThrough", {
        defaultValue: "Optional source IP address to bind outbound sockets.",
      }),
    },
    settings: outboundSettingsSchema(d),
    streamSettings: buildXrayStreamSettingsSchema(d),
    mux: {
      type: "object",
      description: d("pages.xray.jsonSchema.outboundMux", {
        defaultValue: "SMUX / mux: { enabled, concurrency, … } to combine streams.",
      }),
    },
  },
  required: ["protocol"],
});

const inboundObject = (d: TLike) => ({
  type: "object" as const,
  additionalProperties: true,
  properties: {
    tag: {
      type: "string",
      description: d("pages.xray.jsonSchema.inboundTag", { defaultValue: "Listener tag" }),
    },
    port: {
      oneOf: [{ type: "integer" }, { type: "string" }],
      description: d("pages.xray.jsonSchema.inboundPort", {
        defaultValue: "Listen port. Use 0 or omit with dokodemo/tunnel depending on template.",
      }),
    },
    listen: {
      type: "string",
      description: d("pages.xray.jsonSchema.inboundListen", { defaultValue: "Bind address" }),
    },
    protocol: {
      type: "string",
      description: d("pages.xray.jsonSchema.inboundProtocol", {
        defaultValue:
          "Inbounds: vmess, vless, trojan, shadowsocks, shadowsocks-2022, socks, http, wireguard, masque (Xray ≥ 26.9.30), dokodemo-door, tunnel (API), hysteria, …",
      }),
    },
    settings: inboundSettingsSchema(d),
    streamSettings: buildXrayStreamSettingsSchema(d),
    sniffing: {
      type: "object",
      description: d("pages.xray.jsonSchema.inboundSniffing", {
        defaultValue: "Traffic sniffing: { enabled, destOverride: [\"http\",\"tls\",\"quic\",\"fakedns\"], metadataOnly, routeOnly }.",
      }),
    },
    allocate: {
      type: "object",
      description: d("pages.xray.jsonSchema.inboundAllocate", {
        defaultValue: "Port allocation strategy: { strategy: \"always\", refresh: 5, concurrency: 3 }.",
      }),
    },
  },
});

function fullTemplate(d: TLike): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Xray / sing-box config template",
    description: d("pages.xray.jsonSchema.root", {
      defaultValue:
        "Full Xray config: log, api, dns, routing, policy, stats, metrics, inbounds, outbounds. Unknown keys are allowed (additionalProperties).",
    }),
    type: "object",
    additionalProperties: true,
    properties: {
      log: {
        ...logValueSchema(d),
        description: d("pages.xray.jsonSchema.log", {
          defaultValue: "Logging: loglevel, error, access, dnsLog, maskAddress",
        }),
      },
      api: apiValueSchema(d),
      stats: statsValueSchema(d),
      policy: policyValueSchema(d),
      dns: {
        type: "object",
        description: d("pages.xray.jsonSchema.dns", { defaultValue: "dns servers, clientIp, queryStrategy" }),
        additionalProperties: true,
        properties: { script: luaScriptProperty(d) },
      },
      fakedns: { type: "object" },
      inbounds: {
        type: "array",
        items: inboundObject(d),
        description: d("pages.xray.jsonSchema.inbounds", { defaultValue: "List of inbounds" }),
      },
      outbounds: {
        type: "array",
        items: outboundObject(d),
        description: d("pages.xray.jsonSchema.outbounds", { defaultValue: "List of outbounds" }),
      },
      routing: routingValueSchema(d),
      transport: { type: "object" },
      reverse: { type: "object" },
      observatory: { type: "object" },
      metrics: metricsValueSchema(d),
    },
  };
}

/**
 * A single entry for the active editor so validation matches the slice (full document vs one top-level value).
 */
export function getXrayMonacoEntryForSection(section: string, d: TLike): { uri: string; fileName: string; schema: object } {
  const fileName = getXrayEditorFileName(section);
  const uri = `${BASE}/section/${encodeURIComponent(section)}.json`;
  if (section === "full") {
    return { uri, fileName, schema: fullTemplate(d) };
  }
  if (section === "outbounds") {
    return {
      uri,
      fileName,
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "outbounds",
        description: d("pages.xray.jsonSchema.outboundsRoot", { defaultValue: "Array of outbound objects." }),
        type: "array",
        items: outboundObject(d),
      },
    };
  }
  if (section === "inbounds") {
    return {
      uri,
      fileName,
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "inbounds",
        description: d("pages.xray.jsonSchema.inboundsRoot", {
          defaultValue: "Array of inbound listeners (users, API tunnel, wireguard, …).",
        }),
        type: "array",
        items: inboundObject(d),
      },
    };
  }
  if (section === "dns") {
    return {
      uri,
      fileName,
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: "dns",
        type: "object",
        description: d("pages.xray.jsonSchema.dnsRoot", { defaultValue: "DNS servers, hosts, clientIp" }),
        additionalProperties: true,
        properties: {
          servers: { type: "array" },
          hosts: { type: "object" },
          clientIp: { type: "string" },
          queryStrategy: { type: "string" },
          script: luaScriptProperty(d),
        },
      },
    };
  }
  if (section === "routing") {
    return { uri, fileName, schema: buildRoutingSchema(d, "routing") };
  }
  if (section === "log") {
    return { uri, fileName, schema: buildLogSchema(d, "log") };
  }
  if (section === "api") {
    return { uri, fileName, schema: buildApiSchema(d, "api") };
  }
  if (section === "stats") {
    return { uri, fileName, schema: buildStatsSchema(d, "stats") };
  }
  if (section === "policy") {
    return { uri, fileName, schema: buildPolicySchema(d, "policy") };
  }
  if (section === "metrics") {
    return { uri, fileName, schema: buildMetricsSchema(d, "metrics") };
  }
  if (section === "transport" || section === "reverse" || section === "fakedns" || section === "observatory" || section === "burstObservatory") {
    return {
      uri,
      fileName,
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: section,
        type: "object",
        description: d("pages.xray.jsonSchema.genericSection", {
          defaultValue: "Xray section object; see project docs for keys.",
        }),
        additionalProperties: true,
      },
    };
  }
  return {
    uri,
    fileName,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      title: section,
      description: d("pages.xray.jsonSchema.unknownSection", {
        defaultValue: "JSON object or array for this Xray template key. See v2ray docs for structure.",
      }),
      additionalProperties: true,
    },
  };
}

export function toMonacoEntry(entry: { uri: string; fileName: string; schema: object }): MonacoJsonSchemaEntry {
  return { uri: entry.uri, fileMatch: [entry.fileName], schema: entry.schema };
}
