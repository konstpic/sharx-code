"use client";

import { Mail, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Surface } from "@/components/panel";
import { AlertBanner, Button, Input, SelectNative, Spinner, Switch, useToast } from "@/components/ui";
import { useRbac } from "@/lib/rbac";
import { methodsApi, rbacApi, type MailView, type MethodsConfig, type MethodsView, type Role } from "./rbacApi";

function fmtDate(ts?: number): string {
  return ts ? new Date(ts * 1000).toLocaleString() : "—";
}

const lines = (s: string) =>
  s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-[var(--fg-muted)]">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-[var(--fg-subtle)]">{hint}</span> : null}
    </label>
  );
}

/** Which ways of signing in are open, the SMTP account the e-mail ones need, and the two-factor policy. */
export function MethodsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useRbac();
  const manage = can("auth:manage");
  const [view, setView] = useState<MethodsView | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([methodsApi.get(), rbacApi.roles()]);
    if (!m.ok) {
      setError(m.msg);
      return;
    }
    setError("");
    setView(m.obj ?? null);
    setRoles(r.obj ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <AlertBanner type="error" title={error} />;
  if (!view) return <Spinner />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--fg-muted)]">
        {t("rbac.methods.intro", {
          defaultValue:
            "Choose how people can sign in. Password sign-in is always available to administrators. Methods that send e-mail need an SMTP server (the account of a mail server you already have): set it up and send a test message first.",
        })}
      </p>
      <MailCard mail={view.mail} blocked={view.blocked} manage={manage} onChanged={() => void load()} />
      <MethodsCard view={view} roles={roles} manage={manage} onSaved={(v) => { setView(v); toast.success(t("rbac.methods.saved", { defaultValue: "Saved" })); }} />
    </div>
  );
}

