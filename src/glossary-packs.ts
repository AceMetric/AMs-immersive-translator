import { createSnapshotReader } from './glossary-update-storage';
import type { GlossarySnapshot } from './glossary-update';
import type { Domain,GlossaryPack,Term } from './types';
export type PackIndex={version:string;packs:{group:'core'|'extended';domain:Exclude<Domain,'auto'>;file:string;count:number;name:string;version:string;author:string;license:string}[]};
export function createPackLoader(indexUrl:string,readSnapshot:()=>Promise<GlossarySnapshot|undefined>=createSnapshotReader()){
 let index:Promise<PackIndex>|undefined;
 const loaded=new Map<string,Promise<Term[]>>();
 return async(group:'core'|'extended',domain:Domain='auto'):Promise<Term[]>=>{
  const snapshot=await readSnapshot();
  if(snapshot)return snapshot.manifest.packs.filter(p=>p.group===group&&(domain==='auto'||p.domain===domain)).flatMap(p=>snapshot.packs[p.file]!.terms);
  index??=fetch(indexUrl).then(r=>{if(!r.ok)throw new Error('无法读取内置词库目录。');return r.json();}).catch(e=>{index=undefined;throw e;});
  const entries=(await index).packs.filter(p=>p.group===group&&(domain==='auto'||p.domain===domain||p.domain==='general'));
  return (await Promise.all(entries.map(p=>{if(!loaded.has(p.file))loaded.set(p.file,fetch(new URL(p.file,indexUrl)).then(r=>{if(!r.ok)throw new Error('无法读取内置领域词库。');return r.json();}).then((pack:GlossaryPack)=>pack.terms));return loaded.get(p.file)!;}))).flat();
 };
}
