import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync, mkdtempSync, cpSync,writeFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaults,presets } from '../../src/settings';
let context:BrowserContext,options:Page,article:Page,id:string,server:Server,port:number;
let mode='normal',calls=0,delay=80;const requests:any[]=[];
test.beforeAll(async()=>{
 server=createServer(async(req,res)=>{
  if(req.method==='GET'){if(req.url==='/api/tags'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[{name:'mock-discovered'}]}));return;}res.setHeader('Content-Type','text/html; charset=utf-8');const fixture=req.url?.startsWith('/snapshot/')?`artifacts/snapshots/${req.url.split('/').at(-1)}.html`:'tests/fixtures/article.html';res.end(existsSync(fixture)?readFileSync(fixture):readFileSync('tests/fixtures/article.html'));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);calls++;const wait=mode==='revision-slow'&&raw.includes('Review and edit')?2500:mode==='out-of-order'?(raw.includes('Slow leading')?700:40):delay;await new Promise(r=>setTimeout(r,wait));
  if(mode==='mlx-compat'&&body.format){res.writeHead(501,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'structured output is unavailable'}));return;}
  if(mode==='mlx-compat'&&body.think===true){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:{content:'',thinking:'output budget exhausted'},done_reason:'length'}));return;}
  if(mode==='auth'){res.writeHead(401);res.end('{}');return;}
  const system=body.messages?.[0]?.role==='system'?body.messages[0].content:body.system??body.systemInstruction?.parts?.[0]?.text;
  const text=body.messages?.at(-1)?.content??body.contents?.[0]?.parts?.[0]?.text;
  let result:string;
  if(system?.startsWith('Extract specialist'))result=JSON.stringify({summary:'数学教材',terms:mode==='terms'?[{source:'spectral gadget',target:'谱构件',sense:'测试用本篇术语',confidence:0.99}]:[]});
  else if(system?.startsWith('Review and edit')){const input=JSON.parse(text);result=mode==='polish-damage'||mode==='circuit'?'[AM999]':JSON.stringify({edits:[]});}
  else if(text==='Say 连接成功')result='连接成功';
  else {const input=JSON.parse(text);const translate=(source:string)=>mode==='isolated'&&source.startsWith('Let ')?'坏译文':source.replace(/vector space/gi,'向量空间').replace(/theorem/gi,'定理').replace(/This/g,'这段').replace(/A /g,'一个 ');result=typeof input.source==='string'?(mode==='compact-damage'?'[AM999]':translate(input.source)):JSON.stringify({translations:input.segments.map((s:any)=>({id:s.id,text:mode==='mismatch'&&input.segments.length>1?'坏译文':translate(s.text)}))});}
  res.setHeader('Content-Type','application/json');if(req.url?.endsWith('/api/chat'))res.end(JSON.stringify({message:{content:result}}));else if(req.url?.endsWith('/messages'))res.end(JSON.stringify({content:[{type:'text',text:result}]}));else if(req.url?.includes('generateContent'))res.end(JSON.stringify({candidates:[{content:{parts:[{text:result}]}}]}));else res.end(JSON.stringify({choices:[{message:{content:result}}]}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));port=(server.address() as any).port;
 const fixture=mkdtempSync(resolve(tmpdir(),'am-test-extension-'));cpSync(resolve('.output/chrome-mv3'),fixture,{recursive:true});
 const manifest=JSON.parse(readFileSync(resolve(fixture,'manifest.json'),'utf8'));
 expect(manifest.host_permissions).toBeUndefined();
 // Headless Chrome cannot accept its native optional-permission dialog. Only the
 // isolated test copy gets loopback access; the shipped extension remains optional.
 manifest.host_permissions=['http://127.0.0.1/*','http://localhost/*'];writeFileSync(resolve(fixture,'manifest.json'),JSON.stringify(manifest));
 context=await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(),'am-extension-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${fixture}`,`--load-extension=${fixture}`]});
 let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');id=new URL(worker.url()).host;
 options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 await options.evaluate(async({origin,settings})=>{await chrome.permissions.request({origins:[origin+'/*']});await chrome.storage.local.set({settings});},{origin:`http://127.0.0.1:${port}`,settings:{...defaults,mode:'general',domain:'math',profiles:[{...presets.ollama!,model:'mock',baseUrl:`http://127.0.0.1:${port}/v1`}],activeProfile:'ollama'}});
 article=await context.newPage();await article.goto(`http://127.0.0.1:${port}/article`);
});
test.afterEach(async({},info)=>{if(info.status!==info.expectedStatus){writeFileSync('artifacts/failed-requests.json',JSON.stringify(requests.slice(-20),null,2));writeFileSync('artifacts/failed-state.json',JSON.stringify(await command('get-state'),null,2));}});
test.afterAll(async()=>{await context?.close();server?.close();});
async function command(command:string,payload?:unknown){return options.evaluate(async({tabUrl,command,payload})=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===tabUrl);return chrome.runtime.sendMessage({target:'background',type:command==='start'?'start':'page-command',tabId:tab!.id,command,payload});},{tabUrl:`http://127.0.0.1:${port}/article`,command,payload});}
async function restore(){await command('restore');await expect(article.locator('[data-am-translation]')).toHaveCount(0);}
test('full extension preserves structure, caches, handles dynamic content and restores originals',async()=>{
 const originals=await article.locator('#original-code,#original-formula,#original-inline,#original-citation,#editable,#do-not-translate').evaluateAll(nodes=>nodes.map(n=>n.outerHTML));
 await command('start');await expect(article.locator('#intro-text .am-translation')).toBeVisible();await expect(article.locator('#formula .am-translation')).toContainText('域');
 expect(await article.locator('#original-code,#original-formula,#original-inline,#original-citation,#editable,#do-not-translate').evaluateAll(nodes=>nodes.map(n=>n.outerHTML))).toEqual(originals);
 await expect(article.locator('#formula .am-translation svg')).toBeVisible();await expect(article.locator('#inline .am-translation code')).toHaveText('#check 2 + 2 = 4');await expect(article.locator('#raw-math .am-translation svg')).toHaveCount(2);
 await article.evaluate(()=>document.querySelector('#dynamic')!.innerHTML='<p id="added">A vector space has a dimension.</p>');await article.locator('#added').scrollIntoViewIfNeeded();await expect(article.locator('#added .am-translation')).toBeVisible();await command('toggle-hidden');await expect(article.locator('#intro-text .am-translation')).toBeHidden();await command('toggle-hidden');
 await options.screenshot({path:'artifacts/settings-light.png',fullPage:true});const reader=await context.newPage();await reader.goto(`chrome-extension://${id}/sidepanel.html`);await reader.setViewportSize({width:360,height:900});await reader.screenshot({path:'artifacts/reader-light.png'});await reader.close();await article.screenshot({path:'artifacts/bilingual-page.png',fullPage:true});
 await restore();await article.locator('#intro-text').scrollIntoViewIfNeeded();await command('start');await expect(article.locator('#intro-text .am-translation')).toHaveAttribute('data-am-cached','true');await expect(article.locator('#formula .am-translation')).toHaveAttribute('data-am-cached','true');await restore();
});
test('malformed batches retry individually and credentials pause without damaging the page',async()=>{
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');(settings as any).profiles[0].model='mismatch-test';await chrome.storage.local.set({settings});});mode='mismatch';await command('start');await expect(article.locator('#formula .am-translation')).toContainText('域');await restore();
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');(settings as any).profiles[0].model='auth-test';await chrome.storage.local.set({settings});});mode='auth';await command('start');await expect(article.locator('[data-error]').first()).toContainText('密钥');const state=await command('get-state');expect(state.result.paused).toBe(true);await restore();mode='normal';
});
test('Claude and Gemini native adapters complete extension requests',async()=>{
 for(const kind of ['claude','gemini'] as const){await options.evaluate(async({kind,baseUrl})=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.profiles=[{...s.profiles[0],kind,model:`mock-${kind}`,baseUrl}];await chrome.storage.local.set({settings:s});},{kind,baseUrl:`http://127.0.0.1:${port}/v1`});await command('start');await expect(article.locator('#formula .am-translation')).toContainText('域');await restore();}
});
test('first translation arrives within 2 seconds with a 1-second mock request',async()=>{
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.profiles[0].model='latency-test';await chrome.storage.local.set({settings:s});});delay=1000;await command('start');await expect(article.locator('#intro-text .am-translation')).toBeVisible();const state=await command('get-state');expect(state.result.firstTranslationMs).toBeLessThan(2000);writeFileSync('artifacts/mock-latency-report.json',JSON.stringify({fixedResponseMs:1000,firstTranslationMs:state.result.firstTranslationMs},null,2));await restore();delay=80;
});
test('long request survives UI closure and service worker termination',async()=>{
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.profiles[0].model='long-test';await chrome.storage.local.set({settings:s});});delay=32_000;await article.locator('#intro-text').evaluate(n=>window.scrollTo(0,n.getBoundingClientRect().top+window.scrollY));const offset=requests.length;await command('start');await expect.poll(()=>requests.length).toBeGreaterThan(offset);const reader=await context.newPage();await reader.goto(`chrome-extension://${id}/sidepanel.html`);await reader.close();const cdp=await context.newCDPSession(options);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');await expect(article.locator('#intro-text .am-translation')).toBeVisible({timeout:45000});expect(await article.locator('#original-code').textContent()).toContain('rfl');await restore();delay=80;
});

