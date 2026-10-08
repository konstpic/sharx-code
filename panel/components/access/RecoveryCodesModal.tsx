"use client";

import { Copy, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AlertBanner, Button, Modal } from "@/components/ui";
import { copyTextToClipboard } from "@/lib/copyToClipboard";

/** Shows a fresh set of recovery codes. They are visible only now: the server keeps nothing but hashes. */
export function RecoveryCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const text = codes.join("\n");
  const download = () => {
    const blob = new Blob([`SharX Panel recovery codes\n\n${text}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sharx-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t("rbac.recovery.title", { defaultValue: "Recovery codes" })}
      width={480}
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            {t("rbac.recovery.saved", { defaultValue: "I have saved them" })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <AlertBanner
          type="warning"
          title={t("rbac.recovery.hint", {
            defaultValue: "Keep these somewhere safe. Each works once instead of the authenticator code if you lose your phone. They are not shown again.",
          })}
        />
        <ul className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--border)] p-3 font-mono text-sm text-[var(--fg)]">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void copyTextToClipboard(text)}>
            <Copy size={16} /> {t("rbac.sso.copy", { defaultValue: "Copy" })}
          </Button>
          <Button variant="secondary" onClick={download}>
            <Download size={16} /> {t("rbac.recovery.download", { defaultValue: "Download" })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
