import {sizeFormat,formatSecond} from "./format";
export type MetricPoint={ts:number;value:number};
/** Warn/crit levels as metadata for tile styling; `invert` means a LOW value is bad (availability, healthy backends). */
export type Thresholds={warn:number;crit:number;invert?:boolean};
export type MetricLevel='ok'|'warn'|'crit';
export type DashboardMetric={id:string;label:string;group:string;value:number|null;unit:'percent'|'bytes'|'speed'|'seconds'|'count'|'load'|'ms'|'status';history?:'server'|'session';max?:number;points?:MetricPoint[];updatedAt?:number;
 /** Default warn/crit levels (cpu, memory, latency...). Display hint only; tiles may ignore it. */
 thresholds?:Thresholds;
 /** For unit 'status': readable text per numeric value (1 -> Online). */
 states?:Record<number,string>;
 /** Set for a saved metric id whose node/balancer no longer exists: the panel shows "no data" and the editor flags it. */
 unavailable?:boolean;
 /** Per-entity metrics carry the entity so the editor can group and filter by it. */
 entity?:{kind:'node'|'balancer';id:number}};
type Status={cpu:number;cpuCores:number;logicalPro?:number;cpuSpeedMhz?:number;mem:{current:number;total:number};disk:{current:number;total:number};swap:{current:number;total:number};loads:number[];netIO:{up:number;down:number};netTraffic:{sent:number;recv:number};tcpCount:number;udpCount:number;uptime:number;panelUptime?:number;appStats:{threads:number;mem:number;uptime:number};usersOnline?:number;xray?:{state?:string};telemt?:{state?:string;count?:number};nodes?:{online:number;total:number};nodesXray?:{total:number;running:number;stopped:number;error:number;unknown:number};nodesTelemt?:{total:number;running:number;stopped:number;unknown:number};database:{size:number;tables:number;totalRows:number;openConns:number;idleConns:number;maxOpenConns:number;maxIdleConns:number}};
export function dashboardMetrics(st:Status,t:(key:string)=>string):DashboardMetric[]{
 const out:DashboardMetric[]=[];
 const add=(id:string,key:string,group:string,value:number|undefined,unit:DashboardMetric['unit']='count',max?:number)=>out.push({id,label:t(key),group:t('pages.builder.group'+group),value:value!=null&&Number.isFinite(value)?value:null,unit,max});
 const pct=(a:number,b:number)=>b>0?a/b*100:0;
 add('cpu','pages.index.cpu','Resources',st.cpu,'percent',100);
 add('cpu.cores','pages.index.cores','Resources',st.cpuCores);add('cpu.frequency','pages.index.frequency','Resources',st.cpuSpeedMhz,'count');out[out.length-1].label+=' · MHz';
 for(const [key,obj,label] of [['mem',st.mem,'pages.index.memory'],['disk',st.disk,'pages.index.storage'],['swap',st.swap,'pages.index.swap']] as const){add(key+'.percent',label,'Resources',pct(obj.current,obj.total),'percent',100);add(key+'.used',label,'Resources',obj.current,'bytes',obj.total);out[out.length-1].label+=' · '+t('pages.builder.used');add(key+'.total',label,'Resources',obj.total,'bytes');out[out.length-1].label+=' · '+t('pages.builder.totalCapacity')}
 for(let i=0;i<3;i++)add('load.'+[1,5,15][i],'pages.builder.load'+[1,5,15][i],'Resources',st.loads?.[i],'load');
 add('network.up','pages.index.upload','Network',st.netIO.up,'speed');add('network.down','pages.index.download','Network',st.netIO.down,'speed');add('network.sent','pages.index.sent','Network',st.netTraffic.sent,'bytes');add('network.received','pages.index.received','Network',st.netTraffic.recv,'bytes');add('network.tcp','pages.index.statTCP','Network',st.tcpCount);add('network.udp','pages.index.statUDP','Network',st.udpCount);
 add('clients.online','pages.index.usersOnline','Clients',st.usersOnline);
 add('nodes.online','pages.builder.nodesOnline','NodesAgg',st.nodes?.online,'count',st.nodes?.total);add('nodes.total','pages.builder.nodesTotal','NodesAgg',st.nodes?.total);add('nodes.availability','pages.index.nodesAvailability','NodesAgg',st.nodes?pct(st.nodes.online,st.nodes.total):undefined,'percent',100);
 add('nodes.xray.running','pages.builder.xrayRunning','NodesAgg',st.nodesXray?.running);add('nodes.xray.stopped','pages.builder.xrayStopped','NodesAgg',st.nodesXray?.stopped);add('nodes.xray.error','pages.builder.xrayError','NodesAgg',st.nodesXray?.error);add('nodes.telemt.running','pages.builder.telemtRunning','NodesAgg',st.nodesTelemt?.running);
 const tm=st.nodesTelemt;
 add('telemt.running','pages.builder.telemtRunning','Telemt',tm?.running);add('telemt.stopped','pages.builder.telemtStopped','Telemt',tm?.stopped);add('telemt.unknown','pages.builder.telemtUnknown','Telemt',tm?.unknown);add('telemt.total','pages.builder.telemtTotal','Telemt',tm?.total);
 add('telemt.local.sidecars','pages.builder.telemtLocalSidecars','Telemt',st.telemt?.count);
 add('db.size','pages.index.dbSize','Database',st.database?.size,'bytes');add('db.tables','pages.index.dbTables','Database',st.database?.tables);add('db.rows','pages.index.dbRows','Database',st.database?.totalRows);add('db.connections','pages.index.dbConnections','Database',st.database?.openConns,'count',st.database?.maxOpenConns);add('db.idle','pages.builder.dbIdle','Database',st.database?.idleConns);
 add('panel.memory','pages.index.panelProcessHeap','Process',st.appStats?.mem,'bytes');add('panel.threads','pages.index.threads','Process',st.appStats?.threads);add('panel.uptime','pages.index.panelUptimeLabel','Process',st.panelUptime,'seconds');add('os.uptime','pages.index.osLabel','Process',st.uptime,'seconds');
 return out.map(withDefaultThresholds);
}