test('speed profiles and selected domain packs prevent cross-domain term conflicts',async()=>{
 for(const qualityMode of ['fast','precise'] as const){
  await options.evaluate(async({origin,qualityMode})=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='academic';s.qualityMode=qualityMode;s.domain='physics';s.profiles=[{id:'speed',name:'测试',kind:'ollama',baseUrl:origin,model:`speed-${qualityMode}`,apiKey:'',headers:{},local:true,concurrency:1,timeoutMs:180000}];s.activeProfile='speed';await chrome.storage.local.set({settings:s});},{origin:`http://127.0.0.1:${port}`,qualityMode});
  const offset=requests.length;await command('start');await expect(article.locator('#formula .am-translation')).toContainText('场');expect(requests.slice(offset).some(r=>r.think===false)).toBe(true);
  if(qualityMode==='precise'){const body=JSON.parse(requests[offset].messages[1].content);expect(body.context.domain).toBe('physics');expect(body.context.heading).toBeTruthy();expect(body.source).toBeTruthy();}await restore();
 }
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.domain='math';s.qualityMode='fast';s.mode='general';await chrome.storage.local.set({settings:s});});
});
test('article terms are confirmed, import conflicts previewed, and only affected paragraphs change',async()=>{
 mode='terms';await article.evaluate(()=>document.querySelector('#dynamic')!.innerHTML='<p id="candidate-text">The spectral gadget defines a spectral gadget.</p>');
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='academic';s.qualityMode='precise';s.profiles[0].model='term-analysis';await chrome.storage.local.set({settings:s});});
 // Include the newly loaded paragraph in the initial analyzed reading window.
 await article.locator('#candidate-text').scrollIntoViewIfNeeded();await command('start');await expect(article.locator('#candidate-text .am-translation')).toContainText('谱构件');
 const reader=await context.newPage();await reader.goto(`chrome-extension://${id}/sidepanel.html`);await expect(reader.getByRole('button',{name:'收录 spectral gadget'})).toBeVisible();await reader.getByRole('button',{name:'收录 spectral gadget'}).click();await expect(reader.getByRole('status')).toContainText('长期收录');await reader.close();
 await article.locator('#intro-text').scrollIntoViewIfNeeded();await expect(article.locator('#intro-text .am-translation')).toBeVisible();
 const originalTranslation=await article.locator('#intro-text .am-translation').evaluate(n=>{(n as HTMLElement).dataset.testIdentity='keep';return n.textContent;});
 await options.getByRole('button',{name:'术语库',exact:true}).click();await options.getByLabel('搜索术语').fill('spectral gadget');await expect(options.locator('tbody')).toContainText('已确认');
 await options.locator('input[type=file]').setInputFiles({name:'terms.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({terms:[{source:'spectral gadget',target:'谱器件',domain:'math',sense:'测试用本篇术语'}]}))});
 await expect(options.getByRole('dialog')).toContainText('1 条与现有词条冲突');await options.getByRole('checkbox',{name:'覆盖同领域、同词义的现有词条'}).check();await options.getByRole('button',{name:'确认导入'}).click();await expect(options.locator('tbody')).toContainText('谱器件');
 await expect(article.locator('#intro-text .am-translation')).toHaveAttribute('data-test-identity','keep');expect(await article.locator('#intro-text .am-translation').textContent()).toBe(originalTranslation);
 await article.locator('#candidate-text').scrollIntoViewIfNeeded();await expect(article.locator('#candidate-text .am-translation')).toContainText('谱器件');
 await options.getByRole('button',{name:'添加术语'}).click();await options.keyboard.press('Escape');await expect(options.getByRole('dialog')).toHaveCount(0);
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');(settings as any).theme='dark';await chrome.storage.local.set({settings});});await options.setViewportSize({width:760,height:900});await options.screenshot({path:'artifacts/glossary-dark.png',animations:'disabled'});writeFileSync('artifacts/dark-controls.json',JSON.stringify(await options.getByRole('button',{name:'导出 JSON'}).evaluate(n=>({background:getComputedStyle(n).backgroundColor,color:getComputedStyle(n).color,surface:getComputedStyle(document.documentElement).getPropertyValue('--surface'),html:n.outerHTML})),null,2));
 const narrow=await context.newPage();await narrow.goto(`chrome-extension://${id}/sidepanel.html`);await narrow.setViewportSize({width:300,height:1000});await expect(narrow.getByLabel('翻译档位')).toBeVisible();expect(await narrow.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(300);await narrow.screenshot({path:'artifacts/reader-dark-narrow.png',animations:'disabled'});await narrow.close();
 await restore();mode='normal';
});
test('persistent pending jobs recover when the offscreen document is recreated',async()=>{
 await article.locator('#intro-text').scrollIntoViewIfNeeded();
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='fast';s.profiles[0].model='offscreen-recovery';await chrome.storage.local.set({settings:s});});delay=1200;await command('start');
 await options.evaluate(async()=>{await chrome.offscreen.closeDocument();await chrome.runtime.sendMessage({target:'background',type:'engine',command:'refresh-terms',payload:{}});});
 await expect(article.locator('#intro-text .am-translation')).toBeVisible();await restore();delay=80;
});
test('real Qwen renders Chinese through the installed extension without changing code or math',async()=>{
 test.skip(!process.env.AM_LIVE_OLLAMA,'Set AM_LIVE_OLLAMA=1 to use a running local Qwen.');
 const tags=await fetch('http://localhost:11434/api/tags').then(r=>r.json()) as any;const model=tags.models[0].name;
 await options.evaluate(async({model})=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.theme='light';s.mode='general';s.domain='math';s.qualityMode='fast';s.batchSize=2;s.profiles=[{id:'live',name:'本地 Qwen',kind:'ollama',baseUrl:'http://localhost:11434',model,apiKey:'',headers:{},local:true,concurrency:1,timeoutMs:180000}];s.activeProfile='live';await chrome.storage.local.set({settings:s});},{model});
 await article.locator('#intro-text').scrollIntoViewIfNeeded();const originals=await article.locator('#original-code,#original-formula,#original-inline').evaluateAll(ns=>ns.map(n=>n.outerHTML));await command('start');
 await expect(article.locator('#intro-text .am-translation')).toContainText('向量空间',{timeout:60000});await expect(article.locator('#formula .am-translation')).toContainText('域',{timeout:60000});
 expect(await article.locator('#original-code,#original-formula,#original-inline').evaluateAll(ns=>ns.map(n=>n.outerHTML))).toEqual(originals);expect(await article.locator('#intro-text .am-translation').textContent()).not.toContain('⟪AM:');
 const state=await command('get-state');writeFileSync('artifacts/ollama-browser-report.json',JSON.stringify({model,firstTranslationMs:state.result.firstTranslationMs,done:state.result.done,failed:state.result.failed},null,2));await article.screenshot({path:'artifacts/qwen-bilingual-page.png'});await restore();
});
test('public Lean, arXiv HTML and Python snapshots retain original mathematical and code structures',async()=>{
 test.skip(!existsSync('artifacts/snapshots/sources.json'),'Run python3 scripts/snapshot-pages.py to download read-only local fixtures.');
 await options.evaluate(async({origin})=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='fast';s.domain='auto';s.profiles=[{id:'snapshot',name:'结构验收',kind:'ollama',baseUrl:origin,model:'snapshot',apiKey:'',headers:{},local:true,concurrency:1,timeoutMs:60000}];s.activeProfile='snapshot';await chrome.storage.local.set({settings:s});},{origin:`http://127.0.0.1:${port}`});
 const report=[];
 for(const name of ['lean','arxiv','python']){
  const page=await context.newPage();const url=`http://127.0.0.1:${port}/snapshot/${name}`;
  await page.route('**/*',route=>route.request().url()===url?route.continue():route.abort());await page.goto(url,{waitUntil:'domcontentloaded'});
  const originals=await page.locator('pre,math,span.math,.ltx_Math').evaluateAll(ns=>ns.map(n=>n.outerHTML));expect(originals.length).toBeGreaterThan(0);
  const tabId=await options.evaluate(async(url)=>(await chrome.tabs.query({})).find(t=>t.url===url)!.id!,url);
  await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'start',tabId}),tabId);
  await expect(page.locator('[data-am-translation]').first()).toBeVisible();expect(await page.locator('pre,math,span.math,.ltx_Math').evaluateAll(ns=>ns.filter(n=>!n.closest('[data-am-translation]')).map(n=>n.outerHTML))).toEqual(originals);
  report.push({name,originalProtectedNodes:originals.length,translatedBlocks:await page.locator('[data-am-translation]').count()});
  await options.evaluate(async(tabId)=>chrome.runtime.sendMessage({target:'background',type:'page-command',tabId,command:'restore'}),tabId);await expect(page.locator('[data-am-translation]')).toHaveCount(0);expect(await page.locator('pre,math,span.math,.ltx_Math').evaluateAll(ns=>ns.map(n=>n.outerHTML))).toEqual(originals);await page.close();
 }
 writeFileSync('artifacts/public-pages-report.json',JSON.stringify(report,null,2));
});
test('small local context automatically trims neighbors and splits large paragraphs safely',async()=>{
 await options.evaluate(async({origin})=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='fast';s.domain='math';s.batchSize=6;s.profiles=[{id:'budget',name:'4K 本地',kind:'ollama',baseUrl:origin,model:'budget-test',contextTokens:4096,apiKey:'',headers:{},local:true,concurrency:1,timeoutMs:60000}];s.activeProfile='budget';await chrome.storage.local.set({settings:s});},{origin:`http://127.0.0.1:${port}`});
 await article.evaluate(()=>document.querySelector('#dynamic')!.innerHTML='<p id="large-paragraph">'+('A vector space has a basis and a dimension. '.repeat(120))+'Given <code id="budget-code">x := 2</code> and <span class="math" id="budget-math">x²</span>.</p>');await article.locator('#large-paragraph').scrollIntoViewIfNeeded();const offset=requests.length;await command('start');await expect(article.locator('#large-paragraph .am-translation')).toContainText('向量空间',{timeout:15000});await expect(article.locator('#large-paragraph .am-translation code')).toHaveText('x := 2');await expect(article.locator('#budget-math')).toHaveText('x²');
 const sent=requests.slice(offset);expect(sent.length).toBeGreaterThan(1);for(const req of sent){expect(req.options.num_ctx).toBe(4096);const text=req.messages.map((m:any)=>m.content).join('\n');expect(Math.ceil(Buffer.byteLength(text)/2)+req.options.num_predict+128).toBeLessThanOrEqual(4096);}await restore();
});

