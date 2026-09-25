"use client";

import { Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, useToast } from "@/components/ui";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { extractWireGuardConfBlock } from "@/lib/wireguardConf";
import { isSharxV2Config, isSharxV1Config } from "@/lib/sharxSubpageConfig";
import type {
  SharxSubpageConfigV1,
  SharxSubpageConfigV2,
  SubpageBlock,
} from "@/lib/sharxSubpageConfig";
import shell from "./subscription-shell.module.css";
import type { PublicSubPayload } from "./types";
import { parseLinkTitle } from "./types";
import { renderBlock, defaultBlocksForLegacy } from "./blocks";
import { SubHeader } from "./SubHeader";
import { LanguagePicker } from "./LanguagePicker";
import { LayoutRenderer } from "./layout/LayoutRenderer";
import { normalizeDoc } from "@/lib/subLayout/tree";
import { defaultLayout, isPristineDefault } from "@/lib/subLayout/wow";

type BrandingInfo = {
  title: string;
  logoUrl?: string;
  brandText?: string;
  supportUrl?: string;
  showQrCodes: boolean;
};

function brandingFromConfig(
  cfg: SharxSubpageConfigV1 | SharxSubpageConfigV2 | null,
  fallbackTitle: string,
): BrandingInfo {
  if (!cfg) {
    return { title: fallbackTitle, showQrCodes: true };
  }
  return {
    title: cfg.branding?.title || fallbackTitle,
    logoUrl: cfg.branding?.logoUrl?.trim() || undefined,
    brandText: cfg.branding?.brandText?.trim() || undefined,
    supportUrl: cfg.branding?.supportUrl?.trim() || undefined,
    showQrCodes: cfg.showQrCodes !== false,
  };
}

function shouldShowGetLink(
  cfg: SharxSubpageConfigV1 | SharxSubpageConfigV2 | null,
): boolean {
  if (!cfg || !("blocks" in cfg) || !Array.isArray(cfg.blocks)) return true;
  const linksBlock = cfg.blocks.find(
    (b: SubpageBlock) => b.kind === "links-list" && b.enabled !== false,
  ) as { showCopy?: boolean; showQr?: boolean } | undefined;
  if (!linksBlock) return false;
  return linksBlock.showCopy !== false || linksBlock.showQr !== false;
}

type SubPageRendererProps = {
  data: PublicSubPayload;
  onCopy?: (text: string, kind: "link" | "subscription") => void;
  interactive?: boolean;
  className?: string;
};

