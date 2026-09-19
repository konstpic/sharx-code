"use client";

import { useMemo } from "react";
import { isRecord, stringList } from "@/lib/xrayConfigSections";
import { TagChipsInput } from "@/components/xray/routing/TagChipsInput";
import { Field, FieldGrid, NumberField, SelectField, TextField, ToggleRow, makeTr, useJsonObject, type SectionEditorProps, type Tr } from "../fields";

const PROBE_URLS = [
  "https://www.google.com/generate_204",
  "https://www.gstatic.com/generate_204",
  "https://cp.cloudflare.com/generate_204",
  "http://connectivitycheck.gstatic.com/generate_204",
];

function SelectorField({ values, onChange, readOnly, tags, tr }: { values: string[]; onChange: (v: string[]) => void; readOnly: boolean; tags: string[]; tr: Tr }) {
  const matched = tags.filter((t) => values.some((s) => s && t.startsWith(s)));
  return (
    <Field
      label={tr("subjectSelector", "Outbounds to probe")}
      hint={tr("subjectSelectorHint", "Outbound tags or tag prefixes. A prefix like \"proxy-\" selects every outbound starting with it.")}
      wide
    >
      <TagChipsInput
        values={values}
        onChange={onChange}
        disabled={readOnly}
        suggestions={tags.map((t) => ({ value: t }))}
        placeholder="proxy-"
      />
      <div className="mt-1 text-[11px] text-[var(--fg-subtle)]">
        {tr("selectorMatches", "Matches {{n}} outbound(s)", { n: matched.length })}
        {matched.length > 0 ? `: ${matched.slice(0, 6).join(", ")}${matched.length > 6 ? "…" : ""}` : ""}
      </div>
    </Field>
  );
}

function UrlField({ label, value, onChange, readOnly, tr }: { label: string; value: string; onChange: (v: string) => void; readOnly: boolean; tr: Tr }) {
  const preset = PROBE_URLS.includes(value) ? value : "__custom__";
  return (
    <Field label={label} wide>
      <div className="flex flex-wrap gap-2">
        <div className="w-full sm:w-72">
          <SelectField
            value={preset}
            disabled={readOnly}
            onChange={(v) => onChange(v === "__custom__" ? "https://" : v)}
            options={[...PROBE_URLS.map((u) => ({ value: u })), { value: "__custom__", label: tr("customUrl", "Custom URL…") }]}
          />
        </div>
        {preset === "__custom__" ? (
          <div className="min-w-[14rem] flex-1">
            <TextField mono value={value} disabled={readOnly} onChange={onChange} placeholder="https://example.com/generate_204" />
          </div>
        ) : null}
      </div>
    </Field>
  );
}

export function ObservatoryEditor({ value, onChange, readOnly, t, tags }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { obj, patch } = useJsonObject(value, onChange);
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--fg-subtle)]">
        {tr("observatoryHint", "Periodically probes outbounds. Balancers with the leastPing strategy pick the fastest one from these results.")}
      </p>
      <FieldGrid>
        <SelectorField
          values={stringList(obj.subjectSelector)}
          onChange={(v) => patch({ subjectSelector: v })}
          readOnly={readOnly}
          tags={tags.outbounds.map((o) => o.tag)}
          tr={tr}
        />
        <UrlField
          label={tr("probeUrl", "Probe URL")}
          value={typeof obj.probeUrl === "string" ? obj.probeUrl : PROBE_URLS[0]!}
          readOnly={readOnly}
          tr={tr}
          onChange={(v) => patch({ probeUrl: v })}
        />
        <Field label={tr("probeInterval", "Probe interval")} hint={tr("durationHint", "Duration such as 10s, 5m or 1h.")}>
          <TextField mono value={typeof obj.probeInterval === "string" ? obj.probeInterval : ""} disabled={readOnly} placeholder="10s" onChange={(v) => patch({ probeInterval: v === "" ? undefined : v })} />
        </Field>
      </FieldGrid>
      <ToggleRow
        label={tr("enableConcurrency", "Probe concurrently")}
        hint={tr("enableConcurrencyHint", "Test all selected outbounds at once instead of one by one.")}
        checked={obj.enableConcurrency === true}
        disabled={readOnly}
        onChange={(v) => patch({ enableConcurrency: v })}
      />
    </div>
  );
}

export function BurstObservatoryEditor({ value, onChange, readOnly, t, tags }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { obj, patch } = useJsonObject(value, onChange);
  const ping = isRecord(obj.pingConfig) ? obj.pingConfig : {};
  const setPing = (p: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...ping };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    patch({ pingConfig: next });
  };
  const str = (k: string) => (typeof ping[k] === "string" ? (ping[k] as string) : "");
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--fg-subtle)]">
        {tr("burstHint", "Samples outbound latency in bursts. Required by the leastLoad balancer strategy.")}
      </p>
      <FieldGrid>
        <SelectorField
          values={stringList(obj.subjectSelector)}
          onChange={(v) => patch({ subjectSelector: v })}
          readOnly={readOnly}
          tags={tags.outbounds.map((o) => o.tag)}
          tr={tr}
        />
        <UrlField label={tr("pingDestination", "Ping destination")} value={str("destination") || PROBE_URLS[0]!} readOnly={readOnly} tr={tr} onChange={(v) => setPing({ destination: v })} />
        <Field label={tr("pingInterval", "Interval")} hint={tr("durationHint", "Duration such as 10s, 5m or 1h.")}>
          <TextField mono value={str("interval")} disabled={readOnly} placeholder="1h" onChange={(v) => setPing({ interval: v === "" ? undefined : v })} />
        </Field>
        <Field label={tr("pingTimeout", "Timeout")}>
          <TextField mono value={str("timeout")} disabled={readOnly} placeholder="30s" onChange={(v) => setPing({ timeout: v === "" ? undefined : v })} />
        </Field>
        <Field label={tr("pingSampling", "Samples per outbound")}>
          <NumberField value={ping.sampling} min={1} disabled={readOnly} onChange={(v) => setPing({ sampling: v })} />
        </Field>
        <Field label={tr("pingConnectivity", "Connectivity check URL")} hint={tr("pingConnectivityHint", "Optional URL fetched directly to tell \"no internet\" from \"proxy down\".")}>
          <TextField mono value={str("connectivity")} disabled={readOnly} onChange={(v) => setPing({ connectivity: v })} />
        </Field>
      </FieldGrid>
    </div>
  );
}