test('settings UI discovers models, accepts context limits and tests the actual saved protocol',async()=>{
 await options.getByRole('button',{name:'模型与连接',exact:true}).click();await options.getByRole('button',{name:'本地模型 Ollama · LM Studio'}).click();await options.getByLabel('服务地址').fill(`http://127.0.0.1:${port}`);await options.getByRole('button',{name:'发现本地模型'}).click();await expect(options.getByLabel('模型名称',{exact:true})).toHaveValue('mock-discovered');await options.getByLabel('本地上下文上限',{exact:true}).fill('4096');await options.getByRole('button',{name:'测试连接',exact:true}).click();await expect(options.getByRole('status')).toContainText('连接成功');await options.getByRole('button',{name:'保存并使用',exact:true}).click();await expect(options.getByRole('status')).toContainText('已保存');
 const stored=await options.evaluate(async()=>(await chrome.storage.local.get('settings')).settings as any);expect(stored.profiles.find((p:any)=>p.id===stored.activeProfile).contextTokens).toBe(4096);
});

test('local MLX capability and thinking failures recover automatically without losing formatting',async()=>{
 mode='mlx-compat';await article.locator('#intro-text').scrollIntoViewIfNeeded();
 await options.evaluate(async(origin)=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='academic';s.qualityMode='precise';s.domain='math';s.profiles=[{...s.profiles[0],id:'mlx-regression',kind:'ollama',baseUrl:origin,model:'legacy-regression',preciseThinking:true,local:true,contextTokens:8192,concurrency:1}];s.activeProfile='mlx-regression';await chrome.storage.local.set({settings:s});},`http://127.0.0.1:${port}`);
 const offset=requests.length,original=await article.locator('#original-formula,#original-code').evaluateAll(ns=>ns.map(n=>n.outerHTML));
 await command('start');await expect(article.locator('#intro-text .am-translation:not([data-error])')).toContainText('向量空间');await expect(article.locator('#formula .am-translation:not([data-error])')).toContainText('域');
 const sent=requests.slice(offset);expect(sent.filter(r=>r.format==='json')).toHaveLength(1);expect(sent.some(r=>r.think===true&&!r.format)).toBe(true);expect(sent.some(r=>r.think===false&&!r.format)).toBe(true);
 expect(await article.locator('#original-formula,#original-code').evaluateAll(ns=>ns.map(n=>n.outerHTML))).toEqual(original);await restore();mode='normal';
});
test('a permanently damaged paragraph cannot discard its valid neighbours',async()=>{
 mode='isolated';await article.locator('#intro-text').scrollIntoViewIfNeeded();
 await options.evaluate(async(origin)=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='fast';s.domain='math';s.batchSize=6;s.profiles=[{...s.profiles[0],id:'isolation',kind:'ollama',baseUrl:origin,model:'isolation',local:true,contextTokens:8192,concurrency:1}];s.activeProfile='isolation';await chrome.storage.local.set({settings:s});},`http://127.0.0.1:${port}`);
 await command('start');await expect(article.locator('#formula .am-translation[data-error]')).toBeVisible();await expect(article.locator('#intro-text .am-translation:not([data-error])')).toContainText('向量空间');await expect(article.locator('#inline .am-translation:not([data-error]) code')).toHaveText('#check 2 + 2 = 4');await restore();mode='normal';
});

