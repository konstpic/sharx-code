"use client";

import { HelpCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HelpScene } from "@/components/help/HelpScene";
import { WelcomeSteps } from "@/components/help/WelcomeSteps";
import { helpSeen, markHelpSeen } from "@/lib/helpSeen";
import { IconButton, Modal } from "@/components/ui";

type SectionHelpModalProps = {
  /** i18n key for modal title */
  titleKey: string;
  /** i18n keys for body paragraphs in display order */
  paragraphKeys: readonly string[];
  /** Tooltip / aria-label for the trigger (i18n key) */
  buttonLabelKey?: string;
  /** Animated explainer shown above the text (see components/help/scenes.ts). */
  scene?: string;
  /** Section id for the "shown once per release" memory; defaults to the scene. Without either, the modal never opens by itself. */
  sectionId?: string;
  /** Extra content under the paragraphs. */
  children?: ReactNode;
  /** Extra class for the modal portal (e.g. to stack above a full-screen editor). */
  portalClassName?: string;
};

/**
 * Question-mark control that opens a read-only help modal for the current page/section. After a big release
 * (see HELP_REVISION) it also opens once by itself on the first visit of each section.
 */
export function SectionHelpModal({
  titleKey,
  paragraphKeys,
  buttonLabelKey = "pages.help.sectionAbout",
  scene,
  sectionId,
  children,
  portalClassName,
}: SectionHelpModalProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = sectionId ?? scene;

  useEffect(() => {
    if (!id || helpSeen(id)) return;
    // Let the page render first; remembered as soon as it is shown, so a reload does not repeat it.
    const timer = window.setTimeout(() => {
      markHelpSeen(id);
      setOpen(true);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [id]);

  return (
    <>
      <IconButton
        type="button"
        label={t(buttonLabelKey)}
        onClick={() => setOpen(true)}
        className="!h-10 !w-10 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)] hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] hover:text-[var(--fg)]"
      >
        <HelpCircle size={20} strokeWidth={2} />
      </IconButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t(titleKey)}
        width={scene ? 720 : 560}
        portalClassName={portalClassName}
      >
        {scene && open ? <HelpScene sceneId={scene} className="mb-5" /> : null}
        <div className="flex flex-col gap-3.5 text-sm leading-relaxed text-[var(--fg-muted)]">
          {paragraphKeys.map((key) => (
            <p key={key}>{t(key)}</p>
          ))}
        </div>
        {scene === "welcome" ? <WelcomeSteps onNavigate={() => setOpen(false)} /> : null}
        {children}
      </Modal>
    </>
  );
}
