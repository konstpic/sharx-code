"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { StreamFormState } from "@/lib/inboundDefaults";
import {
  countFinalmaskMasksOutsideEditor,
  defaultFinalmaskQuicParams,
  defaultFinalmaskSettings,
  finalmaskShowsUdphop,
  finalmaskSidesFor,
  finalmaskUsesQuic,
  hasFinalmaskQuicParams,
  orderFinalmaskUdp,
  patchFinalmaskQuicParams,
  readFinalmaskQuicParams,
  validateFinalmask,
  type FMItem,
  type FinalmaskIssue,
  type FinalmaskQuicFields,
  type FinalmaskSide,
  type FinalmaskState,
} from "@/lib/finalmaskDefaults";
import { Input, PillTag, SelectNative, Switch } from "@/components/ui";

type Props = {
  streamForm: Pick<StreamFormState, "finalmaskTcp" | "finalmaskUdp" | "finalmaskQuicParams">;
  setStreamFormField: <K extends keyof StreamFormState>(
    key: K,
    value: StreamFormState[K],
  ) => void;
  idPrefix: string;
  disabled?: boolean;
  /** Inbound protocol: gates which mask cards exist (see finalmaskSidesFor). */
  protocol: string;
  /** streamSettings.network (canonical or alias value). */
  network: string;
  /** streamSettings.security; ALPN h3 only enables the QUIC path with "tls". */
  security: string;
  /** streamSettings.tlsSettings.alpn, comma separated. */
  alpn: string;
};

const labelCls = "mb-1 block text-[11px] font-medium text-[var(--fg-muted)]";
const errCls = "mt-0.5 text-[11px] text-red-400";
const hintCls = "mt-1 text-[11px] text-[var(--fg-subtle)]";
const cardCls = "rounded-lg border border-[var(--border)]/60 bg-[var(--surface)] p-3";

const HYSTERIA_PROTOCOLS = new Set(["hysteria", "hysteria2"]);

function normType(type: unknown): string {
  return typeof type === "string" ? type.trim().toLowerCase() : "";
}

/** Comma/newline separated list; the form always stores an array. */
function splitList(text: string): string[] {
  return text
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Number / range / string setting rendered as text. */
function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

/** Text input backed by a local draft so typing "100-2" does not fight the form. */
function ListInput({
  id,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  value: unknown;
  placeholder?: string;
  disabled?: boolean;
  onChange: (list: string[]) => void;
}) {
  const joined = Array.isArray(value) ? value.map((v) => String(v)).join(", ") : "";
  const [draft, setDraft] = useState(joined);
  useEffect(() => {
    setDraft((prev) =>
      splitList(prev).join("\u0000") === splitList(joined).join("\u0000") ? prev : joined,
    );
  }, [joined]);
  return (
    <Input
      id={id}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(splitList(e.target.value));
      }}
    />
  );
}

function IssueList({ issues }: { issues: FinalmaskIssue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {issues.map((is, i) => (
        <li key={`${is.code}-${i}`} className={is.severity === "error" ? errCls : "mt-0.5 text-[11px] text-amber-400"}>
          {t(`finalmask.error.${is.code}`, { defaultValue: is.message })}
        </li>
      ))}
    </ul>
  );
}

function Field({
  id,
  label,
  required,
  hint,
  errors,
  className = "",
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  errors: FinalmaskIssue[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className={labelCls} htmlFor={id}>
        {label}
        {required ? <span className="text-red-400"> *</span> : null}
      </label>
      {children}
      {hint ? <p className={hintCls}>{hint}</p> : null}
      <IssueList issues={errors} />
    </div>
  );
}

function MaskCard({
  title,
  type,
  badge,
  enabled,
  disabled,
  onToggle,
  note,
  children,
}: {
  title: string;
  type: string;
  badge?: ReactNode;
  enabled: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-medium text-[var(--fg)]">{title}</p>
            {badge}
          </div>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--fg-subtle)]">
            {type}
          </p>
        </div>
        <Switch checked={enabled} onChange={onToggle} disabled={disabled} size="sm" ariaLabel={title} />
      </div>
      {note ? <div className="mt-1.5 text-[11px] leading-snug text-[var(--fg-subtle)]">{note}</div> : null}
      {enabled && children ? (
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">{children}</div>
      ) : null}
    </div>
  );
}

