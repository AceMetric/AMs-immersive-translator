import { activeProfile, getSettings, normalizeSettings, validateProfile } from '../src/settings';
import { prepareLocalConnection } from '../src/local-network';
import { pendingJobs } from '../src/db';
export default defineBackground(()=>{
  void chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  let initializing:Promise<void>|undefined;
  async function ensureEngine(){
    if(initializing)return initializing;
    const contexts=await chrome.runtime.getContexts({contextTypes:[chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
    if(contexts.length)return;
    if(initializing)return initializing;
    initializing=(async()=>{
      await chrome.offscreen.createDocument({url:'offscreen.html',reasons:[chrome.offscreen.Reason.WORKERS],justification:'在独立 Worker 中执行长时间模型请求、术语索引和可恢复翻译任务。'});
      const liveSessions:Record<number,string>={};
      for(const tabId of new Set((await pendingJobs()).map(j=>j.tabId))){try{const state=await chrome.tabs.sendMessage(tabId,{type:'get-state'});if(state?.sessionId)liveSessions[tabId]=state.sessionId;}catch{}}
      const response=await chrome.runtime.sendMessage({target:'offscreen',type:'init',payload:{settings:await getSettings(),liveSessions,glossaryIndexUrl:chrome.runtime.getURL('glossaries/index.json')}});
      if(response?.error)throw new Error(response.error);
    })().finally(()=>{initializing=undefined;});return initializing;
  }
  async function engine(type:string,payload:any){
    // A recreated document can close a short command's reply channel. Re-send
    // only idempotent controls; enqueue carries its stable job ID for deduplication.
    const recoverable=new Set(['init','configure','enqueue','background-ready','pause','resume','cancel','refine','refresh-terms','article-terms','diagnostics']);
    for(let attempt=0;;attempt++){
      try{await ensureEngine();const response=await chrome.runtime.sendMessage({target:'offscreen',type,payload});if(response?.error)throw new Error(response.error);return response?.result;}
      catch(error){if(attempt||!recoverable.has(type)||!/(?:message (?:channel|port) closed|receiving end does not exist|could not establish connection)/i.test((error as Error).message))throw error;await new Promise(r=>setTimeout(r,50));}
    }
  }
  async function inject(tabId:number){
    const tab=await chrome.tabs.get(tabId);if(!/^https?:/.test(tab.url??''))throw new Error('请打开英文 HTML 网页后开始翻译。浏览器内部页面和 PDF 暂不支持。');
    try {await chrome.tabs.sendMessage(tabId,{type:'get-state'});}catch{await chrome.scripting.executeScript({target:{tabId},files:['content-scripts/content.js']});}
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message.target!=='background')return;
    (async()=>{
      if(message.type==='engine-event'){const e=message.event;try{await chrome.tabs.sendMessage(e.tabId,{type:'engine-event',event:e});}catch{await engine('cancel',{sessionId:e.sessionId});}void chrome.runtime.sendMessage({target:'ui',type:'page-update',tabId:e.tabId}).catch(()=>{});return true;}
      if(message.type==='engine'){
        if(sender.tab&&!sender.url?.startsWith(chrome.runtime.getURL(''))){if(message.command!=='background-ready'&&message.command!=='enqueue'&&message.command!=='cancel'&&message.command!=='pause'&&message.command!=='resume'&&message.command!=='refine')throw new Error('页面不能访问模型配置。');if(message.payload?.job)message.payload.job.tabId=sender.tab.id;if(message.command==='refine')message.payload.tabId=sender.tab.id;}
        if(message.command==='test'||message.command==='list-models')await prepareLocalConnection(message.payload.profile);
        if(message.command==='enqueue'){const settings=await getSettings();const p=activeProfile(settings,message.payload.job.qualityMode);message.payload.job.profileId=p.id;validateProfile(p);if(!await chrome.permissions.contains({origins:[new URL(p.baseUrl).origin+'/*']}))throw new Error('请在设置页授权模型接口域名。');await prepareLocalConnection(p);}
        return engine(message.command,message.payload);
      }
      if(message.type==='page-settings'){const settings=await getSettings(),p=activeProfile(settings);return {...settings,profiles:[],execution:{local:p.local,concurrency:p.local?1:p.concurrency}};}
      if(message.type==='start'){await inject(message.tabId);return chrome.tabs.sendMessage(message.tabId,{type:'start'});}
      if(message.type==='page-command'){return chrome.tabs.sendMessage(message.tabId,{type:message.command,payload:message.payload});}
      if(message.type==='get-state'){try{return await chrome.tabs.sendMessage(message.tabId,{type:'get-state'});}catch{return null;}}
      if(message.type==='open-options'){await chrome.runtime.openOptionsPage();return true;}
      throw new Error('未知操作。');
    })().then(result=>respond({result})).catch(error=>respond({error:error.message}));return true;
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings){const change=changes.settings;void (async()=>{const next=normalizeSettings(change.newValue as import('../src/types').Settings),previous=normalizeSettings(change.oldValue as import('../src/types').Settings);await engine('configure',{settings:next});const relevant=(s:typeof next)=>JSON.stringify([s.profiles,s.qualityProfiles,s.mode,s.qualityMode,s.domain,s.glossaryGraph,s.translateNavigation]);if(relevant(next)!==relevant(previous))for(const tab of await chrome.tabs.query({}))if(tab.id)void chrome.tabs.sendMessage(tab.id,{type:'settings-changed'}).catch(()=>{});})().catch(()=>{});}});
  chrome.runtime.onInstalled.addListener(()=>{
    chrome.contextMenus.create({id:'am-translate',title:'使用 AM 学术翻译阅读',contexts:['page']});
  });
  chrome.contextMenus.onClicked.addListener((_info,tab)=>{if(tab?.id){void chrome.sidePanel.open({tabId:tab.id});void inject(tab.id).then(()=>chrome.tabs.sendMessage(tab.id!,{type:'start'}));}});
  chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(change.status!=='complete'||!tab.url)return;void (async()=>{const settings=await getSettings();if(settings.autoSites.includes(new URL(tab.url!).hostname)&&await chrome.permissions.contains({origins:[new URL(tab.url!).origin+'/*']})){await inject(tabId);await chrome.tabs.sendMessage(tabId,{type:'start'});}})().catch(()=>{});});
});