export function SubPageRenderer({
  data,
  onCopy,
  interactive = true,
  className = "",
}: SubPageRendererProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [qrModal, setQrModal] = useState<{ url: string; title: string } | null>(null);

  const fallbackTitle = t("pages.publicSub.title", { defaultValue: "Subscription" });
  const cfg = isSharxV2Config(data.config)
    ? (data.config as SharxSubpageConfigV2)
    : isSharxV1Config(data.config)
      ? (data.config as SharxSubpageConfigV1)
      : null;

  const branding = brandingFromConfig(cfg, fallbackTitle);
  const showGetLink = shouldShowGetLink(cfg);

  const copyText = useCallback(
    async (text: string, kind: "link" | "subscription") => {
      if (!interactive) return;
      if (onCopy) {
        onCopy(text, kind);
        return;
      }
      try {
        await copyTextToClipboard(text);
        toast.success(
          kind === "subscription"
            ? t("pages.publicSub.copiedSubscription", {
                defaultValue: "Subscription link copied.",
              })
            : t("pages.publicSub.copiedLink", { defaultValue: "Link copied." }),
        );
      } catch {
        toast.error(t("pages.publicSub.copyFailed", { defaultValue: "Could not copy." }));
      }
    },
    [interactive, onCopy, toast, t],
  );

  const blocks: SubpageBlock[] =
    cfg && "blocks" in cfg && Array.isArray(cfg.blocks) && cfg.blocks.length > 0
      ? (cfg.blocks as SubpageBlock[]).filter((b: SubpageBlock) => b.enabled !== false)
      : defaultBlocksForLegacy();

  const locales =
    cfg && "locales" in cfg && Array.isArray(cfg.locales) ? cfg.locales : [];

  const layoutDoc = useMemo(() => {
    const raw = cfg && "layout" in cfg ? (cfg as { layout?: unknown }).layout : undefined;
    const d = raw ? normalizeDoc(raw) : null;
    if (d) return d.enabled ? d : null;
    return !cfg || isPristineDefault(cfg) ? defaultLayout(i18n.language?.slice(0, 2) || "en") : null;
  }, [cfg, i18n.language]);

  const modal = interactive ? (
    <Modal open={qrModal != null} onClose={() => setQrModal(null)} title={qrModal?.title} width={320}>
      {qrModal ? (
        <div className={shell.qrModalInner}>
          <div className={shell.qrBox}>
            <QRCodeSVG
              value={qrModal.url}
              size={200}
              level="M"
              bgColor="#161b22"
              fgColor="#22d3ee"
              style={{ cursor: "pointer" }}
              onClick={() => void copyText(qrModal.url, "subscription")}
            />
          </div>
          <p className="text-center text-sm font-semibold text-[var(--sub-fg-strong,#fff)]">
            {t("pages.publicSub.scanQrCode", { defaultValue: "Scan QR code in the app" })}
          </p>
          <p className="text-center text-xs text-[var(--sub-fg-muted,#8b949e)]">
            {t("pages.publicSub.scanQrCodeDescription", { defaultValue: "Or copy the link below and paste it into your VPN client." })}
          </p>
          <Button type="button" variant="secondary" className={shell.actionBtn} style={{ width: "100%", cursor: "pointer" }} onClick={() => void copyText(qrModal.url, "subscription")}>
            <Copy className={`size-4 ${shell.actionBtnIcon}`} />
            {t("pages.publicSub.copyLink", { defaultValue: "Copy link" })}
          </Button>
        </div>
      ) : null}
    </Modal>
  ) : null;

  if (layoutDoc) {
    return (
      <>
        <LayoutRenderer
          doc={layoutDoc}
          data={data}
          config={cfg && "blocks" in cfg ? (cfg as SharxSubpageConfigV2) : null}
          interactive={interactive}
          fallbackTitle={fallbackTitle}
          onCopy={(text) => void copyText(text, "link")}
          onShowQr={(url, title) => setQrModal({ url: extractWireGuardConfBlock(url) ?? url, title })}
        />
        {modal}
      </>
    );
  }

  return (
    <>
      <SubHeader
        title={branding.title}
        logoUrl={branding.logoUrl}
        brandText={branding.brandText}
        supportUrl={branding.supportUrl}
        showGetLink={!!data.subscriptionUrl && showGetLink}
        interactive={interactive}
        className={className}
        onGetLink={() =>
          setQrModal({
            url: data.subscriptionUrl,
            title: t("pages.publicSub.getLink", { defaultValue: "Get link" }),
          })
        }
      />

      <main className={`${shell.mainInner} ${shell.fadeIn}`}>
        <div className={shell.stackGap}>
          {blocks.map((b) => (
            <section key={b.id} data-block-id={b.id} data-block-kind={b.kind}>
              {renderBlock(b, {
                data,
                showQrCodes: branding.showQrCodes,
                onCopyLink: (url) => void copyText(url, "link"),
                onShowQr: (url, title) => {
                  // For WireGuard panel-info blocks, encode only [Interface]/[Peer] conf.
                  const qrUrl = extractWireGuardConfBlock(url) ?? url;
                  setQrModal({ url: qrUrl, title });
                },
                interactive,
                t,
                appSettings:
                  cfg && "appSettings" in cfg ? cfg.appSettings : undefined,
              })}
            </section>
          ))}

          {locales.length > 1 ? (
            <LanguagePicker locales={locales} />
          ) : null}

          {data.subscriptionUrl ? (
            <p className="text-center text-[11px] text-[var(--sub-fg-subtle,#6e7681)]">
              {t("pages.publicSub.rawHint", {
                defaultValue: "Use the subscription URL in your VPN app.",
              })}
            </p>
          ) : null}
        </div>
      </main>

      {modal}
    </>
  );
}

export function SubPageCenterMessage({ children }: { children: ReactNode }) {
  return <div className={`${shell.centerMessage} ${shell.fadeIn}`}>{children}</div>;
}

export function SubPageErrorBox({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className={`${shell.errorBox} ${shell.fadeIn}`}>
      <h1 className={shell.errorTitle}>{title}</h1>
      {description != null ? <p className={shell.errorText}>{description}</p> : null}
    </div>
  );
}

export { parseLinkTitle };
