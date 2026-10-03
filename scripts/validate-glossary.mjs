import { readFileSync } from 'node:fs';
let total=0;
const index=JSON.parse(readFileSync('public/glossaries/index.json','utf8'));
let coreCount=0;
for(const item of index.packs){
 const filename=item.group;const pack=JSON.parse(readFileSync(`public/glossaries/${item.file}`,'utf8'));
 if(filename==='core')coreCount+=pack.terms.length;
 if(pack.terms.length!==item.count||pack.terms.some(t=>t.domain!==item.domain))throw new Error('Pack index/domain mismatch');
 if(!pack.name||!pack.version||!pack.author||!pack.license)throw new Error(`${filename}: missing package metadata`);
 const ids=new Set(),keys=new Set();
 for(const t of pack.terms){if(!t.source||!t.target||!['math','physics','cs','general'].includes(t.domain)||!t.license||!t.sourceNote&&!t.sourceUrl)throw new Error(`${filename}: invalid term ${JSON.stringify(t)}`);if(ids.has(t.id))throw new Error(`Duplicate ID: ${t.id}`);ids.add(t.id);const key=`${t.domain}|${t.source.toLowerCase()}|${t.sense}`;if(keys.has(key))throw new Error('Duplicate term: '+key);keys.add(key);if(filename==='extended'&&t.quality!=='candidate')throw new Error('Unreviewed data must remain candidate');}
 console.log(`${pack.name}: ${pack.terms.length} valid entries`);total+=pack.terms.length;
}
if(coreCount<1000)throw new Error('Core needs at least 1000 real terms');
console.log('Total:',total,'Core:',coreCount);
