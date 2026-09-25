"use client";

import { Link2, LifeBuoy, MessageSquare, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import shell from "./subscription-shell.module.css";
import type { SupportKind } from "./types";
import { supportKindFromUrl } from "./types";

function SupportGlyph({ kind }: { kind: SupportKind }) {
  const cn = "size-[1.125rem]";
  switch (kind) {
    case "telegram":
      return <Send className={cn} />;
    case "discord":
      return <MessageSquare className={cn} />;
    case "vk":
      return <Link2 className={cn} />;
    default:
      return <LifeBuoy className={cn} />;
  }
}

export type SubHeaderProps = {
  title: string;
  logoUrl?: string;
  brandText?: string;
  supportUrl?: string;
  /** Show the "get link" (QR) button. */
  showGetLink: boolean;
  interactive: boolean;
  onGetLink: () => void;
  className?: string;
  /** Designer options: hide parts of the header. */
  hideLogo?: boolean;
  hideTitle?: boolean;
  hideTagline?: boolean;
  hideSupport?: boolean;
};

/** The sticky brand bar of the public subscription page (logo, title, get link, support). */
export function SubHeader({
  title,
  logoUrl,
  brandText,
  supportUrl,
  showGetLink,
  interactive,
  onGetLink,
  className = "",
  hideLogo,
  hideTitle,
  hideTagline,
  hideSupport,
}: SubHeaderProps) {
  const { t } = useTranslation();
  const supportKind = supportUrl ? supportKindFromUrl(supportUrl) : ("generic" as SupportKind);
  const logo = hideLogo ? undefined : logoUrl;
  return (
    <header className={`${shell.headerBar} ${className}`}>
      <div className={shell.headerInner}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {hideLogo ? null : logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-9 w-9 shrink-0 object-contain" width={36} height={36} />
            ) : (
              <div className={shell.logoFallback} aria-hidden>
                <Link2 className="size-5" />
              </div>
            )}
            <div className="min-w-0">
              {hideTitle ? null : <h1 className={logo ? shell.titleCyan : shell.titleWhite}>{title}</h1>}
              {brandText && !hideTagline ? <p className={shell.brandTagline}>{brandText}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {showGetLink ? (
              <button
                type="button"
                className={shell.supportIconBtn}
                title={t("pages.publicSub.getLink", { defaultValue: "Get link" })}
                aria-label={t("pages.publicSub.getLink", { defaultValue: "Get link" })}
                onClick={onGetLink}
              >
                <Link2 className="size-[1.125rem]" />
              </button>
            ) : null}
            {supportUrl && !hideSupport ? (
              <a
                href={supportUrl}
                target="_blank"
                rel="noreferrer"
                className={shell.supportIconBtn}
                title={t("pages.publicSub.support", { defaultValue: "Support" })}
                aria-label={t("pages.publicSub.support", { defaultValue: "Support" })}
                onClick={(e) => {
                  if (!interactive) e.preventDefault();
                }}
              >
                <SupportGlyph kind={supportKind} />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
