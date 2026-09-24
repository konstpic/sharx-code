"use client";

import { Reorder, useDragControls } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  GripVertical,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_DOMAIN_STRATEGIES,
  type BalancerRow,
  type FieldRuleFormRow,
  type RoutingFormState,
  defaultRoutingForm,
  isCatchAllRule,
  newBalancer,
  newEmptyRule,
  parseRoutingSection,
  serializeRoutingSection,
  splitRoutingList,
} from "@/lib/xrayRoutingForm";
import {
  DOMAIN_SUGGESTIONS,
  IP_SUGGESTIONS,
  NETWORK_OPTIONS,
  PROTOCOL_OPTIONS,
  type RoutingSuggestion,
} from "@/lib/xrayRoutingPresets";
import { Button, Input, SelectNative } from "@/components/ui";
import {
  Card,
  FieldGrid,
  NumberField,
  RowActions,
  SelectField,
  TextField,
  moveItem,
} from "@/components/xray/configurator/fields";
import { RoutingPresetCards, type RoutingPreset } from "@/components/xray/routing/RoutingPresetCards";
import { TagChipsInput, type ChipSuggestion } from "@/components/xray/routing/TagChipsInput";
import type { RoutingTagContext } from "@/components/xray/routing/useRoutingTags";

type Props = {
  value: string;
  onChange: (sectionJson: string) => void;
  readOnly: boolean;
  t: TFunction;
  syncKey: string | number;
  /** Known outbound / inbound tags used for dropdowns and validation. */
  tags?: RoutingTagContext;
};

const EMPTY_TAGS: RoutingTagContext = { outbounds: [], inbounds: [] };
const PORT_RE = /^\s*\d{1,5}(\s*-\s*\d{1,5})?(\s*,\s*\d{1,5}(\s*-\s*\d{1,5})?)*\s*$/;

type Tr = (key: string, fallback: string, vars?: Record<string, string>) => string;

function toSuggestions(list: RoutingSuggestion[], lang: string): ChipSuggestion[] {
  const ru = lang.toLowerCase().startsWith("ru");
  return list.map((s) => ({ value: s.value, hint: ru ? s.ru : s.en, prefix: s.prefix }));
}

