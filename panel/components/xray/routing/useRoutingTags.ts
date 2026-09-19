"use client";

import { useEffect, useMemo, useState } from "react";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";

export type TagOption = { tag: string; hint?: string };

export type RoutingTagContext = {
  outbounds: TagOption[];
  inbounds: TagOption[];
};

type PanelInbound = { tag?: string; remark?: string; protocol?: string };

const NON_XRAY_PROTOCOLS = new Set(["telemt", "amneziawg"]);

function tagsOf(root: unknown, key: string): string[] {
  if (!root || typeof root !== "object") return [];
  const arr = (root as Record<string, unknown>)[key];
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const item of arr) {
    if (item && typeof item === "object") {
      const tag = (item as Record<string, unknown>).tag;
      if (typeof tag === "string" && tag.trim()) out.push(tag.trim());
    }
  }
  return out;
}

/** Outbound / inbound tags a routing rule may reference: those in the template plus panel-managed inbounds. */
export function useRoutingTags(fullTemplate: string | undefined, enabled: boolean): RoutingTagContext {
  const [panelInbounds, setPanelInbounds] = useState<PanelInbound[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await getJson<PanelInbound[]>(panel("api/inbounds/list"));
        if (!cancelled && r.success && Array.isArray(r.obj)) setPanelInbounds(r.obj);
      } catch {
        /* suggestions only — the editor still works with free text */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(() => {
    let root: unknown = null;
    try {
      root = fullTemplate ? JSON.parse(fullTemplate) : null;
    } catch {
      root = null;
    }
    const outbounds: TagOption[] = [...new Set(tagsOf(root, "outbounds"))].map((tag) => ({ tag }));
    const apiTag =
      root && typeof root === "object" && (root as Record<string, unknown>).api && typeof (root as Record<string, { tag?: unknown }>).api?.tag === "string"
        ? String((root as Record<string, { tag?: unknown }>).api!.tag).trim()
        : "";
    if (apiTag && !outbounds.some((o) => o.tag === apiTag)) {
      outbounds.push({ tag: apiTag, hint: "API" });
    }

    const seen = new Set<string>();
    const inbounds: TagOption[] = [];
    for (const tag of tagsOf(root, "inbounds")) {
      if (!seen.has(tag)) {
        seen.add(tag);
        inbounds.push({ tag });
      }
    }
    for (const ib of panelInbounds) {
      const tag = (ib.tag ?? "").trim();
      if (!tag || seen.has(tag) || NON_XRAY_PROTOCOLS.has(String(ib.protocol ?? "").toLowerCase())) continue;
      seen.add(tag);
      inbounds.push({ tag, hint: [ib.remark, ib.protocol].filter(Boolean).join(" · ") });
    }
    return { outbounds, inbounds };
  }, [fullTemplate, panelInbounds]);
}
