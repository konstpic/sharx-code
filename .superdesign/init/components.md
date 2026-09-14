# SharX Panel — Shared UI Components

**Framework/library**: No shadcn/ui, no Radix. Every primitive below is a hand-rolled component in
`panel/components/ui/`, styled with Tailwind utility classes plus CSS custom properties (design tokens)
defined in `panel/app/globals.css`. Motion (hover/press/enter animation) comes from `framer-motion`.
Icons are `lucide-react`. i18n via `react-i18next` (`useTranslation()` / `t()`).

All components are re-exported from `panel/components/ui/index.ts`-style barrel imports as
`import { Button, Input, ... } from "@/components/ui"` throughout the app (see `components/ui/*` files
directly — no single barrel file was found; pages import many at once from `"@/components/ui"`, so an
index module exists but wasn't opened — treat individual files below as the source of truth).

Design-token classes referenced throughout (defined in `globals.css`, see `theme.md`):
`--bg`, `--bg-elevated`, `--surface`, `--surface-strong`, `--border`, `--border-strong`, `--fg`,
`--fg-muted`, `--fg-subtle`, `--accent`, `--accent-ambient`, `--code-bg`, `--motion-fast/base/slow`,
`--ease-standard`.

---

## `panel/components/ui/button.tsx` — `Button`
Primary interactive control. Variants: `primary` (gradient CTA, uses `.panel-btn-primary`), `secondary`
(bordered surface), `ghost` (text-only, hover surface), `danger` (red text), `link` (accent text, no
padding). Supports `loading` (spinner + auto-disable).

Props: `variant?: "primary"|"secondary"|"ghost"|"danger"|"link"`, `loading?: boolean`, plus all native
`<button>` attrs.

```tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";

const variants: Record<ButtonVariant, string> = {
  primary:
    "panel-btn-primary shadow-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--surface-strong)] active:scale-[0.99]",
  ghost:
    "text-[var(--fg-muted)] hover:bg-[var(--surface)] hover:text-[var(--fg)] active:scale-[0.99]",
  danger: "text-red-400 hover:bg-red-500/10 active:scale-[0.99]",
  link: "text-[var(--accent)] hover:underline p-0 h-auto",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className = "", variant = "secondary", type, loading, disabled, children, ...rest },
    ref,
  ) => {
    const v = variants[variant];
    const base =
      "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-[background,color,border-color,opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none";
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={`${base} ${v} ${className}`}
        disabled={disabled || loading}
        {...rest}
      >
        {loading ? (
          <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
```

---

## `panel/components/ui/input.tsx` — `Input`
Text input. `inputSize?: "md"|"lg"`.

```tsx
import { forwardRef, type InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  inputSize?: "md" | "lg";
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", inputSize = "md", ...rest }, ref) => {
    const h = inputSize === "lg" ? "h-11 px-4 text-base" : "h-10 px-3 text-sm";
    return (
      <input
        ref={ref}
        className={`w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg)] placeholder:text-[var(--fg-subtle)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] ${h} ${className}`}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";
```

---

## `panel/components/ui/textarea.tsx` — `Textarea`
Multiline text input, resizable vertically.

```tsx
import { forwardRef, type TextareaHTMLAttributes } from "react";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = "", ...rest }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`min-h-[88px] w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] ${className}`}
        {...rest}
      />
    );
  },
);
Textarea.displayName = "Textarea";
```

---

## `panel/components/ui/select-native.tsx` — `SelectNative`
Styled native `<select>` with a custom chevron background-image (SVG data URI). `inputSize?: "sm"|"md"|"lg"`.

```tsx
import { forwardRef, type SelectHTMLAttributes } from "react";

const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export const SelectNative = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { inputSize?: "sm" | "md" | "lg" }
>(({ className = "", inputSize = "md", style, children, ...rest }, ref) => {
  const h =
    inputSize === "lg"
      ? "h-11 px-3 text-base"
      : inputSize === "sm"
        ? "h-8 px-2.5 text-xs"
        : "h-10 px-3 text-sm";
  const chevronPad = inputSize === "sm" ? "pr-8" : inputSize === "lg" ? "pr-10" : "pr-9";
  const bgPos =
    inputSize === "sm"
      ? "bg-[position:right_0.45rem_center] bg-[length:1rem_1rem]"
      : "bg-[position:right_0.65rem_center] bg-[length:1.125rem_1.125rem]";
  return (
    <select
      ref={ref}
      style={{ backgroundImage: SELECT_CHEVRON, ...style }}
      className={`w-full min-w-0 cursor-pointer appearance-none rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm outline-none transition-colors focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 ${bgPos} bg-no-repeat ${chevronPad} ${h} ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
});
SelectNative.displayName = "SelectNative";
```

---

## `panel/components/ui/checkbox-field.tsx` — `Checkbox`, `CheckboxField`
Custom checkbox visuals (sr-only real `<input type="checkbox">` + styled `<span>` box with a Lucide
`Check` icon that fades in). `Checkbox` is standalone; `CheckboxField` pairs it with a label.
Also exports `checkboxControlClass` (the box styling) and `preventLabelFocusScroll` helper (used by
other checkbox/radio components to stop click-to-scroll jank).

Props (`CheckboxField`): `label: ReactNode`, `align?: "center"|"start"`, plus native input attrs.

```tsx
import { Check } from "lucide-react";
import {
  forwardRef, useId,
  type InputHTMLAttributes, type MouseEvent, type ReactNode,
} from "react";

