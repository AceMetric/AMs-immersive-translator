import { describe,expect,it,vi } from 'vitest';
import { collectBlocks,renderTranslation,serialize } from '../src/dom';
import { exportTerms,findTerms,inferDomain,lockTerms,mergeTerms,parseImport,termKey } from '../src/glossary';
import { canonicalize,cleanContext,parseModelJSON,splitProtectedText,parseTranslations,validateTokens } from '../src/protocol';
import { buildRequest,callModel,ModelOutputError,ProviderError,thinkingOptions,readResponse,withRetry } from '../src/providers';
import {fastRequest,preciseRequest,polishRequest,polishTranslation,translateRequest} from '../src/translation-call';
import {readingWindow} from '../src/reading-queue';
import {normalizeProse} from '../src/prose';
import {localOriginRule} from '../src/local-network';
import {analysisSample,estimateTokens,fitsContext} from '../src/budget';
import { presets,safeExport,defaults } from '../src/settings';
import type { Term } from '../src/types';
const term=(source:string,target:string,domain:Term['domain']='math',quality:Term['quality']='core'):Term=>({id:crypto.randomUUID(),source,target,domain,sense:source,aliases:[],sourceUrl:'',license:'CC0-1.0',quality,enabled:true});
describe('terminology invariants',()=>{
  it('uses longest phrases and boundaries without matching token labels',()=>{const matches=findTerms('A vector space contains a vector, not vectorized. ⟪AM:P:vector⟫',[term('vector','向量'),term('vector space','向量空间')],'math');expect(matches.map(m=>m.term.target)).toEqual(['向量空间','向量']);});
  it('resolves a homograph in its domain',()=>{const terms=[term('field','域'),term('field','场','physics'),term('field','字段','cs')];expect(lockTerms('field',terms,'physics','s').literals).toEqual({'⟪AM:T:s:0⟫':'场'});expect(findTerms('field',terms,'cs')[0]?.term.target).toBe('字段');});
  it('honors user overrides and disabled builtins',()=>{const core=term('field','域'),user={...core,target:'数域',quality:'user' as const};expect(mergeTerms([core],[user])[0]?.target).toBe('数域');expect(findTerms('field',mergeTerms([core],[{...user,enabled:false}]),'math')).toEqual([]);});
  it('matches uppercase aliases case sensitively',()=>{const t={...term('support vector machine','支持向量机','cs'),aliases:['SVM']};expect(findTerms('SVM svm', [t],'cs')).toHaveLength(1);});
  it('infers academic domains from context',()=>{expect(inferDomain('quantum Hamiltonian energy particle')).toBe('physics');expect(inferDomain('Lean Mathlib theorem proof')).toBe('math');});
  it('uses sense context and leaves unresolved competing senses unlocked',()=>{const optical={...term('polarization','偏振','physics'),contexts:['light','optical']};const electric={...term('polarization','极化','physics'),contexts:['electric','dielectric']};expect(findTerms('polarization',[optical,electric],'physics',false,'optical light')[0]?.term.target).toBe('偏振');expect(findTerms('polarization',[optical,electric],'physics')).toHaveLength(0);});
  it.each(['json','csv','tsv'] as const)('round-trips %s with quotes and newlines',format=>{const t=term('test "quoted", phrase','译名\n第二行');const rows=parseImport(exportTerms([t],format),format);expect(rows[0]?.source).toBe(t.source);expect(rows[0]?.target).toBe(t.target);expect(termKey(rows[0]!)).toBe(termKey(t));});
  it('rejects malformed import and duplicate senses',()=>{expect(()=>parseImport('source,target\n"a,b','csv')).toThrow();expect(()=>parseImport(JSON.stringify([term('field','域'),term('field','数域')]),'json')).toThrow('重复');});
});
describe('safe bilingual DOM',()=>{
  it('preserves code, formula, link and emphasis without altering originals',()=>{document.body.innerHTML='<main><p id="p">A <strong>vector</strong> <a href="/doc">space</a> has <code>x := 2</code> and <math><mi>x</mi></math>.</p><pre id="code">def f := 1</pre></main>';const original=document.getElementById('p')!;const code=document.getElementById('code')!.outerHTML;const html=original.outerHTML;const b=serialize(original as HTMLElement,'s',0);const output=renderTranslation(b,b.text.replace('A ','一个 '));expect(output.querySelector('code')?.textContent).toBe('x := 2');expect(output.querySelector('math mi')?.textContent).toBe('x');expect(output.querySelector('a')?.getAttribute('href')).toBe('/doc');expect(output.querySelector('strong')?.textContent).toBe('vector');expect(original.outerHTML).toBe(html);expect(document.getElementById('code')!.outerHTML).toBe(code);});
  it('extracts mixed list content once',()=>{document.body.innerHTML='<main><ul><li>Parent explanation<ul><li><p>Nested explanation</p></li></ul></li></ul></main>';expect(collectBlocks().map(b=>b.text)).toEqual(['Parent explanation','Nested explanation']);});
  it('excludes editable controls, Chinese and navigation',()=>{document.body.innerHTML='<main><p>Hello text</p><p lang="zh">中文 English</p><p contenteditable="true">Edit this</p><nav><p>Navigation item</p></nav><pre><p>Code text</p></pre></main>';expect(collectBlocks().map(b=>b.text)).toEqual(['Hello text']);});
  it('never treats provider HTML as markup',()=>{document.body.innerHTML='<p>Some text</p>';const b=serialize(document.querySelector('p')!,'x',0);const node=renderTranslation(b,'<img src=x onerror=alert(1)>译文');expect(node.querySelector('img')).toBeNull();expect(node.textContent).toContain('<img');});
  it('protects common notranslate math wrappers rather than dropping them',()=>{document.body.innerHTML='<p>Given <span class="math notranslate">\\(x\\)</span>, <span class="katex"><math><mi>y</mi></math></span> and <mjx-container><svg data-math="true"><text>z</text></svg></mjx-container>.</p>';const b=serialize(document.querySelector('p')!,'math',0);expect(b.protected.size).toBe(3);expect(renderTranslation(b,b.text).querySelectorAll('.math,.katex,mjx-container')).toHaveLength(3);});
  it('protects raw TeX delimiters',()=>{document.body.innerHTML='<p>Let \\(x^2\\) and $$a\nb$$ be given.</p>';const b=serialize(document.querySelector('p')!,'x',0);expect(b.protected.size).toBe(2);expect(renderTranslation(b,b.text).querySelectorAll('[data-am-tex]')).toHaveLength(2);});
  it('remaps cloned formula identifiers',()=>{document.body.innerHTML='<p>See <span class="math"><svg><defs><path id="g" d="M0 0"/></defs><use href="#g"/></svg></span></p>';const b=serialize(document.querySelector('p')!,'p',0);const node=renderTranslation(b,b.text);expect(node.querySelector('path')!.id).not.toBe('g');expect(node.querySelector('use')!.getAttribute('href')).toBe('#'+node.querySelector('path')!.id);expect(document.querySelector('use')!.getAttribute('href')).toBe('#g');});
});
describe('provider output validation',()=>{
  it('splits oversized text without breaking math markers or formatting scopes',()=>{const text='word '.repeat(60)+'⟪AM:O:1⟫'+'long '.repeat(30)+'⟪AM:P:2⟫⟪AM:C:1⟫ '+'end '.repeat(30);const chunks=splitProtectedText(text,100);expect(chunks.length).toBeGreaterThan(2);expect(chunks.join('')).toBe(text);for(const chunk of chunks)validateTokens(chunk,chunk);expect(chunks.filter(x=>x.includes('⟪AM:O:1⟫'))[0]).toContain('⟪AM:C:1⟫');});
  it('honors local memory budgets and sends Ollama context limits',()=>{const p={...presets.ollama!,contextTokens:4096};expect(buildRequest(p,'s','u').body).toHaveProperty('options.num_ctx',4096);expect(fitsContext(p,'short','short')).toBe(true);expect(fitsContext(p,'short','字'.repeat(6000))).toBe(false);expect(estimateTokens(analysisSample(p,'字'.repeat(10000)))).toBeLessThan(2048);});
  it('rebinds cached protection markers across fresh paragraph IDs',()=>{const a=canonicalize('hello ⟪AM:P:old-0⟫ ⟪AM:O:old-1⟫word⟪AM:C:old-1⟫');const b=canonicalize('hello ⟪AM:P:new-0⟫ ⟪AM:O:new-1⟫word⟪AM:C:new-1⟫');expect(a.text).toBe(b.text);expect(b.restore(a.text)).toContain('⟪AM:P:new-0⟫');expect(b.restore(a.text)).toContain('⟪AM:C:new-1⟫');});
  it('rejects missing, duplicate and crossing tokens',()=>{expect(()=>validateTokens('⟪AM:P:a⟫','')).toThrow();expect(()=>validateTokens('⟪AM:P:a⟫','⟪AM:P:a⟫⟪AM:P:a⟫')).toThrow();expect(()=>validateTokens('⟪AM:O:a⟫⟪AM:O:b⟫⟪AM:C:b⟫⟪AM:C:a⟫','⟪AM:O:a⟫⟪AM:O:b⟫⟪AM:C:a⟫⟪AM:C:b⟫')).toThrow();});
  it('rejects duplicate IDs, missing paragraphs and empty output',()=>{const source=[{id:'a',text:'one'},{id:'b',text:'two'}];expect(()=>parseTranslations('{"translations":[{"id":"a","text":"一"}]}',source)).toThrow();expect(()=>parseTranslations('[{"id":"a","text":"一"},{"id":"a","text":"二"}]',source)).toThrow();expect(()=>parseTranslations('[{"id":"a","text":""}]',[source[0]!])).toThrow();});
  it('accepts valid out-of-order results',()=>expect(parseTranslations('[{"id":"b","text":"二"},{"id":"a","text":"一"}]',[{id:'a',text:'one'},{id:'b',text:'two'}])).toHaveLength(2));
  it('builds native protocols without credentials in URLs',()=>{for(const kind of ['openai','claude','gemini'] as const){const request=buildRequest({...presets[kind]!,model:'test',apiKey:'secret'},'system','user');expect(request.url).not.toContain('secret');expect(request.headers['Content-Type']).toBe('application/json');}expect(buildRequest({...presets.claude!,model:'test'},'s','u').body).toHaveProperty('max_tokens');expect(buildRequest({...presets.gemini!,model:'test'},'s','u').body).toHaveProperty('systemInstruction');});
  it('changes thinking safely across speed profiles',()=>{expect(buildRequest({...presets.ollama!,model:'qwen'},'s','u','fast').body).toHaveProperty('think',false);expect(buildRequest({...presets.ollama!,model:'qwen'},'s','u','precise').body).toHaveProperty('think',false);expect(buildRequest({...presets.ollama!,model:'qwen',preciseThinking:true},'s','u','precise').body).toHaveProperty('think',true);expect(thinkingOptions({...presets.openai!,model:'unknown'},'precise')).toEqual({});expect(thinkingOptions({...presets.openai!,thinkingControl:'enable-thinking'},'precise')).toEqual({enable_thinking:false});expect(thinkingOptions({...presets.gemini!,model:'gemini-2.5-pro'},'fast')).toEqual({thinkingConfig:{thinkingBudget:128}});expect(thinkingOptions({...presets.claude!,model:'claude-sonnet-4-6',preciseThinking:true},'precise')).toEqual({thinking:{type:'adaptive'}});});
  it('reads responses and excludes Gemini thinking',()=>{expect(readResponse('openai',{choices:[{message:{content:'OK'}}]})).toBe('OK');expect(readResponse('claude',{content:[{type:'thinking',thinking:'private'},{type:'text',text:'OK'}]})).toBe('OK');expect(readResponse('gemini',{candidates:[{content:{parts:[{thought:true,text:'private'},{text:'OK'}]}}]})).toBe('OK');});
  it('handles auth without exposing response body',async()=>{await expect(callModel({...presets.openai!,model:'test'},'s','u',undefined,vi.fn(async()=>new Response('secret server error',{status:401})))).rejects.toMatchObject({status:401});});
  it('supports cancellation',async()=>{const c=new AbortController();c.abort();await expect(callModel({...presets.openai!,model:'test'},'s','u',c.signal,vi.fn(async(_u,init)=>{throw init?.signal?.reason;}))).rejects.toBeDefined();});
  it('retries transient errors but never retries credentials',async()=>{const run=vi.fn().mockRejectedValueOnce(new ProviderError('busy',429,1)).mockResolvedValue('ok');expect(await withRetry(run,new AbortController().signal)).toBe('ok');expect(run).toHaveBeenCalledTimes(2);const auth=vi.fn().mockRejectedValue(new ProviderError('bad key',401));await expect(withRetry(auth,new AbortController().signal)).rejects.toThrow();expect(auth).toHaveBeenCalledTimes(1);});
  it('limits local header compatibility to the extension and exact loopback address',()=>{const rule=localOriginRule({...presets.ollama!,baseUrl:'http://localhost:11434/v1'},'my-extension')!;expect(rule.condition.initiatorDomains).toEqual(['my-extension']);expect(new RegExp(rule.condition.regexFilter!).test('http://localhost:11434/api/chat')).toBe(true);expect(new RegExp(rule.condition.regexFilter!).test('http://localhost:114340/api/chat')).toBe(false);expect(localOriginRule({...presets.ollama!,baseUrl:'http://remote.example/v1'},'my-extension')).toBeUndefined();expect(localOriginRule({...presets.openai!,baseUrl:'http://localhost:11434'},'my-extension')).toBeUndefined();});
  it('excludes secrets from exported settings',()=>{const exported=safeExport({...defaults,profiles:[{...presets.openai!,apiKey:'secret',headers:{Authorization:'secret'}}]});expect(JSON.stringify(exported)).not.toContain('secret');});
});

