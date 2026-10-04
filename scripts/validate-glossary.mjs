import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
let total=0;
const primaryProjects=[
 ['pytorch','pytorch/pytorch','BSD-3-Clause'],['spinning-up','openai/spinningup','MIT'],
 ['etcd','etcd-io/website','CC-BY-4.0'],['cypress','cypress-io/cypress-documentation','MIT'],
 ['postgres','postgres/postgres','PostgreSQL'],['python','python/cpython','PSF-2.0'],
 ['mdn','mdn/content','CC-BY-SA-2.5'],['transformers','huggingface/transformers','Apache-2.0'],
 ['cleverhans','cleverhans-lab/cleverhans','MIT'],
];
const index=JSON.parse(readFileSync('public/glossaries/index.json','utf8'));
let coreCount=0,extendedCount=0;
const allTerms=[];
for(const item of index.packs){
 const filename=item.group;const pack=JSON.parse(readFileSync(`public/glossaries/${item.file}`,'utf8'));
 if(filename==='core')coreCount+=pack.terms.length;
 if(filename==='extended')extendedCount+=pack.terms.length;
 allTerms.push(...pack.terms);
 if(pack.terms.length!==item.count||pack.terms.some(t=>t.domain!==item.domain))throw new Error('Pack index/domain mismatch');
 if(!pack.name||!pack.version||!pack.author||!pack.license)throw new Error(`${filename}: missing package metadata`);
 const ids=new Set(),keys=new Set();
 for(const t of pack.terms){if(!t.source||!t.target||!['math','physics','cs','general'].includes(t.domain)||!t.license||!t.sourceNote&&!t.sourceUrl)throw new Error(`${filename}: invalid term ${JSON.stringify(t)}`);if(t.requiresContext!==undefined&&typeof t.requiresContext!=='boolean'||t.requiresContext&&(!Array.isArray(t.contexts)||!t.contexts.length||t.contexts.some(c=>typeof c!=='string'||!c.trim())))throw new Error('Invalid context guard: '+t.id);if(ids.has(t.id))throw new Error(`Duplicate ID: ${t.id}`);ids.add(t.id);const key=`${t.domain}|${t.source.toLowerCase()}|${t.sense}`;if(keys.has(key))throw new Error('Duplicate term: '+key);keys.add(key);if(filename==='extended'&&t.quality!=='candidate')throw new Error('Unreviewed data must remain candidate');}
 console.log(`${pack.name}: ${pack.terms.length} valid entries`);total+=pack.terms.length;
}
if(coreCount<1000)throw new Error('Core needs at least 1000 real terms');
console.log('Total:',total,'Core:',coreCount);
if(process.argv.includes('--collection-target')||process.argv.includes('--provenance')) {
 if(process.argv.includes('--collection-target')&&extendedCount<10000)throw new Error(`Collection quantity target incomplete after quality screening: ${extendedCount}/10000 candidates; use --provenance to verify integrity without relaxing screening`);
 const audit=JSON.parse(readFileSync('data/glossary-audit/candidates.json','utf8'));
 if(audit.total!==extendedCount||audit.entries.length!==extendedCount)throw new Error('Candidate audit and shipped counts differ');
 const candidateEvidence=new Map(audit.entries.map(e=>[e.id,e]));
 if(candidateEvidence.size!==extendedCount)throw new Error('Duplicate candidate provenance IDs');
 const candidateSnapshots=new Map();
 for(const record of audit.sourceSnapshots) {
  const path=record.snapshot;
  if(!path.startsWith('data/wikidata/collected/')||path.includes('..')||!existsSync(path))throw new Error('Missing candidate source snapshot: '+path);
  const snapshot=JSON.parse(readFileSync(path,'utf8'));
  if(snapshot.license!=='CC0-1.0'||snapshot.querySha256!==record.querySha256||createHash('sha256').update(snapshot.query).digest('hex')!==record.querySha256||snapshot.rows.length!==record.rows||record.possiblyLimited||snapshot.rows.length>=snapshot.limit)throw new Error('Invalid or potentially truncated candidate source: '+path);
  const roots=new Set((snapshot.roots??[snapshot.root]).filter(Boolean).map(root=>root.id));
  const entitiesAndRoots=new Set(snapshot.rows.map(r=>`${r.item?.value?.split('/').at(-1)}|${r.root?.value?.split('/').at(-1)??snapshot.root?.id}`));
  candidateSnapshots.set(path,{snapshot,roots,entitiesAndRoots});
 }
 for(const term of allTerms.filter(t=>t.quality==='candidate')) {
  const evidence=candidateEvidence.get(term.id),qid=term.sourceUrl.split('/').at(-1);
  if(!/^Q[1-9]\d*$/.test(qid)||term.id!==`wd-${term.domain}-${qid}`||!evidence?.sources?.length)throw new Error('Candidate lacks matching provenance: '+term.id);
  for(const source of evidence.sources) {
   const record=candidateSnapshots.get(source.snapshot);
   if(!record||record.snapshot.domain!==term.domain||record.snapshot.querySha256!==source.querySha256||!record.roots.has(source.root?.id)||!record.entitiesAndRoots.has(`${qid}|${source.root.id}`))throw new Error('Candidate source does not contain entity: '+term.id);
  }
 }
 console.log('Candidate provenance verified:',extendedCount,'entries;',candidateSnapshots.size,'complete source snapshots');
 const file='data/glossary-audit/core-review.json';
 if(!existsSync(file))throw new Error('Missing per-term core review evidence');
 const review=JSON.parse(readFileSync(file,'utf8'));const reviewed=new Set();
 const snapshots=new Map();
 for(const item of review.entries) {
  const key=`${item.domain}|${item.source}|${item.target}`;
  if(reviewed.has(key))throw new Error('Duplicate review: '+key);
  const primary=item.sourceKind==='primary-documentation';
  const googleMl=primary&&item.sourceUrl.startsWith('https://developers.google.com/machine-learning/glossary#');
  const project=primary&&primaryProjects.find(([,repo])=>item.sourceUrl.startsWith(`https://raw.githubusercontent.com/${repo}/`));
  const validSource=primary
   ? /^https:\/\/lean-lang\.org\/doc\/reference\//.test(item.sourceUrl)||googleMl||!!project
   : item.sourceUrl===`https://www.wikidata.org/wiki/${item.qid}`&&/^Q[1-9]\d*$/.test(item.qid);
  if(item.reviewStatus!=='project-checked'||!item.checks?.translation||!item.checks?.domain||!item.checks?.source||!item.reviewNote||!item.definition||!validSource||!item.evidenceSnapshots?.length)throw new Error('Incomplete review evidence: '+key);
  const term=allTerms.find(t=>t.quality==='core'&&`${t.domain}|${t.source}|${t.target}`===key);
  if(!term||term.sourceUrl!==item.sourceUrl||term.definition!==item.definition)throw new Error('Review does not match shipped term: '+key);
  for(const path of item.evidenceSnapshots) {
   const prefix=primary?(project?`data/primary-sources/${project[0]}/`:googleMl?'data/primary-sources/google-ml/':'data/primary-sources/lean-reference/'):'data/wikidata/';
   if(!path.startsWith(prefix)||path.includes('..')||!existsSync(path))throw new Error('Missing source snapshot: '+path);
   if(!snapshots.has(path))snapshots.set(path,JSON.parse(readFileSync(path,'utf8')));
   const snapshot=snapshots.get(path);
   if(primary) {
    if(snapshot.sourceUrl!==item.sourceUrl.split('#')[0]||!snapshot.author||!item.evidenceLocator||!snapshot.text?.includes(item.evidenceLocator)||createHash('sha256').update(snapshot.text).digest('hex')!==snapshot.textSha256)throw new Error('Primary source evidence does not match: '+key);
    if(project) {
     if(snapshot.repo!==project[1]||snapshot.license!==project[2]||!/^[a-f0-9]{40}$/.test(snapshot.revision)||snapshot.sourceUrl!==`https://raw.githubusercontent.com/${snapshot.repo}/${snapshot.revision}/${snapshot.upstreamPath}`||!existsSync(prefix+'LICENSE.txt')||!existsSync(prefix+'ATTRIBUTION.md'))throw new Error('Pinned project source or license does not match: '+key);
    } else if(googleMl) {
     const section=snapshot.sections?.find(s=>s.id===item.sourceUrl.split('#')[1]);
     if(snapshot.license!=='CC-BY-4.0'||snapshot.licenseUrl!=='https://creativecommons.org/licenses/by/4.0/'||snapshot.licenseNotice!=='Creative Commons Attribution 4.0 License'||!section?.text.includes(item.evidenceLocator)||!existsSync(prefix+'ATTRIBUTION.md'))throw new Error('Google glossary attribution or section does not match: '+key);
    } else if(snapshot.license!=='Apache-2.0'||!existsSync(prefix+'LICENSE.txt'))throw new Error('Lean reference license does not match: '+key);
   } else if(!snapshot.rows?.some(r=>r.item?.value?.endsWith('/'+item.qid))&&!snapshot.entities?.[item.qid])throw new Error('Snapshot does not contain source entity: '+key);
  }
  reviewed.add(key);
 }
 if(reviewed.size<1000)throw new Error(`Core source/review target incomplete: ${reviewed.size}/1000 checked terms`);
 const uncheckedCore=allTerms.filter(t=>t.quality==='core'&&!reviewed.has(`${t.domain}|${t.source}|${t.target}`));
 if(uncheckedCore.length)throw new Error(`Core review incomplete: ${reviewed.size}/${coreCount} shipped core terms checked; ${uncheckedCore.length} unchecked (including ${uncheckedCore.slice(0,5).map(t=>t.source).join(', ')})`);
 console.log('Provenance verified:',extendedCount,'candidates;',reviewed.size,'project-checked core terms (not expert certification)');
 if(existsSync('data/glossary-screening.json'))console.log(execFileSync('python3',['scripts/verify-glossary-screening.py'],{encoding:'utf8'}).trim());
}
