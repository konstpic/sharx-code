import {normalizeDoc} from "./subLayout/tree";
import type {LayoutDoc} from "./subLayout/types";
import { DASHBOARD_WIDGET_ORDER, expandLegacyWidgetIds, type DashboardWidgetId } from './dashboardLayout';
import { entityTemplate, type EntityTemplateContext } from './dashboardMetricsTemplates';
import { GRID_VERSION, constraintsForKind, defaultBuiltinGrid, legacyToGrid, parseGridState, tileKind, type ConstraintsOf, type GridItem } from './dashboardGrid';
export type TileSettings = { width: number; height: number; view: string; title: string; color?:string; min?:number; max?:number; precision?:number; fixedScale?:boolean };
export type CustomPanel = {id:string;title:string;kind:'metric'|'html'|'embed'|'text'|'design';design?:LayoutDoc;metrics:string[];code:string;url:string;text:string};
/** `order`/`tiles[id].width|height` are the legacy sizing model, kept for old panels and as migration source. `grid` (marked by `gridVersion`) holds the desktop 12-column positions. */
export type DashboardLayout = { version: 1; order: string[]; tiles: Record<string,TileSettings>; panels:CustomPanel[]; gridVersion?: typeof GRID_VERSION; grid?: GridItem[] };
export type DashboardBoard = {id:string;name:string;layout:DashboardLayout;enabled:DashboardWidgetId[]};
export type DashboardWorkspace = {version:2;activeId:string;boards:DashboardBoard[];telemtDc?:true};
/** Layouts saved before the Telemt DC tile existed get it once (non-empty boards only); after that, removing it sticks. */
const seedTelemtDc=(boards:DashboardBoard[],done:boolean)=>done?boards:boards.map(b=>b.enabled.length&&!b.enabled.includes('telemt_dc')?{...b,enabled:[...b.enabled,'telemt_dc' as DashboardWidgetId]}:b);
export const defaultTile = (id:string):TileSettings => ({width:id==='resources'||id==='telemt_dc'?12:id==='logs'||id==='core_versions'||id==='backup'?4:6,height:id==='resources'?11:id==='logs'||id==='core_versions'||id==='backup'?5:id==='net_speed'||id==='user_agent'?7:6,view:'default',title:''});
export const defaultLayout = ():DashboardLayout => ({version:1,order:[...DASHBOARD_WIDGET_ORDER],tiles:{},panels:[],gridVersion:GRID_VERSION,grid:defaultBuiltinGrid()});
/** Min/max tile size by kind (stat, chart, table...), from the tile's selected view and panel kind. */
export const layoutConstraints = (layout:Pick<DashboardLayout,'tiles'|'panels'>):ConstraintsOf => (id)=>constraintsForKind(tileKind(id,layout.tiles[id]?.view,layout.panels.find(p=>p.id===id)?.kind));
const clamp=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
export function parseLayout(raw:string|null):DashboardLayout {
 try {
  const data=JSON.parse(raw??'null');if(data?.version!==1||!Array.isArray(data.order))return defaultLayout();
  const panels:CustomPanel[]=[];
  for(const p of Array.isArray(data.panels)?data.panels.slice(0,24):[]) {
   if(!p||typeof p.id!=='string'||!/^custom-[a-zA-Z0-9-]+$/.test(p.id)||panels.some(x=>x.id===p.id))continue;
   const design=p.design&&Object.keys(p.design.nodes??{}).length<=200?normalizeDoc(p.design):null;
   panels.push({...(design?{design}:{}),id:p.id,title:typeof p.title==='string'?p.title.slice(0,100):'',kind:['metric','html','embed','text','design'].includes(p.kind)?p.kind:'metric',metrics:Array.isArray(p.metrics)?p.metrics.filter((x:unknown)=>typeof x==='string').slice(0,8):[],code:typeof p.code==='string'?p.code.slice(0,20000):'',url:typeof p.url==='string'?p.url.slice(0,2000):'',text:typeof p.text==='string'?p.text.slice(0,20000):''});
  }
  const keys:string[]=[...DASHBOARD_WIDGET_ORDER,...panels.map(p=>p.id)];
  const order=[...new Set<string>(expandLegacyWidgetIds(data.order).filter((x:string)=>keys.includes(x)))];
  const tiles:Record<string,TileSettings>={};
  for(const id of keys){const p=data.tiles?.[id];if(!p)continue;const base=defaultTile(id);tiles[id]={width:Math.round(clamp(p.width,3,12,base.width)),height:Math.round(clamp(p.height,3,24,base.height)),view:typeof p.view==='string'?p.view:'default',title:typeof p.title==='string'?p.title.slice(0,100):'',color:typeof p.color==='string'&&/^#[0-9a-f]{6}$/i.test(p.color)?p.color:undefined,min:clamp(p.min,-1e15,1e15,0),max:clamp(p.max,-1e15,1e15,100),precision:Math.round(clamp(p.precision,0,3,1)),fixedScale:p.fixedScale===true};}
  const fullOrder=[...order,...keys.filter(x=>!order.includes(x))];
  const constraints=layoutConstraints({tiles,panels});
  let grid=parseGridState(data,{ids:keys,constraints});
  if(!grid)grid=legacyToGrid({order:fullOrder,tiles},keys,constraints);
  return {version:1,order:fullOrder,tiles,panels,gridVersion:GRID_VERSION,grid};
 }catch{return defaultLayout()}
}
export function parseWorkspace(raw:string|null,legacyEnabled:DashboardWidgetId[]):DashboardWorkspace {
 try {const data=JSON.parse(raw??'null');if(data?.version===2&&Array.isArray(data.boards)){
  const boards:DashboardBoard[]=data.boards.slice(0,12).filter((b:unknown)=>b&&typeof b==='object'&&typeof (b as {id?:unknown}).id==='string').map((b:{id:string;name?:unknown;layout?:unknown;enabled?:unknown})=>({id:b.id.slice(0,100),name:typeof b.name==='string'?b.name.slice(0,60):'Dashboard',layout:parseLayout(JSON.stringify(b.layout)),enabled:Array.isArray(b.enabled)?[...new Set<DashboardWidgetId>(expandLegacyWidgetIds(b.enabled).filter((x)=>DASHBOARD_WIDGET_ORDER.includes(x as DashboardWidgetId)) as DashboardWidgetId[])]:legacyEnabled}));
  const unique=boards.filter((b,i)=>boards.findIndex(x=>x.id===b.id)===i);if(unique.length)return {version:2,telemtDc:true,boards:seedTelemtDc(unique,data.telemtDc===true),activeId:unique.some(b=>b.id===data.activeId)?data.activeId:unique[0].id};
 }}catch{/* migrate legacy layout */}
 let enabled=legacyEnabled;try{const data=JSON.parse(raw??'null');if(Array.isArray(data?.enabled))enabled=expandLegacyWidgetIds(data.enabled).filter((id)=>DASHBOARD_WIDGET_ORDER.includes(id as DashboardWidgetId)) as DashboardWidgetId[]}catch{/* defaults */}
 return {version:2,telemtDc:true,activeId:'main',boards:seedTelemtDc([{id:'main',name:'Dashboard',layout:parseLayout(raw),enabled}],false)};
}
export function saveActiveBoard(workspace:DashboardWorkspace,layout:DashboardLayout,enabled:DashboardWidgetId[]):DashboardWorkspace {
 return {...workspace,boards:workspace.boards.map(b=>b.id===workspace.activeId?{...b,layout,enabled}:b)};
}
/** `ctx` (live node / balancer lists) is only used by the 'nodes' and 'balancers' overview templates. */
export function dashboardTemplate(kind:string,t:(key:string)=>string,ctx?:EntityTemplateContext):DashboardBoard {
 if(kind==='nodes'||kind==='balancers'){
  const e=entityTemplate(kind,t,ctx);const order=[...e.panels.map(p=>p.id),...DASHBOARD_WIDGET_ORDER];
  return {id:'board-'+crypto.randomUUID(),name:e.name,enabled:[],layout:{version:1,order,panels:e.panels,tiles:e.tiles,gridVersion:GRID_VERSION,grid:legacyToGrid({order,tiles:e.tiles},e.panels.map(p=>p.id),layoutConstraints({tiles:e.tiles,panels:e.panels}))}};
 }
 const ids=kind==='network'?['network.up','network.down','network.tcp','network.udp','network.sent','network.received']:kind==='minimal'?['cpu','mem.percent','clients.online','nodes.availability']:['cpu','mem.percent','disk.percent','clients.online','nodes.availability','panel.uptime','cpu','mem.percent','network.up','network.down'];
 const panels:CustomPanel[]=ids.map((metric,i)=>({id:'custom-'+kind+'-'+i,title:'',kind:'metric',metrics:[metric],code:'',url:'',text:''}));
 const views=kind==='monitoring'?['gauge','radial','progress','stat','donut','stat','area','line','area','bar']:ids.map((_,i)=>kind==='network'&&i<2?'area':'stat');
 const tiles:Record<string,TileSettings>={};panels.forEach((panel,i)=>{tiles[panel.id]={width:kind==='monitoring'&&i>=6?6:kind==='network'&&i<2?6:3,height:kind==='monitoring'&&i>=6||kind==='network'&&i<2?6:4,view:views[i],title:'',color:['#38bdf8','#a78bfa','#22c55e','#f59e0b'][i%4],min:0,max:panel.metrics[0].includes('percent')||panel.metrics[0]==='cpu'||panel.metrics[0]==='nodes.availability'?100:undefined,precision:1}});
 const order=[...panels.map(p=>p.id),...DASHBOARD_WIDGET_ORDER];
 return {id:'board-'+crypto.randomUUID(),name:t('pages.builder.'+(kind==='network'?'groupNetwork':kind)),enabled:[],layout:{version:1,order,panels,tiles,gridVersion:GRID_VERSION,grid:legacyToGrid({order,tiles},panels.map(p=>p.id),layoutConstraints({tiles,panels}))}};
}
