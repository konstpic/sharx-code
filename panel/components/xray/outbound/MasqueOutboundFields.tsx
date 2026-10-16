"use client";

import { CoreVersionHint } from "@/components/xray/outbound/CoreVersionHint";
import { TagChipsInput } from "@/components/xray/routing/TagChipsInput";
import {
  Disclosure,
  Field,
  FieldGrid,
  JsonArea,
  NumberField,
  SelectField,
  SubSection,
  TextField,
  ToggleRow,
  type Tr,
} from "@/components/xray/configurator/fields";
import { getPath, isRec, listAt, setPath, strAt, type Path, type Rec } from "@/lib/jsonPath";
import { MASQUE_DEFAULT_PATH, defaultMasqueWarp, describeMasqueIssue, validateMasqueOutbound } from "@/lib/xrayMasque";

/** MASQUE outbound (Xray >= 26.9.30): `settings` { address, port, remoteDNS } + `streamSettings.masqueSettings`. */
export function MasqueOutboundFields({
  raw,
  onRaw,
  readOnly,
  tr,
}: {
  raw: Rec;
  onRaw: (next: Rec) => void;
  readOnly: boolean;
  tr: Tr;
}) {
  const set = (path: Path, value: unknown) => onRaw(setPath(raw, path, value));
  const setStr = (path: Path, v: string) => set(path, v === "" ? undefined : v);
  const ms: Path = ["streamSettings", "masqueSettings"];
  const at = (k: string): Path => [...ms, k];
  const warp = getPath(raw, at("warp"));
  const warpOn = isRec(warp);
  const issues = validateMasqueOutbound(raw);
  const headers = getPath(raw, at("headers"));

  return (
    <div className="space-y-5">
      <CoreVersionHint feature="masque" tr={tr} />
      <SubSection title={tr("obServer", "Server")}>
        <FieldGrid>
          <Field label={tr("obAddress", "Address")}>
            <TextField mono value={strAt(raw, ["settings", "address"])} disabled={readOnly} placeholder="masque.example.com" onChange={(v) => set(["settings", "address"], v)} />
          </Field>
          <Field label={tr("obPort", "Port")}>
            <NumberField value={getPath(raw, ["settings", "port"])} min={1} disabled={readOnly} onChange={(v) => set(["settings", "port"], v)} />
          </Field>
          <Field label="remoteDNS" wide hint={tr("mqRemoteDns", "DNS servers (IP addresses) used inside the tunnel.")}>
            <TagChipsInput
              values={listAt(raw, ["settings", "remoteDNS"])}
              onChange={(v) => set(["settings", "remoteDNS"], v.length ? v : undefined)}
              disabled={readOnly}
              placeholder="1.1.1.1"
            />
          </Field>
        </FieldGrid>
        <div className="mt-2 text-[11px] text-[var(--fg-subtle)]">
          {tr("mqNoMux", "The masque outbound does not support mux.")}
        </div>
      </SubSection>

      <SubSection title={tr("obSecurity", "Security")}>
        <div className="space-y-3">
          <Field label="security">
            <SelectField
              value={strAt(raw, ["streamSettings", "security"], "tls")}
              disabled={readOnly}
              onChange={(v) => onRaw(setPath(setPath(raw, ["streamSettings", "security"], v), ["streamSettings", "tlsSettings"], v === "tls" ? getPath(raw, ["streamSettings", "tlsSettings"]) : undefined))}
              options={[{ value: "tls" }, { value: "none" }]}
            />
          </Field>
          {strAt(raw, ["streamSettings", "security"], "tls") === "tls" ? (
            <Disclosure label="tlsSettings (JSON)">
              <JsonArea value={getPath(raw, ["streamSettings", "tlsSettings"])} disabled={readOnly} rows={5} placeholder='{ "serverName": "masque.example.com" }' onCommit={(v) => set(["streamSettings", "tlsSettings"], v)} />
            </Disclosure>
          ) : null}
        </div>
      </SubSection>

      <SubSection title="masqueSettings">
        <div className="space-y-3">
          <FieldGrid>
            <Field label="host" hint={warpOn ? tr("mqWarpHost", "Empty: Cloudflare WARP endpoint.") : undefined}>
              <TextField mono value={strAt(raw, at("host"))} disabled={readOnly} placeholder="masque.example.com" onChange={(v) => setStr(at("host"), v)} />
            </Field>
            <Field label="path" hint={tr("mqPath", "Variables: {target}, {ipproto}.")}>
              <TextField mono value={strAt(raw, at("path"))} disabled={readOnly} placeholder={MASQUE_DEFAULT_PATH} onChange={(v) => setStr(at("path"), v)} />
            </Field>
            <Field label="user">
              <TextField mono value={strAt(raw, at("user"))} disabled={readOnly || warpOn} onChange={(v) => setStr(at("user"), v)} />
            </Field>
            <Field label="pass">
              <TextField mono value={strAt(raw, at("pass"))} disabled={readOnly || warpOn} onChange={(v) => setStr(at("pass"), v)} />
            </Field>
          </FieldGrid>

          <ToggleRow
            label="Cloudflare WARP"
            hint={tr("mqWarp", "Use a WARP MASQUE profile instead of user/pass. Needs the key pair and the interface address.")}
            checked={warpOn}
            disabled={readOnly}
            onChange={(on) => onRaw(setPath(setPath(setPath(raw, at("warp"), on ? defaultMasqueWarp() : undefined), at("user"), undefined), at("pass"), undefined))}
          />
          {warpOn ? (
            <div className="space-y-3">
              <CoreVersionHint feature="masqueWarpPublicKey" tr={tr} />
              <FieldGrid>
                <Field label="privateKey" wide hint={tr("mqKeyFmt", "ECDSA P-256, PEM or base64 (PKCS #8 / SEC 1).")}>
                  <TextField mono value={strAt(raw, [...at("warp"), "privateKey"] as Path)} disabled={readOnly} onChange={(v) => set([...at("warp"), "privateKey"], v)} />
                </Field>
                <Field label="publicKey" wide hint={tr("mqPubFmt", "Server public key, PEM or base64 (PKIX).")}>
                  <TextField mono value={strAt(raw, [...at("warp"), "publicKey"] as Path)} disabled={readOnly} onChange={(v) => set([...at("warp"), "publicKey"], v)} />
                </Field>
                <Field label="address" wide hint={tr("mqWarpAddr", "At most one IPv4 and one IPv6 address.")}>
                  <TagChipsInput
                    values={listAt(raw, [...at("warp"), "address"] as Path)}
                    onChange={(v) => set([...at("warp"), "address"], v)}
                    disabled={readOnly}
                    placeholder="172.16.0.2/32"
                  />
                </Field>
              </FieldGrid>
            </div>
          ) : null}

          <Disclosure label="headers (JSON)">
            <JsonArea value={headers} disabled={readOnly} rows={4} placeholder='{ "X-Header": "value" }' onCommit={(v) => set(at("headers"), v)} />
          </Disclosure>
        </div>
      </SubSection>

      {issues.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] text-amber-400">
          {issues.map((i, k) => (
            <li key={k}>{describeMasqueIssue(i)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
