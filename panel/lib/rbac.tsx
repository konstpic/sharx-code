"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";

/** The signed-in user and what their role allows, as reported by `GET /panel/rbac/me`. */
export type Me = {
  userId: number;
  username: string;
  roleId: number;
  roleName: string;
  super: boolean;
  permissions: string[];
};

type RbacState = {
  /** null while loading or when the request failed */
  me: Me | null;
  loading: boolean;
  /**
   * can("clients:update"), can("clients:update|clients:delete") (any of), can(["a","b"]) (all of).
   * The UI uses it to hide what the backend would refuse. It is NOT a security check: every request is checked on the server.
   */
  can: (perm: string | string[] | undefined) => boolean;
  reload: () => Promise<void>;
};

const RbacContext = createContext<RbacState>({ me: null, loading: true, can: () => false, reload: async () => {} });

function evaluate(me: Me | null, perm: string | string[] | undefined): boolean {
  if (perm === undefined || perm === "" || (Array.isArray(perm) && perm.length === 0)) return true;
  if (!me) return false;
  if (me.super) return true;
  const set = new Set(me.permissions);
  const one = (p: string) => p.split("|").some((alt) => set.has(alt));
  return Array.isArray(perm) ? perm.every(one) : one(perm);
}

export function RbacProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const r = await getJson<Me>(panel("rbac/me"));
      if (r.success && r.obj) setMe(r.obj);
    } catch {
      /* the next navigation retries; until then the UI shows only what needs no permission */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Role changes made by an administrator should show up without a new sign-in.
  useEffect(() => {
    const id = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(id);
  }, [reload]);

  const value = useMemo<RbacState>(() => ({ me, loading, can: (p) => evaluate(me, p), reload }), [me, loading, reload]);
  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
}

export function useRbac(): RbacState {
  return useContext(RbacContext);
}

/** True when the signed-in user holds the permission (see RbacState.can). */
export function useCan(perm: string | string[] | undefined): boolean {
  const { can } = useRbac();
  return can(perm);
}

/** Renders children only when the user holds the permission. */
export function Can({ perm, children, fallback = null }: { perm: string | string[]; children: ReactNode; fallback?: ReactNode }) {
  return useCan(perm) ? <>{children}</> : <>{fallback}</>;
}

/** Permission catalogue as served by `GET /panel/rbac/permissions`. */
export type PermissionInfo = { key: string; group: string; sensitive?: boolean };
export type PermissionGroup = { id: string; permissions: PermissionInfo[] };

/**
 * Renders its children as a read-only form when `readOnly`: a disabled fieldset disables every control inside it, so a
 * modal can show an object to a user who may view but not change it. The server refuses the change in any case.
 */
export function ReadOnlyScope({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  if (!readOnly) return <>{children}</>;
  return (
    <fieldset disabled className="m-0 min-w-0 border-0 p-0">
      {children}
    </fieldset>
  );
}