function MailCard({ mail, blocked, manage, onChanged }: { mail: MailView; blocked: string[]; manage: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [f, setF] = useState({
    enabled: mail.enabled,
    host: mail.host,
    port: mail.port || 587,
    security: mail.security || "starttls",
    username: mail.username,
    from: mail.from,
    fromName: mail.fromName || "SharX Panel",
    skipVerify: mail.skipVerify,
  });
  const [password, setPassword] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const save = async () => {
    setError("");
    setSaving(true);
    const r = await methodsApi.saveMail({ ...f, port: Number(f.port), password: password ? password : null });
    setSaving(false);
    if (r.ok) {
      setPassword("");
      toast.success(t("rbac.methods.mailSaved", { defaultValue: "SMTP settings saved. Send a test message to verify them." }));
      onChanged();
    } else setError(r.msg);
  };
  const test = async () => {
    setError("");
    setTesting(true);
    const r = await methodsApi.testMail(to);
    setTesting(false);
    if (r.ok) {
      toast.success(t("rbac.methods.mailVerified", { defaultValue: "The server accepted the message: e-mail is ready" }));
      onChanged();
    } else setError(r.msg);
  };
  const dirty =
    f.enabled !== mail.enabled || f.host !== mail.host || Number(f.port) !== mail.port || f.security !== mail.security || f.username !== mail.username ||
    f.from !== mail.from || f.fromName !== mail.fromName || f.skipVerify !== mail.skipVerify || password !== "";

  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3">
        <Mail size={18} className="mt-0.5 text-[var(--fg-muted)]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--fg)]">{t("rbac.methods.mailTitle", { defaultValue: "E-mail (SMTP)" })}</h2>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            {mail.usable
              ? t("rbac.methods.mailReady", { defaultValue: "Verified {{when}}. E-mail sign-in methods can be switched on.", when: fmtDate(mail.verifiedAt) })
              : t("rbac.methods.mailNotReady", { defaultValue: "Not verified. Magic link, self-registration and password reset cannot work without a verified SMTP server." })}
          </p>
        </div>
      </div>
      <div className="grid gap-4 p-4">
        {blocked.length > 0 ? (
          <AlertBanner
            type="warning"
            title={t("rbac.methods.blocked", {
              defaultValue: "Switched on but not working because e-mail is not verified: {{list}}.",
              list: blocked.join(", "),
            })}
          />
        ) : null}
        {error ? <AlertBanner type="error" title={error} /> : null}
        <fieldset disabled={!manage} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem_10rem]">
            <Field label={t("rbac.methods.host", { defaultValue: "SMTP server" })}>
              <Input value={f.host} placeholder="smtp.example.com" onChange={(e) => setF({ ...f, host: e.target.value })} />
            </Field>
            <Field label={t("rbac.methods.port", { defaultValue: "Port" })}>
              <Input type="number" value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} />
            </Field>
            <Field label={t("rbac.methods.security", { defaultValue: "Connection" })}>
              <SelectNative
                value={f.security}
                onChange={(e) => {
                  const security = e.target.value as "starttls" | "tls" | "none";
                  setF({ ...f, security, port: security === "tls" ? 465 : security === "starttls" ? 587 : 25 });
                }}
              >
                <option value="starttls">STARTTLS (587)</option>
                <option value="tls">TLS (465)</option>
                <option value="none">{t("rbac.methods.noEncryption", { defaultValue: "No encryption (25)" })}</option>
              </SelectNative>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("rbac.methods.username", { defaultValue: "Login (if the server asks for one)" })}>
              <Input value={f.username} autoComplete="off" onChange={(e) => setF({ ...f, username: e.target.value })} />
            </Field>
            <Field
              label={t("rbac.methods.password", { defaultValue: "Password" })}
              hint={mail.hasPassword ? t("rbac.sso.secretKept", { defaultValue: "Stored encrypted; leave empty to keep it" }) : undefined}
            >
              <Input type="password" value={password} autoComplete="new-password" placeholder={mail.hasPassword ? "••••••••" : ""} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label={t("rbac.methods.from", { defaultValue: "Send from (address)" })}>
              <Input value={f.from} placeholder="panel@example.com" onChange={(e) => setF({ ...f, from: e.target.value })} />
            </Field>
            <Field label={t("rbac.methods.fromName", { defaultValue: "Sender name" })}>
              <Input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} />
            </Field>
          </div>
          {f.security === "none" ? (
            <AlertBanner
              type="warning"
              title={t("rbac.methods.plainWarn", {
                defaultValue: "Without encryption the messages (and, for a remote server, nothing else) cross the network in clear text. Use it only for a server on this machine or a trusted network. The login is never sent over an unencrypted connection to a remote server.",
              })}
            />
          ) : null}
          <label className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
            <Switch checked={f.skipVerify} onChange={(v) => setF({ ...f, skipVerify: v })} ariaLabel="skip verify" />
            <span>
              {t("rbac.methods.skipVerify", { defaultValue: "Accept a certificate that cannot be verified (self-signed)" })}
              <span className="block text-[11px] text-[var(--fg-subtle)]">
                {t("rbac.methods.skipVerifyHint", { defaultValue: "Only for a server you control: anybody on the path could pose as it." })}
              </span>
            </span>
          </label>
          <label className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
            <Switch checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} ariaLabel="enabled" />
            {t("rbac.methods.mailEnabled", { defaultValue: "Use this server to send e-mail" })}
          </label>
          {manage ? (
            <div className="flex flex-wrap items-end gap-3">
              <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
                {t("rbac.save", { defaultValue: "Save" })}
              </Button>
              <div className="flex flex-1 flex-wrap items-end gap-2">
                <Field label={t("rbac.methods.testTo", { defaultValue: "Send a test message to" })}>
                  <Input type="email" value={to} placeholder="you@example.com" onChange={(e) => setTo(e.target.value)} />
                </Field>
                <Button variant="secondary" loading={testing} disabled={!to || dirty || !mail.enabled} onClick={() => void test()}>
                  {t("rbac.methods.sendTest", { defaultValue: "Send test" })}
                </Button>
              </div>
            </div>
          ) : null}
          {dirty && manage ? <p className="text-[11px] text-[var(--fg-subtle)]">{t("rbac.methods.saveFirst", { defaultValue: "Save the changes before sending the test message." })}</p> : null}
        </fieldset>
      </div>
    </Surface>
  );
}

