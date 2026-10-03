export type Domain = 'auto' | 'math' | 'physics' | 'cs' | 'general';
export type Mode = 'academic' | 'general';
export type QualityMode = 'fast' | 'precise';
export type ProviderKind = 'openai' | 'claude' | 'gemini' | 'ollama';
export type Term = {
  id: string; source: string; target: string; domain: Exclude<Domain, 'auto'>; sense: string;
  aliases: string[]; sourceUrl: string; license: string;
  quality: 'core' | 'candidate' | 'user' | 'confirmed' | 'article';
  enabled: boolean; updatedAt?: number; contexts?:string[]; sourceNote?:string; definition?:string;
};
export type GlossaryPack = { name: string; version: string; author: string; license: string; terms: Term[] };
export type Profile = {
  id: string; name: string; kind: ProviderKind; baseUrl: string; model: string; apiKey: string;
  headers: Record<string, string>; contextTokens?: number; preciseThinking?: boolean; precisionPolish?: boolean; thinkingControl?: 'auto' | 'none' | 'reasoning-effort' | 'enable-thinking' | 'thinking-type'; local: boolean; concurrency: number; timeoutMs: number;
  preset?:'glm'|'siliconflow'|'openrouter'; freeOnly?:boolean;
  capabilities?:{structured:'prompt'|'json'|'schema';streaming:boolean};
  limits?:{rpm?:number;tpm?:number;rpd?:number}; translationModel?:'general'|'hy-mt';
};
export type Settings = {
  profiles: Profile[]; activeProfile: string; mode: Mode; qualityMode: QualityMode; domain: Domain;
  translateNavigation: boolean; theme: 'system' | 'light' | 'dark';
  autoSites: string[]; batchSize: number; maxBatchChars: number; cacheLimit: number;
  qualityProfiles?:{fast:string;precise:string}; diagnostics?:boolean; diagnosticTexts?:boolean; glossaryGraph?:boolean;
};
export type PageSettings=Settings&{execution?:{local:boolean;concurrency:number}};
export type Context = { title: string; abstract: string; heading: string; before: string; after: string; summary?: string; documentText?: string };
export type Segment = { id: string; text: string; sourceHash: string; order: number; context?:Context; readonly?:Record<string,string> };
export type Refinement = {source:string;draft:string;literals:Record<string,string>;termSources?:Record<string,string>;key:string;domain:Domain;summary?:string;manual?:boolean};
export type Job = {
  id: string; tabId: number; sessionId: string; epoch: number; segments: Segment[]; context: Context;
  mode: Mode; qualityMode?: QualityMode; domain: Domain; articleTerms?: Term[]; status: 'queued' | 'running' | 'done' | 'failed'; createdAt: number;
  profileId?:string; configVersion?:string; refinement?:Refinement; originJobId?:string; requestRefinement?:boolean;
};
export type Translation = { id: string; text: string; cached: boolean;stage?:'draft'|'refined';sourceHash?:string };
export type EngineEvent = {
  type: 'translated' | 'refined' | 'refinement-status' | 'quota-error' | 'failed' | 'terms' | 'auth-error' | 'progress' | 'job-complete';
  jobId?:string;
  tabId: number; sessionId: string; epoch: number;
  results?: Translation[]; ids?: string[]; error?: string; terms?: Term[]; applied?: boolean;
  refinementState?:'queued'|'running'|'failed'|'paused';code?:string;
};
export type PageState = {
  sessionId: string; enabled: boolean; paused: boolean; hidden: boolean; total: number;
  done: number; failed: number; title: string; terms: Term[]; detectedDomain?: Exclude<Domain,'auto'>; firstTranslationMs?: number;
};
