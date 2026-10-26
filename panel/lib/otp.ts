/** Editing rules of the six-cell confirmation code field (the UI in components/login/OtpInput.tsx only wires events to these). */
export const OTP_LENGTH = 6;

export type OtpCells = string[];

export function emptyOtp(): OtpCells {
  return Array.from({ length: OTP_LENGTH }, () => "");
}

export const otpValue = (cells: OtpCells): string => cells.join("");

export function otpFromString(s: string): OtpCells {
  const d = s.replace(/\D/g, "").slice(0, OTP_LENGTH);
  return Array.from({ length: OTP_LENGTH }, (_, i) => d[i] ?? "");
}

/**
 * Typing or pasting `input` into cell `index`: digits only; several digits (a paste, or an SMS / password-manager autofill into
 * one cell) spread over the following cells. `focus` is the cell to focus next (OTP_LENGTH = past the last one).
 */
export function otpInsert(cells: OtpCells, index: number, input: string): { cells: OtpCells; focus: number } {
  const digits = input.replace(/\D/g, "");
  const next = [...cells];
  if (!digits) {
    return { cells: next, focus: index };
  }
  // a single typed digit replaces the cell; more than one starts a paste at this cell
  let at = index;
  for (const d of digits) {
    if (at >= OTP_LENGTH) break;
    next[at] = d;
    at += 1;
  }
  return { cells: next, focus: Math.min(at, OTP_LENGTH - 1) };
}

/** Backspace: clears the cell, or, when it is already empty, steps back and clears the previous one. */
export function otpBackspace(cells: OtpCells, index: number): { cells: OtpCells; focus: number } {
  const next = [...cells];
  if (next[index]) {
    next[index] = "";
    return { cells: next, focus: index };
  }
  const prev = Math.max(0, index - 1);
  next[prev] = "";
  return { cells: next, focus: prev };
}

export const otpComplete = (cells: OtpCells): boolean => cells.every((c) => c !== "");
