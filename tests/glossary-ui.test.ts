import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';
import { findTerms, mergeTerms, resolveStoredTerms } from '../src/glossary';
import type { Term } from '../src/types';

const { records } = vi.hoisted(()=>({records:new Map<string,Term>()}));
vi.mock('../src/db',()=>({
  getUserTerms:async()=>[...records.values()],
  putTerms:async(terms:Term[])=>{for(const term of terms)records.set(term.id,term);},
  deleteTerm:async(id:string)=>records.delete(id),
  cacheCount:async()=>0,clearCache:async()=>{},getMeta:async()=>undefined,writeMetaBatch:async()=>{},
}));
vi.mock('../src/messaging',()=>({background:async()=>({})}));
const core:Term={id:'am-ui-core',source:'vector space',target:'向量空间',domain:'math',sense:'vector space',aliases:['vector spaces'],sourceUrl:'https://example.org/core',license:'CC0-1.0',quality:'core',enabled:true};
const candidate:Term={...core,id:'wd-math-Q123',source:'candidate term',target:'候选词',sense:'candidate term',quality:'candidate'};
let root:Root|undefined;
const settle=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
async function click(button:HTMLElement){await act(async()=>{button.click();await settle();});}
async function mount(){
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>{root!.render(createElement(App,{surface:'options'}));await settle();});
  await click([...document.querySelectorAll('nav button')].find(b=>b.textContent==='术语库') as HTMLElement);
  expect(document.querySelector('tbody tr')).not.toBeNull();
}
function row(source:string){return [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(r=>r.querySelector('strong')?.textContent===source)!;}
function personalCount(){return document.querySelectorAll('.stats-grid strong')[2]?.textContent;}
async function filter(value:string){const select=document.querySelector<HTMLSelectElement>('[aria-label="词库类别"]')!;await act(async()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await settle();});}

beforeEach(()=>{
  records.clear();document.body.innerHTML='';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('chrome',{
    runtime:{getURL:(path:string)=>'https://extension.test/'+path,onMessage:{addListener:()=>{},removeListener:()=>{}}},
    storage:{local:{get:async()=>({})},onChanged:{addListener:()=>{},removeListener:()=>{}}},
    tabs:{query:async()=>[]},
  });
  vi.stubGlobal('fetch',async(input:string|URL)=>{
    const url=String(input);let value:unknown;
    if(url.endsWith('index.json'))value={version:'test',packs:[{group:'core',domain:'math',file:'core.json'},{group:'extended',domain:'math',file:'extended.json'}]};
    else value={terms:url.endsWith('extended.json')?[candidate]:[core]};
    return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  });
});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}vi.unstubAllGlobals();});

describe('glossary settings enable/disable actions',()=>{
  it('keeps a core term core after disabling, enabling and reopening settings',async()=>{
    await mount();await click(row(core.source).querySelector('[title="禁用"]') as HTMLElement);
    expect(row(core.source).classList.contains('disabled-row')).toBe(true);
    expect(row(core.source).querySelector('.quality')?.textContent).toBe('核心');
    expect(personalCount()).toBe('0');
    expect(findTerms('vector space',mergeTerms([core],[...records.values()]),'math')).toHaveLength(0);
    await click(row(core.source).querySelector('[title="启用"]') as HTMLElement);
    expect(row(core.source).querySelector('.quality')?.textContent).toBe('核心');
    expect(records.get(core.id)?.quality).toBe('core');
    expect(findTerms('vector space',mergeTerms([core],[...records.values()]),'math')[0]?.term.target).toBe('向量空间');
    await act(async()=>root!.unmount());root=undefined;await mount();
    expect(personalCount()).toBe('0');await filter('user');expect(document.querySelectorAll('tbody tr')).toHaveLength(0);
  });
  it('repairs legacy toggle classification while preserving an edited personal translation',async()=>{
    records.set(core.id,{...core,quality:'user',enabled:false});await mount();
    expect(row(core.source).querySelector('.quality')?.textContent).toBe('核心');expect(personalCount()).toBe('0');
    await click(row(core.source).querySelector('[title="启用"]') as HTMLElement);
    expect(records.get(core.id)?.quality).toBe('core');
    const edited={...core,quality:'user' as const,target:'我的译名',updatedAt:Date.now()};
    records.set(core.id,edited);await act(async()=>root!.unmount());root=undefined;await mount();
    expect(personalCount()).toBe('1');await filter('user');expect(row(core.source).textContent).toContain('我的译名');
    await click(row(core.source).querySelector('[title="禁用"]') as HTMLElement);
    await click(row(core.source).querySelector('[title="启用"]') as HTMLElement);
    expect(records.get(core.id)?.quality).toBe('user');expect(records.get(core.id)?.target).toBe('我的译名');
  });
  it('keeps candidate toggles out of personal terms and mandatory translation',async()=>{
    await mount();await filter('candidate');
    await click(row(candidate.source).querySelector('[title="禁用"]') as HTMLElement);
    expect(row(candidate.source).classList.contains('disabled-row')).toBe(true);expect(personalCount()).toBe('0');
    await click(row(candidate.source).querySelector('[title="启用"]') as HTMLElement);
    expect(row(candidate.source).querySelector('.quality')?.textContent).toBe('候选');
    expect(findTerms('candidate term',[...records.values()],'math')).toHaveLength(0);
    await filter('user');expect(document.querySelectorAll('tbody tr')).toHaveLength(0);
  });
  it('refreshes built-in metadata while retaining its preference and never downgrades confirmed terms',()=>{
    const updated={...core,definition:'Current definition',target:'新版译名'};
    const saved={...core,enabled:false};expect(resolveStoredTerms([updated],[saved])).toEqual([{...updated,enabled:false}]);
    expect(resolveStoredTerms([updated],[{...saved,quality:'user'}])).toEqual([{...updated,enabled:false}]);
    const confirmed={...core,quality:'confirmed' as const,updatedAt:1};expect(resolveStoredTerms([core],[confirmed])).toEqual([confirmed]);
  });
  it('does not reintroduce screened-out candidates through current or legacy toggles',()=>{
    const legacy={...candidate,quality:'user' as const};
    const edited={...legacy,target:'我的明确译名',updatedAt:1};
    expect(resolveStoredTerms([core],[candidate,legacy,edited])).toEqual([edited]);
    expect(resolveStoredTerms([core,candidate],[{...candidate,enabled:false}])).toEqual([{...candidate,enabled:false}]);
  });
  it('keeps removed core preferences dormant until rollback without removing personal edits',()=>{
    const disabled={...core,enabled:false},legacy={...core,quality:'user' as const};
    const edited={...legacy,target:'我的明确译名',updatedAt:1};
    expect(resolveStoredTerms([],[disabled,legacy,edited])).toEqual([edited]);
    expect(resolveStoredTerms([core],[disabled])).toEqual([{...core,enabled:false}]);
    expect(resolveStoredTerms([],[{...core,quality:'confirmed' as const}])).toEqual([{...core,quality:'confirmed'}]);
  });

});
