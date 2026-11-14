import { describe, expect, it } from "vitest";
import { roundTripInboundStreamSettings } from "./inboundJsonSanitize";
import {
  buildFinalmask,
  countFinalmaskMasksOutsideEditor,
  emptyFinalmaskState,
  finalmaskSidesFor,
  fmSupportedInLink,
  orderFinalmaskUdp,
  parseFinalmask,
  validateFinalmask,
  type FinalmaskState,
} from "./finalmaskDefaults";
import { parseStreamSettingsToForm, buildStreamSettingsFromForm } from "./inboundDefaults";

function fmState(partial: Partial<FinalmaskState>): FinalmaskState {
  return { ...emptyFinalmaskState(), ...partial };
}

describe("finalmask round-trip", () => {
  it("keeps tcp/udp masks and quicParams for a non-hysteria protocol", () => {
    const stream = {
      network: "tcp",
      security: "none",
      finalmask: {
        tcp: [
          { type: "header-custom", settings: { packet: { type: "tls" } } },
          { type: "fragment", settings: { lengths: ["100-200"], delays: ["1-2"] } },
        ],
        udp: [{ type: "noise", settings: { noise: [{ type: "str", packet: "hello" }] } }],
        quicParams: { congestion: "bbr", bbrProfile: "aggressive" },
      },
    };
    const r = roundTripInboundStreamSettings(JSON.stringify(stream), "vless");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strippedKeys).not.toContain("finalmask");
    const after = JSON.parse(r.json) as Record<string, unknown>;
    expect(after.finalmask).toEqual(stream.finalmask);
  });

  it("preserves unknown/advanced settings keys inside a mask", () => {
    const stream = {
      network: "tcp",
      security: "none",
      finalmask: {
        tcp: [{ type: "sudoku", settings: { password: "pw", customAdvancedKey: { nested: [1, 2] } } }],
      },
    };
    const r = roundTripInboundStreamSettings(JSON.stringify(stream), "vmess");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = JSON.parse(r.json) as { finalmask: { tcp: { settings: Record<string, unknown> }[] } };
    expect(after.finalmask.tcp[0].settings.customAdvancedKey).toEqual({ nested: [1, 2] });
    expect(r.strippedKeys).toEqual([]);
  });

  it("keeps non-UI masks untouched through parse → build", () => {
    const state = fmState({
      finalmaskTcp: [
        { type: "header-custom", settings: { packet: { type: "tls" } } },
        { type: "sudoku", settings: { password: "pw" } },
        { type: "xmc", settings: { hostname: "mc.example.com", password: "p", profiles: [] } },
        { type: "filter", settings: { custom: true } },
        { type: "fragment", settings: { lengths: ["100-200"] } },
      ],
      finalmaskUdp: [
        { type: "mkcp-legacy", settings: { header: "dtls" } },
        { type: "noise", settings: { noise: [{ type: "str", packet: "hello" }] } },
        { type: "xdns", settings: { domains: [{ names: ["example.com"] }] } },
        { type: "realm", settings: { url: "realm://example.com", stunServers: ["s:3478"] } },
        { type: "salamander", settings: { password: "strongpsk" } },
        { type: "xicmp", settings: {} },
      ],
      finalmaskQuicParams: '{"congestion":"bbr"}',
    });
    const built = buildFinalmask(state) as Record<string, unknown>;
    expect(countFinalmaskMasksOutsideEditor(state)).toBe(9);
    expect(parseFinalmask({ finalmask: built })).toEqual({
      tcp: state.finalmaskTcp,
      udp: state.finalmaskUdp,
      quicParams: JSON.stringify({ congestion: "bbr" }, null, 2),
    });
  });

  it("keeps salamander + extra masks and custom quicParams for hysteria2", () => {
    const stream = {
      network: "hysteria",
      security: "tls",
      finalmask: {
        udp: [
          { type: "salamander", settings: { password: "strongpsk" } },
          { type: "sudoku", settings: { password: "pw" } },
          { type: "xicmp", settings: {} },
        ],
        quicParams: { congestion: "brutal", bbrProfile: "aggressive" },
      },
    };
    const r = roundTripInboundStreamSettings(JSON.stringify(stream), "hysteria2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = JSON.parse(r.json) as { finalmask: { udp: { type: string }[]; quicParams: Record<string, unknown> } };
    const salamanders = after.finalmask.udp.filter((x) => x.type === "salamander");
    expect(salamanders).toHaveLength(1);
    expect(after.finalmask.udp.map((x) => x.type)).toEqual(["salamander", "sudoku", "xicmp"]);
    expect(after.finalmask.quicParams).toEqual({ congestion: "brutal", bbrProfile: "aggressive" });
  });

  it("still emits salamander from the legacy hysteria obfuscation selector", () => {
    const form = parseStreamSettingsToForm(
      JSON.stringify({ network: "hysteria", security: "tls" }),
      "hysteria2",
    );
    form.hysteriaObfsType = "salamander";
    form.hysteriaObfsPassword = "strongpsk";
    const rebuilt = JSON.parse(buildStreamSettingsFromForm(form, "hysteria2")) as {
      finalmask: { udp: { type: string; settings: { password: string } }[] };
    };
    expect(rebuilt.finalmask.udp).toEqual([
      { type: "salamander", settings: { password: "strongpsk" } },
    ]);
  });

  it("syncs the hysteria Obfuscation password into the existing salamander mask", () => {
    const form = parseStreamSettingsToForm(
      JSON.stringify({
        network: "hysteria",
        security: "tls",
        finalmask: {
          udp: [
            { type: "salamander", settings: { password: "oldpsk", packetSize: "1200-1400" } },
            { type: "udphop", settings: { mode: "intervalremote", interval: 30, remoteIPs: ["1.2.3.4"], remotePorts: "443" } },
          ],
        },
      }),
      "hysteria2",
    );
    expect(form.hysteriaObfsType).toBe("salamander");
    expect(form.hysteriaObfsPassword).toBe("oldpsk");

    form.hysteriaObfsPassword = "newpsk";
    const rebuilt = JSON.parse(buildStreamSettingsFromForm(form, "hysteria2")) as {
      finalmask: { udp: { type: string; settings: Record<string, unknown> }[] };
    };
    const udp = rebuilt.finalmask.udp;
    expect(udp.filter((x) => x.type === "salamander")).toHaveLength(1);
    expect(udp[0]).toEqual({
      type: "salamander",
      settings: { password: "newpsk", packetSize: "1200-1400" },
    });
    expect(udp[udp.length - 1].type).toBe("udphop");
  });

  it("drops the salamander mask when hysteria obfuscation is turned off", () => {
    const form = parseStreamSettingsToForm(
      JSON.stringify({
        network: "hysteria",
        security: "tls",
        finalmask: { udp: [{ type: "salamander", settings: { password: "strongpsk" } }] },
      }),
      "hysteria2",
    );
    form.hysteriaObfsType = "";
    form.hysteriaObfsPassword = "";
    const rebuilt = JSON.parse(buildStreamSettingsFromForm(form, "hysteria2")) as {
      finalmask?: { udp?: unknown[] };
    };
    expect(rebuilt.finalmask?.udp).toBeUndefined();
  });
});

