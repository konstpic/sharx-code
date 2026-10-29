"use client";

import type { ReactNode } from "react";
import { Modal } from "./modal";
import { Button } from "./button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  danger?: boolean;
  loading?: boolean;
  /** extra content under the description (for example a list of options to tick) */
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  danger,
  loading,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "primary" : "primary"}
            className={danger ? "!bg-red-600 hover:!bg-red-500" : ""}
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {description != null && (
        <p className="text-sm text-[var(--fg-muted)]">{description}</p>
      )}
      {children}
    </Modal>
  );
}
