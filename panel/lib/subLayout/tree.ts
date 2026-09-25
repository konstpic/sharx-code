import { defaultAppsProps } from "./apps";
import { mergeDict } from "./i18nCollect";
import { normalizeMotion } from "./motion";
import { normalizeParams, normalizeValues } from "./params";
import { defaultSceneProps } from "./scene";
import { NODE_TYPES, type LNode, type LayoutDoc, type NodeType, type OnClick, type StateRule, type Style } from "./types";

// ------------------------------------------------------------------------------------
// Ids and node factory
// ------------------------------------------------------------------------------------

export function nid(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `n${rnd}${Date.now().toString(36).slice(-3)}`;
}

/** Types that can hold children. Leaves (text, image, header ...) never do. */
export function isContainerType(t: NodeType): boolean {
  return t === "frame" || t === "repeat";
}

const DEFAULTS: Record<NodeType, () => Pick<LNode, "style" | "props"> & { name: string }> = {
  frame: () => ({ name: "Frame", style: { mode: "stack", dir: "column", gap: 12, pad: 16, w: "fill" }, props: {} }),
  text: () => ({ name: "Text", style: { fs: 16 }, props: { text: "Hello, {{ user.username }}", tag: "p" } }),
  image: () => ({ name: "Image", style: { w: 120, h: 120, radius: 12 }, props: { src: "", alt: "", fit: "cover" } }),
  button: () => ({
    name: "Button",
    style: { radius: 10, pad: [10, 16, 10, 16], fw: 600 },
    props: { label: "Copy link", action: "copy", value: "{{ subscription.url }}", variant: "solid" },
  }),
  badge: () => ({ name: "Badge", style: { fs: 12 }, props: { text: "{{ user.userStatus }}", tone: "accent" } }),
  divider: () => ({ name: "Divider", style: { w: "fill", h: 1 }, props: {} }),
  spacer: () => ({ name: "Spacer", style: { h: 16 }, props: {} }),
  progress: () => ({
    name: "Progress",
    style: { w: "fill" },
    props: { value: "{{ user.trafficUsedBytes }}", max: "{{ user.trafficLimitBytes }}", label: "{{ user.trafficUsed }} / {{ user.trafficLimit }}", showText: true },
  }),
  icon: () => ({ name: "Icon", style: {}, props: { name: "star", size: 24 } }),
  qr: () => ({ name: "QR code", style: {}, props: { value: "{{ subscription.url }}", size: 160 } }),
  repeat: () => ({ name: "Repeat", style: { mode: "stack", dir: "column", gap: 8, w: "fill" }, props: { source: "devices", limit: 0, emptyText: "" } }),
  block: () => ({ name: "Block", style: { w: "fill" }, props: { kind: "links-list", block: {} } }),
  html: () => ({
    name: "Custom code",
    style: { w: "fill" },
    props: { html: '<div class="card"><b>{{ user.username }}</b></div>', css: ".card { padding: 12px; border-radius: 10px; background: rgba(255,255,255,.06); }", js: "", allowScripts: false, height: 120 },
  }),
  header: () => ({ name: "Header", style: { w: "fill" }, props: { showLogo: true, showTitle: true, showTagline: true, showSupport: true, showGetLink: true } }),
  "locale-switch": () => ({ name: "Language", style: { w: "fill" }, props: {} }),
  scene: () => ({ name: "Scene", style: { w: "fill" }, props: defaultSceneProps() }),
  apps: () => ({ name: "App buttons", style: { w: "fill" }, props: defaultAppsProps() }),
};

export function newNode(type: NodeType, patch: Partial<LNode> = {}): LNode {
  const d = DEFAULTS[type]();
  const node: LNode = {
    id: patch.id ?? nid(),
    type,
    name: patch.name ?? d.name,
    style: { ...d.style, ...(patch.style ?? {}) },
    props: { ...d.props, ...(patch.props ?? {}) },
  };
  if (isContainerType(type)) node.children = patch.children ?? [];
  if (patch.mobile) node.mobile = patch.mobile;
  if (patch.visibleIf) node.visibleIf = patch.visibleIf;
  if (patch.hidden) node.hidden = true;
  if (patch.locked) node.locked = true;
  if (patch.hideOn) node.hideOn = patch.hideOn;
  return node;
}

export function newDoc(rootPatch: Partial<LNode> = {}): LayoutDoc {
  const root = newNode("frame", {
    name: "Page",
    style: { mode: "stack", dir: "column", gap: 16, pad: 16, w: "fill", maxW: 960, self: "center" },
    ...rootPatch,
  });
  return { version: 1, enabled: true, root: root.id, nodes: { [root.id]: root }, vars: {} };
}

