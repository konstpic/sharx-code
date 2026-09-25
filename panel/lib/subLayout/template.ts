/**
 * A small, safe template engine for the subscription page designer. It never uses eval or Function: expressions are
 * parsed into a tree and evaluated against a plain data context.
 *
 *   {{ user.username }}                       value
 *   {{ user.trafficUsed | upper }}            filters, chained with |
 *   {{ user.expiresAt | date("DD.MM.YYYY") }} filters take arguments
 *   {{ devices.count }} / {{ devices.max }}
 *   {{#if user.isActive}}on{{else if user.userStatus == "LIMITED"}}limit{{else}}off{{/if}}
 *   {{#each links as link}}{{ link.title }}{{/each}}
 *
 * Expressions: numbers, "strings", true / false / null, paths (a.b[0]), ! - * / % + - < <= > >= == != && || ?: and calls
 * of the functions below.
 */

export type Ctx = Record<string, unknown>;

// ------------------------------------------------------------------------------------
// Tokenizer
// ------------------------------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "end" };

const OPS3 = ["==="];
const OPS2 = ["==", "!=", "<=", ">=", "&&", "||"];
const OPS1 = "+-*/%<>!?:.,()[]|";

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (Number.isNaN(n)) throw new Error(`Bad number "${src.slice(i, j)}"`);
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else {
          s += src[j++];
        }
      }
      if (src[j] !== c) throw new Error("Unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$-]/.test(src[j]) && !(src[j] === "-" && !/[A-Za-z_$]/.test(src[j + 1] ?? ""))) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) {
      out.push({ t: "op", v: "==" });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (OPS1.includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected "${c}"`);
  }
  out.push({ t: "end" });
  return out;
}

// ------------------------------------------------------------------------------------
// Parser
// ------------------------------------------------------------------------------------

export type Expr =
  | { k: "lit"; v: unknown }
  | { k: "path"; root: string; parts: Expr[]; names: string[] }
  | { k: "un"; op: string; a: Expr }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "cond"; c: Expr; a: Expr; b: Expr }
  | { k: "call"; name: string; args: Expr[] };

export type Piped = { e: Expr; filters: { name: string; args: Expr[] }[] };

class Parser {
  private p = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  private peek(): Tok {
    return this.toks[this.p];
  }
  private next(): Tok {
    return this.toks[this.p++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === "op" && t.v === v;
  }
  private eat(v: string): void {
    if (!this.isOp(v)) throw new Error(`Expected "${v}"`);
    this.p++;
  }

  atEnd(): boolean {
    return this.peek().t === "end";
  }

  /** expression with an optional filter chain */
  parsePiped(): Piped {
    const e = this.parseExpr();
    const filters: Piped["filters"] = [];
    while (this.isOp("|")) {
      this.p++;
      const t = this.next();
      if (t.t !== "id") throw new Error("Filter name expected after |");
      const args: Expr[] = [];
      if (this.isOp("(")) {
        this.p++;
        if (!this.isOp(")")) {
          args.push(this.parseExpr());
          while (this.isOp(",")) {
            this.p++;
            args.push(this.parseExpr());
          }
        }
        this.eat(")");
      }
      filters.push({ name: t.v, args });
    }
    return { e, filters };
  }

  parseExpr(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const c = this.parseOr();
    if (this.isOp("?")) {
      this.p++;
      const a = this.parseExpr();
      this.eat(":");
      const b = this.parseExpr();
      return { k: "cond", c, a, b };
    }
    return c;
  }
  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.isOp("||")) {
      this.p++;
      l = { k: "bin", op: "||", a: l, b: this.parseAnd() };
    }
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parseEq();
    while (this.isOp("&&")) {
      this.p++;
      l = { k: "bin", op: "&&", a: l, b: this.parseEq() };
    }
    return l;
  }
  private parseEq(): Expr {
    let l = this.parseRel();
    while (this.isOp("==") || this.isOp("!=")) {
      const op = (this.next() as { v: string }).v;
      l = { k: "bin", op, a: l, b: this.parseRel() };
    }
    return l;
  }
  private parseRel(): Expr {
    let l = this.parseAdd();
    while (this.isOp("<") || this.isOp("<=") || this.isOp(">") || this.isOp(">=")) {
      const op = (this.next() as { v: string }).v;
      l = { k: "bin", op, a: l, b: this.parseAdd() };
    }
    return l;
  }
  private parseAdd(): Expr {
    let l = this.parseMul();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.next() as { v: string }).v;
      l = { k: "bin", op, a: l, b: this.parseMul() };
    }
    return l;
  }
  private parseMul(): Expr {
    let l = this.parseUnary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = (this.next() as { v: string }).v;
      l = { k: "bin", op, a: l, b: this.parseUnary() };
    }
    return l;
  }
  private parseUnary(): Expr {
    if (this.isOp("!") || this.isOp("-")) {
      const op = (this.next() as { v: string }).v;
      return { k: "un", op, a: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  private parsePrimary(): Expr {
    const t = this.next();
    if (t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "op" && t.v === "(") {
      const e = this.parseExpr();
      this.eat(")");
      return e;
    }
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null" || t.v === "undefined") return { k: "lit", v: null };
      if (this.isOp("(")) {
        this.p++;
        const args: Expr[] = [];
        if (!this.isOp(")")) {
          args.push(this.parseExpr());
          while (this.isOp(",")) {
            this.p++;
            args.push(this.parseExpr());
          }
        }
        this.eat(")");
        return { k: "call", name: t.v, args };
      }
      const parts: Expr[] = [];
      const names: string[] = [];
      for (;;) {
        if (this.isOp(".")) {
          this.p++;
          const n = this.next();
          if (n.t !== "id" && n.t !== "num") throw new Error("Name expected after .");
          parts.push({ k: "lit", v: n.t === "num" ? n.v : n.v });
          names.push(String(n.v));
        } else if (this.isOp("[")) {
          this.p++;
          const idx = this.parseExpr();
          this.eat("]");
          parts.push(idx);
          names.push(idx.k === "lit" ? String(idx.v) : "[]");
        } else break;
      }
      return { k: "path", root: t.v, parts, names };
    }
    throw new Error(t.t === "end" ? "Unexpected end of expression" : `Unexpected "${(t as { v: unknown }).v}"`);
  }
}

export function parseExpression(src: string): Piped {
  const p = new Parser(tokenize(src));
  const e = p.parsePiped();
  if (!p.atEnd()) throw new Error("Unexpected trailing text");
  return e;
}

// ------------------------------------------------------------------------------------
// Evaluation
// ------------------------------------------------------------------------------------

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function getOwn(obj: unknown, key: string | number): unknown {
  if (obj === null || obj === undefined) return undefined;
  const k = String(key);
  if (FORBIDDEN.has(k)) return undefined;
  if (Array.isArray(obj)) {
    if (k === "length") return obj.length;
    const n = Number(k);
    return Number.isInteger(n) ? obj[n] : undefined;
  }
  if (typeof obj === "string" && k === "length") return obj.length;
  if (typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, k)) return (obj as Record<string, unknown>)[k];
  return undefined;
}

export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v === "0" || v === "false") return false;
  return Boolean(v);
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(str).join(", ");
  return "";
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (typeof a === "number" || typeof b === "number") return num(a) === num(b) && str(a) !== "" && str(b) !== "";
  return str(a) === str(b);
}

export function evalExpr(e: Expr, ctx: Ctx): unknown {
  switch (e.k) {
    case "lit":
      return e.v;
    case "path": {
      let cur: unknown = getOwn(ctx, e.root);
      for (const p of e.parts) cur = getOwn(cur, evalExpr(p, ctx) as string | number);
      return cur;
    }
    case "un": {
      const a = evalExpr(e.a, ctx);
      return e.op === "!" ? !truthy(a) : -num(a);
    }
    case "cond":
      return truthy(evalExpr(e.c, ctx)) ? evalExpr(e.a, ctx) : evalExpr(e.b, ctx);
    case "bin": {
      if (e.op === "&&") {
        const l = evalExpr(e.a, ctx);
        return truthy(l) ? evalExpr(e.b, ctx) : l;
      }
      if (e.op === "||") {
        const l = evalExpr(e.a, ctx);
        return truthy(l) ? l : evalExpr(e.b, ctx);
      }
      const a = evalExpr(e.a, ctx);
      const b = evalExpr(e.b, ctx);
      switch (e.op) {
        case "+":
          return typeof a === "number" && typeof b === "number" ? a + b : typeof a === "string" || typeof b === "string" ? str(a) + str(b) : num(a) + num(b);
        case "-":
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/":
          return num(b) === 0 ? 0 : num(a) / num(b);
        case "%":
          return num(b) === 0 ? 0 : num(a) % num(b);
        case "<":
          return num(a) < num(b);
        case "<=":
          return num(a) <= num(b);
        case ">":
          return num(a) > num(b);
        case ">=":
          return num(a) >= num(b);
        case "==":
          return looseEq(a, b);
        case "!=":
          return !looseEq(a, b);
      }
      return undefined;
    }
    case "call": {
      const fn = FUNCTIONS[e.name];
      if (!fn) throw new Error(`Unknown function ${e.name}()`);
      return fn(...e.args.map((a) => evalExpr(a, ctx)));
    }
  }
}

// ------------------------------------------------------------------------------------
// Functions and filters
// ------------------------------------------------------------------------------------

export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${i === 0 ? Math.round(v) : v.toFixed(digits).replace(/\.0+$/, "")} ${units[i]}`;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** value: ISO string, unix seconds or milliseconds. */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  let d: Date;
  if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) {
    const n = Number(v);
    d = new Date(n < 1e11 ? n * 1000 : n);
  } else {
    d = new Date(String(v));
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: unknown, fmt = "DD.MM.YYYY", lang = "en"): string {
  const d = toDate(v);
  if (!d) return "";
  // 9999-12-31 is the panel's "never expires".
  if (d.getUTCFullYear() >= 9000) return lang === "ru" ? "∞" : "∞";
  const pad = (n: number) => String(n).padStart(2, "0");
  const months = lang === "ru" ? MONTHS_RU : MONTHS_EN;
  return fmt.replace(/YYYY|YY|MMM|MM|DD|HH|mm|ss/g, (m) => {
    switch (m) {
      case "YYYY":
        return String(d.getFullYear());
      case "YY":
        return String(d.getFullYear()).slice(2);
      case "MMM":
        return months[d.getMonth()];
      case "MM":
        return pad(d.getMonth() + 1);
      case "DD":
        return pad(d.getDate());
      case "HH":
        return pad(d.getHours());
      case "mm":
        return pad(d.getMinutes());
      default:
        return pad(d.getSeconds());
    }
  });
}

export function pluralIndex(n: number, lang: string): number {
  const a = Math.abs(Math.trunc(n));
  if (lang === "ru" || lang === "uk") {
    const m10 = a % 10;
    const m100 = a % 100;
    if (m10 === 1 && m100 !== 11) return 0;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
    return 2;
  }
  return a === 1 ? 0 : 1;
}

export function relativeTime(v: unknown, lang = "en", now = Date.now()): string {
  const d = toDate(v);
  if (!d) return "";
  const diff = Math.round((now - d.getTime()) / 1000);
  const abs = Math.abs(diff);
  const units: [number, [string, string, string], [string, string]][] = [
    [86400, ["день", "дня", "дней"], ["day", "days"]],
    [3600, ["час", "часа", "часов"], ["hour", "hours"]],
    [60, ["минуту", "минуты", "минут"], ["minute", "minutes"]],
  ];
  for (const [sec, ru, en] of units) {
    if (abs >= sec) {
      const n = Math.floor(abs / sec);
      const w = lang === "ru" ? ru[pluralIndex(n, "ru")] : en[pluralIndex(n, "en")];
      if (lang === "ru") return diff >= 0 ? `${n} ${w} назад` : `через ${n} ${w}`;
      return diff >= 0 ? `${n} ${w} ago` : `in ${n} ${w}`;
    }
  }
  return lang === "ru" ? "только что" : "just now";
}

type Fn = (...a: unknown[]) => unknown;

/** Filters get the piped value first; the same names are callable as functions with the value as the first argument. */
const FILTERS: Record<string, Fn> = {
  upper: (v) => str(v).toUpperCase(),
  lower: (v) => str(v).toLowerCase(),
  capitalize: (v) => {
    const s = str(v);
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  trim: (v) => str(v).trim(),
  truncate: (v, n = 30) => {
    const s = str(v);
    const k = Math.max(1, num(n));
    return s.length > k ? s.slice(0, k - 1) + "…" : s;
  },
  default: (v, d = "") => (v === null || v === undefined || v === "" ? d : v),
  bytes: (v, d = 1) => formatBytes(num(v), num(d)),
  number: (v, d = 0) => num(v).toFixed(Math.max(0, num(d))).replace(/\.0+$/, ""),
  percent: (v, total, d = 0) => (num(total) === 0 ? "0" : ((num(v) / num(total)) * 100).toFixed(Math.max(0, num(d))).replace(/\.0+$/, "")),
  json: (v) => JSON.stringify(v ?? null),
  urlencode: (v) => encodeURIComponent(str(v)),
  b64: (v) => {
    try {
      return typeof btoa === "function" ? btoa(unescape(encodeURIComponent(str(v)))) : "";
    } catch {
      return "";
    }
  },
  join: (v, sep = ", ") => (Array.isArray(v) ? v.map(str).join(str(sep)) : str(v)),
  first: (v) => (Array.isArray(v) ? v[0] : str(v).charAt(0)),
  last: (v) => (Array.isArray(v) ? v[v.length - 1] : str(v).slice(-1)),
  len: (v) => (Array.isArray(v) || typeof v === "string" ? v.length : 0),
  replace: (v, a, b = "") => str(v).split(str(a)).join(str(b)),
  round: (v, d = 0) => {
    const k = Math.pow(10, Math.max(0, num(d)));
    return Math.round(num(v) * k) / k;
  },
};

// Filters that depend on the locale are bound per render (see renderTemplate).
type LocaleFns = { lang: string; now: number };

function localeFilters(loc: LocaleFns): Record<string, Fn> {
  return {
    date: (v, f = "DD.MM.YYYY") => formatDate(v, str(f), loc.lang),
    time: (v) => formatDate(v, "HH:mm", loc.lang),
    datetime: (v) => formatDate(v, "DD.MM.YYYY HH:mm", loc.lang),
    ago: (v) => relativeTime(v, loc.lang, loc.now),
    plural: (v, one, few, many) => {
      const forms = loc.lang === "ru" || loc.lang === "uk" ? [str(one), str(few ?? one), str(many ?? few ?? one)] : [str(one), str(few ?? one)];
      return forms[Math.min(pluralIndex(num(v), loc.lang), forms.length - 1)];
    },
  };
}

const FUNCTIONS: Record<string, Fn> = {
  ...FILTERS,
  min: (...a) => Math.min(...a.map(num)),
  max: (...a) => Math.max(...a.map(num)),
  abs: (v) => Math.abs(num(v)),
  floor: (v) => Math.floor(num(v)),
  ceil: (v) => Math.ceil(num(v)),
  clamp: (v, lo, hi) => Math.min(num(hi), Math.max(num(lo), num(v))),
  now: () => Date.now(),
  coalesce: (...a) => a.find((x) => x !== null && x !== undefined && x !== ""),
  contains: (a, b) => (Array.isArray(a) ? a.some((x) => looseEq(x, b)) : str(a).includes(str(b))),
  startsWith: (a, b) => str(a).startsWith(str(b)),
  endsWith: (a, b) => str(a).endsWith(str(b)),
  // Not part of FILTERS on purpose: the locale-bound versions below take over in a render.
};

// ------------------------------------------------------------------------------------
// Templates
// ------------------------------------------------------------------------------------

type TNode =
  | { k: "text"; v: string }
  | { k: "out"; e: Piped; src: string }
  | { k: "if"; branches: { c: Expr | null; body: TNode[]; src: string }[] }
  | { k: "each"; e: Expr; as: string; body: TNode[] };

const TAG_RE = /\{\{([\s\S]*?)\}\}/g;

function parseTemplate(src: string): TNode[] {
  type Frame = { kind: "root" | "if" | "each"; nodes: TNode[]; node?: TNode };
  const stack: Frame[] = [{ kind: "root", nodes: [] }];
  let last = 0;
  const top = () => stack[stack.length - 1];
  const push = (n: TNode) => top().nodes.push(n);

  for (const m of src.matchAll(TAG_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) push({ k: "text", v: src.slice(last, idx) });
    last = idx + m[0].length;
    const raw = m[1].trim();

    if (raw.startsWith("#if ")) {
      const c = new Parser(tokenize(raw.slice(4)));
      const cond = c.parseExpr();
      const node: TNode = { k: "if", branches: [{ c: cond, body: [], src: raw.slice(4) }] };
      push(node);
      stack.push({ kind: "if", nodes: node.branches[0].body, node });
    } else if (raw === "else" || raw.startsWith("else if ")) {
      const f = top();
      if (f.kind !== "if" || !f.node || f.node.k !== "if") throw new Error("{{else}} without {{#if}}");
      const branch: { c: Expr | null; body: TNode[]; src: string } = { c: raw === "else" ? null : new Parser(tokenize(raw.slice(8))).parseExpr(), body: [], src: raw.slice(8) };
      f.node.branches.push(branch);
      f.nodes = branch.body;
    } else if (raw === "/if") {
      if (top().kind !== "if") throw new Error("{{/if}} without {{#if}}");
      stack.pop();
    } else if (raw.startsWith("#each ")) {
      const rest = raw.slice(6);
      const mm = /^([\s\S]+?)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(rest);
      const expr = new Parser(tokenize(mm ? mm[1] : rest)).parseExpr();
      const node: TNode = { k: "each", e: expr, as: mm ? mm[2] : "item", body: [] };
      push(node);
      stack.push({ kind: "each", nodes: node.body });
    } else if (raw === "/each") {
      if (top().kind !== "each") throw new Error("{{/each}} without {{#each}}");
      stack.pop();
    } else if (raw !== "") {
      push({ k: "out", e: parseExpression(raw), src: raw });
    }
  }
  if (last < src.length) push({ k: "text", v: src.slice(last) });
  if (stack.length !== 1) throw new Error("Unclosed {{#if}} or {{#each}}");
  return stack[0].nodes;
}

const cache = new Map<string, { ast?: TNode[]; error?: string }>();

function compile(src: string): { ast?: TNode[]; error?: string } {
  const hit = cache.get(src);
  if (hit) return hit;
  let entry: { ast?: TNode[]; error?: string };
  try {
    entry = { ast: parseTemplate(src) };
  } catch (e) {
    entry = { error: e instanceof Error ? e.message : String(e) };
  }
  if (cache.size > 800) cache.clear();
  cache.set(src, entry);
  return entry;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type RenderOptions = {
  /** "html": escape every substituted value (for markup). "text": leave values as they are (React escapes them). */
  escape?: "html" | "text";
  lang?: string;
  now?: number;
};

export type RenderResult = { out: string; errors: string[] };

function applyFilter(name: string, value: unknown, args: unknown[], loc: Record<string, Fn>): unknown {
  const fn = loc[name] ?? FILTERS[name];
  if (!fn) throw new Error(`Unknown filter ${name}`);
  return fn(value, ...args);
}

function renderNodes(nodes: TNode[], ctx: Ctx, opts: Required<RenderOptions>, loc: Record<string, Fn>, errors: string[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.k === "text") {
      out += n.v;
    } else if (n.k === "out") {
      try {
        let v = evalExpr(n.e.e, ctx);
        for (const f of n.e.filters) {
          v = applyFilter(
            f.name,
            v,
            f.args.map((a) => evalExpr(a, ctx)),
            loc,
          );
        }
        const s = str(v);
        out += opts.escape === "html" ? escapeHtml(s) : s;
      } catch (e) {
        errors.push(`{{ ${n.src} }}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (n.k === "if") {
      for (const b of n.branches) {
        let ok = true;
        try {
          ok = b.c === null ? true : truthy(evalExpr(b.c, ctx));
        } catch (e) {
          errors.push(`{{#if ${b.src}}}: ${e instanceof Error ? e.message : String(e)}`);
          ok = false;
        }
        if (ok) {
          out += renderNodes(b.body, ctx, opts, loc, errors);
          break;
        }
      }
    } else {
      let list: unknown;
      try {
        list = evalExpr(n.e, ctx);
      } catch (e) {
        errors.push(`{{#each}}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (Array.isArray(list)) {
        list.slice(0, 200).forEach((item, i) => {
          out += renderNodes(n.body, { ...ctx, [n.as]: item, index: i, number: i + 1 }, opts, loc, errors);
        });
      }
    }
  }
  return out;
}

/** Substitutes `{{…}}` in a string. Errors are collected, never thrown; a broken template renders as its source text. */
export function renderTemplate(src: string, ctx: Ctx, options: RenderOptions = {}): RenderResult {
  if (typeof src !== "string" || !src.includes("{{")) return { out: typeof src === "string" ? src : "", errors: [] };
  const opts: Required<RenderOptions> = { escape: options.escape ?? "text", lang: options.lang ?? "en", now: options.now ?? Date.now() };
  const c = compile(src);
  if (!c.ast) return { out: src, errors: [c.error ?? "Template error"] };
  const errors: string[] = [];
  const out = renderNodes(c.ast, ctx, opts, localeFilters({ lang: opts.lang, now: opts.now }), errors);
  return { out, errors };
}

/** Evaluates a condition (visibility). An empty expression is true; a broken one is true so nothing disappears silently. */
export function evalCondition(src: string | undefined, ctx: Ctx, options: RenderOptions = {}): { value: boolean; error?: string } {
  if (!src || !src.trim()) return { value: true };
  try {
    const p = parseExpression(src.replace(/^\{\{|\}\}$/g, ""));
    let v = evalExpr(p.e, ctx);
    const loc = localeFilters({ lang: options.lang ?? "en", now: options.now ?? Date.now() });
    for (const f of p.filters) {
      v = applyFilter(f.name, v, f.args.map((a) => evalExpr(a, ctx)), loc);
    }
    return { value: truthy(v) };
  } catch (e) {
    return { value: true, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Checks a template without data: returns parse errors (used by the designer to flag typos). */
export function lintTemplate(src: string): string[] {
  if (typeof src !== "string" || !src.includes("{{")) return [];
  const c = compile(src);
  return c.error ? [c.error] : [];
}

/** Variable paths a template refers to (`user.username`, `links`): drives the "used variables" hint. */
export function usedPaths(src: string): string[] {
  const found = new Set<string>();
  const walk = (e: Expr) => {
    if (e.k === "path") found.add([e.root, ...e.names].join("."));
    else if (e.k === "un") walk(e.a);
    else if (e.k === "bin") (walk(e.a), walk(e.b));
    else if (e.k === "cond") (walk(e.c), walk(e.a), walk(e.b));
    else if (e.k === "call") e.args.forEach(walk);
  };
  const visit = (nodes: TNode[]) => {
    for (const n of nodes) {
      if (n.k === "out") {
        walk(n.e.e);
        n.e.filters.forEach((f) => f.args.forEach(walk));
      } else if (n.k === "if") n.branches.forEach((b) => (b.c && walk(b.c), visit(b.body)));
      else if (n.k === "each") (walk(n.e), visit(n.body));
    }
  };
  const c = compile(src);
  if (c.ast) visit(c.ast);
  return [...found];
}

/** URL schemes that must never come out of a template (values from data are inserted into hrefs and image sources). */
export function safeUrl(u: string): string {
  const s = u.trim();
  if (/^\s*(javascript|data|vbscript|file):/i.test(s)) return "";
  return s;
}
