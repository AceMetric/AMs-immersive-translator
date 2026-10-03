import { collectBlocks, renderTranslation, serialize, readonlyReferences, type Block } from '../src/dom';
import {readingWindow} from '../src/reading-queue';
import { background } from '../src/messaging';
const getSettings=():Promise<PageSettings>=>background('page-settings');
import { inferDomain } from '../src/glossary';
import { sha256 } from '../src/db';
import type { EngineEvent, PageState, PageSettings, Term, Translation } from '../src/types';
export default defineContentScript({matches:['http://*/*','https://*/*'],registration:'runtime',main(){
  if((globalThis as any).__amTranslator)return;(globalThis as any).__amTranslator=true;
  let settings:PageSettings,epoch=0,sessionId=crypto.randomUUID(),startedAt=0,timer:ReturnType<typeof setTimeout>|undefined;
  let known=new WeakSet<Element>();const blocks=new Map<string,Block>(),status=new Map<string,'waiting'|'queued'|'done'|'failed'>();const articleTerms=new Map<string,Term>();
  const completedJobs=new Set<string>(),manualWanted=new Set<string>();
  const hashes=new Map<string,string>(),refinementStates=new Map<string,string>();
  const snapshots=new Map<string,Map<string,string>>(),owners=new Map<string,string>();
  const inFlight=new Set<string>(),deliveryOrder:string[]=[],deliveries=new Map<string,Translation|string>();
  let detectedDomain:PageState['detectedDomain']='general';
  let enabled=false,paused=false,hidden=false,firstTranslationMs:number|undefined;
  const state=():PageState=>({sessionId,enabled,paused,hidden,total:blocks.size,done:[...status.values()].filter(s=>s==='done').length,failed:[...status.values()].filter(s=>s==='failed').length,title:document.title,terms:[...articleTerms.values()],detectedDomain,firstTranslationMs});
  const css=document.createElement('style');css.dataset.amUi='';css.textContent=`.am-translation{display:block;margin-top:.55em;margin-bottom:.65em;line-height:1.75;color:inherit;opacity:.94;font-size:1em;font-style:normal;white-space:normal;overflow-wrap:anywhere}.am-translation[data-error]{font-size:.8em;color:#a74b2a;cursor:pointer}.am-translation[hidden]{display:none!important}.am-translation code{white-space:pre-wrap}.am-refine-tools{display:flex;gap:10px;align-items:center;margin-top:4px;font:12px/1.5 system-ui;opacity:.7}.am-refine-tools button{background:transparent;color:inherit;border:1px solid currentColor;border-radius:6px;padding:2px 8px;cursor:pointer}.am-refine-tools button:disabled{cursor:wait;opacity:.5}.am-translation svg{max-width:100%;vertical-align:middle}`;document.head.append(css);
  const host=document.createElement('div');host.dataset.amUi='';document.documentElement.append(host);const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML='<style>:host{all:initial}button{position:fixed;right:24px;bottom:28px;z-index:2147483647;width:48px;height:48px;border-radius:16px;border:1px solid #ffffff30;background:#087f8c;color:white;box-shadow:0 8px 24px #07383d40;font:600 20px system-ui;cursor:pointer;transition:transform .15s}button:hover{transform:translateY(-2px)}button:focus-visible{outline:3px solid #54cfc1;outline-offset:3px}.toast{position:fixed;right:24px;bottom:86px;max-width:310px;background:#183b42;color:white;border-radius:12px;padding:12px 16px;font:13px/1.7 system-ui;z-index:2147483647;box-shadow:0 4px 18px #0002}.toast:empty{display:none}</style><button title="AM 学术翻译 · 点击开始 / 暂停" aria-label="AM 学术翻译">译</button><div class="toast" role="status"></div>';
  const button=shadow.querySelector('button')!,toast=shadow.querySelector<HTMLDivElement>('.toast')!;
  function notify(message:string){toast.textContent=message;setTimeout(()=>{if(toast.textContent===message)toast.textContent='';},6000);}
  button.onclick=()=>void (enabled?(paused?resume():pause()):start()).catch(e=>notify(e.message));
  function update(){button.textContent=!enabled?'译':paused?'▶':'Ⅱ';button.title=!enabled?'AM 学术翻译 · 开始':paused?'继续翻译':'暂停翻译';void chrome.runtime.sendMessage({target:'ui',type:'page-update'}).catch(()=>{});}
  const observer=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting){const id=e.target.getAttribute('data-am-block');if(id&&status.get(id)==='waiting')schedule();}}},{rootMargin:'500px'});
  const mutation=new MutationObserver(()=>{if(enabled){clearTimeout(timer);timer=setTimeout(()=>{scan();schedule();},160);}});
  mutation.observe(document.body,{subtree:true,childList:true,characterData:true});
  function scan(){
    for(const [id,block] of blocks){if(!block.element.isConnected){blocks.delete(id);status.delete(id);observer.unobserve(block.element);continue;}const fresh=serialize(block.element,id,block.order);if(fresh.text!==block.text){block.element.querySelectorAll(`[data-am-translation="${CSS.escape(id)}"]`).forEach(e=>e.remove());blocks.set(id,fresh);status.set(id,'waiting');}}
    for(const block of collectBlocks(document,settings.translateNavigation,known)){block.order=blocks.size;blocks.set(block.id,block);status.set(block.id,'waiting');block.element.dataset.amBlock=block.id;observer.observe(block.element);}update();
  }
  function context(block:Block){const all=[...blocks.values()];const at=all.indexOf(block);let heading='';let node:Element|null=block.element;while(node&&!heading){let prev=node.previousElementSibling;while(prev){if(/^H[1-6]$/.test(prev.tagName)){heading=serialize(prev as HTMLElement,'heading',0).text;break;}prev=prev.previousElementSibling;}node=node.parentElement;}
    return {title:document.title,documentText:all.slice(0,100).map(b=>b.text).join('\n').slice(0,18000),abstract:document.querySelector('meta[name="description"]')?.getAttribute('content')?.slice(0,1500)??[...blocks.values()].filter(b=>b.element.closest('.abstract,.ltx_abstract')).map(b=>b.text).join(' ').slice(0,1500)??'',heading,before:all.slice(Math.max(0,at-2),at).map(b=>b.text).join('\n').slice(-2000),after:all.slice(at+1,at+4).map(b=>b.text).join('\n').slice(0,3000)};
  }
  let scheduling=false;
  async function schedule(){
    if(!enabled||paused||scheduling)return;scheduling=true;const scheduledEpoch=epoch,scheduledSession=sessionId;
    try{
      const capacity=Math.max(1,Math.min(10,settings.execution?.concurrency??1));
      while(enabled&&!paused&&epoch===scheduledEpoch&&sessionId===scheduledSession&&inFlight.size<capacity){
        const ordered=[...blocks.values()].filter(b=>status.get(b.id)==='waiting').sort((a,b)=>a.element.compareDocumentPosition(b.element)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
        const waiting=readingWindow(ordered.map((block,order)=>({id:block.id,order,...block.element.getBoundingClientRect().toJSON(),block})),innerHeight).map(p=>p.block);
        if(!waiting.length)break;
        const batch:Block[]=[];let length=0;const limit=settings.execution?.local||firstTranslationMs===undefined?1:settings.batchSize;
        while(waiting.length&&batch.length<limit){const next=waiting[0]!;if(batch.length&&length+next.text.length>settings.maxBatchChars)break;batch.push(waiting.shift()!);length+=next.text.length;}
        const jobId=crypto.randomUUID();inFlight.add(jobId);snapshots.set(jobId,new Map(batch.map(b=>[b.id,b.text])));batch.forEach(b=>owners.set(b.id,jobId));deliveryOrder.push(...batch.map(b=>b.id));
        const jobEpoch=epoch,jobSession=sessionId;batch.forEach(b=>status.set(b.id,'queued'));
        const segments=await Promise.all(batch.map(async b=>({id:b.id,text:b.text,sourceHash:await sha256(b.text),order:b.order,context:context(b),readonly:readonlyReferences(b)})));
        for(const segment of segments)hashes.set(segment.id,segment.sourceHash);
        if(jobEpoch!==epoch||jobSession!==sessionId){inFlight.delete(jobId);continue;}
        try{await background('engine',{command:'enqueue',payload:{job:{id:jobId,tabId:0,sessionId,epoch,segments,context:context(batch[0]!),mode:settings.mode,qualityMode:settings.qualityMode,domain:detectedDomain??settings.domain,articleTerms:[...articleTerms.values()],requestRefinement:batch.some(b=>manualWanted.has(b.id)),status:'queued',createdAt:Date.now()}}});manualWanted.forEach(id=>{if(batch.some(b=>b.id===id))manualWanted.delete(id);});}catch(e){inFlight.delete(jobId);batch.forEach(b=>fail(b.id,(e as Error).message));paused=true;notify((e as Error).message);break;}
      }
      if(enabled&&!paused&&!inFlight.size)await background('engine',{command:'background-ready',payload:{sessionId}});
    }finally{scheduling=false;update();if(enabled&&!paused&&(epoch!==scheduledEpoch||sessionId!==scheduledSession))queueMicrotask(()=>void schedule());}
  }
  async function refineBlock(id:string){
    const block=blocks.get(id);if(!block)return;
    try{await background('engine',{command:'refine',payload:{tabId:0,sessionId,epoch,id}});}
    catch(e){manualWanted.add(id);status.set(id,'waiting');refinementStates.set(id,'queued');updateRefinement(id);void schedule();}
  }
  function updateRefinement(id:string){
    const root=blocks.get(id)?.element.querySelector(`[data-am-translation="${CSS.escape(id)}"]`);if(!root)return;
    const state=refinementStates.get(id)??'draft';root.setAttribute('data-am-stage',state);
    const caption=root.querySelector<HTMLElement>('.am-refine-tools span'),button=root.querySelector<HTMLButtonElement>('.am-refine-tools button');
    if(caption)caption.textContent=({draft:'已翻译',queued:'已翻译 · 校润排队',running:'已翻译 · 校润中',refined:'已校润',failed:'保留译文 · 校润未应用',paused:'自动校润暂停'})[state]??'已翻译';
    if(button)button.disabled=state==='queued'||state==='running';
  }
  function showTranslation(result:Translation){
    const block=blocks.get(result.id);if(!block?.element.isConnected)return;
    const current=serialize(block.element,block.id,block.order);if(current.text!==block.text){blocks.set(block.id,current);status.set(block.id,'waiting');return;}
    try{
      const node=renderTranslation(block,result.text);node.dataset.amCached=String(result.cached);node.hidden=hidden;
      const tools=document.createElement('span');tools.dataset.amUi='';tools.className='am-refine-tools';
      const caption=document.createElement('span'),edit=document.createElement('button');edit.type='button';edit.textContent='校润本段';edit.title='对照原文检查并改善这一段';edit.onclick=()=>void refineBlock(block.id);tools.append(caption,edit);node.append(tools);
      block.element.querySelectorAll(`[data-am-translation="${CSS.escape(block.id)}"]`).forEach(e=>e.remove());block.element.insertBefore(node,block.insertion);status.set(block.id,'done');refinementStates.set(block.id,result.stage??'draft');updateRefinement(block.id);firstTranslationMs??=Math.round(performance.now()-startedAt);
      if(node.querySelector('[data-am-tex]'))void import('../src/math').then(m=>m.typesetProtected(node)).catch(()=>{});
    }catch(e){fail(block.id,(e as Error).message);}
  }
  function fail(id:string,error:string){const block=blocks.get(id);if(!block)return;status.set(id,'failed');block.element.querySelectorAll(`[data-am-translation="${CSS.escape(id)}"]`).forEach(e=>e.remove());const node=document.createElement('span');node.dataset.amTranslation=id;node.className='am-translation';node.dataset.error='';node.textContent=`${error} 点击重试`;node.hidden=hidden;node.onclick=()=>{node.remove();status.set(id,'waiting');paused=false;void background('engine',{command:'resume',payload:{sessionId}});void schedule();};block.element.insertBefore(node,block.insertion);}
  function resolveDomain(){detectedDomain=settings.domain==='auto'?inferDomain(document.title+' '+[...blocks.values()].slice(0,50).map(b=>b.text).join(' ').slice(0,12000)):settings.domain;}
  async function start(){if(enabled)return resume();settings=await getSettings();sessionId=crypto.randomUUID();epoch++;enabled=true;paused=false;hidden=false;startedAt=performance.now();firstTranslationMs=undefined;hashes.clear();refinementStates.clear();scan();resolveDomain();void schedule();notify(settings.qualityMode==='precise'?'精准档：保留更多上下文，优先翻译当前阅读位置':'极速档：优先翻译当前阅读位置');update();}
  async function pause(){paused=true;await background('engine',{command:'pause',payload:{sessionId}});update();return state();}
  async function resume(){paused=false;await background('engine',{command:'resume',payload:{sessionId}});void schedule();update();return state();}
  async function restore(){const old=sessionId;enabled=false;paused=false;epoch++;inFlight.clear();deliveryOrder.length=0;deliveries.clear();snapshots.clear();owners.clear();completedJobs.clear();hashes.clear();refinementStates.clear();manualWanted.clear();await background('engine',{command:'cancel',payload:{sessionId:old}});document.querySelectorAll('[data-am-translation]').forEach(e=>e.remove());for(const block of blocks.values()){block.element.removeAttribute('data-am-block');observer.unobserve(block.element);}blocks.clear();status.clear();articleTerms.clear();known=new WeakSet();hidden=false;update();return state();}
  async function retranslate(terms?:Term[]){
    const revision=++epoch,previous=sessionId;
    const anchor=readingWindow([...blocks.values()].map((block,order)=>({id:block.id,order,...block.element.getBoundingClientRect().toJSON(),block})),innerHeight)[0]?.block.element;
    const top=anchor?.getBoundingClientRect().top;
    inFlight.clear();deliveryOrder.length=0;deliveries.clear();snapshots.clear();owners.clear();completedJobs.clear();hashes.clear();refinementStates.clear();manualWanted.clear();
    await background('engine',{command:'cancel',payload:{sessionId:previous}});
    if(epoch!==revision||!enabled)return;
    sessionId=crypto.randomUUID();
    for(const [id,block]of blocks){if(!terms||terms.some(t=>[t.source,...t.aliases].some(a=>block.text.toLowerCase().includes(a.toLowerCase())))){block.element.querySelectorAll(`[data-am-translation="${CSS.escape(id)}"]`).forEach(e=>e.remove());status.set(id,'waiting');}else if(status.get(id)==='queued')status.set(id,'waiting');}
    if(anchor?.isConnected&&top!==undefined)window.scrollBy(0,anchor.getBoundingClientRect().top-top);
    const next=await getSettings();if(epoch!==revision||!enabled)return;settings=next;resolveDomain();void schedule();update();
  }
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    (async()=>{
      if(message.type==='get-state')return state();
      if(message.type==='start'){await start();return state();}
      if(message.type==='pause')return pause();if(message.type==='resume')return resume();if(message.type==='restore')return restore();
      if(message.type==='toggle-hidden'){hidden=!hidden;document.querySelectorAll<HTMLElement>('[data-am-translation]').forEach(e=>e.hidden=hidden);update();return state();}
      if(message.type==='settings-changed'){const next=await getSettings();const nav=next.translateNavigation!==settings?.translateNavigation;settings=next;if(enabled){if(nav){await restore();await start();}else await retranslate();}return state();}
      if(message.type==='terms-changed'){for(const t of message.payload?.terms??[])if(articleTerms.has(t.id))articleTerms.set(t.id,t);await retranslate(message.payload?.terms);return state();}
      if(message.type==='engine-event'){
        const event=message.event as EngineEvent;if(event.sessionId!==sessionId||event.epoch!==epoch||!enabled)return;
        if(event.type==='translated')for(const result of event.results??[])if(status.get(result.id)==='queued'&&(!event.jobId||owners.get(result.id)===event.jobId)){if(event.jobId&&snapshots.get(event.jobId)?.get(result.id)!==blocks.get(result.id)?.text){status.set(result.id,'waiting');continue;}deliveries.set(result.id,result);}
        if(event.type==='failed')for(const id of event.ids??[])if(status.get(id)==='queued'&&(!event.jobId||owners.get(id)===event.jobId))deliveries.set(id,event.error??'翻译失败');
        while(deliveryOrder.length){
          const head=deliveryOrder[0]!;if(!deliveries.has(head)){if(status.get(head)!=='queued'){deliveryOrder.shift();continue;}break;}
          const id=deliveryOrder.shift()!,value=deliveries.get(id)!;deliveries.delete(id);
          if(typeof value==='string'){fail(id,value);continue;}const result=value;
showTranslation(result);
        }
        if(event.type==='refined')for(const result of event.results??[])if(status.get(result.id)==='done'&&result.sourceHash===hashes.get(result.id))showTranslation(result);
        if(event.type==='refinement-status')for(const id of event.ids??[])if(status.get(id)==='done'){refinementStates.set(id,event.refinementState??'failed');updateRefinement(id);}
        if(event.type==='quota-error'){paused=true;notify(event.error??'免费额度已用尽，已暂停。');}
        if(event.type==='job-complete'&&event.jobId){inFlight.delete(event.jobId);completedJobs.add(event.jobId);}
        for(const jobId of completedJobs)if(![...(snapshots.get(jobId)?.keys()??[])].some(id=>owners.get(id)===jobId&&status.get(id)==='queued')){snapshots.delete(jobId);completedJobs.delete(jobId);}
        if(event.type==='progress'&&event.error)notify(event.error);
        if(event.type==='auth-error'){paused=true;notify(event.error??'请检查密钥');}
        if(event.type==='terms'){const fresh=(event.terms??[]).filter(t=>!articleTerms.has(t.id));fresh.forEach(t=>articleTerms.set(t.id,t));if(fresh.length){if(!event.applied)await retranslate(fresh);notify(`已统一 ${fresh.length} 个本篇术语，可在侧栏确认收录。`);}}
        update();void schedule();return state();
      }
    })().then(respond).catch(e=>respond({error:e.message}));return true;
  });
  addEventListener('scroll',()=>{if(enabled)void schedule();},{passive:true});
  addEventListener('pagehide',()=>{void background('engine',{command:'cancel',payload:{sessionId}}).catch(()=>{});});
  let url=location.href;setInterval(()=>{if(location.href!==url){url=location.href;if(enabled)void restore().then(start);}},1000);
}});
