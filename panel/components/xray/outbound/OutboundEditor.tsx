"use client";

import type { TFunction } from "i18next";
import { useMemo, type ReactNode } from "react";
import { TagChipsInput } from "@/components/xray/routing/TagChipsInput";
import {
  AddButton,
  Card,
  Disclosure,
  EmptyNote,
  Field,
  FieldGrid,
  JsonArea,
  NumberField,
  RowActions,
  SelectField,
  SubSection,
  TextField,
  ToggleChip,
  ToggleRow,
  makeTr,
  moveItem,
  type Tr,
} from "@/components/xray/configurator/fields";
import { getPath, isRec, listAt, setPath, strAt, type Path, type Rec } from "@/lib/jsonPath";
import {
  OUTBOUND_STREAM_NETWORK_OPTIONS,
  OUTBOUND_VLESS_FLOW_OPTIONS,
  effectiveVlessOutboundFlow,
  vlessOutboundFlowAllowed,
} from "@/lib/xrayOutboundForm";

type Props = {
  raw: Rec;
  onRaw: (next: Rec) => void;
  protocol: string;
  readOnly: boolean;
  t: TFunction;
  /** Tags of the other outbounds (for dialerProxy chaining). */
  otherOutboundTags: string[];
  /** Known inbound tags (loopback target). */
  inboundTags: string[];
};

const PROXY_PROTOCOLS = ["vless", "vmess", "trojan", "shadowsocks", "socks", "http"];
const FINGERPRINTS = ["", "chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized", "randomizednoalpn", "unsafe"];
const SS_METHODS = [
  "aes-256-gcm",
  "aes-128-gcm",
  "chacha20-ietf-poly1305",
  "xchacha20-ietf-poly1305",
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "none",
];
const VMESS_SECURITY = ["auto", "aes-128-gcm", "chacha20-poly1305", "none", "zero"];
const FREEDOM_STRATEGIES = ["AsIs", "UseIP", "UseIPv4", "UseIPv6", "UseIPv4v6", "ForceIP", "ForceIPv4", "ForceIPv6", "ForceIPv4v6"];
const XHTTP_MODES = ["auto", "packet-up", "stream-up", "stream-one"];
const KCP_HEADERS = ["none", "srtp", "utp", "wechat-video", "dtls", "wireguard"];
const ALPN = ["h2", "http/1.1", "h3"];

const NET_KEY: Record<string, string> = {
  tcp: "tcpSettings",
  ws: "wsSettings",
  grpc: "grpcSettings",
  httpupgrade: "httpupgradeSettings",
  xhttp: "xhttpSettings",
  splithttp: "splithttpSettings",
  kcp: "kcpSettings",
  h2: "httpSettings",
  http: "httpSettings",
  quic: "quicSettings",
};

/** Where address / port / credentials live for the current protocol (nested vnext/servers or flat). */
function serverLayout(raw: Rec, protocol: string): { base: Path; user: Path } {
  const st = isRec(raw.settings) ? raw.settings : {};
  if (protocol === "vless" || protocol === "vmess") {
    const flat = typeof st.address === "string" && !Array.isArray(st.vnext);
    return flat ? { base: ["settings"], user: ["settings"] } : { base: ["settings", "vnext", 0], user: ["settings", "vnext", 0, "users", 0] };
  }
  if (protocol === "trojan" || protocol === "shadowsocks") {
    const flat = typeof st.address === "string" && !Array.isArray(st.servers);
    return flat ? { base: ["settings"], user: ["settings"] } : { base: ["settings", "servers", 0], user: ["settings", "servers", 0] };
  }
  return { base: ["settings", "servers", 0], user: ["settings", "servers", 0, "users", 0] };
}