function NeedsMail({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-500">
      <ShieldAlert size={12} /> {t("rbac.methods.needsSmtp", { defaultValue: "Needs a verified SMTP server (set it up above)" })}
    </span>
  );
}

function MethodsCard({ view, roles, manage, onSaved }: { view: MethodsView; roles: Role[]; manage: boolean; onSaved: (v: MethodsView) => void }) {
  const { t } = useTranslation();
  const [c, setC] = useState<MethodsConfig>({ ...view });
  const [domains, setDomains] = useState(view.signupDomains.join("\n"));
  const [origins, setOrigins] = useState(view.origins.join("\n"));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const mailOk = view.mail.usable;

  const save = async () => {
    setError("");
    setSaving(true);
    const r = await methodsApi.save({ ...c, signupDomains: lines(domains), origins: lines(origins) });
    setSaving(false);
    if (r.ok && r.obj) onSaved(r.obj);
    else setError(r.msg);
  };
  const row = (label: string, hint: string | undefined, key: keyof MethodsConfig, needsMail: boolean) => {
    const on = c[key] as boolean;
    // a method that needs e-mail can be switched on only when e-mail works; an already-on one can always be switched off
    const blocked = needsMail && !mailOk && !on;
    return (
      <label className="flex items-start gap-3 text-sm text-[var(--fg-muted)]">
        <Switch checked={on} disabled={!manage || blocked} onChange={(v) => setC({ ...c, [key]: v })} ariaLabel={label} />
        <span>
          <span className="text-[var(--fg)]">{label}</span>
          {hint ? <span className="block text-[11px] text-[var(--fg-subtle)]">{hint}</span> : null}
          <NeedsMail show={needsMail && !mailOk} />
        </span>
      </label>
    );
  };

  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t("rbac.methods.title", { defaultValue: "Sign-in methods" })}</h2>
      </div>
      <div className="grid gap-4 p-4">
        {error ? <AlertBanner type="error" title={error} /> : null}
        <Field
          label={t("rbac.methods.publicUrl", { defaultValue: "Public address of the panel" })}
          hint={t("rbac.methods.publicUrlHint", {
            defaultValue: "Links in e-mail are built from this address only (never from the request), for example https://panel.example.com:2053/secret-path/. Required for the e-mail methods.",
          })}
        >
          <Input value={c.publicUrl} placeholder="https://panel.example.com:2053/" disabled={!manage} onChange={(e) => setC({ ...c, publicUrl: e.target.value })} />
        </Field>
        {row(
          t("rbac.methods.emailLogin", { defaultValue: "Sign in with the e-mail address instead of the username" }),
          t("rbac.methods.emailLoginHint", { defaultValue: "Works when the address is set on exactly one account." }),
          "emailLogin",
          false,
        )}
        {row(
          t("rbac.methods.magicLink", { defaultValue: "Magic link: sign in with a one-time link sent by e-mail" }),
          t("rbac.methods.magicLinkHint", { defaultValue: "Valid 15 minutes, works once. Accounts with two-factor authentication are still asked for the code." }),
          "magicLink",
          true,
        )}
        {row(
          t("rbac.methods.passwordReset", { defaultValue: "Password reset by e-mail" }),
          t("rbac.methods.passwordResetHint", { defaultValue: "A link valid for one hour; all sessions of the account end when it is used." }),
          "passwordReset",
          true,
        )}
        {row(
          t("rbac.methods.signup", { defaultValue: "Self-registration with e-mail confirmation" }),
          t("rbac.methods.signupHint", { defaultValue: "People create an account with e-mail and password; it exists only after they open the link we send." }),
          "signup",
          true,
        )}
        {c.signup ? (
          <div className="grid gap-3 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-2">
            <Field label={t("rbac.methods.signupRole", { defaultValue: "Role of new accounts" })} hint={t("rbac.methods.signupRoleHint", { defaultValue: "Never the administrator role, nor a role with administrator-only rights." })}>
              <SelectNative value={c.signupRoleId} disabled={!manage} onChange={(e) => setC({ ...c, signupRoleId: Number(e.target.value) })}>
                <option value={0}>—</option>
                {roles.filter((r) => !r.isSystem).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </SelectNative>
            </Field>
            <Field label={t("rbac.methods.signupDomains", { defaultValue: "Only these e-mail domains (empty: any)" })}>
              <textarea className="min-h-[72px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm" disabled={!manage} value={domains} onChange={(e) => setDomains(e.target.value)} />
            </Field>
          </div>
        ) : null}
        {row(
          t("rbac.methods.passkeys", { defaultValue: "Passkeys and hardware security keys" }),
          t("rbac.methods.passkeysHint", { defaultValue: "People add keys in Settings → Security, then sign in without a password, or use them as the second factor. Needs HTTPS." }),
          "passkeys",
          false,
        )}

        <div className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <Field
            label={t("rbac.methods.mfaPolicy", { defaultValue: "Two-factor authentication is required for" })}
            hint={t("rbac.methods.mfaPolicyHint", {
              defaultValue: "Anybody covered who has no second factor can open only the page where they set one up. A role or a single user can require it as well.",
            })}
          >
            <SelectNative value={c.mfaPolicy} disabled={!manage} onChange={(e) => setC({ ...c, mfaPolicy: e.target.value as "off" | "admins" | "all" })}>
              <option value="off">{t("rbac.methods.mfaOff", { defaultValue: "Nobody (optional)" })}</option>
              <option value="admins">{t("rbac.methods.mfaAdmins", { defaultValue: "Administrators" })}</option>
              <option value="all">{t("rbac.methods.mfaAll", { defaultValue: "Everybody" })}</option>
            </SelectNative>
          </Field>
          <label className="flex items-start gap-3 text-sm text-[var(--fg-muted)]">
            <Switch checked={c.ssoCountsAsMfa} disabled={!manage} onChange={(v) => setC({ ...c, ssoCountsAsMfa: v })} ariaLabel="sso mfa" />
            <span>
              {t("rbac.methods.ssoMfa", { defaultValue: "A sign-in through an identity provider counts as two-factor" })}
              <span className="block text-[11px] text-[var(--fg-subtle)]">
                {t("rbac.methods.ssoMfaHint", { defaultValue: "Turn off if your provider does not ask for a second factor." })}
              </span>
            </span>
          </label>
        </div>

        <details className="text-sm text-[var(--fg-muted)]">
          <summary className="cursor-pointer text-xs text-[var(--accent)]">{t("rbac.methods.advanced", { defaultValue: "Advanced: security-key relying party" })}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t("rbac.methods.rpId", { defaultValue: "Relying party ID (domain)" })} hint={t("rbac.methods.rpIdHint", { defaultValue: "Empty: the domain the panel is opened at. Set it when a proxy hides it." })}>
              <Input value={c.rpId} placeholder="panel.example.com" disabled={!manage} onChange={(e) => setC({ ...c, rpId: e.target.value })} />
            </Field>
            <Field label={t("rbac.methods.origins", { defaultValue: "Allowed origins" })}>
              <textarea className="min-h-[56px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm" placeholder="https://panel.example.com:2053" disabled={!manage} value={origins} onChange={(e) => setOrigins(e.target.value)} />
            </Field>
          </div>
        </details>

        {manage ? (
          <div>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {t("rbac.save", { defaultValue: "Save" })}
            </Button>
          </div>
        ) : null}
      </div>
    </Surface>
  );
}
