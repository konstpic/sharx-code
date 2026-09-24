"use client";

import { useCallback, useLayoutEffect, useRef, useState, type DragEvent, type HTMLAttributes } from "react";

export type DndOrientation = "vertical" | "horizontal";

/** Where the dragged id ends up when dropped next to `overId`. Exported for tests. */
export function moveId(ids: number[], dragged: number, overId: number, pos: "before" | "after"): number[] {
  if (dragged === overId) return ids;
  const without = ids.filter((x) => x !== dragged);
  const at = without.indexOf(overId);
  if (at < 0 || !ids.includes(dragged)) return ids;
  without.splice(pos === "before" ? at : at + 1, 0, dragged);
  return without;
}

/** Rows reordered to the live drag preview (unknown ids keep their place at the end). */
export function applyOrder<T extends { id: number }>(rows: T[], order: number[] | null): T[] {
  if (!order) return rows;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
}

export type ReorderDnd = {
  enabled: boolean;
  /** Live order while dragging, so the other items move out of the way; null when idle. */
  order: number[] | null;
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
  const [preview, setPreview] = useState<number[] | null>(null);
  const rects = useRef(new Map<number, DOMRect>());

  const reset = useCallback(() => {
    setArmedId(null);
    setDraggingId(null);
    setPreview(null);
  }, []);

  // FLIP: remember where every item was, and slide the ones that moved from the old spot to the new one.
  useLayoutEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-dnd-item][data-dnd-id]");
    const next = new Map<number, DOMRect>();
    els.forEach((el) => {
      const id = Number(el.dataset.dndId);
      const r = el.getBoundingClientRect();
      next.set(id, r);
      const old = rects.current.get(id);
      if (!old || preview == null) return;
      const dx = old.left - r.left;
      const dy = old.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: 200,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
    });
    rects.current = next;
  }, [preview, ids]);

  const itemProps = useCallback(
    (id: number) => {
      return {
        draggable: enabled && armedId === id,
        "data-dnd-item": "" as const,
        "data-dnd-id": String(id),
        "data-dnd-dragging": draggingId === id ? "true" : undefined,
        onDragStart: (e: DragEvent<HTMLElement>) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(id));
          setDraggingId(id);
          setPreview(ids);
        },
        onDragEnd: reset,
        onDragOver: (e: DragEvent<HTMLElement>) => {
          if (!enabled || draggingId == null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (draggingId === id || !preview) return;
          const r = e.currentTarget.getBoundingClientRect();
          const frac =
            orientation === "horizontal" ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
          const from = preview.indexOf(draggingId);
          const to = preview.indexOf(id);
          // Swap only once the pointer is past the middle of the item it is entering: no flicker.
          const pos = to > from ? (frac > 0.5 ? "after" : null) : frac < 0.5 ? "before" : null;
          if (!pos) return;
          const next = moveId(preview, draggingId, id, pos);
          if (next.some((x, i) => x !== preview[i])) setPreview(next);
        },
        onDrop: (e: DragEvent<HTMLElement>) => {
          e.preventDefault();
          if (preview && preview.some((x, i) => x !== ids[i])) onReorder(preview);
          reset();
        },
      } as HTMLAttributes<HTMLElement> & { draggable: boolean };
    },
    [armedId, draggingId, enabled, ids, onReorder, orientation, preview, reset],
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

  return { enabled, order: preview, draggingId, itemProps, handleProps };
}
