"use client";
/** Small form controls of the tile editor (labels via i18n `pages.builder.style.*`, keyboard accessible). */
import { useId, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CheckboxField, Input, Segmented, SelectNative } from "@/components/ui";

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--fg)_2.5%,transparent)] p-3.5">
      <header>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">{title}</h4>
        {hint ? <p className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1.5 text-xs text-[var(--fg-muted)] ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Range slider with a live value and a reset-to-default button (shown only while the value differs). */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  def,
  unit = "",
  auto = false,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Default value; `undefined` means "auto" (reset clears the field). */
  def?: number;
  unit?: string;
  /** The default value means "automatic" and is shown as such. */
  auto?: boolean;
  /** `undefined` = back to the default. */
  onChange: (v: number | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const changed = value !== def;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--fg-muted)]">
        <label htmlFor={id}>{label}</label>
        <span className="flex items-center gap-1.5">
          <output htmlFor={id} className="min-w-10 text-right font-mono text-[11px] tabular-nums text-[var(--fg)]">
            {auto && !changed ? t("pages.builder.style.auto") : `${value}${unit}`}
          </output>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={!changed}
            aria-label={`${t("pages.builder.style.resetField")}: ${label}`}
            title={`${t("pages.builder.style.resetField")}: ${label}`}
            className="grid size-5 place-items-center rounded text-[var(--fg-subtle)] transition hover:text-[var(--fg)] disabled:invisible"
          >
            <RotateCcw size={11} />
          </button>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-5 w-full cursor-pointer accent-[var(--accent)] disabled:opacity-50"
      />
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div>
      <CheckboxField label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {hint ? <p className="ml-7 mt-0.5 text-[11px] text-[var(--fg-subtle)]">{hint}</p> : null}
    </div>
  );
}

/** Segmented radio group for 2-4 short options. */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  const gid = useId();
  return (
    <div className="space-y-1.5" role="group" aria-label={label}>
      <p className="text-xs text-[var(--fg-muted)]">{label}</p>
      <Segmented size="sm" fullWidth items={options} value={value} onChange={onChange} layoutId={`seg-${gid}`} />
    </div>
  );
}

export function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      <SelectNative
        value={String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o.id) === e.target.value);
          if (hit) onChange(hit.id);
        }}
      >
        {options.map((o) => (
          <option key={String(o.id)} value={String(o.id)}>
            {o.label}
          </option>
        ))}
      </SelectNative>
    </Field>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Colour with swatches, a native picker and a hex field. `value === undefined` shows "theme / auto". */
export function ColorField({
  label,
  value,
  onChange,
  swatches,
  fallback = "#38bdf8",
  clearLabel,
}: {
  label: string;
  value: string | undefined;
  /** `undefined` = clear (theme / auto). */
  onChange: (v: string | undefined) => void;
  swatches?: readonly string[];
  /** Colour the native picker opens with when no value is set. */
  fallback?: string;
  clearLabel?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="space-y-1.5" role="group" aria-labelledby={id}>
      <p id={id} className="text-xs text-[var(--fg-muted)]">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={value === undefined}
          onClick={() => onChange(undefined)}
          className={`h-7 rounded-full border px-2.5 text-[11px] transition ${value === undefined ? "border-[var(--accent)] text-[var(--fg)]" : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)]"}`}
        >
          {clearLabel ?? t("pages.builder.style.themeColor")}
        </button>
        {swatches?.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={value?.toLowerCase() === c}
            title={c}
            onClick={() => onChange(c)}
            className={`size-7 rounded-full border-2 transition ${value?.toLowerCase() === c ? "border-[var(--fg)]" : "border-transparent hover:border-[var(--border-strong)]"}`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          aria-label={`${label} (${t("pages.builder.style.picker")})`}
          value={value && HEX.test(value) ? value : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="size-7 cursor-pointer rounded-full border border-[var(--border)] bg-transparent p-0"
        />
        <Input
          aria-label={`${label} (hex)`}
          defaultValue={value ?? ""}
          key={value ?? "none"}
          placeholder="#rrggbb"
          maxLength={7}
          onChange={(e) => {
            if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          className="!h-8 !w-24 !font-mono !text-xs"
        />
      </div>
    </div>
  );
}