function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

function preventLabelFocusScroll(e: MouseEvent<HTMLLabelElement>) {
  if (e.button === 0) e.preventDefault();
}
export { preventLabelFocusScroll };

export const checkboxControlClass =
  "flex size-[1.125rem] shrink-0 items-center justify-center rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-sm transition-all peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] text-[var(--accent-fg,#0d1117)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--bg)] peer-disabled:cursor-not-allowed peer-disabled:opacity-50";

const CheckboxInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function CheckboxInput(props, ref) {
    return (
      <>
        <input ref={ref} type="checkbox" className="peer sr-only" {...props} />
        <span className={checkboxControlClass} aria-hidden>
          <Check className="size-3 opacity-0 transition-opacity peer-checked:opacity-100" strokeWidth={2.75} />
        </span>
      </>
    );
  },
);

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { className?: string };

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className = "", ...rest }, ref,
) {
  return (
    <label
      onMouseDown={preventLabelFocusScroll}
      className={cx("relative inline-flex shrink-0 cursor-pointer items-center", rest.disabled && "cursor-not-allowed", className)}
    >
      <CheckboxInput ref={ref} {...rest} />
    </label>
  );
});

type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  label: ReactNode; className?: string; align?: "center" | "start";
};

export function CheckboxField({ label, className = "", id, align = "center", ...rest }: CheckboxFieldProps) {
  const autoId = useId();
  const cid = id ?? autoId;
  return (
    <label
      htmlFor={cid}
      onMouseDown={preventLabelFocusScroll}
      className={cx(
        "relative flex cursor-pointer gap-2.5 text-sm text-[var(--fg-muted)]",
        align === "start" ? "items-start" : "items-center",
        rest.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <CheckboxInput id={cid} {...rest} />
      <span className={cx("min-w-0 flex-1 leading-snug", align === "start" && "pt-0.5")}>{label}</span>
    </label>
  );
}
```

---

## `panel/components/ui/checkbox-option.tsx` — `CheckboxOptionCard`, `RadioOptionCard`, `CheckboxOptionList`, `SelectionListToolbar`
Full-width selectable "card row" variants of checkbox/radio, used for multi-select lists (nodes,
inbounds, profiles). `CheckboxOptionCard`/`RadioOptionCard` show heading + optional description +
optional `IconTile`. `CheckboxOptionList` wraps a scrollable stack/grid of option cards with an
optional header toolbar. `SelectionListToolbar` renders a "N / M selected" bar with Select All / Select
None links.

Key props: `heading`, `description?`, `icon?: LucideIcon`, `iconTone?`, native checkbox/radio attrs;
`RadioOptionCard` additionally requires `name`.

```tsx
"use client";

import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { preventLabelFocusScroll } from "@/components/ui/checkbox-field";

function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const optionBoxClass =
  "flex size-[1.125rem] shrink-0 items-center justify-center rounded-[6px] border shadow-sm transition-all border-[var(--border-strong)] bg-[var(--bg-elevated)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--bg)] peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:[&_svg]:opacity-100 text-[var(--accent-fg,#0d1117)]";

type CheckboxOptionCardProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "title"> & {
  heading: ReactNode; description?: ReactNode; icon?: LucideIcon; iconTone?: IconTileTone; className?: string;
};

export function CheckboxOptionCard({
  heading, description, icon: Icon, iconTone = "accent", className = "", id, checked, disabled, ...rest
}: CheckboxOptionCardProps) {
  const autoId = useId();
  const cid = id ?? autoId;
  const active = Boolean(checked);
  return (
    <label
      htmlFor={cid}
      onMouseDown={preventLabelFocusScroll}
      className={cx(
        "relative flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_11%,transparent)] shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent)_22%,transparent)]"
          : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[color-mix(in_oklab,var(--accent)_28%,var(--border))] hover:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]",
        disabled && "cursor-not-allowed opacity-55 hover:border-[var(--border)] hover:bg-[var(--bg-elevated)]",
        className,
      )}
    >
      <input {...rest} id={cid} type="checkbox" checked={checked} disabled={disabled} className="peer sr-only" />
      <span className={optionBoxClass} aria-hidden>
        <Check className="size-3 opacity-0 transition-opacity" strokeWidth={2.75} />
      </span>
      {Icon ? <IconTile icon={Icon} tone={active ? iconTone : "neutral"} size="sm" className="mt-0.5" /> : null}
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="block text-sm font-medium leading-snug text-[var(--fg)]">{heading}</span>
        {description != null ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--fg-muted)]">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

type RadioOptionCardProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "title"> & {
  heading: ReactNode; description?: ReactNode; name: string; className?: string;
};

export function RadioOptionCard({
  heading, description, className = "", id, checked, disabled, name, ...rest
}: RadioOptionCardProps) {
  const autoId = useId();
  const cid = id ?? autoId;
  const active = Boolean(checked);
  return (
    <label
      htmlFor={cid}
      onMouseDown={preventLabelFocusScroll}
      className={cx(
        "relative flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_11%,transparent)] shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent)_22%,transparent)]"
          : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[color-mix(in_oklab,var(--accent)_28%,var(--border))] hover:bg-[color-mix(in_oklab,var(--fg)_5%,transparent)]",
        disabled && "cursor-not-allowed opacity-55",
        className,
      )}
    >
      <input {...rest} id={cid} type="radio" name={name} checked={checked} disabled={disabled} className="peer sr-only" />
      <span
        className={cx(
          "mt-0.5 flex size-[1.125rem] shrink-0 items-center justify-center rounded-full border shadow-sm transition-all",
          "border-[var(--border-strong)] bg-[var(--bg-elevated)]",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--bg)]",
          "peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)]",
        )}
        aria-hidden
      >
        <span className="size-2 rounded-full bg-[var(--accent-fg,#0d1117)] opacity-0 transition-opacity peer-checked:opacity-100" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug text-[var(--fg)]">{heading}</span>
        {description != null ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--fg-muted)]">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

type CheckboxOptionListProps = {
  children: ReactNode; layout?: "stack" | "grid"; className?: string; header?: ReactNode;
};

export function CheckboxOptionList({ children, layout = "stack", className = "", header }: CheckboxOptionListProps) {
  return (
    <div className={cx("space-y-2", className)}>
      {header}
      <div
        className={
          layout === "grid"
            ? "grid max-h-[min(50vh,20rem)] gap-2 overflow-y-auto sm:grid-cols-2"
            : "flex max-h-[min(50vh,20rem)] flex-col gap-2 overflow-y-auto pr-0.5"
        }
      >
        {children}
      </div>
    </div>
  );
}

type SelectionListToolbarProps = {
  selectedCount: number; totalCount: number; onSelectAll: () => void; onSelectNone: () => void;
  selectAllLabel: string; selectNoneLabel: string; countLabel?: string;
};

export function SelectionListToolbar({
  selectedCount, totalCount, onSelectAll, onSelectNone, selectAllLabel, selectNoneLabel, countLabel,
}: SelectionListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--fg)_4%,transparent)] px-3 py-2">
      {countLabel != null ? (
        <span className="text-xs text-[var(--fg-muted)]">{countLabel}</span>
      ) : (
        <span className="text-xs tabular-nums text-[var(--fg-muted)]">{selectedCount} / {totalCount}</span>
      )}
      <div className="flex gap-2">
        <button type="button" className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-40"
          disabled={totalCount === 0 || selectedCount >= totalCount} onClick={onSelectAll}>{selectAllLabel}</button>
        <span className="text-[var(--border)]" aria-hidden>·</span>
        <button type="button" className="text-xs font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:underline disabled:opacity-40"
          disabled={selectedCount === 0} onClick={onSelectNone}>{selectNoneLabel}</button>
      </div>
    </div>
  );
}
```

---

## `panel/components/ui/switch.tsx` — `Switch`
Animated toggle switch (framer-motion spring dot). Props: `checked`, `onChange(next)`, `size?: "sm"|"md"`,
`disabled?`, `ariaLabel?`.

```tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";

