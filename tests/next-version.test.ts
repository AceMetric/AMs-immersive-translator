import {describe,it,expect,vi,afterEach} from 'vitest';
import {editRequest,RefinementCircuit} from '../src/refinement';
import {presets,defaults,normalizeSettings,activeProfile,safeExport} from '../src/settings';
import {assertFreeProfile,refreshFreeCatalog,restoreCatalog,FREE_CATALOGS} from '../src/free-services';
import {buildRequest,callModel,configureProviderRuntime,withRetry,QuotaError} from '../src/providers';
import {completeTranslations,consumeModelStream} from '../src/stream';
import {translateRequest} from '../src/translation-call';
import {diagnosticRecord} from '../src/diagnostics';
import {enrichTerms,graphHints,conceptEdges} from '../src/term-graph';
import {validateTerm,lockTerms} from '../src/glossary';

afterEach(()=>configureProviderRuntime({}));
const source='You are welcome to prove ⟪AM:O:b⟫associativity⟪AM:C:b⟫ of ⟪AM:P:c⟫ in this ⟪AM:T:f⟫.';
const draft='你也欢迎证明 ⟪AM:O:b⟫结合律⟪AM:C:b⟫，对于 ⟪AM:P:c⟫ 在这个 ⟪AM:T:f⟫。';
const edit=()=>editRequest(source,draft,{'⟪AM:T:f⟫':'域'},{title:'Algebra'},{'⟪AM:P:c⟫':'max'});
describe('immutable revision structure',()=>{
 it('edits ordinary text inside emphasis and keeps code, term and scope byte-identical',()=>{
  const request=edit(),body=JSON.parse(request.user);
  expect(body.source).toContain('max');expect(body.draft.find((p:any)=>p.kind==='T').text).toBe('域');
  expect(request.decode(JSON.stringify({edits:[{id:'t0',text:'你也可以证明 '},{id:'t1',text:'结合性'}]}))).toBe(draft.replace('你也欢迎','你也可以').replace('结合律','结合性'));
  expect(request.decode('{"edits":[]}')).toBe(draft);
 });
 it.each([
  [{edits:[{id:'unknown',text:'新文字'}]},'unknown-slot'],
  [{edits:[{id:'t0',text:'一'},{id:'t0',text:'二'}]},'duplicate-slot'],
  [{edits:[{id:'t0',text:'⟪AM:P:evil⟫'}]},'illegal-marker'],
  [{edits:[{id:'t0',text:'[AM999]'}]},'illegal-marker'],
  [{edits:[{id:'t0',text:'<img src=x>'}]},'illegal-marker'],
  [{edits:[{id:'t0',text:''}]},'empty-slot'],
  [{edits:[],html:'x'},'response-structure'],
 ])('rejects unsafe edits %# without altering a valid draft',(value,code)=>{
  expect(()=>edit().decode(JSON.stringify(value))).toThrow();try{edit().decode(JSON.stringify(value));}catch(e){expect(e).toMatchObject({code});}
 });
 it('stops after two consecutive failures and emits the transition only once',()=>{
  const c=new RefinementCircuit();expect(c.failure('s')).toBe(false);c.success('s');expect(c.failure('s')).toBe(false);expect(c.failure('s')).toBe(true);expect(c.allowed('s')).toBe(false);expect(c.failure('s')).toBe(false);expect(c.allowed('other')).toBe(true);c.success('s');expect(c.allowed('s')).toBe(false);c.clear('s');expect(c.allowed('s')).toBe(true);
 });
});
describe('specific free services and model migration',()=>{
 it('migrates both tiers to the legacy model, with reasoning opt-in',()=>{
  const s=normalizeSettings({...defaults,activeProfile:'old',profiles:[{...presets.ollama!,id:'old',model:'Qwen'}]});
  expect(s.qualityProfiles).toEqual({fast:'old',precise:'old'});expect(s.glossaryGraph).toBe(false);
  const next={...s,profiles:[...s.profiles,{...presets.glm!,id:'cloud'}],qualityProfiles:{fast:'old',precise:'cloud'}};
  expect(activeProfile(next,'fast').model).toBe('Qwen');expect(activeProfile(next,'precise').model).toBe('glm-4.7-flash');
  expect(buildRequest(presets.glm!,'s','u','precise').body).toHaveProperty('thinking.type','disabled');
 });
 it('rejects unverified, expired, paid and redirected free profiles',()=>{
  expect(()=>assertFreeProfile(presets.glm!,Date.UTC(2026,9,3))).not.toThrow();
  expect(()=>assertFreeProfile({...presets.glm!,model:'glm-5.3'},Date.UTC(2026,9,3))).toThrow('未核实');
  expect(()=>assertFreeProfile({...presets.glm!,baseUrl:'https://other.example/v1'},Date.UTC(2026,9,3))).toThrow('供应商');
  expect(()=>assertFreeProfile(presets.glm!,Date.UTC(2026,10,4))).toThrow('过期');
  expect(()=>assertFreeProfile(presets.openrouter!,Date.UTC(2026,9,3))).toThrow();
 });
 it('discovers only exact zero-price text model IDs and never random free routing',async()=>{
  const rows=[{id:'x/model:free',architecture:{output_modalities:['text']},pricing:{prompt:'0',completion:'0',request:'0'}},{id:'x/paid:free',architecture:{output_modalities:['text']},pricing:{prompt:'0',completion:'.01'}},{id:'x/model',architecture:{output_modalities:['text']},pricing:{prompt:'0',completion:'0'}},{id:'x/image:free',architecture:{output_modalities:['image']},pricing:{prompt:'0'}}];
  const catalog=await refreshFreeCatalog(presets.openrouter!,vi.fn(async()=>new Response(JSON.stringify({data:rows}))));expect(catalog.models).toEqual(['x/model:free']);
  const p={...presets.openrouter!,model:'x/model:free'};expect(()=>assertFreeProfile(p)).not.toThrow();
  expect(buildRequest(p,'s','u').body).toHaveProperty('provider.max_price',{prompt:0,completion:0,request:0});
  restoreCatalog('openrouter',{...FREE_CATALOGS.openrouter,checkedAt:Date.now(),models:[]});
 });
 it('uses native schemas per supported protocol and Hy-MT user-only tasks',()=>{
  const schema=edit().schema;
  expect(buildRequest({...presets.openai!,capabilities:{structured:'schema',streaming:true}},'s','u','precise',true,{schema}).body).toHaveProperty('response_format.json_schema.schema',schema);
  expect(buildRequest({...presets.claude!,capabilities:{structured:'schema',streaming:false}},'s','u','precise',true,{schema}).body).toHaveProperty('output_config.format.schema',schema);
  expect(buildRequest({...presets.gemini!,capabilities:{structured:'schema',streaming:false}},'s','u','precise',true,{schema}).body).toHaveProperty('generationConfig.responseJsonSchema',schema);
  const body=buildRequest({...presets.ollama!,translationModel:'hy-mt'},'Translate into Simplified Chinese.','source').body as any;
  expect(body.messages).toHaveLength(1);expect(body.messages[0].role).toBe('user');expect(body.messages[0].content).toContain('Translate into Simplified Chinese.');
 });
 it('counts admission time separately from the request timeout and supports cancellation before dispatch',async()=>{
  configureProviderRuntime({beforeRequest:async()=>new Promise(r=>setTimeout(r,30))});
  expect(await callModel({...presets.openai!,timeoutMs:10},'s','u',undefined,vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'一'}}]}))))).toBe('一');
  const c=new AbortController();c.abort();const fetcher=vi.fn();await expect(callModel(presets.openai!,'s','u',c.signal,fetcher)).rejects.toBeDefined();expect(fetcher).not.toHaveBeenCalled();
 });
 it('pauses on free quota exhaustion without retries, provider switches or raw error leakage',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{message:'quota exhausted SECRET'}}),{status:402}));
  await expect(withRetry(()=>callModel(presets.glm!,'s','u',undefined,fetcher),new AbortController().signal)).rejects.toBeInstanceOf(QuotaError);expect(fetcher).toHaveBeenCalledTimes(1);
  expect(safeExport({...defaults,profiles:[{...presets.glm!,apiKey:'SECRET',headers:{Authorization:'SECRET'}}]}).profiles[0]).toMatchObject({apiKey:'',headers:{}});
 });
 it('omits source and raw output by default from diagnostics',()=>{
  const v={at:1,stage:'translate',profile:'id',elapsedMs:10,outputLength:4,source:'private',response:'private'};
  expect(diagnosticRecord(v)).not.toHaveProperty('source');expect(diagnosticRecord(v)).not.toHaveProperty('response');expect(diagnosticRecord(v,true).response).toBe('private');
 });
});
describe('complete streamed paragraphs',()=>{
 const segments=[{id:'a',text:'Math ⟪AM:P:f⟫'},{id:'b',text:'Next paragraph'}];
 const first='{"translations":[{"id":"a","text":"公式 ⟪AM:P:f⟫"}';
 it('publishes complete valid objects only, never partial text, missing markers or thought',()=>{
  expect(completeTranslations(first+',{"id":"b","text":"未完成',segments)).toEqual([{id:'a',text:'公式 ⟪AM:P:f⟫'}]);
  expect(completeTranslations(first.replace('⟪AM:P:f⟫',''),segments)).toEqual([]);expect(completeTranslations('<think>'+first,segments)).toEqual([]);
 });
 it.each(['openai','ollama','claude','gemini'])('reads %s chunks and finishes without exposing thought',(kind)=>{
  const frame=kind==='openai'?{choices:[{delta:{content:first},finish_reason:'stop'}]}:kind==='ollama'?{message:{content:first},done:true}:kind==='claude'?{type:'content_block_delta',delta:{type:'text_delta',text:first}}:{candidates:[{content:{parts:[{thought:true,text:'PRIVATE'},{text:first}]},finishReason:'STOP'}]};
  const raw=(kind==='ollama'?'':'data: ')+JSON.stringify(frame)+'\n'+(kind==='claude'?'data: {"type":"message_stop"}\n':'');
  return consumeModelStream(new Response(raw),kind,new AbortController().signal).then(v=>{expect(v.text).toBe(first);expect(v.completed).toBe(true);});
 });
 it('retries only missing paragraphs after truncation, retaining already delivered objects',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:first},finish_reason:'length'}]}))).mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:'{"translations":[{"id":"b","text":"下一段"}]}'},finish_reason:'stop'}]})));
  const received=vi.fn();const result=await translateRequest(presets.openai!,'s',JSON.stringify({segments}),segments,new AbortController().signal,'precise',fetcher,undefined,received);
  expect(result.map(x=>x.id)).toEqual(['a','b']);expect(received).toHaveBeenCalledTimes(2);expect(JSON.parse(JSON.parse(fetcher.mock.calls[1]![1].body).messages[1].content).segments).toEqual([segments[1]]);
 });
 it('cancels an idle stream without waiting for another chunk',async()=>{
  const c=new AbortController();let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});
  const task=consumeModelStream(new Response(body),'openai',c.signal);c.abort();await expect(task).rejects.toBeDefined();expect(cancelled).toBe(true);
 });
});
describe('bounded term graph experiment',()=>{
 const terms=enrichTerms(['field','kernel','linear map','vector space'].map(source=>validateTerm({source,target:source==='field'?'域':source==='kernel'?'核':source,domain:'math',sense:source})).map(t=>({...t,quality:'core' as const})));
 it('adds only one-hop hints with a definition, without locking absent neighbours',()=>{
  const hints=graphHints('A vector space',terms,'math');expect(hints.map(t=>t.source)).toEqual(['linear map']);expect(hints[0]!.sense).toContain('标量乘法');
  expect(lockTerms('A vector space',terms,'math','test').terms.map(t=>t.source)).not.toContain('kernel');
 });
 it('respects user authority, domain, relation thresholds and neighbour budget',()=>{
  expect(graphHints('linear map',terms,'physics')).toEqual([]);
  expect(graphHints('linear map',terms,'math','',conceptEdges.map(e=>({...e,weight:.5})))).toEqual([]);
  const user=validateTerm({source:'field',target:'用户指定域',domain:'math',sense:'field',quality:'user'});
  expect(Object.values(lockTerms('field',[user,...terms],'math','test').literals)).toContain('用户指定域');
 });
});

