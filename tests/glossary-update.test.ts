// @vitest-environment node
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createGlossaryUpdater,dataRevision,digest,fetchText,validateManifest,validatePack,UPDATE_ROOT,UPDATE_URL,type UpdateManifest,type UpdateState,type GlossarySnapshot,type UpdateStore} from '../src/glossary-update';
import {createPackLoader} from '../src/glossary-packs';
import {resolveStoredTerms,mergeTerms,findTerms} from '../src/glossary';
import type {GlossaryPack,Term} from '../src/types';
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));
async function fixture(label='A'){
 const packs:Record<string,GlossaryPack>={},texts:Record<string,string>={},entries:UpdateManifest['packs']=[];
 for(const group of ['core','extended'] as const)for(const domain of ['math','physics','cs'] as const){
  const file=`${group}-${domain}.json`,term:Term={id:`${group}-${domain}`,source:'vector space',target:label==='A'?'向量空间':'线性空间',domain,sense:'vector space',aliases:['vector spaces'],sourceUrl:'https://example.org/term',license:'CC0-1.0',quality:group==='core'?'core':'candidate',enabled:true};
  const p={name:file,domain,version:label,author:'AM',license:'CC0-1.0',terms:[term]};packs[file]=p;texts[file]=JSON.stringify(p);
  entries.push({group,domain,file,count:1,name:p.name,version:label,author:p.author,license:p.license,bytes:Buffer.byteLength(texts[file]!),sha256:await digest(texts[file]!)});
 }
 const manifest:UpdateManifest={schemaVersion:1,revision:await dataRevision(entries),sourceRevision:(label==='A'?'a':'b').repeat(40),publishedAt:'2026-10-04T00:00:00Z',minExtensionVersion:'0.1.9',packs:entries};
 return {manifest,packs,texts};
}
async function setup(){
 const base=await fixture(),remote=await fixture('B');let state:UpdateState={};const snapshots=new Map<string,GlossarySnapshot>();
 const store:UpdateStore={state:async()=>structuredClone(state),snapshot:async r=>snapshots.get(r),commit:async(s,snapshot,remove=[])=>{if(snapshot)snapshots.set(snapshot.manifest.revision,snapshot);for(const r of remove)if(r!==s.active&&r!==s.previous)snapshots.delete(r);state=structuredClone(s);}};
 const fetcher=vi.fn(async(input:string|URL|Request)=>{const url=String(input);if(url===UPDATE_URL)return new Response(JSON.stringify(remote.manifest));const file=url.split('/').at(-1)!;if(!url.startsWith(UPDATE_ROOT+remote.manifest.sourceRevision+'/'))throw new Error('not pinned');return new Response(remote.texts[file]);});
 const updater=createGlossaryUpdater(store,async()=>base.manifest,'0.1.9',fetcher as typeof fetch);
 return {base,remote,store,snapshots,fetcher,updater};
}
describe('glossary update validation',()=>{
 it('accepts every actual shipped pack and its pinned manifest',async()=>{
  const path=new URL('../public/glossaries/',import.meta.url),manifest=await validateManifest(JSON.parse(await readFile(new URL('update.json',path),'utf8')),'0.1.9');
  for(const entry of manifest.packs){const bytes=await readFile(new URL(entry.file,path));expect(bytes.length).toBe(entry.bytes);expect(await digest(bytes.toString('utf8'))).toBe(entry.sha256);expect(validatePack(JSON.parse(bytes.toString('utf8')),entry).terms).toHaveLength(entry.count);}
 });
 it.each(['../core-math.json','https://evil.test/x.json','unknown.json'])('rejects foreign file %s',async file=>{const {manifest}=await fixture();manifest.packs[0]!.file=file;await expect(validateManifest(manifest,'0.1.9')).rejects.toThrow('路径');});
 it('rejects a client upgrade requirement without applying data',async()=>{const {manifest}=await fixture();manifest.minExtensionVersion='0.2.0';await expect(validateManifest(manifest,'0.1.9')).rejects.toThrow('先升级');});
 it('rejects duplicate or missing packs and bad revision',async()=>{const {manifest}=await fixture();await expect(validateManifest({...manifest,packs:manifest.packs.slice(1)},'0.1.9')).rejects.toThrow();await expect(validateManifest({...manifest,revision:'0'.repeat(64)},'0.1.9')).rejects.toThrow('目录校验');const dup=structuredClone(manifest);dup.packs[1]=dup.packs[0]!;await expect(validateManifest(dup,'0.1.9')).rejects.toThrow('重复');});
 it.each(['domain','quality','enabled','aliases','sourceUrl','target'] as const)('rejects invalid %s without promoting candidates',async field=>{
  const {manifest,packs}=await fixture(),entry=manifest.packs[0]!,pack=structuredClone(packs[entry.file]!);
  const invalid={domain:'physics',quality:'user',enabled:'true',aliases:{bad:true},sourceUrl:'javascript:alert(1)',target:'⟪AM:T:bad⟫'};Object.assign(pack.terms[0]!,{[field]:invalid[field]});expect(()=>validatePack(pack,entry)).toThrow();
 });
 it('rejects duplicate term IDs and mismatched metadata',async()=>{const {manifest,packs}=await fixture(),entry={...manifest.packs[0]!,count:2},p=packs[entry.file]!;expect(()=>validatePack({...p,terms:[p.terms[0]!,p.terms[0]!] },entry)).toThrow('重复');expect(()=>validatePack({...p,version:'wrong'},manifest.packs[0]!)).toThrow('元数据');});
 it('enforces streamed size limits without Content-Length',async()=>{const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response('x'.repeat(101)));await expect(fetchText(UPDATE_URL,100,fetcher)).rejects.toThrow('大小');expect(fetcher.mock.calls[0]?.[1]).toMatchObject({credentials:'omit',redirect:'error'});});
});
describe('independent data updates and recovery',()=>{
 it('checks first, applies all six pinned packs, survives offline reopening and rolls back',async()=>{
  const {updater,store,fetcher,base,remote}=await setup();const checked=await updater.check();expect(checked.available?.revision).toBe(remote.manifest.revision);expect((await store.state()).active).toBeUndefined();
  await updater.apply(checked.available!.revision);expect(fetcher).toHaveBeenCalledTimes(7);expect((await store.state()).active).toBe(remote.manifest.revision);
  const reopened=createGlossaryUpdater(store,async()=>base.manifest,'0.1.9',async()=>{throw new Error('offline');});expect((await reopened.status()).current.revision).toBe(remote.manifest.revision);await expect(reopened.check()).rejects.toThrow('offline');expect((await reopened.status()).current.revision).toBe(remote.manifest.revision);
  await reopened.rollback();expect((await reopened.status()).current.revision).toBe(base.manifest.revision);await reopened.rollback();expect((await reopened.status()).current.revision).toBe(remote.manifest.revision);await reopened.reset();expect((await reopened.status()).usingDownload).toBe(false);
 });
 it('does not download unchanged data',async()=>{const {store,base}=await setup(),fetcher=vi.fn(async()=>new Response(JSON.stringify(base.manifest)));const updater=createGlossaryUpdater(store,async()=>base.manifest,'0.1.9',fetcher);expect((await updater.check()).available).toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(1);});
 it('rejects a stale update choice',async()=>{const {updater}=await setup();await updater.check();await expect(updater.apply('0'.repeat(64))).rejects.toThrow('重新检查');});
 it('leaves the active pointer unchanged when the last pack is corrupted',async()=>{const {updater,remote,store,snapshots}=await setup();await updater.check();remote.texts['extended-cs.json']+=' ';await expect(updater.apply(remote.manifest.revision)).rejects.toThrow();expect((await store.state()).active).toBeUndefined();expect(snapshots.size).toBe(0);});
 it('leaves data unchanged on a partial network failure',async()=>{const {updater,fetcher,remote,store}=await setup();await updater.check();fetcher.mockImplementationOnce(async()=>{throw new Error('断网');});await expect(updater.apply(remote.manifest.revision)).rejects.toThrow('断网');expect((await store.state()).active).toBeUndefined();});
 it('rejects truncated JSON and preserves the old version',async()=>{const {updater,fetcher,base}=await setup();fetcher.mockImplementationOnce(async()=>new Response('{'));await expect(updater.check()).rejects.toThrow('JSON');expect((await updater.status()).current.revision).toBe(base.manifest.revision);});
 it('serializes two update clicks instead of committing twice',async()=>{const {updater,remote,fetcher}=await setup();await updater.check();const results=await Promise.allSettled([updater.apply(remote.manifest.revision),updater.apply(remote.manifest.revision)]);expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);expect(fetcher).toHaveBeenCalledTimes(7);});
 it('does not touch personal overrides, confirmed terms or disabled preferences',async()=>{const {updater,remote,base}=await setup();const old=base.packs['core-math.json']!.terms[0]!,personal={...old,quality:'user' as const,target:'我的译名',updatedAt:1},confirmed={...old,id:'confirmed',source:'personal confirmed term',sense:'distinct',aliases:[],quality:'confirmed' as const,updatedAt:1},disabled={...base.packs['core-physics.json']!.terms[0]!,enabled:false};const stored=[personal,confirmed,disabled],before=JSON.stringify(stored);await updater.check();await updater.apply(remote.manifest.revision);const builtin=Object.values(remote.packs).flatMap(p=>p.terms),merged=mergeTerms(builtin,resolveStoredTerms(builtin,stored));expect(merged.find(t=>t.id===personal.id)?.target).toBe('我的译名');expect(merged.find(t=>t.id===confirmed.id)?.quality).toBe('confirmed');expect(merged.find(t=>t.id===disabled.id)?.enabled).toBe(false);expect(JSON.stringify(stored)).toBe(before);expect(findTerms('vector space',merged,'cs').some(t=>t.term.quality==='candidate')).toBe(false);});
 it('switches pack loading live and restores the bundled data without recreating the loader',async()=>{
  const {base,remote}=await setup();let active:GlossarySnapshot|undefined;
  vi.stubGlobal('fetch',async(input:string|URL)=>new Response(JSON.stringify(String(input).endsWith('index.json')?{version:'1',packs:base.manifest.packs}:base.packs[String(input).split('/').at(-1)!])));
  const load=createPackLoader('https://extension.test/glossaries/index.json',async()=>active);expect((await load('core','math'))[0]?.target).toBe('向量空间');active=remote;expect((await load('core','math'))[0]?.target).toBe('线性空间');active=undefined;expect((await load('core','math'))[0]?.target).toBe('向量空间');vi.unstubAllGlobals();
 });
});
