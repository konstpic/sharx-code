import {
  Activity,
  Bell,
  Building2,
  Cpu,
  Globe,
  KeyRound,
  Layers,
  LayoutDashboard,
  Link2,
  Palette,
  Package,
  Scale,
  Server,
  Smartphone,
  User,
  type LucideIcon,
} from "lucide-react";

export type Tone = "accent" | "green" | "amber" | "rose" | "blue";

export type SceneActor = { id: string; labelKey: string; icon: LucideIcon; x: number; y: number; tone?: Tone; subKey?: string };
export type SceneFlow = { from: string; to: string; tone?: Tone };
export type SceneStep = {
  captionKey: string;
  /** Actors visible during this step. */
  show: string[];
  /** Actors highlighted. */
  focus?: string[];
  /** Actors shown as failed (dimmed, crossed out). */
  down?: string[];
  /** Animated packets travelling between actors. */
  flows?: SceneFlow[];
};
export type Scene = {
  id: string;
  titleKey: string;
  actors: SceneActor[];
  /** Static lines drawn while both ends are visible. */
  links: [string, string][];
  steps: SceneStep[];
};

const K = (scene: string, k: string) => `pages.help.scenes.${scene}.${k}`;
const C = (k: string) => `pages.help.scenes.common.${k}`;

const a = (id: string, icon: LucideIcon, x: number, y: number, tone?: Tone, subKey?: string): SceneActor => ({
  id,
  labelKey: C(id),
  icon,
  x,
  y,
  tone,
  subKey,
});

const welcome: Scene = {
  id: "welcome",
  titleKey: K("welcome", "title"),
  actors: [
    a("client", Smartphone, 10, 50, "blue"),
    a("bundle", Package, 34, 20, "accent"),
    a("host", Link2, 34, 80, "amber"),
    a("balancer", Scale, 58, 50, "green"),
    a("nodeA", Server, 86, 24, "accent"),
    a("nodeB", Server, 86, 76, "accent"),
  ],
  links: [
    ["balancer", "nodeA"],
    ["balancer", "nodeB"],
    ["client", "balancer"],
    ["host", "bundle"],
    ["bundle", "client"],
    ["host", "balancer"],
  ],
  steps: [
    { captionKey: K("welcome", "cap1"), show: ["nodeA", "nodeB"], focus: ["nodeA", "nodeB"] },
    { captionKey: K("welcome", "cap2"), show: ["nodeA", "nodeB", "balancer"], focus: ["balancer"], flows: [{ from: "balancer", to: "nodeA", tone: "green" }, { from: "balancer", to: "nodeB", tone: "green" }] },
    { captionKey: K("welcome", "cap3"), show: ["nodeA", "nodeB", "balancer", "host"], focus: ["host"], flows: [{ from: "host", to: "balancer", tone: "amber" }] },
    { captionKey: K("welcome", "cap4"), show: ["nodeA", "nodeB", "balancer", "host", "bundle"], focus: ["bundle"], flows: [{ from: "host", to: "bundle", tone: "amber" }] },
    { captionKey: K("welcome", "cap5"), show: ["nodeA", "nodeB", "balancer", "host", "bundle", "client"], focus: ["client"], flows: [{ from: "bundle", to: "client", tone: "accent" }] },
    { captionKey: K("welcome", "cap6"), show: ["nodeA", "nodeB", "balancer", "host", "bundle", "client"], focus: ["balancer"], flows: [{ from: "client", to: "balancer", tone: "blue" }, { from: "balancer", to: "nodeA", tone: "blue" }, { from: "balancer", to: "nodeB", tone: "blue" }] },
    { captionKey: K("welcome", "cap7"), show: ["nodeA", "nodeB", "balancer", "host", "bundle", "client"], down: ["nodeB"], focus: ["nodeA"], flows: [{ from: "client", to: "balancer", tone: "blue" }, { from: "balancer", to: "nodeA", tone: "blue" }] },
  ],
};

