import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createJiti } from 'jiti';
const {findTerms}=await createJiti(import.meta.url).import('../src/glossary.ts');
const index=JSON.parse(readFileSync('public/glossaries/index.json','utf8'));
const terms=index.packs.flatMap(p=>JSON.parse(readFileSync(`public/glossaries/${p.file}`,'utf8')).terms);
const corpus=JSON.parse(readFileSync('data/benchmark/public-60.json','utf8')).paragraphs;
const results=[];
for(const domain of ['math','physics','cs']){
 const paragraphs=corpus.filter(p=>p.domain===domain),timings=[];let hits=0;
 for(const p of paragraphs){const start=performance.now();hits+=findTerms(p.sourceText,terms,domain,true,p.sourceText).length;timings.push(performance.now()-start);}
 results.push({domain,samples:paragraphs.length,hits,firstMs:timings[0],maxMs:Math.max(...timings),medianMs:timings.toSorted((a,b)=>a-b)[Math.floor(timings.length/2)]});
}
const report={measuredAt:new Date().toISOString(),runtime:process.version,terms:terms.length,
 scope:'Node process, 60 public paragraphs, candidates included; lookup only, not browser or translation latency.',results};
mkdirSync('artifacts/glossary-research',{recursive:true});
writeFileSync('artifacts/glossary-research/lookup-performance-current.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