describe("finalmaskSidesFor (transport matrix)", () => {
  const cases: Array<{
    protocol: string;
    network: string;
    security?: string;
    alpn?: string | string[];
    want: { tcp: boolean; udp: boolean };
  }> = [
    { protocol: "vless", network: "tcp", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "raw", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "ws", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "websocket", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "httpupgrade", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "grpc", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "kcp", want: { tcp: false, udp: true } },
    { protocol: "vless", network: "mkcp", want: { tcp: false, udp: true } },
    {
      protocol: "vless",
      network: "xhttp",
      security: "tls",
      alpn: "http/1.1",
      want: { tcp: true, udp: false },
    },
    {
      protocol: "vless",
      network: "splithttp",
      security: "tls",
      alpn: "h2",
      want: { tcp: true, udp: false },
    },
    // Empirical: xhttp + TLS + exactly ["h3"] dials FinalMask.DialUDP.
    {
      protocol: "vless",
      network: "xhttp",
      security: "tls",
      alpn: "h3",
      want: { tcp: false, udp: true },
    },
    {
      protocol: "vless",
      network: "xhttp",
      security: "tls",
      alpn: ["h3"],
      want: { tcp: false, udp: true },
    },
    // The kernel compares ALPN case-sensitively: "H3" stays on the TCP path.
    {
      protocol: "vless",
      network: "xhttp",
      security: "tls",
      alpn: ["H3"],
      want: { tcp: true, udp: false },
    },
    {
      protocol: "vless",
      network: "xhttp",
      security: "tls",
      alpn: "H3",
      want: { tcp: true, udp: false },
    },
    // h3 is only accepted as the single ALPN token; anything else keeps the TCP path.
    {
      protocol: "vless",
      network: "xhttp",
      security: "tls",
      alpn: "h2,h3-29",
      want: { tcp: true, udp: false },
    },
    {
      protocol: "vless",
      network: "xhttp",
      security: "tls",
      alpn: ["h3", "h2"],
      want: { tcp: true, udp: false },
    },
    // h3 without TLS is impossible: ALPN is ignored.
    { protocol: "vless", network: "xhttp", security: "none", alpn: "h3", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "xhttp", alpn: "h3", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "quic", want: { tcp: false, udp: false } },
    { protocol: "vless", network: "h2", want: { tcp: false, udp: false } },
    { protocol: "vless", network: "h3", want: { tcp: false, udp: false } },
    { protocol: "vless", network: "http", want: { tcp: false, udp: false } },
    { protocol: "hysteria", network: "tcp", alpn: "h3", want: { tcp: false, udp: true } },
    { protocol: "hysteria2", network: "kcp", want: { tcp: false, udp: true } },
    // The kernel supports UDP masks on wireguard; the inbound form still hides the block.
    { protocol: "wireguard", network: "tcp", want: { tcp: false, udp: true } },
    { protocol: "amneziawg", network: "ws", want: { tcp: false, udp: false } },
    { protocol: "telemt", network: "tcp", want: { tcp: false, udp: false } },
    { protocol: "vless", network: "masque", want: { tcp: true, udp: true } },
    { protocol: "vless", network: "xdrive", want: { tcp: true, udp: false } },
    { protocol: "vless", network: "", want: { tcp: true, udp: false } },
  ];

  it.each(cases)(
    "$protocol/$network security=$security alpn=$alpn",
    ({ protocol, network, security, alpn, want }) => {
      expect(finalmaskSidesFor({ protocol, network, security, alpn })).toEqual(want);
    },
  );
});

