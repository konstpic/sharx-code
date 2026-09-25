/**
 * Layout document of the subscription page designer.
 *
 * The page is a tree of nodes stored flat (`nodes` by id, `children` as id lists): that keeps drag and drop, undo and
 * cloning simple pure functions. The document lives in the subscription page config as `layout`; the old flat `blocks`
 * list stays valid and is turned into a layout on demand.
 */

export type NodeType =
  | "frame"
  | "text"
  | "image"
  | "button"
  | "badge"
  | "divider"
  | "spacer"
  | "progress"
  | "icon"
  | "qr"
  | "repeat"
  | "block"
  | "html"
  | "header"
  | "locale-switch"
  | "scene"
  | "apps";

export const NODE_TYPES: NodeType[] = [
  "frame",
  "text",
  "image",
  "button",
  "badge",
  "divider",
  "spacer",
  "progress",
  "icon",
  "qr",
  "repeat",
  "block",
  "html",
  "header",
  "locale-switch",
  "scene",
  "apps",
];

/** How a frame lays out its children. `free` positions them by x / y (like a Figma frame without auto layout). */
export type FrameMode = "stack" | "grid" | "free";
export type Align = "start" | "center" | "end" | "stretch" | "baseline";
export type Justify = "start" | "center" | "end" | "between" | "around" | "evenly";

/**
 * Sizes are strings: "auto" (natural size), "fill" (take the free space of the parent), or a CSS length ("240px", "50%",
 * "20rem"). Numbers are pixels.
 */
export type Size = string | number;

export type BorderStyle = {
  w: number;
  color: string;
  style?: "solid" | "dashed" | "dotted";
  /** Per-side widths [top, right, bottom, left]; when set they replace `w`. */
  sides?: number[];
};

export type ShadowItem = { x: number; y: number; blur: number; spread?: number; color: string; inset?: boolean };
export type FilterSet = { blur?: number; brightness?: number; contrast?: number; saturate?: number; hue?: number; grayscale?: number };
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "soft-light" | "difference";
export const BLEND_MODES: BlendMode[] = ["normal", "multiply", "screen", "overlay", "soft-light", "difference"];

export interface Style {
  // Layout of a frame
  mode?: FrameMode;
  dir?: "row" | "column";
  wrap?: boolean;
  gap?: number;
  cols?: number;
  colMin?: number;
  align?: Align;
  justify?: Justify;
  pad?: number | number[];
  // Sizing and placement (as a child)
  w?: Size;
  h?: Size;
  minW?: Size;
  maxW?: Size;
  minH?: Size;
  maxH?: Size;
  grow?: number;
  aspect?: string;
  mar?: number | number[];
  self?: "auto" | Align;
  // Free position (child of a `free` frame)
  x?: number;
  y?: number;
  z?: number;
  rotate?: number;
  // Appearance
  bg?: string;
  bgImage?: string;
  bgSize?: "cover" | "contain" | "auto";
  /** Background image position, e.g. "center", "top left", "50% 20%". */
  bgPos?: string;
  bgRepeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
  /** List of shadows (replaces `shadow` when not empty). */
  shadows?: ShadowItem[];
  blend?: BlendMode;
  filter?: FilterSet;
  overflow?: "visible" | "hidden" | "auto";
  pointer?: "auto" | "none";
  visibility?: "visible" | "hidden";
  border?: BorderStyle;
  radius?: number | number[];
  shadow?: string;
  opacity?: number;
  blur?: number;
  // Text
  fs?: number;
  fw?: number;
  color?: string;
  ta?: "left" | "center" | "right" | "justify";
  lh?: number;
  ls?: number;
  family?: "sans" | "mono" | "heading" | "script" | string;
  upper?: boolean;
  italic?: boolean;
  underline?: boolean;
  truncate?: boolean;
  /** Line clamp: at most this many lines, then an ellipsis. */
  clamp?: number;
  nowrap?: boolean;
  /** Text wrapping mode. */
  tw?: "wrap" | "balance" | "pretty";
  deco?: "none" | "underline" | "line-through" | "overline";
  cursor?: string;
}