export function RoutingBuilder({ value, onChange, readOnly, t, syncKey, tags = EMPTY_TAGS }: Props) {
  const { i18n } = useTranslation();
  const lang = i18n.language || "en";
  const tr: Tr = useCallback(
    (key, fallback, vars) => t(`pages.xray.routingBuilder.${key}`, { defaultValue: fallback, ...vars }) as string,
    [t],
  );

  const [state, setState] = useState<RoutingFormState>(() => defaultRoutingForm());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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
    (next: RoutingFormState) => {
      setState(next);
      const json = serializeRoutingSection(next);
      lastEmitted.current = json;
      onChange(json);
    },
    [onChange],
  );

  useEffect(() => {
    const syncKeyBumped = prevSyncKey.current !== syncKey;
    prevSyncKey.current = syncKey;
    if (!syncKeyBumped && lastEmitted.current != null && normJson(value) === normJson(lastEmitted.current)) {
      return;
    }
    const { state: next, error } = parseRoutingSection(value);
    if (error || !next) {
      setState(defaultRoutingForm());
      return;
    }
    setState(next);
    lastEmitted.current = serializeRoutingSection(next);
  }, [value, syncKey, normJson]);

  const rules = state.rules;
  const domainSuggestions = useMemo(() => toSuggestions(DOMAIN_SUGGESTIONS, lang), [lang]);
  const ipSuggestions = useMemo(() => toSuggestions(IP_SUGGESTIONS, lang), [lang]);

  const firstCatchAll = rules.findIndex((r) => isCatchAllRule(r));
  const outboundTagNames = useMemo(() => tags.outbounds.map((o) => o.tag), [tags.outbounds]);

  const addPreset = (preset: RoutingPreset, outboundTag: string) => {
    const added = preset.rules.map((pr) => {
      const row = newEmptyRule();
      row.outboundTag = outboundTag;
      row.domainLines = (pr.domain ?? []).join("\n");
      row.ipLines = (pr.ip ?? []).join("\n");
      row.protocolLines = (pr.protocol ?? []).join("\n");
      return row;
    });
    const at = firstCatchAll >= 0 ? firstCatchAll : rules.length;
    apply({ ...state, rules: [...rules.slice(0, at), ...added, ...rules.slice(at)] });
  };
  const balancerTags = useMemo(
    () => state.balancers.map((b) => (typeof b.raw.tag === "string" ? b.raw.tag.trim() : "")).filter(Boolean),
    [state.balancers],
  );

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rules.length || from === to) return;
    const next = rules.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    apply({ ...state, rules: next });
  };

  const addRule = () => {
    const rule = newEmptyRule();
    apply({ ...state, rules: [...rules, rule] });
    setExpanded((prev) => new Set(prev).add(rule.id));
  };

  const duplicate = (idx: number) => {
    const copy: FieldRuleFormRow = { ...newEmptyRule(), ...rules[idx]!, id: newEmptyRule().id };
    const next = rules.slice();
    next.splice(idx + 1, 0, copy);
    apply({ ...state, rules: next });
    setExpanded((prev) => new Set(prev).add(copy.id));
  };

  const allOpen = rules.length > 0 && rules.every((r) => expanded.has(r.id));
  const strategyHint: Record<string, string> = {
    AsIs: tr("strategyAsIs", "Domain rules are matched as-is; DNS is never resolved for routing."),
    IPIfNonMatch: tr(
      "strategyIPIfNonMatch",
      "If no domain rule matches, the domain is resolved and IP rules are tried. Balanced default.",
    ),
    IPOnDemand: tr(
      "strategyIPOnDemand",
      "The domain is resolved as soon as any IP rule is reached. Most accurate, slowest.",
    ),
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
        <div>
          <label className="text-xs font-medium text-[var(--fg-muted)]">{t("pages.xray.routing.domainStrategy")}</label>
          <SelectNative
            className="mt-1 w-full"
            value={state.domainStrategy}
            disabled={readOnly}
            onChange={(e) => apply({ ...state, domainStrategy: e.target.value })}
          >
            {DEFAULT_DOMAIN_STRATEGIES.map((ds) => (
              <option key={ds} value={ds}>
                {ds}
              </option>
            ))}
            {!DEFAULT_DOMAIN_STRATEGIES.includes(state.domainStrategy as (typeof DEFAULT_DOMAIN_STRATEGIES)[number]) ? (
              <option value={state.domainStrategy}>{state.domainStrategy}</option>
            ) : null}
          </SelectNative>
        </div>
        <p className="text-xs text-[var(--fg-subtle)]">{strategyHint[state.domainStrategy] ?? ""}</p>
      </div>

      <RoutingPresetCards rules={rules} outboundTags={outboundTagNames} readOnly={readOnly} onAdd={addPreset} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-[var(--fg)]">
              {t("pages.xray.routingBuilder.rules")}{" "}
              <span className="font-normal text-[var(--fg-muted)]">({rules.length})</span>
            </div>
            <p className="text-xs text-[var(--fg-subtle)]">
              {tr("firstMatch", "Rules are checked top to bottom — the first match wins. Drag the handle to reorder.")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="!gap-1.5 !px-2.5 !py-1.5 !text-xs"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(rules.map((r) => r.id)))}
          >
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            {allOpen ? tr("collapseAll", "Collapse all") : tr("expandAll", "Expand all")}
          </Button>
        </div>

        <Reorder.Group
          axis="y"
          values={rules}
          onReorder={(next) => {
            if (!readOnly) apply({ ...state, rules: next });
          }}
          className="space-y-2"
          as="div"
        >
          {rules.map((row, idx) => (
            <RuleItem
              key={row.id}
              row={row}
              index={idx}
              total={rules.length}
              open={expanded.has(row.id)}
              unreachable={firstCatchAll >= 0 && idx > firstCatchAll}
              readOnly={readOnly}
              tags={tags}
              balancerTags={balancerTags}
              domainSuggestions={domainSuggestions}
              ipSuggestions={ipSuggestions}
              tr={tr}
              onToggle={() => toggle(row.id)}
              onChange={(r) => {
                const next = rules.slice();
                next[idx] = r;
                apply({ ...state, rules: next });
              }}
              onMove={(to) => move(idx, to)}
              onDuplicate={() => duplicate(idx)}
              onRemove={() => {
                const next = rules.filter((_, i) => i !== idx);
                apply({ ...state, rules: next });
              }}
            />
          ))}
        </Reorder.Group>

        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--fg-muted)]">
            {tr("empty", "No rules yet — all traffic follows the first outbound.")}
          </div>
        ) : null}

        <Button type="button" variant="secondary" className="!gap-2" disabled={readOnly} onClick={addRule}>
          <Plus size={16} />
          {t("pages.xray.routingBuilder.addRule")}
        </Button>
      </div>

      <BalancersPanel
        balancers={state.balancers}
        outboundTags={tags.outbounds.map((o) => o.tag)}
        readOnly={readOnly}
        tr={tr}
        onChange={(next) => apply({ ...state, balancers: next })}
      />
    </div>
  );
}

