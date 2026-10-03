import {chromium,expect,test} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {defaults,presets} from '../../src/settings';
test('compare real Qwen translation modes on the reported long Lean paragraph',async()=>{
 test.skip(!process.env.AM_LIVE_SPEED,'Set AM_LIVE_SPEED=1; uses the existing local model serially.');test.setTimeout(420000);
 const qualityMode=process.env.AM_SPEED_QUALITY==='precise'?'precise':'fast',reportDir=qualityMode==='precise'?'artifacts/precision-speed-debug':'artifacts/order-speed-debug';
 const reports:any[]=process.env.AM_REUSE_BASELINE?JSON.parse(readFileSync(`${reportDir}/live-comparison.json`,'utf8')).filter((x:any)=>x.version==='baseline'):[];mkdirSync(reportDir,{recursive:true});
 const tags=await fetch('http://localhost:11434/api/tags').then(r=>r.json()) as any;const model=tags.models[0].name;
 const versions=process.env.AM_BASELINE_BUILD?['baseline','fixed']:['fixed'];
 for(const version of versions){
  const requests:any[]=[];
  const server=createServer(async(req,res)=>{
   if(req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync('artifacts/snapshots/lean-basics.html'));return;}
   let raw='';for await(const c of req)raw+=c;const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});const start=Date.now();
   try{const response=await fetch('http://localhost:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:raw,signal:controller.signal});const data=await response.json(),body=JSON.parse(raw);requests.push({request:body,response:data,durationMs:Date.now()-start});console.log(JSON.stringify({version,ms:Date.now()-start,promptTokens:data.prompt_eval_count,outputTokens:data.eval_count,reason:data.done_reason,think:body.think}));res.writeHead(response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}catch{if(!res.destroyed){res.writeHead(502);res.end('{}');}}
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
  const build=mkdtempSync(resolve(tmpdir(),'am-speed-build-'));cpSync(resolve(version==='baseline'?process.env.AM_BASELINE_BUILD!:'.output/chrome-mv3'),build,{recursive:true});const manifest=JSON.parse(readFileSync(resolve(build,'manifest.json'),'utf8'));expect(manifest.host_permissions).toBeUndefined();manifest.host_permissions=['http://127.0.0.1/*'];writeFileSync(resolve(build,'manifest.json'),JSON.stringify(manifest));
  const context=await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(),'am-speed-profile-')),{channel:'chromium',headless:true,viewport:{width:1400,height:950},args:[`--disable-extensions-except=${build}`,`--load-extension=${build}`]});
  try{
   const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
   const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
   await options.evaluate(async(settings)=>chrome.storage.local.set({settings}),{...defaults,mode:'academic',qualityMode,domain:'math',batchSize:6,maxBatchChars:6000,profiles:[{...presets.ollama!,id:'speed-live',model,baseUrl:`http://127.0.0.1:${port}`,contextTokens:8192,timeoutMs:180000,concurrency:1}],activeProfile:'speed-live'});
   const article=await context.newPage(),url=`http://127.0.0.1:${port}/lean`;await article.route('**/*',r=>r.request().url()===url?r.continue():r.abort());await article.goto(url,{waitUntil:'domcontentloaded'});
   for(const name of ['theme','pygments','custom'])await article.addStyleTag({content:readFileSync(`artifacts/snapshots/lean-assets/${name}.css`,'utf8')});
   const paragraph=article.locator('p').filter({hasText:'It is an interesting fact that'}).first();await paragraph.evaluate(n=>window.scrollTo(0,n.getBoundingClientRect().top+window.scrollY-10));
   const originals=await article.locator('pre,span.math,math').evaluateAll(ns=>ns.map(n=>n.outerHTML));
   const tabId=await options.evaluate(async(url)=>(await chrome.tabs.query({})).find(t=>t.url===url)!.id!,url);
   const start=Date.now();await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'start',tabId}),tabId);
   await expect(paragraph.locator('.am-translation:not([data-error])')).toContainText(/[\u4e00-\u9fff]/,{timeout:180000});
   const elapsedMs=Date.now()-start,metrics=await paragraph.locator('.am-translation').evaluate(n=>({text:n.textContent,whiteSpace:getComputedStyle(n).whiteSpace,height:n.getBoundingClientRect().height,code:n.querySelectorAll('code').length,links:n.querySelectorAll('a').length}));
   expect(await article.locator('pre,span.math,math').evaluateAll(ns=>ns.filter(n=>!n.closest('[data-am-translation]')).map(n=>n.outerHTML))).toEqual(originals);
   if(version==='fixed'){if(qualityMode==='precise')expect(requests[0].request.think).toBe(false);expect(metrics.whiteSpace).toBe('normal');expect(metrics.text).not.toMatch(/\p{Script=Han} +\p{Script=Han}/u);}
   await article.screenshot({path:`${reportDir}/${version}-lean-${qualityMode}.png`});
   await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'page-command',tabId,command:'restore'}),tabId);
   await expect(article.locator('[data-am-translation]')).toHaveCount(0);expect(await article.locator('pre,span.math,math').evaluateAll(ns=>ns.map(n=>n.outerHTML))).toEqual(originals);
   reports.push({version,model,mode:'academic',qualityMode,contextTokens:8192,elapsedMs,metrics,originalProtectedNodes:originals.length,requests});writeFileSync(`${reportDir}/live-comparison.json`,JSON.stringify(reports,null,2));
  }finally{await context.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 }
});