// ------------------------------------------------------------------------------------
// Queries
// ------------------------------------------------------------------------------------

export function getNode(doc: LayoutDoc, id: string): LNode | undefined {
  return doc.nodes[id];
}

export function parentMap(doc: LayoutDoc): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of Object.values(doc.nodes)) for (const c of n.children ?? []) m.set(c, n.id);
  return m;
}

export function parentOf(doc: LayoutDoc, id: string): string | undefined {
  for (const n of Object.values(doc.nodes)) if (n.children?.includes(id)) return n.id;
  return undefined;
}

export function subtreeIds(doc: LayoutDoc, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    out.push(cur);
    for (const c of doc.nodes[cur]?.children ?? []) stack.push(c);
  }
  return out;
}

export function isDescendant(doc: LayoutDoc, ancestorId: string, id: string): boolean {
  return subtreeIds(doc, ancestorId).includes(id);
}

/** Ancestors from the root down to (and excluding) the node. */
export function pathTo(doc: LayoutDoc, id: string): string[] {
  const pm = parentMap(doc);
  const out: string[] = [];
  let cur = pm.get(id);
  while (cur) {
    out.unshift(cur);
    cur = pm.get(cur);
  }
  return out;
}

export function walk(doc: LayoutDoc, fn: (n: LNode, depth: number, parent: LNode | null) => void): void {
  const visit = (id: string, depth: number, parent: LNode | null) => {
    const n = doc.nodes[id];
    if (!n) return;
    fn(n, depth, parent);
    for (const c of n.children ?? []) visit(c, depth + 1, n);
  };
  visit(doc.root, 0, null);
}

// ------------------------------------------------------------------------------------
// Mutations (immutable: every function returns a new doc)
// ------------------------------------------------------------------------------------

export type Subtree = { root: string; nodes: Record<string, LNode>; /** Texts the nodes refer to as `{{ tr.key }}`; merged into the document on insert. */ i18n?: Record<string, Record<string, string>> };

export function extractSubtree(doc: LayoutDoc, id: string): Subtree {
  const nodes: Record<string, LNode> = {};
  for (const sid of subtreeIds(doc, id)) nodes[sid] = JSON.parse(JSON.stringify(doc.nodes[sid])) as LNode;
  return { root: id, nodes };
}

/** Clones a subtree with fresh ids (paste, duplicate, templates). */
export function reidSubtree(sub: Subtree): Subtree {
  const map = new Map<string, string>();
  for (const id of Object.keys(sub.nodes)) map.set(id, nid());
  const nodes: Record<string, LNode> = {};
  for (const [id, n] of Object.entries(sub.nodes)) {
    const copy = JSON.parse(JSON.stringify(n)) as LNode;
    copy.id = map.get(id) as string;
    if (copy.children) copy.children = copy.children.map((c) => map.get(c) ?? c);
    nodes[copy.id] = copy;
  }
  return { root: map.get(sub.root) as string, nodes, ...(sub.i18n ? { i18n: sub.i18n } : {}) };
}

export function canAcceptChildren(doc: LayoutDoc, parentId: string): boolean {
  const p = doc.nodes[parentId];
  return !!p && isContainerType(p.type);
}

export function insertSubtree(doc: LayoutDoc, parentId: string, index: number, sub: Subtree): LayoutDoc {
  const parent = doc.nodes[parentId];
  if (!parent || !isContainerType(parent.type)) return doc;
  const children = [...(parent.children ?? [])];
  const at = Math.max(0, Math.min(children.length, index));
  children.splice(at, 0, sub.root);
  return { ...doc, nodes: { ...doc.nodes, ...sub.nodes, [parentId]: { ...parent, children } }, ...(sub.i18n ? { i18n: mergeDict(doc.i18n, sub.i18n) } : {}) };
}

export function insertNode(doc: LayoutDoc, parentId: string, index: number, node: LNode): LayoutDoc {
  return insertSubtree(doc, parentId, index, { root: node.id, nodes: { [node.id]: node } });
}

export function removeNode(doc: LayoutDoc, id: string): LayoutDoc {
  if (id === doc.root) return doc;
  const parentId = parentOf(doc, id);
  const nodes = { ...doc.nodes };
  for (const sid of subtreeIds(doc, id)) delete nodes[sid];
  if (parentId) {
    const p = nodes[parentId];
    nodes[parentId] = { ...p, children: (p.children ?? []).filter((c) => c !== id) };
  }
  return { ...doc, nodes };
}

