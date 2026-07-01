"use client";

import { ExternalLink, Info, Package } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Modal, useToast } from "@/components/ui";
import { getJson } from "@/lib/api";
import { panel } from "@/lib/paths";
import { suggestedDockerUpdateCommand, usePublicAppMeta } from "@/lib/usePublicAppMeta";
import { DockerUpdateProgressModal } from "@/components/panel/DockerUpdateProgressModal";

type PanelHeaderAppMetaProps = {
  /** Slightly tighter styles on the login page */
  variant?: "shell" | "login";
};

/** Tailwind `lg` breakpoint — split changelog layout matches this. */
function useIsLgUp() {
  const [lg, setLg] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 1024px)");
    const sync = () => setLg(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return lg;
}

export function PanelHeaderAppMeta({ variant = "shell" }: PanelHeaderAppMetaProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const meta = usePublicAppMeta();
  const isLgUp = useIsLgUp();
  const [open, setOpen] = useState(false);
  const [releaseDetailsOpen, setReleaseDetailsOpen] = useState(false);
  const [updaterEnabled, setUpdaterEnabled] = useState<boolean | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [updateProgressOpen, setUpdateProgressOpen] = useState(false);

  const closeModal = () => {
    setReleaseDetailsOpen(false);
    setOpen(false);
  };

  useEffect(() => {
    if (!open || variant === "login") {
      setUpdaterEnabled(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await getJson<{ enabled: boolean }>(panel("api/server/updater"));
        if (!cancelled && r.success && r.obj) {
          setUpdaterEnabled(Boolean((r.obj as { enabled?: boolean }).enabled));
        }
      } catch {
        if (!cancelled) setUpdaterEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, variant]);

  const onTriggerSidecar = () => {
    setTriggering(true);
    setOpen(false);
    setReleaseDetailsOpen(false);
    setUpdateProgressOpen(true);
    setTriggering(false);
  };

  if (!meta?.version) return null;

  const isLogin = variant === "login";
  const badgeClass = isLogin ? "panel-update-badge panel-update-badge--login" : "panel-update-badge panel-update-badge--panel";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(suggestedDockerUpdateCommand);
      toast.success(t("copied"));
    } catch {
      toast.error(t("fail"));
    }
  };

  const hasInlineReleaseNotes = Boolean(meta.releaseNotesMarkdown?.trim());
  const releaseNotesInSidePanel = hasInlineReleaseNotes && releaseDetailsOpen && isLgUp;
  const modalWidth = releaseNotesInSidePanel ? 1040 : 560;
  const mobileReleaseStacked =
    open && hasInlineReleaseNotes && releaseDetailsOpen && !isLgUp;

  const releaseNotesDoc: ReactNode = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
      }}
    >
      {meta.releaseNotesMarkdown ?? ""}
    </ReactMarkdown>
  );

  const mainColumn = (
    <div className="space-y-4 text-sm leading-relaxed text-[var(--fg-muted)]">
      <p>{t("menu.updateModalIntro")}</p>
      {variant === "shell" && updaterEnabled ? (
        <div className="space-y-3 rounded-xl border border-[var(--border-strong)] bg-[var(--ifm-color-primary)]/6 p-4 text-[var(--fg)]">
          <p className="text-sm font-semibold text-[var(--fg)]">{t("menu.updateSidecarTitle")}</p>
          <p className="text-xs leading-relaxed text-[var(--fg-muted)]">{t("menu.updateSidecarDesc")}</p>
          <Button
            type="button"
            variant="primary"
            disabled={triggering}
            className="w-full sm:w-auto"
            onClick={onTriggerSidecar}
          >
            {triggering ? t("menu.updateSidecarTriggering") : t("menu.updateSidecarTrigger")}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-muted)]/40 p-3 text-[var(--fg)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <span className="text-[var(--fg-muted)]">{t("menu.updateCurrent")}</span>
          <span className="font-mono tabular-nums">{meta.version}</span>
        </div>
        {meta.latestVersion ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="text-[var(--fg-muted)]">{t("menu.updateLatest")}</span>
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-[var(--ifm-color-primary)]">
              {meta.latestVersion}
              {hasInlineReleaseNotes ? (
                <button
                  type="button"
                  className={`inline-flex rounded p-0.5 text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--ifm-color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ifm-color-primary)] ${releaseDetailsOpen ? "text-[var(--ifm-color-primary)]" : ""}`}
                  aria-label={
                    releaseDetailsOpen
                      ? t("menu.updateReleaseDetailsHide")
                      : t("menu.updateReleaseDetailsShow")
                  }
                  aria-expanded={releaseDetailsOpen}
                  onClick={() => setReleaseDetailsOpen((v) => !v)}
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-[var(--fg)]">{t("menu.updateDockerHint")}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs text-[var(--fg)]">
            {suggestedDockerUpdateCommand}
          </code>
          <Button type="button" variant="secondary" className="shrink-0" onClick={onCopy}>
            {t("menu.updateCopyCommand")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">{t("menu.updateDockerPull")}</p>
      </div>
      <p className="text-xs">{t("menu.updateAfterPull")}</p>
      <div className="flex flex-wrap gap-3 text-xs">
        {meta.releaseUrl ? (
          <a
            href={meta.releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-[var(--ifm-color-primary)] hover:underline"
          >
            {t("menu.updateReleaseNotes")}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
        {meta.updateAvailable ? (
          <button type="button" className={badgeClass} onClick={() => setOpen(true)}>
            {t("menu.updateAvailable")}
          </button>
        ) : null}
        <button
          type="button"
          className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-left text-[var(--panel-chrome-fg-muted)] transition-colors hover:bg-[var(--panel-chrome-hover-bg)] hover:text-[var(--panel-chrome-fg-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ifm-color-primary)] ${isLogin ? "text-[10px]" : "text-[11px]"}`}
          title={t("menu.versionClickHint")}
          aria-label={t("menu.versionClickHint")}
          onClick={() => setOpen(true)}
        >
          <span className="text-[var(--panel-chrome-fg-subtle)]">{t("menu.appVersionLabel")}</span>{" "}
          <span className="font-medium tabular-nums text-[var(--panel-chrome-fg-strong)]">{meta.version}</span>
        </button>
      </div>

      <Modal
        open={open}
        onClose={closeModal}
        closeOnEscape={!mobileReleaseStacked}
        title={
          <span className="flex items-center gap-2">
            <Package className="size-5 text-[var(--ifm-color-primary)]" aria-hidden />
            {t("menu.updateModalTitle")}
          </span>
        }
        width={modalWidth}
        bodyClassName={
          releaseNotesInSidePanel
            ? "flex min-h-0 flex-1 flex-col !overflow-hidden !p-0"
            : undefined
        }
        footer={
          <Button type="button" variant="secondary" onClick={closeModal}>
            {t("close")}
          </Button>
        }
      >
        {hasInlineReleaseNotes ? (
          releaseNotesInSidePanel ? (
            <div className="flex min-h-0 max-h-[min(85vh,820px)] flex-1 flex-col lg:flex-row">
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">{mainColumn}</div>
              <aside className="flex min-h-0 min-w-0 flex-col border-t border-[var(--border)] bg-[var(--bg-muted)]/25 lg:w-[min(440px,46%)] lg:border-l lg:border-t-0">
                <div className="shrink-0 border-b border-[var(--border)] px-4 py-2.5 text-xs font-semibold text-[var(--fg)]">
                  {t("menu.updateReleaseDetailsHeading")}
                </div>
                <div className="prose-doc min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-[var(--fg)]">
                  {releaseNotesDoc}
                </div>
              </aside>
            </div>
          ) : (
            mainColumn
          )
        ) : (
          mainColumn
        )}
      </Modal>

      {hasInlineReleaseNotes ? (
        <Modal
          open={mobileReleaseStacked}
          onClose={() => setReleaseDetailsOpen(false)}
          portalClassName="!z-[100]"
          lockBodyScroll={false}
          title={t("menu.updateReleaseDetailsHeading")}
          width={560}
          footer={
            <Button type="button" variant="secondary" onClick={() => setReleaseDetailsOpen(false)}>
              {t("close")}
            </Button>
          }
        >
          <div className="prose-doc text-sm text-[var(--fg)]">{releaseNotesDoc}</div>
        </Modal>
      ) : null}

      <DockerUpdateProgressModal open={updateProgressOpen} panelVersion={meta.version} />
    </>
  );
}
