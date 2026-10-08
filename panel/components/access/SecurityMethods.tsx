"use client";

import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton, Input, useToast } from "@/components/ui";
import { createCredential, webauthnSupported } from "@/lib/webauthn";
import { methodsApi, type PasskeyRow } from "./rbacApi";
import { RecoveryCodesModal } from "./RecoveryCodesModal";

function fmt(ts?: number): string {
  return ts ? new Date(ts * 1000).toLocaleString() : "—";
}

/** The signed-in user's security keys (passkeys, hardware keys) and recovery codes. Rendered inside a settings section. */
export function SecurityMethods({ totpOn, onChanged }: { totpOn: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [keys, setKeys] = useState<PasskeyRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [regenCode, setRegenCode] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(async () => {
    const [k, r] = await Promise.all([methodsApi.passkeys(), methodsApi.recoveryStatus()]);
    if (k.ok && k.obj) {
      setKeys(k.obj.keys);
      setEnabled(k.obj.enabled);
    }
    if (r.ok && r.obj) setRemaining(r.obj.totp ? r.obj.remaining : null);
  }, []);
  useEffect(() => {
    void load();
  }, [load, totpOn]);

  const add = async () => {
    setBusy(true);
    try {
      const b = await methodsApi.passkeyBegin();
      if (!b.ok || !b.obj) {
        toast.error(b.msg);
        return;
      }
      const response = await createCredential(b.obj.options);
      const f = await methodsApi.passkeyFinish({ state: b.obj.state, name: name.trim() || "Security key", response });
      if (f.ok) {
        toast.success(t("rbac.keys.added", { defaultValue: "Security key added" }));
        setName("");
        await load();
        onChanged();
      } else toast.error(f.msg);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (m !== "cancelled" && !/NotAllowed/.test(m)) toast.error(t("rbac.keys.failed", { defaultValue: "The key could not be added." }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="divide-y divide-[var(--border)]">
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--fg)]">
          <KeyRound size={16} /> {t("rbac.keys.title", { defaultValue: "Passkeys and security keys" })}
        </div>
        {!enabled ? (
          <p className="text-xs text-[var(--fg-muted)]">{t("rbac.keys.off", { defaultValue: "Security keys are not enabled by the administrator." })}</p>
        ) : !webauthnSupported() ? (
          <p className="text-xs text-[var(--fg-muted)]">{t("rbac.keys.unsupported", { defaultValue: "This browser cannot use security keys (it needs HTTPS and a recent browser)." })}</p>
        ) : (
          <>
            {keys.length === 0 ? (
              <p className="mb-2 text-xs text-[var(--fg-muted)]">{t("rbac.keys.none", { defaultValue: "No keys yet. A key lets you sign in without a password, or confirms your password as a second factor." })}</p>
            ) : (
              <ul className="mb-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] text-sm">
                {keys.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      {renaming?.id === k.id ? (
                        <Input
                          autoFocus
                          value={renaming.name}
                          onChange={(e) => setRenaming({ id: k.id, name: e.target.value })}
                          onKeyDown={async (e) => {
                            if (e.key === "Enter") {
                              const r = await methodsApi.passkeyRename(k.id, renaming.name);
                              setRenaming(null);
                              if (r.ok) void load();
                              else toast.error(r.msg);
                            }
                            if (e.key === "Escape") setRenaming(null);
                          }}
                        />
                      ) : (
                        <>
                          <div className="truncate font-medium text-[var(--fg)]">{k.name}</div>
                          <div className="text-[11px] text-[var(--fg-subtle)]">
                            {t("rbac.keys.added2", { defaultValue: "Added" })} {fmt(k.createdAt)} · {t("rbac.keys.lastUsed", { defaultValue: "last used" })} {fmt(k.lastUsedAt)}
                          </div>
                        </>
                      )}
                    </div>
                    <IconButton label={t("rbac.keys.rename", { defaultValue: "Rename" })} onClick={() => setRenaming({ id: k.id, name: k.name })}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton
                      label={t("delete")}
                      onClick={async () => {
                        const r = await methodsApi.passkeyDelete(k.id);
                        if (r.ok) {
                          void load();
                          onChanged();
                        } else toast.error(r.msg);
                      }}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <Input className="max-w-xs" value={name} placeholder={t("rbac.keys.namePlaceholder", { defaultValue: "Name, e.g. YubiKey or Laptop" })} onChange={(e) => setName(e.target.value)} />
              <Button variant="secondary" loading={busy} onClick={() => void add()}>
                <Plus size={16} /> {t("rbac.keys.add", { defaultValue: "Add a key" })}
              </Button>
            </div>
          </>
        )}
      </div>

      {remaining !== null ? (
        <div className="px-4 py-3">
          <div className="mb-1 text-sm font-medium text-[var(--fg)]">{t("rbac.recovery.title", { defaultValue: "Recovery codes" })}</div>
          <p className="mb-2 text-xs text-[var(--fg-muted)]">
            {t("rbac.recovery.status", { defaultValue: "{{n}} unused. A new set replaces the old one; enter your current authenticator code to make it.", n: remaining })}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Input className="max-w-[10rem]" inputMode="numeric" autoComplete="one-time-code" value={regenCode} placeholder={t("twoFactorCode")} onChange={(e) => setRegenCode(e.target.value)} />
            <Button
              variant="secondary"
              disabled={!regenCode.trim()}
              onClick={async () => {
                const r = await methodsApi.recoveryGenerate(regenCode.trim());
                if (r.ok && r.obj) {
                  setCodes(r.obj.recoveryCodes);
                  setRegenCode("");
                  void load();
                } else toast.error(r.msg || t("pages.settings.security.twoFactorModalError"));
              }}
            >
              {t("rbac.recovery.generate", { defaultValue: "Generate new codes" })}
            </Button>
          </div>
        </div>
      ) : null}
      {codes ? <RecoveryCodesModal codes={codes} onClose={() => setCodes(null)} /> : null}
    </div>
  );
}
