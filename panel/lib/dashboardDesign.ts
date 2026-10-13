import {CATALOG,type CatalogItem} from './subLayout/catalog';
import {insertSubtree,newDoc} from './subLayout/tree';
import type {LayoutDoc} from './subLayout/types';
import type {Ctx} from './subLayout/template';
import type {DashboardMetric} from './dashboardMetrics';
import {formatMetric} from './dashboardMetrics';
import type {PublicSubPayload} from '@/components/sub/types';
// The renderer never receives an authenticated API payload or a subscription token.
export const EMPTY_LAYOUT_DATA:PublicSubPayload={config:{},configUuid:'',subscriptionUrl:'',subscriptionJsonUrl:'',links:[],user:{shortUuid:'',daysLeft:0,trafficUsed:'',trafficLimit:'',expiresAt:'',isActive:false,userStatus:''}};
export function metricContext(metrics:DashboardMetric[],title=''):Ctx {
 const entries=metrics.map(m=>({id:m.id,label:m.label,value:m.value,display:formatMetric(m),unit:m.unit,max:m.max??100,percent:m.value==null?0:Math.round(Math.max(0,Math.min(100,m.value/(m.max||100)*100))*10)/10,updatedAt:m.updatedAt??0}));
 const byId:Record<string,unknown>=Object.create(null);for(const entry of entries)byId[entry.id.replace(/[^a-zA-Z0-9_]/g,'_')]=entry;
 return {metric:entries[0]??{label:'',value:null,display:'—',max:100,percent:0},metrics:entries,byId,dashboard:{title},now:Date.now()};
}
const ids=['traffic-bar','stat-trio','anim-gauge','anim-conic-border','anim-tilt','anim-shine','anim-online','greeting'];
export const DASHBOARD_FORMS:CatalogItem[]=ids.flatMap(id=>{const item=CATALOG.find(i=>i.id===id);return item?[item]:[]});
/** Keep the shared catalog geometry, CSS, animation and parameters, bind it to real metrics. */
export function dashboardForm(item:CatalogItem,lang:'ru'|'en'):LayoutDoc {
 const sub=item.build(lang);
 const replacements:Record<string,string>={'user.percentUsed':'metric.percent','user.trafficUsedBytes':'metric.value','user.trafficLimitBytes':'metric.max','user.trafficUsed':'metric.display','user.trafficLimit':'metric.max','user.username':'metric.label','user.daysLeft':'metric.display','user.neverExpires':'false','user.unlimited':'false','user.userStatus':'metric.display','user.isActive':'true','devices.count':'metric.value','devices.max':'metric.max','devices.unlimited':'false'};
 const walk=(v:unknown):unknown=>typeof v==='string'?Object.entries(replacements).reduce((s,[from,to])=>s.replaceAll(from,to),v).replace(/трафика использовано|of traffic used/g,'').replace(/дн\. осталось|days left/g,'').replace(/^Трафик$|^Traffic$/g,'{{ metric.label }}').replace(/С возвращением|Welcome back/g,lang==='ru'?'Метрика':'Metric'):Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)])):v;
 const adapted={...sub,nodes:walk(sub.nodes) as typeof sub.nodes};
 if(item.id==='stat-trio'){
  const tiles=adapted.nodes[adapted.root].children??[];
  tiles.forEach((id,i)=>{const texts=(adapted.nodes[id]?.children??[]).map(key=>adapted.nodes[key]);if(texts[0])texts[0].props.text='{{ metrics['+i+'].label | default("—") }}';if(texts[1])texts[1].props.text='{{ metrics['+i+'].display | default("—") }}'});
 }

 const doc=newDoc({name:'Dashboard panel',style:{mode:'stack',dir:'column',gap:12,pad:12,w:'fill'}});
 return insertSubtree(doc,doc.root,0,adapted);
}