const DEFAULT_THRESHOLDS:Record<string,Thresholds>={cpu:{warn:70,crit:90},'mem.percent':{warn:80,crit:90},'disk.percent':{warn:80,crit:90},'swap.percent':{warn:30,crit:70},'nodes.availability':{warn:99,crit:80,invert:true}};
const withDefaultThresholds=(m:DashboardMetric):DashboardMetric=>DEFAULT_THRESHOLDS[m.id]&&!m.thresholds?{...m,thresholds:DEFAULT_THRESHOLDS[m.id]}:m;
/** Level of a metric against its thresholds; null when it has none or no value. */
export function metricLevel(m:Pick<DashboardMetric,'value'|'thresholds'>):MetricLevel|null{
 const th=m.thresholds;if(!th||m.value==null)return null;const v=m.value;
 if(th.invert)return v<=th.crit?'crit':v<=th.warn?'warn':'ok';
 return v>=th.crit?'crit':v>=th.warn?'warn':'ok';
}
export function formatMetric(metric:DashboardMetric,precision=1):string {
 if(metric.value==null)return '—';const n=metric.value;
 if(metric.unit==='status')return metric.states?.[n]??String(n);
 if(metric.unit==='ms')return n>=10000?(n/1000).toLocaleString(undefined,{maximumFractionDigits:1})+' s':n.toLocaleString(undefined,{maximumFractionDigits:0})+' ms';
 if(metric.unit==='bytes')return sizeFormat(n);if(metric.unit==='speed')return sizeFormat(n)+'/s';if(metric.unit==='seconds')return formatSecond(n);
 return n.toLocaleString(undefined,{maximumFractionDigits:metric.unit==='count'?0:precision})+(metric.unit==='percent'?'%':'');
}
