import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const text=readFileSync(new URL('../data/core.tsv',import.meta.url),'utf8');
let domain='math';const terms=[];const keys=new Set();
for(const line of text.split('\n')){if(line.startsWith('# ')){domain=line.slice(2);continue;}if(!line.trim())continue;const [source,target]=line.split('\t');const key=domain+'|'+source.toLowerCase();if(keys.has(key))throw new Error('Duplicate: '+key);keys.add(key);const id='am-'+createHash('sha256').update(key).digest('hex').slice(0,12);terms.push({id,source,target,domain,sense:source,aliases:[],sourceUrl:'',sourceNote:'AM 项目整理的英中术语；项目编辑检查，待持续专业复核。',license:'CC0-1.0',quality:'core',enabled:true});}
const pack={name:'AM 数学·物理·计算机核心词库',version:'2026-10-04',author:'AM Academic Translator contributors',license:'CC0-1.0',review:'项目编辑检查；并非由领域专家逐条认证。原词与译名可在 data/core.tsv 中审阅、修正。来源核对进度在 data/glossary-audit/core-evidence.json，未完成的记录不算作已核实。',terms};
const endings=new Set('set group ring field module operator vector term lemma theorem proof axiom proposition sequence equation variable function coefficient tensor formula algorithm example feature class parameter argument type manifold graph edge subspace quantifier domain element constant state particle photon boson fermion wave eigenvalue eigenvector neutrino law frequency framework energy query row column constraint definition category'.split(' '));
const irregular={matrix:'matrices',basis:'bases',vertex:'vertices',analysis:'analyses',hypothesis:'hypotheses',axis:'axes',index:'indices'};
for(const t of terms){const word=t.source.split(' ').at(-1);if(word in irregular||endings.has(word)){const plural=irregular[word]??(word.endsWith('y')?word.slice(0,-1)+'ies':word.endsWith('ss')?word+'es':word+'s');t.aliases=[t.source.slice(0,-word.length)+plural];}}
const senses=[{domain:'physics',source:'polarization',target:'极化',sense:'介质的电极化',contexts:['electric','dielectric','dipole','charge']},{domain:'cs',source:'token',target:'词法单元',sense:'编译器中的词法单元',contexts:['compiler','parser','lexer','syntax','lexical']}];
for(const sense of senses){const t=terms.find(t=>t.domain===sense.domain&&t.source===sense.source);Object.assign(t,sense);}
for(const sense of [{domain:'physics',source:'polarization',target:'偏振',sense:'光的偏振',contexts:['light','optical','photon','laser']},{domain:'cs',source:'token',target:'词元',sense:'语言模型中的文本词元',contexts:['language model','LLM','prompt','tokenization','attention','transformer','vocabulary']},
 {domain:'math',source:'permutation',target:'置换',sense:'集合自双射',contexts:['bijection','symmetric group','group action','permutation group','transposition','cycle decomposition']},
 {domain:'math',source:'remainder',target:'余数',sense:'整数除法的余数',contexts:['integer division','quotient','Euclidean division','modulo','divisor','dividend']},
 {domain:'cs',source:'precision',target:'精度',sense:'数值表示精度',contexts:['floating-point','numerical','float32','float64','FP16','FP32','mantissa','rounding','bit width']},
 {domain:'cs',source:'normalization',target:'归一化',sense:'机器学习数值缩放',contexts:['feature scaling','standardization','min-max','z-score','neural network','machine learning','dataset']},
 {domain:'cs',source:'anti-aliasing',target:'抗混叠',sense:'信号采样中的抗混叠',contexts:['signal','sampler','Nyquist','low-pass','sampling theorem']},
 {domain:'cs',source:'temperature',target:'温度',sense:'计算设备的物理温度',contexts:['GPU temperature','CPU temperature','thermal','cooling','sensor','overheating']}]){const base=terms.find(t=>t.domain===sense.domain&&t.source===sense.source);terms.push({...base,...sense,id:base.id+'-sense'});}
// Evidence supports provenance; it does not silently promote an unchecked
// translation or replace the core's edited Chinese name with a scraped label.
const evidencePath=new URL('../data/glossary-audit/core-review.json',import.meta.url);
if(existsSync(evidencePath)) {
 const audit=JSON.parse(readFileSync(evidencePath,'utf8'));
 for(const term of terms) {
  const entry=audit.entries.find(e=>e.domain===term.domain&&e.source===term.source&&e.target===term.target);
  if(entry?.reviewStatus!=='project-checked'||!entry.checks.translation||!entry.checks.domain||!entry.checks.source)continue;
  term.sourceUrl=entry.sourceUrl;term.definition=entry.definition;
  if(entry.contexts)term.contexts=entry.contexts;
  if(entry.sense)term.sense=entry.sense;
  if(entry.requiresContext)term.requiresContext=true;
  if(entry.aliases)term.aliases=[...new Set([...term.aliases,...entry.aliases])];
  term.sourceNote=`AM 项目 AI 辅助编辑核对，非领域专家认证；${entry.reviewNote} 逐条依据见 data/glossary-audit/core-review.json。`;
 }
}
mkdirSync('public/glossaries',{recursive:true});writeFileSync('public/glossaries/core.json',JSON.stringify(pack,null,2)+'\n');
console.log('Core terms:',terms.length,Object.fromEntries(['math','physics','cs'].map(d=>[d,terms.filter(t=>t.domain===d).length])));
await import('./split-glossaries.mjs');
