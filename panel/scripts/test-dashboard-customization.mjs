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
 const loaded={exports:{}};cache.set(target,loaded.exports);
 const js=ts.transpileModule(readFileSync(target,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 new Function('module','exports','require',js)(loaded,loaded.exports,name=>name.startsWith('.')?load(path.resolve(path.dirname(target),name+'.ts')):name.startsWith('@/')?load(path.resolve('panel',name.slice(2)+'.ts')):nativeRequire(name));
 return loaded.exports;
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
test('saved panel layouts round-trip and reject unknown tiles',()=>{
 const {gridVersion}=defaultLayout();
 const input={version:1,gridVersion,order:['custom-test','unknown','custom-test'],
  tiles:{'custom-test':{width:99,height:-5,title:'Network',view:'table'}},
  panels:[{id:'custom-test',title:'Network',kind:'metric',metrics:['cpu'],code:'',text:'',url:''}]};
 const layout=parseLayout(JSON.stringify(input));
 assert.deepEqual(layout.order,['custom-test']);
 assert.equal(layout.tiles['custom-test'].width,12);
 assert.equal(layout.tiles['custom-test'].height,3);
 assert.deepEqual(parseLayout(JSON.stringify(layout)),layout);
 assert.deepEqual(parseLayout('corrupted'),defaultLayout());
});

test('legacy network and quick actions expand into independent tiles',()=>{
 const {expandLegacyWidgetIds,parseDashboardWidgets}=load('panel/lib/dashboardLayout.ts');
 const network=['net_up','net_down','net_total_sent','net_total_received','net_tcp','net_udp','server_ip'];
 const actions=['logs','xray_version','telemt_version','core_update','core_controls','backup_export','backup_import','backup_config'];
 assert.deepEqual(expandLegacyWidgetIds(['network','logs','quick_actions']),[...network,...actions]);
 assert.deepEqual(new Set(parseDashboardWidgets(JSON.stringify(['network','quick_actions']))),new Set([...network,...actions]));
});

test('legacy visibility migrates to panels and a second board stays independent',()=>{
 const old={version:1,order:['net_speed','logs'],enabled:['net_speed','logs']};
 const workspace=parseWorkspace(JSON.stringify(old),['resources']);
 const first=workspace.boards[0];
 assert.deepEqual(new Set(first.layout.order),new Set(['custom-net-up','custom-net-down','custom-logs','custom-telemt-dc']));
 const second={id:'second',name:'Second',layout:defaultLayout(),enabled:[]};
 workspace.boards.push(second);
 const changed=saveActiveBoard(workspace,second.layout);
 assert.deepEqual(changed.boards[0].layout,second.layout);
 assert.equal(changed.boards[1],second);
 assert.deepEqual(parseWorkspace(JSON.stringify(changed),[]).boards.map(b=>b.layout.order),changed.boards.map(b=>b.layout.order));
});
test('dashboard reuses valid subscription layouts and template variables without exposing credentials',()=>{
 const {dashboardForm,DASHBOARD_FORMS,metricContext}=load('panel/lib/dashboardDesign.ts');
 const {normalizeDoc}=load('panel/lib/subLayout/tree.ts');
 const {renderTemplate}=load('panel/lib/subLayout/template.ts');
 const ctx=metricContext([{id:'cpu',label:'CPU',value:42,unit:'percent',max:100}]);
 assert.equal(renderTemplate('{{ metric.display }}',ctx).out,'42%');assert.equal('subscription' in ctx,false);assert.equal('publicIP' in ctx,false);
 for(const item of DASHBOARD_FORMS){const doc=dashboardForm(item,'ru');assert.ok(normalizeDoc(doc));assert.equal(JSON.stringify(doc).includes('user.percentUsed'),false)}
});
