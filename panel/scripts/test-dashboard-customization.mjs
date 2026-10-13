import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const nativeRequire=createRequire(path.resolve('panel/package.json'));
const cache=new Map();
function load(file) {
 const target=path.resolve(file);if(cache.has(target))return cache.get(target);
 const module={exports:{}};cache.set(target,module.exports);
 const js=ts.transpileModule(readFileSync(target,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('module','exports','require',js)(module,module.exports,name=>name.startsWith('.')?load(path.resolve(path.dirname(target),name+'.ts')):name.startsWith('@/')?load(path.resolve('panel',name.slice(2)+'.ts')):nativeRequire(name));
 return module.exports;
}
const {matchesColumnFilter:match}=load('panel/lib/columnFilters.ts');
const {parseLayout,defaultLayout,parseWorkspace,saveActiveBoard}=load('panel/lib/dashboardBuilder.ts');
test('byte and speed comparisons, equality and ranges retain units',()=>{
 assert.equal(match(2*1024**3,'> 1 GB','bytes'),true);
 assert.equal(match(2*1024**3,'<= 1 GB','bytes'),false);
 assert.equal(match(2*1024**3,'1 GB..3 GB','bytes'),true);
 assert.equal(match(2e6,'= 2 Mbps','speed'),true);
 assert.equal(match(2e6,'>= 3 Mbps','speed'),false);
 assert.equal(match(2e6,'>= invalid','speed'),false);
 assert.equal(match(0,'= 0','number'),true);
 assert.equal(match('UK-1','uk','text'),true);
 assert.equal(match('UK-1','!= UK-1','text'),false);
});
test('date comparisons include the selected whole local day',()=>{
 const noon=new Date('2026-10-12T12:00:00').getTime();
 assert.equal(match(noon,'= 2026-10-12','date'),true);
 assert.equal(match(noon,'<= 2026-10-12','date'),true);
 assert.equal(match(noon,'> 2026-10-12','date'),false);
 assert.equal(match(noon,'2026-10-11..2026-10-12','date'),true);
 assert.equal(match(null,'нет','date'),true);
});
test('dashboard layout survives serialization, sanitizes bounds and fills new widgets',()=>{
 const parsed=parseLayout(JSON.stringify({version:1,order:['net_speed','net_speed','unknown','resources'],tiles:{net_speed:{width:99,height:-5,view:'table',title:'Network'}}}));
 assert.deepEqual(parsed.order.slice(0,2),['net_speed','resources']);
 assert.equal(new Set(parsed.order).size,parsed.order.length);
 assert.equal(parsed.tiles.net_speed.width,12);assert.equal(parsed.tiles.net_speed.height,3);
 assert.equal(parsed.tiles.net_speed.view,'table');assert.deepEqual(parseLayout(JSON.stringify(parsed)),parsed);
 assert.deepEqual(parseLayout('corrupted'),defaultLayout());
});

test('widgets that were split into several tiles keep every successor, in place',()=>{
 const {expandLegacyWidgetIds,parseDashboardWidgets,DASHBOARD_WIDGET_ORDER}=load('panel/lib/dashboardLayout.ts');
 assert.deepEqual(expandLegacyWidgetIds(['resources','quick_actions','uptime','network']),['resources','logs','core_versions','backup','uptime','net_speed','net_traffic','net_sockets','server_ip']);
 assert.deepEqual(expandLegacyWidgetIds(['logs','quick_actions']),['logs','core_versions','backup']);
 assert.deepEqual(parseDashboardWidgets(JSON.stringify(['quick_actions','network'])),['logs','core_versions','backup','net_speed','net_traffic','net_sockets','server_ip']);
 // old saved order: the successors take the place of the old id, new widgets are appended
 const layout=parseLayout(JSON.stringify({version:1,order:['resources','quick_actions','uptime','network']}));
 assert.deepEqual(layout.order.slice(0,9),['resources','logs','core_versions','backup','uptime','net_speed','net_traffic','net_sockets','server_ip']);
 assert.equal(new Set(layout.order).size,DASHBOARD_WIDGET_ORDER.length);
 assert.equal(layout.order.includes('quick_actions')||layout.order.includes('network'),false);
});

test('legacy dashboard migrates without losing order, size, or visibility; boards stay independent',()=>{
 const old={version:1,order:['net_speed','resources'],tiles:{net_speed:{width:8,height:7,view:'table',title:'Network'}},enabled:['network','quick_actions']};
 const workspace=parseWorkspace(JSON.stringify(old),['resources']);
 assert.deepEqual(workspace.boards[0].enabled,['net_speed','net_traffic','net_sockets','server_ip','logs','core_versions','backup','telemt_dc']);
 assert.equal(workspace.boards[0].layout.tiles.net_speed.width,8);
 workspace.boards.push({id:'second',name:'Second',layout:defaultLayout(),enabled:[]});
 const changed=saveActiveBoard(workspace,{...workspace.boards[0].layout,panels:[{id:'custom-test',title:'Test',kind:'metric',metrics:['cpu'],code:'',text:'',url:''}]},['net_speed']);
 const restored=parseWorkspace(JSON.stringify(changed),['resources']);
 assert.equal(restored.boards[0].layout.panels.length,1);assert.equal(restored.boards[1].layout.panels.length,0);assert.deepEqual(restored.boards[1].enabled,[]);
});
test('dashboard reuses valid subscription layouts and template variables without exposing credentials',()=>{
 const {dashboardForm,DASHBOARD_FORMS,metricContext}=load('panel/lib/dashboardDesign.ts');
 const {normalizeDoc}=load('panel/lib/subLayout/tree.ts');
 const {renderTemplate}=load('panel/lib/subLayout/template.ts');
 const ctx=metricContext([{id:'cpu',label:'CPU',value:42,unit:'percent',max:100}]);
 assert.equal(renderTemplate('{{ metric.display }}',ctx).out,'42%');assert.equal('subscription' in ctx,false);assert.equal('publicIP' in ctx,false);
 for(const item of DASHBOARD_FORMS){const doc=dashboardForm(item,'ru');assert.ok(normalizeDoc(doc));assert.equal(JSON.stringify(doc).includes('user.percentUsed'),false)}
});