test('local precision defaults to direct output, retains context and switches deep thinking independently',async()=>{
 await article.locator('#intro-text').evaluate(n=>window.scrollTo(0,n.getBoundingClientRect().top+window.scrollY));
 await options.evaluate(async(origin)=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='precise';s.domain='math';s.batchSize=6;s.profiles=[{...s.profiles[0],preciseThinking:undefined,id:'compact-precision',kind:'ollama',baseUrl:origin,model:'compact-precision',local:true,contextTokens:4096,concurrency:1}];s.activeProfile='compact-precision';await chrome.storage.local.set({settings:s});},`http://127.0.0.1:${port}`);
 const originals=await article.locator('#original-code,#original-formula').evaluateAll(ns=>ns.map(n=>n.outerHTML));const offset=requests.length;
 await command('start');await expect(article.locator('#intro-text .am-translation')).toContainText('向量空间');const sent=requests.slice(offset);expect(sent[0].think).toBe(false);const body=JSON.parse(sent[0].messages[1].content);expect(body.source).toBeTruthy();expect(body.context.domain).toBe('math');expect(body.context.after).toBeTruthy();expect(sent[0].options.num_ctx).toBe(4096);expect(body.segments).toBeUndefined();expect(body.lockedTerms).toContain('向量空间');
 const reader=await context.newPage();await reader.goto(`chrome-extension://${id}/sidepanel.html`);await reader.setViewportSize({width:300,height:1000});await expect(reader.getByLabel('精准档深度思考')).not.toBeChecked();expect(await reader.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(300);
 const deepOffset=requests.length;await reader.getByLabel('精准档深度思考').check();await expect.poll(()=>requests.slice(deepOffset).some(r=>r.think===true)).toBe(true);await expect(article.locator('#intro-text .am-translation')).toHaveAttribute('data-am-cached','false');
 await reader.getByLabel('精准档深度思考').uncheck();await expect(article.locator('#intro-text .am-translation')).toHaveAttribute('data-am-cached','true');expect(await article.locator('#original-code,#original-formula').evaluateAll(ns=>ns.map(n=>n.outerHTML))).toEqual(originals);await reader.close();await restore();
 mode='compact-damage';await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');(settings as any).profiles[0].model='compact-recovery';await chrome.storage.local.set({settings});});await article.locator('#intro-text').scrollIntoViewIfNeeded();const recoveryOffset=requests.length;await command('start');await expect(article.locator('#intro-text .am-translation:not([data-error])')).toContainText('向量空间');const recovered=requests.slice(recoveryOffset);expect(recovered.some(r=>JSON.parse(r.messages[1].content).segments)).toBe(true);expect(recovered.every(r=>r.think===false)).toBe(true);await restore();mode='normal';
});