function summaryChips(row: FieldRuleFormRow): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const push = (prefix: string, values: string[]) =>
    values.forEach((v) => out.push({ key: `${prefix}${v}`, label: prefix ? `${prefix}${v}` : v }));
  push("", splitRoutingList(row.domainLines));
  push("", splitRoutingList(row.ipLines));
  push("proto: ", splitRoutingList(row.protocolLines));
  if (row.network.trim()) out.push({ key: "net", label: row.network.trim().toUpperCase() });
  if (row.port.trim()) out.push({ key: "port", label: `port ${row.port.trim()}` });
  push("in: ", splitRoutingList(row.inboundTag));
  push("src: ", splitRoutingList(row.source));
  push("user: ", splitRoutingList(row.user));
  return out;
}

function RuleItem({
  row,
  index,
  total,
  open,
  unreachable,
  readOnly,
  tags,
  balancerTags,
  domainSuggestions,
  ipSuggestions,
  tr,
  onToggle,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  row: FieldRuleFormRow;
  index: number;
  total: number;
  open: boolean;
  unreachable: boolean;
  readOnly: boolean;
  tags: RoutingTagContext;
  balancerTags: string[];
  domainSuggestions: ChipSuggestion[];
  ipSuggestions: ChipSuggestion[];
  tr: Tr;
  onToggle: () => void;
  onChange: (r: FieldRuleFormRow) => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const chips = summaryChips(row);
  const catchAll = isCatchAllRule(row);
  const knownOutbounds = tags.outbounds.map((o) => o.tag);
  const outboundMissing =
    row.outboundTag.trim() !== "" && knownOutbounds.length > 0 && !knownOutbounds.includes(row.outboundTag.trim());
  const isBalancer = row.outboundTag.trim() === "" && row.balancerTag.trim() !== "";
  const balancerMissing = isBalancer && !balancerTags.includes(row.balancerTag.trim());
  const noOutbound = row.outboundTag.trim() === "" && row.balancerTag.trim() === "";

  return (
    <Reorder.Item
      value={row}
      as="div"
      dragListener={false}
      dragControls={controls}
      className={`rounded-xl border bg-[var(--bg-elevated)] ${
        unreachable ? "border-amber-500/40" : "border-[var(--border)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <button
          type="button"
          aria-label={tr("dragHandle", "Drag to reorder")}
          title={tr("dragHandle", "Drag to reorder")}
          disabled={readOnly}
          onPointerDown={(e) => {
            if (!readOnly) controls.start(e);
          }}
          className="cursor-grab touch-none rounded-lg p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface)] hover:text-[var(--fg)] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GripVertical size={18} />
        </button>
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-xs font-semibold text-[var(--fg-muted)]">
          {index + 1}
        </span>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-[var(--surface)]"
        >
          {open ? <ChevronDown size={16} className="shrink-0 text-[var(--fg-muted)]" /> : <ChevronRight size={16} className="shrink-0 text-[var(--fg-muted)]" />}
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {catchAll ? (
              <span className="text-xs italic text-[var(--fg-muted)]">{tr("anyTraffic", "Any traffic")}</span>
            ) : (
              <>
                {chips.slice(0, 4).map((c) => (
                  <span
                    key={c.key}
                    className="max-w-[16rem] truncate rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--fg)]"
                  >
                    {c.label}
                  </span>
                ))}
                {chips.length > 4 ? (
                  <span className="text-[11px] text-[var(--fg-muted)]">+{chips.length - 4}</span>
                ) : null}
              </>
            )}
          </span>
        </button>

        <ArrowRight size={16} className="hidden shrink-0 text-[var(--fg-subtle)] sm:block" />
        <span
          className={`inline-flex max-w-[12rem] shrink-0 items-center gap-1 truncate rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            noOutbound || outboundMissing || balancerMissing
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]"
          }`}
        >
          {isBalancer ? <Scale size={12} className="shrink-0" /> : null}
          {noOutbound ? tr("chooseOutbound", "Choose outbound…") : isBalancer ? row.balancerTag : row.outboundTag}
        </span>

        {unreachable ? (
          <span title={tr("unreachable", "Never reached: an earlier rule already matches all traffic.")} className="text-amber-300">
            <AlertTriangle size={16} />
          </span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <MiniBtn label={tr("moveUp", "Move up")} disabled={readOnly || index === 0} onClick={() => onMove(index - 1)}>
            <ArrowUp size={15} />
          </MiniBtn>
          <MiniBtn label={tr("moveDown", "Move down")} disabled={readOnly || index === total - 1} onClick={() => onMove(index + 1)}>
            <ArrowDown size={15} />
          </MiniBtn>
          <MiniBtn label={tr("duplicate", "Duplicate")} disabled={readOnly} onClick={onDuplicate}>
            <Copy size={15} />
          </MiniBtn>
          <MiniBtn label={tr("delete", "Delete rule")} disabled={readOnly} onClick={onRemove} danger>
            <Trash2 size={15} />
          </MiniBtn>
        </div>
      </div>

      {unreachable && !open ? (
        <p className="px-4 pb-2 text-[11px] text-amber-300">
          {tr("unreachable", "Never reached: an earlier rule already matches all traffic.")}
        </p>
      ) : null}

      {open ? (
        <RuleEditor
          row={row}
          readOnly={readOnly}
          tags={tags}
          balancerTags={balancerTags}
          domainSuggestions={domainSuggestions}
          ipSuggestions={ipSuggestions}
          tr={tr}
          outboundMissing={outboundMissing}
          unreachable={unreachable}
          onChange={onChange}
        />
      ) : null}
    </Reorder.Item>
  );
}

function MiniBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? "text-rose-300 hover:bg-rose-500/10"
          : "text-[var(--fg-muted)] hover:bg-[var(--surface)] hover:text-[var(--fg)]"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium text-[var(--fg-muted)]">{label}</label>
      {children}
      {hint ? <div className="mt-1 text-[11px] text-[var(--fg-subtle)]">{hint}</div> : null}
    </div>
  );
}

function RuleEditor({
  row,
  readOnly,
  tags,
  balancerTags,
  domainSuggestions,
  ipSuggestions,
  tr,
  outboundMissing,
  unreachable,
  onChange,
}: {
  row: FieldRuleFormRow;
  readOnly: boolean;
  tags: RoutingTagContext;
  balancerTags: string[];
  domainSuggestions: ChipSuggestion[];
  ipSuggestions: ChipSuggestion[];
  tr: Tr;
  outboundMissing: boolean;
  unreachable: boolean;
  onChange: (r: FieldRuleFormRow) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(() => Boolean(row.source.trim() || row.user.trim()));
  const [targetKind, setTargetKind] = useState<"outbound" | "balancer">(
    row.balancerTag.trim() !== "" && row.outboundTag.trim() === "" ? "balancer" : "outbound",
  );
  const balancerMissing = targetKind === "balancer" && row.balancerTag.trim() !== "" && !balancerTags.includes(row.balancerTag.trim());
  const extraKeys = Object.keys(row.extra);
  const protocols = splitRoutingList(row.protocolLines);
  const protocolExtras = protocols.filter((p) => !(PROTOCOL_OPTIONS as readonly string[]).includes(p));
  const inboundSuggestions: ChipSuggestion[] = tags.inbounds.map((o) => ({ value: o.tag, hint: o.hint }));
  const knownInbounds = new Set(tags.inbounds.map((o) => o.tag));
  const portInvalid = row.port.trim() !== "" && !PORT_RE.test(row.port);
  const networkKnown = NETWORK_OPTIONS.some((o) => o.value === row.network.trim());

  const setList = (key: "domainLines" | "ipLines" | "source", sep = "\n") => (next: string[]) =>
    onChange({ ...row, [key]: next.join(sep) });

  const toggleProtocol = (p: string) => {
    const set = new Set(protocols);
    if (set.has(p)) set.delete(p);
    else set.add(p);
    const ordered = [...PROTOCOL_OPTIONS.filter((x) => set.has(x)), ...protocolExtras.filter((x) => set.has(x))];
    onChange({ ...row, protocolLines: ordered.join("\n") });
  };

  return (
    <div className="space-y-4 border-t border-[var(--border)] p-3.5">
      {unreachable ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {tr("unreachable", "Never reached: an earlier rule already matches all traffic.")}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("sendTo", "Send matching traffic to")} wide>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <ToggleChip
              active={targetKind === "outbound"}
              disabled={readOnly}
              onClick={() => {
                setTargetKind("outbound");
                onChange({ ...row, balancerTag: "" });
              }}
            >
              {tr("targetOutbound", "Outbound")}
            </ToggleChip>
            <ToggleChip
              active={targetKind === "balancer"}
              disabled={readOnly}
              onClick={() => {
                setTargetKind("balancer");
                onChange({ ...row, outboundTag: "" });
              }}
            >
              {tr("targetBalancer", "Balancer")}
            </ToggleChip>
          </div>
          {targetKind === "outbound" ? (
            <OutboundField
              value={row.outboundTag}
              options={tags.outbounds.map((o) => o.tag)}
              readOnly={readOnly}
              tr={tr}
              onChange={(v) => onChange({ ...row, outboundTag: v })}
            />
          ) : (
            <SelectNative
              value={row.balancerTag}
              disabled={readOnly}
              onChange={(e) => onChange({ ...row, balancerTag: e.target.value })}
            >
              <option value="">{tr("chooseBalancer", "Choose balancer…")}</option>
              {balancerTags.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              {balancerMissing ? <option value={row.balancerTag}>{row.balancerTag}</option> : null}
            </SelectNative>
          )}
          {targetKind === "balancer" && balancerTags.length === 0 ? (
            <div className="mt-1 text-[11px] text-[var(--fg-subtle)]">
              {tr("noBalancersYet", "No balancers yet — create one in the Balancers block below the rules.")}
            </div>
          ) : null}
          {targetKind === "outbound" && outboundMissing ? (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-300">
              <AlertTriangle size={12} />
              {tr("outboundMissing", "This outbound tag is not defined in the config — Xray will fail to start.")}
            </div>
          ) : null}
          {balancerMissing ? (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-300">
              <AlertTriangle size={12} />
              {tr("balancerMissing", "This balancer is not defined in the config.")}
            </div>
          ) : null}
        </Field>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-subtle)]">
          {tr("conditions", "Match when (all filled conditions apply)")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("domain", "Domain")} wide hint={tr("domainHint", "Type or pick a preset. Enter, comma or paste a list to add.")}>
            <TagChipsInput
              values={splitRoutingList(row.domainLines)}
              onChange={setList("domainLines")}
              suggestions={domainSuggestions}
              placeholder="geosite:category-ads-all, domain:example.com"
              disabled={readOnly}
            />
          </Field>
          <Field label={tr("ip", "IP / CIDR")} wide>
            <TagChipsInput
              values={splitRoutingList(row.ipLines)}
              onChange={setList("ipLines")}
              suggestions={ipSuggestions}
              placeholder="geoip:private, 10.0.0.0/8"
              disabled={readOnly}
            />
          </Field>
          <Field label={tr("protocol", "Sniffed protocol")} wide>
            <div className="flex flex-wrap gap-1.5">
              {PROTOCOL_OPTIONS.map((p) => (
                <ToggleChip key={p} active={protocols.includes(p)} disabled={readOnly} onClick={() => toggleProtocol(p)}>
                  {p}
                </ToggleChip>
              ))}
              {protocolExtras.map((p) => (
                <ToggleChip key={p} active disabled={readOnly} onClick={() => toggleProtocol(p)}>
                  {p}
                </ToggleChip>
              ))}
            </div>
          </Field>
          <Field label={tr("network", "Network")}>
            <div className="flex flex-wrap gap-1.5">
              {NETWORK_OPTIONS.map((o) => (
                <ToggleChip
                  key={o.value}
                  active={row.network.trim() === o.value}
                  disabled={readOnly}
                  onClick={() => onChange({ ...row, network: o.value })}
                >
                  {o.value === "" ? tr("anyNetwork", "Any") : o.label}
                </ToggleChip>
              ))}
              {!networkKnown ? (
                <ToggleChip active disabled={readOnly} onClick={() => onChange({ ...row, network: "" })}>
                  {row.network.trim()}
                </ToggleChip>
              ) : null}
            </div>
          </Field>
          <Field
            label={tr("port", "Port")}
            hint={
              portInvalid ? (
                <span className="text-rose-300">{tr("portInvalid", "Use ports and ranges, e.g. 443, 80-90")}</span>
              ) : (
                tr("portHint", "Single port, list or range: 443, 80-90, 8000-9000")
              )
            }
          >
            <Input
              className={`w-full font-mono ${portInvalid ? "!border-rose-500/60" : ""}`}
              value={row.port}
              disabled={readOnly}
              placeholder="443, 80-90"
              onChange={(e) => onChange({ ...row, port: e.target.value })}
            />
          </Field>
          <Field label={tr("inbound", "Inbound")} wide hint={tr("inboundHint", "Only traffic that arrived through these inbounds.")}>
            <TagChipsInput
              values={splitRoutingList(row.inboundTag)}
              onChange={(next) => onChange({ ...row, inboundTag: next.join(", ") })}
              suggestions={inboundSuggestions}
              placeholder={tr("inboundPlaceholder", "Pick an inbound tag")}
              disabled={readOnly}
              isUnknown={(v) => knownInbounds.size > 0 && !knownInbounds.has(v)}
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {tr("advanced", "More conditions (source IP, user)")}
        </button>
        {extraKeys.length > 0 ? (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[11px] text-[var(--fg-muted)]">
            {tr("extraKept", "Also kept unchanged in this rule:")} <span className="font-mono">{extraKeys.join(", ")}</span>
          </div>
        ) : null}
        {showAdvanced ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label={tr("source", "Source IP / CIDR")} wide>
              <TagChipsInput
                values={splitRoutingList(row.source)}
                onChange={setList("source")}
                placeholder="192.168.0.0/16"
                disabled={readOnly}
              />
            </Field>
            <Field label={tr("user", "User (email)")} wide>
              <TagChipsInput
                values={splitRoutingList(row.user)}
                onChange={(next) => onChange({ ...row, user: next.join(", ") })}
                placeholder="user@example.com"
                disabled={readOnly}
                mono={false}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToggleChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
          : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
      }`}
    >
      {children}
    </button>
  );
}

