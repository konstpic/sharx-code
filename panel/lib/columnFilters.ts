export type FilterKind='text'|'number'|'bytes'|'speed'|'date';
export function filterNumber(raw:string,kind:FilterKind):number|null {
 const text=raw.trim().replace(',','.');
 if(kind==='date') {const iso=text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);const n=new Date(iso?`${iso[3]}-${iso[2]}-${iso[1]}T00:00:00`:text.length===10?text+'T00:00:00':text).getTime();return Number.isFinite(n)?n:null}
 const m=text.match(/^(-?\d+(?:\.\d+)?)\s*([a-z]*)$/i);if(!m)return null;
 let n=Number(m[1]);const unit=m[2].toLowerCase();
 if(kind==='bytes') {const factor:Record<string,number>={b:1,kb:1024,mb:1024**2,gb:1024**3,tb:1024**4};if(unit&&!factor[unit])return null;n*=factor[unit||'gb']}
 else if(kind==='speed') {const factor:Record<string,number>={bps:1,kbps:1000,mbps:1e6,gbps:1e9};if(unit&&!factor[unit])return null;n*=factor[unit||'mbps']}
 else if(unit)return null;
 return Number.isFinite(n)?n:null;
}
export function matchesColumnFilter(value:string|number|null|undefined,raw:string,kind:FilterKind='text',display=''):boolean {
 const input=raw.trim().toLowerCase();if(!input)return true;
 if(['—','none','нет'].includes(input))return value==null||value===''||(kind==='date'&&value===0);
 const range=input.split('..');
 if(range.length===2 && kind!=='text') {const a=filterNumber(range[0],kind),b=filterNumber(range[1],kind);return a!=null&&b!=null&&a<=b&&typeof value==='number'&&value>=a&&value<=b+(kind==='date'?86400000-1:0)}
 const cmp=input.match(/^(>=|<=|!=|>|<|=)\s*(.+)$/);
 if(cmp) {
  if(kind==='text')return cmp[1]==='!='?String(value??'').toLowerCase()!==cmp[2]:cmp[1]==='='&&String(value??'').toLowerCase()===cmp[2];
  const threshold=filterNumber(cmp[2],kind);if(threshold==null||typeof value!=='number')return false;
  const end=threshold+(kind==='date'?86400000-1:0);
  switch(cmp[1]){case '>':return value>end;case '>=':return value>=threshold;case '<':return value<threshold;case '<=':return value<=end;case '=':return value>=threshold&&value<=end;case '!=':return value<threshold||value>end;}
 }
 return `${value??''} ${display}`.toLowerCase().includes(input);
}
