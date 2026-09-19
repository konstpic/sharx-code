"use client";

import { Reorder, useDragControls } from "framer-motion";
import { ChevronDown, ChevronRight, Copy, GripVertical, Trash2, X } from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TagChipsInput, type ChipSuggestion } from "@/components/xray/routing/TagChipsInput";
import {
  AddButton,
  EmptyNote,
  Field,
  FieldGrid,
  NumberField,
  SelectField,
  TextField,
  ToggleChip,
  ToggleRow,
  makeTr,
  type Tr,
} from "@/components/xray/configurator/fields";
import { DOMAIN_SUGGESTIONS, IP_SUGGESTIONS } from "@/lib/xrayRoutingPresets";
import { setPath, type Rec } from "@/lib/jsonPath";
import {
  defaultDnsForm,
  newHostRow,
  newServerRow,
  parseDnsSection,
  serializeDnsSection,
  type DnsFormState,
  type DnsHostRow,
  type DnsServerRow,
} from "@/lib/xrayDnsForm";

type Props = {
  value: string;
  onChange: (sectionJson: string) => void;
  readOnly: boolean;
  t: TFunction;
  syncKey: string | number;
};

const QUERY_STRATEGIES = ["UseIP", "UseIPv4", "UseIPv6", "UseSystem"];

const SERVER_PRESETS: { value: string; en: string; ru: string }[] = [
  { value: "1.1.1.1", en: "Cloudflare", ru: "Cloudflare" },
  { value: "1.0.0.1", en: "Cloudflare (secondary)", ru: "Cloudflare (запасной)" },
  { value: "8.8.8.8", en: "Google", ru: "Google" },
  { value: "9.9.9.9", en: "Quad9", ru: "Quad9" },
  { value: "77.88.8.8", en: "Yandex", ru: "Яндекс" },
  { value: "94.140.14.14", en: "AdGuard", ru: "AdGuard" },
  { value: "localhost", en: "System resolver", ru: "Системный резолвер" },
  { value: "fakedns", en: "FakeDNS (needs the FakeDNS section)", ru: "FakeDNS (нужен раздел Fake DNS)" },
  { value: "https://1.1.1.1/dns-query", en: "Cloudflare DoH", ru: "Cloudflare DoH" },
  { value: "https+local://1.1.1.1/dns-query", en: "Cloudflare DoH (direct)", ru: "Cloudflare DoH (напрямую)" },
  { value: "https://dns.google/dns-query", en: "Google DoH", ru: "Google DoH" },
  { value: "tcp://8.8.8.8", en: "Google over TCP", ru: "Google по TCP" },
  { value: "quic+local://dns.adguard-dns.com", en: "AdGuard DoQ (direct)", ru: "AdGuard DoQ (напрямую)" },
];

function serverAddress(v: string | Rec): string {
  if (typeof v === "string") return v;
  return typeof v.address === "string" ? v.address : "";
}

