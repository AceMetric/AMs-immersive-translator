import type { Profile, Settings, QualityMode } from './types';
import {assertFreeProfile} from './free-services';
export const presets: Record<string, Profile> = {
  openai: { id:'openai', name:'兼容 API', kind:'openai', baseUrl:'https://api.openai.com/v1', model:'', apiKey:'', headers:{}, local:false, concurrency:3, timeoutMs:60_000 },
  claude: { id:'claude', name:'Claude', kind:'claude', baseUrl:'https://api.anthropic.com/v1', model:'', apiKey:'', headers:{}, local:false, concurrency:3, timeoutMs:60_000 },
  gemini: { id:'gemini', name:'Gemini', kind:'gemini', baseUrl:'https://generativelanguage.googleapis.com/v1beta', model:'', apiKey:'', headers:{}, local:false, concurrency:3, timeoutMs:60_000 },
  ollama: { id:'ollama', name:'Ollama 本地', kind:'ollama', baseUrl:'http://localhost:11434', model:'', apiKey:'', headers:{}, contextTokens:8192, local:true, concurrency:1, timeoutMs:180_000 },
  lmstudio: { id:'lmstudio', name:'LM Studio 本地', kind:'openai', baseUrl:'http://localhost:1234/v1', model:'', apiKey:'', headers:{}, contextTokens:8192, local:true, concurrency:1, timeoutMs:180_000 },
  glm:{id:'glm',name:'智谱 · 免费',kind:'openai',baseUrl:'https://open.bigmodel.cn/api/paas/v4',model:'glm-4.7-flash',apiKey:'',headers:{},local:false,concurrency:1,timeoutMs:60000,preset:'glm',freeOnly:true,thinkingControl:'thinking-type',capabilities:{structured:'json',streaming:true},limits:{rpm:20}},
  siliconflow:{id:'siliconflow',name:'硅基流动 · 免费',kind:'openai',baseUrl:'https://api.siliconflow.cn/v1',model:'XingChenAGI/Xing4.0-29B',apiKey:'',headers:{},local:false,concurrency:1,timeoutMs:60000,preset:'siliconflow',freeOnly:true,capabilities:{structured:'prompt',streaming:true},limits:{rpm:20}},
  openrouter:{id:'openrouter',name:'OpenRouter · 免费',kind:'openai',baseUrl:'https://openrouter.ai/api/v1',model:'',apiKey:'',headers:{},local:false,concurrency:1,timeoutMs:60000,preset:'openrouter',freeOnly:true,capabilities:{structured:'prompt',streaming:true},limits:{rpm:20,rpd:50}},
};
export const defaults: Settings = { profiles:[presets.openai!], activeProfile:'openai', mode:'academic', qualityMode:'fast', domain:'auto', translateNavigation:false, theme:'system', autoSites:[], batchSize:6, maxBatchChars:6000, cacheLimit:5000 };
export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings as Partial<Settings>);
}
export function normalizeSettings(value?:Partial<Settings>):Settings{const s={...defaults,...value};return {...s,qualityProfiles:value?.qualityProfiles??{fast:s.activeProfile,precise:s.activeProfile},diagnostics:value?.diagnostics===true,diagnosticTexts:value?.diagnosticTexts===true,glossaryGraph:value?.glossaryGraph===true};}
export async function saveSettings(settings: Settings) { await chrome.storage.local.set({ settings }); }
export function activeProfile(settings: Settings,quality:QualityMode=settings.qualityMode): Profile { const id=settings.qualityProfiles?.[quality]??settings.activeProfile;return settings.profiles.find(p => p.id === id) ?? settings.profiles.find(p=>p.id===settings.activeProfile)??settings.profiles[0] ?? presets.openai!; }
export function validateProfile(p: Profile) {
  const url = new URL(p.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入有效的 HTTP/HTTPS 地址，认证信息请填写在密钥或请求头中。');
  if (!p.model.trim()) throw new Error('请填写模型名称。');
  if (!Number.isInteger(p.concurrency) || p.concurrency < 1 || p.concurrency > 10) throw new Error('并发数应在 1–10 之间。');
  if(p.contextTokens!==undefined&&(!Number.isInteger(p.contextTokens)||p.contextTokens<2048||p.contextTokens>262144))throw new Error('本地上下文上限应在 2048–262144 tokens 之间。');
  if (p.timeoutMs < 1000 || p.timeoutMs > 600_000) throw new Error('超时应在 1–600 秒之间。');
  for(const limit of Object.values(p.limits??{}))if(limit!==undefined&&(!Number.isInteger(limit)||limit<1))throw new Error('额度限制必须为正整数，留空表示未设置。');
  if(p.freeOnly&&p.preset!=='openrouter')assertFreeProfile(p,Date.UTC(2026,9,3));
}
export function safeExport(settings: Settings) { return { ...settings, profiles:settings.profiles.map(p => ({ ...p, apiKey:'', headers:{} })) }; }
