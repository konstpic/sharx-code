"use client";

import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SSHProvisionStepStatus = "pending" | "running" | "success" | "skipped" | "error";

export type SSHProvisionStep = {
  key: string;
  status: SSHProvisionStepStatus;
  detail?: string;
};

const STEP_ORDER = ["connect", "check_docker", "install_docker", "write_compose", "compose_up"] as const;

function StepIcon({ status }: { status: SSHProvisionStepStatus }) {
  if (status === "running") {
    return <Loader2 className="size-4 shrink-0 animate-spin text-[var(--accent)]" aria-hidden />;
  }
  if (status === "success") {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />;
  }
  if (status === "error") {
    return <XCircle className="size-4 shrink-0 text-red-500" aria-hidden />;
  }
  if (status === "skipped") {
    return <Circle className="size-4 shrink-0 text-[var(--fg-muted)]" aria-hidden />;
  }
  return <Circle className="size-4 shrink-0 text-[var(--fg-muted)]/50" aria-hidden />;
}

/** Live step list for the automatic (SSH) node install — mirrors DockerUpdateProgressModal's style. */
export function NodeSSHProvisionSteps({ steps }: { steps: SSHProvisionStep[] }) {
  const { t } = useTranslation();
  const byKey = new Map(steps.map((s) => [s.key, s]));

  const statusLabel = (status: SSHProvisionStepStatus): string => {
    switch (status) {
      case "pending":
        return t("pages.nodes.sshStepPending", { defaultValue: "Waiting" });
      case "running":
        return t("pages.nodes.sshStepRunning", { defaultValue: "In progress…" });
      case "success":
        return t("pages.nodes.sshStepSuccess", { defaultValue: "Done" });
      case "skipped":
        return t("pages.nodes.sshStepSkipped", { defaultValue: "Skipped" });
      case "error":
        return t("pages.nodes.sshStepError", { defaultValue: "Failed" });
      default:
        return status;
    }
  };

  return (
    <ul className="flex flex-col gap-1.5">
      {STEP_ORDER.map((key) => {
        const step = byKey.get(key) ?? { key, status: "pending" as const };
        return (
          <li
            key={key}
            className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm text-[var(--fg)]">
                {t(`pages.nodes.sshStep.${key}`, { defaultValue: key })}
              </p>
              {step.detail ? (
                <p className="mt-0.5 truncate text-[11px] text-[var(--fg-muted)]" title={step.detail}>
                  {step.detail}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--fg-muted)]">
              <StepIcon status={step.status} />
              <span>{statusLabel(step.status)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