const inbounds: Scene = {
  id: "inbounds",
  titleKey: K("inbounds", "title"),
  actors: [
    a("panel", LayoutDashboard, 12, 50, "accent"),
    { ...a("inbound", Layers, 38, 50, "amber"), subKey: C("vless") },
    a("nodeA", Server, 68, 26, "accent"),
    a("nodeB", Server, 68, 74, "accent"),
    a("client", Smartphone, 92, 50, "blue"),
  ],
  links: [
    ["panel", "inbound"],
    ["inbound", "nodeA"],
    ["inbound", "nodeB"],
    ["nodeA", "client"],
  ],
  steps: [
    { captionKey: K("inbounds", "cap1"), show: ["panel", "inbound"], focus: ["inbound"] },
    { captionKey: K("inbounds", "cap2"), show: ["panel", "inbound", "nodeA", "nodeB"], focus: ["nodeA", "nodeB"], flows: [{ from: "inbound", to: "nodeA", tone: "amber" }, { from: "inbound", to: "nodeB", tone: "amber" }] },
    { captionKey: K("inbounds", "cap3"), show: ["panel", "inbound", "nodeA", "nodeB"], focus: ["panel"], flows: [{ from: "panel", to: "inbound", tone: "green" }] },
    { captionKey: K("inbounds", "cap4"), show: ["panel", "inbound", "nodeA", "nodeB", "client"], focus: ["client"], flows: [{ from: "client", to: "nodeA", tone: "blue" }] },
  ],
};

const nodes: Scene = {
  id: "nodes",
  titleKey: K("nodes", "title"),
  actors: [
    a("panel", LayoutDashboard, 12, 50, "accent"),
    a("nodeA", Server, 50, 26, "accent"),
    a("nodeB", Server, 50, 74, "accent"),
    a("xray", Cpu, 86, 26, "green"),
    a("alert", Bell, 86, 74, "rose"),
  ],
  links: [
    ["panel", "nodeA"],
    ["panel", "nodeB"],
    ["nodeA", "xray"],
    ["nodeB", "alert"],
  ],
  steps: [
    { captionKey: K("nodes", "cap1"), show: ["nodeA"], focus: ["nodeA"] },
    { captionKey: K("nodes", "cap2"), show: ["panel", "nodeA"], focus: ["panel"], flows: [{ from: "panel", to: "nodeA", tone: "accent" }] },
    { captionKey: K("nodes", "cap3"), show: ["panel", "nodeA", "xray"], focus: ["xray"], flows: [{ from: "nodeA", to: "xray", tone: "green" }] },
    { captionKey: K("nodes", "cap4"), show: ["panel", "nodeA", "xray", "nodeB"], focus: ["panel"], flows: [{ from: "nodeA", to: "panel", tone: "green" }, { from: "nodeB", to: "panel", tone: "green" }] },
    { captionKey: K("nodes", "cap5"), show: ["panel", "nodeA", "xray", "nodeB", "alert"], down: ["nodeB"], focus: ["alert"], flows: [{ from: "panel", to: "alert", tone: "rose" }] },
  ],
};

const balancers: Scene = {
  id: "balancers",
  titleKey: K("balancers", "title"),
  actors: [
    a("client", Smartphone, 10, 50, "blue"),
    a("balancer", Scale, 42, 50, "green"),
    a("nodeA", Server, 82, 22, "accent"),
    a("nodeB", Server, 82, 50, "accent"),
    a("nodeC", Server, 82, 78, "accent"),
    a("chart", Activity, 42, 14, "amber"),
  ],
  links: [
    ["client", "balancer"],
    ["balancer", "nodeA"],
    ["balancer", "nodeB"],
    ["balancer", "nodeC"],
    ["balancer", "chart"],
  ],
  steps: [
    { captionKey: K("balancers", "cap1"), show: ["client", "balancer"], focus: ["balancer"], flows: [{ from: "client", to: "balancer", tone: "blue" }] },
    { captionKey: K("balancers", "cap2"), show: ["client", "balancer", "nodeA", "nodeB", "nodeC"], focus: ["nodeA", "nodeB", "nodeC"], flows: [{ from: "balancer", to: "nodeA", tone: "green" }, { from: "balancer", to: "nodeB", tone: "green" }, { from: "balancer", to: "nodeC", tone: "green" }] },
    { captionKey: K("balancers", "cap3"), show: ["client", "balancer", "nodeA", "nodeB", "nodeC"], down: ["nodeB"], focus: ["nodeA", "nodeC"], flows: [{ from: "balancer", to: "nodeA", tone: "green" }, { from: "balancer", to: "nodeC", tone: "green" }] },
    { captionKey: K("balancers", "cap4"), show: ["client", "balancer", "nodeA", "nodeB", "nodeC", "chart"], down: ["nodeB"], focus: ["chart"], flows: [{ from: "balancer", to: "chart", tone: "amber" }] },
    { captionKey: K("balancers", "cap5"), show: ["client", "balancer", "nodeA", "nodeB", "nodeC", "chart"], focus: ["balancer", "nodeA"], flows: [{ from: "client", to: "balancer", tone: "blue" }, { from: "client", to: "nodeA", tone: "accent" }] },
  ],
};

