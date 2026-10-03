import {readFileSync} from 'node:fs';
const files=process.argv.slice(2);if(!files.length)throw new Error('Usage: node scripts/validate-contribution.mjs package.json');
for(const file of files){
 const pack=JSON.parse(readFileSync(file,'utf8'));
 for(const field of ['name','version','author','license'])if(typeof pack[field]!=='string'||!pack[field].trim())throw new Error(`${file}: missing ${field}`);
 if(!Array.isArray(pack.terms)||!pack.terms.length)throw new Error('terms must be a nonempty array');
 const keys=new Set(),ids=new Set(),domains=new Set();
 for(const t of pack.terms){
  for(const f of ['id','source','target','domain','sense','license'])if(typeof t[f]!=='string'||!t[f].trim())throw new Error(`Missing ${f}: ${JSON.stringify(t)}`);
  if(!['math','physics','cs','general'].includes(t.domain))throw new Error('Invalid domain');domains.add(t.domain);
  if(!t.sourceUrl&&!t.sourceNote)throw new Error('Source attribution is required');
  if(t.sourceUrl&&!/^https?:\/\//.test(t.sourceUrl))throw new Error('Source URL must use HTTP(S)');
  if(t.quality!=='candidate')throw new Error('New contributions must retain candidate status until reviewed');
  for(const f of ['aliases','contexts'])if(!Array.isArray(t[f])||t[f].some(v=>typeof v!=='string'||!v||v.includes('⟪AM:')))throw new Error(`${f} must be a string array`);
  if(t.source.length>200||t.target.length>200||t.source.includes('⟪AM:')||t.target.includes('⟪AM:'))throw new Error('Invalid text');
  const key=`${t.domain}|${t.source.toLowerCase()}|${t.sense}`;if(keys.has(key)||ids.has(t.id))throw new Error('Duplicate ID or sense');keys.add(key);ids.add(t.id);
 }
 if(domains.size!==1)throw new Error('Use separate packages for different domains');
 console.log(`${file}: ${pack.terms.length} valid candidate entries (${[...domains][0]})`);
}