describe('local structured-output recovery',()=>{
  const segments=[{id:'s0',text:'Use ⟪AM:P:0⟫ to prove ⟪AM:T:1:0⟫.'}];
  const valid=JSON.stringify({translations:[{id:'s0',text:'使用 ⟪AM:P:0⟫ 证明 ⟪AM:T:1:0⟫。'}]});
  it('accepts complete fenced/prefaced output without weakening token validation',()=>{
    expect(parseTranslations('<think>private analysis</think>\n```json\n'+valid+'\n```',segments)[0]?.text).toContain('证明');
    expect(parseTranslations('Here is the translation:\n'+valid,segments)).toHaveLength(1);
    expect(()=>parseTranslations('Answer: '+valid.replace('⟪AM:P:0⟫',''),segments)).toThrow('标记');
    expect(parseModelJSON('{"text":"braces } [ and escaped \\" quote"}')).toHaveProperty('text');
  });
  it('rejects truncated, ambiguous and unfinished reasoning responses',()=>{
    expect(()=>parseTranslations(valid.slice(0,-2),segments)).toThrow();
    expect(()=>parseTranslations('<think>'+valid,segments)).toThrow();
    expect(()=>parseTranslations(valid+'\n'+valid,segments)).toThrow();
  });
  it('removes neighbour markers while retaining protected placeholders in source segments',()=>{
    expect(cleanContext('See ⟪AM:O:uuid⟫proof⟪AM:C:uuid⟫ for ⟪AM:P:uuid-1⟫.')).toBe('See proof for [公式或代码].');
    expect(segments[0]!.text).toContain('⟪AM:P:0⟫');
  });
  it('uses native JSON output only for structured requests, preserving context limits',()=>{
    expect(buildRequest({...presets.ollama!,contextTokens:8192},'s','u','precise',true).body).toMatchObject({format:'json',think:false,options:{num_ctx:8192,num_predict:4096}});
    expect(buildRequest(presets.ollama!,'s','Say 连接成功').body).not.toHaveProperty('format');
    expect(buildRequest({...presets.ollama!,model:'qwen3.8:27b-mlx'},'s','u','precise',true).body).not.toHaveProperty('format');
    expect(buildRequest(presets.openai!,'s','u','precise',true).body).not.toHaveProperty('format');
  });
  it('retries thinking-only and truncated outputs directly with the same context and terms',async()=>{
    for(const bad of [{message:{content:'',thinking:'private'},done_reason:'stop'},{message:{content:valid.slice(0,-8)},done_reason:'length'},{message:{content:'broken JSON'},done_reason:'stop'}]){
      const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(bad))).mockResolvedValueOnce(new Response(JSON.stringify({message:{content:valid},done_reason:'stop'})));
      const recovered=vi.fn(),body=JSON.stringify({segments,context:{title:'Lean'},terminology:['定理']});
      expect(await translateRequest({...presets.ollama!,preciseThinking:true},'Translate, return JSON.',body,segments,new AbortController().signal,'precise',fetcher,recovered)).toHaveLength(1);
      const first=JSON.parse(fetcher.mock.calls[0]![1].body),second=JSON.parse(fetcher.mock.calls[1]![1].body);
      expect(first.think).toBe(true);expect(second.think).toBe(false);expect(second.format).toBe('json');expect(second.messages[1].content).toBe(first.messages[1].content);expect(recovered).toHaveBeenCalledTimes(1);
    }
  });
  it('detects a rejected native JSON capability once and retains thinking, budget and validation',async()=>{
    const p={...presets.ollama!,preciseThinking:true,baseUrl:'http://localhost:11434/capability-test'};
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'structured output is unavailable'}),{status:501})).mockImplementation(async()=>new Response(JSON.stringify({message:{content:valid}})));
    expect(await translateRequest(p,'s','u',segments,new AbortController().signal,'precise',fetcher)).toHaveLength(1);
    const first=JSON.parse(fetcher.mock.calls[0]![1].body),second=JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(first.format).toBe('json');expect(second).not.toHaveProperty('format');expect(second.think).toBe(true);expect(second.options.num_ctx).toBe(8192);
    await translateRequest(p,'s','u',segments,new AbortController().signal,'precise',fetcher);expect(fetcher).toHaveBeenCalledTimes(3);expect(JSON.parse(fetcher.mock.calls[2]![1].body)).not.toHaveProperty('format');
    const unknown=vi.fn(async()=>new Response(JSON.stringify({error:'unknown model'}),{status:400}));await expect(callModel({...p,baseUrl:p.baseUrl+'/other'},'s','u',undefined,unknown,'precise',true)).rejects.toMatchObject({status:400});expect(unknown).toHaveBeenCalledTimes(1);
  });
  it('bounds recovery and never retries auth or cancellation as malformed output',async()=>{
    const damaged=vi.fn(async()=>new Response(JSON.stringify({message:{content:valid.replace('⟪AM:P:0⟫','')}})));
    await expect(translateRequest(presets.ollama!,'s','u',segments,new AbortController().signal,'precise',damaged)).rejects.toThrow('标记');expect(damaged).toHaveBeenCalledTimes(2);
    const auth=vi.fn(async()=>new Response('{}',{status:403}));await expect(translateRequest(presets.ollama!,'s','u',segments,new AbortController().signal,'precise',auth)).rejects.toMatchObject({status:403});expect(auth).toHaveBeenCalledTimes(1);
    const c=new AbortController();c.abort();const aborted=vi.fn(async()=>{throw c.signal.reason;});await expect(translateRequest(presets.ollama!,'s','u',segments,c.signal,'precise',aborted)).rejects.toBeDefined();expect(aborted).not.toHaveBeenCalled();
  });
  it('detects length stops for all response protocols, even if a prefix is valid JSON',async()=>{
    for(const [kind,data] of Object.entries({ollama:{message:{content:valid},done_reason:'length'},openai:{choices:[{message:{content:valid},finish_reason:'length'}]},claude:{content:[{type:'text',text:valid}],stop_reason:'max_tokens'},gemini:{candidates:[{content:{parts:[{text:valid}]},finishReason:'MAX_TOKENS'}]}})){
      await expect(callModel({...presets[kind as keyof typeof presets]!},'s','u',undefined,vi.fn(async()=>new Response(JSON.stringify(data))),'precise',true)).rejects.toBeInstanceOf(ModelOutputError);
    }
  });
});

