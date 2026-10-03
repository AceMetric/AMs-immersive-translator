import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
let counter=0;
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const documentMath=mathjax.document('',{InputJax:new TeX({packages:AllPackages}),OutputJax:new SVG({fontCache:'local'})});
export async function typesetProtected(root:HTMLElement){
  for(const e of root.querySelectorAll<HTMLElement>('[data-am-tex]')){
    const source=e.dataset.amTex!;const display=source.startsWith('$$')||source.startsWith('\\[');
    const tex=source.replace(/^(\$\$|\$|\\\[|\\\()/,'').replace(/(\$\$|\$|\\\]|\\\))$/,'');
    try{
      const node=await mathjax.handleRetriesFor(()=>documentMath.convert(tex,{display}));
      const html=adaptor.outerHTML(node);const parsed=new DOMParser().parseFromString(html,'text/html');const svg=parsed.querySelector('svg');
      if(!svg||parsed.querySelector('[data-mjx-error]'))continue;
      const prefix=`am-math-${counter++}-`;const ids=new Map<string,string>();for(const el of svg.querySelectorAll('[id]')){ids.set(el.id,prefix+el.id);el.id=prefix+el.id;}
      for(const use of svg.querySelectorAll('use'))for(const attr of ['href','xlink:href']){const ref=use.getAttribute(attr);if(ref?.startsWith('#')&&ids.has(ref.slice(1)))use.setAttribute(attr,'#'+ids.get(ref.slice(1)));}
      e.replaceChildren(document.importNode(svg,true));e.setAttribute('aria-label',source);
    }catch{/* Keep the exact original TeX when its commands are unsupported. */}
  }
}