export function OutboundEditor({ raw, onRaw, protocol, readOnly, t, otherOutboundTags, inboundTags }: Props) {
  const tr = useMemo(() => makeTr(t), [t]);
  const set = (path: Path, value: unknown) => onRaw(setPath(raw, path, value));
  const setStr = (path: Path, v: string) => set(path, v === "" ? undefined : v);
  const st = isRec(raw.settings) ? raw.settings : {};

  if (PROXY_PROTOCOLS.includes(protocol)) {
    return (
      <ProxyOutbound raw={raw} onRaw={onRaw} protocol={protocol} readOnly={readOnly} tr={tr} otherOutboundTags={otherOutboundTags} />
    );
  }

  if (protocol === "freedom") {
    const frag = isRec(st.fragment) ? st.fragment : null;
    return (
      <div className="space-y-4">
        <FieldGrid>
          <Field label={tr("obFreedomStrategy", "Domain strategy")} hint={tr("obFreedomStrategyHint", "How domains are resolved before connecting directly.")}>
            <SelectField
              value={strAt(raw, ["settings", "domainStrategy"], "AsIs")}
              disabled={readOnly}
              onChange={(v) => set(["settings", "domainStrategy"], v === "AsIs" ? undefined : v)}
              options={FREEDOM_STRATEGIES.map((v) => ({ value: v }))}
            />
          </Field>
          <Field label={tr("obRedirect", "Redirect")} hint={tr("obRedirectHint", "Optional address:port to send everything to instead of the original target.")}>
            <TextField mono value={strAt(raw, ["settings", "redirect"])} disabled={readOnly} placeholder="127.0.0.1:3366" onChange={(v) => setStr(["settings", "redirect"], v)} />
          </Field>
        </FieldGrid>
        <ToggleRow
          label={tr("obFragment", "Fragment TLS hello")}
          hint={tr("obFragmentHint", "Splits the first packets to slip past DPI. Applies to direct connections through this outbound.")}
          checked={frag !== null}
          disabled={readOnly}
          onChange={(on) => set(["settings", "fragment"], on ? { packets: "tlshello", length: "100-200", interval: "10-20" } : undefined)}
        />
        {frag ? (
          <FieldGrid>
            <Field label="packets">
              <SelectField
                value={strAt(raw, ["settings", "fragment", "packets"], "tlshello")}
                disabled={readOnly}
                onChange={(v) => set(["settings", "fragment", "packets"], v)}
                options={[{ value: "tlshello" }, { value: "1-3" }, { value: "1-5" }]}
              />
            </Field>
            <Field label="length">
              <TextField mono value={strAt(raw, ["settings", "fragment", "length"])} disabled={readOnly} placeholder="100-200" onChange={(v) => setStr(["settings", "fragment", "length"], v)} />
            </Field>
            <Field label="interval, ms">
              <TextField mono value={strAt(raw, ["settings", "fragment", "interval"])} disabled={readOnly} placeholder="10-20" onChange={(v) => setStr(["settings", "fragment", "interval"], v)} />
            </Field>
          </FieldGrid>
        ) : null}
      </div>
    );
  }

  if (protocol === "blackhole") {
    const type = strAt(raw, ["settings", "response", "type"], "none");
    return (
      <Field label={tr("obBlackholeResponse", "Response to the client")} hint={tr("obBlackholeHint", "\"none\" silently drops the connection; \"http\" answers with a 403 page.")}>
        <div className="flex gap-1.5">
          {["none", "http"].map((v) => (
            <ToggleChip key={v} active={type === v} disabled={readOnly} onClick={() => set(["settings", "response"], v === "none" ? undefined : { type: v })}>
              {v}
            </ToggleChip>
          ))}
        </div>
      </Field>
    );
  }

  if (protocol === "dns") {
    return (
      <FieldGrid>
        <Field label={tr("obNetwork", "Network")}>
          <div className="flex gap-1.5">
            {["tcp", "udp"].map((v) => (
              <ToggleChip key={v} active={strAt(raw, ["settings", "network"], "tcp") === v} disabled={readOnly} onClick={() => set(["settings", "network"], v)}>
                {v}
              </ToggleChip>
            ))}
          </div>
        </Field>
        <Field label={tr("obAddress", "Address")}>
          <TextField mono value={strAt(raw, ["settings", "address"])} disabled={readOnly} placeholder="1.1.1.1" onChange={(v) => setStr(["settings", "address"], v)} />
        </Field>
        <Field label={tr("obPort", "Port")}>
          <NumberField value={getPath(raw, ["settings", "port"])} min={1} disabled={readOnly} onChange={(v) => set(["settings", "port"], v)} />
        </Field>
        <Field label="nonIPQuery" hint={tr("obNonIpQueryHint", "What to do with queries that are not A/AAAA.")}>
          <SelectField
            value={strAt(raw, ["settings", "nonIPQuery"], "reject")}
            disabled={readOnly}
            onChange={(v) => set(["settings", "nonIPQuery"], v === "reject" ? undefined : v)}
            options={[{ value: "reject" }, { value: "drop" }, { value: "skip" }]}
          />
        </Field>
      </FieldGrid>
    );
  }

  if (protocol === "loopback") {
    return (
      <Field label="inboundTag" hint={tr("obLoopbackHint", "Traffic is fed back into the routing as if it arrived on this inbound.")}>
        <TagChipsInput
          values={strAt(raw, ["settings", "inboundTag"]) ? [strAt(raw, ["settings", "inboundTag"])] : []}
          onChange={(v) => setStr(["settings", "inboundTag"], v[v.length - 1] ?? "")}
          suggestions={inboundTags.map((tag) => ({ value: tag }))}
          disabled={readOnly}
          placeholder="api"
        />
      </Field>
    );
  }

  if (protocol === "wireguard") {
    return <WireguardFields raw={raw} onRaw={onRaw} readOnly={readOnly} tr={tr} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--fg-subtle)]">{tr("obGenericHint", "This protocol has no dedicated form. Edit its settings as JSON.")}</p>
      <Field label="settings">
        <JsonArea value={raw.settings} disabled={readOnly} rows={8} onCommit={(v) => set(["settings"], v)} />
      </Field>
      {raw.streamSettings !== undefined ? (
        <Field label="streamSettings">
          <JsonArea value={raw.streamSettings} disabled={readOnly} rows={6} onCommit={(v) => set(["streamSettings"], v)} />
        </Field>
      ) : null}
    </div>
  );
}

