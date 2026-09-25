"use client";

import { Smartphone } from "lucide-react";
import { normalizeAddToAppBlock, type BlockAddToApp } from "@/lib/sharxSubpageConfig";
import { resolveAddToAppButtons, type RenderedButton } from "@/lib/addToAppButtons";
import { resolveMtProtoLinks } from "../types";
import shell from "../subscription-shell.module.css";
import type { BlockRenderContext } from "./index";

export function AddToAppBlock({
  block,
  ctx,
}: {
  block: BlockAddToApp;
  ctx: BlockRenderContext;
}) {
  const { data, interactive, t } = ctx;
  if (!data.subscriptionUrl) return null;

  const normalized = normalizeAddToAppBlock(block);
  const rendered: RenderedButton[] = resolveAddToAppButtons(block, data, resolveMtProtoLinks(data));
  if (rendered.length === 0) return null;

  const title =
    normalized.title?.trim() ||
    t("pages.publicSub.addToApp", { defaultValue: "Add to app" });

  return (
    <div>
      <h2 className={shell.sectionTitle}>{title}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {rendered.map((link) => (
          <a
            key={link.id}
            href={link.href}
            className="group flex items-center gap-3 rounded-xl border border-[var(--sub-border)] bg-[var(--sub-surface)] p-3 text-sm font-medium text-[var(--sub-fg)] transition hover:border-[color-mix(in_oklab,var(--sub-accent)_50%,transparent)] hover:bg-[var(--sub-accent-soft)]"
            onClick={(e) => {
              if (!interactive) e.preventDefault();
            }}
          >
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--sub-border)] bg-[var(--sub-surface)] text-[var(--sub-accent)]">
              {link.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={link.iconUrl}
                  alt=""
                  className="size-full object-contain"
                  loading="lazy"
                />
              ) : (
                <Smartphone className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{link.label}</span>
              {link.platforms && link.platforms.length > 0 ? (
                <span className="mt-0.5 block truncate text-[10px] uppercase tracking-wider text-[var(--sub-fg-muted,rgba(201,209,217,0.6))]">
                  {link.platforms.join(" · ")}
                </span>
              ) : null}
            </span>
            {link.badge ? (
              <span className="shrink-0 rounded-full border border-[color-mix(in_oklab,var(--sub-accent)_35%,transparent)] bg-[var(--sub-accent-soft)] px-2 py-[1px] text-[10px] font-semibold tracking-wider text-[var(--sub-accent)]">
                {link.badge}
              </span>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}
