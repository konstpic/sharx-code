import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_BYTES, MY_PRESETS_LIMIT, PRESETS, PRESET_ID_PREFIX, PRESET_TAGS, addMyPreset, applyPresetStyle, buildMyPreset, deleteMyPreset, duplicateMyPreset,
  exportMyPreset, importMyPresets, makeMyPreset, myPresetBoard, parseMyPresets, presetBoard, presetById, presetByMarker, presetStyleMap, renameMyPreset,
  replaceWithMyPreset, replaceWithPreset, resetBoardToPreset, sanitizeMyPreset, type PresetCtx,
} from "./dashboardPresets";
import { BOARD_PRESET_IDS, DEFAULT_DASHBOARD_PRESET, deriveLayout, emptyCellCount, hasOverlap, isDashboardPreset, tileKind, type GridItem } from "./dashboardGrid";
import { MAX_PANELS, atomPanel } from "./dashboardModel";
import { ATOMS, atomDef } from "./dashboardLayout";
import { dashboardMetrics } from "./dashboardMetrics";
import { BALANCER_AGG_DEFS, BALANCER_DEFS, NODE_AGG_DEFS, NODE_DEFS, PANEL_DEFS } from "./dashboardMetricsNodes";
import { normalizeStyle, resolveStyle } from "./dashboardStyle";
import { layoutConstraints, parseWorkspace, saveActiveBoard, type DashboardWorkspace } from "./dashboardBuilder";

const t = (k: string) => k;
const ents = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `${p}-${i + 1}` }));
const CTXS: Record<string, PresetCtx> = {
  empty: { t },
  oneNode: { t, nodes: ents(1, "N") },
  many: { t, nodes: ents(5, "N"), balancers: ents(2, "B") },
  noPermissions: { t, can: { logs: false, backup: false, xrayOperate: false } },
  huge: { t, nodes: ents(40, "N"), balancers: ents(40, "B") },
};

const STATUS = {
  cpu: 1, cpuCores: 1, cpuSpeedMhz: 1, mem: { current: 1, total: 2 }, disk: { current: 1, total: 2 }, swap: { current: 1, total: 2 }, loads: [1, 1, 1], netIO: { up: 1, down: 1 },
  netTraffic: { sent: 1, recv: 1 }, tcpCount: 1, udpCount: 1, uptime: 1, appStats: { threads: 1, mem: 1, uptime: 1 },
  database: { size: 1, tables: 1, totalRows: 1, openConns: 1, idleConns: 1, maxOpenConns: 1, maxIdleConns: 1 },
};
const KNOWN = new Set<string>([
  ...dashboardMetrics(STATUS as never, t).map((x) => x.id),
  "clients.total", "clients.enabled", "clients.traffic", "clients.allTime",
  ...NODE_AGG_DEFS.map((d) => "nodes." + d.key), ...BALANCER_AGG_DEFS.map((d) => "balancers." + d.key), ...PANEL_DEFS.map((d) => d.id),
]);
const entityKnown = (id: string) => {
  const m = /^(node|balancer):(\d+):(.+)$/.exec(id);
  return !!m && (m[1] === "node" ? NODE_DEFS : BALANCER_DEFS).some((d) => d.key === m[3]);
};

describe("registry", () => {
  it("has ~12 presets with unique ids / markers, i18n keys and known tags", () => {
    expect(PRESETS.length).toBe(12);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.marker)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.nameKey).toMatch(/^pages\.builder\.presets\.name_/);
      expect(p.descKey).toMatch(/^pages\.builder\.presets\.desc_/);
      expect(p.tags.length).toBeGreaterThan(0);
      for (const g of p.tags) expect(PRESET_TAGS).toContain(g);
      expect(isDashboardPreset(p.marker)).toBe(true);
      expect(p.preview.length).toBeGreaterThan(0);
      for (const row of p.preview) expect(row.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12);
    }
    expect(PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(["modern", "classic26", "v271", "noc", "minimal", "network", "infra", "clients", "telemt", "neon", "soft", "phone"]));
    expect(presetByMarker("classic")!.id).toBe("classic26");
    expect(BOARD_PRESET_IDS.every((id) => presetByMarker(id))).toBe(true);
    expect(DEFAULT_DASHBOARD_PRESET).toBe("classic");
    expect(isDashboardPreset("nope")).toBe(false);
  });
});

