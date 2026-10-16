import type {LayoutDoc} from "./subLayout/types";
import { DASHBOARD_WIDGET_ORDER, expandLegacyWidgetIds, ALL_ATOM_IDS } from './dashboardLayout';
import type { EntityTemplateContext } from './dashboardMetricsTemplates';
import { GRID_VERSION, GRID_COLS, constraintsForKind, legacyToGrid, loadSavedGrid, compact, tidyGrid, tileKind, type ConstraintsOf, type GridItem } from './dashboardGrid';
import { MAX_PANELS, defaultPanelGrid, defaultPanelSet, migrateLayoutToV4, sanitizePanel, sanitizeTile } from './dashboardModel';
import { parseMine, rowsBundle, templateRows, type MyEntry } from './dashboardCatalog';
export type TileSettings = { width: number; height: number; view: string; title: string; color?:string; min?:number; max?:number; precision?:number; fixedScale?:boolean; /** false hides the tile's own heading in view mode (edit mode always shows the title bar instead). */ showTitle?:boolean; /** Override of the metric's warn / crit levels (colouring of the value). */ warn?:number; crit?:number };
/** One tile model: `metric` shows metrics in a look, `widget` is a purpose-built tile (`widget` names it), the rest is free content. `preset` remembers the catalog atom the tile was made from. */
export type CustomPanel = {id:string;title:string;kind:'metric'|'widget'|'html'|'embed'|'text'|'design';design?:LayoutDoc;metrics:string[];code:string;url:string;text:string;widget?:string;preset?:string};
/** `tiles[id]` holds the settings of every tile (all tiles are `panels`). `grid` (marked by `gridVersion`) holds the desktop 12-column positions; `order`, `tiles[id].width|height` are the legacy sizing model kept as migration source. */
export type DashboardLayout = { version: 1; order: string[]; tiles: Record<string,TileSettings>; panels:CustomPanel[]; gridVersion?: typeof GRID_VERSION; grid?: GridItem[] };
/** `enabled` is the former on/off model of the built-in widgets; it is only read to migrate old boards and is always empty afterwards. */
export type DashboardBoard = {id:string;name:string;layout:DashboardLayout;enabled:string[]};
export type DashboardWorkspace = {version:2;activeId:string;boards:DashboardBoard[];telemtDc?:true;/** tiles and sets the user saved in the catalog */mine?:MyEntry[]};
/** Legacy width/height fields (12ths / 56 px rows); only used for the initial size of tiles without a grid position. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const defaultTile = (_id?:string):TileSettings => ({width:6,height:6,view:'default',title:''});
const gridOf=(g:GridItem[],cons:ConstraintsOf)=>compact(g,GRID_COLS,cons);
/** A dashboard without any tile ("New dashboard"). */
export const emptyLayout = ():DashboardLayout => ({version:1,order:[],tiles:{},panels:[],gridVersion:GRID_VERSION,grid:[]});
export const defaultLayout = ():DashboardLayout => {const set=defaultPanelSet();return {version:1,order:set.panels.map(p=>p.id),tiles:set.tiles,panels:set.panels,gridVersion:GRID_VERSION,grid:defaultPanelGrid()}};
/** Min/max tile size by kind (stat, chart, table...), from the tile's selected view, panel kind and widget. */
export const layoutConstraints = (layout:Pick<DashboardLayout,'tiles'|'panels'>):ConstraintsOf => (id)=>{const p=layout.panels.find(x=>x.id===id);return constraintsForKind(tileKind(id,layout.tiles[id]?.view,p?.kind,p?.widget))};
/** `enabled`: the built-in widgets that were switched on in a layout older than v4 (they become ordinary tiles). Default: all. */
export function parseLayout(raw:string|null,enabled:readonly unknown[]=DASHBOARD_WIDGET_ORDER):DashboardLayout {
 try {
  const data=JSON.parse(raw??'null');if(data?.version!==1||!Array.isArray(data.order))return defaultLayout();
  const panels:CustomPanel[]=[];
  for(const p of Array.isArray(data.panels)?data.panels.slice(0,MAX_PANELS):[]) {const s=sanitizePanel(p);if(s&&!panels.some(x=>x.id===s.id))panels.push(s)}
  const current=data.gridVersion===GRID_VERSION;
  const keys:string[]=current?panels.map(p=>p.id):[...ALL_ATOM_IDS,...panels.map(p=>p.id)];
  const order=[...new Set<string>(expandLegacyWidgetIds(data.order).filter((x:string)=>keys.includes(x)))];
  let tiles:Record<string,TileSettings>={};
  for(const id of keys){const p=data.tiles?.[id];if(!p)continue;tiles[id]=sanitizeTile(p,defaultTile(id))}
  const fullOrder=[...order,...keys.filter(x=>!order.includes(x))];
  const constraints=layoutConstraints({tiles,panels});
  let grid=loadSavedGrid(data,{ids:keys,constraints,legacyTiles:data.tiles});
  if(current){
   if(!grid)grid=gridOf(legacyGrid(panels,tiles,fullOrder,constraints),constraints);
   return {version:1,order:panels.map(p=>p.id),tiles,panels,gridVersion:GRID_VERSION,grid};
  }
  if(!grid)grid=[];
  const moved=migrateLayoutToV4({panels,tiles,grid,enabled});
  const layoutC=layoutConstraints({tiles:moved.tiles,panels:moved.panels});
  tiles=moved.tiles;
  return {version:1,order:moved.panels.map(p=>p.id),tiles,panels:moved.panels,gridVersion:GRID_VERSION,grid:compact(moved.grid,GRID_COLS,layoutC)};
 }catch{return defaultLayout()}
}
function legacyGrid(panels:CustomPanel[],tiles:Record<string,TileSettings>,order:string[],cons:ConstraintsOf):GridItem[]{return legacyToGrid({order,tiles},panels.map(p=>p.id),cons)}
export function parseWorkspace(raw:string|null,legacyEnabled:readonly string[]):DashboardWorkspace {
 const mineOf=(d:unknown)=>{const m=parseMine((d as {mine?:unknown})?.mine);return m.length?{mine:m}:{}};
 /** Layouts saved before the Telemt DC tile existed get it once (non-empty boards only); after that, removing it sticks. */
 const withTelemt=(en:string[],done:boolean)=>done||!en.length||en.includes('telemt_dc')?en:[...en,'telemt_dc'];
 try {const data=JSON.parse(raw??'null');if(data?.version===2&&Array.isArray(data.boards)){
  const rawBoards=data.boards.slice(0,12).filter((b:unknown)=>b&&typeof b==='object'&&typeof (b as {id?:unknown}).id==='string');
  const boards:DashboardBoard[]=rawBoards.map((b:{id:string;name?:unknown;layout?:unknown;enabled?:unknown})=>{
   const enabled=withTelemt(Array.isArray(b.enabled)?expandLegacyWidgetIds(b.enabled):[...legacyEnabled],data.telemtDc===true);
   return {id:b.id.slice(0,100),name:typeof b.name==='string'?b.name.slice(0,60):'Dashboard',layout:parseLayout(JSON.stringify(b.layout),enabled),enabled:[]};
  });
  const unique=boards.filter((b,i)=>boards.findIndex(x=>x.id===b.id)===i);
  if(unique.length)return {version:2,telemtDc:true,...mineOf(data),boards:unique,activeId:unique.some(b=>b.id===data.activeId)?data.activeId:unique[0].id};
 }}catch{/* migrate legacy layout */}
 let enabled:string[]=[...legacyEnabled];try{const data=JSON.parse(raw??'null');if(Array.isArray(data?.enabled))enabled=expandLegacyWidgetIds(data.enabled)}catch{/* defaults */}
 return {version:2,telemtDc:true,activeId:'main',boards:[{id:'main',name:'Dashboard',layout:parseLayout(raw,withTelemt(enabled,false)),enabled:[]}]};
}
export function saveActiveBoard(workspace:DashboardWorkspace,layout:DashboardLayout):DashboardWorkspace {
 return {...workspace,boards:workspace.boards.map(b=>b.id===workspace.activeId?{...b,layout,enabled:[]}:b)};
}
/** `ctx` (live node / balancer lists) is only used by the 'nodes' and 'balancers' overview templates. Boards are built from the same sets as the catalog. */
export function dashboardTemplate(kind:string,t:(key:string)=>string,ctx?:EntityTemplateContext):DashboardBoard {
 const tpl=templateRows(kind,t,ctx)??{name:'Dashboard',rows:[]};
 const bundle=rowsBundle(tpl.rows,'custom-'+kind);
 const tiles=bundle.tiles;const panels=bundle.panels;
 const cons=layoutConstraints({tiles,panels});
 return {id:'board-'+crypto.randomUUID(),name:tpl.name,enabled:[],layout:{version:1,order:panels.map(p=>p.id),panels,tiles,gridVersion:GRID_VERSION,grid:tidyGrid(bundle.rects.map(r=>({...r})),cons)}};
}
