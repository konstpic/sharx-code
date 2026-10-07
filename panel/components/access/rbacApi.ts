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
  updateUser: (id: number, body: { username?: string; roleId?: number; enabled?: boolean }) =>
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
