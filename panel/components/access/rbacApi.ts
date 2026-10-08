import type { AxiosError } from "axios";
import { getJson, postJson, type Msg } from "@/lib/api";
import { panel } from "@/lib/paths";

export type Role = {
  id: number;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  createdAt: number;
  updatedAt: number;
  manageable: boolean;
  assignable: boolean;
};

export type UserRow = {
  id: number;
  username: string;
  enabled: boolean;
  roleId: number;
  roleName: string;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  twoFactor?: boolean;
  email?: string;
  authSource?: string;
  roleManaged?: boolean;
  self: boolean;
  manageable: boolean;
};

export type AuditRow = {
  id: number;
  ts: number;
  actorId?: number;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  before?: string;
  after?: string;
  ip: string;
  result: string;
  detail?: string;
};

export type AssignableRole = { id: number; name: string; description: string };

export type CallResult<T> = { ok: boolean; msg: string; obj?: T };

/** Runs a request and turns an HTTP error (the access-control endpoints answer 400/403/404/409 with `{success:false,msg}`) into a result. */
async function call<T>(fn: () => Promise<Msg<T>>): Promise<CallResult<T>> {
  try {
    const r = await fn();
    return { ok: r.success, msg: r.msg, obj: r.obj };
  } catch (e) {
    const ax = e as AxiosError<{ msg?: string }>;
    return { ok: false, msg: ax.response?.data?.msg || ax.message || "Request failed" };
  }
}

export const rbacApi = {
  roles: () => call<Role[]>(() => getJson<Role[]>(panel("rbac/roles"))),
  assignable: () => call<AssignableRole[]>(() => getJson<AssignableRole[]>(panel("rbac/assignable-roles"))),
  permissions: () => call<{ groups: { id: string; permissions: { key: string; group: string; sensitive?: boolean }[] }[] }>(() => getJson(panel("rbac/permissions"))),
  saveRole: (id: number | null, body: { name: string; description: string; permissions: string[] }) =>
    call<Role>(() => postJson<Role>(panel(id == null ? "rbac/roles" : `rbac/roles/${id}/update`), body, true)),
  deleteRole: (id: number) => call(() => postJson(panel(`rbac/roles/${id}/delete`), {}, true)),
  users: () => call<UserRow[]>(() => getJson<UserRow[]>(panel("rbac/users"))),
  createUser: (body: { username: string; password: string; roleId: number; enabled: boolean }) =>
    call<UserRow>(() => postJson<UserRow>(panel("rbac/users"), body, true)),
  updateUser: (id: number, body: { username?: string; roleId?: number; enabled?: boolean; email?: string; detachRole?: boolean }) =>
    call<UserRow>(() => postJson<UserRow>(panel(`rbac/users/${id}/update`), body, true)),
  resetTwoFactor: (id: number) => call(() => postJson(panel(`rbac/users/${id}/two-factor/reset`), {}, true)),
  setPassword: (id: number, password: string) => call(() => postJson(panel(`rbac/users/${id}/password`), { password }, true)),
  deleteUser: (id: number) => call(() => postJson(panel(`rbac/users/${id}/delete`), {}, true)),
  audit: (params: { before?: number; result?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.before) q.set("before", String(params.before));
    if (params.result) q.set("result", params.result);
    q.set("limit", String(params.limit ?? 50));
    return call<AuditRow[]>(() => getJson<AuditRow[]>(panel(`rbac/audit?${q}`)));
  },
};

// ------------------------------------------------------------------------------------------------ single sign-on

export type SsoPreset = {
  id: string;
  name: string;
  kind: string;
  params: { key: string; label: string; example?: string; optional?: boolean }[] | null;
  notes?: string;
  groups: boolean;
  stage: number;
};

export type SsoOverrides = {
  issuer?: string;
  authUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  jwksUrl?: string;
  scopes?: string[];
  claims?: { subject?: string; email?: string; emailVerified?: string; name?: string; username?: string; groups?: string };
  trustEmail?: boolean;
  tokenAuth?: string;
  pkce?: boolean;
  extraParams?: Record<string, string>;
  redirectBase?: string;
};

export type SsoProvider = {
  id: number;
  key: string;
  name: string;
  preset: string;
  kind: string;
  enabled: boolean;
  clientId: string;
  hasSecret: boolean;
  params: Record<string, string> | null;
  overrides: SsoOverrides;
  allowedDomains: string[];
  allowedEmails: string[];
  allowSignup: boolean;
  linkByEmail: boolean;
  roleMode: "local" | "idp";
  noMatch: "deny" | "default" | "keep";
  defaultRoleId?: number;
  callbackPath: string;
  identities: number;
  updatedAt: number;
};

export type SsoProviderInput = Omit<SsoProvider, "id" | "kind" | "hasSecret" | "callbackPath" | "identities" | "updatedAt" | "params"> & {
  params: Record<string, string>;
  clientSecret?: string | null;
};

export type SsoRule = {
  id: number;
  providerId?: number | null;
  position: number;
  kind: "group" | "claim" | "email_domain" | "email" | "any";
  claim: string;
  value: string;
  roleId: number;
  roleName: string;
  enabled: boolean;
};

export type SsoIdentity = {
  id: number;
  userId: number;
  username?: string;
  providerKey: string;
  provider: string;
  email: string;
  displayName: string;
  groups: string[];
  createdAt: number;
  lastLoginAt: number;
};

export const ssoApi = {
  presets: () => call<SsoPreset[]>(() => getJson<SsoPreset[]>(panel("auth/presets"))),
  providers: () => call<SsoProvider[]>(() => getJson<SsoProvider[]>(panel("auth/providers"))),
  saveProvider: (id: number | null, body: SsoProviderInput) =>
    call<SsoProvider>(() => postJson<SsoProvider>(panel(id == null ? "auth/providers" : `auth/providers/${id}/update`), body, true)),
  deleteProvider: (id: number) => call(() => postJson(panel(`auth/providers/${id}/delete`), {}, true)),
  testProvider: (id: number) => call<Record<string, string>>(() => postJson<Record<string, string>>(panel(`auth/providers/${id}/test`), {}, true)),
  rules: () => call<SsoRule[]>(() => getJson<SsoRule[]>(panel("auth/rules"))),
  saveRule: (id: number | null, body: { providerId: number | null; position: number; kind: string; claim: string; value: string; roleId: number; enabled: boolean }) =>
    call<SsoRule>(() => postJson<SsoRule>(panel(id == null ? "auth/rules" : `auth/rules/${id}/update`), body, true)),
  deleteRule: (id: number) => call(() => postJson(panel(`auth/rules/${id}/delete`), {}, true)),
  identities: () => call<SsoIdentity[]>(() => getJson<SsoIdentity[]>(panel("auth/identities"))),
  unlink: (id: number) => call(() => postJson(panel(`auth/identities/${id}/unlink`), {}, true)),
  settings: () => call<{ localLogin: boolean }>(() => getJson<{ localLogin: boolean }>(panel("auth/settings"))),
  saveSettings: (body: { localLogin: boolean }) => call(() => postJson(panel("auth/settings"), body, true)),
  myIdentities: () => call<SsoIdentity[]>(() => getJson<SsoIdentity[]>(panel("auth/my-identities"))),
  myUnlink: (id: number) => call(() => postJson(panel(`auth/my-identities/${id}/unlink`), {}, true)),
};