test('optional revision receives source and draft, respects cache variants and rejects damaged edits',async()=>{
 await article.locator('#intro-text').evaluate(n=>window.scrollTo(0,n.getBoundingClientRect().top+window.scrollY));
 await options.evaluate(async(origin)=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='precise';s.domain='math';s.profiles=[{...s.profiles[0],id:'revision',baseUrl:origin,model:'revision-test',local:true,preciseThinking:false,precisionPolish:false,contextTokens:8192,concurrency:1}];s.activeProfile='revision';await chrome.storage.local.set({settings:s});},`http://127.0.0.1:${port}`);
 await command('start');await expect(article.locator('#intro-text .am-translation')).toContainText('向量空间');const original=await article.locator('#intro-text .am-translation').textContent();const reader=await context.newPage();await reader.goto(`chrome-extension://${id}/sidepanel.html`);await expect(reader.getByLabel('精准档译后校润')).not.toBeChecked();
 let offset=requests.length;await reader.getByLabel('精准档译后校润').check();await expect.poll(()=>requests.slice(offset).some(r=>r.messages[0].content.startsWith('Review and edit'))).toBe(true);await expect(article.locator('#intro-text .am-translation')).toHaveAttribute('data-am-stage','refined');expect(requests.slice(offset).some(r=>r.messages[0].content.startsWith('Translate')&&JSON.parse(r.messages[1].content).source?.startsWith('This '))).toBe(false);const edit=requests.slice(offset).find(r=>r.messages[0].content.startsWith('Review and edit')),body=JSON.parse(edit.messages[1].content);expect(body.source).toContain('A ');expect(body.draft.some((piece:any)=>piece.text.includes('一个 '))).toBe(true);expect(edit.think).toBe(false);expect(body.draft.some((piece:any)=>piece.kind==='T'&&piece.text==='定理')).toBe(true);
 await reader.getByLabel('精准档译后校润').uncheck();await expect(article.locator('#intro-text .am-translation')).toHaveAttribute('data-am-cached','true');await restore();await reader.close();
 mode='polish-damage';await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.profiles[0].model='revision-damage';s.profiles[0].precisionPolish=true;await chrome.storage.local.set({settings:s});});await article.locator('#intro-text').evaluate(n=>window.scrollTo(0,n.getBoundingClientRect().top+window.scrollY));offset=requests.length;await command('start');await expect(article.locator('#intro-text .am-translation:not([data-error])')).toContainText('向量空间');await expect.poll(()=>requests.slice(offset).some(r=>r.messages[0].content.startsWith('Review and edit'))).toBe(true);await restore();mode='normal';
});