describe.each(Object.entries(CTXS))("every preset builds for ctx %s", (_name: string, ctx: PresetCtx) => {
  it.each(PRESETS.map((p) => p.id))("%s", (id: string) => {
    const p = presetById(id)!;
    const b = p.build(ctx);
    expect(b.panels.length).toBeGreaterThan(0);
    expect(b.panels.length).toBeLessThanOrEqual(MAX_PANELS);
    expect(new Set(b.panels.map((x) => x.id)).size).toBe(b.panels.length);
    expect(b.rects.length).toBe(b.panels.length);
    expect(b.rects.every((r) => b.panels.some((x) => x.id === r.id) && b.tiles[r.id])).toBe(true);
    const cons = layoutConstraints({ panels: b.panels, tiles: b.tiles });
    const items: GridItem[] = b.rects;
    expect(hasOverlap(items)).toBe(false);
    expect(emptyCellCount(items, 12)).toBe(0);
    // minimum sizes of every tile hold at 12 columns
    for (const r of items) {
      const c = cons(r.id);
      expect(r.w).toBeGreaterThanOrEqual(Math.min(12, c.minW));
      expect(r.h).toBeGreaterThanOrEqual(c.minH);
    }
    // 6 columns (tablet) and 1 column (phone: full / half width tiles, 12 of 12)
    const md = deriveLayout(items, "md", cons);
    expect(hasOverlap(md)).toBe(false);
    expect(emptyCellCount(md, 6)).toBe(0);
    const sm = deriveLayout(items, "sm", cons);
    expect(hasOverlap(sm)).toBe(false);
    expect(emptyCellCount(sm, 12)).toBe(0);
    // tiles are well-formed: metric tiles reference real metrics, widgets real atoms
    for (const q of b.panels) {
      if (q.kind === "metric") {
        expect(q.metrics.length).toBeGreaterThan(0);
        for (const mid of q.metrics) expect(KNOWN.has(mid) || entityKnown(mid), mid).toBe(true);
      } else expect(atomDef(q.widget ?? "")).toBeTruthy();
      expect(q.id).toMatch(/^custom-[a-zA-Z0-9-]+$/);
    }
    // styles survive the sanitiser unchanged
    for (const q of b.panels) {
      const s = b.tiles[q.id].style;
      if (s) expect(normalizeStyle(s)).toEqual(s);
    }
  });
});

describe("content of the presets", () => {
  const count = (id: string, ctx: PresetCtx = CTXS.many) => presetById(id)!.build(ctx).panels.length;
  it("no-node installations skip node / balancer tiles; per-entity rows follow the live lists", () => {
    const ids = (id: string, ctx: PresetCtx) => presetById(id)!.build(ctx).panels.flatMap((p) => p.metrics);
    expect(ids("noc", CTXS.empty).some((m) => m.startsWith("nodes."))).toBe(false);
    expect(ids("noc", CTXS.many).some((m) => m.startsWith("nodes."))).toBe(true);
    expect(ids("infra", CTXS.empty).length).toBe(4);
    const nodeRows = (n: number) => presetById("infra")!.build({ t, nodes: ents(n, "N") }).panels.filter((p) => p.metrics[0]?.startsWith("node:")).length;
    expect(nodeRows(3) - nodeRows(2)).toBe(6);
    expect(presetById("infra")!.build(CTXS.many).panels.some((p) => p.metrics[0]?.startsWith("balancer:2:"))).toBe(true);
    expect(presetById("infra")!.dynamic).toBe(true);
    expect(count("infra", CTXS.huge)).toBeLessThanOrEqual(MAX_PANELS);
  });
  it("noc uses contrast + level colours, neon the neon frame, soft the soft frame, minimal the flat frame", () => {
    const style = (id: string) => presetById(id)!.build(CTXS.many).tiles;
    const first = (id: string) => Object.values(style(id))[0].style!;
    expect(first("noc").preset).toBe("contrast");
    expect(resolveStyle(first("noc")).levelColors.ok).toBe("#22c55e");
    expect(first("neon").preset).toBe("neon");
    expect(first("soft").preset).toBe("soft");
    expect(first("minimal").preset).toBe("flat");
    expect(first("network").preset).toBe("gradient");
    expect(first("clients").preset).toBe("soft");
    expect(first("infra").preset).toBe("glass");
    expect(count("phone")).toBe(12);
    expect(presetById("phone")!.build(CTXS.empty).rects.every((r) => r.w <= 4)).toBe(true);
    expect(presetById("modern")!.styled).toBe(false);
    expect(presetById("noc")!.styled).toBe(true);
  });
  it("the legacy three keep the ids of their sets and the classic marker", () => {
    expect(presetById("classic26")!.build({}).panels.map((p) => p.id)).toContain("custom-classic-resources");
    expect(presetById("classic26")!.marker).toBe("classic");
    expect(presetById("noc")!.build({}).panels.every((p) => p.id.startsWith(PRESET_ID_PREFIX))).toBe(true);
  });
});

