import { describe, expect, it } from "vitest";
import { layoutFromConfig } from "./migrate";
import { normalizeDoc } from "./tree";

const block = (kind: string, enabled = true) => ({ kind, enabled, id: kind }) as never;

describe("layoutFromConfig", () => {
  it("builds a doc that normalizeDoc accepts unchanged", () => {
    const doc = layoutFromConfig({ blocks: [block("subscription-info"), block("links-list"), block("metrics", false)], locales: ["en", "ru"] } as never);
    const n = normalizeDoc(JSON.parse(JSON.stringify(doc)));
    expect(n).not.toBeNull();
    expect(Object.keys(n!.nodes).sort()).toEqual(Object.keys(doc.nodes).sort());
    expect(n!.root).toBe(doc.root);
  });
  it("skips disabled blocks and keeps order", () => {
    const doc = layoutFromConfig({ blocks: [block("subscription-info"), block("metrics", false), block("links-list")], locales: ["en"] } as never);
    const [, contentId] = doc.nodes[doc.root].children!;
    const kinds = doc.nodes[contentId].children!.map((c) => doc.nodes[c]).filter((c) => c.type === "block").map((c) => c.props.kind);
    expect(kinds).toEqual(["subscription-info", "links-list"]);
  });
  it("adds a language switch only with several locales", () => {
    const types = (locales: string[]) => Object.values(layoutFromConfig({ blocks: [], locales } as never).nodes).map((n) => n.type);
    expect(types(["en"])).not.toContain("locale-switch");
    expect(types(["en", "ru"])).toContain("locale-switch");
  });
  it("copies the block config instead of sharing it", () => {
    const b = { kind: "custom-html", enabled: true, html: "x" } as never;
    const doc = layoutFromConfig({ blocks: [b], locales: [] } as never);
    const node = Object.values(doc.nodes).find((n) => n.type === "block")!;
    expect(node.props.block).toEqual(b);
    expect(node.props.block).not.toBe(b);
  });
  it("tolerates missing blocks/locales", () => {
    expect(normalizeDoc(layoutFromConfig({} as never))).not.toBeNull();
  });
});
