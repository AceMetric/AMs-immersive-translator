import {chromium,expect,test} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {defaults,presets} from '../../src/settings';
import {polishTranslation} from '../../src/translation-call';

test('real local Qwen writes natural Chinese and retains invitations, negation and quantifiers',async()=>{
 test.skip(!process.env.AM_LIVE_PROSE,'Set AM_LIVE_PROSE=1 to test the existing local model serially.');test.setTimeout(180000);
 const folder='artifacts/precision-prose-debug';mkdirSync(folder,{recursive:true});const requests:any[]=[];
 const fixture=`<!doctype html><meta charset="utf-8"><title>Mathematics in Lean — exercises</title><style>body{font:20px/1.7 system-ui;max-width:1000px;margin:40px auto}p{margin:25px 0}code{background:#eee;padding:2px 6px}</style><main>
 <p id="invitation">Of course, you are welcome to prove the associativity of <code>max</code> as well.</p>
 <p id="quantifiers">For every nonzero vector, there exists a linear functional that does not vanish on it.</p>
 <p id="negation">This does not follow from transitivity alone. The converse holds only if the set is finite.</p>
 <p id="nominal">The choice of this representation is motivated by the need to avoid ambiguity, rather than by considerations of efficiency.</p>
 <p id="qualification">Although this construction is useful, it does not by itself establish uniqueness, which must be proved separately.</p>
 </main>`;
 const tags=await fetch('http://localhost:11434/api/tags').then(r=>r.json()) as any;const model=tags.models[0].name;
 const server=createServer(async(req,res)=>{
  if(req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
  let raw='';for await(const c of req)raw+=c;const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});const start=Date.now();
  try{const response=await fetch('http://localhost:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:raw,signal:controller.signal});const data=await response.json();requests.push({request:JSON.parse(raw),response:data,durationMs:Date.now()-start});res.writeHead(response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}catch{if(!res.destroyed){res.writeHead(502);res.end('{}');}}
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 const build=mkdtempSync(resolve(tmpdir(),'am-prose-build-'));cpSync(resolve('.output/chrome-mv3'),build,{recursive:true});const manifest=JSON.parse(readFileSync(resolve(build,'manifest.json'),'utf8'));expect(manifest.host_permissions).toBeUndefined();manifest.host_permissions=['http://127.0.0.1/*'];writeFileSync(resolve(build,'manifest.json'),JSON.stringify(manifest));
 const context=await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(),'am-prose-profile-')),{channel:'chromium',headless:true,viewport:{width:1300,height:900},args:[`--disable-extensions-except=${build}`,`--load-extension=${build}`]});
 try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  await options.evaluate(async(settings)=>chrome.storage.local.set({settings}),{...defaults,mode:'academic',qualityMode:'precise',domain:'math',profiles:[{...presets.ollama!,id:'prose',model,baseUrl:`http://127.0.0.1:${port}`,contextTokens:8192,concurrency:1}],activeProfile:'prose'});
  const article=await context.newPage(),url=`http://127.0.0.1:${port}/prose`;await article.goto(url);const originalCode=await article.locator('#invitation code').evaluate(n=>n.outerHTML);
  const tabId=await options.evaluate(async(url)=>(await chrome.tabs.query({})).find(t=>t.url===url)!.id!,url);const start=Date.now();await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'start',tabId}),tabId);
  await expect(article.locator('#invitation .am-translation:not([data-error])')).toContainText('结合律',{timeout:120000});const firstMs=Date.now()-start;
  await expect(article.locator('#quantifiers .am-translation:not([data-error])')).toContainText(/[\u4e00-\u9fff]/,{timeout:120000});await expect(article.locator('#negation .am-translation:not([data-error])')).toContainText(/[\u4e00-\u9fff]/,{timeout:120000});
  for(const name of ['nominal','qualification']){await article.locator('#'+name).scrollIntoViewIfNeeded();await expect(article.locator('#'+name+' .am-translation:not([data-error])')).toContainText(/[\u4e00-\u9fff]/,{timeout:120000});}
  const texts=await article.locator('[data-am-translation]').evaluateAll(ns=>ns.map(n=>{const clone=n.cloneNode(true) as HTMLElement;clone.querySelectorAll('[data-am-ui]').forEach(x=>x.remove());return clone.textContent??'';}));
  expect(await article.locator('#invitation > code').evaluate(n=>n.outerHTML)).toBe(originalCode);await expect(article.locator('#invitation .am-translation code')).toHaveText('max');await article.screenshot({path:`${folder}/natural-chinese.png`});
  await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'page-command',tabId,command:'restore'}),tabId);await expect(article.locator('[data-am-translation]')).toHaveCount(0);expect(await article.locator('#invitation code').evaluate(n=>n.outerHTML)).toBe(originalCode);
  // End the article session before standalone edit calls, so idle analysis cannot overlap them.
  const source='Of course, you are welcome to prove the ⟪AM:T:0:0⟫ of ⟪AM:P:0⟫ as well.',draft='当然，你也欢迎证明 ⟪AM:P:0⟫ 的 ⟪AM:T:0:0⟫。';
  const revised=await polishTranslation({...presets.ollama!,model,baseUrl:`http://127.0.0.1:${port}`,contextTokens:8192},source,draft,{'⟪AM:T:0:0⟫':'结合律'},{title:'Mathematics in Lean',heading:'Exercises',abstract:'',before:'We encourage you to prove the following as exercises.',after:''},{domain:'math',readonly:{'⟪AM:P:0⟫':'max'},termSources:{'⟪AM:T:0:0⟫':'associativity'}},new AbortController().signal);
  expect(revised).not.toMatch(/你.{0,3}欢迎/);expect(revised).toMatch(/可以|不妨|也可|还可/);const polishedText=revised.replace('⟪AM:T:0:0⟫','结合律').replace('⟪AM:P:0⟫','max');
  const revisedNominal=await polishTranslation({...presets.ollama!,model,baseUrl:`http://127.0.0.1:${port}`,contextTokens:8192},'The choice of this representation is motivated by the need to avoid ambiguity, rather than by considerations of efficiency.',texts[3]!,{},{title:'Technical document',heading:'Representations',abstract:'',before:'',after:''},{domain:'math'},new AbortController().signal);
  expect(revisedNominal).toMatch(/歧义|含糊/);expect(revisedNominal).toContain('效率');expect(revisedNominal).toMatch(/而非|而不是|并非|不是/);
  writeFileSync(`${folder}/report.json`,JSON.stringify({model,mode:'academic',qualityMode:'precise',contextTokens:8192,firstMs,totalMs:Date.now()-start,texts,polishedText,revisedNominal,requests},null,2));
  expect(texts[0]).not.toMatch(/你.{0,3}欢迎/);expect(texts[0]).toMatch(/可以|不妨|也可|还可/);expect(texts[1]).toMatch(/每个|每一个|任意|任何/);expect(texts[1]).toContain('存在');expect(texts[1]).toMatch(/非零|不为零/);expect(texts[1]).toMatch(/不|非/);expect(texts[2]).toMatch(/不能|并不|不/);expect(texts[2]).toMatch(/只有|仅当|仅在|必须|必要/);expect(texts[2]).toContain('有限');expect(texts[3]).toMatch(/歧义|含糊/);expect(texts[3]).toMatch(/而非|而不是|并非|不是/);expect(texts[3]).toContain('效率');expect(texts[4]).toMatch(/并不|不能|不/);expect(texts[4]).toContain('唯一');expect(texts[4]).toMatch(/另行|单独|分别/);expect(requests.filter(r=>r.request.messages[0].content.startsWith('Translate')).every(r=>r.request.think===false)).toBe(true);
 }finally{await context.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
