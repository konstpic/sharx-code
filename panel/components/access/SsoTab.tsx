"use client";

import { Copy, FlaskConical, Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Surface } from "@/components/panel";
import { AlertBanner, Button, ConfirmDialog, IconButton, Input, Modal, PillTag, SelectNative, Spinner, Switch, useToast } from "@/components/ui";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { p } from "@/lib/paths";
import { useRbac } from "@/lib/rbac";
import { rbacApi, ssoApi, type Role, type SsoIdentity, type SsoPreset, type SsoProvider, type SsoRule } from "./rbacApi";

function fmtDate(ts?: number): string {
  return ts ? new Date(ts * 1000).toLocaleString() : "—";
}

function redirectUri(key: string, base?: string): string {
  const path = `auth/sso/${key || "<key>"}/callback`;
  if (base && base.trim()) return `${base.trim().replace(/\/+$/, "")}/${path}`;
  return `${window.location.origin}${p(path)}`;
}

const lines = (s: string) =>
  s
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

type T = (k: string, o?: Record<string, unknown>) => string;

/** Single sign-on: providers, role rules, linked accounts. Reading needs auth:read; changing is for administrators. */
export function SsoTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useRbac();
  const manage = can("auth:manage");
  const [providers, setProviders] = useState<SsoProvider[] | null>(null);
  const [rules, setRules] = useState<SsoRule[]>([]);
  const [identities, setIdentities] = useState<SsoIdentity[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [presets, setPresets] = useState<SsoPreset[]>([]);
  const [localLogin, setLocalLogin] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<SsoProvider | "new" | null>(null);
  const [ruleEdit, setRuleEdit] = useState<SsoRule | "new" | null>(null);
  const [delProvider, setDelProvider] = useState<SsoProvider | null>(null);
  const [delRule, setDelRule] = useState<SsoRule | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<SsoIdentity | null>(null);

  const load = useCallback(async () => {
    const [pr, ru, id, ro, ps, st] = await Promise.all([
      ssoApi.providers(),
      ssoApi.rules(),
      ssoApi.identities(),
      rbacApi.roles(),
      ssoApi.presets(),
      ssoApi.settings(),
    ]);
    if (!pr.ok) {
      setError(pr.msg);
      return;
    }
    setError("");
    setProviders(pr.obj ?? []);
    setRules(ru.obj ?? []);
    setIdentities(id.obj ?? []);
    setRoles(ro.obj ?? []);
    setPresets(ps.obj ?? []);
    setLocalLogin(st.obj?.localLogin ?? true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const providerName = useMemo(() => new Map((providers ?? []).map((x) => [x.id, x.name])), [providers]);

  if (error) return <AlertBanner type="error" title={error} />;
  if (!providers) return <Spinner />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--fg-muted)]">
        {t("rbac.sso.intro", {
          defaultValue:
            "Let people sign in with Authentik, Keycloak, Google, GitHub and other OpenID Connect / OAuth 2.0 providers. A provider can also decide which role a person gets, from their groups and attributes, at every sign-in.",
        })}
      </p>

      <Surface padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-base font-semibold text-[var(--fg)]">{t("rbac.sso.providers", { defaultValue: "Providers" })}</h2>
          {manage ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> {t("rbac.sso.addProvider", { defaultValue: "Add provider" })}
            </Button>
          ) : null}
        </div>
        {providers.length === 0 ? (
          <p className="p-4 text-sm text-[var(--fg-muted)]">{t("rbac.sso.noProviders", { defaultValue: "No providers yet." })}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--fg-subtle)]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">{t("rbac.sso.name", { defaultValue: "Name" })}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("rbac.sso.type", { defaultValue: "Type" })}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("rbac.sso.status", { defaultValue: "Status" })}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("rbac.sso.roles", { defaultValue: "Roles" })}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("rbac.sso.accounts", { defaultValue: "Accounts" })}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {providers.map((x) => (
                  <tr key={x.id}>
                    <td className="px-4 py-3 font-medium text-[var(--fg)]">
                      {x.name} <span className="font-mono text-xs text-[var(--fg-subtle)]">{x.key}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-muted)]">{presets.find((pr) => pr.id === x.preset)?.name ?? x.preset}</td>
                    <td className="px-4 py-3">
                      <PillTag tone={x.enabled ? "green" : "neutral"}>
                        {x.enabled ? t("rbac.sso.enabled", { defaultValue: "Enabled" }) : t("rbac.sso.disabled", { defaultValue: "Off" })}
                      </PillTag>
                      {x.allowSignup ? (
                        <PillTag tone="blue" className="ml-1">
                          {t("rbac.sso.signup", { defaultValue: "self-registration" })}
                        </PillTag>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-muted)]">
                      {x.roleMode === "idp"
                        ? t("rbac.sso.byProvider", { defaultValue: "by the provider's rules" })
                        : t("rbac.sso.byAdmins", { defaultValue: "by administrators" })}
                    </td>
                    <td className="px-4 py-3 text-[var(--fg-muted)]">{x.identities}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label={t("rbac.sso.copyRedirect", { defaultValue: "Copy the redirect URI" })}
                          onClick={() => {
                            void copyTextToClipboard(redirectUri(x.key, x.overrides.redirectBase));
                            toast.success(t("rbac.sso.copied", { defaultValue: "Redirect URI copied" }));
                          }}
                        >
                          <Copy size={16} />
                        </IconButton>
                        {manage ? (
                          <>
                            <IconButton
                              label={t("rbac.sso.test", { defaultValue: "Check the connection" })}
                              onClick={async () => {
                                const r = await ssoApi.testProvider(x.id);
                                if (r.ok) toast.success(t("rbac.sso.testOk", { defaultValue: "The provider answers and publishes its keys" }));
                                else toast.error(r.msg);
                              }}
                            >
                              <FlaskConical size={16} />
                            </IconButton>
                            <IconButton label={t("edit")} onClick={() => setEditing(x)}>
                              <Pencil size={16} />
                            </IconButton>
                            <IconButton label={t("delete")} onClick={() => setDelProvider(x)}>
                              <Trash2 size={16} />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {manage ? (
          <label className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--fg-muted)]">
            <Switch
              checked={localLogin}
              ariaLabel="local login"
              onChange={async (v) => {
                const r = await ssoApi.saveSettings({ localLogin: v });
                if (r.ok) setLocalLogin(v);
                else toast.error(r.msg);
              }}
            />
            {t("rbac.sso.localLogin", {
              defaultValue:
                "Allow password sign-in for everybody. When off, only administrators keep the password form (the way in if the provider is down).",
            })}
          </label>
        ) : null}
      </Surface>

      <Surface padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--fg)]">{t("rbac.sso.rules", { defaultValue: "Role rules" })}</h2>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              {t("rbac.sso.rulesHint", {
                defaultValue:
                  "Checked top to bottom for providers whose roles are set by rules; the first match decides. A person who matches nothing is refused (or gets the default role).",
              })}
            </p>
          </div>
          {manage ? (
            <Button variant="secondary" onClick={() => setRuleEdit("new")}>
              <Plus size={16} /> {t("rbac.sso.addRule", { defaultValue: "Add rule" })}
            </Button>
          ) : null}
        </div>
        {rules.length === 0 ? (
          <p className="p-4 text-sm text-[var(--fg-muted)]">{t("rbac.sso.noRules", { defaultValue: "No rules yet." })}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {rules.map((r) => (
              <li key={r.id} className={`flex items-center gap-3 px-4 py-2.5 ${r.enabled ? "" : "opacity-60"}`}>
                <span className="w-32 shrink-0 truncate text-xs text-[var(--fg-subtle)]">
                  {r.providerId ? providerName.get(r.providerId) : t("rbac.sso.allProviders", { defaultValue: "all providers" })}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--fg)]">
                  <span className="text-[var(--fg-muted)]">{ruleLabel(r.kind, t)}</span> {r.kind === "claim" ? `${r.claim} = ` : ""}
                  <span className="font-mono text-xs">{r.kind === "any" ? "" : r.value}</span>
                </span>
                <span className="text-[var(--fg-muted)]">→ {r.roleName}</span>
                {manage ? (
                  <div className="flex gap-1">
                    <IconButton label={t("edit")} onClick={() => setRuleEdit(r)}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton label={t("delete")} onClick={() => setDelRule(r)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <Surface padding="none" className="overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-base font-semibold text-[var(--fg)]">{t("rbac.sso.linked", { defaultValue: "Linked accounts" })}</h2>
        </div>
        {identities.length === 0 ? (
          <p className="p-4 text-sm text-[var(--fg-muted)]">{t("rbac.sso.noIdentities", { defaultValue: "Nobody has signed in through a provider yet." })}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {identities.map((i) => (
              <li key={i.id} className="grid grid-cols-[8rem_9rem_1fr_auto] items-center gap-3 px-4 py-2.5">
                <span className="truncate font-medium text-[var(--fg)]">{i.username}</span>
                <span className="truncate text-[var(--fg-muted)]">{i.provider}</span>
                <span className="min-w-0 truncate text-xs text-[var(--fg-subtle)]">
                  {i.email} {i.groups.length > 0 ? `· ${i.groups.slice(0, 4).join(", ")}${i.groups.length > 4 ? "…" : ""}` : ""} · {fmtDate(i.lastLoginAt)}
                </span>
                {manage ? (
                  <IconButton label={t("rbac.sso.unlink", { defaultValue: "Unlink" })} onClick={() => setUnlinkTarget(i)}>
                    <Unlink size={16} />
                  </IconButton>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </Surface>

      {editing ? (
        <ProviderModal
          provider={editing === "new" ? null : editing}
          presets={presets}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
      {ruleEdit ? (
        <RuleModal
          rule={ruleEdit === "new" ? null : ruleEdit}
          providers={providers}
          roles={roles}
          onClose={() => setRuleEdit(null)}
          onSaved={() => {
            setRuleEdit(null);
            void load();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={delProvider != null}
        danger
        title={t("rbac.sso.deleteProvider", { defaultValue: "Remove this provider?" })}
        description={t("rbac.sso.deleteProviderText", {
          defaultValue:
            "{{name}}, its rules and the links to it are removed. Accounts stay; people who could only sign in through it lose access until you set a password.",
          name: delProvider?.name ?? "",
        })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onCancel={() => setDelProvider(null)}
        onConfirm={async () => {
          if (!delProvider) return;
          const r = await ssoApi.deleteProvider(delProvider.id);
          setDelProvider(null);
          if (r.ok) void load();
          else toast.error(r.msg);
        }}
      />
      <ConfirmDialog
        open={delRule != null}
        danger
        title={t("rbac.sso.deleteRule", { defaultValue: "Remove this rule?" })}
        description={t("rbac.sso.deleteRuleText", { defaultValue: "People who matched only this rule lose the role at their next sign-in." })}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onCancel={() => setDelRule(null)}
        onConfirm={async () => {
          if (!delRule) return;
          const r = await ssoApi.deleteRule(delRule.id);
          setDelRule(null);
          if (r.ok) void load();
          else toast.error(r.msg);
        }}
      />
      <ConfirmDialog
        open={unlinkTarget != null}
        danger
        title={t("rbac.sso.unlink", { defaultValue: "Unlink" })}
        description={t("rbac.sso.unlinkText", {
          defaultValue: "{{user}} will no longer be able to sign in with this account.",
          user: unlinkTarget?.username ?? "",
        })}
        confirmLabel={t("rbac.sso.unlink", { defaultValue: "Unlink" })}
        cancelLabel={t("cancel")}
        onCancel={() => setUnlinkTarget(null)}
        onConfirm={async () => {
          if (!unlinkTarget) return;
          const r = await ssoApi.unlink(unlinkTarget.id);
          setUnlinkTarget(null);
          if (r.ok) void load();
          else toast.error(r.msg);
        }}
      />
    </div>
  );
}

function ruleLabel(kind: SsoRule["kind"], t: T): string {
  switch (kind) {
    case "group":
      return t("rbac.sso.kindGroup", { defaultValue: "group" });
    case "claim":
      return t("rbac.sso.kindClaim", { defaultValue: "claim" });
    case "email_domain":
      return t("rbac.sso.kindDomain", { defaultValue: "e-mail domain" });
    case "email":
      return t("rbac.sso.kindEmail", { defaultValue: "e-mail" });
    default:
      return t("rbac.sso.kindAny", { defaultValue: "everybody" });
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-[var(--fg-muted)]">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-[var(--fg-subtle)]">{hint}</span> : null}
    </label>
  );
}

function ProviderModal({
  provider,
  presets,
  roles,
  onClose,
  onSaved,
}: {
  provider: SsoProvider | null;
  presets: SsoPreset[];
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isNew = provider == null;
  const usable = presets.filter((x) => x.stage === 1);
  const [preset, setPreset] = useState(provider?.preset ?? "authentik");
  const [key, setKey] = useState(provider?.key ?? "authentik");
  const [name, setName] = useState(provider?.name ?? "Authentik");
  const [enabled, setEnabled] = useState(provider?.enabled ?? false);
  const [clientId, setClientId] = useState(provider?.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [params, setParams] = useState<Record<string, string>>(provider?.params ?? {});
  const [domains, setDomains] = useState((provider?.allowedDomains ?? []).join("\n"));
  const [emails, setEmails] = useState((provider?.allowedEmails ?? []).join("\n"));
  const [allowSignup, setAllowSignup] = useState(provider?.allowSignup ?? false);
  const [linkByEmail, setLinkByEmail] = useState(provider?.linkByEmail ?? false);
  const [roleMode, setRoleMode] = useState<"local" | "idp">(provider?.roleMode ?? "idp");
  const [noMatch, setNoMatch] = useState<"deny" | "default" | "keep">(provider?.noMatch ?? "deny");
  const [defaultRole, setDefaultRole] = useState<number>(provider?.defaultRoleId ?? 0);
  const [adv, setAdv] = useState(false);
  const o = provider?.overrides ?? {};
  const [ov, setOv] = useState({
    redirectBase: o.redirectBase ?? "",
    issuer: o.issuer ?? "",
    authUrl: o.authUrl ?? "",
    tokenUrl: o.tokenUrl ?? "",
    userInfoUrl: o.userInfoUrl ?? "",
    jwksUrl: o.jwksUrl ?? "",
    scopes: (o.scopes ?? []).join(" "),
    groups: o.claims?.groups ?? "",
    email: o.claims?.email ?? "",
    subject: o.claims?.subject ?? "",
    username: o.claims?.username ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const info = presets.find((x) => x.id === preset);

  const pickPreset = (id: string) => {
    setPreset(id);
    setParams({});
    if (isNew) {
      const pr = presets.find((x) => x.id === id);
      setKey(id.replace(/[^a-z0-9-]/g, ""));
      setName(pr?.name.split(" (")[0] ?? id);
    }
  };

  const save = async () => {
    setError("");
    setSaving(true);
    const claims = Object.fromEntries(
      Object.entries({ groups: ov.groups, email: ov.email, subject: ov.subject, username: ov.username }).filter(([, v]) => v.trim()),
    );
    const overrides = {
      ...(ov.redirectBase.trim() ? { redirectBase: ov.redirectBase.trim() } : {}),
      ...(ov.issuer.trim() ? { issuer: ov.issuer.trim() } : {}),
      ...(ov.authUrl.trim() ? { authUrl: ov.authUrl.trim() } : {}),
      ...(ov.tokenUrl.trim() ? { tokenUrl: ov.tokenUrl.trim() } : {}),
      ...(ov.userInfoUrl.trim() ? { userInfoUrl: ov.userInfoUrl.trim() } : {}),
      ...(ov.jwksUrl.trim() ? { jwksUrl: ov.jwksUrl.trim() } : {}),
      ...(ov.scopes.trim() ? { scopes: ov.scopes.trim().split(/\s+/) } : {}),
      ...(Object.keys(claims).length ? { claims } : {}),
    };
    const r = await ssoApi.saveProvider(provider?.id ?? null, {
      key,
      name,
      preset,
      enabled,
      clientId,
      clientSecret: secret ? secret : isNew ? "" : null,
      params,
      overrides,
      allowedDomains: lines(domains),
      allowedEmails: lines(emails),
      allowSignup,
      linkByEmail,
      roleMode,
      noMatch,
      defaultRoleId: defaultRole || undefined,
    });
    setSaving(false);
    if (r.ok) {
      toast.success(t("rbac.sso.saved", { defaultValue: "Provider saved" }));
      onSaved();
    } else setError(r.msg);
  };

  const area = "min-h-[72px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm";
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t("rbac.sso.addProvider", { defaultValue: "Add provider" }) : t("rbac.sso.editProvider", { defaultValue: "Edit provider" })}
      width={640}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" loading={saving} disabled={!key || !name} onClick={() => void save()}>
            {t("rbac.save", { defaultValue: "Save" })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <AlertBanner type="error" title={error} /> : null}
        <Field label={t("rbac.sso.type", { defaultValue: "Type" })} hint={info?.notes}>
          <SelectNative value={preset} disabled={!isNew} onChange={(e) => pickPreset(e.target.value)}>
            {usable.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </SelectNative>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("rbac.sso.name", { defaultValue: "Name" })} hint={t("rbac.sso.nameHint", { defaultValue: "Shown on the sign-in button" })}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("rbac.sso.key", { defaultValue: "Key" })} hint={t("rbac.sso.keyHint", { defaultValue: "Part of the redirect URI; fixed once created" })}>
            <Input value={key} disabled={!isNew} onChange={(e) => setKey(e.target.value.toLowerCase())} />
          </Field>
        </div>
        {(info?.params ?? []).map((pr) => (
          <Field key={pr.key} label={pr.label + (pr.optional ? "" : " *")}>
            <Input value={params[pr.key] ?? ""} placeholder={pr.example} onChange={(e) => setParams((cur) => ({ ...cur, [pr.key]: e.target.value }))} />
          </Field>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client ID">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
          </Field>
          <Field
            label="Client secret"
            hint={provider?.hasSecret ? t("rbac.sso.secretKept", { defaultValue: "Stored encrypted; leave empty to keep it" }) : undefined}
          >
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
              placeholder={provider?.hasSecret ? "••••••••" : ""}
            />
          </Field>
        </div>
        <Field label={t("rbac.sso.redirectUri", { defaultValue: "Redirect URI to register at the provider" })}>
          <Input readOnly value={redirectUri(key, ov.redirectBase)} className="font-mono text-xs" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("rbac.sso.allowedDomains", { defaultValue: "Allowed e-mail domains" })}
            hint={t("rbac.sso.allowHint", { defaultValue: "One per line. Both lists empty: everybody the provider signs in. Only verified addresses count." })}
          >
            <textarea className={area} value={domains} onChange={(e) => setDomains(e.target.value)} />
          </Field>
          <Field label={t("rbac.sso.allowedEmails", { defaultValue: "Allowed e-mail addresses" })}>
            <textarea className={area} value={emails} onChange={(e) => setEmails(e.target.value)} />
          </Field>
        </div>

        <label className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
          <Switch checked={allowSignup} onChange={setAllowSignup} ariaLabel="signup" />
          {t("rbac.sso.allowSignup", { defaultValue: "Create an account at the first sign-in (self-registration)" })}
        </label>
        <label className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
          <Switch checked={linkByEmail} onChange={setLinkByEmail} ariaLabel="link" />
          <span>
            {t("rbac.sso.linkByEmail", { defaultValue: "Link to an existing account by verified e-mail" })}
            <span className="block text-[11px] text-[var(--fg-subtle)]">
              {t("rbac.sso.linkWarn", {
                defaultValue:
                  "Only when the provider verifies addresses and the address is set on exactly one account. Otherwise users link their account themselves in Settings → Security.",
              })}
            </span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("rbac.sso.roleMode", { defaultValue: "Who sets the role" })}>
            <SelectNative value={roleMode} onChange={(e) => setRoleMode(e.target.value as "local" | "idp")}>
              <option value="idp">{t("rbac.sso.byProviderOpt", { defaultValue: "The provider (role rules, at every sign-in)" })}</option>
              <option value="local">{t("rbac.sso.byAdminsOpt", { defaultValue: "Panel administrators (local roles)" })}</option>
            </SelectNative>
          </Field>
          <Field label={t("rbac.sso.noMatch", { defaultValue: "When no rule matches" })}>
            <SelectNative value={noMatch} disabled={roleMode !== "idp"} onChange={(e) => setNoMatch(e.target.value as "deny" | "default" | "keep")}>
              <option value="deny">{t("rbac.sso.noMatchDeny", { defaultValue: "Refuse access" })}</option>
              <option value="default">{t("rbac.sso.noMatchDefault", { defaultValue: "Give the default role" })}</option>
              <option value="keep">{t("rbac.sso.noMatchKeep", { defaultValue: "Keep the current role" })}</option>
            </SelectNative>
          </Field>
        </div>
        <Field
          label={t("rbac.sso.defaultRole", { defaultValue: "Default role" })}
          hint={t("rbac.sso.defaultRoleHint", {
            defaultValue: "For new accounts when roles are local, or when no rule matches and the setting above says so.",
          })}
        >
          <SelectNative value={defaultRole} onChange={(e) => setDefaultRole(Number(e.target.value))}>
            <option value={0}>—</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectNative>
        </Field>

        <button type="button" className="text-left text-xs text-[var(--accent)]" onClick={() => setAdv((v) => !v)}>
          {adv ? "▾" : "▸"} {t("rbac.sso.advanced", { defaultValue: "Advanced: endpoints, scopes, claim names" })}
        </button>
        {adv ? (
          <div className="grid gap-3 rounded-xl border border-[var(--border)] p-3">
            <Field label={t("rbac.sso.redirectBase", { defaultValue: "Public address of the panel (if a proxy hides it)" })}>
              <Input value={ov.redirectBase} placeholder="https://panel.example.com/" onChange={(e) => setOv({ ...ov, redirectBase: e.target.value })} />
            </Field>
            {preset !== "oauth2" ? (
              <Field label="Issuer">
                <Input value={ov.issuer} onChange={(e) => setOv({ ...ov, issuer: e.target.value })} />
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Authorization endpoint">
                <Input value={ov.authUrl} onChange={(e) => setOv({ ...ov, authUrl: e.target.value })} />
              </Field>
              <Field label="Token endpoint">
                <Input value={ov.tokenUrl} onChange={(e) => setOv({ ...ov, tokenUrl: e.target.value })} />
              </Field>
              <Field label="User info endpoint">
                <Input value={ov.userInfoUrl} onChange={(e) => setOv({ ...ov, userInfoUrl: e.target.value })} />
              </Field>
              <Field label="JWKS URL">
                <Input value={ov.jwksUrl} onChange={(e) => setOv({ ...ov, jwksUrl: e.target.value })} />
              </Field>
            </div>
            <Field label="Scopes (space separated)">
              <Input value={ov.scopes} placeholder="openid profile email" onChange={(e) => setOv({ ...ov, scopes: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("rbac.sso.claimGroups", { defaultValue: "Claim with groups" })}>
                <Input value={ov.groups} placeholder="groups" onChange={(e) => setOv({ ...ov, groups: e.target.value })} />
              </Field>
              <Field label={t("rbac.sso.claimEmail", { defaultValue: "Claim with e-mail" })}>
                <Input value={ov.email} placeholder="email" onChange={(e) => setOv({ ...ov, email: e.target.value })} />
              </Field>
              <Field label={t("rbac.sso.claimSubject", { defaultValue: "Claim with the user id" })}>
                <Input value={ov.subject} placeholder="sub" onChange={(e) => setOv({ ...ov, subject: e.target.value })} />
              </Field>
              <Field label={t("rbac.sso.claimUsername", { defaultValue: "Claim with the username" })}>
                <Input value={ov.username} placeholder="preferred_username" onChange={(e) => setOv({ ...ov, username: e.target.value })} />
              </Field>
            </div>
          </div>
        ) : null}

        <label className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
          <Switch checked={enabled} onChange={setEnabled} ariaLabel="enabled" />
          {t("rbac.sso.enableProvider", { defaultValue: "Show on the sign-in page" })}
        </label>
      </div>
    </Modal>
  );
}

function RuleModal({
  rule,
  providers,
  roles,
  onClose,
  onSaved,
}: {
  rule: SsoRule | null;
  providers: SsoProvider[];
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [providerId, setProviderId] = useState<number>(rule?.providerId ?? 0);
  const [kind, setKind] = useState<SsoRule["kind"]>(rule?.kind ?? "group");
  const [claim, setClaim] = useState(rule?.claim ?? "");
  const [value, setValue] = useState(rule?.value ?? "");
  const [roleId, setRoleId] = useState<number>(rule?.roleId ?? roles[0]?.id ?? 0);
  const [position, setPosition] = useState(rule?.position ?? 10);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const r = await ssoApi.saveRule(rule?.id ?? null, { providerId: providerId || null, position, kind, claim, value, roleId, enabled });
    setSaving(false);
    if (r.ok) onSaved();
    else setError(r.msg);
  };
  const placeholder =
    kind === "group" ? "sharx-admins  (ops-* matches a prefix)" : kind === "email_domain" ? "example.com" : kind === "email" ? "ann@example.com" : "";
  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? t("rbac.sso.editRule", { defaultValue: "Edit rule" }) : t("rbac.sso.addRule", { defaultValue: "Add rule" })}
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" loading={saving} disabled={!roleId || (kind !== "any" && !value.trim())} onClick={() => void save()}>
            {t("rbac.save", { defaultValue: "Save" })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <AlertBanner type="error" title={error} /> : null}
        <Field label={t("rbac.sso.appliesTo", { defaultValue: "Applies to" })}>
          <SelectNative value={providerId} onChange={(e) => setProviderId(Number(e.target.value))}>
            <option value={0}>{t("rbac.sso.allProviders", { defaultValue: "all providers" })}</option>
            {providers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </SelectNative>
        </Field>
        <Field label={t("rbac.sso.when", { defaultValue: "When" })}>
          <SelectNative value={kind} onChange={(e) => setKind(e.target.value as SsoRule["kind"])}>
            <option value="group">{t("rbac.sso.whenGroup", { defaultValue: "the person is in the group" })}</option>
            <option value="claim">{t("rbac.sso.whenClaim", { defaultValue: "a claim has the value" })}</option>
            <option value="email_domain">{t("rbac.sso.whenDomain", { defaultValue: "the verified e-mail is in the domain" })}</option>
            <option value="email">{t("rbac.sso.whenEmail", { defaultValue: "the verified e-mail is exactly" })}</option>
            <option value="any">{t("rbac.sso.whenAny", { defaultValue: "always (not for administrator roles)" })}</option>
          </SelectNative>
        </Field>
        {kind === "claim" ? (
          <Field label={t("rbac.sso.claimName", { defaultValue: "Claim name (dots go into nested objects)" })}>
            <Input value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="realm_access.roles" />
          </Field>
        ) : null}
        {kind !== "any" ? (
          <Field label={t("rbac.sso.value", { defaultValue: "Value" })}>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
          </Field>
        ) : null}
        <Field label={t("rbac.sso.giveRole", { defaultValue: "Give the role" })}>
          <SelectNative value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectNative>
        </Field>
        <Field label={t("rbac.sso.order", { defaultValue: "Order (smaller is checked first)" })}>
          <Input type="number" value={position} onChange={(e) => setPosition(Number(e.target.value))} />
        </Field>
        <label className="flex items-center gap-3 text-sm text-[var(--fg-muted)]">
          <Switch checked={enabled} onChange={setEnabled} ariaLabel="enabled" />
          {t("rbac.sso.ruleEnabled", { defaultValue: "Rule is active" })}
        </label>
      </div>
    </Modal>
  );
}