describe('reading order and prose whitespace regressions',()=>{
  it('starts with the intersecting long paragraph, not the closest short paragraph',()=>{
    const rows=[{id:'long',order:0,top:-900,bottom:150},{id:'short',order:1,top:160,bottom:185},{id:'prefetch',order:2,top:700,bottom:725},{id:'previous',order:-1,top:-80,bottom:-30}];
    expect(readingWindow(rows,600).map(r=>r.id)).toEqual(['long','short','prefetch','previous']);
  });
  it('re-evaluates reading position instead of carrying a stale far-away backlog',()=>{
    expect(readingWindow([{id:'old',order:0,top:-3000,bottom:-2900},{id:'current',order:1,top:-50,bottom:400},{id:'next',order:2,top:410,bottom:450}],600).map(p=>p.id)).toEqual(['current','next']);
  });
  it('normalizes HTML source line wrapping but preserves real breaks and code whitespace',()=>{
    document.body.innerHTML='<p id="wrapped">First source\nline with <code>let x :=  2\n  rfl</code><br>Second\nline.</p>';
    const p=document.querySelector('p')!,original=p.outerHTML,b=serialize(p,'wrapped',0);
    expect(b.text).not.toContain('\n');expect(b.protected.size).toBe(2);const output=renderTranslation(b,b.text);
    expect(output.style.whiteSpace).toBe('normal');expect(output.querySelectorAll('br')).toHaveLength(1);expect(output.querySelector('code')?.textContent).toBe('let x :=  2\n  rfl');expect(p.outerHTML).toBe(original);
  });
  it('removes accidental Chinese spaces across emphasis without touching protected code',()=>{
    document.body.innerHTML='<p>One <em>total order</em> and <code>中文  标识 x  y</code>.</p>';
    const b=serialize(document.querySelector('p')!,'spacing',0);const text=b.text.replace('One ','一个 ').replace('total order','全序 ').replace(' and ',' 关系。\n这是 一个 例子 ');
    const out=renderTranslation(b,text);expect(out.textContent).toContain('一个全序关系。这是一个例子');expect(out.querySelector('code')?.textContent).toBe('中文  标识 x  y');
    expect(normalizeProse('English words, v = 2 m/s, 一 个 术语 。')).toBe('English words, v = 2 m/s, 一个术语。');
  });
  it('retains intentionally preformatted prose line breaks',()=>{
    document.body.innerHTML='<p style="white-space:pre-line">First line\nSecond line.</p>';
    const b=serialize(document.querySelector('p')!,'lines',0);expect(b.preserveLines).toBe(true);expect(b.text).toContain('\n');const out=renderTranslation(b,'第一行\n第二行。');expect(out.style.whiteSpace).toBe('pre-wrap');expect(out.textContent).toContain('\n');
  });
  it('uses compact local markers with strict restoration and collision avoidance',()=>{
    const source='Use ⟪AM:P:0⟫ and ⟪AM:O:1⟫the ⟪AM:T:1:0⟫⟪AM:C:1⟫.';const req=fastRequest(source,{'⟪AM:T:1:0⟫':'定理'},{title:'Lean',heading:'Basics'}),body=JSON.parse(req.user);
    expect(body.source).not.toContain('⟪AM:');expect(body.lockedTerms).toContain('定理');expect(req.decode(body.source)).toBe(source);expect(()=>req.decode(body.source.replace('[AM0]',''))).toThrow('标记');expect(()=>req.decode(body.source+' [AM99]')).toThrow('未知');
    const collision=fastRequest('Literal [AM0] and ⟪AM:P:x⟫.',{},{title:'',heading:''});expect(collision.decode(JSON.parse(collision.user).source)).toBe('Literal [AM0] and ⟪AM:P:x⟫.');
  });
});


