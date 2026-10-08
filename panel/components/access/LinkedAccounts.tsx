"use client";

import { Link2, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton, useToast } from "@/components/ui";
import { getJson } from "@/lib/api";
import { p, panel } from "@/lib/paths";
import { ssoApi, type SsoIdentity } from "./rbacApi";

type Pub = { key: string; name: string };

/** The signed-in user's single sign-on accounts: link another one (the provider asks them to sign in there) or remove one. */
export function LinkedAccounts() {
  const { t } = useTranslation();
  const toast = useToast();
  const [mine, setMine] = useState<SsoIdentity[]>([]);
  const [providers, setProviders] = useState<Pub[]>([]);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([ssoApi.myIdentities(), getJson<{ providers: Pub[] }>(p("auth/providers"))]);
    if (a.ok) setMine(a.obj ?? []);
    if (b.success && b.obj?.providers) setProviders(b.obj.providers);
  }, []);

  useEffect(() => {
    void load();
    const q = new URLSearchParams(window.location.search);
    if (q.get("sso_linked")) toast.success(t("rbac.sso.linkedOk", { defaultValue: "Account linked" }));
    const err = q.get("sso_error");
    if (err) {
      toast.error(t(`pages.login.sso.errors.${err}`, { defaultValue: "Could not link the account." }));
    }
    if (q.get("sso_linked") || err) window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (providers.length === 0 && mine.length === 0) {
    return <p className="px-4 py-3 text-sm text-[var(--fg-muted)]">{t("rbac.sso.noneConfigured", { defaultValue: "No sign-in providers are set up." })}</p>;
  }
  return (
    <div className="divide-y divide-[var(--border)]">
      {providers.map((pr) => {
        const own = mine.find((i) => i.providerKey === pr.key);
        return (
          <div key={pr.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-[var(--fg)]">{pr.name}</div>
              <div className="truncate text-xs text-[var(--fg-muted)]">
                {own
                  ? `${own.displayName || own.email || own.providerKey}`
                  : t("rbac.sso.notLinked", { defaultValue: "Not linked" })}
              </div>
            </div>
            {own ? (
              <IconButton
                label={t("rbac.sso.unlink", { defaultValue: "Unlink" })}
                onClick={async () => {
                  const r = await ssoApi.myUnlink(own.id);
                  if (r.ok) void load();
                  else toast.error(r.msg);
                }}
              >
                <Unlink size={16} />
              </IconButton>
            ) : (
              <a href={panel(`auth/link/${pr.key}/start`)}>
                <Button variant="secondary" type="button">
                  <Link2 size={16} /> {t("rbac.sso.link", { defaultValue: "Link" })}
                </Button>
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
