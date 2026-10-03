import type {Profile} from './types';
export function localOriginRule(profile:Profile,extensionId:string):chrome.declarativeNetRequest.Rule|undefined {
 const url=new URL(profile.baseUrl);
 if(!profile.local||url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return;
 const base=url.origin+url.pathname.replace(/\/$/,'').replace(profile.kind==='ollama'?/\/v1$/:/$^/,'')+'/';
 let hash=0;for(const c of base)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
 return {id:1000+hash%1000000,priority:1,action:{type:'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,requestHeaders:[{header:'Origin',operation:'remove' as chrome.declarativeNetRequest.HeaderOperation}]},condition:{regexFilter:'^'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),initiatorDomains:[extensionId],resourceTypes:['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType]}};
}
export async function prepareLocalConnection(profile:Profile){
 const rule=localOriginRule(profile,chrome.runtime.id);if(!rule)return;
 if(!await chrome.permissions.contains({origins:[new URL(profile.baseUrl).origin+'/*']}))return;
 await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[rule.id],addRules:[rule]});
}