describe("boards from presets", () => {
  it("a new board carries the preset marker; layout is hole-free", () => {
    for (const p of PRESETS) {
      const b = presetBoard(p, CTXS.many, "x", "board-1");
      expect(b.preset).toBe(p.marker);
      expect(b.layout.grid!.length).toBe(b.layout.panels.length);
      expect(hasOverlap(b.layout.grid!)).toBe(false);
      expect(emptyCellCount(b.layout.grid!, 12)).toBe(0);
    }
  });

  it("reset restores THAT preset (also with missing tiles and extra user tiles below)", () => {
    for (const p of PRESETS) {
      const b = presetBoard(p, CTXS.many, "x", "b");
      const l = b.layout;
      const scrambled = l.grid!.map((g, i) => ({ ...g, x: 0, y: i * 7 }));
      const out = resetBoardToPreset(b.preset, l.panels, l.tiles, scrambled, CTXS.many, layoutConstraints(l));
      expect(hasOverlap(out)).toBe(false);
      expect(emptyCellCount(out, 12)).toBe(0);
      expect(out.length).toBe(l.panels.length);
      for (const g of l.grid!) expect(out.find((o) => o.id === g.id), p.id + ":" + g.id).toMatchObject({ x: g.x, y: g.y, w: g.w });
    }
    // a user tile is arranged below; a deleted tile leaves no hole
    const noc = presetBoard(presetById("noc")!, CTXS.many, "x", "b").layout;
    const extra = atomPanel("net_up", "custom-user1")!;
    const panels = [...noc.panels.slice(1), extra.panel];
    const tiles = { ...noc.tiles, [extra.panel.id]: extra.tile };
    const cur = [...noc.grid!.slice(1), { id: "custom-user1", x: 0, y: 0, w: 3, h: 4 }];
    const out = resetBoardToPreset("noc", panels, tiles, cur, CTXS.many, layoutConstraints({ panels, tiles }));
    expect(hasOverlap(out)).toBe(false);
    expect(emptyCellCount(out, 12)).toBe(0);
    const maxPresetY = Math.max(...out.filter((o) => o.id !== "custom-user1").map((o) => o.y + o.h));
    expect(out.find((o) => o.id === "custom-user1")!.y + 0).toBeGreaterThanOrEqual(maxPresetY - 12);
  });

  it("modern / classic / v271 reset semantics are unchanged", () => {
    const m = presetBoard(presetById("modern")!, {}, "x", "b").layout;
    const out = resetBoardToPreset("modern", m.panels, m.tiles, m.grid!.map((g) => ({ ...g, x: 0 })), {}, layoutConstraints(m));
    for (const g of m.grid!) expect(out.find((o) => o.id === g.id)).toMatchObject({ x: g.x, y: g.y });
    const c = presetBoard(presetById("classic26")!, {}, "x", "b").layout;
    const out2 = resetBoardToPreset("classic", c.panels, c.tiles, [], {}, layoutConstraints(c));
    for (const g of c.grid!) expect(out2.find((o) => o.id === g.id)).toMatchObject({ x: g.x, y: g.y });
    expect(resetBoardToPreset(undefined, m.panels, m.tiles, m.grid!, {}, layoutConstraints(m)).length).toBe(m.panels.length);
  });

  it("replace keeps the user's own tiles below; the tiles of the former preset go", () => {
    const base = presetBoard(presetById("neon")!, {}, "x", "b").layout;
    const own = { id: "custom-mine1", title: "mine", kind: "metric" as const, metrics: ["cpu"], code: "", url: "", text: "" };
    const l = { ...base, panels: [...base.panels, own], order: [...base.order, own.id], tiles: { ...base.tiles, [own.id]: { width: 3, height: 4, view: "stat", title: "" } }, grid: [...base.grid!, { id: own.id, x: 0, y: 100, w: 3, h: 4 }] };
    const out = replaceWithPreset(l, presetById("noc")!, CTXS.many);
    expect(out.panels.some((p) => p.id === own.id)).toBe(true);
    expect(out.panels.some((p) => p.id.startsWith("custom-pr-neon"))).toBe(false);
    expect(out.panels.some((p) => p.id.startsWith("custom-pr-noc"))).toBe(true);
    expect(hasOverlap(out.grid!)).toBe(false);
    expect(emptyCellCount(out.grid!, 12)).toBe(0);
    expect(out.grid!.length).toBe(out.panels.length);
  });

  it("apply only the look: kinds are matched, data / sizes / positions stay", () => {
    const base = presetBoard(presetById("soft")!, {}, "x", "b").layout;
    const noc = presetById("noc")!;
    expect(presetStyleMap(noc).has("*")).toBe(true);
    const out = applyPresetStyle(base, noc);
    expect(out.grid).toEqual(base.grid);
    for (const p of base.panels) {
      expect(out.tiles[p.id].width).toBe(base.tiles[p.id].width);
      expect(out.tiles[p.id].view).toBe(base.tiles[p.id].view);
      expect(out.tiles[p.id].style!.preset).toBe("contrast");
      expect(normalizeStyle(out.tiles[p.id].style)).toEqual(out.tiles[p.id].style);
    }
    // a preset without a look of its own changes nothing
    expect(applyPresetStyle(base, presetById("modern")!)).toBe(base);
    expect(tileKind("custom-x", "gauge", "metric")).toBe("viz");
  });
});