// ---- proxy protocols (server + transport + security + sockopt + mux) ---------------------------

function ProxyOutbound({
  raw,
  onRaw,
  protocol,
  readOnly,
  tr,
  otherOutboundTags,
}: {
  raw: Rec;
  onRaw: (next: Rec) => void;
  protocol: string;
  readOnly: boolean;
  tr: Tr;
  otherOutboundTags: string[];
}) {
  const { base, user } = serverLayout(raw, protocol);
  const set = (path: Path, value: unknown) => onRaw(setPath(raw, path, value));
  const setStr = (path: Path, v: string) => set(path, v === "" ? undefined : v);
  const at = (p: Path, k: string) => [...p, k] as Path;

  const net = strAt(raw, ["streamSettings", "network"], "tcp");
  const sec = strAt(raw, ["streamSettings", "security"], "none");
  const flow = strAt(raw, [...user, "flow"]);
  const flowAllowed = protocol === "vless" && vlessOutboundFlowAllowed(net, sec);

  /** Apply a stream patch and keep the VLESS flow consistent with the new transport. */
  const applyStream = (fn: (r: Rec) => Rec) => {
    let next = fn(raw);
    if (protocol === "vless") {
      const n = strAt(next, ["streamSettings", "network"], "tcp");
      const s = strAt(next, ["streamSettings", "security"], "none");
      const cur = strAt(next, [...user, "flow"]);
      const eff = effectiveVlessOutboundFlow(n, s, cur);
      if (eff !== cur) next = setPath(next, [...user, "flow"], eff === "" ? undefined : eff);
    }
    onRaw(next);
  };

  return (
    <div className="space-y-5">
      <SubSection title={tr("obServer", "Server")}>
        <FieldGrid>
          {protocol === "http" && typeof getPath(raw, [...base, "uri"]) === "string" ? (
            <Field label="uri" wide>
              <TextField mono value={strAt(raw, at(base, "uri"))} disabled={readOnly} onChange={(v) => set(at(base, "uri"), v)} />
            </Field>
          ) : (
            <>
              <Field label={tr("obAddress", "Address")}>
                <TextField mono value={strAt(raw, at(base, "address"))} disabled={readOnly} placeholder="example.com" onChange={(v) => set(at(base, "address"), v)} />
              </Field>
              <Field label={tr("obPort", "Port")}>
                <NumberField value={getPath(raw, at(base, "port"))} min={1} disabled={readOnly} onChange={(v) => set(at(base, "port"), v)} />
              </Field>
            </>
          )}

          {protocol === "vless" ? (
            <>
              <Field label="UUID">
                <TextField mono value={strAt(raw, at(user, "id"))} disabled={readOnly} onChange={(v) => set(at(user, "id"), v)} />
              </Field>
              <Field
                label={tr("obFlow", "Flow")}
                hint={flowAllowed ? undefined : tr("obFlowHint", "XTLS flow works only with TCP + TLS or REALITY.")}
              >
                <SelectField
                  value={flow}
                  disabled={readOnly || !flowAllowed}
                  onChange={(v) => setStr(at(user, "flow"), v)}
                  options={OUTBOUND_VLESS_FLOW_OPTIONS.map((f) => ({ value: f, label: f === "" ? tr("obNone", "None") : f }))}
                />
              </Field>
              <Field label="encryption">
                <TextField mono value={strAt(raw, at(user, "encryption"), "none")} disabled={readOnly} onChange={(v) => setStr(at(user, "encryption"), v)} />
              </Field>
            </>
          ) : null}

          {protocol === "vmess" ? (
            <>
              <Field label="UUID">
                <TextField mono value={strAt(raw, at(user, "id"))} disabled={readOnly} onChange={(v) => set(at(user, "id"), v)} />
              </Field>
              <Field label={tr("obVmessSecurity", "Encryption")}>
                <SelectField
                  value={strAt(raw, at(user, "security"), "auto")}
                  disabled={readOnly}
                  onChange={(v) => set(at(user, "security"), v)}
                  options={VMESS_SECURITY.map((v) => ({ value: v }))}
                />
              </Field>
              <Field label="alterId" hint={tr("obAlterIdHint", "Legacy. Keep 0 unless the server requires otherwise.")}>
                <NumberField value={getPath(raw, at(user, "alterId"))} min={0} disabled={readOnly} onChange={(v) => set(at(user, "alterId"), v)} />
              </Field>
            </>
          ) : null}

          {protocol === "trojan" ? (
            <Field label={tr("obPassword", "Password")}>
              <TextField mono value={strAt(raw, at(user, "password"))} disabled={readOnly} onChange={(v) => set(at(user, "password"), v)} />
            </Field>
          ) : null}

          {protocol === "shadowsocks" ? (
            <>
              <Field label={tr("obMethod", "Method")}>
                <SelectField
                  value={strAt(raw, at(user, "method"), "aes-256-gcm")}
                  disabled={readOnly}
                  onChange={(v) => set(at(user, "method"), v)}
                  options={SS_METHODS.map((v) => ({ value: v }))}
                />
              </Field>
              <Field label={tr("obPassword", "Password")}>
                <TextField mono value={strAt(raw, at(user, "password"))} disabled={readOnly} onChange={(v) => set(at(user, "password"), v)} />
              </Field>
              <Field label="UDP over TCP">
                <div className="flex gap-1.5">
                  <ToggleChip active={getPath(raw, at(user, "uot")) === true} disabled={readOnly} onClick={() => set(at(user, "uot"), getPath(raw, at(user, "uot")) === true ? undefined : true)}>
                    uot
                  </ToggleChip>
                </div>
              </Field>
            </>
          ) : null}

          {protocol === "socks" || protocol === "http" ? (
            <>
              <Field label={tr("obUser", "Username")}>
                <TextField mono value={strAt(raw, at(user, "user"))} disabled={readOnly} onChange={(v) => setStr(at(user, "user"), v)} />
              </Field>
              <Field label={tr("obPassword", "Password")}>
                <TextField mono value={strAt(raw, at(user, "pass"))} disabled={readOnly} onChange={(v) => setStr(at(user, "pass"), v)} />
              </Field>
            </>
          ) : null}
        </FieldGrid>
      </SubSection>

      <SubSection title={tr("obTransport", "Transport")}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {[...OUTBOUND_STREAM_NETWORK_OPTIONS, ...(OUTBOUND_STREAM_NETWORK_OPTIONS.includes(net as never) ? [] : [net])].map((n) => (
              <ToggleChip key={n} active={net === n} disabled={readOnly} onClick={() => applyStream((r) => setPath(r, ["streamSettings", "network"], n))}>
                {n}
              </ToggleChip>
            ))}
          </div>
          <NetworkFields raw={raw} net={net} readOnly={readOnly} tr={tr} set={set} setStr={setStr} />
        </div>
      </SubSection>

      <SubSection title={tr("obSecurity", "Security")}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {["none", "tls", "reality"].map((s) => (
              <ToggleChip
                key={s}
                active={sec === s}
                disabled={readOnly}
                onClick={() =>
                  applyStream((r) => {
                    let n = setPath(r, ["streamSettings", "security"], s);
                    if (s !== "tls") n = setPath(n, ["streamSettings", "tlsSettings"], undefined);
                    if (s !== "reality") n = setPath(n, ["streamSettings", "realitySettings"], undefined);
                    return n;
                  })
                }
              >
                {s}
              </ToggleChip>
            ))}
          </div>
          {sec === "tls" ? <TlsFields raw={raw} readOnly={readOnly} tr={tr} set={set} setStr={setStr} /> : null}
          {sec === "reality" ? <RealityFields raw={raw} readOnly={readOnly} tr={tr} set={set} setStr={setStr} /> : null}
        </div>
      </SubSection>

      <SubSection title={tr("obExtra", "Extra")}>
        <div className="space-y-3">
          <FieldGrid>
            <Field label={tr("obDialerProxy", "Chain through outbound")} hint={tr("obDialerProxyHint", "Connect to this server via another outbound (proxy chain).")}>
              <SelectField
                value={strAt(raw, ["streamSettings", "sockopt", "dialerProxy"])}
                disabled={readOnly}
                onChange={(v) => setStr(["streamSettings", "sockopt", "dialerProxy"], v)}
                options={[{ value: "", label: tr("obNone", "None") }, ...otherOutboundTags.map((v) => ({ value: v }))]}
              />
            </Field>
            <Field label="mark" hint={tr("obMarkHint", "Linux SO_MARK for policy routing. Optional.")}>
              <NumberField value={getPath(raw, ["streamSettings", "sockopt", "mark"])} min={0} disabled={readOnly} onChange={(v) => set(["streamSettings", "sockopt", "mark"], v)} />
            </Field>
          </FieldGrid>
          <ToggleRow
            label="TCP Fast Open"
            checked={getPath(raw, ["streamSettings", "sockopt", "tcpFastOpen"]) === true}
            disabled={readOnly}
            onChange={(on) => set(["streamSettings", "sockopt", "tcpFastOpen"], on ? true : undefined)}
          />
          <ToggleRow
            label={tr("obMux", "Multiplexing (mux)")}
            hint={tr("obMuxHint", "Carries several connections over one. Not compatible with XTLS flow.")}
            checked={getPath(raw, ["mux", "enabled"]) === true}
            disabled={readOnly}
            onChange={(on) => set(["mux"], on ? { enabled: true, concurrency: 8 } : undefined)}
          />
          {getPath(raw, ["mux", "enabled"]) === true ? (
            <FieldGrid>
              <Field label="concurrency">
                <NumberField value={getPath(raw, ["mux", "concurrency"])} min={-1} disabled={readOnly} onChange={(v) => set(["mux", "concurrency"], v)} />
              </Field>
              <Field label="xudpConcurrency">
                <NumberField value={getPath(raw, ["mux", "xudpConcurrency"])} min={0} disabled={readOnly} onChange={(v) => set(["mux", "xudpConcurrency"], v)} />
              </Field>
            </FieldGrid>
          ) : null}
          <Disclosure label={tr("obAdvancedJson", "Stream settings as JSON")}>
            <JsonArea value={raw.streamSettings} disabled={readOnly} rows={8} onCommit={(v) => set(["streamSettings"], v)} />
          </Disclosure>
        </div>
      </SubSection>
    </div>
  );
}

