import {contextLimit,outputBudget} from './budget';
import type { Profile, QualityMode } from './types';
import {assertFreeProfile} from './free-services';
import {consumeModelStream,StreamServiceError} from './stream';
import {errorCode,type Diagnostic} from './diagnostics';
export class ProviderError extends Error { constructor(message:string,public status=0,public retryAfter=0){super(message);} }
export class ModelOutputError extends Error {}
export class QuotaError extends ProviderError {readonly code='quota';constructor(message='免费额度已耗尽，已暂停；不会转为付费。'){super(message,429);}}
let runtime:{beforeRequest?:(p:Profile,user:string,signal:AbortSignal,outputTokens:number)=>Promise<void>;diagnostic?:(record:Diagnostic)=>Promise<void>|void}={};
export function configureProviderRuntime(value:typeof runtime){runtime=value;}
export type ModelOptions={schema?:Record<string,unknown>;maxOutputTokens?:number;onText?:(text:string)=>void};
const promptOnlyJSON=new Set<string>();
export function thinkingOptions(p:Profile,quality:QualityMode):Record<string,unknown> {
  // Local precision keeps its terminology/context even without long reasoning.
  // Missing flags in existing installations migrate to direct translation.
  const enabled=quality==='precise'&&p.preciseThinking===true;
  if(p.thinkingControl==='none')return {};
  if(p.kind==='ollama')return {think:enabled};
  if(p.thinkingControl==='reasoning-effort')return {reasoning_effort:enabled?'high':'low'};
  if(p.thinkingControl==='enable-thinking')return {enable_thinking:enabled};
  if(p.thinkingControl==='thinking-type'||p.preset==='glm')return {thinking:{type:enabled?'enabled':'disabled'}};
  if(p.kind==='claude')return enabled?{thinking:/4[.-]6/.test(p.model)?{type:'adaptive'}:{type:'enabled',budget_tokens:2048}}:{thinking:{type:'disabled'}};
  if(p.kind==='gemini'){
    if(/gemini-3/.test(p.model))return {thinkingConfig:{thinkingLevel:enabled?'high':/flash/i.test(p.model)?'minimal':'low'}};
    if(/gemini-2\.5/.test(p.model))return {thinkingConfig:{thinkingBudget:enabled?2048:/pro/.test(p.model)?128:0}};
    return {};
  }
  if(/deepseek/i.test(p.model))return {thinking:{type:enabled?'enabled':'disabled'}};
  // Unknown compatible servers have no universal thinking parameter. Opt in explicitly.
  return {};
}
export function buildRequest(p:Profile,system:string,user:string,quality:QualityMode='fast',json=false,options:ModelOptions={}) {
  const base=p.baseUrl.replace(/\/$/,'');const headers:Record<string,string>={'Content-Type':'application/json',...p.headers};
  if(p.translationModel==='hy-mt'){user='[Translation Tasks]\n'+system+'\n[Background Information and Source Data]\n'+user;system='';}
  const messages=system?[{role:'system',content:system},{role:'user',content:user}]:[{role:'user',content:user}];
  const budget=Math.min(outputBudget(p),Math.max(128,options.maxOutputTokens??outputBudget(p)));
  const structured=json&&p.capabilities?.structured!=="prompt";
  const responseFormat=structured&&p.capabilities?.structured==='schema'&&options.schema?{type:'json_schema',json_schema:{name:'am_output',strict:true,schema:options.schema}}:structured&&p.capabilities?.structured?{type:'json_object'}:undefined;
  // MLX variants currently reject native structured generation. Avoid an expensive
  // failed capability probe; unknown backends are detected from their actual error.
  if(p.kind==='ollama'){if(p.apiKey)headers.Authorization=`Bearer ${p.apiKey}`;return {url:`${base.replace(/\/v1$/,'')}/api/chat`,headers,body:{model:p.model,messages,stream:p.capabilities?.streaming===true,...(structured&&!/(?:^|[-:])mlx(?:$|[-:])/i.test(p.model)?{format:p.capabilities?.structured==='schema'&&options.schema?options.schema:'json'}:{}),...thinkingOptions(p,quality),options:{temperature:0,num_ctx:contextLimit(p),num_predict:budget}}};}
  if(p.kind==='openai') {if(p.apiKey)headers.Authorization=`Bearer ${p.apiKey}`;return {url:`${base}/chat/completions`,headers,body:{model:p.model,messages,stream:p.capabilities?.streaming===true,max_tokens:budget,...(responseFormat?{response_format:responseFormat}:{}),...(p.preset==='openrouter'?{provider:{...(p.freeOnly?{max_price:{prompt:0,completion:0,request:0}}:{}),...(responseFormat?{require_parameters:true}:{})}}:{}),...thinkingOptions(p,quality)}};}
  if(p.kind==='claude'){if(p.apiKey)headers['x-api-key']=p.apiKey;headers['anthropic-version']??='2023-06-01';headers['anthropic-dangerous-direct-browser-access']??='true';return {url:`${base}/messages`,headers,body:{model:p.model,max_tokens:budget,...(structured&&p.capabilities?.structured==='schema'&&options.schema?{output_config:{format:{type:'json_schema',schema:options.schema}}}:{}),system,messages:[{role:'user',content:user}],stream:p.capabilities?.streaming===true,...thinkingOptions(p,quality)}};}
  if(p.apiKey)headers['x-goog-api-key']=p.apiKey;
  return {url:`${base}/models/${encodeURIComponent(p.model.replace(/^models\//,''))}${p.capabilities?.streaming?':streamGenerateContent?alt=sse':':generateContent'}`,headers,body:{systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{maxOutputTokens:budget,...(structured&&p.capabilities?.structured?{responseMimeType:'application/json',...(options.schema&&p.capabilities.structured==='schema'?{responseJsonSchema:options.schema}:{})}:{}),...thinkingOptions(p,quality)}}};
}
export function readResponse(kind:Profile['kind'],data:any):string {
  if(kind==='ollama'&&typeof data.message?.content==='string')return data.message.content;
  if(kind==='openai'){const value=data.choices?.[0]?.message?.content;if(typeof value==='string')return value;}
  if(kind==='claude'){const value=data.content?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('');if(typeof value==='string'&&value)return value;}
  if(kind==='gemini'){const value=data.candidates?.[0]?.content?.parts?.filter((p:any)=>typeof p.text==='string'&&!p.thought).map((p:any)=>p.text).join('');if(typeof value==='string'&&value)return value;}
  throw new ProviderError('模型响应中没有可读取的文字。');
}
export async function callModel(profile:Profile,system:string,user:string,signal?:AbortSignal,fetcher:typeof fetch=fetch,quality:QualityMode='fast',json=false,options:ModelOptions={}):Promise<string> {
  const capabilityKey=JSON.stringify([profile.kind,profile.baseUrl,profile.model]);
  const request=buildRequest(promptOnlyJSON.has(capabilityKey)?{...profile,capabilities:{structured:'prompt',streaming:profile.capabilities?.streaming===true}}:profile,system,user,quality,json,options);
  let timeout:AbortSignal|undefined;const admissionSignal=signal??new AbortController().signal;
  const start=performance.now();let raw='',code:string|undefined,admittedAt=start;
  try {
    admissionSignal.throwIfAborted();assertFreeProfile(profile);
    await runtime.beforeRequest?.(profile,system+'\n'+user,admissionSignal,Math.min(outputBudget(profile),Math.max(128,options.maxOutputTokens??outputBudget(profile))));
    admittedAt=performance.now();timeout=AbortSignal.timeout(profile.timeoutMs);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await fetcher(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(request.body),signal:combined,redirect:'error'});
    if(!response.ok){
      const data=await response.clone().json().catch(()=>({}));const detail=String(data.error?.message??data.error??'');
      if(json&&!promptOnlyJSON.has(capabilityKey)&&[400,422,501].includes(response.status)&&/(?:structured|json|format|schema).*(?:unavailable|not supported|unsupported)|(?:unsupported|not supported).*(?:structured|json|format|schema)/i.test(detail)){
        promptOnlyJSON.add(capabilityKey);return await callModel(profile,system,user,signal,fetcher,quality,json,options);
      }
      if(profile.freeOnly&&(response.status===402||response.status===429&&/quota|daily|per day|额度|余额|credit|budget/i.test(detail)))throw new QuotaError();
      const retry=response.headers.get('Retry-After'),seconds=retry?(Number(retry)||Math.max(0,(Date.parse(retry)-Date.now())/1000)):0;
      throw new ProviderError(response.status===401||response.status===403?'密钥无效或模型访问被拒绝。':response.status===429?'服务限流，请稍后重试。':`模型服务返回 HTTP ${response.status}。`,response.status,Math.min(seconds*1000,60_000));
    }
    let reason:string|undefined;
    if(/event-stream|ndjson/i.test(response.headers.get('Content-Type')??'')){
      const result=await consumeModelStream(response,profile.kind,combined,text=>{raw=text;options.onText?.(text);});raw=result.text;reason=result.finish;
      if(!result.completed)throw new ModelOutputError('流式响应未完成，保留已校验段落。');
    }else{
      const data=await response.json();reason=data.done_reason??data.choices?.[0]?.finish_reason??data.stop_reason??data.candidates?.[0]?.finishReason;raw=readResponse(profile.kind,data);options.onText?.(raw);
    }
    if(['length','max_tokens','MAX_TOKENS'].includes(reason??''))throw new ModelOutputError('模型输出已达到长度上限，未完成译文。');
    if(!raw.trim())throw new ModelOutputError('模型只返回了思考过程，没有返回译文。');return raw;
  } catch(error){
    code=errorCode(error);
    if(signal?.aborted)throw signal.reason;
    if(timeout?.aborted)throw new ProviderError('模型响应超时，可增加超时或减小批次。');
    if(error instanceof StreamServiceError){if(profile.freeOnly&&(error.status===402||error.status===429&&error.quota))throw new QuotaError();throw new ProviderError('流式服务返回错误，已保留完整译段。',error.status);}
    if(error instanceof ProviderError||error instanceof ModelOutputError||code==='free-policy')throw error;
    if(error instanceof SyntaxError)throw new ModelOutputError('模型响应结构错误。');
    throw new ProviderError('连接或流式响应失败，请检查服务地址、授权和服务状态。');
  } finally {
    await runtime.diagnostic?.({at:Date.now(),stage:system.startsWith('Review and edit')?'refine':system.startsWith('Extract specialist')?'analysis':user==='Say 连接成功'?'connection':'translate',profile:profile.id,elapsedMs:Math.round(performance.now()-start),queueMs:Math.round(admittedAt-start),requestMs:Math.round(performance.now()-admittedAt),outputLength:raw.length,code,source:user,response:raw});
  }
}
export async function withRetry<T>(run:()=>Promise<T>,signal:AbortSignal,retries=2):Promise<T>{
  for(let attempt=0;;attempt++){try{return await run();}catch(e){if(signal.aborted)throw e;const error=e as ProviderError;if(error instanceof QuotaError||!(error instanceof ProviderError)||!(error.status===429||error.status>=500)||attempt>=retries)throw e;const ms=error.retryAfter||500*2**attempt;await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}}
}
