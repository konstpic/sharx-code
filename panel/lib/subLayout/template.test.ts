import { describe, expect, it } from "vitest";
import { evalCondition, formatBytes, formatDate, lintTemplate, renderTemplate, safeUrl, usedPaths } from "./template";

const ctx = {
  user: { username: "alice", isActive: true, userStatus: "ACTIVE", trafficUsedBytes: 3_000_000_000, daysLeft: 5, expiresAt: "2026-12-31T00:00:00Z" },
  devices: { count: 2, max: 3, items: [{ model: "iPhone", os: "iOS" }, { model: "Pixel", os: "Android" }] },
  links: [{ title: "DE" }, { title: "FI" }],
  vars: { bot: "@mybot" },
};

describe("template values and filters", () => {
  it("substitutes paths", () => {
    expect(renderTemplate("Hi {{ user.username }}!", ctx).out).toBe("Hi alice!");
    expect(renderTemplate("{{ devices.items[1].model }}", ctx).out).toBe("Pixel");
    expect(renderTemplate("{{ vars.bot }}", ctx).out).toBe("@mybot");
  });
  it("chains filters with arguments", () => {
    expect(renderTemplate("{{ user.username | upper }}", ctx).out).toBe("ALICE");
    expect(renderTemplate("{{ user.username | upper | truncate(3) }}", ctx).out).toBe("AL…");
    expect(renderTemplate('{{ missing | default("n/a") }}', ctx).out).toBe("n/a");
    expect(renderTemplate("{{ user.trafficUsedBytes | bytes }}", ctx).out).toBe("2.8 GB");
    expect(renderTemplate('{{ user.expiresAt | date("DD.MM.YYYY") }}', ctx).out).toMatch(/^\d\d\.\d\d\.2026$/);
  });
  it("does plurals for ru and en", () => {
    expect(renderTemplate('{{ devices.count | plural("устройство","устройства","устройств") }}', ctx, { lang: "ru" }).out).toBe("устройства");
    expect(renderTemplate('{{ n | plural("устройство","устройства","устройств") }}', { n: 5 }, { lang: "ru" }).out).toBe("устройств");
    expect(renderTemplate('{{ n | plural("устройство","устройства","устройств") }}', { n: 21 }, { lang: "ru" }).out).toBe("устройство");
    expect(renderTemplate('{{ n | plural("device","devices") }}', { n: 1 }, { lang: "en" }).out).toBe("device");
  });
  it("computes with expressions", () => {
    expect(renderTemplate("{{ devices.max - devices.count }}", ctx).out).toBe("1");
    expect(renderTemplate("{{ user.daysLeft > 3 ? 'ok' : 'soon' }}", ctx).out).toBe("ok");
    expect(renderTemplate("{{ percent(user.trafficUsedBytes, 10000000000) }}", ctx).out).toBe("30");
  });
});

describe("blocks", () => {
  it("if / else if / else", () => {
    const t = "{{#if user.userStatus == 'LIMITED'}}L{{else if user.isActive}}A{{else}}X{{/if}}";
    expect(renderTemplate(t, ctx).out).toBe("A");
    expect(renderTemplate(t, { ...ctx, user: { ...ctx.user, userStatus: "LIMITED" } }).out).toBe("L");
    expect(renderTemplate(t, { user: { isActive: false } }).out).toBe("X");
  });
  it("each with item and index", () => {
    expect(renderTemplate("{{#each devices.items as d}}{{ number }}.{{ d.model }};{{/each}}", ctx).out).toBe("1.iPhone;2.Pixel;");
    expect(renderTemplate("{{#each links as l}}{{ l.title }}{{/each}}", ctx).out).toBe("DEFI");
  });
});

describe("safety", () => {
  it("escapes html when asked and never reaches prototypes", () => {
    expect(renderTemplate("<b>{{ x }}</b>", { x: "<script>alert(1)</script>" }, { escape: "html" }).out).toBe("<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>");
    expect(renderTemplate("{{ user.constructor }}", ctx).out).toBe("");
    expect(renderTemplate("{{ __proto__ }}", ctx).out).toBe("");
    expect(renderTemplate("{{ user.username.constructor.name }}", ctx).out).toBe("");
  });
  it("reports errors instead of throwing", () => {
    const r = renderTemplate("a {{ user.username | nope }} b", ctx);
    expect(r.errors.length).toBe(1);
    expect(renderTemplate("{{#if x}}", ctx).errors.length).toBe(1);
    expect(lintTemplate("{{ a + }}").length).toBe(1);
    expect(lintTemplate("plain")).toEqual([]);
  });
  it("blocks dangerous url schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl(" JavaScript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,x")).toBe("");
    expect(safeUrl("https://a.b/c")).toBe("https://a.b/c");
    expect(safeUrl("happ://add/x")).toBe("happ://add/x");
  });
});

describe("conditions and helpers", () => {
  it("evaluates visibility expressions", () => {
    expect(evalCondition("user.isActive && devices.count < devices.max", ctx).value).toBe(true);
    expect(evalCondition("!user.isActive", ctx).value).toBe(false);
    expect(evalCondition("", ctx).value).toBe(true);
    expect(evalCondition("{{ user.daysLeft <= 3 }}", ctx).value).toBe(false);
    expect(evalCondition("a +", ctx).value).toBe(true); // a broken condition never hides content
    expect(evalCondition("a +", ctx).error).toBeTruthy();
    expect(evalCondition("links", ctx).value).toBe(true);
    expect(evalCondition("missing", ctx).value).toBe(false);
  });
  it("formats bytes and dates", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDate("9999-12-31T23:59:59Z")).toBe("∞");
    expect(formatDate(1790000000, "YYYY")).toMatch(/^20\d\d$/);
  });
  it("lists used paths", () => {
    expect(usedPaths("{{ user.username }} {{#if devices.count}}x{{/if}}").sort()).toEqual(["devices.count", "user.username"]);
  });
});