function NetworkFields({
  raw,
  net,
  readOnly,
  tr,
  set,
  setStr,
}: {
  raw: Rec;
  net: string;
  readOnly: boolean;
  tr: Tr;
  set: (p: Path, v: unknown) => void;
  setStr: (p: Path, v: string) => void;
}) {
  const key = NET_KEY[net];
  if (!key) return null;
  const at = (k: string): Path => ["streamSettings", key, k];
  const text = (label: string, k: string, placeholder?: string, wide?: boolean) => (
    <Field label={label} wide={wide}>
      <TextField mono value={strAt(raw, at(k))} disabled={readOnly} placeholder={placeholder} onChange={(v) => setStr(at(k), v)} />
    </Field>
  );

  let body: ReactNode = null;
  if (net === "ws" || net === "httpupgrade" || net === "splithttp") {
    body = (
      <FieldGrid>
        {text("path", "path", "/")}
        {text("host", "host", "example.com")}
      </FieldGrid>
    );
  } else if (net === "xhttp") {
    body = (
      <FieldGrid>
        {text("path", "path", "/")}
        {text("host", "host", "example.com")}
        <Field label="mode">
          <SelectField value={strAt(raw, at("mode"), "auto")} disabled={readOnly} onChange={(v) => set(at("mode"), v === "auto" ? undefined : v)} options={XHTTP_MODES.map((v) => ({ value: v }))} />
        </Field>
      </FieldGrid>
    );
  } else if (net === "grpc") {
    body = (
      <div className="space-y-3">
        <FieldGrid>
          {text("serviceName", "serviceName")}
          {text("authority", "authority")}
        </FieldGrid>
        <ToggleRow label="multiMode" checked={getPath(raw, at("multiMode")) === true} disabled={readOnly} onChange={(on) => set(at("multiMode"), on ? true : undefined)} />
      </div>
    );
  } else if (net === "kcp") {
    body = (
      <FieldGrid>
        {text("seed", "seed")}
        <Field label={tr("obKcpHeader", "Header type")}>
          <SelectField value={strAt(raw, ["streamSettings", key, "header", "type"], "none")} disabled={readOnly} onChange={(v) => set(["streamSettings", key, "header", "type"], v === "none" ? undefined : v)} options={KCP_HEADERS.map((v) => ({ value: v }))} />
        </Field>
      </FieldGrid>
    );
  } else if (net === "h2" || net === "http") {
    body = (
      <FieldGrid>
        {text("path", "path", "/")}
        <Field label="host">
          <TagChipsInput
            values={listAt(raw, at("host"))}
            onChange={(v) => set(at("host"), v.length ? v : undefined)}
            disabled={readOnly}
            placeholder="example.com"
          />
        </Field>
      </FieldGrid>
    );
  } else if (net === "tcp") {
    body = (
      <Field label={tr("obTcpHeader", "Header type")} hint={tr("obTcpHeaderHint", "\"http\" needs a request block — edit it in the JSON view below.")}>
        <SelectField value={strAt(raw, ["streamSettings", key, "header", "type"], "none")} disabled={readOnly} onChange={(v) => set(["streamSettings", key, "header", "type"], v === "none" ? undefined : v)} options={[{ value: "none" }, { value: "http" }]} />
      </Field>
    );
  }

  return (
    <div className="space-y-3">
      {body}
      <Disclosure label={`${key} (JSON)`}>
        <JsonArea value={getPath(raw, ["streamSettings", key])} disabled={readOnly} rows={6} onCommit={(v) => set(["streamSettings", key], v)} />
      </Disclosure>
    </div>
  );
}

