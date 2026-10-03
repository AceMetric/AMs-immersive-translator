import type {Profile,QualityMode} from './types';
// A conservative estimate, not a tokenizer for every custom model.
export const estimateTokens=(text:string)=>Math.ceil(new TextEncoder().encode(text).length/2);
export const contextLimit=(p:Profile)=>p.contextTokens??8192;
export const outputBudget=(p:Profile)=>Math.min(4096,Math.floor(contextLimit(p)/2));
export const fitsContext=(p:Profile,system:string,user:string,maxOutputTokens=outputBudget(p))=>!p.local||estimateTokens(system+'\n'+user)+Math.min(outputBudget(p),maxOutputTokens)+128<=contextLimit(p);
export function analysisSample(p:Profile,text:string){
 if(!p.local)return text.slice(0,18000);
 const chars=Math.max(512,(contextLimit(p)-outputBudget(p)-800)*2);
 let sample=text.slice(0,Math.min(18000,chars));while(estimateTokens(sample)>chars/2&&sample.length>256)sample=sample.slice(0,Math.floor(sample.length*.8));return sample;
}

export function generationBudget(p:Profile,text:string,quality:QualityMode='fast'){return quality==='precise'&&p.preciseThinking===true?outputBudget(p):Math.min(outputBudget(p),Math.max(256,estimateTokens(text)*2+160));}