/** Moves a node under `parentId` at `index` (index counts the target's children as they are before the move). */
export function moveNode(doc: LayoutDoc, id: string, parentId: string, index: number): LayoutDoc {
  if (id === doc.root || id === parentId) return doc;
  if (!canAcceptChildren(doc, parentId)) return doc;
  if (isDescendant(doc, id, parentId)) return doc; // no cycles
  const fromId = parentOf(doc, id);
  if (!fromId) return doc;
  const nodes = { ...doc.nodes };
  const from = nodes[fromId];
  const fromChildren = (from.children ?? []).filter((c) => c !== id);
  const oldIndex = (from.children ?? []).indexOf(id);
  nodes[fromId] = { ...from, children: fromChildren };
  const target = nodes[parentId];
  const list = [...(target.children ?? [])].filter((c) => c !== id);
  let at = index;
  if (fromId === parentId && oldIndex >= 0 && oldIndex < index) at = index - 1;
  at = Math.max(0, Math.min(list.length, at));
  list.splice(at, 0, id);
  nodes[parentId] = { ...target, children: list };
  return { ...doc, nodes };
}

export function duplicateNode(doc: LayoutDoc, id: string): { doc: LayoutDoc; id: string } | null {
  const parentId = parentOf(doc, id);
  if (!parentId) return null;
  const sub = reidSubtree(extractSubtree(doc, id));
  const at = (doc.nodes[parentId].children ?? []).indexOf(id) + 1;
  const root = sub.nodes[sub.root];
  sub.nodes[sub.root] = { ...root, name: root.name ? `${root.name} copy` : root.name };
  return { doc: insertSubtree(doc, parentId, at, sub), id: sub.root };
}

/** Deep-merges style / props and replaces the rest of the node fields. `undefined` values delete a key. */
export function updateNode(doc: LayoutDoc, id: string, patch: Partial<Omit<LNode, "id" | "style" | "props" | "mobile" | "children">> & { style?: Partial<Style>; props?: Record<string, unknown>; mobile?: Partial<Style> | null }): LayoutDoc {
  const n = doc.nodes[id];
  if (!n) return doc;
  const merge = <T extends Record<string, unknown>>(base: T, p: Partial<T>): T => {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out as T;
  };
  const { style, props, mobile, ...rest } = patch;
  const next: LNode = { ...n, ...rest };
  for (const k of Object.keys(next) as (keyof LNode)[]) if (next[k] === undefined) delete next[k];
  if (style) next.style = merge(n.style as Record<string, unknown>, style as Record<string, unknown>) as Style;
  if (props) next.props = merge(n.props, props);
  if (mobile === null) delete next.mobile;
  else if (mobile) {
    const m = merge((n.mobile ?? {}) as Record<string, unknown>, mobile as Record<string, unknown>) as Partial<Style>;
    if (Object.keys(m).length === 0) delete next.mobile;
    else next.mobile = m;
  }
  return { ...doc, nodes: { ...doc.nodes, [id]: next } };
}

/** Wraps nodes (same parent, in document order) into a new frame placed where the first one was. */
export function wrapInFrame(doc: LayoutDoc, ids: string[]): { doc: LayoutDoc; id: string } | null {
  if (ids.length === 0) return null;
  const parentId = parentOf(doc, ids[0]);
  if (!parentId || ids.some((i) => parentOf(doc, i) !== parentId)) return null;
  const parent = doc.nodes[parentId];
  const order = (parent.children ?? []).filter((c) => ids.includes(c));
  const at = (parent.children ?? []).indexOf(order[0]);
  const frame = newNode("frame", { name: "Group", style: { mode: "stack", dir: "column", gap: 8, pad: 0, w: "fill" }, children: order });
  const children = (parent.children ?? []).filter((c) => !order.includes(c));
  children.splice(at, 0, frame.id);
  return { doc: { ...doc, nodes: { ...doc.nodes, [frame.id]: frame, [parentId]: { ...parent, children } } }, id: frame.id };
}

function rowFrame(children: string[]): LNode {
  return newNode("frame", {
    name: "Row",
    style: { mode: "stack", dir: "row", gap: 12, pad: 0, w: "fill", align: "stretch", wrap: true },
    mobile: { dir: "column" },
    children,
  });
}

/** Makes children share a row equally. */
function shareRow(nodes: Record<string, LNode>, ids: string[]): void {
  for (const id of ids) {
    const n = nodes[id];
    if (n) nodes[id] = { ...n, style: { ...n.style, grow: 1, w: "auto" } };
  }
}