export function FinalmaskEditor({
  streamForm,
  setStreamFormField,
  idPrefix,
  disabled = false,
  protocol,
  network,
  security,
  alpn,
}: Props) {
  const { t } = useTranslation();
  const state = useMemo<FinalmaskState>(
    () => ({
      finalmaskTcp: streamForm.finalmaskTcp,
      finalmaskUdp: streamForm.finalmaskUdp,
      finalmaskQuicParams: streamForm.finalmaskQuicParams,
    }),
    [streamForm.finalmaskTcp, streamForm.finalmaskUdp, streamForm.finalmaskQuicParams],
  );
  const sidesQuery = useMemo(
    () => ({ protocol, network, security, alpn }),
    [protocol, network, security, alpn],
  );
  const sides = useMemo(() => finalmaskSidesFor(sidesQuery), [sidesQuery]);
  const issues = useMemo(() => validateFinalmask(state, sidesQuery), [state, sidesQuery]);
  const outsideCount = useMemo(
    () => countFinalmaskMasksOutsideEditor(state, sidesQuery),
    [state, sidesQuery],
  );

  const itemsFor = (side: FinalmaskSide): FMItem[] =>
    side === "tcp" ? state.finalmaskTcp : state.finalmaskUdp;

  const setItems = (side: FinalmaskSide, items: FMItem[]) => {
    if (side === "tcp") setStreamFormField("finalmaskTcp", items);
    else setStreamFormField("finalmaskUdp", orderFinalmaskUdp(items));
  };

  const findItem = (side: FinalmaskSide, type: string): FMItem | undefined =>
    itemsFor(side).find((item) => normType(item.type) === type);

  const toggleMask = (side: FinalmaskSide, type: string) => {
    const items = itemsFor(side);
    if (items.some((item) => normType(item.type) === type)) {
      setItems(
        side,
        items.filter((item) => normType(item.type) !== type),
      );
      return;
    }
    setItems(side, [...items, { type, settings: defaultFinalmaskSettings(side, type) }]);
  };

  const patchMask = (side: FinalmaskSide, type: string, patch: Record<string, unknown>) => {
    const items = itemsFor(side);
    const index = items.findIndex((item) => normType(item.type) === type);
    if (index < 0) return;
    const item = items[index];
    const settings = { ...item.settings };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete settings[key];
      else settings[key] = value;
    }
    setItems(
      side,
      items.map((it, i) => (i === index ? { ...it, settings } : it)),
    );
  };

  const issuesForMask = (side: FinalmaskSide, type: string): FinalmaskIssue[] => {
    const index = itemsFor(side).findIndex((item) => normType(item.type) === type);
    if (index < 0) return [];
    const prefix = `streamSettings.finalmask.${side}[${index}]`;
    return issues.filter((is) => is.path === prefix || is.path.startsWith(`${prefix}.`));
  };

  const fieldErrors = (list: FinalmaskIssue[], field: string): FinalmaskIssue[] =>
    list.filter((is) => is.path.endsWith(`.${field}`));

  const transportIssues = issues.filter((is) => is.code.startsWith("transport_"));
  const quicIssues = issues.filter((is) => is.path.startsWith("streamSettings.finalmask.quicParams"));
  const quicGeneralIssues = quicIssues.filter(
    (is) =>
      !["congestion", "brutalUp", "brutalDown", "maxIdleTimeout", "keepAlivePeriod"].some((field) =>
        is.path.endsWith(`.${field}`),
      ),
  );

  const usesQuic = finalmaskUsesQuic(sidesQuery);
  const quicPresent = hasFinalmaskQuicParams(state.finalmaskQuicParams);
  const quic = readFinalmaskQuicParams(state.finalmaskQuicParams);
  const brutalMode = quic.congestion === "brutal" || quic.congestion === "force-brutal";
  const quicOptions = ["bbr", "brutal", "force-brutal"];
  const patchQuic = (
    patch: Partial<
      Pick<
        FinalmaskQuicFields,
        "congestion" | "brutalUp" | "brutalDown" | "maxIdleTimeout" | "keepAlivePeriod"
      >
    >,
  ) => setStreamFormField("finalmaskQuicParams", patchFinalmaskQuicParams(state.finalmaskQuicParams, patch));

  const fragment = findItem("tcp", "fragment");
  const salamander = findItem("udp", "salamander");
  const udphop = findItem("udp", "udphop");
  const isHysteria = HYSTERIA_PROTOCOLS.has(protocol.trim().toLowerCase());

  const fragmentIssues = issuesForMask("tcp", "fragment");
  const salamanderIssues = issuesForMask("udp", "salamander");
  const udphopIssues = issuesForMask("udp", "udphop");

  const networkLabel = finalmaskUsesQuic(sidesQuery)
    ? t("finalmask.networkUdpQuic", { defaultValue: "UDP (QUIC)" })
    : sides.tcp && sides.udp
      ? t("finalmask.networkBoth", { defaultValue: "TCP + UDP" })
      : sides.tcp
        ? t("finalmask.networkTcp", { defaultValue: "TCP" })
        : sides.udp
          ? t("finalmask.networkUdp", { defaultValue: "UDP" })
          : "";

  const hopMode = udphop ? textValue(udphop.settings.mode) : "";
  const hopModeIsKnown = ["intervalremote", "intervallocal", "perconnremote"].includes(hopMode);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-[var(--fg)]">
          {t("finalmask.title", { defaultValue: "Finalmask (masquerade)" })}
        </p>
        {networkLabel ? (
          <p className="text-[11px] text-[var(--fg-subtle)]">
            {t("finalmask.networkLabel", {
              network: networkLabel,
              defaultValue: "Network: {{network}}",
            })}
          </p>
        ) : null}
      </div>

      {!sides.tcp && !sides.udp ? (
        <p className="text-xs text-[var(--fg-subtle)]">
          {t("finalmask.unavailable", {
            defaultValue: "Masquerade is not available for this transport",
          })}
        </p>
      ) : null}

      {transportIssues.length > 0 && (sides.tcp || sides.udp) ? (
        <IssueList issues={transportIssues} />
      ) : null}
      {outsideCount > 0 ? (
        <p className="text-[11px] text-[var(--fg-subtle)]">
          {t("finalmask.outsideEditor", {
            count: outsideCount,
            defaultValue:
              "The config contains {{count}} mask(s) outside this editor — kept as is.",
          })}
        </p>
      ) : null}
      {quicPresent && !usesQuic ? (
        <p className="text-[11px] text-amber-400">
          {t("finalmask.quicParamsInvalid", {
            defaultValue:
              "QUIC params are stored in the config but this transport does not use QUIC — they are kept as is.",
          })}
        </p>
      ) : null}
      {sides.tcp || sides.udp ? (
        <p className="text-[11px] leading-snug text-[var(--fg-subtle)]">
          {t("finalmask.orderHint", {
            defaultValue:
              "Order matters: the first array entry is the outermost layer; socket-replacing masks (xicmp/udphop) go last.",
          })}
        </p>
      ) : null}

      <div className="space-y-2.5">
        {usesQuic ? (
          <MaskCard
            title={t("finalmask.quic.title", { defaultValue: "QUIC params" })}
            type="quicParams"
            enabled={quicPresent}
            disabled={disabled}
            onToggle={(next) =>
              setStreamFormField(
                "finalmaskQuicParams",
                next ? defaultFinalmaskQuicParams() : "",
              )
            }
            note={t("finalmask.quic.hint", {
              defaultValue: "Tuning for the QUIC transport (xhttp + TLS + ALPN h3).",
            })}
          >
            {quicPresent ? (
              <>
                {quicGeneralIssues.length > 0 ? (
                  <div className="sm:col-span-2">
                    <IssueList issues={quicGeneralIssues} />
                  </div>
                ) : null}
                <Field
                  id={`${idPrefix}-fm-quic-congestion`}
                  label={t("finalmask.quic.congestion", { defaultValue: "Congestion control" })}
                  errors={fieldErrors(quicIssues, "congestion")}
                >
                  <SelectNative
                    id={`${idPrefix}-fm-quic-congestion`}
                    value={quic.congestion}
                    disabled={disabled}
                    onChange={(e) => patchQuic({ congestion: e.target.value })}
                  >
                    {quic.congestion === "" ? (
                      <option value="">
                        {t("finalmask.quic.congestionDefault", { defaultValue: "default (bbr)" })}
                      </option>
                    ) : null}
                    <option value="bbr">bbr</option>
                    <option value="brutal">brutal</option>
                    <option value="force-brutal">force-brutal</option>
                    {quic.congestion !== "" && !quicOptions.includes(quic.congestion) ? (
                      <option value={quic.congestion}>{quic.congestion}</option>
                    ) : null}
                  </SelectNative>
                </Field>
                <Field
                  id={`${idPrefix}-fm-quic-idle`}
                  label={t("finalmask.quic.maxIdleTimeout", { defaultValue: "Idle timeout (sec)" })}
                  hint={t("finalmask.quic.maxIdleTimeoutHint", { defaultValue: "4–120, default 30" })}
                  errors={fieldErrors(quicIssues, "maxIdleTimeout")}
                >
                  <Input
                    id={`${idPrefix}-fm-quic-idle`}
                    type="number"
                    inputMode="numeric"
                    min={4}
                    max={120}
                    step={1}
                    value={quic.maxIdleTimeout}
                    placeholder="30"
                    disabled={disabled}
                    onChange={(e) => patchQuic({ maxIdleTimeout: e.target.value })}
                  />
                </Field>
                <Field
                  id={`${idPrefix}-fm-quic-keepalive`}
                  label={t("finalmask.quic.keepAlivePeriod", { defaultValue: "Keep-alive (sec)" })}
                  hint={t("finalmask.quic.keepAlivePeriodHint", { defaultValue: "2–60, default 10" })}
                  errors={fieldErrors(quicIssues, "keepAlivePeriod")}
                >
                  <Input
                    id={`${idPrefix}-fm-quic-keepalive`}
                    type="number"
                    inputMode="numeric"
                    min={2}
                    max={60}
                    step={1}
                    value={quic.keepAlivePeriod}
                    placeholder="10"
                    disabled={disabled}
                    onChange={(e) => patchQuic({ keepAlivePeriod: e.target.value })}
                  />
                </Field>
                {brutalMode ? (
                  <>
                    <Field
                      id={`${idPrefix}-fm-quic-brutal-up`}
                      label={t("finalmask.quic.brutalUp", { defaultValue: "Upload limit" })}
                      required
                      hint={t("finalmask.quic.bandwidthHint", {
                        defaultValue: "e.g. 100mbps, 100 MB/s or 1.5 gbps; a bare number means Mbps",
                      })}
                      errors={fieldErrors(quicIssues, "brutalUp")}
                    >
                      <Input
                        id={`${idPrefix}-fm-quic-brutal-up`}
                        value={quic.brutalUp}
                        placeholder="100mbps"
                        disabled={disabled}
                        spellCheck={false}
                        onChange={(e) => patchQuic({ brutalUp: e.target.value })}
                      />
                    </Field>
                    <Field
                      id={`${idPrefix}-fm-quic-brutal-down`}
                      label={t("finalmask.quic.brutalDown", { defaultValue: "Download limit" })}
                      required
                      hint={t("finalmask.quic.bandwidthHint", {
                        defaultValue: "e.g. 100mbps, 100 MB/s or 1.5 gbps; a bare number means Mbps",
                      })}
                      errors={fieldErrors(quicIssues, "brutalDown")}
                    >
                      <Input
                        id={`${idPrefix}-fm-quic-brutal-down`}
                        value={quic.brutalDown}
                        placeholder="100mbps"
                        disabled={disabled}
                        spellCheck={false}
                        onChange={(e) => patchQuic({ brutalDown: e.target.value })}
                      />
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}
          </MaskCard>
        ) : null}

        {sides.tcp ? (
          <MaskCard
            title={t("finalmask.fragment.title", { defaultValue: "TLS fragmentation" })}
            type="fragment"
            enabled={Boolean(fragment)}
            disabled={disabled}
            onToggle={() => toggleMask("tcp", "fragment")}
          >
            {fragment ? (
              <>
                <Field
                  id={`${idPrefix}-fm-lengths`}
                  label={t("finalmask.fragment.lengths", { defaultValue: "Lengths" })}
                  required
                  hint={t("finalmask.fragment.lengthsHint", {
                    defaultValue: "Split sizes, e.g. 100-200, 150-250",
                  })}
                  errors={fieldErrors(fragmentIssues, "lengths")}
                  className="sm:col-span-2"
                >
                  <ListInput
                    id={`${idPrefix}-fm-lengths`}
                    value={fragment.settings.lengths}
                    placeholder="100-200, 150-250"
                    disabled={disabled}
                    onChange={(list) => patchMask("tcp", "fragment", { lengths: list })}
                  />
                </Field>
                <Field
                  id={`${idPrefix}-fm-delays`}
                  label={t("finalmask.fragment.delays", { defaultValue: "Delays" })}
                  hint={t("finalmask.fragment.delaysHint", { defaultValue: "Milliseconds, e.g. 1-2, 3-4" })}
                  errors={fieldErrors(fragmentIssues, "delays")}
                >
                  <ListInput
                    id={`${idPrefix}-fm-delays`}
                    value={fragment.settings.delays}
                    placeholder="1-2, 3-4"
                    disabled={disabled}
                    onChange={(list) => patchMask("tcp", "fragment", { delays: list })}
                  />
                </Field>
                <Field
                  id={`${idPrefix}-fm-maxsplit`}
                  label={t("finalmask.fragment.maxSplit", { defaultValue: "Max split" })}
                  hint={t("finalmask.fragment.maxSplitHint", { defaultValue: "Optional, e.g. 10-20" })}
                  errors={fieldErrors(fragmentIssues, "maxSplit")}
                >
                  <Input
                    id={`${idPrefix}-fm-maxsplit`}
                    value={textValue(fragment.settings.maxSplit)}
                    placeholder="10-20"
                    disabled={disabled}
                    spellCheck={false}
                    onChange={(e) =>
                      patchMask("tcp", "fragment", {
                        maxSplit: e.target.value.trim() ? e.target.value : undefined,
                      })
                    }
                  />
                </Field>
                <Field
                  id={`${idPrefix}-fm-packets`}
                  label={t("finalmask.fragment.packets", { defaultValue: "Packets" })}
                  errors={fieldErrors(fragmentIssues, "packets")}
                >
                  <SelectNative
                    id={`${idPrefix}-fm-packets`}
                    value={textValue(fragment.settings.packets)}
                    disabled={disabled}
                    onChange={(e) =>
                      patchMask("tcp", "fragment", {
                        packets: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="tlshello">
                      {t("finalmask.fragment.packetsTlsHello", {
                        defaultValue: "tlshello (ClientHello)",
                      })}
                    </option>
                    <option value="">
                      {t("finalmask.fragment.packetsAll", { defaultValue: "All packets" })}
                    </option>
                    {textValue(fragment.settings.packets) !== "" &&
                    textValue(fragment.settings.packets).toLowerCase() !== "tlshello" ? (
                      <option value={textValue(fragment.settings.packets)}>
                        {textValue(fragment.settings.packets)}
                      </option>
                    ) : null}
                  </SelectNative>
                </Field>
              </>
            ) : null}
          </MaskCard>
        ) : null}

        {sides.udp && isHysteria ? (
          <div className="space-y-1">
            <p className="text-[11px] text-[var(--fg-subtle)]">
              {t("finalmask.salamander.viaObfs", {
                defaultValue: "salamander is configured by the Obfuscation fields above.",
              })}
            </p>
            <p className="text-[11px] text-[var(--fg-subtle)]">
              {t("finalmask.udphop.viaJsonOnly", {
                defaultValue:
                  "udphop is not delivered by the Hysteria 2 share link — use the subscription JSON template instead.",
              })}
            </p>
          </div>
        ) : null}

        {sides.udp && !isHysteria ? (
          <MaskCard
            title={t("finalmask.salamander.title", { defaultValue: "QUIC obfuscation" })}
            type="salamander"
            enabled={Boolean(salamander)}
            disabled={disabled}
            onToggle={() => toggleMask("udp", "salamander")}
          >
            {salamander ? (
              <>
                <Field
                  id={`${idPrefix}-fm-salamander-password`}
                  label={t("finalmask.salamander.password", { defaultValue: "Password" })}
                  required
                  hint={t("finalmask.salamander.passwordHint", {
                    defaultValue: "At least 4 bytes",
                  })}
                  errors={fieldErrors(salamanderIssues, "password")}
                >
                  <Input
                    id={`${idPrefix}-fm-salamander-password`}
                    className="font-mono"
                    value={textValue(salamander.settings.password)}
                    placeholder="strongpsk"
                    disabled={disabled}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) =>
                      patchMask("udp", "salamander", { password: e.target.value })
                    }
                  />
                </Field>
                <Field
                  id={`${idPrefix}-fm-salamander-packetsize`}
                  label={t("finalmask.salamander.packetSize", { defaultValue: "Packet size" })}
                  hint={t("finalmask.salamander.packetSizeHint", {
                    defaultValue: "Optional 0 < min <= max <= 2048",
                  })}
                  errors={fieldErrors(salamanderIssues, "packetSize")}
                >
                  <Input
                    id={`${idPrefix}-fm-salamander-packetsize`}
                    value={textValue(salamander.settings.packetSize)}
                    placeholder="1200-1400"
                    disabled={disabled}
                    spellCheck={false}
                    onChange={(e) =>
                      patchMask("udp", "salamander", {
                        packetSize: e.target.value.trim() ? e.target.value : undefined,
                      })
                    }
                  />
                </Field>
              </>
            ) : null}
          </MaskCard>
        ) : null}

        {sides.udp && finalmaskShowsUdphop(protocol) ? (
          <MaskCard
            title={t("finalmask.udphop.title", { defaultValue: "Port hopping" })}
            type="udphop"
            badge={<PillTag tone="neutral">{t("finalmask.clientOnly")}</PillTag>}
            enabled={Boolean(udphop)}
            disabled={disabled}
            onToggle={() => toggleMask("udp", "udphop")}
            note={t("finalmask.udphop.hint", {
              defaultValue:
                "Client-side mask — it is never written into the server config; on the node, DNAT the port range to the inbound port.",
            })}
          >
            {udphop ? (
              <>
                <Field
                  id={`${idPrefix}-fm-udphop-mode`}
                  label={t("finalmask.udphop.mode", { defaultValue: "Mode" })}
                  errors={fieldErrors(udphopIssues, "mode")}
                >
                  <SelectNative
                    id={`${idPrefix}-fm-udphop-mode`}
                    value={hopMode}
                    disabled={disabled}
                    onChange={(e) => patchMask("udp", "udphop", { mode: e.target.value })}
                  >
                    {hopMode === "" ? (
                      <option value="">
                        {t("finalmask.udphop.modeEmpty", { defaultValue: "Select a mode" })}
                      </option>
                    ) : null}
                    <option value="intervalremote">
                      {t("finalmask.udphop.modeIntervalRemote", {
                        defaultValue: "intervalremote (default)",
                      })}
                    </option>
                    <option value="intervallocal">
                      {t("finalmask.udphop.modeIntervalLocal", { defaultValue: "intervallocal" })}
                    </option>
                    <option value="perconnremote">
                      {t("finalmask.udphop.modePerConnRemote", {
                        defaultValue: "perconnremote",
                      })}
                    </option>
                    {hopMode && !hopModeIsKnown ? (
                      <option value={hopMode}>{hopMode}</option>
                    ) : null}
                  </SelectNative>
                </Field>
                <Field
                  id={`${idPrefix}-fm-udphop-interval`}
                  label={t("finalmask.udphop.interval", { defaultValue: "Interval (sec)" })}
                  required
                  hint={t("finalmask.udphop.intervalHint", {
                    defaultValue: "Minimum 5, ranges allowed",
                  })}
                  errors={fieldErrors(udphopIssues, "interval")}
                >
                  <Input
                    id={`${idPrefix}-fm-udphop-interval`}
                    value={textValue(udphop.settings.interval)}
                    placeholder="30"
                    disabled={disabled}
                    spellCheck={false}
                    onChange={(e) =>
                      patchMask("udp", "udphop", {
                        interval: e.target.value.trim() ? e.target.value : undefined,
                      })
                    }
                  />
                </Field>
                <Field
                  id={`${idPrefix}-fm-udphop-ips`}
                  label={t("finalmask.udphop.remoteIPs", { defaultValue: "Remote IPs" })}
                  required
                  hint={t("finalmask.udphop.remoteIPsHint", {
                    defaultValue: "IP or CIDR, comma separated",
                  })}
                  errors={fieldErrors(udphopIssues, "remoteIPs")}
                  className="sm:col-span-2"
                >
                  <ListInput
                    id={`${idPrefix}-fm-udphop-ips`}
                    value={udphop.settings.remoteIPs}
                    placeholder="1.2.3.4, 10.0.0.0/24"
                    disabled={disabled}
                    onChange={(list) => patchMask("udp", "udphop", { remoteIPs: list })}
                  />
                </Field>
                <Field
                  id={`${idPrefix}-fm-udphop-ports`}
                  label={t("finalmask.udphop.remotePorts", { defaultValue: "Remote ports" })}
                  required
                  hint={t("finalmask.udphop.remotePortsHint", {
                    defaultValue: 'Ranges or lists, e.g. "20000-30000" or "443,8443"',
                  })}
                  errors={fieldErrors(udphopIssues, "remotePorts")}
                  className="sm:col-span-2"
                >
                  <Input
                    id={`${idPrefix}-fm-udphop-ports`}
                    value={textValue(udphop.settings.remotePorts)}
                    placeholder="20000-30000"
                    disabled={disabled}
                    spellCheck={false}
                    onChange={(e) =>
                      patchMask("udp", "udphop", {
                        remotePorts: e.target.value.trim() ? e.target.value : undefined,
                      })
                    }
                  />
                </Field>
              </>
            ) : null}
          </MaskCard>
        ) : null}
      </div>
    </div>
  );
}
