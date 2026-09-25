import { defaultV2 } from "../sharxSubpageConfig";
import { collect, collecting, tx } from "./i18nCollect";
import { layoutFromConfig } from "./migrate";
import { nid, newNode, type Subtree } from "./tree";
import type { LNode, LayoutDoc, NodeType } from "./types";

// ------------------------------------------------------------------------------------
// A tiny DSL: [type, patch, children?] → flat document
// ------------------------------------------------------------------------------------

type Patch = Partial<Pick<LNode, "name" | "style" | "props" | "mobile" | "visibleIf" | "hideOn">>;
export type Spec = [NodeType, Patch, Spec[]?];

export function docFromSpec(spec: Spec, vars: Record<string, string> = {}): LayoutDoc {
  const nodes: Record<string, LNode> = {};
  const build = (s: Spec): string => {
    const [type, patch, kids] = s;
    const id = nid();
    const node = newNode(type, { id, ...patch });
    nodes[id] = node;
    if (kids) node.children = kids.map(build);
    return id;
  };
  const root = build(spec);
  return { version: 1, enabled: true, root, nodes, vars };
}

const T = (text: string, style: LNode["style"] = {}, extra: Patch = {}): Spec => ["text", { name: text.slice(0, 24), props: { text, tag: "p" }, style, ...extra }];
const CARD_STYLE: LNode["style"] = {
  mode: "stack",
  dir: "column",
  gap: 12,
  pad: 20,
  w: "fill",
  bg: "var(--sub-surface, rgba(255,255,255,.04))",
  border: { w: 1, color: "var(--sub-border, rgba(255,255,255,.1))" },
  radius: 20,
  shadow: "0 18px 40px -24px rgba(0,0,0,.5)",
  blur: 16,
};

type Dict = Record<string, string>;

const TEXTS: Record<"en" | "ru", Dict> = {
  en: {
    expires: "Expires",
    traffic: "Traffic",
    devices: "Devices",
    addToApp: "Add to app",
    links: "Your links",
    copy: "Copy",
    noDevices: "No devices yet",
    copyLink: "Copy subscription link",
    scan: "Scan the QR code in your VPN app",
    left: "left",
    status: "Status",
    online: "Online",
    until: "Until",
    support: "Need help? Write to support",
    seen: "seen",
    stats: "Your subscription",
  },
  ru: {
    expires: "Действует до",
    traffic: "Трафик",
    devices: "Устройства",
    addToApp: "Добавить в приложение",
    links: "Ваши ссылки",
    copy: "Копировать",
    noDevices: "Устройств пока нет",
    copyLink: "Скопировать ссылку подписки",
    scan: "Отсканируйте QR-код в VPN-приложении",
    left: "осталось",
    status: "Статус",
    online: "Онлайн",
    until: "До",
    support: "Нужна помощь? Напишите в поддержку",
    seen: "был",
    stats: "Ваша подписка",
  },
};

const STATUS_BADGES = (): Spec[] => [
  ["badge", { name: "Status active", props: { text: "{{ user.userStatus }}", tone: "success" }, visibleIf: "user.isActive" }],
  ["badge", { name: "Status inactive", props: { text: "{{ user.userStatus }}", tone: "danger" }, visibleIf: "!user.isActive" }],
];

