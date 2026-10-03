import {quotaDecision} from './quota';
import { openDB } from 'idb';
import type { Job, Term } from './types';
const dbPromise = () => openDB('am-translator', 1, { upgrade(db) {
  db.createObjectStore('terms', { keyPath:'id' });
  db.createObjectStore('cache', { keyPath:'key' });
  db.createObjectStore('jobs', { keyPath:'id' });
  db.createObjectStore('meta');
} });
export async function getUserTerms(): Promise<Term[]> { return (await dbPromise()).getAll('terms'); }
export async function putTerms(terms: Term[]) { const db=await dbPromise(); const tx=db.transaction('terms','readwrite'); for(const t of terms) tx.store.put(t); await tx.done; }
export async function deleteTerm(id: string) { return (await dbPromise()).delete('terms',id); }
export async function putJob(job: Job) { return (await dbPromise()).put('jobs',job); }
export async function deleteJob(id: string) { return (await dbPromise()).delete('jobs',id); }
export async function pendingJobs(): Promise<Job[]> { return (await (await dbPromise()).getAll('jobs')).filter((j:Job)=>j.status==='queued'||j.status==='running'); }
export async function clearJobs(sessionId: string) { const db=await dbPromise(); for(const job of await db.getAll('jobs')) if(job.sessionId===sessionId) await db.delete('jobs',job.id); }
export async function cacheGet(key: string): Promise<string|undefined> { const db=await dbPromise(); const value=await db.get('cache',key); if(value) {value.usedAt=Date.now(); await db.put('cache',value);} return value?.text; }
export async function cachePut(key: string, text: string, limit: number) { const db=await dbPromise(); await db.put('cache',{key,text,usedAt:Date.now()}); const count=await db.count('cache'); if(count>limit) { const all=await db.getAll('cache'); all.sort((a,b)=>a.usedAt-b.usedAt); const tx=db.transaction('cache','readwrite'); for(const item of all.slice(0,count-limit)) tx.store.delete(item.key); await tx.done; } }
export async function cacheCount() { return (await dbPromise()).count('cache'); }
export async function clearCache() { return (await dbPromise()).clear('cache'); }
export async function sha256(value: string) { const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)); return [...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export async function getMeta<T>(key:string):Promise<T|undefined>{return (await dbPromise()).get('meta',key);}
export async function putMeta(key:string,value:unknown){return (await dbPromise()).put('meta',value,key);}
export async function deleteMetaPrefix(prefix:string){const db=await dbPromise();const tx=db.transaction('meta','readwrite');for(const key of await tx.store.getAllKeys())if(typeof key==='string'&&key.startsWith(prefix))await tx.store.delete(key);await tx.done;}
export async function appendDiagnostic(value:import('./diagnostics').Diagnostic){const db=await dbPromise();const tx=db.transaction('meta','readwrite');const rows=await tx.store.get('diagnostics')??[];rows.push(value);await tx.store.put(rows.slice(-300),'diagnostics');await tx.done;}
export async function reserveQuota(key:string,limits:NonNullable<import('./types').Profile['limits']>,tokens:number,now=Date.now()){
  const db=await dbPromise(),tx=db.transaction('meta','readwrite');
  const {rows,exhausted,oversized,wait}=quotaDecision(await tx.store.get(key)??[],limits,tokens,now);
  if(!exhausted&&!oversized&&!wait){rows.push({at:now,tokens});await tx.store.put(rows,key);}await tx.done;return {exhausted,oversized,wait};
}
