import { describe, expect, it } from "vitest";
import { roundTripInboundStreamSettings } from "./inboundJsonSanitize";
import {
  buildFinalmask,
  emptyFinalmaskState,
  fmSupportedInLink,
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
  });

  it("flags multiple socket masks and udphop on an inbound", () => {
    const codes = validateFinalmask(
      fmState({
        finalmaskUdp: [
          { type: "udphop", settings: { interval: 3, remoteIPs: ["1.2.3.4"], remotePorts: ["443"] } },
          { type: "xicmp", settings: {} },
        ],
      }),
    ).map((i) => i.code);
    expect(codes).toContain("udphop_client_only");
    expect(codes).toContain("udphop_interval");
    expect(codes).toContain("multiple_socket_masks");
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

describe("fmSupportedInLink", () => {
  it("matches the subscription link whitelist", () => {
    expect(fmSupportedInLink("fragment", "tcp")).toBe(true);
    expect(fmSupportedInLink("filter", "tcp")).toBe(false);
    expect(fmSupportedInLink("salamander", "udp")).toBe(true);
    expect(fmSupportedInLink("noise", "udp")).toBe(false);
  });
});
