import { expect, it } from 'vitest';
import { queryLocalLogs, type LogEntry } from './localLogEntries';
const entries: LogEntry[] = [
 {ts:60000,source:'mesh',component:'controller',level:'info',message:'Relay enabled exit=n2'},
 {ts:120000,source:'mesh',component:'operation',level:'error',message:'Relay failed exit=n3'},
 {ts:180000,source:'mesh',component:'controller',level:'warning',message:'Quorum unavailable'},
];
const query = {since:0,levels:new Set<'info'|'warn'|'error'>(['info','warn','error']),components:new Set<string>(),q:''};
it('filters by time, component, level and included/excluded terms',()=>{
 expect(queryLocalLogs(entries,{...query,q:'relay -failed'}).entries.map(e=>e.message)).toEqual(['Relay enabled exit=n2']);
 expect(queryLocalLogs(entries,{...query,since:100000,components:new Set(['controller'])}).entries.map(e=>e.level)).toEqual(['warning']);
 expect(queryLocalLogs(entries,{...query,levels:new Set(['error'])}).entries).toHaveLength(1);
});
it('sorts newest first without mutating data and counts normalized warning buckets',()=>{
 const r=queryLocalLogs(entries,query);expect(r.entries[0].ts).toBe(180000);expect(entries[0].ts).toBe(60000);expect(r.volume[2].warn).toBe(1);expect(r.components).toEqual(['controller','operation']);
});
