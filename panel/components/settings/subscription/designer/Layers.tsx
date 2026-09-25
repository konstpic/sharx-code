"use client";

import { ChevronDown, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { isContainerType, moveNode, parentOf, updateNode } from "@/lib/subLayout/tree";
import type { LNode, LayoutDoc, NodeType } from "@/lib/subLayout/types";
import type { D } from "./i18n";
import { TypeIcon } from "./palette-icons";

type Row = { id: string; depth: number; node: LNode; hasKids: boolean };
type Over = { id: string; pos: "before" | "after" | "inside" };

type Props = {
  doc: LayoutDoc;
  sel: string[];
  select: (ids: string[]) => void;
  commit: (doc: LayoutDoc, opts?: { sel?: string[]; key?: string }) => void;
  d: D;
};

export function Layers({ doc, sel, select, commit, d }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; over: Over | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const visit = (id: string, depth: number) => {
      const n = doc.nodes[id];
      if (!n) return;
      const kids = n.children ?? [];
      out.push({ id, depth, node: n, hasKids: kids.length > 0 });
      if (!collapsed.has(id)) for (const c of kids) visit(c, depth + 1);
    };
    visit(doc.root, 0);
    return out;
  }, [doc, collapsed]);

  // A selected node inside a collapsed branch would be invisible: open the way to it.
  const overAt = (clientY: number, dragId: string): Over | null => {
    const el = listRef.current;
    if (!el) return null;
    const rowsEls = Array.from(el.querySelectorAll<HTMLElement>("[data-layer-id]"));
    for (const r of rowsEls) {
      const b = r.getBoundingClientRect();
      if (clientY < b.top || clientY > b.bottom) continue;
      const id = r.dataset.layerId as string;
      if (id === dragId) return null;
      const n = doc.nodes[id];
      if (!n) return null;
      const rel = (clientY - b.top) / b.height;
      if (id === doc.root) return isContainerType(n.type) ? { id, pos: "inside" } : null;
      if (isContainerType(n.type)) return { id, pos: rel < 0.28 ? "before" : rel > 0.72 ? "after" : "inside" };
      return { id, pos: rel < 0.5 ? "before" : "after" };
    }
    return null;
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || id === doc.root) return;
    const sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientY - sy) < 4) return;
      started = true;
      setDrag({ id, over: overAt(ev.clientY, id) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (started) {
        const over = overAt(ev.clientY, id);
        setDrag(null);
        if (over) {
          let next = doc;
          if (over.pos === "inside") next = moveNode(doc, id, over.id, (doc.nodes[over.id].children ?? []).length);
          else {
            const pid = parentOf(doc, over.id);
            if (pid) {
              const at = (doc.nodes[pid].children ?? []).indexOf(over.id);
              next = moveNode(doc, id, pid, over.pos === "before" ? at : at + 1);
            }
          }
          if (next !== doc) commit(next, { sel: [id] });
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={listRef} className="select-none py-1" role="tree" aria-label={d("layers.title", "Layers")}>
      {rows.map(({ id, depth, node, hasKids }) => {
        const selected = sel.includes(id);
        const over = drag?.over && drag.over.id === id ? drag.over.pos : null;
        return (
          <div
            key={id}
            role="treeitem"
            aria-selected={selected}
            data-layer-id={id}
            onPointerDown={(e) => startDrag(e, id)}
            onClick={(e) => {
              if (e.shiftKey || e.metaKey || e.ctrlKey) select(selected ? sel.filter((s) => s !== id) : [...sel, id]);
              else select([id]);
            }}
            className={`group relative flex h-7 cursor-pointer items-center gap-1 pr-1.5 text-[12.5px] ${selected ? "bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] text-[var(--fg)]" : "text-[var(--fg-muted)] hover:bg-[var(--surface)] hover:text-[var(--fg)]"} ${node.hidden ? "opacity-50" : ""} ${drag?.id === id ? "opacity-40" : ""}`}
            style={{ paddingLeft: 6 + depth * 14 }}
          >
            {over === "before" ? <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-[#22d3ee]" /> : null}
            {over === "after" ? <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-[#22d3ee]" /> : null}
            {over === "inside" ? <span className="pointer-events-none absolute inset-0 rounded border border-dashed border-[#22d3ee] bg-[rgba(34,211,238,.10)]" /> : null}
            <button
              type="button"
              aria-label={collapsed.has(id) ? d("layers.expand", "Expand") : d("layers.collapse", "Collapse")}
              className={`grid size-4 place-items-center rounded ${hasKids ? "text-[var(--fg-subtle)] hover:text-[var(--fg)]" : "invisible"}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                });
              }}
            >
              <ChevronDown size={12} className={collapsed.has(id) ? "-rotate-90" : ""} />
            </button>
            <TypeIcon type={node.type as NodeType} size={13} className="shrink-0 text-[var(--accent)]" />
            <span className="min-w-0 flex-1 truncate">{node.name || node.type}</span>
            {id !== doc.root ? (
              <span className="flex items-center opacity-0 group-hover:opacity-100">
                <button type="button" title={node.hidden ? d("act.show", "Show") : d("act.hide", "Hide")} className="grid size-5 place-items-center rounded hover:text-[var(--fg)]" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); commit(updateNode(doc, id, { hidden: node.hidden ? undefined : true })); }}>
                  {node.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button type="button" title={node.locked ? d("act.unlock", "Unlock") : d("act.lock", "Lock")} className="grid size-5 place-items-center rounded hover:text-[var(--fg)]" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); commit(updateNode(doc, id, { locked: node.locked ? undefined : true })); }}>
                  {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
              </span>
            ) : null}
            {node.locked ? <Lock size={11} className="text-[var(--fg-subtle)] group-hover:hidden" /> : null}
          </div>
        );
      })}
    </div>
  );
}
