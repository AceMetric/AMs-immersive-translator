// Pin six JSON data files to an immutable, already committed Git revision.
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const checking=process.argv.includes('--check');
const root=new URL('../',import.meta.url);
const directory=new URL('public/glossaries/',root);
const manifestFile=new URL('update.json',directory);
const revision=packs=>hash([...packs].sort((a,b)=>a.file.localeCompare(b.file,'en')).map(p=>`${p.file}:${p.sha256}`).join('\n'));
if(checking){
 const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
 if(manifest.schemaVersion!==1||manifest.packs.length!==6||!/^[a-f0-9]{40}$/.test(manifest.sourceRevision)||manifest.revision!==revision(manifest.packs))throw new Error('Invalid glossary update manifest');
 const index=JSON.parse(await readFile(new URL('index.json',directory),'utf8'));
 for(const entry of index.packs){const data=await readFile(new URL(entry.file,directory));const advertised=manifest.packs.find(p=>p.file===entry.file);if(!advertised||advertised.sha256!==hash(data)||advertised.bytes!==data.length||Object.entries(entry).some(([k,v])=>advertised[k]!==v))throw new Error(`Stale update manifest: ${entry.file}. Commit the data, then run npm run glossary:update-manifest.`);}
 console.log('Glossary update manifest: six pinned packs, checksums and counts verified.');
}else{
 const cwd=root.pathname;
 const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
 const committed=file=>execFileSync('git',['show',`${sourceRevision}:public/glossaries/${file}`],{cwd,maxBuffer:16*1024*1024});
 const index=JSON.parse(committed('index.json').toString('utf8'));
 const packs=index.packs.map(p=>{const bytes=committed(p.file);return {...p,bytes:bytes.length,sha256:hash(bytes)};});
 const publishedAt=execFileSync('git',['show','-s','--format=%cI',sourceRevision],{cwd,encoding:'utf8'}).trim();
 await writeFile(manifestFile,JSON.stringify({schemaVersion:1,revision:revision(packs),sourceRevision,minExtensionVersion:'0.1.9',publishedAt,packs},null,2)+'\n');
 console.log(`Pinned glossary data to ${sourceRevision}; run glossary:update-check before publishing.`);
}
