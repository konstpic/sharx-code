"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import {
  VLESS_ENC_MODES,
  detectVlessEncAuth,
  isVlessEncNone,
  normalizeVlessEncAuths,
  parseVlessEnc,
  patchVlessEnc,
  validateVlessEnc,
  validateVlessEncPadding,
  vlessEncPairProblems,
  type VlessEncAuth,
  type VlessEncMode,
} from "@/lib/vlessEncryption";
import { Button, ConfirmDialog, Input, SelectNative, useToast } from "@/components/ui";

type Props = {
  decryption: string;
  encryption: string;
  onChange: (patch: { vlessDecryption?: string; vlessEncryption?: string }) => void;
  network: string;
  vlessFlow: string;
  /** Fallbacks are present: xray rejects them together with decryption. */
  blockedByFallbacks?: boolean;
};

const labelCls = "mb-1.5 block text-xs font-medium text-[var(--fg-muted)]";
const hintCls = "mt-1 text-[11px] text-[var(--fg-subtle)]";
const errCls = "mt-1 text-[11px] text-red-400";

/** Text input that keeps a draft while typing and commits only valid values. */
function DraftInput({
  value,
  validate,
  onCommit,
  disabled,
  mono,
  placeholder,
}: {
  value: string;
  validate: (v: string) => string | null;
  onCommit: (v: string) => void;
  disabled?: boolean;
  mono?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const err = validate(draft);
  return (
    <>
      <Input
        className={mono ? "font-mono text-xs" : undefined}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!validate(e.target.value)) onCommit(e.target.value);
        }}
      />
      {err ? <p className={errCls}>{err}</p> : null}
    </>
  );
}

