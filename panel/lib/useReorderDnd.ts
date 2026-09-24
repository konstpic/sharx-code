"use client";

import { useCallback, useState, type DragEvent, type HTMLAttributes } from "react";

export type DndOrientation = "vertical" | "horizontal";

type Over = { id: number; pos: "before" | "after" } | null;

/** Where the dragged id ends up when dropped next to `overId`. Exported for tests. */
export function moveId(ids: number[], dragged: number, overId: number, pos: "before" | "after"): number[] {
  if (dragged === overId) return ids;
  const without = ids.filter((x) => x !== dragged);
  const at = without.indexOf(overId);
  if (at < 0 || !ids.includes(dragged)) return ids;
  without.splice(pos === "before" ? at : at + 1, 0, dragged);
  return without;
}

export type ReorderDnd = {
  enabled: boolean;
  draggingId: number | null;
  /** Props for the draggable row / card element. */
  itemProps: (id: number) => HTMLAttributes<HTMLElement> & { draggable: boolean };
  /** Props for the grip handle: arms dragging only when the drag starts from it. */
  handleProps: (id: number) => HTMLAttributes<HTMLElement>;
};

/**
 * Drag-and-drop reordering with native HTML5 events (works for table rows, list rows and grid tiles).
 * The list is only draggable from its grip handle, so buttons, switches and text stay usable.
 */
export function useReorderDnd({
  ids,
  enabled,
  orientation,
  onReorder,
}: {
  ids: number[];
  enabled: boolean;
  orientation: DndOrientation;
  onReorder: (nextIds: number[]) => void;
}): ReorderDnd {
  const [armedId, setArmedId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [over, setOver] = useState<Over>(null);

  const reset = useCallback(() => {
    setArmedId(null);
    setDraggingId(null);
    setOver(null);
  }, []);

  const itemProps = useCallback(
    (id: number) => {
      const state = over && over.id === id ? (orientation === "horizontal" ? `${over.pos}-x` : over.pos) : undefined;
      return {
        draggable: enabled && armedId === id,
        "data-dnd-item": "" as const,
        "data-dnd-dragging": draggingId === id ? "true" : undefined,
        "data-dnd-over": state,
        onDragStart: (e: DragEvent<HTMLElement>) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(id));
          setDraggingId(id);
        },
        onDragEnd: reset,
        onDragOver: (e: DragEvent<HTMLElement>) => {
          if (!enabled || draggingId == null || draggingId === id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const r = e.currentTarget.getBoundingClientRect();
          const pos =
            orientation === "horizontal"
              ? e.clientX < r.left + r.width / 2
                ? "before"
                : "after"
              : e.clientY < r.top + r.height / 2
                ? "before"
                : "after";
          setOver((cur) => (cur && cur.id === id && cur.pos === pos ? cur : { id, pos }));
        },
        onDrop: (e: DragEvent<HTMLElement>) => {
          e.preventDefault();
          if (draggingId != null && over) {
            const next = moveId(ids, draggingId, over.id, over.pos);
            if (next.some((x, i) => x !== ids[i])) onReorder(next);
          }
          reset();
        },
      } as HTMLAttributes<HTMLElement> & { draggable: boolean };
    },
    [armedId, draggingId, enabled, ids, onReorder, orientation, over, reset],
  );

  const handleProps = useCallback(
    (id: number): HTMLAttributes<HTMLElement> => ({
      onPointerDown: () => {
        if (enabled) setArmedId(id);
      },
      onPointerUp: () => setArmedId((cur) => (draggingId == null && cur === id ? null : cur)),
      onPointerCancel: () => setArmedId(null),
    }),
    [draggingId, enabled],
  );

  return { enabled, draggingId, itemProps, handleProps };
}
