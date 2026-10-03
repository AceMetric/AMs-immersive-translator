import {parseModelJSON,validateTokens} from './protocol';
import type {Segment} from './types';

// Only complete objects belonging to the translations array can be delivered.
// Incomplete strings, escaped braces, unrelated objects and repeated IDs stay out.
export function completeTranslations(raw:string,segments:Pick<Segment,'id'|'text'>[]){
  if(/^\s*<think>/i.test(raw)&&!raw.includes('</think>'))return [];
  const value=raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i,'');
  const head=value.match(/"translations"\s*:\s*\[/);if(!head)return [];
  let at=head.index!+head[0].length;const result:{id:string;text:string}[]=[];const ids=new Set<string>();
  while(at<value.length){
    while(/[\s,]/.test(value[at]??'')&&at<value.length)at++;
    if(value[at]!=='{')break;
    let depth=0,quoted=false,escaped=false,end=at;
    for(;end<value.length;end++){
      const c=value[end];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}')depth--;
      if(depth===0)break;
    }
    if(end>=value.length)break;
    try{const item=parseModelJSON(value.slice(at,end+1)) as {id:string;text:string};const source=segments.find(s=>s.id===item.id);if(source&&typeof item.text==='string'&&(!source.text.trim()||!!item.text.trim())&&!ids.has(item.id)){validateTokens(source.text,item.text);ids.add(item.id);result.push(item);}}catch{/* No partial or damaged paragraph is published. */}
    at=end+1;
  }
  return result;
}

export class StreamServiceError extends Error {constructor(public status:number,public quota:boolean){super('流式服务返回错误。');}}
export async function consumeModelStream(response:Response,kind:string,signal:AbortSignal,onText?:(text:string)=>void){
  if(!response.body)throw new Error('流式响应没有正文。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',full='',finish:string|undefined,completed=false;
  const consume=(line:string)=>{
    const data=line.startsWith('data:')?line.slice(5).trim():kind==='ollama'?line.trim():'';
    if(!data||data==='[DONE]'){if(data==='[DONE]')completed=true;return;}
    const v=JSON.parse(data);if(v.error)throw new StreamServiceError(Number(v.error.code??v.error.status)||500,/quota|daily|credit|budget|额度|余额/i.test(String(v.error.message??'')));
    const choice=v.choices?.[0];let piece='';
    if(kind==='ollama'){piece=v.message?.content??'';finish=v.done_reason;if(v.done)completed=true;}
    else if(kind==='openai'){piece=choice?.delta?.content??'';finish=choice?.finish_reason??finish;if(choice?.finish_reason)completed=true;}
    else if(kind==='claude'){piece=v.delta?.type==='text_delta'?v.delta.text:'';finish=v.delta?.stop_reason??finish;if(v.type==='message_stop')completed=true;}
    else {piece=(v.candidates?.[0]?.content?.parts??[]).filter((p:any)=>!p.thought).map((p:any)=>p.text??'').join('');finish=v.candidates?.[0]?.finishReason??finish;if(finish)completed=true;}
    if(typeof piece==='string'&&piece){full+=piece;onText?.(full);}
  };
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{for(;;){signal.throwIfAborted();const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const lines=buffer.split(/\r?\n/);buffer=lines.pop()??'';for(const line of lines)consume(line);if(done){if(buffer.trim())consume(buffer);break;}}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
  signal.throwIfAborted();
  return {text:full,finish,completed};
}