function serverObject(v: string | Rec): Rec {
  return typeof v === "string" ? { address: v } : v;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function DnsBuilder({ value, onChange, readOnly, t, syncKey }: Props) {
  const { i18n } = useTranslation();
  const ru = (i18n.language || "en").toLowerCase().startsWith("ru");
  const tr = useMemo(() => makeTr(t), [t]);
  const [state, setState] = useState<DnsFormState>(() => defaultDnsForm());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const lastEmitted = useRef<string | null>(null);
  const prevSyncKey = useRef(syncKey);

  const normJson = useCallback((s: string) => {
    try {
      return JSON.stringify(JSON.parse(s));
    } catch {
      return s;
    }
  }, []);

  const apply = useCallback(
    (next: DnsFormState) => {
      setState(next);
      const json = serializeDnsSection(next);
      lastEmitted.current = json;
      onChange(json);
    },
    [onChange],
  );

  useEffect(() => {
    const syncKeyBumped = prevSyncKey.current !== syncKey;
    prevSyncKey.current = syncKey;
    if (!syncKeyBumped && lastEmitted.current != null && normJson(value) === normJson(lastEmitted.current)) return;
    const { state: next, error } = parseDnsSection(value);
    if (error) {
      setState(defaultDnsForm());
      return;
    }
    setState(next);
    lastEmitted.current = serializeDnsSection(next);
  }, [value, syncKey, normJson]);

  const domainSuggestions = useMemo<ChipSuggestion[]>(
    () => DOMAIN_SUGGESTIONS.map((s) => ({ value: s.value, hint: ru ? s.ru : s.en, prefix: s.prefix })),
    [ru],
  );
  const ipSuggestions = useMemo<ChipSuggestion[]>(
    () => IP_SUGGESTIONS.map((s) => ({ value: s.value, hint: ru ? s.ru : s.en, prefix: s.prefix })),
    [ru],
  );

  const setRaw = (path: (string | number)[], v: unknown) => apply({ ...state, raw: setPath(state.raw, path, v) });
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const updateServer = (i: number, next: string | Rec) =>
    apply({ ...state, servers: state.servers.map((s, j) => (j === i ? { ...s, value: next } : s)) });

  const rawStr = (k: string) => (typeof state.raw[k] === "string" ? (state.raw[k] as string) : "");

  return (
    <div className="space-y-5">
      <ToggleRow
        label={t("pages.xray.dnsBuilder.enableCustom")}
        hint={tr("dnsEnableHint", "Off: Xray uses the system resolver and none of the settings below are written.")}
        checked={state.enabled}
        disabled={readOnly}
        onChange={(on) => apply({ ...state, enabled: on })}
      />

      {!state.enabled ? <p className="text-xs text-[var(--fg-subtle)]">{t("pages.xray.dnsBuilder.disabledHint")}</p> : null}

      {state.enabled ? (
        <>
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">{tr("dnsGeneral", "General")}</div>
            <Field label={t("pages.xray.dns.queryStrategy")} hint={tr("dnsQueryStrategyHint", "Which record types the core asks for by default.")}>
              <div className="flex flex-wrap gap-1.5">
                {QUERY_STRATEGIES.map((q) => (
                  <ToggleChip key={q} active={(rawStr("queryStrategy") || "UseIP") === q} disabled={readOnly} onClick={() => setRaw(["queryStrategy"], q)}>
                    {q}
                  </ToggleChip>
                ))}
              </div>
            </Field>
            <FieldGrid>
              <Field label="tag" hint={tr("dnsTagHint", "Outbound-style tag of DNS-originated traffic; usable in routing rules.")}>
                <TextField mono value={rawStr("tag")} disabled={readOnly} onChange={(v) => setRaw(["tag"], v === "" ? undefined : v)} />
              </Field>
              <Field label="clientIp" hint={tr("dnsClientIpHint", "Reported to DNS servers (EDNS client subnet). Optional.")}>
                <TextField mono value={rawStr("clientIp")} disabled={readOnly} placeholder="203.0.113.10" onChange={(v) => setRaw(["clientIp"], v === "" ? undefined : v)} />
              </Field>
            </FieldGrid>
            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleRow label="disableCache" hint={tr("dnsDisableCacheHint", "Ask servers every time instead of caching answers.")} checked={state.raw.disableCache === true} disabled={readOnly} onChange={(on) => setRaw(["disableCache"], on ? true : undefined)} />
              <ToggleRow label="disableFallback" hint={tr("dnsDisableFallbackHint", "Do not try the remaining servers when the matched one fails.")} checked={state.raw.disableFallback === true} disabled={readOnly} onChange={(on) => setRaw(["disableFallback"], on ? true : undefined)} />
              <ToggleRow label="disableFallbackIfMatch" hint={tr("dnsDisableFallbackIfMatchHint", "Skip fallback when a domain rule already matched.")} checked={state.raw.disableFallbackIfMatch === true} disabled={readOnly} onChange={(on) => setRaw(["disableFallbackIfMatch"], on ? true : undefined)} />
              <ToggleRow label="serveStale" hint={tr("dnsServeStaleHint", "Answer from an expired cache entry while refreshing it.")} checked={state.raw.serveStale === true} disabled={readOnly} onChange={(on) => setRaw(["serveStale"], on ? true : undefined)} />
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <div className="text-sm font-semibold text-[var(--fg)]">
                {t("pages.xray.dnsBuilder.servers")} <span className="font-normal text-[var(--fg-muted)]">({state.servers.length})</span>
              </div>
              <p className="text-xs text-[var(--fg-subtle)]">
                {tr("dnsServersHint", "A server with a domain list answers only for those domains; the others are used in order. Drag to reorder.")}
              </p>
            </div>
            {state.servers.length === 0 ? <EmptyNote>{tr("dnsNoServers", "No servers — Xray falls back to the system resolver.")}</EmptyNote> : null}
            <Reorder.Group axis="y" values={state.servers} onReorder={(next) => !readOnly && apply({ ...state, servers: next })} as="div" className="space-y-2">
              {state.servers.map((row, i) => (
                <ServerItem
                  key={row.id}
                  row={row}
                  index={i}
                  open={open.has(row.id)}
                  readOnly={readOnly}
                  ru={ru}
                  tr={tr}
                  domainSuggestions={domainSuggestions}
                  ipSuggestions={ipSuggestions}
                  onToggle={() => toggleOpen(row.id)}
                  onChange={(v) => updateServer(i, v)}
                  onDuplicate={() => {
                    const copy = newServerRow(JSON.parse(JSON.stringify(row.value)) as string | Rec);
                    const n = state.servers.slice();
                    n.splice(i + 1, 0, copy);
                    apply({ ...state, servers: n });
                    setOpen((p) => new Set(p).add(copy.id));
                  }}
                  onRemove={() => apply({ ...state, servers: state.servers.filter((_, j) => j !== i) })}
                />
              ))}
            </Reorder.Group>
            <AddButton
              disabled={readOnly}
              onClick={() => {
                const row = newServerRow("1.1.1.1");
                apply({ ...state, servers: [...state.servers, row] });
                setOpen((p) => new Set(p).add(row.id));
              }}
            >
              {t("pages.xray.dnsBuilder.addServer")}
            </AddButton>
          </div>

          <HostsEditor
            hosts={state.hosts}
            readOnly={readOnly}
            tr={tr}
            onChange={(hosts) => apply({ ...state, hosts })}
          />
        </>
      ) : null}
    </div>
  );
}

function ServerItem({
  row,
  index,
  open,
  readOnly,
  ru,
  tr,
  domainSuggestions,
  ipSuggestions,
  onToggle,
  onChange,
  onDuplicate,
  onRemove,
}: {
  row: DnsServerRow;
  index: number;
  open: boolean;
  readOnly: boolean;
  ru: boolean;
  tr: Tr;
  domainSuggestions: ChipSuggestion[];
  ipSuggestions: ChipSuggestion[];
  onToggle: () => void;
  onChange: (v: string | Rec) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const obj = serverObject(row.value);
  const address = serverAddress(row.value);
  const domains = strList(obj.domains);
  const expect = strList(obj.expectIPs).length ? strList(obj.expectIPs) : strList(obj.expectedIPs);
  const expectKey = strList(obj.expectedIPs).length && !strList(obj.expectIPs).length ? "expectedIPs" : "expectIPs";
  const preset = SERVER_PRESETS.find((p) => p.value === address);
  const isString = typeof row.value === "string";

  const setField = (k: string, v: unknown) => {
    const next: Rec = { ...obj };
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
    // A server that is only an address collapses back to the bare string form.
    const keys = Object.keys(next);
    if (keys.length === 1 && keys[0] === "address" && typeof next.address === "string") onChange(next.address);
    else onChange(next);
  };
  const setAddress = (v: string) => {
    if (isString) onChange(v);
    else onChange({ ...obj, address: v });
  };

  const iconBtn =
    "rounded-lg p-1.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-30";
  const summary: string[] = [];
  if (domains.length) summary.push(`${domains.length} ${tr("dnsDomainsShort", "domains")}`);
  if (expect.length) summary.push(`${expect.length} expectIPs`);
  if (obj.skipFallback === true) summary.push("skipFallback");

  return (
    <Reorder.Item value={row} as="div" dragListener={false} dragControls={controls} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <button
          type="button"
          aria-label="drag"
          disabled={readOnly}
          onPointerDown={(e) => {
            if (!readOnly) controls.start(e);
          }}
          className="cursor-grab touch-none rounded-lg p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface)] hover:text-[var(--fg)] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GripVertical size={18} />
        </button>
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-xs font-semibold text-[var(--fg-muted)]">{index + 1}</span>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-[var(--surface)]">
          {open ? <ChevronDown size={16} className="shrink-0 text-[var(--fg-muted)]" /> : <ChevronRight size={16} className="shrink-0 text-[var(--fg-muted)]" />}
          <span className="truncate font-mono text-sm text-[var(--fg)]">{address || "—"}</span>
          {preset ? <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)]">{ru ? preset.ru : preset.en}</span> : null}
          {summary.length ? <span className="hidden truncate text-[11px] text-[var(--fg-subtle)] md:inline">{summary.join(" · ")}</span> : null}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button type="button" className={iconBtn} disabled={readOnly} onClick={onDuplicate} aria-label="duplicate">
            <Copy size={15} />
          </button>
          <button type="button" className={`${iconBtn} !text-rose-300 hover:!bg-rose-500/10`} disabled={readOnly} onClick={onRemove} aria-label="delete">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {open ? (
        <div className="space-y-3 border-t border-[var(--border)] p-3.5">
          <FieldGrid>
            <Field label={tr("dnsAddress", "Address")} hint={tr("dnsAddressHint", "IP, host, or a URL: https://, https+local://, tcp://, quic+local://.")} wide>
              <div className="flex flex-wrap gap-2">
                <div className="w-full sm:w-64">
                  <SelectField
                    value={preset ? preset.value : "__custom__"}
                    disabled={readOnly}
                    onChange={(v) => setAddress(v === "__custom__" ? "" : v)}
                    options={[
                      ...SERVER_PRESETS.map((p) => ({ value: p.value, label: `${ru ? p.ru : p.en} — ${p.value}` })),
                      { value: "__custom__", label: tr("dnsCustomAddress", "Custom address…") },
                    ]}
                  />
                </div>
                {!preset ? (
                  <div className="min-w-[14rem] flex-1">
                    <TextField mono value={address} disabled={readOnly} placeholder="1.1.1.1" onChange={setAddress} />
                  </div>
                ) : null}
              </div>
            </Field>
            <>
                <Field label={tr("dnsPort", "Port")}>
                  <NumberField value={obj.port} min={1} disabled={readOnly} placeholder="53" onChange={(v) => setField("port", v)} />
                </Field>
                <Field label="queryStrategy">
                  <SelectField
                    value={typeof obj.queryStrategy === "string" ? obj.queryStrategy : ""}
                    disabled={readOnly}
                    onChange={(v) => setField("queryStrategy", v)}
                    options={[{ value: "", label: tr("dnsInherit", "Inherit") }, ...QUERY_STRATEGIES.map((q) => ({ value: q }))]}
                  />
                </Field>
                <Field label={tr("dnsDomains", "Only for these domains")} hint={tr("dnsDomainsHint", "Leave empty to use this server for everything not claimed by another.")} wide>
                  <TagChipsInput values={domains} onChange={(v) => setField("domains", v)} suggestions={domainSuggestions} disabled={readOnly} placeholder="geosite:cn, domain:example.com" />
                </Field>
                <Field label={tr("dnsExpectIps", "Trust the answer only if it falls in")} hint={tr("dnsExpectIpsHint", "Answers outside these ranges are discarded and the next server is tried.")} wide>
                  <TagChipsInput values={expect} onChange={(v) => setField(expectKey, v)} suggestions={ipSuggestions} disabled={readOnly} placeholder="geoip:cn" />
                </Field>
                <Field label="clientIp">
                  <TextField mono value={typeof obj.clientIp === "string" ? obj.clientIp : ""} disabled={readOnly} onChange={(v) => setField("clientIp", v)} />
                </Field>
                <Field label="timeoutMs">
                  <NumberField value={obj.timeoutMs} min={0} disabled={readOnly} onChange={(v) => setField("timeoutMs", v)} />
                </Field>
            </>
          </FieldGrid>
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow label="skipFallback" hint={tr("dnsSkipFallbackHint", "Do not use this server as a fallback for other domains.")} checked={obj.skipFallback === true} disabled={readOnly} onChange={(on) => setField("skipFallback", on ? true : undefined)} />
            <ToggleRow label="finalQuery" hint={tr("dnsFinalQueryHint", "Stop after this server even if the answer is rejected.")} checked={obj.finalQuery === true} disabled={readOnly} onChange={(on) => setField("finalQuery", on ? true : undefined)} />
          </div>
        </div>
      ) : null}
    </Reorder.Item>
  );
}

function HostsEditor({
  hosts,
  readOnly,
  tr,
  onChange,
}: {
  hosts: DnsHostRow[];
  readOnly: boolean;
  tr: Tr;
  onChange: (next: DnsHostRow[]) => void;
}) {
  const update = (i: number, p: Partial<DnsHostRow>) => onChange(hosts.map((h, j) => (j === i ? { ...h, ...p } : h)));
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-semibold text-[var(--fg)]">
          {tr("dnsHosts", "Static hosts")} <span className="font-normal text-[var(--fg-muted)]">({hosts.length})</span>
        </div>
        <p className="text-xs text-[var(--fg-subtle)]">
          {tr("dnsHostsHint", "Answer for a domain without asking any server: one or more IPs, or another domain as an alias.")}
        </p>
      </div>
      {hosts.length === 0 ? <EmptyNote>{tr("dnsNoHosts", "No static hosts.")}</EmptyNote> : null}
      {hosts.map((h, i) => (
        <div key={h.id} className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">{tr("dnsHostPattern", "Domain")}</label>
            <TextField mono value={h.key} disabled={readOnly} placeholder="domain:example.com" onChange={(v) => update(i, { key: v })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">{tr("dnsHostAnswer", "Answer")}</label>
            <TagChipsInput
              values={h.values.filter(Boolean)}
              onChange={(v) => update(i, { values: v.length ? v : [""], asArray: v.length > 1 || h.asArray })}
              disabled={readOnly}
              placeholder="127.0.0.1"
            />
          </div>
          <button
            type="button"
            disabled={readOnly}
            aria-label="remove"
            onClick={() => onChange(hosts.filter((_, j) => j !== i))}
            className="mt-6 rounded-lg p-1.5 text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-30"
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <AddButton disabled={readOnly} onClick={() => onChange([...hosts, newHostRow()])}>
        {tr("dnsAddHost", "Add host")}
      </AddButton>
    </div>
  );
}