function TlsFields({ raw, readOnly, tr, set, setStr }: { raw: Rec; readOnly: boolean; tr: Tr; set: (p: Path, v: unknown) => void; setStr: (p: Path, v: string) => void }) {
  const at = (k: string): Path => ["streamSettings", "tlsSettings", k];
  const alpn = listAt(raw, at("alpn"));
  const extras = alpn.filter((a) => !ALPN.includes(a));
  const toggle = (a: string) => {
    const s = new Set(alpn);
    if (s.has(a)) s.delete(a);
    else s.add(a);
    const ordered = [...ALPN.filter((x) => s.has(x)), ...extras.filter((x) => s.has(x))];
    set(at("alpn"), ordered.length ? ordered : undefined);
  };
  return (
    <div className="space-y-3">
      <FieldGrid>
        <Field label="serverName (SNI)">
          <TextField mono value={strAt(raw, at("serverName"))} disabled={readOnly} placeholder="example.com" onChange={(v) => setStr(at("serverName"), v)} />
        </Field>
        <Field label="fingerprint">
          <SelectField value={strAt(raw, at("fingerprint"))} disabled={readOnly} onChange={(v) => setStr(at("fingerprint"), v)} options={FINGERPRINTS.map((f) => ({ value: f, label: f === "" ? tr("obNone", "None") : f }))} />
        </Field>
        <Field label="alpn" wide>
          <div className="flex flex-wrap gap-1.5">
            {ALPN.map((a) => (
              <ToggleChip key={a} active={alpn.includes(a)} disabled={readOnly} onClick={() => toggle(a)}>
                {a}
              </ToggleChip>
            ))}
            {extras.map((a) => (
              <ToggleChip key={a} active disabled={readOnly} onClick={() => toggle(a)}>
                {a}
              </ToggleChip>
            ))}
          </div>
        </Field>
        <Field label="pinnedPeerCertSha256" wide>
          <TextField mono value={strAt(raw, at("pinnedPeerCertSha256"))} disabled={readOnly} placeholder="e8e2d387fdbffeb3…" onChange={(v) => setStr(at("pinnedPeerCertSha256"), v)} />
        </Field>
      </FieldGrid>
      <ToggleRow
        label="allowInsecure"
        hint={tr("obAllowInsecureHint", "Skips certificate verification. Only for testing — it removes protection against interception.")}
        checked={getPath(raw, at("allowInsecure")) === true}
        disabled={readOnly}
        onChange={(on) => set(at("allowInsecure"), on ? true : undefined)}
      />
    </div>
  );
}

