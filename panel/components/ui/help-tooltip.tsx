"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "./modal";

// ---------------------------------------------------------------------------
// Help key type — union of all known help.* translation keys.
// Extend this union as new help entries are added to the locale files.
// ---------------------------------------------------------------------------
export type HelpKey =
  // subscription (public sub page)
  | "subscription.expireDate"
  | "subscription.traffic"
  | "subscription.subId"
  | "subscription.status"
  // clients form
  | "clients.remark"
  | "clients.trafficLimit"
  | "clients.expireDate"
  | "clients.trafficResetCadence"
  // nodes form
  | "nodes.address"
  | "nodes.port"
  | "nodes.trafficLimit"
  // settings — general
  | "settings.panelPort"
  | "settings.panelUri"
  // settings — subscription tab
  | "settings.subUri"
  | "settings.subEnable"
  | "settings.subListen"
  | "settings.subProviderId";

type HelpDisplayMode = "tooltip" | "modal";

type HelpTooltipProps = {
  /** Dot-separated key under `help.*` in locale files, e.g. "subscription.expireDate" */
  helpKey: HelpKey;
  /** Tooltip (default) or modal for longer content */
  mode?: HelpDisplayMode;
  /** Extra class on the trigger button */
  className?: string;
};

// ---------------------------------------------------------------------------
// Tooltip portal — portaled to body so it never gets clipped by overflow.
// ---------------------------------------------------------------------------
type TooltipPortalProps = {
  id: string;
  x: number;
  y: number;
  text: string;
};

function TooltipPortal({ id, x, y, text }: TooltipPortalProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none fixed z-[10000] w-max max-w-[min(22rem,calc(100vw-1rem))] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-left text-[12px] font-normal leading-relaxed text-[var(--fg)] shadow-lg [text-wrap:balance]"
      style={{ left: x, top: y, transform: "translateX(-50%)" }}
    >
      {text}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// HelpTooltip
// ---------------------------------------------------------------------------
export function HelpTooltip({ helpKey, mode = "tooltip", className = "" }: HelpTooltipProps) {
  const { t } = useTranslation();
  const i18nKey = `help.${helpKey}`;
  const text = t(i18nKey, { defaultValue: "" });

  // Hide the button entirely when there is no translation for this key.
  if (!text) return null;

  return mode === "modal" ? (
    <HelpModalTrigger helpKey={helpKey} text={text} className={className} />
  ) : (
    <HelpTooltipTrigger text={text} className={className} />
  );
}

// ---------------------------------------------------------------------------
// Tooltip mode
// ---------------------------------------------------------------------------
type TriggerProps = { text: string; className: string };
type ModalTriggerProps = TriggerProps & { helpKey: string };

function HelpTooltipTrigger({ text, className }: TriggerProps) {
  const tipId = useId();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [xy, setXy] = useState({ x: 0, y: 0 });

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setXy({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }, []);

  const show = useCallback(() => {
    updatePos();
    setOpen(true);
  }, [updatePos]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const close = () => hide();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, hide]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={text}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
      >
        <CircleHelp size={14} aria-hidden />
      </button>
      {open ? (
        <TooltipPortal id={tipId} x={xy.x} y={xy.y} text={text} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal mode
// ---------------------------------------------------------------------------
function HelpModalTrigger({ helpKey, text, className }: ModalTriggerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const title = t(`help.${helpKey}.title`, { defaultValue: t("info") });

  return (
    <>
      <button
        type="button"
        aria-label={text}
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
      >
        <CircleHelp size={14} aria-hidden />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        width={480}
        lockBodyScroll={false}
      >
        <p className="text-sm leading-relaxed text-[var(--fg-muted)]">{text}</p>
      </Modal>
    </>
  );
}
