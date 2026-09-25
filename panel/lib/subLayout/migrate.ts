import type { SharxSubpageConfigV2, SubpageBlock } from "../sharxSubpageConfig";
import { insertNode, newDoc, newNode } from "./tree";
import type { LayoutDoc, LNode } from "./types";

const BLOCK_NAMES: Record<SubpageBlock["kind"], string> = {
  "subscription-info": "Subscription info",
  "installation-guide": "Installation guide",
  "links-list": "Links",
  "support-cta": "Support",
  "custom-html": "Custom HTML",
  metrics: "Metrics",
  "add-to-app": "Add to app",
};

/** A block node keeps a copy of the classic block config: the classic renderer draws it, the designer places it. */
export function blockNode(block: SubpageBlock): LNode {
  return newNode("block", { name: BLOCK_NAMES[block.kind] ?? "Block", props: { kind: block.kind, block: JSON.parse(JSON.stringify(block)) } });
}

/**
 * The classic page as a layout: header bar, then the content column with the enabled blocks, then the language switch.
 * Rendering it looks the same as the classic renderer, which is what makes switching to the designer safe.
 */
export function layoutFromConfig(cfg: Pick<SharxSubpageConfigV2, "blocks" | "locales">): LayoutDoc {
  let doc = newDoc({ name: "Page", style: { mode: "stack", dir: "column", gap: 0, pad: 0, w: "fill" } });
  const header = newNode("header", { name: "Header" });
  const content = newNode("frame", {
    name: "Content",
    style: { mode: "stack", dir: "column", gap: 32, pad: [32, 32, 64, 32], w: "fill", maxW: 1200, self: "center" },
    mobile: { pad: [24, 16, 48, 16] },
  });
  doc = insertNode(doc, doc.root, 0, header);
  doc = insertNode(doc, doc.root, 1, content);
  let at = 0;
  for (const b of cfg.blocks ?? []) {
    if (b.enabled === false) continue;
    doc = insertNode(doc, content.id, at++, blockNode(b));
  }
  if ((cfg.locales ?? []).length > 1) doc = insertNode(doc, content.id, at++, newNode("locale-switch", { name: "Language" }));
  doc = insertNode(
    doc,
    content.id,
    at++,
    newNode("text", {
      name: "Hint",
      props: { text: "Use the subscription URL in your VPN app.", tag: "p" },
      style: { fs: 11, ta: "center", color: "var(--sub-fg-subtle, #6e7681)" },
      visibleIf: "subscription.url",
    }),
  );
  return doc;
}
