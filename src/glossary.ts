import type { Domain, GlossaryPack, Term } from './types';
export const domainLabels: Record<Domain,string> = { auto:'自动识别', math:'数学', physics:'物理', cs:'计算机', general:'通用' };
export const termKey = (t: Pick<Term,'source'|'domain'|'sense'>) => `${t.source.trim().toLocaleLowerCase()}|${t.domain}|${t.sense.trim()}`;
const rank: Record<Term['quality'],number> = { user:5, confirmed:4, core:3, article:2, candidate:1 };
export function mergeTerms(...groups: Term[][]): Term[] {
  const map=new Map<string,Term>();
  for(const terms of groups) for(const term of terms) {const key=termKey(term); const old=map.get(key); if(!old||rank[term.quality]>=rank[old.quality]) map.set(key,term);}
  return [...map.values()];
}
export function inferDomain(text: string): Exclude<Domain,'auto'> {
  const patterns={math:/\b(theorem|lemma|proof|algebra|topology|manifold|group|measure|Lean|Mathlib|type theory)\b/gi,physics:/\b(quantum|particle|energy|momentum|Hamiltonian|wave|electromagnetic|relativity|thermodynamic)\b/gi,cs:/\b(algorithm|programming|software|neural|network|compiler|database|machine learning|code|transformer)\b/gi};
  const scores=Object.entries(patterns).map(([domain,re])=>[domain,(text.match(re)??[]).length] as const).sort((a,b)=>b[1]-a[1]);
  return scores[0] && scores[0][1]>0 ? scores[0][0] as Exclude<Domain,'auto'> : 'general';
}
const escapeRe=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export type TermMatch = { start:number; end:number; term:Term; matched:string };
export function findTerms(text: string, terms: Term[], domain: Domain, candidates=false,context=''): TermMatch[] {
  const eligible=terms.filter(t=>t.enabled && (candidates||t.quality!=='candidate') && (t.domain===domain||t.domain==='general'));
  const hits: TermMatch[]=[];
  for(const term of eligible) for(const alias of [term.source,...term.aliases]) {
    if(!alias) continue;
    const sensitive=/^[A-Z][A-Z0-9-]{1,5}$/.test(alias);
    const re=new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(alias)}(?![\\p{L}\\p{N}_])`,sensitive?'gu':'giu');
    for(const m of text.matchAll(re)) {
      // Existing protected tokens contain labels that must never be translated.
      const prefix=text.slice(0,m.index); if(prefix.lastIndexOf('⟪')>prefix.lastIndexOf('⟫')) continue;
      hits.push({start:m.index,end:m.index+m[0].length,term,matched:m[0]});
    }
  }
  const contextText=(context+' '+text).toLowerCase();
  const score=(t:Term)=>(t.contexts??[]).reduce((n,word)=>n+(contextText.includes(word.toLowerCase())?1:0),0);
  hits.sort((a,b)=> (b.end-b.start)-(a.end-a.start)||rank[b.term.quality]-rank[a.term.quality]||score(b.term)-score(a.term)||a.start-b.start);
  const selected: TermMatch[]=[];
  for(const hit of hits) if(!selected.some(x=>hit.start<x.end&&hit.end>x.start)) {
    const competing=hits.filter(x=>x.start===hit.start&&x.end===hit.end&&rank[x.term.quality]===rank[hit.term.quality]);
    if(competing.some(x=>x.term.target!==hit.term.target&&score(x.term)===score(hit.term)))continue;
    selected.push(hit);
  }
  return selected.sort((a,b)=>a.start-b.start);
}
export function lockTerms(text:string, terms:Term[], domain:Domain, prefix:string,context='') {
  const matches=findTerms(text,terms,domain,false,context); const literals:Record<string,string>={}; let result='',at=0;
  matches.forEach((match,i)=> {const token=`⟪AM:T:${prefix}:${i}⟫`; result+=text.slice(at,match.start)+token; literals[token]=match.term.target; at=match.end;});
  return {text:result+text.slice(at),literals,terms:matches.map(m=>m.term)};
}
export function validateTerm(value: unknown): Term {
  if(!value||typeof value!=='object') throw new Error('词条必须是对象。');
  const t=value as Partial<Term>;
  if(typeof t.source!=='string'||!t.source.trim()||t.source.length>200) throw new Error('原词不能为空且最多 200 字符。');
  if(typeof t.target!=='string'||!t.target.trim()||t.target.length>200) throw new Error(`“${t.source}”的译名不能为空且最多 200 字符。`);
  if(!['math','physics','cs','general'].includes(t.domain??'')) throw new Error(`“${t.source}”的领域无效。`);
  if(t.source.includes('⟪')||t.target.includes('⟪')) throw new Error('词条不能包含插件内部占位符。');
  if(t.aliases!==undefined&&(!Array.isArray(t.aliases)||t.aliases.some(x=>typeof x!=='string'||x.length>200))) throw new Error('别名应为字符串数组。');
  if(t.contexts!==undefined&&(!Array.isArray(t.contexts)||t.contexts.some(x=>typeof x!=='string'||x.length>200)))throw new Error('适用语境应为字符串数组。');
  if(t.definition!==undefined&&(typeof t.definition!=='string'||t.definition.length>2000))throw new Error('词义定义最多 2000 字符。');
  return { definition:t.definition,id:t.id||crypto.randomUUID(), source:t.source.trim(),target:t.target.trim(),domain:t.domain!,sense:t.sense?.trim()||'',aliases:t.aliases??[],contexts:t.contexts??[],sourceUrl:t.sourceUrl??'',sourceNote:t.sourceNote??'',license:t.license??'user-provided',quality:'user',enabled:t.enabled!==false,updatedAt:Date.now() };
}
export function parseDelimited(text:string,delimiter:string): string[][] {
  const rows:string[][]=[]; let row:string[]=[],value='',quoted=false;
  for(let i=0;i<text.length;i++) {const c=text[i]!; if(c==='"') {if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;} else if(c===delimiter&&!quoted) {row.push(value);value='';} else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n') i++;row.push(value);if(row.some(Boolean)) rows.push(row);row=[];value='';}else value+=c;}
  if(quoted) throw new Error('文件中存在未闭合的引号。');
  row.push(value);if(row.some(Boolean)) rows.push(row);return rows;
}
export function parseImport(text:string,format:'json'|'csv'|'tsv'):Term[] {
  if(text.length>10_000_000) throw new Error('导入文件不能超过 10 MB。');
  text=text.replace(/^\uFEFF/,'');
  let values:unknown[];
  if(format==='json'){const data=JSON.parse(text);values=Array.isArray(data)?data:data.terms;if(!Array.isArray(values))throw new Error('JSON 应包含 terms 数组。');}
  else {const [headers,...rows]=parseDelimited(text,format==='csv'?',':'\t');if(!headers?.includes('source')||!headers.includes('target')) throw new Error('表头需要 source 和 target。');values=rows.map(row=>{const record:Record<string,unknown>={};headers.forEach((h,i)=>record[h.trim()]=row[i]??'');record.domain=record.domain||'general';record.aliases=String(record.aliases??'').split('|').filter(Boolean);record.contexts=String(record.contexts??'').split('|').filter(Boolean);record.enabled=record.enabled!=='false';return record;});}
  if(values.length>50_000) throw new Error('一次最多导入 50,000 条术语。');
  const terms=values.map(validateTerm); const seen=new Set<string>();
  for(const t of terms){const k=termKey(t);if(seen.has(k))throw new Error(`文件内存在重复词条：${t.source} (${t.domain} / ${t.sense})`);seen.add(k);}
  return terms;
}
export function exportTerms(terms:Term[],format:'json'|'csv'|'tsv'):string {
  if(format==='json')return JSON.stringify({name:'我的术语库',version:'1.0.0',author:'用户',license:'user-provided',terms} satisfies GlossaryPack,null,2);
  const fields=['source','target','domain','sense','definition','aliases','contexts','sourceUrl','license','enabled'] as const;
  const delimiter=format==='csv'?',':'\t';
  const quote=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;
  return '\uFEFF'+[fields.join(delimiter),...terms.map(t=>fields.map(k=>quote(k==='aliases'?t.aliases.join('|'):k==='contexts'?(t.contexts??[]).join('|'):t[k])).join(delimiter))].join('\r\n');
}