// ------------------------------------------------------------------------------------
// Motion, state, behavior
// ------------------------------------------------------------------------------------

export type MotionPreset =
  | "none" | "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "zoom" | "flip" | "blur-in"
  | "bounce" | "pulse" | "float" | "shake" | "spin" | "glow" | "shimmer" | "typewriter" | "custom";
export const MOTION_PRESETS: MotionPreset[] = ["none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom", "flip", "blur-in", "bounce", "pulse", "float", "shake", "spin", "glow", "shimmer", "typewriter", "custom"];
export type MotionTrigger = "load" | "visible" | "hover" | "click" | "focus" | "scroll-progress";
export const MOTION_TRIGGERS: MotionTrigger[] = ["load", "visible", "hover", "click", "focus", "scroll-progress"];

/** Animation of any node (generated CSS keyframes; see lib/subLayout/motion.ts). */
export interface Motion {
  preset: MotionPreset;
  /** ms */
  duration?: number;
  /** ms */
  delay?: number;
  /** ease | linear | ease-in | ease-out | ease-in-out | spring | cubic-bezier(...) | steps(n) */
  easing?: string;
  direction?: "normal" | "reverse" | "alternate" | "alternate-reverse";
  iterations?: number | "infinite";
  fillMode?: "none" | "forwards" | "backwards" | "both";
  /** px, for slide / float / bounce / shake */
  distance?: number;
  /** 0-100 */
  intensity?: number;
  trigger?: MotionTrigger;
  /** trigger "visible": replay every time the element enters the viewport (default: once). */
  repeat?: boolean;
  /** ms between children when applied to a frame. */
  stagger?: number;
  playState?: "running" | "paused";
  /** Body of an @keyframes rule, e.g. `from{opacity:0}to{opacity:1}` (preset "custom"). */
  customKeyframes?: string;
}

/** Conditional style overrides: every rule whose expression is truthy is merged in order. */
export type StateRule = { when: string; style: Partial<Style> };

export type NodeAction = "none" | "link" | "copy" | "scroll-to" | "toggle" | "toggle-visibility" | "set-state";
export interface OnClick {
  action: NodeAction;
  /** link: URL, copy: text, scroll-to / toggle-visibility: node id, toggle / set-state: state key (`state.<key>`). */
  value?: string;
  /** set-state: value to write (empty = toggle). */
  to?: string;
  newTab?: boolean;
}

export type ParamType = "number" | "range" | "color" | "select" | "toggle" | "text" | "font";
export type ParamValue = string | number | boolean;
export type ParamDef = {
  key: string;
  label: string;
  type: ParamType;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  group?: string;
};

export interface LNode {
  id: string;
  type: NodeType;
  /** Name shown in the layers panel. */
  name?: string;
  locked?: boolean;
  /** Hidden in the designer and on the page. */
  hidden?: boolean;
  /** Expression: the node is rendered only when it is truthy, e.g. `user.isActive && devices.count < devices.max`. */
  visibleIf?: string;
  style: Style;
  /** Overrides applied when the page container is narrow (<= 640px). */
  mobile?: Partial<Style>;
  hideOn?: { mobile?: boolean; desktop?: boolean };
  motion?: Motion;
  states?: StateRule[];
  /** Seconds between re-renders of this node (time-dependent values such as `now | ago`); 0 / unset = off. */
  refresh?: number;
  onClick?: OnClick;
  props: Record<string, unknown>;
  children?: string[];
}

export interface LayoutDoc {
  version: 1;
  /** When false the classic block list is rendered instead. */
  enabled: boolean;
  root: string;
  nodes: Record<string, LNode>;
  /** Your own variables, available as `{{vars.name}}`. */
  vars: Record<string, string>;
  /** Extra CSS for the whole page (scoped to it). Variables are not substituted here. */
  css?: string;
  /** Texts by language: `{{ tr.key }}` in any text resolves to the visitor's language (falls back to English). */
  i18n?: Record<string, Record<string, string>>;
}

// ------------------------------------------------------------------------------------
// Type-specific props (documented shapes; nodes keep them in the loose `props` map)
// ------------------------------------------------------------------------------------

