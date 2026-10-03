import {parseModelJSON,tokenPattern,validateTokens} from './protocol';
export class RefinementError extends Error {constructor(public code:string,message:string){super(message);}}
export const editSchema={type:'object',additionalProperties:false,required:['edits'],properties:{edits:{type:'array',items:{type:'object',additionalProperties:false,required:['id','text'],properties:{id:{type:'string'},text:{type:'string'}}}}}};
export function textSlots(draft:string,literals:Record<string,string>,readonly:Record<string,string>={}){
  const pieces:{id?:string;text:string;token?:string;kind?:string}[]=[];let at=0,index=0;
  const push=(text:string)=>{if(text)pieces.push({id:`t${index++}`,text});};
  for(const match of draft.matchAll(tokenPattern)){push(draft.slice(at,match.index));const token=match[0];pieces.push({token,text:literals[token]??readonly[token]??'〔受保护内容〕',kind:token.split(':')[1]});at=match.index!+token.length;}
  push(draft.slice(at));return pieces;
}
export function editRequest(source:string,draft:string,literals:Record<string,string>,context:unknown,readonly:Record<string,string>={},termSources:Record<string,string>={}){
  validateTokens(source,draft);const pieces=textSlots(draft,literals,readonly),mutable=new Map(pieces.filter(p=>p.id).map(p=>[p.id!,p.text]));
  return {schema:editSchema,user:JSON.stringify({source:source.replace(tokenPattern,t=>/^⟪AM:[OC]:/.test(t)?'':termSources[t]??readonly[t]??literals[t]??'〔受保护内容〕'),context,draft:pieces.map(({token,...p})=>p),instructions:'Only return {"edits":[{"id":"t0","text":"revised text"}]}. Edit warranted prose defects in existing text slots. Immutable pieces are read-only. Do not reproduce markers, change slot order, or return the full paragraph. Return an empty edits array when no improvement is warranted.'}),decode:(raw:string)=>{
    const value=parseModelJSON(raw) as {edits:unknown};
    if(!value||!Array.isArray(value.edits)||Object.keys(value).some(k=>k!=='edits'))throw new RefinementError('response-structure','校润响应结构错误。');
    const changes=new Map<string,string>();
    for(const edit of value.edits){
      if(!edit||typeof edit.id!=='string'||typeof edit.text!=='string'||Object.keys(edit).some(k=>k!=='id'&&k!=='text'))throw new RefinementError('response-structure','校润修改项无效。');
      if(!mutable.has(edit.id))throw new RefinementError('unknown-slot','校润返回了未知文字片段。');
      if(changes.has(edit.id))throw new RefinementError('duplicate-slot','校润重复修改同一个文字片段。');
      if(/⟪AM:|\[AM\w*\d+\]|<\/?[a-z][^>]*>/i.test(edit.text))throw new RefinementError('illegal-marker','校润在文字片段中插入了保护标记或 HTML。');
      const original=mutable.get(edit.id)!;
      if(original.trim()&&!edit.text.trim())throw new RefinementError('empty-slot','校润删除了完整文字片段。');
      if(edit.text.length>Math.max(1000,original.length*4))throw new RefinementError('oversized-edit','校润异常扩写文字。');
      changes.set(edit.id,edit.text);
    }
    const result=pieces.map(p=>p.token??changes.get(p.id!)??p.text).join('');validateTokens(source,result);return result;
  }};
}
export class RefinementCircuit {
  private failures=new Map<string,number>();
  allowed(session:string){return (this.failures.get(session)??0)<2;}
  success(session:string){if(this.allowed(session))this.failures.delete(session);}
  failure(session:string){const n=(this.failures.get(session)??0)+1;this.failures.set(session,n);return n===2;}
  clear(session:string){this.failures.delete(session);}
}
