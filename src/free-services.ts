import type {Profile} from './types';
export type FreeCatalog={checkedAt:number;models:string[];source:string};
export const FREE_CATALOGS:Record<NonNullable<Profile['preset']>,FreeCatalog>={
  glm:{checkedAt:Date.UTC(2026,9,3),models:['glm-4.7-flash','glm-4-flash-250414'],source:'https://docs.bigmodel.cn/cn/guide/start/model-overview'},
  siliconflow:{checkedAt:Date.UTC(2026,9,3),models:['XingChenAGI/Xing4.0-29B'],source:'https://siliconflow.cn/pricing'},
  openrouter:{checkedAt:0,models:[],source:'https://openrouter.ai/api/v1/models'},
};
const origins={glm:'https://open.bigmodel.cn',siliconflow:'https://api.siliconflow.cn',openrouter:'https://openrouter.ai'};
const verified=new Map<string,FreeCatalog>();
export class FreeServiceError extends Error {readonly code='free-policy';}
export function assertFreeProfile(p:Profile,now=Date.now()){
  if(!p.freeOnly)return;
  if(!p.preset||new URL(p.baseUrl).origin!==origins[p.preset])throw new FreeServiceError('免费配置必须使用已核实的供应商地址。');
  const c=verified.get(p.preset)??FREE_CATALOGS[p.preset];
  if(now-c.checkedAt>30*86400_000)throw new FreeServiceError('免费价格信息已过期，请在设置中重新核实免费型号。');
  if(!c.models.includes(p.model))throw new FreeServiceError('此型号未核实为免费文本模型，已暂停。不会自动更换型号或转为付费。');
}
export function catalogOrigins(p:Profile){return p.preset?[new URL(FREE_CATALOGS[p.preset].source).origin+'/*']:[];}
export async function refreshFreeCatalog(p:Profile,fetcher:typeof fetch=fetch):Promise<FreeCatalog>{
  if(!p.preset)throw new FreeServiceError('请选择一个免费服务预设。');
  const base=FREE_CATALOGS[p.preset];
  const r=await fetcher(base.source,{signal:AbortSignal.timeout(15_000),redirect:'error'});
  if(!r.ok)throw new FreeServiceError('未能读取官方免费型号信息，保留暂停状态。');
  let models:string[]=[];
  if(p.preset==='openrouter'){
    const data=await r.json();models=(data.data??[]).filter((m:any)=>m.id?.endsWith(':free')&&m.architecture?.output_modalities?.includes('text')&&m.pricing&&Object.values(m.pricing).every(v=>Number(v)===0)).map((m:any)=>m.id);
  }else{
    const html=await r.text();const text=html.replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ');
    // Match a bounded pricing row, not an unrelated "free" elsewhere on the page.
    models=base.models.filter(model=>{
      const names=p.preset==='glm'?[model.toUpperCase(),model]:[model];
      return names.some(name=>{let at=-1;while((at=text.toLowerCase().indexOf(name.toLowerCase(),at+1))>=0){if(/[\w./-]/.test(text[at-1]??'')||/[\w./-]/.test(text[at+name.length]??''))continue;const row=text.slice(at,at+190);if(p.preset==='glm'?/免费文本模型/.test(row):/免费\s+免费/.test(row))return true;}return false;});
    });
  }
  if(!models.length)throw new FreeServiceError('官方页面未能确认免费文本型号，请更新插件；不采用猜测的价格。');
  const catalog={...base,models,checkedAt:Date.now()};verified.set(p.preset,catalog);return catalog;
}
export function restoreCatalog(preset:NonNullable<Profile['preset']>,catalog:FreeCatalog){
  if(catalog.source!==FREE_CATALOGS[preset].source||!Array.isArray(catalog.models)||!Number.isFinite(catalog.checkedAt)||catalog.checkedAt>Date.now()+60_000)return;
  verified.set(preset,catalog);
}
