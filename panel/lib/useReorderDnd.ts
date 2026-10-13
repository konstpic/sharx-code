"use client";

import {useEffect,useRef,type HTMLAttributes,type PointerEvent as ReactPointerEvent} from "react";

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
  /** Reserved for non-native previews; native dragging keeps DOM order stable until drop. */
  order: number[] | null;
  draggingId: number | null;
  /** Props for the draggable row / card element. */
  itemProps: (id: number) => HTMLAttributes<HTMLElement> & { draggable: boolean };
  /** Props for the grip handle: arms dragging only when the drag starts from it. */
  handleProps: (id: number) => HTMLAttributes<HTMLElement>;
};

/** Pointer-based ordering keeps the DOM stable throughout the gesture, including WebKit. */
export function useReorderDnd({ids,enabled,orientation,onReorder}:{ids:number[];enabled:boolean;orientation:DndOrientation;onReorder:(ids:number[])=>void}):ReorderDnd {
 const latest=useRef({ids,enabled,orientation,onReorder});latest.current={ids,enabled,orientation,onReorder};
 const cancelRef=useRef<(()=>void)|null>(null);
 useEffect(()=>()=>cancelRef.current?.(),[]);
 const itemProps=(id:number)=>({draggable:false,"data-dnd-item":"","data-dnd-id":String(id)}) as HTMLAttributes<HTMLElement>&{draggable:boolean};
 const handleProps=(id:number):HTMLAttributes<HTMLElement>=>({
  onKeyDown:e=>{
   const step=e.key==='ArrowDown'||e.key==='ArrowRight'?1:e.key==='ArrowUp'||e.key==='ArrowLeft'?-1:0;
   if(!step||!latest.current.enabled)return;const current=latest.current.ids;const at=current.indexOf(id);const next=at+step;if(next<0||next>=current.length)return;
   e.preventDefault();e.stopPropagation();latest.current.onReorder(moveId(current,id,current[next],step>0?'after':'before'));
  },
  onPointerDown:(event:ReactPointerEvent<HTMLElement>)=>{
   if(!latest.current.enabled||event.button!==0)return;
   event.preventDefault();event.stopPropagation();cancelRef.current?.();
   const handle=event.currentTarget;const source=handle.closest<HTMLElement>('[data-dnd-item]');const container=source?.parentElement;
   if(!source||!container)return;
   handle.setPointerCapture(event.pointerId);
   const startX=event.clientX,startY=event.clientY,startIds=[...latest.current.ids];let active=false;let order=startIds;let marked:HTMLElement|null=null;
   const mark=(el:HTMLElement|null,pos?:string)=>{if(marked&&marked!==el)delete marked.dataset.dndDrop;marked=el;if(el&&pos)el.dataset.dndDrop=pos};
   const update=(e:PointerEvent)=>{
    const over=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-dnd-item]');
    if(!over||!container.contains(over)||over===source)return;
    const overId=Number(over.dataset.dndId);if(!startIds.includes(overId))return;
    const r=over.getBoundingClientRect(),origin=source.getBoundingClientRect();
    const vertical=latest.current.orientation==='vertical'||r.top>=origin.bottom-1||r.bottom<=origin.top+1;
    const fraction=vertical?(e.clientY-r.top)/r.height:(e.clientX-r.left)/r.width;
    const pos=fraction<0.5?'before':'after';order=moveId(startIds,id,overId,pos);mark(over,pos);
   };
   const move=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;if(!active&&Math.hypot(e.clientX-startX,e.clientY-startY)>=5){active=true;source.dataset.dndDragging='true'}if(active){e.preventDefault();update(e)}};
   const clean=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);delete source.dataset.dndDragging;mark(null);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);cancelRef.current=null};
   const end=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;if(active)update(e);const result=order;clean();if(active&&result.some((n,i)=>n!==startIds[i]))latest.current.onReorder(result)};
   const cancel=()=>clean();cancelRef.current=cancel;
   window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);
  }
 });
 return {enabled,order:null,draggingId:null,itemProps,handleProps};
}
