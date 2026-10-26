"use client";

import { useEffect, useRef } from "react";
import { emptyOtp, otpBackspace, otpComplete, otpFromString, otpInsert, otpValue, OTP_LENGTH } from "@/lib/otp";

/**
 * The confirmation code as six separate cells. Digits only; typing moves on, Backspace steps back, arrow keys move, a paste (or an
 * SMS / password-manager autofill into the first cell) fills all of them, and the last digit calls onComplete.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  label,
  autoFocus = true,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const cells = otpFromString(value);

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(otpValue(cells).length, OTP_LENGTH - 1)]?.focus();
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after a wrong code (the cells were emptied while the field was disabled) start again from the first cell
  useEffect(() => {
    if (!disabled && value === "") refs.current[0]?.focus();
  }, [disabled, value]);

  const commit = (next: string[], focus: number) => {
    const code = otpValue(next);
    onChange(code);
    if (focus < OTP_LENGTH) refs.current[focus]?.focus();
    if (otpComplete(next)) onComplete?.(code);
  };

  return (
    <div role="group" aria-label={label} className="flex items-center justify-center gap-1.5 sm:gap-2">
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <span key={i} className="contents">
          {i === OTP_LENGTH / 2 ? <span aria-hidden className="mx-0.5 h-0.5 w-2 rounded bg-[var(--border)]" /> : null}
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={OTP_LENGTH}
            disabled={disabled}
            aria-label={`${label} ${i + 1} / ${OTP_LENGTH}`}
            aria-invalid={invalid || undefined}
            value={cells[i]}
            className={`h-12 w-10 rounded-xl border bg-[var(--bg-elevated)] text-center text-xl font-semibold tabular-nums text-[var(--fg)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 disabled:opacity-60 sm:h-14 sm:w-12 ${
              invalid ? "border-[var(--danger,#e5484d)]" : "border-[var(--border)]"
            }`}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              // two characters = a digit typed into a filled cell (keep the new one); more = an autofill of the whole code
              const raw = e.target.value;
              const r = otpInsert(cells, i, raw.length === 2 ? raw.slice(-1) : raw.slice(-OTP_LENGTH));
              commit(r.cells, r.focus);
            }}
            onPaste={(e) => {
              e.preventDefault();
              const r = otpInsert(emptyOtp(), 0, e.clipboardData.getData("text"));
              commit(r.cells, r.focus);
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace") {
                e.preventDefault();
                const r = otpBackspace(cells, i);
                commit(r.cells, r.focus);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                refs.current[Math.max(0, i - 1)]?.focus();
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                refs.current[Math.min(OTP_LENGTH - 1, i + 1)]?.focus();
              }
            }}
          />
        </span>
      ))}
    </div>
  );
}
