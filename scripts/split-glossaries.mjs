import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
const root='public/glossaries/';
const old=existsSync(root+'index.json')?JSON.parse(readFileSync(root+'index.json','utf8')):null;
const index={version:'0.1.0',packs:[]};
for(const group of ['core','extended']){
 const aggregate=root+group+'.json';
 let pack;
 if(existsSync(aggregate))pack=JSON.parse(readFileSync(aggregate,'utf8'));
 else if(old){const members=old.packs.filter(p=>p.group===group).map(p=>JSON.parse(readFileSync(root+p.file,'utf8')));if(members.length)pack={...members[0],terms:members.flatMap(p=>p.terms)};}
 if(!pack)continue;
 for(const domain of ['math','physics','cs','general']){
  const terms=pack.terms.filter(t=>t.domain===domain);if(!terms.length)continue;
  const file=`${group}-${domain}.json`,name=`AM ${domain} ${group}`;
  writeFileSync(root+file,JSON.stringify({...pack,name,domain,terms},null,2)+'\n');
  index.packs.push({group,domain,file,name,count:terms.length,version:pack.version,author:pack.author,license:pack.license});
 }
 if(existsSync(aggregate))unlinkSync(aggregate);
}
writeFileSync(root+'index.json',JSON.stringify(index,null,2)+'\n');
console.log('Domain packs:',index.packs.map(p=>`${p.group}/${p.domain}: ${p.count}`).join(', '));