test('a tall reading paragraph precedes short neighbours and scrolling replaces pending priorities',async()=>{
 await options.evaluate(async(origin)=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='fast';s.batchSize=6;s.profiles=[{...s.profiles[0],id:'order',kind:'ollama',baseUrl:origin,model:'reading-order',local:true,contextTokens:8192,concurrency:1}];s.activeProfile='order';await chrome.storage.local.set({settings:s});},`http://127.0.0.1:${port}`);
 await article.evaluate(()=>{document.querySelector('main')!.innerHTML='<p id="reading-long" style="height:1400px">Reading anchor: a lengthy explanation with <code>x  := 2</code>.</p><p id="reading-short">Nearby short description.</p><div style="height:1800px"></div><p id="reading-distant">Distant reading destination.</p>';window.scrollTo(0,1200);});
 delay=700;const offset=requests.length;await command('start');await expect.poll(()=>requests.length).toBeGreaterThan(offset);
 const first=JSON.parse(requests[offset].messages.at(-1).content);expect(first.source).toContain('Reading anchor');
 const pending=await options.evaluate(()=>new Promise<number>((resolve,reject)=>{const r=indexedDB.open('am-translator');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('jobs').objectStore('jobs').count();q.onsuccess=()=>{resolve(q.result);db.close();};};}));expect(pending).toBeLessThanOrEqual(1);
 await article.locator('#reading-distant').scrollIntoViewIfNeeded();await expect(article.locator('#reading-distant .am-translation:not([data-error])')).toBeVisible();expect(JSON.parse(requests[offset+1].messages.at(-1).content).source).toContain('Distant reading destination');expect(await article.locator('#reading-short .am-translation').count()).toBe(0);
 await restore();delay=80;
});