describe('local precision without compulsory reasoning',()=>{
 it('retains context, locked terms and hints in a compact validated paragraph',()=>{
  const source='For every ⟪AM:T:1:0⟫, this is not ⟪AM:O:1⟫necessarily⟪AM:C:1⟫ true for ⟪AM:P:2⟫.';
  const request=preciseRequest(source,{'⟪AM:T:1:0⟫':'向量空间'},{title:'Linear algebra',heading:'Duality',abstract:'Article abstract',before:'Previous argument.',after:'Next argument.',documentText:'Do not send the whole document.'},{domain:'math',summary:'本篇使用对偶空间',candidates:[{source:'dual',target:'对偶',sense:'linear algebra'}]});
  const body=JSON.parse(request.user);expect(body.context).toMatchObject({domain:'math',before:'Previous argument.',after:'Next argument.',abstract:'Article abstract',summary:'本篇使用对偶空间'});expect(body.context.candidates[0].target).toBe('对偶');expect(body.lockedTerms).toContain('向量空间');expect(request.user).not.toContain('whole document');
  const translated=body.source.replace('For every ','对每个').replace('this is not ','这并不').replace('necessarily','必然').replace(' true for ','对以下对象成立：');expect(request.decode(translated)).toContain('⟪AM:T:1:0⟫');expect(()=>request.decode(translated.replace('[AM0]',''))).toThrow('标记');expect(()=>request.decode(translated+' [AM99]')).toThrow('未知');
 });
 it('allows deep local reasoning only when explicitly enabled, and cloud reasoning is also opt-in',()=>{
  expect(thinkingOptions(presets.ollama!,'precise')).toEqual({think:false});expect(thinkingOptions({...presets.ollama!,preciseThinking:true},'precise')).toEqual({think:true});expect(thinkingOptions({...presets.ollama!,preciseThinking:true},'fast')).toEqual({think:false});expect(thinkingOptions({...presets.ollama!,thinkingControl:'none'},'precise')).toEqual({});expect(thinkingOptions({...presets.openai!,local:true,thinkingControl:'enable-thinking'},'precise')).toEqual({enable_thinking:false});expect(thinkingOptions({...presets.openai!,thinkingControl:'enable-thinking'},'precise')).toEqual({enable_thinking:false});
 });
 it('does not allow compact precision to swallow or cross formatting markers',()=>{
  const request=preciseRequest('⟪AM:O:1⟫A ⟪AM:O:2⟫nested⟪AM:C:2⟫ term⟪AM:C:1⟫ ⟪AM:P:3⟫',{}, {title:'',heading:'',abstract:'',before:'',after:''},{domain:'math'});const source=JSON.parse(request.user).source;
  expect(()=>request.decode(source.replace('[AM2]','[TEMP]').replace('[AM3]','[AM2]').replace('[TEMP]','[AM3]'))).toThrow('交叉');expect(()=>request.decode(source+' [AM5]')).toThrow();
 });
});


