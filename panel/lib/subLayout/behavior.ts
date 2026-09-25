import { evalCondition, type Ctx, type RenderOptions } from "./template";
import type { OnClick, StateRule, Style } from "./types";

/** Client-side page state (`state.<key>` in templates and visibleIf). */
export type PageState = Record<string, boolean | string>;

/**
 * Conditional style overrides: every rule whose expression is truthy is merged over the base style, in order
 * ("merge in order": later rules win). A broken or empty expression never matches (unlike `visibleIf`).
 */
export function applyStates(base: Style, rules: StateRule[] | undefined, scope: Ctx, opts: RenderOptions = {}): { style: Style; matched: number } {
  if (!rules || rules.length === 0) return { style: base, matched: 0 };
  let style = base;
  let matched = 0;
  for (const r of rules) {
    if (!r.when || !r.when.trim()) continue;
    const res = evalCondition(r.when, scope, opts);
    if (res.error || !res.value) continue;
    style = { ...style, ...r.style };
    matched++;
  }
  return { style, matched };
}

/** Value for `set-state`: "" toggles, "true" / "false" are booleans, anything else is text. */
export function nextState(state: PageState, key: string, to: string | undefined): PageState {
  if (!/^[A-Za-z_][\w:-]{0,60}$/.test(key)) return state;
  const cur = state[key];
  let v: boolean | string;
  if (to === undefined || to === "") v = !cur;
  else if (to === "true") v = true;
  else if (to === "false") v = false;
  else v = to;
  return { ...state, [key]: v };
}

export const hideKey = (id: string): string => `hide:${id}`;

/** The state change an action causes (null when the action does not touch state). */
export function stateForAction(state: PageState, oc: OnClick): PageState | null {
  if (oc.action === "toggle" && oc.value) return nextState(state, oc.value.trim(), undefined);
  if (oc.action === "set-state" && oc.value) return nextState(state, oc.value.trim(), oc.to);
  if (oc.action === "toggle-visibility" && oc.value) return nextState(state, hideKey(oc.value.trim()), undefined);
  return null;
}
