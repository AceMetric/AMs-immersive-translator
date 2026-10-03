// Static, offline, anonymous reading view. No model calls or external resources.
import {readFileSync,writeFileSync} from 'node:fs';
import {Window} from 'happy-dom';
const folder=process.argv[2]??'artifacts/benchmark-0.1.4-final';
const review=JSON.parse(readFileSync(folder+'/blind-review.json'));
const corpus=JSON.parse(readFileSync('data/benchmark/public-60.json'));
const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const w=new Window();let sections='';
for(const item of corpus.paragraphs){
 const variants=review.filter(row=>row.paragraph===item.id);if(!variants.length)continue;
 w.document.body.innerHTML=item.html;
 for(const img of w.document.querySelectorAll('img'))img.replaceWith(w.document.createTextNode(img.getAttribute('data-tex')??img.getAttribute('alt')??'〔原图〕'));
 const source=w.document.body.textContent.replace(/\s+/g,' ').trim();
 sections+=`<section id="${escape(item.id)}"><div class="label">${escape(item.id)} · ${escape(item.domain)}</div><h2>${escape(item.heading)}</h2><div class="original">${escape(source)}</div><a href="${escape(item.sourceUrl)}" rel="noreferrer">查看原始来源</a><div class="variants">${variants.map((v,i)=>`<article><h3>译文 ${i+1} <small>${escape(v.id.slice(0,8))}</small></h3><p>${escape(v.translation)}</p></article>`).join('')}</div></section>`;
}
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AM 本地译文对照</title><style>body{margin:0;background:#f4f8f8;color:#153e46;font:17px/1.85 system-ui}main{max-width:1140px;margin:40px auto;padding:0 24px}header,section{background:white;border:1px solid #dce8e8;border-radius:16px;padding:26px;margin:24px 0}h1,h2,h3{line-height:1.4}h2{font-size:20px}.label,small{color:#678087;font-size:13px}.original{white-space:pre-wrap;color:#394f55;padding:16px;background:#f3f7f7;border-radius:8px;overflow-wrap:anywhere}a{color:#008493}.variants{display:grid;grid-template-columns:1fr 1fr;gap:24px}article p{white-space:pre-wrap;overflow-wrap:anywhere}article{min-width:0}nav a{margin-right:14px}@media(max-width:750px){.variants{grid-template-columns:1fr}main{padding:0 10px}header,section{padding:16px}}@media(prefers-color-scheme:dark){body{background:#10272b;color:#d0e4e7}header,section{background:#18363b;border-color:#315258}.original{background:#102b30;color:#c4d8dc}a{color:#69c8c4}}</style><main><header><h1>AM 本地译文对照</h1><p>数学、物理、计算机各 20 个公开段落。每段译文已随机排列并隐去模型、档位；完整映射保存在同目录的 reveal-after-review.json，建议读完后再查看。图片公式在原文中以只读 TeX 或替代文字显示，本文件不会访问外部资源。</p><p>这是模型实际输出，保留其缺陷。格式通过不代表语义准确。可能出现误译、重复术语或额外内容；请结合中文报告查看具体轮次和后续修复。浏览器搜索可查找段落 ID；源页面链接由你手动打开。</p><nav><a href="#math-01">数学</a><a href="#physics-01">物理</a><a href="#cs-01">计算机</a></nav></header>${sections}</main></html>`;
writeFileSync(folder+'/对照阅读.html',html);await w.happyDOM.close();console.log(folder+'/对照阅读.html');
