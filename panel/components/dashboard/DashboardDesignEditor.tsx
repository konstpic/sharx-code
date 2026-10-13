"use client";
import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Modal,Button,SelectNative} from '@/components/ui';
import {Canvas,type CanvasOps,type CanvasHandle} from '@/components/settings/subscription/designer/Canvas';
import {Inspector} from '@/components/settings/subscription/designer/Inspector';
import {InsertContext} from '@/components/settings/subscription/designer/ui';
import {useD} from '@/components/settings/subscription/designer/i18n';
import {DASHBOARD_FORMS,dashboardForm,metricContext,EMPTY_LAYOUT_DATA} from '@/lib/dashboardDesign';
import {newDoc,insertSubtree,extractSubtree,removeNode,duplicateNode,wrapInFrame,wrapInRow,unwrapFrame,shiftNode,reidSubtree,type Subtree} from '@/lib/subLayout/tree';
import type {LayoutDoc} from '@/lib/subLayout/types';
import type {DashboardMetric} from '@/lib/dashboardMetrics';
export function DashboardDesignEditor({doc,onChange,metrics}:{doc:LayoutDoc;onChange:(doc:LayoutDoc)=>void;metrics:DashboardMetric[]}) {
 const {t,i18n}=useTranslation();const d=useD();const lang=i18n.language?.startsWith('ru')?'ru':'en';const [open,setOpen]=useState(false);const [sel,setSel]=useState<string[]>([doc.root]);const [bp,setBp]=useState<'base'|'mobile'>('base');const [tab,setTab]=useState('forms');const registry=useRef<{current:((s:string)=>void)|null}>({current:null});const canvas=useRef<CanvasHandle>(null);const clip=useRef<Subtree|null>(null);const undo=useRef<LayoutDoc[]>([]);const ctx={...metricContext(metrics),vars:doc.vars};
 const commit:CanvasOps['commit']=(next,opts)=>{undo.current=[...undo.current.slice(-29),doc];onChange(next);if(opts?.sel)setSel(opts.sel)};
 const ops:CanvasOps={select:setSel,commit,remove:ids=>{let next=doc;for(const id of ids)next=removeNode(next,id);commit(next,{sel:[next.root]})},duplicate:ids=>{let next=doc;const selected:string[]=[];for(const id of ids){const out=duplicateNode(next,id);if(out){next=out.doc;selected.push(out.id)}}commit(next,{sel:selected})},group:ids=>{const out=wrapInFrame(doc,ids);if(out)commit(out.doc,{sel:[out.id]})},wrapRow:ids=>{const out=wrapInRow(doc,ids);if(out)commit(out.doc,{sel:[out.id]})},ungroup:id=>commit(unwrapFrame(doc,id),{sel:[doc.root]}),shift:(id,n)=>commit(shiftNode(doc,id,n)),copy:ids=>{if(ids[0])clip.current=extractSubtree(doc,ids[0])},paste:()=>{if(clip.current)commit(insertSubtree(doc,doc.root,doc.nodes[doc.root].children?.length??0,reidSubtree(clip.current)))}};
 const variables=['metric.label','metric.value','metric.display','metric.percent','metric.max','metric.updatedAt','dashboard.title',...metrics.map(m=>'byId.'+m.id.replace(/[^a-zA-Z0-9_]/g,'_')+'.value')];
 return <><Button variant="secondary" onClick={()=>{setSel([doc.root]);setOpen(true)}}>{t('pages.builder.openDesigner')}</Button>
 <Modal portalClassName="!z-[120]" lockBodyScroll={false} open={open} onClose={()=>setOpen(false)} title={t('pages.builder.openDesigner')} width={1400}>
 <InsertContext.Provider value={registry.current}>
  <div className="mb-3 flex flex-wrap items-center gap-2"><SelectNative aria-label={t('pages.builder.device')} value={bp} onChange={e=>setBp(e.target.value as typeof bp)} className="!w-auto"><option value="base">Desktop</option><option value="mobile">Mobile</option></SelectNative><Button variant="secondary" disabled={!undo.current.length} onClick={()=>{const last=undo.current.pop();if(last)onChange(last)}}>{t('pages.builder.undo')}</Button><Button variant="secondary" onClick={()=>setOpen(false)} className="ml-auto">{t('pages.builder.done')}</Button></div>
  <div className="grid max-h-[70vh] min-h-[500px] grid-cols-1 gap-3 overflow-auto lg:grid-cols-[190px_minmax(350px,1fr)_300px]">
   <aside className="space-y-3 overflow-auto"><div className="flex gap-2"><Button variant="secondary" onClick={()=>setTab('forms')} className="!text-xs">{t('pages.builder.forms')}</Button><Button variant="secondary" onClick={()=>setTab('vars')} className="!text-xs">{t('pages.builder.variables')}</Button></div>
    {tab==='forms'?<>{DASHBOARD_FORMS.map(item=><button key={item.id} type="button" onClick={()=>{const form=dashboardForm(item,lang);const children=form.nodes[form.root].children??[];let next=doc;for(const id of children)next=insertSubtree(next,next.root,next.nodes[next.root].children?.length??0,extractSubtree(form,id));commit(next)}} className="block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left hover:border-[var(--accent)]"><span className="text-xs font-medium">{(lang==='ru'?item.ru:item.en)[0]}</span><p className="mt-1 text-[10px] text-[var(--fg-muted)]">{item.id.startsWith('anim-')?t('pages.builder.animated'):t('pages.builder.static')}</p></button>)}<Button variant="secondary" onClick={()=>commit(newDoc(),{sel:[]})}>{t('pages.builder.clearCanvas')}</Button></>:<><p className="text-xs text-[var(--fg-muted)]">{t('pages.builder.variableHint')}</p>{variables.map(path=><button key={path} type="button" onClick={()=>registry.current.current?.('{{ '+path+' }}')} className="block w-full break-all rounded border border-[var(--border)] px-2 py-2 text-left font-mono text-[11px] hover:border-[var(--accent)]">{path}</button>)}</>}
   </aside>
   <div className="overflow-auto rounded-xl bg-[var(--bg-elevated)] p-3"><Canvas ref={canvas} doc={doc} sel={sel} data={EMPTY_LAYOUT_DATA} config={null} context={ctx} device={bp==='mobile'?'mobile':'desktop'} frameWidth={bp==='mobile'?390:540} zoom={1} bp={bp} ops={ops} d={d} lang={lang}/></div>
   <aside className="overflow-auto rounded-xl border border-[var(--border)]"><SelectNative aria-label={t('pages.builder.element')} value={sel[0]??doc.root} onChange={e=>setSel([e.target.value])} className="!text-xs">{Object.values(doc.nodes).map(node=><option key={node.id} value={node.id}>{node.name??node.type}</option>)}</SelectNative><Inspector doc={doc} sel={sel.length?sel:[doc.root]} ctx={ctx} lang={lang} bp={bp} setBp={setBp} commit={commit} d={d} onDelete={()=>ops.remove(sel)} onDuplicate={()=>ops.duplicate(sel)}/></aside>
  </div>
 </InsertContext.Provider>
 </Modal></>;
}
