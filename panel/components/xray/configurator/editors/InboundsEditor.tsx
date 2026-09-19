"use client";

import { Reorder } from "framer-motion";
import { useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui";
import { getPath, setPath, type Rec } from "@/lib/jsonPath";
import { isRecord } from "@/lib/xrayConfigSections";
import {
  AddButton,
  Disclosure,
  EmptyNote,
  Field,
  FieldGrid,
  JsonArea,
  NumberField,
  ReorderCard,
  SelectField,
  SubSection,
  TextField,
  ToggleChip,
  ToggleRow,
  makeTr,
  moveItem,
  useJsonArray,
  type SectionEditorProps,
} from "../fields";

const PROTOCOLS = ["dokodemo-door", "http", "socks", "mixed", "vless", "vmess", "trojan", "shadowsocks", "wireguard", "tunnel"];
const SNIFF_TARGETS = ["http", "tls", "quic", "fakedns"];

type Item = { id: string; raw: Rec };

let seq = 0;
const nextId = () => `ib-${Date.now().toString(36)}-${seq++}`;

export function InboundsEditor({ value, onChange, readOnly, t }: SectionEditorProps) {
  const tr = useMemo(() => makeTr(t), [t]);
  const { arr, set } = useJsonArray(value, onChange);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Stable ids for drag-and-drop: the section JSON has no ids, so keep them beside the parsed array.
  const [ids, setIds] = useState<string[]>([]);
  const items: Item[] = arr.map((x, i) => ({ id: ids[i] ?? `ib-init-${i}`, raw: isRecord(x) ? x : {} }));

  const commit = (next: Item[]) => {
    setIds(next.map((n) => n.id));
    set(next.map((n) => n.raw));
  };
  const update = (i: number, path: (string | number)[], v: unknown) => commit(items.map((it, j) => (j === i ? { ...it, raw: setPath(it.raw, path, v) } : it)));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOpen = items.length > 0 && items.every((it) => open.has(it.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-xs text-[var(--fg-subtle)]">
          {tr("inboundsHint", "Client-facing inbounds are managed on the Inbounds page. This list holds the core template's own inbounds, such as the API inbound.")}
        </p>
        {items.length > 0 ? (
          <Button type="button" variant="ghost" className="!gap-1.5 !px-2.5 !py-1.5 !text-xs" onClick={() => setOpen(allOpen ? new Set() : new Set(items.map((i) => i.id)))}>
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            {allOpen ? t("pages.xray.routingBuilder.collapseAll", { defaultValue: "Collapse all" }) : t("pages.xray.routingBuilder.expandAll", { defaultValue: "Expand all" })}
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? <EmptyNote>{tr("inboundsEmpty", "No inbounds in the template.")}</EmptyNote> : null}

      <Reorder.Group axis="y" values={items} onReorder={(next) => !readOnly && commit(next)} as="div" className="space-y-2">
        {items.map((it, i) => {
          const raw = it.raw;
          const tag = typeof raw.tag === "string" ? raw.tag : "";
          const protocol = typeof raw.protocol === "string" ? raw.protocol : "";
          const listen = typeof raw.listen === "string" ? raw.listen : "";
          const port = raw.port != null ? String(raw.port) : "";
          const sniffOn = getPath(raw, ["sniffing", "enabled"]) === true;
          const dest = Array.isArray(getPath(raw, ["sniffing", "destOverride"])) ? (getPath(raw, ["sniffing", "destOverride"]) as unknown[]).filter((x): x is string => typeof x === "string") : [];
          return (
            <ReorderCard
              key={it.id}
              value={it}
              index={i}
              total={items.length}
              open={open.has(it.id)}
              onToggle={() => toggle(it.id)}
              readOnly={readOnly}
              title={tag || <em className="text-[var(--fg-subtle)]">no tag</em>}
              badges={protocol ? <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)]">{protocol}</span> : null}
              summary={[listen || "0.0.0.0", port].filter(Boolean).join(":") + (sniffOn ? " · sniffing" : "")}
              onMove={(to) => commit(moveItem(items, i, to))}
              onDuplicate={() => {
                const copy: Item = { id: nextId(), raw: { ...raw, tag: tag ? `${tag}-copy` : "" } };
                const next = items.slice();
                next.splice(i + 1, 0, copy);
                commit(next);
                setOpen((p) => new Set(p).add(copy.id));
              }}
              onRemove={() => commit(items.filter((_, j) => j !== i))}
            >
              <SubSection title={tr("inboundBasics", "Basics")}>
                <FieldGrid>
                  <Field label="tag">
                    <TextField mono value={tag} disabled={readOnly} onChange={(v) => update(i, ["tag"], v)} />
                  </Field>
                  <Field label="protocol">
                    <SelectField value={protocol} disabled={readOnly} onChange={(v) => update(i, ["protocol"], v === "" ? undefined : v)} options={[{ value: "", label: "—" }, ...PROTOCOLS.map((p) => ({ value: p }))]} />
                  </Field>
                  <Field label="listen">
                    <TextField mono value={listen} disabled={readOnly} placeholder="127.0.0.1" onChange={(v) => update(i, ["listen"], v === "" ? undefined : v)} />
                  </Field>
                  <Field label="port">
                    <NumberField value={raw.port} min={0} disabled={readOnly} onChange={(v) => update(i, ["port"], v)} />
                  </Field>
                </FieldGrid>
              </SubSection>

              <SubSection title="Sniffing">
                <div className="space-y-3">
                  <ToggleRow
                    label={tr("inboundSniffing", "Detect protocol (sniffing)")}
                    hint={tr("inboundSniffingHint", "Lets routing rules match by sniffed protocol and by the real domain behind an IP.")}
                    checked={sniffOn}
                    disabled={readOnly}
                    onChange={(on) => update(i, ["sniffing"], on ? { enabled: true, destOverride: ["http", "tls", "quic"] } : undefined)}
                  />
                  {sniffOn ? (
                    <>
                      <Field label="destOverride" hint={tr("inboundDestOverrideHint", "Replace the destination with the sniffed domain for these protocols.")}>
                        <div className="flex flex-wrap gap-1.5">
                          {SNIFF_TARGETS.map((p) => (
                            <ToggleChip
                              key={p}
                              active={dest.includes(p)}
                              disabled={readOnly}
                              onClick={() => {
                                const s = new Set(dest);
                                if (s.has(p)) s.delete(p);
                                else s.add(p);
                                update(i, ["sniffing", "destOverride"], SNIFF_TARGETS.filter((x) => s.has(x)));
                              }}
                            >
                              {p}
                            </ToggleChip>
                          ))}
                        </div>
                      </Field>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <ToggleRow label="routeOnly" hint={tr("inboundRouteOnlyHint", "Use the sniffed domain for routing only, keep the original destination.")} checked={getPath(raw, ["sniffing", "routeOnly"]) === true} disabled={readOnly} onChange={(on) => update(i, ["sniffing", "routeOnly"], on ? true : undefined)} />
                        <ToggleRow label="metadataOnly" hint={tr("inboundMetadataOnlyHint", "Use connection metadata instead of reading the payload.")} checked={getPath(raw, ["sniffing", "metadataOnly"]) === true} disabled={readOnly} onChange={(on) => update(i, ["sniffing", "metadataOnly"], on ? true : undefined)} />
                      </div>
                    </>
                  ) : null}
                </div>
              </SubSection>

              <Disclosure label={tr("inboundAdvanced", "Settings, stream settings, sniffing (JSON)")}>
                <div className="space-y-3">
                  {(["settings", "streamSettings", "sniffing"] as const).map((k) => (
                    <Field key={k} label={k}>
                      <JsonArea value={raw[k]} disabled={readOnly} rows={k === "settings" ? 6 : 4} onCommit={(v) => update(i, [k], v)} />
                    </Field>
                  ))}
                </div>
              </Disclosure>
            </ReorderCard>
          );
        })}
      </Reorder.Group>

      <AddButton
        disabled={readOnly}
        onClick={() => {
          const it: Item = { id: nextId(), raw: { tag: "", protocol: "dokodemo-door", listen: "127.0.0.1", port: 0, settings: {} } };
          commit([...items, it]);
          setOpen((p) => new Set(p).add(it.id));
        }}
      >
        {tr("addInbound", "Add inbound")}
      </AddButton>
    </div>
  );
}
