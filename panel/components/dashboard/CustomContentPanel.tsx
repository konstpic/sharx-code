"use client";
import ReactMarkdown from 'react-markdown';
import {useTranslation} from 'react-i18next';
import type {CustomPanel} from '@/lib/dashboardBuilder';
import type {DashboardMetric} from '@/lib/dashboardMetrics';
import {metricContext,EMPTY_LAYOUT_DATA} from '@/lib/dashboardDesign';
import {HtmlEmbed} from '@/components/sub/layout/HtmlEmbed';
import {LayoutRenderer} from '@/components/sub/layout/LayoutRenderer';
import {SubPageShell} from '@/components/sub/SubPageShell';
import {renderTemplate} from '@/lib/subLayout/template';
import {TileHeader} from '@/components/dashboard/AtomParts';
export const CUSTOM_HTML_EXAMPLE=`<style>body{margin:0;background:#101827;color:#e2e8f0;font-family:system-ui;padding:24px}small{color:#94a3b8}.value{font-size:48px;font-weight:700;margin-top:12px;color:#38bdf8}</style>
<small>{{ metric.label }}</small><div class="value">{{ metric.display }}</div>
<!-- JavaScript can read window.sub.metric and window.sub.metrics -->`;
export function CustomContentPanel({panel,metrics}:{panel:CustomPanel;metrics:DashboardMetric[]}) {
 const {t,i18n}=useTranslation();const lang=i18n.language?.slice(0,2)||'en';const context=metricContext(metrics,panel.title);
 return <div className="flex h-full min-h-0 flex-col"><div className="shrink-0 px-3 pt-2 empty:hidden"><TileHeader/></div><div className="relative min-h-0 flex-1 overflow-auto"><ContentBody panel={panel} metrics={metrics} context={context} lang={lang} t={t}/></div></div>;
}
function ContentBody({panel,context,lang,t}:{panel:CustomPanel;metrics:DashboardMetric[];context:ReturnType<typeof metricContext>;lang:string;t:(k:string)=>string}) {
 if(panel.kind==='design'&&panel.design)return <SubPageShell compact branding={{title:'',logoUrl:'',brandText:'',supportUrl:'',background:'plain',decorations:false}}><LayoutRenderer doc={panel.design} data={EMPTY_LAYOUT_DATA} config={null} context={context} interactive={false}/></SubPageShell>;
 if(panel.kind==='text')return <div className="prose prose-sm max-w-none p-5 text-[var(--fg)] [&_a]:text-[var(--accent)]"><ReactMarkdown>{renderTemplate(panel.text,context,{lang}).out}</ReactMarkdown></div>;
 if(panel.kind==='embed'){
  let safe=false;try{safe=new URL(panel.url).protocol==='https:'}catch{/* editor validates URL */}
  return safe?<iframe title={panel.title||t('pages.builder.embed')} src={panel.url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-full w-full border-0"/>:<div className="grid h-full place-items-center p-4 text-sm text-[var(--fg-muted)]">{t('pages.builder.httpsUrl')}</div>;
 }
 return <HtmlEmbed html={panel.code} ctx={context} lang={lang} id={panel.id} allowScripts fill height={280} style={{height:'100%'}}/>;
}