export function VlessEncryptionSection({
  decryption,
  encryption,
  onChange,
  network,
  vlessFlow,
  blockedByFallbacks = false,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [auths, setAuths] = useState<VlessEncAuth[]>([]);
  const [choice, setChoice] = useState<number>(-1);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingIdx, setPendingIdx] = useState<number | undefined>(undefined);

  const tt = (k: string, d: string) => t(`pages.inbounds.${k}`, { defaultValue: d });
  const errText = (code: string) =>
    tt(
      `vlessEncErr_${code}`,
      {
        format: "Expected mlkem768x25519plus.<method>.<ticket>.<key>",
        prefix: "Value must start with mlkem768x25519plus",
        mode: "Connection method must be native, xorpub or random",
        ticket: "Invalid ticket / 0-RTT field",
        padding: "Invalid padding (probability-from-to segments; first one needs 100 and length of at least 35)",
        key: "Invalid key (base64url, X25519 32 bytes or ML-KEM-768)",
      }[code] ?? code,
    );

  const decErr = validateVlessEnc(decryption, "server");
  const encErr = validateVlessEnc(encryption, "client");
  const pairProblems = useMemo(
    () => (decErr || encErr ? [] : vlessEncPairProblems(decryption, encryption)),
    [decryption, encryption, decErr, encErr],
  );
  const active = !isVlessEncNone(decryption) || !isVlessEncNone(encryption);
  const decParts = parseVlessEnc(decryption, "server");
  const encParts = parseVlessEnc(encryption, "client");
  const authKind = detectVlessEncAuth(decryption, "server");

  const fetchAuths = useCallback(async (): Promise<VlessEncAuth[] | null> => {
    setLoading(true);
    try {
      const r = await getJson<unknown>(panel("api/server/getNewVlessEnc"));
      if (!r.success) {
        toast.error(
          (r as { msg?: string }).msg ||
            tt("vlessEncGenFail", "Could not generate keys. Is the xray binary available on the panel host? You can paste values manually."),
        );
        return null;
      }
      const list = normalizeVlessEncAuths(r.obj);
      if (list.length === 0) {
        toast.error(tt("vlessEncGenFail", "Could not generate keys. Is the xray binary available on the panel host? You can paste values manually."));
        return null;
      }
      setAuths(list);
      return list;
    } catch {
      toast.error(tt("vlessEncGenFail", "Could not generate keys. Is the xray binary available on the panel host? You can paste values manually."));
      return null;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, t]);

  const apply = useCallback(
    (a: VlessEncAuth) => {
      // keep customised connection method / ticket / padding of the current value
      let d = a.decryption;
      let e = a.encryption;
      if (decParts) d = patchVlessEnc(d, "server", { mode: decParts.mode, ticket: decParts.ticket, padding: decParts.padding });
      if (encParts) e = patchVlessEnc(e, "client", { mode: encParts.mode, ticket: encParts.ticket, padding: encParts.padding });
      onChange({ vlessDecryption: d, vlessEncryption: e });
    },
    [decParts, encParts, onChange],
  );

  const generate = useCallback(
    async (idx?: number) => {
      const list = await fetchAuths();
      if (!list) return;
      let i = idx ?? choice;
      if (i < 0 || i >= list.length) {
        // default to the post-quantum (ML-KEM-768) pair: the one with the long client key
        i = list.findIndex((x) => x.encryption.length > 1000);
        if (i < 0) i = list.length - 1;
      }
      setChoice(i);
      apply(list[i]);
      toast.success(tt("vlessEncGenerated", "Keys generated"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchAuths, choice, apply, toast, t],
  );

  const requestGenerate = (idx?: number) => {
    if (!isVlessEncNone(decryption)) {
      setPendingIdx(idx);
      setConfirmOpen(true);
    } else void generate(idx);
  };
  const copy = async (text: string) => {
    try {
      await copyTextToClipboard(text);
      toast.success(tt("vlessEncCopied", "Copied"));
    } catch {
      toast.error(t("fail"));
    }
  };

  const onAuthSelect = (v: string) => {
    if (v === "none") {
      setChoice(-1);
      onChange({ vlessDecryption: "none", vlessEncryption: "none" });
    } else if (v === "keep") {
      return;
    } else {
      requestGenerate(Number(v));
    }
  };

  const selectValue = !active ? "none" : auths.length > 0 && choice >= 0 ? String(choice) : "keep";

  const setMode = (mode: VlessEncMode) =>
    onChange({
      vlessDecryption: patchVlessEnc(decryption, "server", { mode }),
      vlessEncryption: patchVlessEnc(encryption, "client", { mode }),
    });

  const encOn = !isVlessEncNone(encryption);
  const flowVision = vlessFlow.startsWith("xtls-rprx-vision");

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] p-3" data-testid="vless-enc-section">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--fg)]">
          {tt("vlessEncTitle", "Post-quantum encryption (VLESS Encryption)")}
        </span>
        <Button
          type="button"
          variant="secondary"
          loading={loading}
          disabled={blockedByFallbacks}
          onClick={() => requestGenerate()}
        >
          {active ? tt("vlessEncRegenerate", "Regenerate") : tt("vlessEncGenerate", "Generate")}
        </Button>
      </div>
      <p className={hintCls}>
        {tt(
          "vlessEncHelp",
          "Adds ML-KEM-768 / X25519 encryption inside VLESS. The server keeps the Decryption value, clients receive the matching Encryption value in subscription links automatically. Both values come from one generated pair.",
        )}
      </p>

      {blockedByFallbacks ? (
        <p className={errCls}>
          {tt("vlessEncFallbacksBlock", "Fallbacks cannot be used together with decryption (xray rejects it). Remove fallbacks first.")}
        </p>
      ) : null}

      <div>
        <label className={labelCls}>{tt("vlessEncAuthLabel", "Authentication")}</label>
        <SelectNative value={selectValue} disabled={blockedByFallbacks || loading} onChange={(e) => onAuthSelect(e.target.value)}>
          <option value="none">{tt("vlessEncNone", "None (no encryption)")}</option>
          {auths.length === 0 && active ? (
            <option value="keep">
              {authKind === "mlkem768"
                ? "ML-KEM-768, Post-Quantum"
                : authKind === "x25519"
                  ? "X25519, not Post-Quantum"
                  : tt("vlessEncCustom", "Custom value")}
            </option>
          ) : null}
          {auths.length === 0 && !active ? (
            <option value="keep" disabled>
              {tt("vlessEncPressGenerate", "Press Generate to create keys")}
            </option>
          ) : null}
          {auths.map((a, i) => (
            <option key={i} value={String(i)}>
              {a.label || `#${i + 1}`}
            </option>
          ))}
        </SelectNative>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={labelCls}>{tt("vlessEncDecryption", "Decryption (server)")}</label>
          <div className="flex gap-2">
            <Input
              className="flex-1 font-mono text-xs"
              placeholder="none"
              value={decryption}
              disabled={blockedByFallbacks}
              onChange={(e) => onChange({ vlessDecryption: e.target.value })}
            />
            <Button type="button" variant="secondary" disabled={isVlessEncNone(decryption)} onClick={() => void copy(decryption)}>
              {tt("vlessEncCopy", "Copy")}
            </Button>
          </div>
          {decErr ? <p className={errCls}>{errText(decErr)}</p> : null}
        </div>
        <div>
          <label className={labelCls}>{tt("vlessEncEncryption", "Encryption (client)")}</label>
          <div className="flex gap-2">
            <Input
              className="flex-1 font-mono text-xs"
              placeholder="none"
              value={encryption}
              disabled={blockedByFallbacks}
              onChange={(e) => onChange({ vlessEncryption: e.target.value })}
            />
            <Button type="button" variant="secondary" disabled={isVlessEncNone(encryption)} onClick={() => void copy(encryption)}>
              {tt("vlessEncCopy", "Copy")}
            </Button>
          </div>
          {encErr ? <p className={errCls}>{errText(encErr)}</p> : null}
        </div>
      </div>

      {pairProblems.map((p) => (
        <p key={p} className={errCls}>
          {tt(
            `vlessEncPair_${p}`,
            {
              clientMissing: "Decryption is set but the client Encryption is empty: subscription links would not connect.",
              serverMissing: "Encryption (client) is set but Decryption (server) is none: clients would fail to connect.",
              modeMismatch: "Connection method differs between Decryption and Encryption.",
            }[p] ?? p,
          )}
        </p>
      ))}

      {decParts && encParts && !decErr && !encErr ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--fg-muted)]">
            {tt("vlessEncAdvanced", "Advanced: connection method, ticket, padding")}
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className={labelCls}>{tt("vlessEncMethod", "Connection method")}</label>
              <SelectNative value={decParts.mode} onChange={(e) => setMode(e.target.value as VlessEncMode)}>
                {VLESS_ENC_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </SelectNative>
              <p className={hintCls}>
                {tt("vlessEncMethodHint", "native: plain; xorpub: hides public keys; random: fully random-looking traffic (both sides must match).")}
              </p>
            </div>
            <div>
              <label className={labelCls}>{tt("vlessEncTicket", "Ticket lifetime (server)")}</label>
              <DraftInput
                mono
                value={decParts.ticket}
                placeholder="600s"
                validate={(v) => (/^\d+(-\d+)?s$/.test(v.trim()) ? null : errText("ticket"))}
                onCommit={(v) => onChange({ vlessDecryption: patchVlessEnc(decryption, "server", { ticket: v.trim() }) })}
              />
              <p className={hintCls}>{tt("vlessEncTicketHint", "600s means random 300-600 s; 0s allows 1-RTT only.")}</p>
            </div>
            <div>
              <label className={labelCls}>{tt("vlessEncZeroRtt", "0-RTT (client)")}</label>
              <SelectNative
                value={encParts.ticket}
                onChange={(e) => onChange({ vlessEncryption: patchVlessEnc(encryption, "client", { ticket: e.target.value }) })}
              >
                <option value="0rtt">0rtt</option>
                <option value="1rtt">1rtt</option>
              </SelectNative>
            </div>
            <div>
              <label className={labelCls}>{tt("vlessEncPadding", "Padding (optional)")}</label>
              <DraftInput
                mono
                value={decParts.padding}
                placeholder="100-111-1111.75-0-111.50-0-3333"
                validate={(v) => {
                  const e = validateVlessEncPadding(v);
                  return e ? errText(e) : null;
                }}
                onCommit={(v) =>
                  onChange({
                    vlessDecryption: patchVlessEnc(decryption, "server", { padding: v.trim() }),
                    vlessEncryption: patchVlessEnc(encryption, "client", { padding: v.trim() }),
                  })
                }
              />
              <p className={hintCls}>
                {tt("vlessEncPaddingHint", "Default when empty: 100-111-1111.75-0-111.50-0-3333 (probability-from-to, len/gap alternating). Applied to both values.")}
              </p>
            </div>
          </div>
        </details>
      ) : null}

      {encOn && network !== "tcp" ? (
        <p className={hintCls}>
          {tt("vlessEncFlowTransport", "XTLS flow is applied only on TCP transports in this panel; with other transports flow stays empty.")}
        </p>
      ) : null}
      {encOn && network === "tcp" && !flowVision ? (
        <p className={hintCls}>
          {tt("vlessEncFlowHint", "Tip: with encryption you can enable flow xtls-rprx-vision (set it on clients too) to avoid double encryption.")}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={tt("vlessEncConfirmTitle", "Regenerate keys?")}
        description={tt(
          "vlessEncConfirmBody",
          "Existing clients must update their connection. Subscription links update automatically, but links and configs that were already imported will stop working until refreshed.",
        )}
        confirmLabel={tt("vlessEncRegenerate", "Regenerate")}
        cancelLabel={t("cancel")}
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false);
          await generate(pendingIdx);
        }}
      />
    </div>
  );
}