/** Wraps sibling nodes into a new row frame (equal-width children, wraps into a column on mobile). */
export function wrapInRow(doc: LayoutDoc, ids: string[]): { doc: LayoutDoc; id: string } | null {
  const list = ids.filter((i) => i !== doc.root && doc.nodes[i]);
  if (list.length === 0) return null;
  const parentId = parentOf(doc, list[0]);
  if (!parentId || list.some((i) => parentOf(doc, i) !== parentId)) return null;
  const parent = doc.nodes[parentId];
  const order = (parent.children ?? []).filter((c) => list.includes(c));
  const at = (parent.children ?? []).indexOf(order[0]);
  const row = rowFrame(order);
  const nodes = { ...doc.nodes, [row.id]: row };
  shareRow(nodes, order);
  const children = (parent.children ?? []).filter((c) => !order.includes(c));
  children.splice(at, 0, row.id);
  nodes[parentId] = { ...parent, children };
  return { doc: { ...doc, nodes }, id: row.id };
}

function isRowStack(n: LNode | undefined): boolean {
  return !!n && (n.style.mode ?? "stack") === "stack" && n.style.dir === "row";
}

function placeBesideImpl(doc: LayoutDoc, targetId: string, side: "left" | "right", movedId: string, sub?: Subtree): LayoutDoc {
  if (targetId === doc.root || movedId === doc.root || movedId === targetId || !doc.nodes[targetId]) return doc;
  let cur = doc;
  if (sub) {
    if (doc.nodes[sub.root]) return doc;
    cur = { ...doc, nodes: { ...doc.nodes, ...sub.nodes }, ...(sub.i18n ? { i18n: mergeDict(doc.i18n, sub.i18n) } : {}) };
  } else {
    if (!doc.nodes[movedId] || isDescendant(doc, movedId, targetId)) return doc; // no cycles
    const from = parentOf(doc, movedId);
    if (!from) return doc;
    const fp = doc.nodes[from];
    cur = { ...doc, nodes: { ...doc.nodes, [from]: { ...fp, children: (fp.children ?? []).filter((c) => c !== movedId) } } };
  }
  const parentId = parentOf(cur, targetId);
  const parent = parentId ? cur.nodes[parentId] : undefined;
  if (!parentId || !parent || !isContainerType(parent.type)) return doc;
  const kids = [...(parent.children ?? [])];
  const ti = kids.indexOf(targetId);
  if (isRowStack(parent)) {
    kids.splice(side === "left" ? ti : ti + 1, 0, movedId);
    return { ...cur, nodes: { ...cur.nodes, [parentId]: { ...parent, children: kids } } };
  }
  if ((parent.style.mode ?? "stack") === "free") return doc;
  const row = rowFrame(side === "left" ? [movedId, targetId] : [targetId, movedId]);
  const nodes = { ...cur.nodes, [row.id]: row };
  shareRow(nodes, [movedId, targetId]);
  kids.splice(ti, 1, row.id);
  nodes[parentId] = { ...parent, children: kids };
  return { ...cur, nodes };
}

/** Puts `movedId` to the left/right of `targetId`: inside the target's row, or in a new row that replaces the target. */
export function placeBeside(doc: LayoutDoc, targetId: string, movedId: string, side: "left" | "right"): LayoutDoc {
  return placeBesideImpl(doc, targetId, side, movedId);
}

/** Same as placeBeside for a new subtree that is not in the document yet. */
export function placeBesideSubtree(doc: LayoutDoc, targetId: string, sub: Subtree, side: "left" | "right"): LayoutDoc {
  return placeBesideImpl(doc, targetId, side, sub.root, sub);
}

/** Replaces a frame by its children in its parent. */
export function unwrapFrame(doc: LayoutDoc, id: string): LayoutDoc {
  const n = doc.nodes[id];
  const parentId = parentOf(doc, id);
  if (!n || n.type !== "frame" || !parentId) return doc;
  const parent = doc.nodes[parentId];
  const list = [...(parent.children ?? [])];
  const at = list.indexOf(id);
  list.splice(at, 1, ...(n.children ?? []));
  const nodes = { ...doc.nodes, [parentId]: { ...parent, children: list } };
  delete nodes[id];
  return { ...doc, nodes };
}

/** Moves a node one step among its siblings (delta -1 = earlier, +1 = later). */
export function shiftNode(doc: LayoutDoc, id: string, delta: number): LayoutDoc {
  const parentId = parentOf(doc, id);
  if (!parentId) return doc;
  const list = doc.nodes[parentId].children ?? [];
  const i = list.indexOf(id);
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (i < 0 || i === j) return doc;
  return moveNode(doc, id, parentId, j > i ? j + 1 : j);
}