const CUSTOM_OPTION = "__custom__";

function OutboundField({
  value,
  options,
  readOnly,
  tr,
  onChange,
}: {
  value: string;
  options: string[];
  readOnly: boolean;
  tr: Tr;
  onChange: (v: string) => void;
}) {
  const trimmed = value.trim();
  const [forceCustom, setForceCustom] = useState(false);
  const custom = forceCustom || options.length === 0 || (trimmed !== "" && !options.includes(trimmed));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-[12rem] flex-1">
        <SelectNative
          value={custom ? CUSTOM_OPTION : trimmed}
          disabled={readOnly}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM_OPTION) {
              setForceCustom(true);
              return;
            }
            setForceCustom(false);
            onChange(v);
          }}
        >
          <option value="">{tr("chooseOutbound", "Choose outbound…")}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value={CUSTOM_OPTION}>{tr("customTag", "Custom tag…")}</option>
        </SelectNative>
      </div>
      {custom ? (
        <Input
          className="min-w-[12rem] flex-1 font-mono"
          value={value}
          disabled={readOnly}
          placeholder="outbound tag"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}

const BALANCER_STRATEGIES = ["random", "roundRobin", "leastPing", "leastLoad"];

function BalancersPanel({
  balancers,
  outboundTags,
  readOnly,
  tr,
  onChange,
}: {
  balancers: BalancerRow[];
  outboundTags: string[];
  readOnly: boolean;
  tr: Tr;
  onChange: (next: BalancerRow[]) => void;
}) {
  const update = (i: number, p: Record<string, unknown>) =>
    onChange(
      balancers.map((b, j) => {
        if (j !== i) return b;
        const raw: Record<string, unknown> = { ...b.raw };
        for (const [k, v] of Object.entries(p)) {
          if (v === undefined) delete raw[k];
          else raw[k] = v;
        }
        return { ...b, raw };
      }),
    );

  return (
    <div className="space-y-2 border-t border-[var(--border)] pt-4">
      <div>
        <div className="text-sm font-semibold text-[var(--fg)]">
          {tr("balancers", "Balancers")} <span className="font-normal text-[var(--fg-muted)]">({balancers.length})</span>
        </div>
        <p className="text-xs text-[var(--fg-subtle)]">
          {tr("balancersHint", "A balancer spreads matching traffic across several outbounds. Point a rule at it using \"Balancer\".")}
        </p>
      </div>

      {balancers.map((b, i) => {
        const raw = b.raw;
        const selector = Array.isArray(raw.selector) ? (raw.selector as unknown[]).filter((x): x is string => typeof x === "string") : [];
        const strategy = typeof (raw.strategy as Record<string, unknown> | undefined)?.type === "string" ? String((raw.strategy as Record<string, unknown>).type) : "random";
        const settings = ((raw.strategy as Record<string, unknown> | undefined)?.settings ?? {}) as Record<string, unknown>;
        const matched = outboundTags.filter((t) => selector.some((s) => s && t.startsWith(s)));
        const setStrategy = (type: string, nextSettings?: Record<string, unknown>) => {
          const st: Record<string, unknown> = { ...((raw.strategy as Record<string, unknown> | undefined) ?? {}), type };
          if (nextSettings !== undefined) {
            if (Object.keys(nextSettings).length === 0) delete st.settings;
            else st.settings = nextSettings;
          }
          update(i, { strategy: type === "random" && !st.settings ? undefined : st });
        };
        const setSetting = (k: string, v: unknown) => {
          const next = { ...settings };
          if (v === undefined || v === "") delete next[k];
          else next[k] = v;
          setStrategy(strategy, next);
        };
        return (
          <Card
            key={b.id}
            title={
              <span className="flex items-center gap-2">
                <Scale size={14} className="text-[var(--fg-muted)]" />
                {typeof raw.tag === "string" && raw.tag ? raw.tag : `${tr("balancer", "Balancer")} ${i + 1}`}
              </span>
            }
            actions={
              <RowActions
                index={i}
                total={balancers.length}
                readOnly={readOnly}
                tr={(k, f) => tr(k, f)}
                onMove={(to) => onChange(moveItem(balancers, i, to))}
                onRemove={() => onChange(balancers.filter((_, j) => j !== i))}
              />
            }
          >
            <FieldGrid>
              <Field label="tag">
                <TextField mono value={typeof raw.tag === "string" ? raw.tag : ""} disabled={readOnly} onChange={(v) => update(i, { tag: v })} />
              </Field>
              <Field label={tr("balancerStrategy", "Strategy")} hint={strategyHintFor(strategy, tr)}>
                <SelectField
                  value={strategy}
                  disabled={readOnly}
                  onChange={(v) => setStrategy(v)}
                  options={BALANCER_STRATEGIES.map((v) => ({ value: v }))}
                />
              </Field>
              <Field
                label={tr("balancerSelector", "Outbounds in the balancer")}
                hint={`${tr("balancerSelectorHint", "Tags or tag prefixes.")} ${tr("selectorMatches", "Matches {{n}} outbound(s)", { n: String(matched.length) })}`}
                wide
              >
                <TagChipsInput
                  values={selector}
                  onChange={(v) => update(i, { selector: v })}
                  disabled={readOnly}
                  suggestions={outboundTags.map((t) => ({ value: t }))}
                  placeholder="proxy-"
                  isUnknown={(v) => outboundTags.length > 0 && !outboundTags.some((t) => t.startsWith(v))}
                />
              </Field>
              <Field label={tr("balancerFallback", "Fallback outbound")} hint={tr("balancerFallbackHint", "Used when no outbound in the balancer is available.")}>
                <SelectField
                  value={typeof raw.fallbackTag === "string" ? raw.fallbackTag : ""}
                  disabled={readOnly}
                  onChange={(v) => update(i, { fallbackTag: v === "" ? undefined : v })}
                  options={[{ value: "", label: tr("noFallback", "None") }, ...outboundTags.map((t) => ({ value: t }))]}
                />
              </Field>
              {strategy === "leastLoad" ? (
                <>
                  <Field label="expected" hint={tr("leastLoadExpected", "How many of the best outbounds to use.")}>
                    <NumberField value={settings.expected} min={1} disabled={readOnly} onChange={(v) => setSetting("expected", v)} />
                  </Field>
                  <Field label="maxRTT" hint={tr("leastLoadMaxRtt", "Ignore outbounds slower than this, e.g. 1s.")}>
                    <TextField mono value={typeof settings.maxRTT === "string" ? settings.maxRTT : ""} disabled={readOnly} placeholder="1s" onChange={(v) => setSetting("maxRTT", v)} />
                  </Field>
                  <Field label="tolerance" hint={tr("leastLoadTolerance", "0 – 1, allowed deviation among the chosen ones.")}>
                    <NumberField value={settings.tolerance} min={0} disabled={readOnly} onChange={(v) => setSetting("tolerance", v)} />
                  </Field>
                </>
              ) : null}
            </FieldGrid>
          </Card>
        );
      })}

      <Button
        type="button"
        variant="secondary"
        className="!gap-2"
        disabled={readOnly}
        onClick={() => onChange([...balancers, newBalancer(`balancer-${balancers.length + 1}`)])}
      >
        <Plus size={16} />
        {tr("addBalancer", "Add balancer")}
      </Button>
    </div>
  );
}

function strategyHintFor(strategy: string, tr: Tr): string {
  switch (strategy) {
    case "roundRobin":
      return tr("strategyRoundRobin", "Cycles through outbounds in order.");
    case "leastPing":
      return tr("strategyLeastPing", "Picks the lowest-latency outbound. Needs Observatory.");
    case "leastLoad":
      return tr("strategyLeastLoad", "Picks among the best outbounds by measured load. Needs Burst Observatory.");
    default:
      return tr("strategyRandom", "Picks an outbound at random.");
  }
}