type SwitchProps = {
  checked: boolean; onChange: (next: boolean) => void; size?: "sm" | "md";
  disabled?: boolean; ariaLabel?: string; className?: string;
};

export function Switch({ checked, onChange, size = "md", disabled, ariaLabel, className = "" }: SwitchProps) {
  const reduce = useReducedMotion();
  const trackW = size === "sm" ? "w-8" : "w-10";
  const trackH = size === "sm" ? "h-[18px]" : "h-[22px]";
  const dotSz = size === "sm" ? "size-[14px]" : "size-[18px]";
  const x = size === "sm" ? 14 : 18;
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${trackW} ${trackH} ${
        checked
          ? "border-[color-mix(in_oklab,var(--accent)_40%,transparent)] bg-[color-mix(in_oklab,var(--accent)_32%,transparent)]"
          : "border-[var(--border)] bg-[var(--bg-elevated)]"
      } ${className}`}
    >
      <motion.span
        className={`absolute left-[2px] top-1/2 -translate-y-1/2 rounded-full bg-[var(--fg)] shadow ${dotSz} ${checked ? "bg-[var(--fg)]" : "bg-[var(--fg-muted)]"}`}
        animate={{ x: checked ? x : 0 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 32 }}
        aria-hidden
      />
    </button>
  );
}
```

---

## `panel/components/ui/tabs.tsx` — `Tabs`, `TabPanels`
`Tabs`: pill or underline style tab strip with a framer-motion `layoutId`-animated active indicator.
Supports icons, badges, icon-only mode. `TabPanels`: `AnimatePresence`-wrapped content switcher (used with
`tabContentVariants` from `@/lib/motion`).

Props (`Tabs`): `tabs: TabItem[]`, `active`, `onChange`, `layoutId?`, `size?: "sm"|"md"`,
`variant?: "pill"|"underline"`, `iconOnly?`.

```tsx
"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { tabContentVariants } from "@/lib/motion";

export type TabItem<T extends string = string> = {
  id: T; label: ReactNode; title?: string; icon?: LucideIcon; badge?: ReactNode; disabled?: boolean;
};

type TabsProps<T extends string = string> = {
  tabs: TabItem<T>[]; active: T; onChange: (id: T) => void; layoutId?: string;
  className?: string; size?: "sm" | "md"; variant?: "pill" | "underline"; iconOnly?: boolean;
};

export function Tabs<T extends string = string>({
  tabs, active, onChange, layoutId = "panel-tab-underline", className = "",
  size = "md", variant = "pill", iconOnly = false,
}: TabsProps<T>) {
  const reduce = useReducedMotion();
  const heightCls = size === "sm" ? "h-8 text-[13px]" : "h-10 text-sm";
  const tabTitle = (label: ReactNode, tTitle: string | undefined) => {
    if (tTitle) return tTitle;
    if (typeof label === "string" || typeof label === "number") return String(label);
    return undefined;
  };
  return (
    <div role="tablist" className={`relative inline-flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 ${className}`}>
      {tabs.map((t) => {
        const isActive = t.id === active;
        const Icon = t.icon;
        const tip = tabTitle(t.label, t.title);
        return (
          <button
            key={t.id} role="tab" type="button" aria-selected={isActive} disabled={t.disabled}
            title={iconOnly ? tip : t.title} aria-label={iconOnly && tip ? tip : undefined}
            onClick={() => !t.disabled && onChange(t.id)}
            className={`relative inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 ${heightCls} ${
              iconOnly ? "size-8 justify-center p-0 px-0" : "px-3"
            } ${isActive ? "text-[var(--fg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
          >
            {isActive ? (
              <motion.span
                layoutId={layoutId}
                className={
                  variant === "pill"
                    ? "absolute inset-0 rounded-lg border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "absolute inset-x-2 -bottom-[5px] h-[2px] rounded-full bg-[var(--accent)]"
                }
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
                aria-hidden
              />
            ) : null}
            <span className="relative z-[1] inline-flex items-center justify-center gap-1.5">
              {Icon ? <Icon className="size-[15px] shrink-0 opacity-85" /> : null}
              {iconOnly ? null : <span className="truncate">{t.label}</span>}
              {t.badge != null ? (
                <span className="ml-0.5 inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 py-[1px] text-[10px] font-semibold text-[var(--fg-muted)]">{t.badge}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type TabPanelsProps = { value: string; children: ReactNode; className?: string };

export function TabPanels({ value, children, className = "" }: TabPanelsProps) {
  return (
    <div className={className}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={value} variants={tabContentVariants} initial="hidden" animate="visible" exit="exit">
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
```

---

## `panel/components/ui/modal.tsx` — `Modal`
Centered dialog (portal to `document.body`), backdrop blur, framer-motion spring entrance, optional
title/footer/close button, Escape-to-close, body-scroll-lock (both opt-out via `closeOnEscape`/
`lockBodyScroll` for stacked modals).

Props: `open`, `onClose`, `title?`, `children`, `footer?`, `width?`, `dialogClassName?`, `bodyClassName?`,
`portalClassName?`, `closeOnEscape?`, `lockBodyScroll?`, `closable?`.

```tsx
"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

type ModalProps = {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode;
  width?: number | string; dialogClassName?: string; bodyClassName?: string; portalClassName?: string;
  closeOnEscape?: boolean; lockBodyScroll?: boolean; closable?: boolean;
};

export function Modal({
  open, onClose, title, children, footer, width = 640, dialogClassName, bodyClassName,
  portalClassName, closeOnEscape = true, lockBodyScroll = true, closable = true,
}: ModalProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, closeOnEscape]);

  useEffect(() => {
    if (!lockBodyScroll) return;
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open, lockBodyScroll]);

  if (typeof document === "undefined") return null;
  const w = typeof width === "number" ? `${width}px` : width;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className={`fixed inset-0 z-[90] flex items-center justify-center p-4 ${portalClassName ?? ""}`}>
          <motion.button
            type="button" className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" aria-label={t("close")}
            onClick={onClose}
            initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            role="dialog" onClick={(e) => e.stopPropagation()}
            className={`relative z-10 flex max-h-[min(90vh,900px)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl ${dialogClassName ?? ""}`}
            style={{ maxWidth: w }}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            {(title != null || closable) && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
                <div className="min-w-0 text-lg font-semibold text-[var(--fg)]">{title}</div>
                {closable ? (
                  <Button variant="ghost" className="!p-2" onClick={onClose} aria-label={t("close")}>
                    <X size={18} />
                  </Button>
                ) : null}
              </div>
            )}
            <div data-modal-scroll className={`min-h-0 flex-1 overflow-y-auto p-5 text-[var(--fg)] ${bodyClassName ?? ""}`}>
              {children}
            </div>
            {footer != null && (
              <div className="shrink-0 border-t border-[var(--border)] px-5 py-4">{footer}</div>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
```

---

## `panel/components/ui/drawer.tsx` — `Drawer`
Right-side sliding panel (portal), same API shape as `Modal` (`open`, `onClose`, `title?`, `footer?`,
`width?`, escape/scroll-lock options). Uses `x: "100%"` slide-in spring transition.

```tsx
"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

type DrawerProps = {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode;
  width?: number | string; portalClassName?: string; closeOnEscape?: boolean; lockBodyScroll?: boolean;
  closable?: boolean;
};

export function Drawer({
  open, onClose, title, children, footer, width = 520, portalClassName,
  closeOnEscape = true, lockBodyScroll = true, closable = true,
}: DrawerProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, closeOnEscape]);

  useEffect(() => {
    if (!lockBodyScroll) return;
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open, lockBodyScroll]);

  if (typeof document === "undefined") return null;
  const w = typeof width === "number" ? `${width}px` : width;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className={`fixed inset-0 z-[95] ${portalClassName ?? ""}`}>
          <motion.button
            type="button" className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" aria-label={t("close")}
            onClick={onClose}
            initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex max-h-[100dvh] w-full flex-col overflow-hidden border-l border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
            style={{ maxWidth: w }}
            initial={reduceMotion ? false : { x: "100%" }} animate={{ x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            {(title != null || closable) && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
                <div className="min-w-0 text-lg font-semibold text-[var(--fg)]">{title}</div>
                {closable ? (
                  <Button variant="ghost" className="!p-2" onClick={onClose} aria-label={t("close")}>
                    <X size={18} />
                  </Button>
                ) : null}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[var(--fg)]">{children}</div>
            {footer != null && (
              <div className="shrink-0 border-t border-[var(--border)] px-5 py-4">{footer}</div>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
```

---

## `panel/components/ui/confirm-dialog.tsx` — `ConfirmDialog`
Thin wrapper around `Modal` for destructive/confirm actions (delete, restart, etc). Props:
`open`, `title`, `description?`, `confirmLabel`, `cancelLabel`, `onConfirm`, `onCancel`, `danger?`,
`loading?`.

```tsx
"use client";

import { Modal } from "./modal";
import { Button } from "./button";

type ConfirmDialogProps = {
  open: boolean; title: string; description?: string; confirmLabel: string; cancelLabel: string;
  onConfirm: () => void | Promise<void>; onCancel: () => void; danger?: boolean; loading?: boolean;
};

export function ConfirmDialog({
  open, title, description, confirmLabel, cancelLabel, onConfirm, onCancel, danger, loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open} onClose={onCancel} title={title} width={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button
            variant={danger ? "primary" : "primary"}
            className={danger ? "!bg-red-600 hover:!bg-red-500" : ""}
            loading={loading} onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {description != null && <p className="text-sm text-[var(--fg-muted)]">{description}</p>}
    </Modal>
  );
}
```

---

## `panel/components/ui/collapsible.tsx` — `Collapsible`
Animates `height: 0 -> auto` via framer-motion. Props: `open`, `children`, `durationMs?`.

```tsx
"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

type CollapsibleProps = { open: boolean; children: ReactNode; className?: string; durationMs?: number };

export function Collapsible({ open, children, className = "", durationMs = 240 }: CollapsibleProps) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          className={`overflow-hidden ${className}`}
          initial={reduce ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: durationMs / 1000, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
```

---

## `panel/components/ui/segmented.tsx` — `Segmented`
Radio-group segmented control (framer-motion `layoutId` active pill), similar visual language to `Tabs`
but for value selection rather than navigation. Props: `items: SegmentedItem[]`, `value`, `onChange`,
`size?`, `layoutId?`, `fullWidth?`.

```tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type SegmentedItem<T extends string = string> = {
  id: T; label: ReactNode; icon?: LucideIcon; hint?: string; disabled?: boolean;
};

type SegmentedProps<T extends string = string> = {
  items: SegmentedItem<T>[]; value: T; onChange: (id: T) => void; size?: "sm" | "md";
  className?: string; layoutId?: string; fullWidth?: boolean;
};

export function Segmented<T extends string = string>({
  items, value, onChange, size = "md", className = "", layoutId = "segmented-active", fullWidth = false,
}: SegmentedProps<T>) {
  const reduce = useReducedMotion();
  const h = size === "sm" ? "h-8 text-[12px]" : "h-10 text-sm";
  return (
    <div role="radiogroup" className={`relative inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1 ${fullWidth ? "w-full" : ""} ${className}`}>
      {items.map((it) => {
        const selected = it.id === value;
        const Icon = it.icon;
        return (
          <button
            key={it.id} role="radio" aria-checked={selected} type="button" disabled={it.disabled}
            onClick={() => !it.disabled && onChange(it.id)} title={it.hint}
            className={`relative inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 font-medium transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 ${h} ${fullWidth ? "flex-1" : ""} ${selected ? "text-[var(--fg)]" : "text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
                aria-hidden
              />
            ) : null}
            <span className="relative z-[1] inline-flex items-center gap-1.5">
              {Icon ? <Icon className="size-[15px] shrink-0" /> : null}
              <span className="truncate">{it.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

---

## `panel/components/ui/pill-tag.tsx` — `PillTag`
Small rounded status pill. Reuses global `.status-pill` / `.status-pill--{tone}` classes. Props:
`tone?: "green"|"blue"|"neutral"|"amber"|"rose"`.

```tsx
import type { ReactNode } from "react";

type PillTone = "green" | "blue" | "neutral" | "amber" | "rose";

const tones: Record<PillTone, string> = {
  green: "status-pill status-pill--green",
  blue: "status-pill status-pill--blue",
  neutral: "status-pill status-pill--neutral",
  amber: "status-pill status-pill--amber",
  rose: "status-pill status-pill--rose",
};

export function PillTag({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: PillTone; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
```

---

## `panel/components/ui/icon-button.tsx` — `IconButton`
Icon-only button with a portaled hover/focus tooltip (positioned via `getBoundingClientRect`), since
native `title`/`disabled` don't play well with tooltips. Props: `label` (required — used as
`aria-label`/tooltip text), `disabled?` (uses `aria-disabled`, not native `disabled`, so hover still
works).

```tsx
"use client";

import type { ButtonHTMLAttributes, FocusEvent, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  children: ReactNode; label: string; disabled?: boolean;
};

function tipPosition(el: HTMLButtonElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.bottom + 8 };
}

export function IconButton({
  children, className = "", label, type = "button", disabled = false,
  onClick, onMouseEnter, onMouseLeave, onFocus, onBlur, id, ...rest
}: IconButtonProps) {
  const isDisabled = Boolean(disabled);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const [xy, setXy] = useState({ x: 0, y: 0 });

  const updatePos = useCallback(() => { if (!btnRef.current) return; setXy(tipPosition(btnRef.current)); }, []);
  const show = useCallback(() => { updatePos(); setOpen(true); }, [updatePos]);
  const hide = useCallback(() => { setOpen(false); }, []);

  useEffect(() => {
    if (!open) return;
    const h = () => { hide(); };
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    return () => { window.removeEventListener("scroll", h, true); window.removeEventListener("resize", h); };
  }, [open, hide]);

  return (
    <>
      <button
        ref={btnRef} type={type} id={id} {...rest} title={label} aria-label={label} aria-disabled={isDisabled}
        aria-describedby={open ? tipId : undefined} tabIndex={isDisabled ? -1 : undefined}
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          if (isDisabled) { e.preventDefault(); e.stopPropagation(); return; }
          onClick?.(e);
        }}
        onMouseEnter={(e) => { onMouseEnter?.(e); show(); }}
        onMouseLeave={(e) => { onMouseLeave?.(e); hide(); }}
        onFocus={(e: FocusEvent<HTMLButtonElement>) => { onFocus?.(e); if (!isDisabled) show(); }}
        onBlur={(e) => { onBlur?.(e); hide(); }}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--fg-muted)] transition-colors ${
          isDisabled ? "cursor-not-allowed opacity-50" : "hover:bg-[var(--surface)] hover:text-[var(--fg)]"
        } ${className}`}
      >
        {children}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div id={tipId} role="tooltip"
              className="pointer-events-none fixed z-[10000] w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-[var(--fg)] shadow-lg [text-wrap:balance]"
              style={{ left: xy.x, top: xy.y, transform: "translateX(-50%)" }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
```

---

## `panel/components/ui/icon-tile.tsx` — `IconTile`
Colored rounded square holding a Lucide icon; tone drives background/border/icon color via
`.icon-tile--{tone}` global classes. Props: `icon: LucideIcon`, `tone: "accent"|"info"|"success"|
"warning"|"danger"|"neutral"`, `size?: "sm"|"md"|"lg"`.

```tsx
import type { LucideIcon } from "lucide-react";

export type IconTileTone = "accent" | "info" | "success" | "warning" | "danger" | "neutral";

type IconTileProps = {
  icon: LucideIcon; tone: IconTileTone; size?: "sm" | "md" | "lg"; className?: string;
  "aria-hidden"?: boolean; "aria-label"?: string; title?: string;
};

const sizeClass: Record<NonNullable<IconTileProps["size"]>, string> = {
  sm: "size-8 [&_svg]:size-3.5",
  md: "size-11 [&_svg]:size-5",
  lg: "size-14 [&_svg]:size-7",
};

export function IconTile({
  icon: Icon, tone, size = "md", className = "",
  "aria-hidden": ariaHidden = true, "aria-label": ariaLabel, title,
}: IconTileProps) {
  return (
    <span
      className={`icon-tile icon-tile--${tone} inline-flex shrink-0 items-center justify-center rounded-xl ${sizeClass[size]} ${className}`}
      aria-hidden={ariaHidden} aria-label={ariaLabel} title={title}
    >
      <Icon strokeWidth={1.65} />
    </span>
  );
}
```

---

## `panel/components/ui/alert-banner.tsx` — `AlertBanner`
Inline alert box. Props: `type?: "error"|"warning"|"info"`, `title`, `description?`, `onClose?`.

```tsx
import type { ReactNode } from "react";

type AlertBannerProps = {
  type?: "error" | "warning" | "info"; title: ReactNode; description?: ReactNode; onClose?: () => void; className?: string;
};

const styles: Record<NonNullable<AlertBannerProps["type"]>, string> = {
  error: "border-red-500/30 bg-red-500/10 text-red-100",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  info: "border-[var(--border)] bg-[var(--surface)] text-[var(--fg)]",
};

export function AlertBanner({ type = "error", title, description, onClose, className = "" }: AlertBannerProps) {
  return (
    <div className={`rounded-xl border p-4 ${styles[type]} ${className}`} role="alert">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          {description != null && <div className="mt-1 text-sm opacity-90">{description}</div>}
        </div>
        {onClose != null && (
          <button type="button" className="shrink-0 rounded-lg px-2 py-1 text-sm opacity-80 hover:opacity-100" onClick={onClose}>×</button>
        )}
      </div>
    </div>
  );
}
```

---

## `panel/components/ui/linear-progress.tsx` — `LinearProgress`
Thin progress bar. Props: `percent: number` (0-100), `strokeColor: string`.

```tsx
type LinearProgressProps = { percent: number; strokeColor: string; className?: string };

export function LinearProgress({ percent, strokeColor, className = "" }: LinearProgressProps) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-[var(--surface)] ${className}`}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${p}%`, background: strokeColor }} />
    </div>
  );
}
```

---

## `panel/components/ui/skeleton.tsx` — `Skeleton`
Shimmering loading placeholder (`.panel-skeleton` global animation). Props: `rounded?: "sm"|"md"|"lg"|
"xl"|"full"`.

```tsx
type SkeletonProps = { className?: string; rounded?: "sm" | "md" | "lg" | "xl" | "full" };

const roundedCls: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
  sm: "rounded-md", md: "rounded-lg", lg: "rounded-xl", xl: "rounded-2xl", full: "rounded-full",
};

export function Skeleton({ className = "", rounded = "md" }: SkeletonProps) {
  return <span aria-hidden className={`inline-block bg-[var(--surface)] ${roundedCls[rounded]} panel-skeleton ${className}`} />;
}
```

---

## `panel/components/ui/spinner.tsx` — `Spinner`
Lucide `Loader2` spin loader. Props: `size?: number` (default 32).

```tsx
import { Loader2 } from "lucide-react";

type SpinnerProps = { className?: string; size?: number };

export function Spinner({ className = "", size = 32 }: SpinnerProps) {
  return <Loader2 size={size} className={`animate-spin text-[var(--accent)] ${className}`} aria-label="Loading" />;
}
```

---

## `panel/components/ui/stat-block.tsx` — `StatBlock`
Small labeled statistic (title + value, optional prefix/suffix). Used on dashboard/statistics pages.

```tsx
import type { ReactNode } from "react";

type StatBlockProps = { title: string; value: ReactNode; prefix?: ReactNode; suffix?: ReactNode };

export function StatBlock({ title, value, prefix, suffix }: StatBlockProps) {
  return (
    <div>
      <div className="text-xs text-[var(--fg-subtle)]">{title}</div>
      <div className="mt-0.5 flex items-baseline gap-1 text-lg font-semibold tabular-nums text-[var(--fg)]">
        {prefix}<span>{value}</span>{suffix}
      </div>
    </div>
  );
}
```

---

## `panel/components/ui/stepper.tsx` — `Stepper`
Horizontal multi-step progress indicator with animated dots (done/current/pending/error states),
mobile "Step N / M" summary, optional icons-only variant, and clickable steps (`allowJump`). Used in the
node-registration flow (`NodeRegisterStep`) and the Xray simple-core wizard.

```tsx
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type StepState = "pending" | "current" | "done" | "error";

export type StepperItem = { id: string; label: string; description?: string; icon?: LucideIcon; state?: StepState };

type StepperProps = {
  steps: StepperItem[]; activeId: string; onSelect?: (id: string) => void; className?: string;
  allowJump?: boolean; variant?: "default" | "iconsOnly";
};

function stateOf(item: StepperItem, idx: number, activeIdx: number): StepState {
  if (item.state) return item.state;
  if (idx < activeIdx) return "done";
  if (idx === activeIdx) return "current";
  return "pending";
}

function stepTooltipText(s: StepperItem | undefined): string | undefined {
  if (s == null) return undefined;
  const d = s.description?.trim();
  if (d) return `${s.label} — ${d}`;
  return s.label;
}

const dotClass: Record<StepState, string> = {
  pending: "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)]",
  current: "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_12%,transparent)]",
  done: "border-emerald-400/60 bg-emerald-500/15 text-emerald-200",
  error: "border-red-400/70 bg-red-500/15 text-red-300",
};

const labelClass: Record<StepState, string> = {
  pending: "text-[var(--fg-muted)]", current: "text-[var(--fg)]", done: "text-[var(--fg)]", error: "text-red-300",
};

export function Stepper({ steps, activeId, onSelect, className = "", allowJump = false, variant = "default" }: StepperProps) {
  const reduce = useReducedMotion();
  const activeIdx = Math.max(0, steps.findIndex((s) => s.id === activeId));
  const iconsOnly = variant === "iconsOnly";
  const tooltip = (s: StepperItem | undefined) => stepTooltipText(s);

  return (
    <div className={`relative ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--fg-muted)] md:hidden"
        title={iconsOnly ? tooltip(steps[activeIdx]) : undefined}>
        <span className="truncate font-medium text-[var(--fg)]" title={!iconsOnly ? tooltip(steps[activeIdx]) : undefined}>
          {iconsOnly ? `Step ${activeIdx + 1}` : steps[activeIdx]?.label}
        </span>
        <span className="tabular-nums text-[var(--fg-muted)]">{activeIdx + 1} / {steps.length}</span>
      </div>

      <ol className={`hidden items-start gap-1 md:flex ${iconsOnly ? "md:justify-center" : ""}`}>
        {steps.map((s, idx) => {
          const st = stateOf(s, idx, activeIdx);
          const Icon = s.icon;
          const clickable = onSelect != null && !s.state && (allowJump || st === "done" || st === "current");
          const last = idx === steps.length - 1;
          return (
            <li key={s.id} className={`group flex min-w-0 items-start ${iconsOnly ? "flex-none" : "flex-1"}`}>
              <button type="button" title={tooltip(s)} aria-label={tooltip(s)}
                onClick={clickable ? () => onSelect?.(s.id) : undefined} disabled={!clickable}
                className={`flex min-w-0 items-start gap-2.5 rounded-xl p-1.5 text-left transition-colors ${
                  iconsOnly ? "flex-none flex-col items-center" : "flex-1"
                } ${clickable ? "hover:bg-[var(--surface)]" : "cursor-default"}`}
              >
                <span className="relative inline-flex shrink-0 flex-col items-center">
                  <motion.span
                    className={`inline-flex size-8 items-center justify-center rounded-full border text-[13px] font-semibold transition-colors ${dotClass[st]}`}
                    initial={reduce ? false : { scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 480, damping: 30 }}
                  >
                    {st === "done" ? <Check className="size-4" strokeWidth={2.4} /> : Icon ? <Icon className="size-4" /> : idx + 1}
                  </motion.span>
                </span>
                {!iconsOnly ? (
                  <div className="min-w-0 pt-1">
                    <div className={`truncate text-sm font-medium ${labelClass[st]}`}>{s.label}</div>
                    {s.description ? (
                      <div className="truncate text-[11px] text-[var(--fg-subtle)]" title={s.description}>{s.description}</div>
                    ) : null}
                  </div>
                ) : null}
              </button>
              {!last ? (
                <div className={`mx-1 h-px flex-1 bg-[var(--border)] ${iconsOnly ? "mt-4 w-6 min-w-[1rem] max-w-10 self-center" : "mt-5"}`} aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

---

## `panel/components/ui/help-tooltip.tsx` — `HelpTooltip`
`CircleHelp` icon trigger that shows either a floating tooltip or a `Modal`, sourced from
`help.<helpKey>` i18n strings; auto-hides if no translation exists. Also exports `HelpKey` (union of all
valid help keys). Props: `helpKey: HelpKey`, `mode?: "tooltip"|"modal"`.

(~180 lines — tooltip positioning + portal logic + modal trigger variant; see
`panel/components/ui/help-tooltip.tsx` for full source, omitted here for length. Key exports:
`HelpTooltip`, `HelpKey` type.)

---

## `panel/components/ui/toast-provider.tsx` — `ToastProvider`, `useToast`
Global toast/snackbar system via React context. `useToast()` returns `{ success, error, info }`
functions. Toasts stack bottom-right, animate in/out with framer-motion, auto-dismiss after 4s.

```tsx
"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastItem = { id: number; type: "success" | "error" | "info"; message: string };
type ToastApi = { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };

const ToastContext = createContext<ToastApi | null>(null);
const DURATION = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((type: ToastItem["type"], message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => { setItems((prev) => prev.filter((x) => x.id !== id)); }, DURATION);
  }, []);
  const value = useMemo<ToastApi>(() => ({
    success: (m) => push("success", m), error: (m) => push("error", m), info: (m) => push("info", m),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex max-w-sm flex-col gap-2 p-0 sm:bottom-6 sm:right-6">
        <AnimatePresence initial={false}>
          {items.map((t) => <Toast key={t.id} item={t} />)}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item }: { item: ToastItem }) {
  const reduce = useReducedMotion();
  const color = item.type === "success" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
    : item.type === "error" ? "border-red-500/40 bg-red-500/10 text-red-100"
    : "border-[var(--border)] bg-[var(--bg-elevated)]/95 text-[var(--fg)]";
  const Icon = item.type === "success" ? CheckCircle2 : item.type === "error" ? AlertTriangle : Info;
  return (
    <motion.div layout className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md ${color}`}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 32, mass: 0.7 }}
    >
      <Icon className="mt-0.5 size-4 shrink-0 opacity-85" aria-hidden />
      <span className="min-w-0 flex-1">{item.message}</span>
    </motion.div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
```

---

## `panel/components/ui/reveal.tsx` — `Reveal`, `Stagger`, `StaggerItem`
Scroll/enter animation helpers built on framer-motion `whileInView`/`variants` from `@/lib/motion`
(`fadeUp`, `listContainer`, `listItem`). `Reveal` fades+rises a block into view; `Stagger`/`StaggerItem`
sequence a list of children. All fall back to plain `<div>` when `prefers-reduced-motion` is set.

```tsx
"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";
import { listContainer, listItem, fadeUp } from "@/lib/motion";

type RevealProps = Omit<HTMLMotionProps<"div">, "children"> & {
  children: ReactNode; delay?: number; as?: "div"; once?: boolean; amount?: number | "some" | "all";
};

export function Reveal({ children, delay = 0, once = true, amount = 0.2, className = "", ...rest }: RevealProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial="hidden" whileInView="visible" viewport={{ once, amount }}
      variants={fadeUp} transition={{ delay }} {...rest}>
      {children}
    </motion.div>
  );
}

type StaggerProps = { children: ReactNode; className?: string; staggerChildren?: number; delayChildren?: number };

export function Stagger({ children, className = "", staggerChildren = 0.05, delayChildren = 0.04 }: StaggerProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial="hidden" animate="visible" variants={{
      hidden: listContainer.hidden,
      visible: { ...listContainer.visible, transition: { staggerChildren, delayChildren } },
    }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return <motion.div className={className} variants={listItem}>{children}</motion.div>;
}
```

---

## Other UI components (not full-source dumped, present in `panel/components/ui/`)
- `MonacoJsonEditor.tsx` (72 lines) — wraps `@monaco-editor/react` for JSON config editing (Xray
  templates, node registration payloads).