// ------------------------------------------------------------------------------------
// Validation of untrusted documents (saved JSON, imports)
// ------------------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const ACTIONS = ["none", "link", "copy", "scroll-to", "toggle", "toggle-visibility", "set-state"];

export function normalizeStates(raw: unknown): StateRule[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StateRule[] = [];
  for (const r of raw.slice(0, 20)) {
    if (!isObj(r) || typeof r.when !== "string" || !r.when.trim()) continue;
    out.push({ when: r.when.slice(0, 500), style: isObj(r.style) ? (r.style as Style) : {} });
  }
  return out.length ? out : undefined;
}

export function normalizeOnClick(raw: unknown): OnClick | undefined {
  if (!isObj(raw) || typeof raw.action !== "string" || !ACTIONS.includes(raw.action) || raw.action === "none") return undefined;
  const o: OnClick = { action: raw.action as OnClick["action"] };
  if (typeof raw.value === "string") o.value = raw.value.slice(0, 1000);
  if (typeof raw.to === "string") o.to = raw.to.slice(0, 200);
  if (raw.newTab === true) o.newTab = true;
  return o;
}

/**
 * Turns unknown data into a consistent document: unknown node types and dangling children are dropped, nodes not
 * reachable from the root are discarded, cycles are cut. Returns null when nothing usable is there.
 */
export function normalizeDoc(input: unknown): LayoutDoc | null {
  if (!isObj(input) || !isObj(input.nodes) || typeof input.root !== "string") return null;
  const raw = input.nodes as Record<string, unknown>;
  const nodes: Record<string, LNode> = {};
  const seen = new Set<string>();

  const visit = (id: string): boolean => {
    if (seen.has(id)) return false; // cycle or shared node
    const r = raw[id];
    if (!isObj(r) || typeof r.type !== "string" || !(NODE_TYPES as string[]).includes(r.type)) return false;
    seen.add(id);
    const type = r.type as NodeType;
    const node: LNode = {
      id,
      type,
      style: isObj(r.style) ? (r.style as Style) : {},
      props: isObj(r.props) ? (r.props as Record<string, unknown>) : {},
    };
    if (typeof r.name === "string") node.name = r.name;
    if (r.locked === true) node.locked = true;
    if (r.hidden === true) node.hidden = true;
    if (typeof r.visibleIf === "string" && r.visibleIf.trim()) node.visibleIf = r.visibleIf;
    if (isObj(r.mobile)) node.mobile = r.mobile as Partial<Style>;
    if (isObj(r.hideOn)) node.hideOn = { mobile: r.hideOn.mobile === true, desktop: r.hideOn.desktop === true };
    const motion = normalizeMotion(r.motion);
    if (motion) node.motion = motion;
    const states = normalizeStates(r.states);
    if (states) node.states = states;
    if (typeof r.refresh === "number" && Number.isFinite(r.refresh) && r.refresh > 0) node.refresh = Math.min(3600, Math.max(1, r.refresh));
    const oc = normalizeOnClick(r.onClick);
    if (oc) node.onClick = oc;
    if (type === "html") {
      if (Array.isArray(node.props.params)) node.props = { ...node.props, params: normalizeParams(node.props.params) };
      if (isObj(node.props.values)) node.props = { ...node.props, values: normalizeValues(node.props.values) };
    }
    if (isContainerType(type)) {
      node.children = [];
      for (const c of Array.isArray(r.children) ? r.children : []) {
        if (typeof c === "string" && visit(c)) node.children.push(c);
      }
    }
    nodes[id] = node;
    return true;
  };

  if (!visit(input.root)) return null;
  if (nodes[input.root].type !== "frame") return null;
  const vars: Record<string, string> = {};
  if (isObj(input.vars)) for (const [k, v] of Object.entries(input.vars)) if (typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) vars[k] = v;
  let i18n: Record<string, Record<string, string>> | undefined;
  if (isObj(input.i18n)) {
    for (const [lang, m] of Object.entries(input.i18n)) {
      if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)?$/.test(lang) || !isObj(m)) continue;
      const dict: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (typeof v === "string" && /^\w+$/.test(k)) dict[k] = v;
      (i18n ??= {})[lang] = dict;
    }
  }
  return {
    version: 1,
    enabled: input.enabled !== false,
    root: input.root,
    nodes,
    vars,
    css: typeof input.css === "string" ? input.css : undefined,
    ...(i18n ? { i18n } : {}),
  };
}