const bundles: Scene = {
  id: "bundles",
  titleKey: K("bundles", "title"),
  actors: [
    a("hostA", Link2, 12, 20, "amber"),
    a("hostB", Link2, 12, 50, "amber"),
    a("hostC", Link2, 12, 80, "amber"),
    a("bundle", Package, 48, 50, "accent"),
    a("clientA", User, 86, 28, "blue"),
    a("clientB", User, 86, 72, "blue"),
  ],
  links: [
    ["hostA", "bundle"],
    ["hostB", "bundle"],
    ["hostC", "bundle"],
    ["bundle", "clientA"],
    ["bundle", "clientB"],
  ],
  steps: [
    { captionKey: K("bundles", "cap1"), show: ["hostA", "hostB", "hostC"], focus: ["hostA", "hostB", "hostC"] },
    { captionKey: K("bundles", "cap2"), show: ["hostA", "hostB", "hostC", "bundle"], focus: ["bundle"], flows: [{ from: "hostA", to: "bundle", tone: "amber" }, { from: "hostB", to: "bundle", tone: "amber" }, { from: "hostC", to: "bundle", tone: "amber" }] },
    { captionKey: K("bundles", "cap3"), show: ["hostA", "hostB", "hostC", "bundle", "clientA", "clientB"], focus: ["clientA", "clientB"], flows: [{ from: "bundle", to: "clientA", tone: "accent" }, { from: "bundle", to: "clientB", tone: "accent" }] },
    { captionKey: K("bundles", "cap4"), show: ["hostA", "hostB", "hostC", "bundle", "clientA", "clientB"], down: ["hostC"], focus: ["hostC"], flows: [{ from: "bundle", to: "clientA", tone: "accent" }] },
    { captionKey: K("bundles", "cap5"), show: ["hostA", "hostB", "hostC", "bundle", "clientA"], down: ["hostC"], focus: ["clientA"], flows: [{ from: "bundle", to: "clientA", tone: "accent" }] },
  ],
};

const hosts: Scene = {
  id: "hosts",
  titleKey: K("hosts", "title"),
  actors: [
    { ...a("inbound", Layers, 12, 50, "amber"), subKey: C("vless") },
    { ...a("nodeA", Server, 48, 20, "accent"), labelKey: C("host"), subKey: C("node") },
    { ...a("balancer", Scale, 48, 50, "green"), labelKey: C("host"), subKey: C("balancer") },
    { ...a("domain", Globe, 48, 80, "blue"), labelKey: C("host") },
    a("subscription", Link2, 86, 50, "accent"),
  ],
  links: [
    ["inbound", "nodeA"],
    ["inbound", "balancer"],
    ["inbound", "domain"],
    ["nodeA", "subscription"],
    ["balancer", "subscription"],
    ["domain", "subscription"],
  ],
  steps: [
    { captionKey: K("hosts", "cap1"), show: ["inbound"], focus: ["inbound"] },
    { captionKey: K("hosts", "cap2"), show: ["inbound", "nodeA", "balancer", "domain"], focus: ["nodeA", "balancer", "domain"], flows: [{ from: "inbound", to: "nodeA", tone: "amber" }, { from: "inbound", to: "balancer", tone: "amber" }, { from: "inbound", to: "domain", tone: "amber" }] },
    { captionKey: K("hosts", "cap3"), show: ["inbound", "nodeA", "balancer", "domain", "subscription"], focus: ["subscription"], flows: [{ from: "nodeA", to: "subscription", tone: "accent" }, { from: "balancer", to: "subscription", tone: "accent" }, { from: "domain", to: "subscription", tone: "accent" }] },
    { captionKey: K("hosts", "cap4"), show: ["inbound", "nodeA", "balancer", "domain", "subscription"], down: ["domain"], focus: ["subscription"], flows: [{ from: "nodeA", to: "subscription", tone: "accent" }, { from: "balancer", to: "subscription", tone: "accent" }] },
  ],
};