export type TextProps = { text: string; tag?: "p" | "span" | "h1" | "h2" | "h3" | "h4" };
export type ImageProps = { src: string; alt?: string; fit?: "cover" | "contain" | "fill" };
export type ButtonAction = "link" | "copy" | "qr" | "deeplink" | "toggle";
export type ButtonProps = {
  label: string;
  action?: ButtonAction;
  /** link: URL, copy / qr: the text, deeplink: app id (see APP_CATALOG). */
  value?: string;
  variant?: "solid" | "outline" | "ghost";
  newTab?: boolean;
  icon?: string;
};
export type BadgeProps = { text: string; tone?: "neutral" | "accent" | "success" | "warning" | "danger" };
export type ProgressProps = { value: string; max: string; label?: string; color?: string; showText?: boolean };
export type IconProps = { name: string; size?: number };
export type QrProps = { value: string; size?: number; fg?: string; bg?: string };
export type RepeatSource = "links" | "devices" | "apps" | "mtProto" | string;
export type RepeatProps = { source: RepeatSource; limit?: number; emptyText?: string };
export type HtmlProps = { html: string; css?: string; js?: string; allowScripts?: boolean; height?: number; params?: ParamDef[]; values?: Record<string, ParamValue> };
export type HeaderProps = { showLogo?: boolean; showTitle?: boolean; showTagline?: boolean; showSupport?: boolean; showGetLink?: boolean };

/** Hand-picked app buttons; see lib/subLayout/apps.ts (AppsProps). */
export type { AppsProps } from "./apps";

export type SceneTone = "accent" | "green" | "amber" | "rose" | "blue";
export type SceneActor = { id: string; label: string; icon: string; x: number; y: number; tone?: SceneTone };
export type SceneStep = {
  caption: string;
  show: string[];
  focus?: string[];
  flows?: { from: string; to: string; tone?: SceneTone }[];
  /** Duration of this step in ms (overrides `stepMs`). */
  ms?: number;
  /** Expression like `user.percentUsed > 80`: the step is skipped while it is false (data-driven scenes). */
  condition?: string;
};
export type SceneTransition = "fade" | "slide" | "scale";
export type SceneLoopMode = "loop" | "once" | "ping-pong";
export type SceneStart = "load" | "visible" | "click";
/** Animated explainer scene. Actor labels and step captions are templates (`{{ }}`); x / y are 0-100 (percent of the scene). */
export type SceneProps = {
  actors: SceneActor[];
  links: [string, string][];
  steps: SceneStep[];
  autoplay?: boolean;
  loop?: boolean;
  stepMs?: number;
  height?: number;
  showCaption?: boolean;
  showControls?: boolean;
  /** Playback speed multiplier (0.25-4). */
  speed?: number;
  transition?: SceneTransition;
  flowDir?: "forward" | "reverse" | "both";
  /** Speed multiplier of the moving dots. */
  flowSpeed?: number;
  /** Dots per flow (1-5). */
  flowDots?: number;
  loopMode?: SceneLoopMode;
  start?: SceneStart;
  pauseOnHover?: boolean;
  showNumbers?: boolean;
  /** Actor icon box in px. */
  actorSize?: number;
  actorShape?: "circle" | "rounded" | "square";
  lineStyle?: "solid" | "dashed" | "animated";
  /** Colors per tone (CSS colors or theme variables). */
  tones?: Partial<Record<SceneTone, string>>;
};

/** Fields that hold text with `{{variables}}`, per node type: used to insert variables and to scan a document. */
export const TEMPLATE_PROPS: Record<NodeType, string[]> = {
  frame: [],
  text: ["text"],
  image: ["src", "alt"],
  button: ["label", "value"],
  badge: ["text"],
  divider: [],
  spacer: [],
  progress: ["value", "max", "label"],
  icon: [],
  qr: ["value"],
  repeat: ["emptyText"],
  block: [],
  html: ["html"],
  header: [],
  "locale-switch": [],
  // Also: `actors[].label` and `steps[].caption` (arrays of objects; rendered by SceneNode with renderTemplate).
  scene: [],
  // Also: `apps[].label` is plain text (not a template).
  apps: [],
};

export const MOBILE_BREAKPOINT = 640;
