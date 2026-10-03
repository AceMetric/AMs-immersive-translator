// The default uses only an already-installed Ollama model, 8K, one request at a time.
// Personal cloud keys may be read from an ignored private configuration file;
// profiles, headers and raw request/response bodies are never exported here.
import {createJiti} from 'jiti';
import {Window} from 'happy-dom';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {randomInt,randomUUID} from 'node:crypto';
const jiti=createJiti(import.meta.url),root=new URL('../',import.meta.url);
const load=path=>jiti.import(new URL(path,root).pathname);
const [{presets},{fastRequest,preciseRequest,polishTranslation,translateRequest,recoverProtectedParagraph},{callModel,configureProviderRuntime,QuotaError},{serialize,readonlyReferences},{lockTerms},{enrichTerms},{canonicalize,systemPrompt,chineseStyle},{fitsContext,generationBudget,estimateTokens,outputBudget},{quotaDecision},{refreshFreeCatalog},{errorCode}]=await Promise.all(['src/settings.ts','src/translation-call.ts','src/providers.ts','src/dom.ts','src/glossary.ts','src/term-graph.ts','src/protocol.ts','src/budget.ts','src/quota.ts','src/free-services.ts','src/diagnostics.ts'].map(load));
const w=new Window();for(const key of ['document','Node','Element','HTMLElement','SVGElement','MathMLElement','HTMLAnchorElement','CSS'])globalThis[key]=w[key];globalThis.getComputedStyle=w.getComputedStyle.bind(w);
const corpus=JSON.parse(readFileSync(new URL('data/benchmark/public-60.json',root))),paragraphs=corpus.paragraphs;
let profiles;
if(process.env.AM_BENCHMARK_PROFILES_FILE){profiles=JSON.parse(readFileSync(process.env.AM_BENCHMARK_PROFILES_FILE)).profiles;if(!profiles?.length)throw new Error('No configured profiles');for(const p of profiles){if(!p.local&&!p.freeOnly)throw new Error('Cloud benchmark accepts only explicitly strict-free profiles.');if(p.freeOnly)await refreshFreeCatalog(p);}}
else{const tags=await fetch('http://localhost:11434/api/tags').then(r=>r.json());const model=process.env.AM_OLLAMA_MODEL??tags.models?.[0]?.name;if(!model)throw new Error('No already installed model');profiles=[{...presets.ollama,model,contextTokens:8192,preciseThinking:false}];}
const folder=process.env.AM_BENCHMARK_OUTPUT??'artifacts/benchmark-0.1.4';mkdirSync(folder,{recursive:true});
const quotaFile=folder+'/admission.json';const history=existsSync(quotaFile)?JSON.parse(readFileSync(quotaFile)):{};let requests=0;
configureProviderRuntime({beforeRequest:async(p,user,signal,outputTokens)=>{const limits={...p.limits};if(p.preset==='openrouter'){limits.rpm=Math.min(limits.rpm??20,20);limits.rpd=Math.min(limits.rpd??50,50);}if(!Object.values(limits).some(v=>v!==undefined))return;const key=new URL(p.baseUrl).origin;for(;;){signal.throwIfAborted();const state=quotaDecision(history[key]??[],limits,estimateTokens(user)+outputTokens);if(state.exhausted||state.oversized)throw new QuotaError();if(!state.wait){history[key]=[...state.rows,{at:Date.now(),tokens:estimateTokens(user)+outputTokens}];writeFileSync(quotaFile,JSON.stringify(history));return;}await new Promise(r=>setTimeout(r,Math.min(60000,state.wait+20)));}}});
const rows=[];const requestMeta=[];
const fetcher=async(url,options)=>{requests++;const started=performance.now(),r=await fetch(url,options);if(r.ok&&!/event-stream|ndjson/.test(r.headers.get('content-type')??'')){const d=await r.clone().json().catch(()=>({}));requestMeta.push({elapsedMs:Math.round(performance.now()-started),loadMs:d.load_duration?Math.round(d.load_duration/1e6):undefined,inputTokens:d.prompt_eval_count??d.usage?.prompt_tokens,outputTokens:d.eval_count??d.usage?.completion_tokens});}return r;};
for(const p of profiles){let stopped=false;const startProfile=Date.now();
 for(const [index,item] of paragraphs.entries()){if(process.env.AM_BENCHMARK_IDS&&!process.env.AM_BENCHMARK_IDS.split(',').includes(item.id))continue;
  if(index>=Number(process.env.AM_BENCHMARK_LIMIT??60)||stopped)break;
  const core=JSON.parse(readFileSync(new URL('public/glossaries/core-'+item.domain+'.json',root))).terms;
  const terms=enrichTerms(core);w.document.body.innerHTML=item.html;const block=serialize(w.document.querySelector('p'),item.id,index),canonical=canonicalize(block.text),locked=lockTerms(canonical.text,terms,item.domain,String(index));
  const readonly=Object.fromEntries(Object.entries(readonlyReferences(block)).map(([token,text])=>[canonicalize(token).text,text]));for(const token of locked.text.match(/⟪AM:P:[^⟫]+⟫/g)??[])readonly[token]=readonlyReferences(block)[canonical.restore(token)]??'';
  const neighbours=paragraphs.filter(row=>row.domain===item.domain),at=neighbours.indexOf(item),context={title:item.title,heading:item.heading,abstract:'',before:item.before??(neighbours[at-1]?.heading===item.heading?neighbours[at-1].sourceText:''),after:item.after??(neighbours[at+1]?.heading===item.heading?neighbours[at+1].sourceText:'')};
  for(const quality of index%2?['precise','fast']:['fast','precise']){
   const start=performance.now(),before=requests,usageAt=requestMeta.length;let text,code,recovery=false,refined;
   const reference={domain:item.domain,readonly,terms:locked.terms,termSources:Object.fromEntries(Object.keys(locked.literals).map((token,i)=>[token,locked.terms[i].source]))};
   let req=quality==='precise'?preciseRequest(locked.text,locked.literals,context,reference):fastRequest(locked.text,locked.literals,context,readonly,locked.terms);
   if(!fitsContext(p,req.prompt,req.user,generationBudget(p,locked.text,quality)))req=quality==='precise'?preciseRequest(locked.text,locked.literals,{...context,before:'',after:''},reference):req;
   try{
    if(!fitsContext(p,req.prompt,req.user,generationBudget(p,locked.text,quality)))throw new Error('本段超出上下文预算');
    try{text=req.decode(await callModel(p,req.prompt,req.user,new AbortController().signal,fetcher,quality,false,{maxOutputTokens:generationBudget(p,locked.text,quality)}));}catch(e){if(e instanceof QuotaError||e.status===401||e.status===403||e.code==='free-policy')throw e;recovery=true;try{text=(await translateRequest(p,systemPrompt,JSON.stringify({domain:item.domain,segments:[{id:'s0',text:locked.text,readonly,terminology:reference.terms.map((t,i)=>({token:Object.keys(locked.literals)[i],source:t.source,target:t.target,sense:t.sense,definition:t.definition}))}]}),[{id:'s0',text:locked.text}],new AbortController().signal,quality,fetcher))[0].text;}catch(error){if(error instanceof QuotaError||error.status||error.code==='free-policy')throw error;text=await recoverProtectedParagraph(locked.text,async chunk=>{const part=quality==='precise'?preciseRequest(chunk,locked.literals,context,reference):fastRequest(chunk,locked.literals,context,readonly,locked.terms);return part.decode(await callModel(p,part.prompt,part.user,new AbortController().signal,fetcher,quality,false,{maxOutputTokens:generationBudget(p,chunk,quality)}));});}}
    const initialMs=Math.round(performance.now()-start);
    // Sample edits in all domains, rather than imposing a second call on every paragraph.
    if(quality==='precise'&&index%10===0){const begun=performance.now();let rejected;const edited=await polishTranslation(p,locked.text,text,locked.literals,context,reference,new AbortController().signal,fetcher,reason=>{rejected=reason;});refined={elapsedMs:Math.round(performance.now()-begun),applied:!rejected,changed:edited!==text,code:rejected?errorCode(new Error(rejected)):undefined,text:restore(edited)};}
    rows.push({id:item.id,domain:item.domain,model:p.model,quality,source:item.sourceText,text:restore(text),initialMs,totalMs:Math.round(performance.now()-start),requests:requests-before,recovery,protectedCount:(locked.text.match(/⟪AM:/g)??[]).length,valid:true,refined,usage:requestMeta.slice(usageAt)});
   }catch(e){code=errorCode(e);rows.push({id:item.id,domain:item.domain,model:p.model,quality,valid:false,code,requests:requests-before,totalMs:Math.round(performance.now()-start)});if(e instanceof QuotaError||e.status===401||e.status===403||e.code==='free-policy')stopped=true;}
   function restore(value){return canonical.restore(Object.entries(locked.literals).reduce((s,[t,target])=>s.replaceAll(t,target),value)).replace(/⟪AM:P:([^⟫]+)⟫/g,(_m,id)=>readonlyReferences(block)['⟪AM:P:'+id+'⟫']??'〔公式/代码〕').replace(/⟪AM:[OC]:[^⟫]+⟫/g,'');}
   console.log(item.id,quality,rows.at(-1).valid?'valid':'failed',rows.at(-1).totalMs+'ms');writeFileSync(folder+'/results.json',JSON.stringify({at:new Date().toISOString(),rows,requests},null,2));
  }
 }
 console.log('Profile completed',p.model,'elapsed',Date.now()-startProfile,'ms');
}
// The reviewer sees neither model identity nor tier. Reveal only after scoring.
const blind=[],key={};for(const item of paragraphs){const variants=rows.filter(r=>r.id===item.id&&r.valid).sort(()=>randomInt(2)?1:-1);for(const variant of variants){const id=randomUUID();blind.push({id,paragraph:item.id,source:item.sourceText,sourceHtml:item.html,translation:variant.text,accuracy:null,naturalness:null,terminology:null,hardError:null,notes:''});key[id]={model:variant.model,quality:variant.quality};}}
writeFileSync(folder+'/blind-review.json',JSON.stringify(blind,null,2));writeFileSync(folder+'/reveal-after-review.json',JSON.stringify(key,null,2));
writeFileSync(folder+'/summary.json',JSON.stringify({at:new Date().toISOString(),requests,profiles:profiles.map(p=>({model:p.model,contextTokens:p.contextTokens})),tiers:['fast','precise'].map(quality=>{const samples=rows.filter(r=>r.quality===quality);const valid=samples.filter(r=>r.valid),times=valid.map(r=>r.initialMs).sort((a,b)=>a-b);return {quality,total:samples.length,valid:valid.length,medianMs:times[Math.floor(times.length/2)],minMs:times[0],maxMs:times.at(-1),recovery:valid.filter(r=>r.recovery).length,revisionSamples:valid.filter(r=>r.refined).map(r=>({id:r.id,...r.refined,text:undefined}))};}),semanticRatings:'Pending anonymous human review; structural validity is not translation quality.'},null,2));
await w.happyDOM.close();