describe("udp[] ordering", () => {
  it("puts socket-replacing masks last without mutating the input", () => {
    const udp = [
      { type: "udphop", settings: { mode: "intervalremote" } },
      { type: "salamander", settings: { password: "strongpsk" } },
      { type: "noise", settings: { noise: [] } },
    ];
    expect(orderFinalmaskUdp(udp).map((x) => x.type)).toEqual(["salamander", "noise", "udphop"]);
    expect(udp.map((x) => x.type)).toEqual(["udphop", "salamander", "noise"]);
  });

  it("orders udp[] during build", () => {
    const built = buildFinalmask(
      fmState({
        finalmaskUdp: [
          { type: "udphop", settings: { mode: "intervalremote", interval: 30, remoteIPs: ["1.2.3.4"], remotePorts: "443" } },
          { type: "salamander", settings: { password: "strongpsk" } },
        ],
      }),
    ) as { udp: { type: string }[] };
    expect(built.udp.map((x) => x.type)).toEqual(["salamander", "udphop"]);
  });
});

describe("countFinalmaskMasksOutsideEditor", () => {
  it("counts only masks the compact editor does not render", () => {
    expect(
      countFinalmaskMasksOutsideEditor(
        fmState({
          finalmaskTcp: [{ type: "fragment", settings: { lengths: ["100-200"] } }],
          finalmaskUdp: [
            { type: "salamander", settings: { password: "strongpsk" } },
            { type: "udphop", settings: {} },
          ],
        }),
      ),
    ).toBe(0);
    expect(
      countFinalmaskMasksOutsideEditor(
        fmState({
          finalmaskTcp: [{ type: "sudoku", settings: { password: "pw" } }],
          finalmaskUdp: [
            { type: "noise", settings: {} },
            { type: "xicmp", settings: {} },
          ],
        }),
      ),
    ).toBe(3);
  });

  it("counts masks on a hidden transport side and duplicate UI types", () => {
    const state = fmState({
      finalmaskTcp: [
        { type: "fragment", settings: { lengths: ["100-200"] } },
        { type: "fragment", settings: { lengths: ["150-250"] } },
      ],
      finalmaskUdp: [{ type: "salamander", settings: { password: "strongpsk" } }],
    });
    // Only the first fragment card is editable on TCP.
    expect(countFinalmaskMasksOutsideEditor(state)).toBe(1);
    // On kcp the whole TCP side is hidden.
    expect(countFinalmaskMasksOutsideEditor(state, { protocol: "vless", network: "kcp" })).toBe(2);
  });
});

