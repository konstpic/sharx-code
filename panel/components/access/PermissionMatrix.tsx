"use client";

import { Lock, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PermissionGroup } from "@/lib/rbac";
import { actionLabel, groupLabel, permissionHint, resourceLabel, resourceOf } from "./permLabels";

/**
 * The permissions of a role, grouped by functional section: one row per resource with its actions as toggles. Ticking an
 * action ticks "View" of the same resource (the backend does the same on save). Permissions the editor may not grant are
 * shown disabled: you cannot hand out what you do not hold.
 */
export function PermissionMatrix({
  groups,
  value,
  onChange,
  canGrant,
  readOnly = false,
}: {
  groups: PermissionGroup[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /** whether the editor may put this permission into a role */
  canGrant: (key: string) => boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();

  const toggle = (key: string, on: boolean) => {
    const next = new Set(value);
    const res = resourceOf(key);
    const read = `${res}:read`;
    if (on) {
      next.add(key);
      if (key !== read && canGrant(read)) next.add(read);
    } else {
      next.delete(key);
      if (key === read) {
        // taking away "View" takes the rest of the resource with it
        for (const k of Array.from(next)) if (resourceOf(k) === res) next.delete(k);
      }
    }
    onChange(next);
  };

  const setGroup = (g: PermissionGroup, on: boolean) => {
    const next = new Set(value);
    for (const p of g.permissions) {
      if (on && canGrant(p.key)) next.add(p.key);
      if (!on && canGrant(p.key)) next.delete(p.key);
    }
    onChange(next);
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {groups.map((g) => {
        const grantable = g.permissions.filter((p) => canGrant(p.key));
        const selected = g.permissions.filter((p) => value.has(p.key)).length;
        const allOn = grantable.length > 0 && grantable.every((p) => value.has(p.key));
        // resources in the group, in catalogue order
        const resources = Array.from(new Set(g.permissions.map((p) => resourceOf(p.key))));
        return (
          <section key={g.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
            <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
              <h4 className="text-sm font-semibold text-[var(--fg)]">
                {groupLabel(t, g.id)}
                <span className="ml-2 text-xs font-normal text-[var(--fg-subtle)]">
                  {selected}/{g.permissions.length}
                </span>
              </h4>
              {!readOnly && grantable.length > 0 ? (
                <button type="button" className="text-xs text-[var(--accent)] hover:underline" onClick={() => setGroup(g, !allOn)}>
                  {allOn ? t("rbac.selectNone", { defaultValue: "Clear" }) : t("rbac.selectAll", { defaultValue: "Select all" })}
                </button>
              ) : null}
            </header>
            <div className="divide-y divide-[var(--border)]">
              {resources.map((res) => (
                <div key={res} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                  <span className="w-28 shrink-0 text-sm text-[var(--fg)]">{resourceLabel(t, res)}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {g.permissions
                      .filter((p) => resourceOf(p.key) === res)
                      .map((p) => {
                        const on = value.has(p.key);
                        const locked = !canGrant(p.key);
                        const disabled = readOnly || locked;
                        const hint = permissionHint(t, p.key);
                        const title = locked && !readOnly
                          ? t("rbac.cannotGrant", { defaultValue: "You cannot grant a permission you do not hold" })
                          : hint;
                        return (
                          <button
                            key={p.key}
                            type="button"
                            disabled={disabled}
                            title={title}
                            aria-pressed={on}
                            onClick={() => toggle(p.key, !on)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:cursor-not-allowed ${
                              on
                                ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                                : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
                            } ${locked && !on ? "opacity-40" : ""}`}
                          >
                            {p.sensitive ? <ShieldAlert size={11} className="opacity-80" aria-label="sensitive" /> : null}
                            {actionLabel(t, p.key)}
                            {locked && !readOnly ? <Lock size={10} /> : null}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One line per section with what a role may do there: "Clients: View, Edit · Nodes: View". Used in role lists. */
export function usePermissionSummary(groups: PermissionGroup[]) {
  const { t } = useTranslation();
  return useMemo(
    () => (perms: string[]): { group: string; text: string }[] => {
      if (perms.includes("*")) return [{ group: "*", text: t("rbac.everything", { defaultValue: "Everything" }) }];
      const set = new Set(perms);
      const out: { group: string; text: string }[] = [];
      for (const g of groups) {
        const byRes = new Map<string, string[]>();
        for (const p of g.permissions) {
          if (!set.has(p.key)) continue;
          const r = resourceOf(p.key);
          byRes.set(r, [...(byRes.get(r) ?? []), actionLabel(t, p.key)]);
        }
        if (byRes.size === 0) continue;
        const text = Array.from(byRes.entries())
          .map(([r, acts]) => `${resourceLabel(t, r)}: ${acts.join(", ")}`)
          .join(" · ");
        out.push({ group: groupLabel(t, g.id), text });
      }
      return out;
    },
    [groups, t],
  );
}
