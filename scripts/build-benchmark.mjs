// Fetch only HTML/Markdown text, never models, media or executable page scripts.
import {Window} from 'happy-dom';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const book='https://www.gutenberg.org/cache/epub/33283/pg33283-images.html';
const newton='https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/newtons-laws-of-motion/';
const energy='https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/conservation-of-energy/';
const sqlite='https://raw.githubusercontent.com/sqlite/sqlite/master/README.md';
const rows=[];
for(const [domain,url,count] of [['math',book,20],['physics',newton,12],['physics',energy,8],['cs',sqlite,20]]){
 const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Source HTTP ${r.status}: ${url}`);const raw=await r.text(),w=new Window();
 if(domain==='cs'){
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  w.document.body.innerHTML=raw.split(/\n\s*\n/).filter(p=>!/^\s*(?:```|<|#|\[|\*|[-=]{3}|[0-9]+\.)/.test(p)).map(p=>'<p>'+escape(p).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\s+/g,' ')+'</p>').join('');
 }else w.document.body.innerHTML=raw;
 const chapter=w.document.querySelector('#CHAPTER_I');
 const paragraphs=[...w.document.querySelectorAll('p')].filter(p=>{
  const text=p.textContent.replace(/\s+/g,' ').trim();
  return text.length>=110&&text.length<=1100&&!p.closest('footer,header,nav,form,[id*=footer],.pagenum,.figcenter')&&(!chapter||!!(chapter.compareDocumentPosition(p)&w.Node.DOCUMENT_POSITION_FOLLOWING))&&!/Project Gutenberg|Rate this page|Contact Information|Provide feedback/.test(text);
 });
 if(paragraphs.length<count)throw new Error(`Insufficient ${domain}: ${paragraphs.length}`);
 for(let n=0;n<count;n++){
  const index=domain==='math'?Math.floor(n*paragraphs.length/count):n,p=paragraphs[index];
  for(const e of p.querySelectorAll('.pagenum,script,style'))e.remove();
  const heading=[...w.document.querySelectorAll('h1,h2,h3')].filter(h=>!!(h.compareDocumentPosition(p)&w.Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)?.textContent?.trim()??domain;
  rows.push({id:domain+'-'+String(rows.filter(x=>x.domain===domain).length+1).padStart(2,'0'),domain,sourceUrl:url,sourceIndex:index,sourceHash:createHash('sha256').update(raw).digest('hex'),title:w.document.title||'SQLite source documentation',heading,html:p.outerHTML,sourceText:p.textContent.replace(/\s+/g,' ').trim(),license:domain==='math'?'Public domain original (1914; author died 1916). Gutenberg transcription attribution retained.':domain==='cs'?'Public domain SQLite documentation':'US government educational text; source NASA Glenn. Translations are AM/model output, not NASA statements.'});
 }
 console.log(domain,url,count);await w.happyDOM.close();
}
mkdirSync('data/benchmark',{recursive:true});writeFileSync('data/benchmark/public-60.json',JSON.stringify({capturedAt:new Date().toISOString(),licenseReferences:['https://www.gutenberg.org/ebooks/33283','https://www.gutenberg.org/policy/license.html','https://sqlite.org/copyright.html','https://www.nasa.gov/nasa-brand-center/images-and-media/'],paragraphs:rows},null,2));
console.log('60 public paragraphs saved. Original historical source style is not a quality recommendation.');
