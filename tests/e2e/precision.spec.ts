import {chromium,expect,test} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {defaults,presets} from '../../src/settings';
test('real Qwen translates the reported Lean exercise paragraphs in academic precise mode',async()=>{
 test.skip(!process.env.AM_LIVE_PRECISION&&!process.env.AM_PRECISION_REPLAY,'Set AM_LIVE_PRECISION=1 for live local regression.');test.setTimeout(300000);
 const replay=process.env.AM_PRECISION_REPLAY?JSON.parse(readFileSync(process.env.AM_PRECISION_REPLAY,'utf8')):undefined;let replayIndex=0;
 const report:any[]=[];mkdirSync('artifacts/precision-debug',{recursive:true});if(!replay)writeFileSync('artifacts/precision-debug/browser-exchanges.json','[]');
 const server=createServer(async(req,res)=>{
  if(req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync('artifacts/snapshots/lean-basics.html'));return;}
  let raw='';for await(const c of req)raw+=c;
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});const start=Date.now();
  try{if(replay){const entry=replay[replayIndex++];if(!entry){res.writeHead(503);res.end('{}');return;}expect(JSON.parse(JSON.parse(raw).messages.at(-1).content)).toEqual(JSON.parse(entry.request.messages.at(-1).content));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(entry.response));return;}const response=await fetch('http://localhost:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:raw,signal:controller.signal});const data=await response.json();const body=JSON.parse(raw);report.push({request:body,response:data,durationMs:Date.now()-start});writeFileSync('artifacts/precision-debug/browser-exchanges.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:response.status,think:body.think,format:!!body.format,predict:body.options?.num_predict,prompt:data.prompt_eval_count,output:data.eval_count,reason:data.done_reason,contentLength:data.message?.content?.length,thinkingLength:data.message?.thinking?.length,durationMs:Date.now()-start}));res.writeHead(response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}catch{if(!res.destroyed){res.writeHead(502);res.end('{}');}}
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 const extension=mkdtempSync(resolve(tmpdir(),'am-precise-build-'));cpSync(resolve('.output/chrome-mv3'),extension,{recursive:true});const manifest=JSON.parse(readFileSync(resolve(extension,'manifest.json'),'utf8'));expect(manifest.host_permissions).toBeUndefined();manifest.host_permissions=['http://127.0.0.1/*'];writeFileSync(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 const context=await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(),'am-precise-profile-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  const tags=await fetch('http://localhost:11434/api/tags').then(r=>r.json()) as any;const model=tags.models[0].name;
  await options.evaluate(async({settings})=>chrome.storage.local.set({settings}),{settings:{...defaults,mode:'academic',qualityMode:'precise',domain:'auto',batchSize:Number(process.env.AM_PRECISION_BATCH??2),maxBatchChars:Number(process.env.AM_PRECISION_BATCH??2)>2?6000:2000,profiles:[{...presets.ollama!,id:'regression',model,baseUrl:`http://127.0.0.1:${port}`,contextTokens:8192,timeoutMs:180000}],activeProfile:'regression'}});
  const article=await context.newPage();const url=`http://127.0.0.1:${port}/basics`;await article.route('**/*',r=>r.request().url()===url?r.continue():r.abort());await article.goto(url,{waitUntil:'domcontentloaded'});
  // Keep the full public page's real DOM, but target the exact reported exercise region.
  const paragraph=article.locator('p').filter({hasText:'It is clear that aux provides'}).first();await expect(paragraph).toBeVisible();await paragraph.evaluate(n=>window.scrollTo(0,n.getBoundingClientRect().top+window.scrollY));
  const originals=await article.locator('pre,span.math,math').evaluateAll(ns=>ns.map(n=>n.outerHTML));
  const tabId=await options.evaluate(async(url)=>(await chrome.tabs.query({})).find(t=>t.url===url)!.id!,url);
  await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'start',tabId}),tabId);
  await expect(paragraph.locator('.am-translation:not([data-error])')).toContainText(/[\u4e00-\u9fff]/,{timeout:180000});
  const other=article.locator('p').filter({hasText:'Lean’s naming convention is made manifest'}).first();await expect(other.locator('.am-translation:not([data-error])')).toContainText(/[\u4e00-\u9fff]/,{timeout:120000});
  expect(await article.locator('pre,span.math,math').evaluateAll(ns=>ns.filter(n=>!n.closest('[data-am-translation]')).map(n=>n.outerHTML))).toEqual(originals);
  const {result:state}=await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'get-state',tabId}),tabId);
  if(!replay)writeFileSync('artifacts/precision-debug/precision-report.json',JSON.stringify({model,qualityMode:'precise',mode:'academic',contextTokens:8192,batchSize:Number(process.env.AM_PRECISION_BATCH??2),firstTranslationMs:state.firstTranslationMs,done:state.done,failed:state.failed,originalProtectedNodes:originals.length,verifiedParagraphs:2,requests:report.map(x=>({think:x.request.think,nativeFormat:!!x.request.format,reason:x.response.done_reason,durationMs:x.durationMs}))},null,2));
  await article.screenshot({path:'artifacts/precision-debug/lean-precise-fixed.png'});
  await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'page-command',tabId,command:'restore'}),tabId);
  await expect(article.locator('[data-am-translation]')).toHaveCount(0);expect(await article.locator('pre,span.math,math').evaluateAll(ns=>ns.map(n=>n.outerHTML))).toEqual(originals);
 }finally{await context.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