test('cloud completions arriving out of order still display in reading order',async()=>{
 mode='out-of-order';await options.evaluate(async(origin)=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='fast';s.batchSize=1;s.profiles=[{...s.profiles[0],id:'cloud-order',kind:'openai',baseUrl:origin+'/v1',model:'cloud-order',local:false,concurrency:3}];s.activeProfile='cloud-order';await chrome.storage.local.set({settings:s});},`http://127.0.0.1:${port}`);
 await article.evaluate(()=>{document.querySelector('main')!.innerHTML='<p id="cloud-first">Slow leading explanation.</p><p id="cloud-second">Fast following explanation.</p><p id="cloud-third">Fast final explanation.</p>';window.scrollTo(0,0);(window as any).deliveryLog=[];new MutationObserver(records=>{for(const record of records)for(const n of record.addedNodes)if(n instanceof HTMLElement&&n.hasAttribute('data-am-translation'))(window as any).deliveryLog.push(n.parentElement!.id);}).observe(document.querySelector('main')!,{subtree:true,childList:true});});
 await command('start');await expect(article.locator('#cloud-third .am-translation')).toBeVisible();expect(await article.evaluate(()=>(window as any).deliveryLog)).toEqual(['cloud-first','cloud-second','cloud-third']);await restore();mode='normal';
});
test('an in-flight response cannot translate a paragraph after its source changed',async()=>{
 await options.evaluate(async(origin)=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.mode='general';s.qualityMode='fast';s.profiles=[{...s.profiles[0],id:'source-change',kind:'ollama',baseUrl:origin,model:'source-change',local:true,concurrency:1}];s.activeProfile='source-change';await chrome.storage.local.set({settings:s});},`http://127.0.0.1:${port}`);
 await article.evaluate(()=>{document.querySelector('main')!.innerHTML='<p id="changing-source">Original reading paragraph.</p>';window.scrollTo(0,0);});delay=700;const offset=requests.length;await command('start');await expect.poll(()=>requests.length).toBeGreaterThan(offset);await article.locator('#changing-source').evaluate(n=>n.textContent='Changed reading paragraph.');await expect(article.locator('#changing-source .am-translation')).toContainText('Changed reading');expect(await article.locator('#changing-source .am-translation').textContent()).not.toContain('Original');await restore();delay=80;
});