describe("parseFinalmask / buildFinalmask", () => {
  it("reads a bare finalmask object and returns a pretty quicParams string", () => {
    const parsed = parseFinalmask({
      finalmask: {
        tcp: [{ type: "sudoku", settings: { password: "pw" } }],
        quicParams: { congestion: "bbr" },
      },
    });
    expect(parsed.tcp).toEqual([{ type: "sudoku", settings: { password: "pw" } }]);
    expect(parsed.udp).toEqual([]);
    expect(JSON.parse(parsed.quicParams)).toEqual({ congestion: "bbr" });
  });

  it("returns undefined for empty state and a full object otherwise", () => {
    expect(buildFinalmask(emptyFinalmaskState())).toBeUndefined();
    expect(
      buildFinalmask(
        fmState({
          finalmaskTcp: [{ type: "sudoku", settings: { password: "pw" } }],
          finalmaskQuicParams: '{"congestion":"bbr"}',
        }),
      ),
    ).toEqual({
      tcp: [{ type: "sudoku", settings: { password: "pw" } }],
      quicParams: { congestion: "bbr" },
    });
  });
});

describe("validateFinalmask", () => {
  it("accepts valid masks", () => {
    expect(
      validateFinalmask(
        fmState({
          finalmaskTcp: [{ type: "fragment", settings: { lengths: ["100-200"] } }],
          finalmaskUdp: [
            { type: "salamander", settings: { password: "strongpsk" } },
            { type: "xicmp", settings: {} },
          ],
          finalmaskQuicParams: '{"congestion":"brutal"}',
        }),
      ),
    ).toEqual([]);
  });

  it("accepts udphop on an inbound (client-side mask kept for share links)", () => {
    expect(
      validateFinalmask(
        fmState({
          finalmaskUdp: [
            {
              type: "udphop",
              settings: {
                mode: "intervalremote",
                interval: 30,
                remoteIPs: ["1.2.3.4", "10.0.0.0/24"],
                remotePorts: "20000-30000",
              },
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("flags unknown types, missing required fields and socket ordering", () => {
    const issues = validateFinalmask(
      fmState({
        finalmaskTcp: [{ type: "lua", settings: {} }],
        finalmaskUdp: [
          { type: "xicmp", settings: {} },
          { type: "salamander", settings: { password: "abc" } },
          { type: "realm", settings: { url: "https://x", stunServers: [] } },
        ],
      }),
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("unknown_type");
    expect(codes).toContain("socket_mask_order");
    expect(codes).toContain("salamander_password");
    expect(codes).toContain("realm_url_scheme");
    expect(codes).toContain("realm_stun_required");
    expect(codes).not.toContain("udphop_client_only");
  });

  it("flags multiple socket masks and invalid udphop fields", () => {
    const codes = validateFinalmask(
      fmState({
        finalmaskUdp: [
          { type: "udphop", settings: { mode: "bogus", interval: 3, remoteIPs: ["nope"], remotePorts: "443-abc" } },
          { type: "xicmp", settings: {} },
        ],
      }),
    ).map((i) => i.code);
    expect(codes).toContain("udphop_mode");
    expect(codes).toContain("udphop_interval");
    expect(codes).toContain("udphop_remote_ips_format");
    expect(codes).toContain("udphop_remote_ports_format");
    expect(codes).toContain("multiple_socket_masks");
  });

  it("validates fragment packets/maxSplit and salamander packetSize", () => {
    const codes = validateFinalmask(
      fmState({
        finalmaskTcp: [
          { type: "fragment", settings: { lengths: ["100-200"], packets: "tlshello", maxSplit: "10-20" } },
        ],
        finalmaskUdp: [{ type: "salamander", settings: { password: "strongpsk", packetSize: "1200-1400" } }],
      }),
    ).map((i) => i.code);
    expect(codes).toEqual([]);

    const bad = validateFinalmask(
      fmState({
        finalmaskTcp: [{ type: "fragment", settings: { lengths: ["100-200"], packets: "abc", maxSplit: "-1" } }],
        finalmaskUdp: [{ type: "salamander", settings: { password: "strongpsk", packetSize: "0-4096" } }],
      }),
    ).map((i) => i.code);
    expect(bad).toEqual(expect.arrayContaining(["fragment_packets", "fragment_max_split", "salamander_packet_size"]));
  });

  it("validates quicParams enums and positive numbers", () => {
    const codes = validateFinalmask(
      fmState({ finalmaskQuicParams: '{"congestion":"cubic","bbrProfile":"insane","maxIdleTimeout":0}' }),
    ).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(["quic_congestion", "quic_bbr_profile", "quic_number_positive"]),
    );
  });

  it("reports invalid quicParams JSON", () => {
    const codes = validateFinalmask(fmState({ finalmaskQuicParams: "{not json" })).map((i) => i.code);
    expect(codes).toContain("quic_params_json");
  });
});

describe("validateFinalmask transport gate", () => {
  const fragment = { type: "fragment", settings: { lengths: ["100-200"] } };
  const noise = { type: "noise", settings: { noise: [{ type: "str", packet: "hello" }] } };

  it("allows masks on a compatible transport", () => {
    expect(
      validateFinalmask(fmState({ finalmaskTcp: [fragment] }), { protocol: "vless", network: "tcp" }),
    ).toEqual([]);
    expect(
      validateFinalmask(fmState({ finalmaskUdp: [noise] }), { protocol: "vless", network: "kcp" }),
    ).toEqual([]);
    expect(
      validateFinalmask(fmState({ finalmaskUdp: [noise] }), { protocol: "hysteria2", network: "tcp" }),
    ).toEqual([]);
    expect(
      validateFinalmask(fmState({ finalmaskUdp: [noise] }), {
        protocol: "wireguard",
        network: "tcp",
      }),
    ).toEqual([]);
  });

  it("rejects tcp masks on kcp and udp masks on tcp", () => {
    expect(
      validateFinalmask(fmState({ finalmaskTcp: [fragment] }), { protocol: "vless", network: "kcp" }).map((i) => i.code),
    ).toContain("transport_tcp_forbidden");
    expect(
      validateFinalmask(fmState({ finalmaskUdp: [noise] }), { protocol: "vless", network: "ws" }).map((i) => i.code),
    ).toContain("transport_udp_forbidden");
  });

  it("rejects any mask on removed transports", () => {
    for (const network of ["quic", "h2", "h3", "http"]) {
      const codes = validateFinalmask(fmState({ finalmaskTcp: [fragment] }), {
        protocol: "vless",
        network,
      }).map((i) => i.code);
      expect(codes).toContain("transport_unsupported");
    }
  });

  it("allows UDP masks and rejects TCP masks for xhttp on QUIC (TLS + exact h3)", () => {
    const quic = { protocol: "vless", network: "xhttp", security: "tls", alpn: "h3" };
    expect(validateFinalmask(fmState({ finalmaskUdp: [noise] }), quic)).toEqual([]);
    expect(
      validateFinalmask(fmState({ finalmaskTcp: [fragment] }), quic).map((i) => i.code),
    ).toContain("transport_tcp_on_quic");

    // Any other ALPN keeps the TCP path: TCP masks are fine, UDP masks are not.
    for (const query of [
      { ...quic, alpn: "h2,h3" },
      { ...quic, alpn: ["h3", "h2"] },
      { ...quic, alpn: ["H3"] },
      { ...quic, security: "none" },
    ]) {
      expect(validateFinalmask(fmState({ finalmaskTcp: [fragment] }), query)).toEqual([]);
      expect(
        validateFinalmask(fmState({ finalmaskUdp: [noise] }), query).map((i) => i.code),
      ).toContain("transport_udp_forbidden");
    }
  });

  it("rejects tcp masks for sidecar protocols", () => {
    const codes = validateFinalmask(fmState({ finalmaskTcp: [fragment] }), {
      protocol: "wireguard",
      network: "tcp",
    }).map((i) => i.code);
    expect(codes).toContain("transport_tcp_forbidden");
    for (const protocol of ["amneziawg", "telemt"]) {
      expect(
        validateFinalmask(fmState({ finalmaskUdp: [noise] }), { protocol, network: "tcp" }).map(
          (i) => i.code,
        ),
      ).toContain("transport_udp_forbidden");
    }
  });

  it("does not gate an empty finalmask", () => {
    expect(validateFinalmask(emptyFinalmaskState(), { protocol: "vless", network: "h3" })).toEqual([]);
  });
});

describe("fmSupportedInLink", () => {
  it("matches the subscription link whitelist", () => {
    expect(fmSupportedInLink("fragment", "tcp")).toBe(true);
    expect(fmSupportedInLink("filter", "tcp")).toBe(false);
    expect(fmSupportedInLink("salamander", "udp")).toBe(true);
    expect(fmSupportedInLink("noise", "udp")).toBe(false);
  });
});