const mk = (n: number, nodes = 5) => {
  const ctx: PresetCtx = { t, nodes: ents(nodes, "Node"), balancers: ents(2, "LB") };
  const b = presetBoard(presetById("infra")!, ctx, "x", "b");
  return { ctx, layout: b.layout, preset: makeMyPreset("my-" + n, "Mine " + n, "desc", { panels: b.layout.panels, tiles: b.layout.tiles, grid: b.layout.grid! }, ctx, 1)! };
};

describe("my presets", () => {
  it("per-node rows are stored as a template of the first node and rebuilt for the live list", () => {
    const { preset, ctx } = mk(1);
    expect(preset).toBeTruthy();
    const tpl = preset.layout.panels.filter((p) => /^node:@:/.test(p.metrics[0]));
    expect(tpl.length).toBe(6);
    expect(preset.layout.panels.every((p) => !/^(node|balancer):\d+:/.test(p.metrics.join()))).toBe(true);
    expect(JSON.stringify(preset)).not.toMatch(/node:\d+:/);
    expect(tpl.some((p) => p.title.startsWith("%name%"))).toBe(true);
    for (const n of [0, 1, 3, 7]) {
      const b = buildMyPreset(preset, { t, nodes: ents(n, "Z"), balancers: ents(1, "Q") });
      expect(b.panels.filter((p) => /^node:\d+:/.test(p.metrics[0])).length).toBe(6 * n);
      expect(b.panels.filter((p) => /^balancer:/.test(p.metrics[0])).length).toBe(6);
      expect(new Set(b.panels.map((p) => p.id)).size).toBe(b.panels.length);
      expect(hasOverlap(b.rects)).toBe(false);
      expect(emptyCellCount(b.rects, 12)).toBe(0);
      if (n) expect(b.panels.some((p) => p.title.startsWith("Z-1 · "))).toBe(true);
    }
    const board = myPresetBoard(preset, ctx, "board-9");
    expect(board.preset).toBeUndefined();
    expect(board.name).toBe("Mine 1");
    const l = replaceWithMyPreset(board.layout, preset, ctx);
    expect(emptyCellCount(l.grid!, 12)).toBe(0);
  });

  it("a board without entities keeps its exact positions; content tiles are not stored", () => {
    const b = presetBoard(presetById("neon")!, {}, "x", "b").layout;
    const html = { id: "custom-html1", title: "h", kind: "html" as const, metrics: [], code: "<script>alert(1)</script>", url: "", text: "" };
    const mp = makeMyPreset("my-a", "Neon copy", "", { panels: [...b.panels, html], tiles: { ...b.tiles }, grid: [...b.grid!, { id: html.id, x: 0, y: 50, w: 4, h: 4 }] }, {}, 5)!;
    expect(mp.layout.panels.some((p) => p.kind === "html")).toBe(false);
    const out = buildMyPreset(mp, {});
    expect(out.panels.length).toBe(b.panels.length);
    expect(out.rects.map((r) => [r.x, r.y, r.w, r.h])).toEqual(b.grid!.map((g) => [g.x, g.y, g.w, g.h]));
    expect(out.tiles[out.panels[0].id].style).toEqual(b.tiles[b.panels[0].id].style);
    expect(makeMyPreset("e", "n", "", { panels: [], tiles: {}, grid: [] })).toBeNull();
  });

  it("limits the list to 24, rejects duplicates, supports rename / duplicate / delete", () => {
    let list = parseMyPresets([]);
    for (let i = 0; i < 30; i++) list = addMyPreset(list, mk(i).preset);
    expect(list.length).toBe(MY_PRESETS_LIMIT);
    expect(parseMyPresets(JSON.parse(JSON.stringify(list.concat(list)))).length).toBe(MY_PRESETS_LIMIT);
    const small = [mk(1).preset];
    expect(addMyPreset(small, small[0]).length).toBe(1);
    expect(renameMyPreset(small, "my-1", "  New <b>name</b>  ", "d")[0].name).toBe("New bname/b");
    const dup = duplicateMyPreset(small, "my-1", "my-copy", "(copy)");
    expect(dup.length).toBe(2);
    expect(dup[1].id).toBe("my-copy");
    expect(deleteMyPreset(dup, "my-1").map((x) => x.id)).toEqual(["my-copy"]);
  });

  it("sanitizes hostile stored data and never throws", () => {
    const good = mk(1).preset;
    const evil = JSON.parse(JSON.stringify(good));
    evil.name = "<script>alert(1)</script>\u0000" + "x".repeat(500);
    evil.desc = 42;
    evil.layout.panels[0].title = "<img src=x onerror=alert(1)>";
    evil.layout.panels[0].code = "<script>bad()</script>";
    evil.layout.panels[1] = { id: "custom-x", kind: "html", code: "<script>1</script>", metrics: [], title: "", url: "", text: "" };
    evil.layout.panels[2] = { id: "bad id!", kind: "metric", metrics: ["cpu"] };
    evil.layout.panels[3].metrics = ["cpu; drop table", "javascript:alert(1)"];
    evil.layout.tiles[evil.layout.panels[0].id] = { width: "9", height: 1e9, view: { a: 1 }, style: { preset: "constructor", url: "javascript:alert(1)", onClick: "link", bg: "x" }, __proto__: { polluted: 1 } };
    evil.layout.rects.push({ id: "ghost", x: 1, y: 1, w: 1, h: 1 }, { id: good.layout.panels[0].id, x: -5, y: 1e12, w: 99, h: -4 }, null, 7);
    const p = sanitizeMyPreset(evil, "fallback")!;
    expect(p).toBeTruthy();
    expect(p.name).not.toMatch(/[<>\u0000]/);
    expect(p.name.length).toBeLessThanOrEqual(40);
    expect(p.desc).toBe("");
    expect(JSON.stringify(p)).not.toMatch(/<|javascript:|polluted/);
    expect(p.layout.panels.every((x) => (x.kind === "metric" || x.kind === "widget") && !x.code && !x.url && !x.text)).toBe(true);
    expect(p.layout.panels.every((x) => x.kind === "widget" || x.metrics.every((m) => /^[A-Za-z0-9_.:@-]+$/.test(m)))).toBe(true);
    for (const r of p.layout.rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(12);
      expect(r.w).toBeGreaterThanOrEqual(1);
      expect(r.h).toBeGreaterThanOrEqual(1);
      expect(p.layout.panels.some((x) => x.id === r.id)).toBe(true);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const junk: unknown[] = [null, 1, "a", [], {}, { layout: 1 }, { layout: { panels: "x", rects: [] } }, { layout: { panels: [], rects: [] } }, { name: "x", layout: { panels: [{ id: "custom-a", kind: "metric", metrics: [] }], rects: [{ id: "custom-a", x: 0, y: 0, w: 3, h: 3 }] } }];
    for (const j of junk) {
      expect(() => sanitizeMyPreset(j, "f")).not.toThrow();
      expect(sanitizeMyPreset(j, "f")).toBeNull();
    }
    expect(parseMyPresets("nope")).toEqual([]);
    expect(parseMyPresets(Array.from({ length: 100 }, () => null))).toEqual([]);
    const oversize = { ...JSON.parse(JSON.stringify(good)) };
    oversize.layout.panels = Array.from({ length: 500 }, (_, i) => ({ id: "custom-p" + i, kind: "metric", metrics: ["cpu"], title: "", code: "", url: "", text: "" }));
    oversize.layout.rects = oversize.layout.panels.map((q: { id: string }, i: number) => ({ id: q.id, x: 0, y: i * 3, w: 12, h: 3 }));
    expect(sanitizeMyPreset(oversize, "o")!.layout.panels.length).toBeLessThanOrEqual(80);
  });

  it("export / import round trip; strict about size, shape and content", () => {
    const { preset } = mk(1);
    let n = 0;
    const id = () => "imp-" + n++;
    const text = exportMyPreset(preset);
    const r = importMyPresets(text, id, undefined, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.presets).toHaveLength(1);
      expect({ ...r.presets[0], id: "" }).toEqual({ ...preset, id: "" });
      expect(r.presets[0].id).toMatch(/^imp-/);
    }
    const list = importMyPresets(JSON.stringify([JSON.parse(text), JSON.parse(text), preset]), id);
    expect(list.ok && list.presets.length).toBe(3);
    expect(new Set(list.ok ? list.presets.map((x) => x.id) : []).size).toBe(3);
    expect(importMyPresets(JSON.stringify([preset, preset, preset]), id, 2)).toMatchObject({ ok: true });
    expect(importMyPresets("x".repeat(IMPORT_MAX_BYTES + 1), id)).toEqual({ ok: false, error: "tooBig" });
    expect(importMyPresets(JSON.stringify({ pad: "é".repeat(IMPORT_MAX_BYTES / 2 + 10) }), id)).toEqual({ ok: false, error: "tooBig" });
    for (const bad of ["", "{", "null", "42", '"str"', "[]", "{}", '{"format":"sharx-dashboard-preset","preset":5}', "[1,2,3]", '{"a":{"__proto__":{"x":1}}}'] as string[]) {
      const res = importMyPresets(bad, id);
      expect(res.ok).toBe(false);
    }
    expect(importMyPresets(null as unknown as string, id).ok).toBe(false);
    const hostile = JSON.stringify({ format: "sharx-dashboard-preset", version: 1, preset: { name: "<script>alert(1)</script>", desc: "javascript:alert(1)", layout: { panels: [{ id: "custom-a", kind: "html", code: "<script>1</script>", metrics: [] }, { id: "custom-b", kind: "metric", metrics: ["cpu"], title: "<b>x</b>" }], rects: [{ id: "custom-a", x: 0, y: 0, w: 4, h: 4 }, { id: "custom-b", x: 0, y: 4, w: 4, h: 4 }] } } });
    const h = importMyPresets(hostile, id);
    expect(h.ok).toBe(true);
    if (h.ok) {
      expect(h.presets[0].layout.panels.map((p) => p.id)).toEqual(["custom-b"]);
      expect(h.presets[0].name).not.toMatch(/[<>]/);
      expect(h.presets[0].layout.panels[0].title).not.toMatch(/[<>]/);
    }
  });

  it("is stored in the workspace JSON together with the board markers and survives a reload", () => {
    const { preset, layout } = mk(1);
    const ws: DashboardWorkspace = {
      version: 2, activeId: "a", telemtDc: true, myPresets: [preset],
      boards: [{ id: "a", name: "A", enabled: [], layout, preset: "infra" }, { id: "b", name: "B", enabled: [], layout, preset: "noc" }, { id: "c", name: "C", enabled: [], layout }],
    };
    const back = parseWorkspace(JSON.stringify(saveActiveBoard(ws, layout)), []);
    expect(back.myPresets).toEqual([preset]);
    expect(back.boards.map((b) => b.preset)).toEqual(["infra", "noc", undefined]);
    const tampered = JSON.parse(JSON.stringify(ws));
    tampered.boards[0].preset = "bogus";
    tampered.myPresets = [{ ...preset, name: "<i>" }, "junk"];
    const t2 = parseWorkspace(JSON.stringify(tampered), []);
    expect(t2.boards[0].preset).toBeUndefined();
    expect(t2.myPresets).toHaveLength(1);
    expect(t2.myPresets![0].name).toBe("i");
    expect(ATOMS.length).toBeGreaterThan(0);
  });
});
