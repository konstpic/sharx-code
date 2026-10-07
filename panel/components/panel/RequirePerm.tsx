"use client";

import { Lock } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader, PageScaffold, Surface } from "@/components/panel";
import { Spinner } from "@/components/ui";
import { linkP } from "@/lib/paths";
import { useRbac } from "@/lib/rbac";

/** Pages in the order the shell offers them; the first one the user may open is where "back" and the dashboard fall back to. */
const LANDING: { perm: string; path: string }[] = [
  { perm: "dashboard:read", path: "panel/" },
  { perm: "inbounds:read", path: "panel/inbounds" },
  { perm: "clients:read", path: "panel/clients" },
  { perm: "groups:read", path: "panel/groups" },
  { perm: "nodes:read", path: "panel/nodes" },
  { perm: "hosts:read", path: "panel/hosts" },
  { perm: "bundles:read", path: "panel/bundles" },
  { perm: "xray:read", path: "panel/xray" },
  { perm: "users:read|roles:read|audit:read", path: "panel/access" },
  { perm: "", path: "panel/settings/security" },
];

/** The first page the signed-in user may open (the account page needs no permission, so there is always one). */
export function useLandingHref(): string {
  const { can } = useRbac();
  const hit = LANDING.find((x) => can(x.perm)) ?? LANDING[LANDING.length - 1];
  return linkP(hit.path);
}

/**
 * Page guard: shows the page only to users holding the permission. It is a convenience, not security: the data behind the
 * page is served by endpoints that check the same permission on the server.
 */
export function RequirePerm({
  perm,
  children,
  redirectToLanding = false,
}: {
  perm: string | string[];
  children: ReactNode;
  /** send users without access to their first allowed page instead of showing the notice (used for the dashboard) */
  redirectToLanding?: boolean;
}) {
  const { t } = useTranslation();
  const { loading, can } = useRbac();
  const allowed = can(perm);
  const landing = useLandingHref();

  useEffect(() => {
    if (!loading && !allowed && redirectToLanding && typeof window !== "undefined") {
      window.location.replace(landing);
    }
  }, [loading, allowed, redirectToLanding, landing]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (allowed) return <>{children}</>;
  if (redirectToLanding) return null;
  return (
    <PageScaffold>
      <PageHeader title={t("rbac.noAccessTitle", { defaultValue: "No access" })} icon={Lock} iconTone="warning" />
      <Surface className="text-center" padding="lg">
        <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--fg-muted)]">
          {t("rbac.noAccessText", { defaultValue: "Your role does not include access to this section. Ask an administrator if you need it." })}
        </p>
        <a href={landing} className="mt-4 inline-block text-sm font-medium text-[var(--accent)] hover:underline">
          {t("rbac.noAccessBack", { defaultValue: "Go to a page you can open" })}
        </a>
      </Surface>
    </PageScaffold>
  );
}