describe('persistent quota scheduling decisions',()=>{
 it('waits for a rolling minute, rejects oversized token reservations and exhausts a rolling day',async()=>{
  const {quotaDecision}=await import('../src/quota');const now=86400001,rows=[{at:now-100,tokens:400},{at:now-50,tokens:600}];
  expect(quotaDecision(rows,{rpm:2},100,now).wait).toBe(59900);
  expect(quotaDecision(rows,{tpm:1200},300,now).wait).toBe(59900);
  expect(quotaDecision(rows,{tpm:1200},1300,now).oversized).toBe(true);
  expect(quotaDecision(rows,{rpd:2},100,now).exhausted).toBe(true);
  expect(quotaDecision([{at:0,tokens:1}],{rpd:1},100,now).exhausted).toBe(false);
 });
 it('canonicalizes equivalent configuration objects for repeat cache hits',async()=>{
  const {stableJSON}=await import('../src/protocol');expect(stableJSON({b:{y:2,x:1},a:false})).toBe(stableJSON({a:false,b:{x:1,y:2}}));
 });
});

 it('reserves the actual bounded output at 4K without silently disabling requested reasoning',async()=>{
  const {generationBudget,fitsContext}=await import('../src/budget');const p={...presets.ollama!,contextTokens:4096};
  const budget=generationBudget(p,'A short paragraph.','precise');expect(budget).toBe(256);
  expect(fitsContext(p,'x'.repeat(3900),'text',budget)).toBe(true);expect(fitsContext(p,'x'.repeat(3900),'text')).toBe(false);
  expect(generationBudget({...p,preciseThinking:true},'Short.','precise')).toBe(2048);
 });

 it('rejects malformed extra protection syntax even when original tokens are all present',async()=>{
  const {validateTokens}=await import('../src/protocol');expect(()=>validateTokens('Text','正文 ⟪AM:⟫伪标记⟪/AM:⟫')).toThrow('非法保护标记');
  expect(()=>validateTokens('Math ⟪AM:P:f⟫','公式 ⟪AM:P:f⟫⟪AM:⟫')).toThrow();
 });

 it('bounds damaged-paragraph recovery and preserves format scopes across the split',async()=>{
  const {recoverProtectedParagraph}=await import('../src/translation-call');const source='first sentence '.repeat(15)+'⟪AM:O:b⟫bold ⟪AM:P:c⟫⟪AM:C:b⟫ '+ 'last sentence '.repeat(15);const calls:string[]=[];
  const out=await recoverProtectedParagraph(source,async chunk=>{calls.push(chunk);return chunk.replaceAll('sentence','句子');});
  expect(calls.length).toBeGreaterThan(1);expect(calls.length).toBeLessThanOrEqual(3);expect(calls.join('')).toBe(source);expect(out).toContain('⟪AM:O:b⟫bold ⟪AM:P:c⟫⟪AM:C:b⟫');
  await expect(recoverProtectedParagraph(source,async()=> '坏译文')).rejects.toThrow('标记');
 });