function RealityFields({ raw, readOnly, tr, set, setStr }: { raw: Rec; readOnly: boolean; tr: Tr; set: (p: Path, v: unknown) => void; setStr: (p: Path, v: string) => void }) {
  const at = (k: string): Path => ["streamSettings", "realitySettings", k];
  return (
    <FieldGrid>
      <Field label="publicKey" wide>
        <TextField mono value={strAt(raw, at("publicKey"))} disabled={readOnly} onChange={(v) => setStr(at("publicKey"), v)} />
      </Field>
      <Field label="serverName (SNI)">
        <TextField mono value={strAt(raw, at("serverName"))} disabled={readOnly} onChange={(v) => setStr(at("serverName"), v)} />
      </Field>
      <Field label="shortId">
        <TextField mono value={strAt(raw, at("shortId"))} disabled={readOnly} onChange={(v) => setStr(at("shortId"), v)} />
      </Field>
      <Field label="fingerprint">
        <SelectField value={strAt(raw, at("fingerprint"), "chrome")} disabled={readOnly} onChange={(v) => set(at("fingerprint"), v)} options={FINGERPRINTS.filter((f) => f !== "").map((f) => ({ value: f }))} />
      </Field>
      <Field label="spiderX">
        <TextField mono value={strAt(raw, at("spiderX"), "/")} disabled={readOnly} onChange={(v) => setStr(at("spiderX"), v)} />
      </Field>
      <Field label="mldsa65Verify" hint={tr("obMldsaHint", "Post-quantum signature key, if the server uses one.")} wide>
        <TextField mono value={strAt(raw, at("mldsa65Verify"))} disabled={readOnly} onChange={(v) => setStr(at("mldsa65Verify"), v)} />
      </Field>
    </FieldGrid>
  );
}