async function nextFixture(model:string,polish=false,limits?:{rpd:number}){
 await restore();await options.evaluate(async({origin,model,polish,limits})=>{
  const {settings}=await chrome.storage.local.get('settings');const s=settings as any;
  s.mode='general';s.qualityMode='precise';s.domain='math';s.diagnostics=true;s.diagnosticTexts=false;
  s.profiles=[{...presetsForBrowser(),id:'next',model,baseUrl:origin,precisionPolish:polish,limits}];s.activeProfile='next';s.qualityProfiles={fast:'next',precise:'next'};
  function presetsForBrowser(){return {name:'模拟本地',kind:'ollama',apiKey:'',headers:{},local:true,concurrency:1,contextTokens:8192,timeoutMs:180000};}
  await chrome.storage.local.set({settings:s});
 },{origin:`http://127.0.0.1:${port}`,model,polish,limits});
 await article.evaluate(()=>{document.querySelector('main')!.innerHTML='<p id="next-a">First explanation of a vector space with <code>x := 2</code> and <strong>important conditions</strong>.</p><p id="next-b">Second explanation of the theorem and its conditions.</p><p id="next-c">Third explanation of the same theorem.</p>';window.scrollTo(0,0);});
}
test('background revision never blocks the first reading region and caches its own stage',async()=>{
 mode='revision-slow';delay=1000;await nextFixture('next-background',true);
 const original=await article.locator('#next-a code').evaluate(n=>n.outerHTML);const offset=requests.length;
 await command('start');await expect(article.locator('#next-a .am-translation')).toHaveAttribute('data-am-stage',/draft|queued|running/);
 expect((await command('get-state')).result.firstTranslationMs).toBeLessThan(2000);
 await expect(article.locator('#next-c .am-translation')).toBeVisible();
 const sent=requests.slice(offset);expect(sent.slice(0,3).every(r=>!r.messages[0].content.startsWith('Review'))).toBe(true);
 await expect(article.locator('#next-a .am-translation')).toHaveAttribute('data-am-stage','refined',{timeout:15000});
 expect(await article.locator('#next-a > code').evaluate(n=>n.outerHTML)).toBe(original);
 await restore();delay=80;mode='normal';await command('start');await expect(article.locator('#next-a .am-translation')).toHaveAttribute('data-am-cached','true');await expect(article.locator('#next-a .am-translation')).toHaveAttribute('data-am-stage','refined');await restore();
});
test('two broken edits stop automatic revision once and manual revision remains available',async()=>{
 mode='circuit';await nextFixture('next-circuit',true);const offset=requests.length;await command('start');
 await expect(article.locator('#next-c .am-translation')).toBeVisible();
 await expect(article.locator('#next-b .am-refine-tools')).toContainText('自动校润暂停');
 const edits=()=>requests.slice(offset).filter(r=>r.messages[0].content.startsWith('Review'));expect(edits()).toHaveLength(2);
 await options.evaluate(async()=>{await chrome.offscreen.closeDocument();await chrome.runtime.sendMessage({target:'background',type:'engine',command:'refresh-terms',payload:{}});});await options.waitForTimeout(600);expect(edits()).toHaveLength(2);
 await article.locator('#next-c').getByRole('button',{name:'校润本段'}).click();await expect.poll(()=>edits().length).toBe(3);
 await expect(article.locator('#next-c .am-refine-tools')).toContainText('校润未应用');
 expect(await article.locator('[data-error]').count()).toBe(0);await restore();mode='normal';
});
test('manual edits survive offscreen recreation while a stale edit cannot replace a new model',async()=>{
 mode='normal';await nextFixture('next-manual');await command('start');await expect(article.locator('#next-c .am-translation')).toBeVisible();
 await options.evaluate(async()=>{await chrome.offscreen.closeDocument();await chrome.runtime.sendMessage({target:'background',type:'engine',command:'refresh-terms',payload:{}});});
 await article.locator('#next-a').getByRole('button',{name:'校润本段'}).click();await expect(article.locator('#next-a .am-translation')).toHaveAttribute('data-am-stage','refined');
 mode='revision-slow';await article.locator('#next-b').getByRole('button',{name:'校润本段'}).click();await expect(article.locator('#next-b .am-refine-tools')).toContainText('校润中');
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');(settings as any).profiles[0].model='next-new-model';await chrome.storage.local.set({settings});});
 await expect(article.locator('#next-b .am-translation')).toHaveAttribute('data-am-stage','draft');
 await options.waitForTimeout(2700);expect(await article.locator('#next-b .am-translation').getAttribute('data-am-stage')).toBe('draft');await restore();mode='normal';
});
test('persistent request quota pauses without rerouting and metadata diagnostics omit text',async()=>{
 await nextFixture('next-quota',false,{rpd:1});
 // Use a distinct loopback hostname so earlier admission history is independent.
 await options.evaluate(async({origin})=>{const {settings}=await chrome.storage.local.get('settings');(settings as any).profiles[0].baseUrl=origin;await chrome.storage.local.set({settings});},{origin:`http://localhost:${port}`});
 const offset=requests.length;await command('start');await expect(article.locator('#next-a .am-translation')).toBeVisible();await expect(article.locator('[data-error]').first()).toBeVisible();expect((await command('get-state')).result.paused).toBe(true);expect(requests.length-offset).toBe(1);
 const logs=await options.evaluate(async()=>chrome.runtime.sendMessage({target:'background',type:'engine',command:'diagnostics',payload:{}}));expect(logs.result.length).toBeGreaterThan(0);for(const row of logs.result){expect(row).not.toHaveProperty('source');expect(row).not.toHaveProperty('response');expect(row).not.toHaveProperty('headers');}
 await options.evaluate(async()=>{await chrome.offscreen.closeDocument();await chrome.runtime.sendMessage({target:'background',type:'engine',command:'refresh-terms',payload:{}});});
 await article.locator('[data-error]').first().click();await expect(article.locator('[data-error]').first()).toBeVisible();expect(requests.length-offset).toBe(1);await restore();
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');(settings as any).profiles[0].limits=undefined;await chrome.storage.local.set({settings});});
});
test('two translation tiers dispatch only their explicitly selected model',async()=>{
 await nextFixture('next-fast');await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');const s=settings as any;s.profiles.push({...s.profiles[0],id:'precise-model',model:'next-precise'});s.qualityProfiles={fast:'next',precise:'precise-model'};s.qualityMode='fast';await chrome.storage.local.set({settings:s});});
 let offset=requests.length;await command('start');await expect(article.locator('#next-c .am-translation')).toBeVisible();expect(requests.slice(offset).every(r=>r.model==='next-fast')).toBe(true);await restore();
 await options.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');(settings as any).qualityMode='precise';await chrome.storage.local.set({settings});});offset=requests.length;await command('start');await expect(article.locator('#next-c .am-translation')).toBeVisible();expect(requests.slice(offset).every(r=>r.model==='next-precise'&&r.think===false)).toBe(true);await restore();
});

 test('a paused reading session stays paused after offscreen recreation and resumes its saved job',async()=>{
  await nextFixture('paused-restart');delay=1000;const offset=requests.length;await command('start');
  await expect.poll(()=>requests.length).toBeGreaterThan(offset);await command('pause');
  await options.evaluate(async()=>{await chrome.offscreen.closeDocument();await chrome.runtime.sendMessage({target:'background',type:'engine',command:'refresh-terms',payload:{}});});
  const count=requests.length;await options.waitForTimeout(1200);expect(requests.length).toBe(count);expect((await command('get-state')).result.paused).toBe(true);
  await command('resume');await expect(article.locator('#next-a .am-translation')).toBeVisible();await restore();delay=80;
 });
