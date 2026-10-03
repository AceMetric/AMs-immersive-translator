import type {Profile} from './types';
export type Reservation={at:number;tokens:number};
export function quotaDecision(history:Reservation[],limits:NonNullable<Profile['limits']>,tokens:number,now=Date.now()){
 const rows=history.filter(r=>now-r.at<86400_000),minute=rows.filter(r=>now-r.at<60000);let wait=0;
 const exhausted=!!limits.rpd&&rows.length>=limits.rpd,oversized=!!limits.tpm&&tokens>limits.tpm;
 if(limits.rpm&&minute.length>=limits.rpm)wait=Math.max(wait,minute[minute.length-limits.rpm]!.at+60000-now);
 if(limits.tpm){let used=minute.reduce((n,r)=>n+r.tokens,0);for(const r of minute){if(used+tokens<=limits.tpm)break;wait=Math.max(wait,r.at+60000-now);used-=r.tokens;}}
 return {rows,exhausted,oversized,wait};
}
