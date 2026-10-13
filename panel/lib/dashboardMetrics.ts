import {sizeFormat,formatSecond} from "./format";
export type MetricPoint={ts:number;value:number};
export type DashboardMetric={id:string;label:string;group:string;value:number|null;unit:'percent'|'bytes'|'speed'|'seconds'|'count'|'load';history?:'server'|'session';max?:number;points?:MetricPoint[];updatedAt?:number};
type Status={cpu:number;cpuCores:number;logicalPro?:number;cpuSpeedMhz?:number;mem:{current:number;total:number};disk:{current:number;total:number};swap:{current:number;total:number};loads:number[];netIO:{up:number;down:number};netTraffic:{sent:number;recv:number};tcpCount:number;udpCount:number;uptime:number;panelUptime?:number;appStats:{threads:number;mem:number;uptime:number};usersOnline?:number;nodes?:{online:number;total:number};nodesXray?:{total:number;running:number;stopped:number;error:number;unknown:number};nodesTelemt?:{total:number;running:number;stopped:number;unknown:number};database:{size:number;tables:number;totalRows:number;openConns:number;idleConns:number;maxOpenConns:number;maxIdleConns:number}};
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
 add('nodes.online','pages.builder.nodesOnline','Nodes',st.nodes?.online,'count',st.nodes?.total);add('nodes.total','pages.builder.nodesTotal','Nodes',st.nodes?.total);add('nodes.availability','pages.index.nodesAvailability','Nodes',st.nodes?pct(st.nodes.online,st.nodes.total):undefined,'percent',100);
 add('nodes.xray.running','pages.builder.xrayRunning','Nodes',st.nodesXray?.running);add('nodes.xray.stopped','pages.builder.xrayStopped','Nodes',st.nodesXray?.stopped);add('nodes.xray.error','pages.builder.xrayError','Nodes',st.nodesXray?.error);add('nodes.telemt.running','pages.builder.telemtRunning','Nodes',st.nodesTelemt?.running);
 add('db.size','pages.index.dbSize','Database',st.database?.size,'bytes');add('db.tables','pages.index.dbTables','Database',st.database?.tables);add('db.rows','pages.index.dbRows','Database',st.database?.totalRows);add('db.connections','pages.index.dbConnections','Database',st.database?.openConns,'count',st.database?.maxOpenConns);add('db.idle','pages.builder.dbIdle','Database',st.database?.idleConns);
 add('panel.memory','pages.index.panelProcessHeap','Process',st.appStats?.mem,'bytes');add('panel.threads','pages.index.threads','Process',st.appStats?.threads);add('panel.uptime','pages.index.panelUptimeLabel','Process',st.panelUptime,'seconds');add('os.uptime','pages.index.osLabel','Process',st.uptime,'seconds');
 return out;
}

export function formatMetric(metric:DashboardMetric,precision=1):string {
 if(metric.value==null)return '—';const n=metric.value;
 if(metric.unit==='bytes')return sizeFormat(n);if(metric.unit==='speed')return sizeFormat(n)+'/s';if(metric.unit==='seconds')return formatSecond(n);
 return n.toLocaleString(undefined,{maximumFractionDigits:metric.unit==='count'?0:precision})+(metric.unit==='percent'?'%':'');
}
