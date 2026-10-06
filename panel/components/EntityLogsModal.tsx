"use client";

import { Modal } from "@/components/ui";
import { LogExplorer } from "@/components/LogExplorer";

/** Journal of one node or balancer (Nodes -> node -> Logs, Balancers -> balancer -> Logs), or of the panel itself. */
export function EntityLogsModal({
  open,
  onClose,
  entityType,
  entityId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  entityType: "node" | "balancer" | "panel";
  entityId: number | null;
  title: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="min(1280px, 96vw)">
      {open && entityId != null ? <LogExplorer source={{ type: entityType, id: entityId }} /> : null}
    </Modal>
  );
}