const clients: Scene = {
  id: "clients",
  titleKey: K("clients", "title"),
  actors: [
    a("client", User, 10, 50, "blue"),
    a("limits", KeyRound, 10, 16, "amber"),
    a("bundle", Package, 38, 50, "accent"),
    { ...a("subscription", Link2, 62, 50, "green"), subKey: C("link") },
    a("app", Smartphone, 90, 50, "blue"),
  ],
  links: [
    ["client", "bundle"],
    ["bundle", "subscription"],
    ["subscription", "app"],
    ["client", "limits"],
  ],
  steps: [
    { captionKey: K("clients", "cap1"), show: ["client", "limits"], focus: ["limits"] },
    { captionKey: K("clients", "cap2"), show: ["client", "limits", "bundle"], focus: ["bundle"], flows: [{ from: "client", to: "bundle", tone: "accent" }] },
    { captionKey: K("clients", "cap3"), show: ["client", "limits", "bundle", "subscription"], focus: ["subscription"], flows: [{ from: "bundle", to: "subscription", tone: "green" }] },
    { captionKey: K("clients", "cap4"), show: ["client", "limits", "bundle", "subscription", "app"], focus: ["app"], flows: [{ from: "subscription", to: "app", tone: "blue" }] },
    { captionKey: K("clients", "cap5"), show: ["client", "limits", "bundle", "subscription", "app"], down: ["client", "app"], focus: ["limits"] },
  ],
};

const groups: Scene = {
  id: "groups",
  titleKey: K("groups", "title"),
  actors: [
    a("group", Building2, 14, 50, "amber"),
    a("clientA", User, 50, 20, "blue"),
    a("clientB", User, 50, 50, "blue"),
    a("clientC", User, 50, 80, "blue"),
    a("bundle", Package, 86, 50, "accent"),
  ],
  links: [
    ["group", "clientA"],
    ["group", "clientB"],
    ["group", "clientC"],
    ["clientA", "bundle"],
    ["clientB", "bundle"],
    ["clientC", "bundle"],
  ],
  steps: [
    { captionKey: K("groups", "cap1"), show: ["group", "clientA", "clientB", "clientC"], focus: ["group"] },
    { captionKey: K("groups", "cap2"), show: ["group", "clientA", "clientB", "clientC", "bundle"], focus: ["bundle"], flows: [{ from: "group", to: "bundle", tone: "accent" }] },
    { captionKey: K("groups", "cap3"), show: ["group", "clientA", "clientB", "clientC", "bundle"], focus: ["clientA", "clientB", "clientC"], flows: [{ from: "bundle", to: "clientA", tone: "green" }, { from: "bundle", to: "clientB", tone: "green" }, { from: "bundle", to: "clientC", tone: "green" }] },
  ],
};


const SP = (id: string) => K("subpage", id);
const subpage: Scene = {
  id: "subpage",
  titleKey: K("subpage", "title"),
  actors: [
    { ...a("designer", LayoutDashboard, 12, 30, "accent"), labelKey: SP("designer") },
    { ...a("vars", KeyRound, 12, 74, "amber"), labelKey: SP("vars") },
    a("client", User, 40, 52, "blue"),
    { ...a("page", Globe, 66, 52, "green"), labelKey: SP("page") },
    a("app", Smartphone, 90, 52, "blue"),
  ],
  links: [
    ["designer", "page"],
    ["vars", "page"],
    ["client", "vars"],
    ["page", "app"],
  ],
  steps: [
    { captionKey: K("subpage", "cap1"), show: ["designer"], focus: ["designer"] },
    { captionKey: K("subpage", "cap2"), show: ["designer", "vars"], focus: ["vars"], flows: [{ from: "vars", to: "designer", tone: "amber" }] },
    { captionKey: K("subpage", "cap3"), show: ["designer", "vars", "client"], focus: ["client"], flows: [{ from: "client", to: "vars", tone: "blue" }] },
    { captionKey: K("subpage", "cap4"), show: ["designer", "vars", "client", "page"], focus: ["page"], flows: [{ from: "designer", to: "page", tone: "green" }, { from: "vars", to: "page", tone: "green" }] },
    { captionKey: K("subpage", "cap5"), show: ["designer", "vars", "client", "page", "app"], focus: ["app"], flows: [{ from: "page", to: "app", tone: "accent" }] },
  ],
};

export const SCENES: Record<string, Scene> = { subpage, welcome, inbounds, nodes, balancers, bundles, hosts, clients, groups };
