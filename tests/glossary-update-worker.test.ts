// @vitest-environment node
import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {it,expect,vi} from 'vitest';
import {dataRevision,digest,UPDATE_ROOT,UPDATE_URL,type UpdateManifest} from '../src/glossary-update';
import {defaults,presets} from '../src/settings';
import {pendingJobs} from '../src/db';
import type {EngineEvent,Job} from '../src/types';
const {model}=vi.hoisted(()=>({model:vi.fn()}));
vi.mock('../src/providers',async original=>({...await original<typeof import('../src/providers')>(),callModel:model}));
it('cancels old requests on live update and prevents late responses or old cache from replacing new terms',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const directory=new URL('../public/glossaries/',import.meta.url),index=JSON.parse(await readFile(new URL('index.json',directory),'utf8'));
 const base:UpdateManifest=JSON.parse(await readFile(new URL('update.json',directory),'utf8')),remote=structuredClone(base),texts:Record<string,string>={};remote.sourceRevision='b'.repeat(40);
 for(const entry of remote.packs){texts[entry.file]=await readFile(new URL(entry.file,directory),'utf8');if(entry.file==='core-math.json'){const pack=JSON.parse(texts[entry.file]!);pack.terms.find((t:{source:string})=>t.source==='vector space').target='测试新译名';texts[entry.file]=JSON.stringify(pack);entry.bytes=Buffer.byteLength(texts[entry.file]!);entry.sha256=await digest(texts[entry.file]!);}}
 remote.revision=await dataRevision(remote.packs);
 vi.stubGlobal('fetch',async(input:string|URL)=>{const url=String(input),file=url.split('/').at(-1)!;if(url===UPDATE_URL)return new Response(JSON.stringify(remote));if(url.startsWith(UPDATE_ROOT+remote.sourceRevision+'/'))return new Response(texts[file]);if(file==='index.json')return new Response(JSON.stringify(index));return new Response(await readFile(new URL(file,directory),'utf8'));});
 const calls:{resolve:(text:string)=>void;signal:AbortSignal}[]=[];
 model.mockImplementation((_p,_prompt,_user,signal:AbortSignal)=>new Promise<string>(resolve=>calls.push({resolve,signal})));
 const events:EngineEvent[]=[],responses=new Map<string,(data:any)=>void>();
 const worker={onmessage:undefined as any,postMessage:(data:any)=>{if(data.event)events.push(data.event);else responses.get(data.requestId)?.(data);}};
 vi.stubGlobal('self',worker);await import('../src/engine.worker');
 const command=(type:string,payload:unknown={})=>new Promise<any>((resolve,reject)=>{const requestId=crypto.randomUUID();responses.set(requestId,data=>{responses.delete(requestId);if(data.error)reject(new Error(data.error));else resolve(data.result);});void worker.onmessage({data:{requestId,type,payload}});});
 const profile={...presets.ollama!,model:'mock-qwen',contextTokens:8192};
 await command('init',{settings:{...defaults,profiles:[profile],activeProfile:profile.id,qualityProfiles:{fast:profile.id,precise:profile.id}},glossaryIndexUrl:'https://extension.test/glossaries/index.json',extensionVersion:'0.1.9',liveSessions:{}});
 const job=(id:string,epoch:number):Job=>({id,tabId:1,sessionId:'session',epoch,segments:[{id:'segment',text:'A vector space is useful.',sourceHash:'source',order:0}],context:{title:'Linear algebra',abstract:'',heading:'',before:'',after:''},mode:'general',domain:'math',qualityMode:'fast',status:'queued',createdAt:Date.now()});
 await command('enqueue',{job:job('old',1)});await vi.waitFor(()=>expect(calls).toHaveLength(1));
 await command('glossary-check');await command('glossary-apply',{revision:remote.revision});expect(calls[0]!.signal.aborted).toBe(true);
 calls[0]!.resolve('[AM0] 很有用。');await vi.waitFor(()=>expect(events.filter(e=>e.type==='translated')).toHaveLength(0));
 await command('enqueue',{job:job('new',2)});await vi.waitFor(()=>expect(calls).toHaveLength(2));calls[1]!.resolve('[AM0] 很有用。');await vi.waitFor(()=>expect(events.filter(e=>e.type==='translated')).toHaveLength(1));expect(events.find(e=>e.type==='translated')?.results?.[0]?.text).toContain('测试新译名');
 expect((await pendingJobs()).some(j=>j.id==='old')).toBe(false);
 await command('glossary-reset');await command('enqueue',{job:job('restored',3)});await vi.waitFor(()=>expect(calls).toHaveLength(3));calls[2]!.resolve('[AM0] 很有用。');await vi.waitFor(()=>expect(events.filter(e=>e.type==='translated')).toHaveLength(2));expect(events.filter(e=>e.type==='translated').at(-1)?.results?.[0]?.text).toContain('向量空间');
 await command('cancel',{sessionId:'session'});vi.unstubAllGlobals();
});
