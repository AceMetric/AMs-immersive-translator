import type { GlossaryPack, Term } from './types';
import type { PackIndex } from './glossary-packs';

export const UPDATE_ORIGIN = 'https://raw.githubusercontent.com/*';
export const UPDATE_ROOT = 'https://raw.githubusercontent.com/AceMetric/AMs-immersive-translator/';
export const UPDATE_URL = UPDATE_ROOT + 'main/public/glossaries/update.json';
export const UPDATE_STATE_KEY = 'glossary-update:state';
export const snapshotKey = (revision:string) => 'glossary-update:snapshot:' + revision;
export type UpdateManifest = {schemaVersion:1;revision:string;sourceRevision:string;minExtensionVersion:string;publishedAt:string;packs:(PackIndex['packs'][number]&{bytes:number;sha256:string})[]};
export type GlossarySnapshot = {manifest:UpdateManifest;packs:Record<string,GlossaryPack>};
export type UpdateState = {active?:string;previous?:string|null;checkedAt?:number};
export type UpdateStatus = {current:UpdateManifest;bundled:UpdateManifest;available?:UpdateManifest;canRollback:boolean;usingDownload:boolean;checkedAt?:number;busy:boolean;error?:string};
export type UpdateStore = {state():Promise<UpdateState>;snapshot(revision:string):Promise<GlossarySnapshot|undefined>;commit(state:UpdateState,snapshot?:GlossarySnapshot,remove?:string[]):Promise<void>};
function fail(message:string):never {throw new Error(message);}
const object = (x:unknown):Record<string,unknown> => x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:fail('词库数据结构错误。');
function string(x:unknown,max=2000,empty=false):string {return typeof x==='string'&&x.length<=max&&(empty||x.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)?x:fail('词库包含无效文字字段。');}
function version(x:unknown){const v=string(x,40);return /^\d+\.\d+\.\d+$/.test(v)?v:fail('词库要求的插件版本无效。');}
export function compatible(current:string,minimum:string){const a=version(current).split('.').map(Number),b=version(minimum).split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]!>b[i]!;}return true;}
export async function digest(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function dataRevision(packs:UpdateManifest['packs']){return digest([...packs].sort((a,b)=>a.file.localeCompare(b.file,'en')).map(p=>`${p.file}:${p.sha256}`).join('\n'));}
export async function validateManifest(value:unknown,clientVersion:string):Promise<UpdateManifest>{
  const raw=object(value);
  if(raw.schemaVersion!==1||!Array.isArray(raw.packs)||raw.packs.length!==6)fail('词库更新协议不兼容。');
  const revision=string(raw.revision,64),sourceRevision=string(raw.sourceRevision,40);
  if(!/^[a-f0-9]{64}$/.test(revision)||!/^[a-f0-9]{40}$/.test(sourceRevision))fail('词库版本标识无效。');
  const minExtensionVersion=version(raw.minExtensionVersion);
  if(!compatible(clientVersion,minExtensionVersion))fail(`此词库需要 AM ${minExtensionVersion} 或更新版本，请先升级插件。`);
  const publishedAt=string(raw.publishedAt,40);if(!Number.isFinite(Date.parse(publishedAt)))fail('词库发布日期无效。');
  const files=new Set<string>();let total=0;
  const packs=(raw.packs as unknown[]).map(value=>{
    const p=object(value);const group=p.group,domain=p.domain;
    if((group!=='core'&&group!=='extended')||(domain!=='math'&&domain!=='physics'&&domain!=='cs'))fail('词库领域或类别无效。');
    const file=`${group}-${domain}.json`;
    if(p.file!==file||files.has(file))fail('词库文件缺失、重复或路径无效。');files.add(file);
    if(!Number.isSafeInteger(p.count)||(p.count as number)<1||(p.count as number)>30000||!Number.isSafeInteger(p.bytes)||(p.bytes as number)<1||(p.bytes as number)>8*1024*1024)fail('词库大小或条目数量无效。');
    total+=p.bytes as number;
    const sha256=string(p.sha256,64);if(!/^[a-f0-9]{64}$/.test(sha256))fail('词库校验值无效。');
    return {group,domain,file,count:p.count as number,bytes:p.bytes as number,sha256,name:string(p.name,200),version:string(p.version,80),author:string(p.author,200),license:string(p.license,80)} as UpdateManifest['packs'][number];
  });
  if(total>32*1024*1024||revision!==await dataRevision(packs))fail('词库目录校验未通过。');
  return {schemaVersion:1,revision,sourceRevision,minExtensionVersion,publishedAt,packs};
}
export function validatePack(value:unknown,entry:UpdateManifest['packs'][number]):GlossaryPack {
  const p=object(value);
  for(const key of ['name','version','author','license'] as const)if(p[key]!==entry[key])fail('词库元数据与目录不符。');
  if(p.domain!==entry.domain||!Array.isArray(p.terms)||p.terms.length!==entry.count)fail('词库领域或数量与目录不符。');
  const ids=new Set<string>();
  const terms=(p.terms as unknown[]).map(value=>{
    const t=object(value),id=string(t.id,120);
    if(ids.has(id)||t.domain!==entry.domain||t.quality!==(entry.group==='core'?'core':'candidate')||typeof t.enabled!=='boolean')fail('词条重复、领域或类别无效。');ids.add(id);
    const list=(x:unknown,max:number)=>Array.isArray(x)&&x.length<=max?x.map(a=>string(a,300)):fail('词条列表无效。');
    const sourceUrl=string(t.sourceUrl,2000,true);if(sourceUrl){try{if(new URL(sourceUrl).protocol!=='https:')fail('词条来源必须使用 HTTPS。');}catch{fail('词条来源链接无效。');}}
    const term:Term={id,source:string(t.source,300),target:string(t.target,300),sense:string(t.sense,2000,true),aliases:list(t.aliases,100),sourceUrl,license:string(t.license,80),domain:entry.domain,quality:entry.group==='core'?'core':'candidate',enabled:t.enabled};
    if(!/[\u3400-\u9fff]/.test(term.target)||/[⟪⟫]/.test(term.source+term.target))fail('词条译名或保护标记无效。');
    if(t.definition!==undefined)term.definition=string(t.definition,4000,true);
    if(t.sourceNote!==undefined)term.sourceNote=string(t.sourceNote,4000,true);
    if(t.contexts!==undefined)term.contexts=list(t.contexts,100);
    if(t.requiresContext!==undefined){if(typeof t.requiresContext!=='boolean')fail('词条语境约束无效。');term.requiresContext=t.requiresContext;}
    return term;
  });
  return {name:entry.name,version:entry.version,author:entry.author,license:entry.license,terms};
}
// Limit the decoded body even when a server omits Content-Length or streams it.
export async function fetchText(url:string,limit:number,fetcher:typeof fetch=fetch):Promise<string>{
  const signal=AbortSignal.timeout(30000);
  const response=await fetcher(url,{signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'});
  if(!response.ok)fail(`读取词库失败：HTTP ${response.status}。现有词库仍可使用。`);
  if(Number(response.headers.get('content-length'))>limit)fail('词库下载超出大小限制。');
  if(!response.body)fail('词库下载为空。');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)fail('词库下载超出大小限制。');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
function parse(text:string):unknown {try{return JSON.parse(text);}catch{return fail('词库返回的 JSON 不完整或无效。');}}
export function createGlossaryUpdater(store:UpdateStore,bundled:()=>Promise<UpdateManifest>,clientVersion:string,fetcher:typeof fetch=fetch){
  let available:UpdateManifest|undefined,busy=false,error:string|undefined;
  let cachedRevision:string|undefined,cachedSnapshot:GlossarySnapshot|undefined;
  let operations:Promise<unknown>=Promise.resolve();
  async function status():Promise<UpdateStatus>{const state=await store.state(),base=await bundled();if(cachedRevision!==state.active){cachedSnapshot=state.active?await store.snapshot(state.active):undefined;cachedRevision=state.active;}const snapshot=cachedSnapshot;return {current:snapshot?.manifest??base,bundled:base,available,usingDownload:!!snapshot,canRollback:state.previous!==undefined,checkedAt:state.checkedAt,busy,error};}
  function run<T>(operation:()=>Promise<T>):Promise<T>{const task=operations.then(async()=>{busy=true;error=undefined;try{return await operation();}catch(e){error=(e as Error).message;throw e;}finally{busy=false;}});operations=task.catch(()=>{});return task;}
  return {status,check:()=>run(async()=>{
    available=undefined;
    const remote=await validateManifest(parse(await fetchText(UPDATE_URL,65536,fetcher)),clientVersion);
    const state=await store.state();await store.commit({...state,checkedAt:Date.now()});
    if(remote.revision!==(await status()).current.revision)available=remote;
    return status();
  }),apply:(expectedRevision:string)=>run(async()=>{
    if(!available||available.revision!==expectedRevision)fail('词库更新已变化，请重新检查。');
    const manifest=available,packs:Record<string,GlossaryPack>={};const ids=new Set<string>();
    for(const entry of manifest.packs){
      const text=await fetchText(UPDATE_ROOT+manifest.sourceRevision+'/public/glossaries/'+entry.file,entry.bytes,fetcher);
      if(new TextEncoder().encode(text).byteLength!==entry.bytes||await digest(text)!==entry.sha256)fail('词库文件校验未通过，更新未应用。');
      const pack=validatePack(parse(text),entry);for(const term of pack.terms){if(ids.has(term.id))fail('不同词库包含重复词条 ID。');ids.add(term.id);}packs[entry.file]=pack;
    }
    const state=await store.state();if(state.active!==manifest.revision)await store.commit({...state,active:manifest.revision,previous:state.active??null},{manifest,packs},state.previous?[state.previous]:[]);
    available=undefined;return status();
  }),rollback:()=>run(async()=>{
    const state=await store.state();if(state.previous===undefined)fail('没有可回退的词库版本。');
    if(state.previous&&!await store.snapshot(state.previous))fail('上一版词库不可用，请恢复内置词库。');
    await store.commit({...state,active:state.previous??undefined,previous:state.active??null});available=undefined;return status();
  }),reset:()=>run(async()=>{
    const state=await store.state();if(state.active)await store.commit({...state,active:undefined,previous:state.active},undefined,state.previous?[state.previous]:[]);
    available=undefined;return status();
  })};
}
