import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const text=readFileSync(new URL('../data/core.tsv',import.meta.url),'utf8');
let domain='math';const terms=[];const keys=new Set();
for(const line of text.split('\n')){if(line.startsWith('# ')){domain=line.slice(2);continue;}if(!line.trim())continue;const [source,target]=line.split('\t');const key=domain+'|'+source.toLowerCase();if(keys.has(key))throw new Error('Duplicate: '+key);keys.add(key);const id='am-'+createHash('sha256').update(key).digest('hex').slice(0,12);terms.push({id,source,target,domain,sense:source,aliases:[],sourceUrl:'',sourceNote:'AM 项目整理的英中术语；项目编辑检查，待持续专业复核。',license:'CC0-1.0',quality:'core',enabled:true});}
const pack={name:'AM 数学·物理·计算机核心词库',version:'0.1.0',author:'AM Academic Translator contributors',license:'CC0-1.0',review:'项目编辑检查；并非由领域专家逐条认证。原词与译名可在 data/core.tsv 中审阅、修正。',terms};
const endings=new Set('set group ring field module operator vector term lemma theorem proof axiom proposition sequence equation variable function coefficient tensor formula algorithm example feature class parameter argument type manifold graph edge subspace quantifier domain element constant state particle photon boson fermion wave eigenvalue eigenvector neutrino law frequency framework energy query row column constraint definition category'.split(' '));
const irregular={matrix:'matrices',basis:'bases',vertex:'vertices',analysis:'analyses',hypothesis:'hypotheses',axis:'axes',index:'indices'};
for(const t of terms){const word=t.source.split(' ').at(-1);if(word in irregular||endings.has(word)){const plural=irregular[word]??(word.endsWith('y')?word.slice(0,-1)+'ies':word.endsWith('ss')?word+'es':word+'s');t.aliases=[t.source.slice(0,-word.length)+plural];}}
const senses=[{domain:'physics',source:'polarization',target:'极化',sense:'介质的电极化',contexts:['electric','dielectric','dipole','charge']},{domain:'cs',source:'token',target:'词法单元',sense:'编译器中的词法单元',contexts:['compiler','parser','lexer','syntax','lexical']}];
for(const sense of senses){const t=terms.find(t=>t.domain===sense.domain&&t.source===sense.source);Object.assign(t,sense);}
for(const sense of [{domain:'physics',source:'polarization',target:'偏振',sense:'光的偏振',contexts:['light','optical','photon','laser']},{domain:'cs',source:'token',target:'词元',sense:'语言模型中的文本词元',contexts:['language model','LLM','prompt','tokenization','attention','transformer','vocabulary']}]){const base=terms.find(t=>t.domain===sense.domain&&t.source===sense.source);terms.push({...base,...sense,id:base.id+'-sense'});}
mkdirSync('public/glossaries',{recursive:true});writeFileSync('public/glossaries/core.json',JSON.stringify(pack,null,2)+'\n');
console.log('Core terms:',terms.length,Object.fromEntries(['math','physics','cs'].map(d=>[d,terms.filter(t=>t.domain===d).length])));
await import('./split-glossaries.mjs');
