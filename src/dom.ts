import { validateTokens, tokenPattern } from './protocol';
import {normalizeRenderedProse} from './prose';
export const blockSelector='p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,td,th,figcaption,.ltx_para,.abstract';
const excluded='pre,script,style,textarea,input,select,button,iframe,canvas,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-am-ui],[data-am-translation]';
const protectedSelector='code,math,img[data-tex],img.inline[alt],img.math,img[role="math"],mjx-container,.MathJax,.MathJax_Display,.katex,.ltx_Math,span.math,span.math-inline,.citation,.ltx_cite,.ltx_ref,.eqno,.eq-number,.ltx_tag_equation,svg[data-math],svg[role="math"],[role="doc-noteref"]';
export type Protected = { kind:'node'; node:Node } | { kind:'text'; text:string } | { kind:'format'; element:Element };
export type Block = { id:string; element:HTMLElement; text:string; protected:Map<string,Protected>; order:number; insertion:Element|null; preserveLines:boolean };
function marker(kind:string,id:string){return `⟪AM:${kind}:${id}⟫`;}
function safeClone(node:Node,prefix:string):Node {
  const clone=node.cloneNode(true);
  if(!(clone instanceof Element))return clone;
  for(const e of [clone,...clone.querySelectorAll('*')]) {
    if(['SCRIPT','IFRAME','OBJECT','EMBED','FOREIGNOBJECT'].includes(e.tagName.toUpperCase())){e.remove();continue;}
    for(const a of [...e.attributes])if(a.name.startsWith('on')||a.name==='srcdoc'||((a.name==='href'||a.name==='xlink:href')&&/^\s*(javascript|data):/i.test(a.value)))e.removeAttribute(a.name);
  }
  // Make mathematical SVGs independent of global font caches before rewriting IDs.
  for(const svg of [...(clone.matches('svg')?[clone]:[]),...clone.querySelectorAll('svg')]){
    for(const use of svg.querySelectorAll('use')){const ref=use.getAttribute('href')??use.getAttribute('xlink:href');if(ref?.startsWith('#')&&!svg.querySelector(`[id="${CSS.escape(ref.slice(1))}"]`)){const original=document.getElementById(ref.slice(1));if(original){let defs=svg.querySelector('defs');if(!defs){defs=document.createElementNS('http://www.w3.org/2000/svg','defs');svg.prepend(defs);}defs.append(original.cloneNode(true));}}}
  }
  const idMap=new Map<string,string>();
  for(const e of [clone,...clone.querySelectorAll('[id]')])if(e.id){const next=`${prefix}-${e.id}`;idMap.set(e.id,next);e.id=next;}
  for(const e of [clone,...clone.querySelectorAll('*')])for(const attr of ['href','xlink:href','aria-labelledby','aria-describedby','clip-path','fill','filter','mask','style']){
    const value=e.getAttribute(attr);if(!value)continue;let next=value;
    for(const [id,replacement] of idMap){if(next===`#${id}`)next=`#${replacement}`;if(next===id)next=replacement;next=next.replaceAll(`url(#${id})`,`url(#${replacement})`);}
    if(next!==value)e.setAttribute(attr,next);
  }
  return clone;
}
export function serialize(element:HTMLElement,id:string,order:number):Block {
  const preserveLines=/^(pre|pre-wrap|pre-line|break-spaces)$/.test(getComputedStyle(element).whiteSpace);
  const map=new Map<string,Protected>();let counter=0;
  const add=(value:Protected,kind='P')=>{const key=`${id}-${counter++}`;map.set(key,value);return marker(kind,key);};
  function text(value:string){
    // A page containing the literal token syntax cannot impersonate internal markers.
    value=value.replaceAll('⟪AM:','〈AM:');
    return value.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\$)\$(?!\s)[^\n$]+?\$(?!\$)/g,math=>add({kind:'text',text:math}));
  }
  function walk(node:Node):string {
    if(node.nodeType===Node.TEXT_NODE)return text(node.textContent??'');
    if(!(node instanceof HTMLElement||node instanceof SVGElement||node instanceof MathMLElement))return '';
    const e=node as Element;
    if(e!==element&&e.matches(blockSelector))return '';
    if(e.matches(protectedSelector)||e.tagName==='SUP'&&/^\s*[\d,–-]+\s*$/.test(e.textContent??''))return add({kind:'node',node:e});
    if(e!==element&&e.matches(excluded))return '';
    if(e.tagName==='BR')return add({kind:'node',node:e});
    const inner=[...node.childNodes].map(walk).join('');
    if(e!==element&&['A','STRONG','B','EM','I','SUB','SUP','S','U','MARK'].includes(e.tagName)){
      const key=`${id}-${counter++}`;map.set(key,{kind:'format',element:e});return marker('O',key)+inner+marker('C',key);
    }
    return inner;
  }
  const insertion=[...element.children].find(e=>e.matches(blockSelector)||e.matches('ul,ol,pre,table'))??null;
  const prose=walk(element);
  return {id,element,text:(preserveLines?prose:prose.replace(/[\t\n\r\f ]+/g,' ')).trim(),protected:map,order,insertion,preserveLines};
}
export function collectBlocks(root:ParentNode=document,translateNavigation=false,known=new WeakSet<Element>()):Block[]{
  const region=root===document?(document.querySelector('article,main,[role="main"],.document,.ltx_document')??document.body):root;
  const elements=[...region.querySelectorAll<HTMLElement>(blockSelector)];
  if(translateNavigation&&root===document)elements.push(...document.querySelectorAll<HTMLElement>('nav a,aside a,.toctree-wrapper a,.sphinxsidebar a,.wy-menu a'));
  const result:Block[]=[];
  for(const element of [...new Set(elements)]){
    if(known.has(element)||element.closest(excluded)||!translateNavigation&&element.closest('nav,aside,.sphinxsidebar,.wy-menu,.toctree-wrapper')||element.hidden||element.getAttribute('aria-hidden')==='true')continue;
    const block=serialize(element,crypto.randomUUID(),result.length);
    const prose=block.text.replace(tokenPattern,'').trim();
    if(!/[A-Za-z]{2,}/.test(prose)||prose.length<3||element.closest('[lang^="zh"]'))continue;
    known.add(element);result.push(block);
  }
  return result;
}
export function renderTranslation(block:Block,text:string):HTMLElement{
  validateTokens(block.text,text);
  const root=document.createElement('span');root.dataset.amTranslation=block.id;root.lang='zh-CN';root.className='am-translation';
  root.style.whiteSpace=block.preserveLines?'pre-wrap':'normal';
  const stack:Element[]=[root];let at=0;
  for(const m of text.matchAll(tokenPattern)){
    stack[stack.length-1]!.append(document.createTextNode(text.slice(at,m.index)));
    const parts=m[0].match(/^⟪AM:([POC]):(.+)⟫$/);if(!parts)throw new Error('译文包含未知格式标记。');
    const item=block.protected.get(parts[2]!);if(!item)throw new Error('译文包含未知占位符。');
    if(parts[1]==='O'){
      if(item.kind!=='format')throw new Error('格式标记无效。');
      const wrapper=safeClone(item.element.cloneNode(false),`am-${block.id}`) as Element;
      if(wrapper instanceof HTMLAnchorElement){wrapper.removeAttribute('id');if(!/^(https?:|mailto:|#|\/)/i.test(wrapper.getAttribute('href')??''))wrapper.removeAttribute('href');}
      stack[stack.length-1]!.append(wrapper);stack.push(wrapper);
    }else if(parts[1]==='C')stack.pop();
    else if(item.kind==='node'){const clone=safeClone(item.node,`am-${block.id}-${parts[2]}`);if(clone instanceof Element)clone.setAttribute('data-am-protected','');stack[stack.length-1]!.append(clone);}
    else if(item.kind==='text'){const span=document.createElement('span');span.dataset.amTex=item.text;span.textContent=item.text;stack[stack.length-1]!.append(span);}
    else throw new Error('保护标记无效。');
    at=m.index+m[0].length;
  }
  stack[stack.length-1]!.append(document.createTextNode(text.slice(at)));normalizeRenderedProse(root,block.preserveLines);return root;
}

export function readonlyReferences(block:Block):Record<string,string>{
  const values:Record<string,string>={};let budget=2000;
  for(const [id,item] of block.protected){if(item.kind==='format')continue;const text=item.kind==='text'?item.text:item.node instanceof Element?item.node.getAttribute('data-tex')??item.node.getAttribute('aria-label')??item.node.getAttribute('alt')??item.node.textContent??'':item.node.textContent??'';const value=text.slice(0,Math.min(240,budget));if(value){values[`⟪AM:P:${id}⟫`]=value;budget-=value.length;}if(budget<=0)break;}return values;
}