function WireguardFields({ raw, onRaw, readOnly, tr }: { raw: Rec; onRaw: (r: Rec) => void; readOnly: boolean; tr: Tr }) {
  const set = (path: Path, value: unknown) => onRaw(setPath(raw, path, value));
  const setStr = (path: Path, v: string) => set(path, v === "" ? undefined : v);
  const peers = (Array.isArray(getPath(raw, ["settings", "peers"])) ? (getPath(raw, ["settings", "peers"]) as unknown[]) : []).map((p) => (isRec(p) ? p : {}));
  const setPeers = (next: Rec[]) => set(["settings", "peers"], next);
  const updatePeer = (i: number, p: Rec) => setPeers(peers.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const clean = (o: Rec) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return (
    <div className="space-y-4">
      <FieldGrid>
        <Field label="secretKey" wide>
          <TextField mono value={strAt(raw, ["settings", "secretKey"])} disabled={readOnly} onChange={(v) => setStr(["settings", "secretKey"], v)} />
        </Field>
        <Field label={tr("obWgAddress", "Interface addresses")}>
          <TagChipsInput values={listAt(raw, ["settings", "address"])} onChange={(v) => set(["settings", "address"], v.length ? v : undefined)} disabled={readOnly} placeholder="10.0.0.2/32" />
        </Field>
        <Field label="mtu">
          <NumberField value={getPath(raw, ["settings", "mtu"])} min={576} disabled={readOnly} onChange={(v) => set(["settings", "mtu"], v)} />
        </Field>
      </FieldGrid>
      <div className="space-y-2">
        <div className="text-sm font-semibold text-[var(--fg)]">{tr("obWgPeers", "Peers")}</div>
        {peers.length === 0 ? <EmptyNote>{tr("obWgNoPeers", "No peers yet.")}</EmptyNote> : null}
        {peers.map((p, i) => (
          <Card
            key={i}
            title={`${tr("obWgPeer", "Peer")} ${i + 1}`}
            actions={<RowActions index={i} total={peers.length} readOnly={readOnly} tr={tr} onMove={(to) => setPeers(moveItem(peers, i, to))} onRemove={() => setPeers(peers.filter((_, j) => j !== i))} />}
          >
            <FieldGrid>
              <Field label="publicKey" wide>
                <TextField mono value={typeof p.publicKey === "string" ? p.publicKey : ""} disabled={readOnly} onChange={(v) => updatePeer(i, clean({ publicKey: v }))} />
              </Field>
              <Field label="endpoint">
                <TextField mono value={typeof p.endpoint === "string" ? p.endpoint : ""} disabled={readOnly} placeholder="host:51820" onChange={(v) => updatePeer(i, { endpoint: v })} />
              </Field>
              <Field label="keepAlive, s">
                <NumberField value={p.keepAlive} min={0} disabled={readOnly} onChange={(v) => updatePeer(i, { keepAlive: v })} />
              </Field>
              <Field label="allowedIPs" wide>
                <TagChipsInput values={Array.isArray(p.allowedIPs) ? (p.allowedIPs as unknown[]).filter((x): x is string => typeof x === "string") : []} onChange={(v) => updatePeer(i, { allowedIPs: v })} disabled={readOnly} placeholder="0.0.0.0/0, ::/0" />
              </Field>
              <Field label="preSharedKey" wide>
                <TextField mono value={typeof p.preSharedKey === "string" ? p.preSharedKey : ""} disabled={readOnly} onChange={(v) => updatePeer(i, { preSharedKey: v })} />
              </Field>
            </FieldGrid>
          </Card>
        ))}
        <AddButton disabled={readOnly} onClick={() => setPeers([...peers, { publicKey: "", endpoint: "", allowedIPs: ["0.0.0.0/0", "::/0"] }])}>
          {tr("obWgAddPeer", "Add peer")}
        </AddButton>
      </div>
    </div>
  );
}