/** "Profile": a hero card, devices, apps and links as stacked cards. */
function profile(t: Dict): Spec {
  return [
    "frame",
    { name: "Page", style: { mode: "stack", dir: "column", gap: 0, pad: 0, w: "fill" } },
    [
      ["header", { name: "Header" }],
      [
        "frame",
        { name: "Content", style: { mode: "stack", dir: "column", gap: 16, pad: [24, 16, 48, 16], w: "fill", maxW: 720, self: "center" } },
        [
          [
            "frame",
            { name: "Hero card", style: { ...CARD_STYLE } },
            [
              [
                "frame",
                { name: "Title row", style: { mode: "stack", dir: "row", gap: 12, pad: 0, w: "fill", align: "center", justify: "between" } },
                [T("{{ user.username }}", { fs: 22, fw: 700, truncate: true }), ...STATUS_BADGES()],
              ],
              T(`${t.expires}: {{ user.expiresAt | date("DD.MM.YYYY") }}`, { fs: 14, color: "var(--sub-fg-muted, #8b949e)" }),
              ["progress", { name: "Traffic" }],
              T(`${t.left}: {{ user.remaining }}`, { fs: 12, color: "var(--sub-fg-muted, #8b949e)" }, { visibleIf: "!user.unlimited" }),
            ],
          ],
          [
            "frame",
            { name: "Devices card", style: { ...CARD_STYLE }, visibleIf: "devices.enabled" },
            [
              T(`${t.devices} · {{ devices.count }} / {{#if devices.unlimited}}∞{{else}}{{ devices.max }}{{/if}}`, { fs: 16, fw: 600 }),
              [
                "repeat",
                { name: "Devices", props: { source: "devices", limit: 0, emptyText: t.noDevices }, style: { mode: "stack", dir: "column", gap: 8, w: "fill" } },
                [
                  [
                    "frame",
                    { name: "Device", style: { mode: "stack", dir: "row", gap: 10, pad: [10, 12, 10, 12], w: "fill", align: "center", bg: "rgba(255,255,255,.04)", radius: 10 } },
                    [
                      ["icon", { name: "Icon", props: { name: "smartphone", size: 20 } }],
                      T("{{ item.name }}", { fs: 14, grow: 1, truncate: true }),
                      T(`${t.seen} {{ item.lastSeenAt | ago }}`, { fs: 12, color: "var(--sub-fg-muted, #8b949e)" }),
                    ],
                  ],
                ],
              ],
            ],
          ],
          [
            "frame",
            { name: "Apps card", style: { ...CARD_STYLE } },
            [
              T(t.addToApp, { fs: 16, fw: 600 }),
              [
                "repeat",
                { name: "Apps", props: { source: "apps", limit: 8 }, style: { mode: "grid", colMin: 150, gap: 8, w: "fill" } },
                [["button", { name: "App button", props: { label: "{{ item.label }}", action: "link", value: "{{ item.url }}", variant: "outline" }, style: { w: "fill", radius: 10, pad: [10, 12, 10, 12], fw: 600 } }]],
              ],
            ],
          ],
          [
            "frame",
            { name: "Links card", style: { ...CARD_STYLE } },
            [
              T(t.links, { fs: 16, fw: 600 }),
              [
                "repeat",
                { name: "Links", props: { source: "links", limit: 0 }, style: { mode: "stack", dir: "column", gap: 8, w: "fill" } },
                [
                  [
                    "frame",
                    { name: "Link", style: { mode: "stack", dir: "row", gap: 8, pad: 0, w: "fill", align: "center" } },
                    [
                      T("{{ item.title }}", { fs: 14, grow: 1, truncate: true }),
                      ["button", { name: "Copy", props: { label: t.copy, action: "copy", value: "{{ item.url }}", variant: "ghost" }, style: { radius: 8, pad: [6, 10, 6, 10], fs: 13 } }],
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
      ],
    ],
  ];
}

/** "Minimal": logo, one QR code and one button, centered. */
function minimal(t: Dict): Spec {
  return [
    "frame",
    { name: "Page", style: { mode: "stack", dir: "column", gap: 0, pad: [48, 16, 48, 16], w: "fill", align: "center" } },
    [
      [
        "frame",
        { name: "Card", style: { ...CARD_STYLE, w: "fill", maxW: 420, align: "center", pad: 28, gap: 16 } },
        [
          ["image", { name: "Logo", props: { src: "{{ branding.logoUrl }}", alt: "", fit: "contain" }, style: { w: 64, h: 64, radius: 14 }, visibleIf: "branding.logoUrl" }],
          T("{{ branding.title | default('Subscription') }}", { fs: 22, fw: 700, ta: "center" }),
          T("{{ user.username }}", { fs: 14, ta: "center", color: "var(--sub-fg-muted, #8b949e)" }),
          ["qr", { name: "QR", props: { value: "{{ subscription.url }}", size: 200 } }],
          T(t.scan, { fs: 13, ta: "center", color: "var(--sub-fg-muted, #8b949e)" }),
          ["button", { name: "Copy link", props: { label: t.copyLink, action: "copy", value: "{{ subscription.url }}", variant: "solid" }, style: { w: "fill", radius: 12, pad: [12, 16, 12, 16], fw: 600 } }],
        ],
      ],
    ],
  ];
}

/** "Dashboard": stat tiles in a grid, then devices and apps. */
function dashboard(t: Dict): Spec {
  const tile = (label: string, value: string, extra: Patch = {}): Spec => [
    "frame",
    { name: label, style: { ...CARD_STYLE, gap: 4, pad: 16, w: "fill" }, ...extra },
    [T(label, { fs: 12, upper: true, ls: 0.6, color: "var(--sub-fg-muted, #8b949e)" }), T(value, { fs: 22, fw: 700 })],
  ];
  return [
    "frame",
    { name: "Page", style: { mode: "stack", dir: "column", gap: 0, pad: 0, w: "fill" } },
    [
      ["header", { name: "Header" }],
      [
        "frame",
        { name: "Content", style: { mode: "stack", dir: "column", gap: 20, pad: [28, 24, 56, 24], w: "fill", maxW: 1100, self: "center" }, mobile: { pad: [20, 14, 40, 14] } },
        [
          T(`${t.stats}: {{ user.username }}`, { fs: 26, fw: 700 }),
          [
            "frame",
            { name: "Stats", style: { mode: "grid", colMin: 200, gap: 12, pad: 0, w: "fill" } },
            [
              tile(t.status, "{{ user.userStatus }}"),
              tile(t.traffic, "{{ user.trafficUsed }} / {{ user.trafficLimit }}"),
              tile(t.until, '{{ user.expiresAt | date("DD.MM.YYYY") }}'),
              tile(t.devices, "{{ devices.count }} / {{#if devices.unlimited}}∞{{else}}{{ devices.max }}{{/if}}", { visibleIf: "devices.enabled" }),
            ],
          ],
          ["progress", { name: "Traffic bar" }],
          [
            "frame",
            { name: "Columns", style: { mode: "stack", dir: "row", wrap: true, gap: 16, pad: 0, w: "fill", align: "start" } },
            [
              [
                "frame",
                { name: "Devices", style: { ...CARD_STYLE, minW: 280, grow: 1 }, visibleIf: "devices.enabled" },
                [
                  T(t.devices, { fs: 16, fw: 600 }),
                  [
                    "repeat",
                    { name: "Devices list", props: { source: "devices", emptyText: t.noDevices }, style: { mode: "stack", dir: "column", gap: 6, w: "fill" } },
                    [T("{{ item.number }}. {{ item.name }} — {{ item.lastSeenAt | ago }}", { fs: 14 })],
                  ],
                ],
              ],
              [
                "frame",
                { name: "Apps", style: { ...CARD_STYLE, minW: 280, grow: 1 } },
                [
                  T(t.addToApp, { fs: 16, fw: 600 }),
                  [
                    "repeat",
                    { name: "Apps list", props: { source: "apps", limit: 6 }, style: { mode: "grid", colMin: 130, gap: 8, w: "fill" } },
                    [["button", { name: "App", props: { label: "{{ item.label }}", action: "link", value: "{{ item.url }}", variant: "outline" }, style: { w: "fill", radius: 10, pad: [9, 10, 9, 10], fs: 13, fw: 600 } }]],
                  ],
                ],
              ],
            ],
          ],
          ["block", { name: "Links", props: { kind: "links-list", block: { id: nid(), kind: "links-list", enabled: true, showQr: true, showCopy: true } } }],
        ],
      ],
    ],
  ];
}


/** The texts of a language, or `{{ tr.key }}` references (both languages recorded) while collecting. */
function texts(lang: string): Dict {
  if (!collecting()) return TEXTS[lang === "ru" ? "ru" : "en"];
  return Object.fromEntries(Object.keys(TEXTS.en).map((k) => [k, tx("en", TEXTS.en[k], TEXTS.ru[k] ?? TEXTS.en[k])]));
}

export type PresetId = "classic" | "profile" | "minimal" | "dashboard";

export const PRESET_IDS: PresetId[] = ["classic", "profile", "minimal", "dashboard"];

export function presetDoc(id: PresetId, lang = "en"): LayoutDoc {
  const t = texts(lang);
  switch (id) {
    case "profile":
      return docFromSpec(profile(t));
    case "minimal":
      return docFromSpec(minimal(t));
    case "dashboard":
      return docFromSpec(dashboard(t));
    default:
      return layoutFromConfig(defaultV2());
  }
}


// ------------------------------------------------------------------------------------
// Ready-made fragments for the Add tab
// ------------------------------------------------------------------------------------

export type SnippetId = "card" | "stat" | "devices" | "apps" | "links" | "hero" | "support" | "row";
export const SNIPPET_IDS: SnippetId[] = ["card", "stat", "hero", "devices", "apps", "links", "support", "row"];

export function subtreeFromSpec(spec: Spec): Subtree {
  const d = docFromSpec(spec);
  return { root: d.root, nodes: d.nodes };
}

export function snippet(id: SnippetId, lang = "en"): Subtree {
  const t = texts(lang);
  switch (id) {
    case "stat":
      return subtreeFromSpec([
        "frame",
        { name: "Stat", style: { ...CARD_STYLE, gap: 4, pad: 16, w: "fill" } },
        [T(t.traffic, { fs: 12, upper: true, ls: 0.6, color: "var(--sub-fg-muted, #8b949e)" }), T("{{ user.trafficUsed }} / {{ user.trafficLimit }}", { fs: 22, fw: 700 })],
      ]);
    case "hero":
      return subtreeFromSpec([
        "frame",
        { name: "Hero", style: { ...CARD_STYLE, pad: 28, gap: 8, align: "center" } },
        [
          T("{{ user.username }}", { fs: 28, fw: 700, ta: "center" }),
          ...STATUS_BADGES(),
          T(`${t.expires}: {{ user.expiresAt | date("DD.MM.YYYY") }}`, { fs: 14, ta: "center", color: "var(--sub-fg-muted, #8b949e)" }),
        ],
      ]);
    case "devices":
      return subtreeFromSpec([
        "frame",
        { name: "Devices card", style: { ...CARD_STYLE }, visibleIf: "devices.enabled" },
        [
          T(`${t.devices} · {{ devices.count }} / {{#if devices.unlimited}}∞{{else}}{{ devices.max }}{{/if}}`, { fs: 16, fw: 600 }),
          [
            "repeat",
            { name: "Devices", props: { source: "devices", emptyText: t.noDevices }, style: { mode: "stack", dir: "column", gap: 8, w: "fill" } },
            [
              [
                "frame",
                { name: "Device", style: { mode: "stack", dir: "row", gap: 10, pad: [10, 12, 10, 12], w: "fill", align: "center", bg: "rgba(255,255,255,.04)", radius: 10 } },
                [["icon", { name: "Icon", props: { name: "smartphone", size: 20 } }], T("{{ item.name }}", { fs: 14, grow: 1, truncate: true }), T(`${t.seen} {{ item.lastSeenAt | ago }}`, { fs: 12, color: "var(--sub-fg-muted, #8b949e)" })],
              ],
            ],
          ],
        ],
      ]);
    case "apps":
      return subtreeFromSpec([
        "frame",
        { name: "Apps card", style: { ...CARD_STYLE } },
        [
          T(t.addToApp, { fs: 16, fw: 600 }),
          ["repeat", { name: "Apps", props: { source: "apps", limit: 8 }, style: { mode: "grid", colMin: 150, gap: 8, w: "fill" } }, [["button", { name: "App button", props: { label: "{{ item.label }}", action: "link", value: "{{ item.url }}", variant: "outline" }, style: { w: "fill", radius: 10, pad: [10, 12, 10, 12], fw: 600 } }]]],
        ],
      ]);
    case "links":
      return subtreeFromSpec([
        "frame",
        { name: "Links card", style: { ...CARD_STYLE } },
        [
          T(t.links, { fs: 16, fw: 600 }),
          [
            "repeat",
            { name: "Links", props: { source: "links" }, style: { mode: "stack", dir: "column", gap: 8, w: "fill" } },
            [["frame", { name: "Link", style: { mode: "stack", dir: "row", gap: 8, pad: 0, w: "fill", align: "center" } }, [T("{{ item.title }}", { fs: 14, grow: 1, truncate: true }), ["button", { name: "Copy", props: { label: t.copy, action: "copy", value: "{{ item.url }}", variant: "ghost" }, style: { radius: 8, pad: [6, 10, 6, 10], fs: 13 } }]]]],
          ],
        ],
      ]);
    case "support":
      return subtreeFromSpec(["button", { name: "Support", props: { label: t.support, action: "link", value: "{{ branding.supportUrl }}", variant: "outline", newTab: true }, style: { w: "fill", radius: 12, pad: [12, 16, 12, 16] }, visibleIf: "branding.supportUrl" }]);
    case "row":
      return subtreeFromSpec(["frame", { name: "Row", style: { mode: "stack", dir: "row", gap: 12, pad: 0, w: "fill", align: "center" }, mobile: { dir: "column" } }, []]);
    default:
      return subtreeFromSpec(["frame", { name: "Card", style: { ...CARD_STYLE } }, [T("Title", { fs: 16, fw: 600 }), T("Text with {{ user.username }}", { fs: 14, color: "var(--sub-fg-muted, #8b949e)" })]]);
  }
}

/** A preset whose texts follow the page language (dictionary stored in the document). */
export function presetDocI18n(id: PresetId): LayoutDoc {
  const { result, i18n } = collect(() => presetDoc(id, "en"));
  return { ...result, i18n };
}

/** A ready-made fragment whose texts follow the page language. */
export function snippetI18n(id: SnippetId): Subtree {
  const { result, i18n } = collect(() => snippet(id, "en"));
  return { ...result, i18n };
}
