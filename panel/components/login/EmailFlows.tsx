"use client";

import { KeyRound, Mail, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, useToast } from "@/components/ui";
import { postJson } from "@/lib/api";
import { p } from "@/lib/paths";
import { getAssertion } from "@/lib/webauthn";

export type FlowMode = "magic" | "register" | "forgot" | "reset" | "confirm" | "magicVerify";

type Opts = { state: string; options: Record<string, unknown> };

function done() {
  if (typeof window !== "undefined") {
    sessionStorage.setItem("showWhatsNew", "true");
    window.location.href = p("panel/");
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--fg-muted)]">{label}</span>
      {children}
    </label>
  );
}

/** The e-mail based sign-in screens: request a link, register, confirm, reset a password, and finish a link sign-in. */
export function EmailFlow({ mode, token, onBack }: { mode: FlowMode; token: string; onBack: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [keyOpts, setKeyOpts] = useState<Opts | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const call = async (path: string, body: Record<string, unknown>) => postJson<unknown>(p(path), body, true).catch((e) => ({ success: false, msg: e?.response?.data?.msg ?? "Request failed", obj: undefined }));

  const verifyMagic = async (extra?: Record<string, unknown>) => {
    setBusy(true);
    const r = await call("auth/magic/verify", { token, twoFactorCode: code.trim(), ...extra });
    setBusy(false);
    if (r.success) return done();
    const o = r.obj as { needTwoFactor?: boolean; webauthn?: Opts } | undefined;
    if (o?.needTwoFactor) {
      setNeedCode(true);
      setKeyOpts(o.webauthn ?? null);
      if (code) toast.error(t("pages.login.toasts.wrongTwoFactorCode"));
      return;
    }
    setFailed(true);
    setMessage(r.msg || t("pages.login.flows.linkInvalid", { defaultValue: "The link is invalid or has expired. Request a new one." }));
  };

  // links from e-mail do their work as soon as the page opens
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (mode === "magicVerify") void verifyMagic();
    if (mode === "confirm") {
      void (async () => {
        const r = await call("auth/register/confirm", { token });
        setFailed(!r.success);
        setMessage(r.msg || (r.success ? t("pages.login.flows.confirmed", { defaultValue: "Your account is ready." }) : ""));
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    let r: { success: boolean; msg?: string };
    if (mode === "magic") r = await call("auth/magic/request", { email });
    else if (mode === "forgot") r = await call("auth/password/forgot", { email });
    else if (mode === "register") {
      if (password !== password2) {
        setBusy(false);
        toast.error(t("pages.login.flows.mismatch", { defaultValue: "The passwords do not match." }));
        return;
      }
      r = await call("auth/register", { email, password });
    } else if (mode === "reset") {
      if (password !== password2) {
        setBusy(false);
        toast.error(t("pages.login.flows.mismatch", { defaultValue: "The passwords do not match." }));
        return;
      }
      r = await call("auth/password/reset", { token, password });
    } else {
      setBusy(false);
      return;
    }
    setBusy(false);
    setFailed(!r.success);
    setMessage(r.msg ?? "");
  };

  const signInWithKey = async () => {
    if (!keyOpts) return;
    try {
      const resp = await getAssertion(keyOpts.options);
      await verifyMagic({ webauthnState: keyOpts.state, webauthnResponse: resp });
    } catch {
      toast.error(t("rbac.keys.failed", { defaultValue: "The key could not be used." }));
    }
  };

  const title =
    mode === "magic"
      ? t("pages.login.flows.magicTitle", { defaultValue: "Sign in with an e-mail link" })
      : mode === "register"
        ? t("pages.login.flows.registerTitle", { defaultValue: "Create an account" })
        : mode === "forgot"
          ? t("pages.login.flows.forgotTitle", { defaultValue: "Reset your password" })
          : mode === "reset"
            ? t("pages.login.flows.resetTitle", { defaultValue: "Choose a new password" })
            : mode === "confirm"
              ? t("pages.login.flows.confirmTitle", { defaultValue: "Confirming your e-mail" })
              : t("pages.login.flows.verifyTitle", { defaultValue: "Signing you in" });

  const finished = message !== "" && !failed && (mode === "magic" || mode === "register" || mode === "forgot" || mode === "reset" || mode === "confirm");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-center text-lg font-semibold text-[var(--fg)]">{title}</h2>
      {message ? (
        <p className={`text-center text-sm ${failed ? "text-red-400" : "text-[var(--fg-muted)]"}`}>{message}</p>
      ) : null}
      {mode === "magicVerify" && needCode ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verifyMagic();
          }}
        >
          <p className="text-center text-sm text-[var(--fg-muted)]">{t("pages.login.twoFactorStepHint", { defaultValue: "Enter the code to finish signing in." })}</p>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" aria-hidden />
            <Input
              autoFocus
              inputSize="lg"
              className="!pl-10"
              autoComplete="one-time-code"
              placeholder={t("pages.login.flows.codeOrRecovery", { defaultValue: "Code or recovery code" })}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <Button type="submit" variant="primary" className="w-full !py-3" loading={busy}>
            {t("confirm")}
          </Button>
          {keyOpts ? (
            <Button type="button" variant="secondary" className="w-full" onClick={() => void signInWithKey()}>
              {t("pages.login.flows.useKey", { defaultValue: "Use a security key" })}
            </Button>
          ) : null}
        </form>
      ) : null}
      {!finished && (mode === "magic" || mode === "register" || mode === "forgot" || mode === "reset") ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {mode !== "reset" ? (
            <Field label={t("pages.login.flows.email", { defaultValue: "E-mail address" })}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" aria-hidden />
                <Input type="email" inputSize="lg" className="!pl-10" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            </Field>
          ) : null}
          {mode === "register" || mode === "reset" ? (
            <>
              <Field label={t("pages.login.flows.newPassword", { defaultValue: "Password (at least 8 characters)" })}>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" aria-hidden />
                  <Input type="password" inputSize="lg" className="!pl-10" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
              </Field>
              <Field label={t("pages.login.flows.repeatPassword", { defaultValue: "Repeat the password" })}>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]" aria-hidden />
                  <Input type="password" inputSize="lg" className="!pl-10" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
                </div>
              </Field>
            </>
          ) : null}
          <Button type="submit" variant="primary" className="w-full !py-3" loading={busy}>
            {mode === "magic"
              ? t("pages.login.flows.sendLink", { defaultValue: "Send me a link" })
              : mode === "register"
                ? t("pages.login.flows.register", { defaultValue: "Create the account" })
                : mode === "forgot"
                  ? t("pages.login.flows.sendReset", { defaultValue: "Send the reset link" })
                  : t("pages.login.flows.setPassword", { defaultValue: "Set the password" })}
          </Button>
        </form>
      ) : null}
      {(finished || failed || mode === "magic" || mode === "register" || mode === "forgot" || mode === "reset" || mode === "confirm") ? (
        <button type="button" className="text-center text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]" onClick={onBack}>
          {t("pages.login.flows.back", { defaultValue: "Back to sign in" })}
        </button>
      ) : null}
    </div>
  );
}

/** Sign in with a passkey: the browser offers the keys it holds for this site. */
export function PasskeyButton({ onError }: { onError: (m: string) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const b = await postJson<Opts>(p("auth/passkey/login/begin"), {}, true);
          if (!b.success || !b.obj) throw new Error("begin");
          const response = await getAssertion(b.obj.options);
          const f = await postJson(p("auth/passkey/login/finish"), { state: b.obj.state, response }, true);
          if (f.success) return done();
          onError(f.msg || t("pages.login.flows.keyFailed", { defaultValue: "The security key could not be verified." }));
        } catch (e) {
          const m = e instanceof Error ? e.message : "";
          if (!/NotAllowed|cancelled/.test(m)) onError(t("pages.login.flows.keyFailed", { defaultValue: "The security key could not be verified." }));
        } finally {
          setBusy(false);
        }
      }}
    >
      <KeyRound size={16} /> {t("pages.login.flows.passkey", { defaultValue: "Sign in with a passkey" })}
    </Button>
  );
}
