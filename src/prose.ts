const han='\\p{Script=Han}';
export function normalizeProse(text:string,preserveLines=false):string{
  let value=preserveLines?text.replace(/[\t\f ]+/g,' '):text.replace(/[\t\n\r\f ]+/g,' ');
  // Keep Latin word boundaries, units and protected code; remove only spaces
  // that separate Chinese prose or precede Chinese punctuation.
  value=value.replace(new RegExp(`(${han}) +(?=${han}|[，。！？；：、）】」』》])`,'gu'),'$1');
  value=value.replace(/([，。！？；：、）】」』》]) +(?=\p{Script=Han})/gu,'$1');
  return value.replace(/([（【「『《]) +(?=\p{Script=Han})/gu,'$1');
}
export function normalizeRenderedProse(root:Element,preserveLines:boolean){
  const events:(Text|null)[]=[];
  const walk=(node:Node)=>{
    if(node instanceof Text){node.data=normalizeProse(node.data,preserveLines);events.push(node);return;}
    if(node instanceof Element&&(node.hasAttribute('data-am-protected')||node.hasAttribute('data-am-tex')||node.tagName==='BR')){events.push(null);return;}
    for(const child of node.childNodes)walk(child);
  };walk(root);
  for(let i=1;i<events.length;i++){
    const a=events[i-1],b=events[i];if(!a||!b)continue;
    if(/(?:\p{Script=Han}|[，。！？；：、）】」』》]) *$/u.test(a.data)&&/^ *(?:\p{Script=Han}|[，。！？；：、）】」』》])/u.test(b.data)){a.data=a.data.replace(/ +$/,'');b.data=b.data.replace(/^ +/,'');}
  }
}