describe('source-aware Chinese revision',()=>{
 const source='You are welcome to prove ⟪AM:T:0:0⟫ for ⟪AM:P:0⟫.';
 const draft='你也欢迎证明 ⟪AM:P:0⟫ 的 ⟪AM:T:0:0⟫。';const ctx={title:'Lean',heading:'Exercises',abstract:'',before:'Previous explanation.',after:'Next exercise.'},literals={'⟪AM:T:0:0⟫':'结合律'};
 it('sends read-only paragraph context and edits only mutable text slots',async()=>{
  const req=polishRequest(source,draft,literals,ctx,{domain:'math'}),body=JSON.parse(req.user);expect(body.source).toContain('You are welcome');expect(body.draft.some((p:any)=>p.text.includes('你也欢迎'))).toBe(true);expect(body.draft.some((p:any)=>p.text==='结合律'&&!p.id)).toBe(true);expect(body.context.before).toBe('Previous explanation.');
  const fetcher=vi.fn(async(_url:any,_init:any)=>new Response(JSON.stringify({message:{content:JSON.stringify({edits:[{id:'t0',text:'你也可以证明 '}]})},done_reason:'stop'})));
  const result=await polishTranslation({...presets.ollama!,preciseThinking:true},source,draft,literals,ctx,{domain:'math'},new AbortController().signal,fetcher);expect(result).toContain('你也可以');validateTokens(source,result);expect(JSON.parse(fetcher.mock.calls[0]![1].body).think).toBe(false);
 });
 it('keeps the valid draft if a revision drops a marker, and refuses a damaged draft before sending it',async()=>{
  const rejected=vi.fn(),fetcher=vi.fn(async()=>new Response(JSON.stringify({message:{content:'你也可以证明结合律。'}})));
  expect(await polishTranslation(presets.ollama!,source,draft,literals,ctx,{domain:'math'},new AbortController().signal,fetcher,rejected)).toBe(draft);expect(rejected).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();
  await expect(polishTranslation(presets.ollama!,source,'丢失标记',literals,ctx,{domain:'math'},new AbortController().signal,fetcher)).rejects.toThrow('标记');expect(fetcher).toHaveBeenCalledOnce();
 });
 it('does not send a revision beyond the local context budget',async()=>{
  const fetcher=vi.fn(),rejected=vi.fn(),long='word '.repeat(1800);
  expect(await polishTranslation({...presets.ollama!,contextTokens:4096},long,long,{},ctx,{domain:'math'},new AbortController().signal,fetcher,rejected)).toBe(long);expect(fetcher).not.toHaveBeenCalled();expect(rejected).toHaveBeenCalledOnce();
 });
 it('honors cancellation and reports authorization errors instead of rewriting them',async()=>{
  const fetcher=vi.fn(async()=>new Response('{}',{status:401}));await expect(polishTranslation(presets.ollama!,source,draft,literals,ctx,{domain:'math'},new AbortController().signal,fetcher)).rejects.toMatchObject({status:401});expect(fetcher).toHaveBeenCalledOnce();
  const controller=new AbortController();controller.abort();const aborted=vi.fn(async()=>{throw controller.signal.reason;});await expect(polishTranslation(presets.ollama!,source,draft,literals,ctx,{domain:'math'},controller.signal,aborted)).rejects.toBeDefined();
 });
});
