"""Create an offline read-only, searchable screening report; never edits terms."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
audit = json.loads((ROOT / 'data/glossary-audit/candidates.json').read_text())
pool = json.loads((ROOT / 'data/glossary-audit/candidate-quarantine.json').read_text())
by_id = {x['id']: x for x in audit['entries']}
records = []
for path in (ROOT / 'public/glossaries').glob('extended-*.json'):
    for term in json.loads(path.read_text())['terms']:
        records.append({'term': term, 'provenance': by_id[term['id']], 'screening': by_id[term['id']]['screening']})
records.extend(pool['quarantined'] + pool['excluded'])
rows = [{'id': r['term']['id'], 'domain': r['term']['domain'], 'source': r['term']['source'],
         'target': r['term']['target'], 'definition': r['term']['definition'],
         'status': r['screening']['status'], 'reason': r['screening']['reason'],
         'descriptionStatus': r['screening']['descriptionStatus'],
         'coreChanges': (r['provenance']['coreCanonicalization']['inputTarget'] + ' → ' + r['term']['target']
                         if r['provenance'].get('coreCanonicalization') and
                         r['provenance']['coreCanonicalization']['inputTarget'] != r['term']['target'] else ''),
         'originalLabel': r['provenance']['originalLabel'],
         'language': r['provenance']['labelLanguage'],
         'localeChanges': '；'.join(x['before'] + ' → ' + x['after'] for x in
                                   r['provenance']['locale']['rules'] +
                                   r['provenance']['locale'].get('equivalentAlternative', {}).get('rules', [])),
         'labelVariants': '；'.join(x['language'] + ': ' + x['label'] for x in r['provenance']['availableLabels']),
         'evidence': '；'.join(r['screening'].get('definitionMatches', []) +
                             [x['match'] for x in r['screening'].get('branchSignals', [])] +
                             (['同领域、同原词及同一实体的核心核对记录'] if r['screening'].get('coreReference') else []) +
                             (['具体分类＋英中名称支持'] if r['screening'].get('bilingualClassEvidence') else []) +
                             r['screening'].get('translationIssues', [])),
         'roots': ' | '.join(sorted({s['root']['label'] for s in r['provenance']['sources']})),
         'url': r['term']['sourceUrl']} for r in records]
payload = json.dumps({'rows': rows, 'stats': audit['screening']}, ensure_ascii=False).replace('<', '\\u003c')
html = r'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AM 扩展词库筛选报告</title>
<style>:root{font-family:system-ui,sans-serif;color:#20353a;background:#f3f7f7}body{max-width:1200px;margin:40px auto;padding:0 22px}h1{font-size:28px}p{line-height:1.7;color:#52656b}.cards{display:flex;gap:18px;margin:24px 0}.card{flex:1;background:white;border-radius:14px;padding:20px}.card b{display:block;font-size:32px;color:#09848a}.tools{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}input,select,button{padding:11px;border:1px solid #cddcdd;border-radius:8px;font:inherit;background:white;color:inherit}input{flex:1;min-width:230px}button{cursor:pointer}table{width:100%;border-collapse:collapse;background:white;border-radius:10px}th,td{text-align:left;vertical-align:top;padding:13px;border-bottom:1px solid #e3ebeb}small{display:block;color:#6a7c82;line-height:1.6;word-break:break-word}td:nth-child(1){width:24%}td:nth-child(2){width:18%}a{color:#07818b}strong{font-weight:600}.foot{display:flex;justify-content:space-between;align-items:center;margin:18px 0}@media(prefers-color-scheme:dark){:root{color:#d5e7e8;background:#122225}p,small{color:#9cb1b5}.card,table,input,select,button{background:#1c3035;color:inherit}td,th{border-color:#345057}input,select,button{border-color:#345057}}</style>
<h1>AM · 扩展词库筛选报告</h1><p>学科范围与译名分别检查；“待复核”表示证据不足或译名待查，并不表示术语错误。简体字转换后，再根据英文概念规范部分大陆用词；来源描述不全且有独立证据的条目可以保留；未经专业审校的条目仍是候选。待复核与排除记录可恢复，未随插件内置。</p>
<div class="cards"><div class="card">内置候选<b id="retained"></b></div><div class="card">待复核<b id="quarantined"></b></div><div class="card">明确排除<b id="excluded"></b></div></div>
<div class="tools"><input id="query" aria-label="搜索" placeholder="搜索原词、译名、定义或分类分支…"><select id="status" aria-label="状态"><option value="">全部状态</option><option value="retain">内置候选</option><option value="quarantine">待复核</option><option value="exclude">明确排除</option></select><select id="domain" aria-label="领域"><option value="">全部领域</option><option value="math">数学</option><option value="physics">物理</option><option value="cs">计算机</option></select><select id="reason" aria-label="筛选原因"><option value="">全部原因</option></select><select id="locale" aria-label="译名规范"><option value="">全部译名</option><option value="changed">地区用词已规范</option><option value="core">采用同实体核心译名</option></select><select id="detail" aria-label="资料完整度"><option value="">全部来源资料</option><option value="incomplete">来源描述不全</option><option value="recovered">资料不全但已内置</option></select><button id="export">导出筛选结果 CSV</button></div>
<p id="count" aria-live="polite"></p><table><thead><tr><th>原词与来源分支</th><th>译名 / 领域</th><th>来源描述与筛选证据</th></tr></thead><tbody id="body"></tbody></table><div class="foot"><button id="prev">上一页</button><span id="page"></span><button id="next">下一页</button></div>
<script type="application/json" id="dataset">PAYLOAD</script><script>
const {rows,stats}=JSON.parse(document.getElementById('dataset').textContent),names={math:'数学',physics:'物理',cs:'计算机'},labels={
'generic taxonomy membership without specific domain evidence':'仅有宽泛分类，缺少学科证据',
'missing definition; scope cannot be established':'缺少定义，无法确认领域',
'definition only repeats a generic class; insufficient evidence':'定义只重复泛泛类别，证据不足',
'label differs from project-checked core; translation/sense needs review':'与核心译名冲突，需核对词义或译法',
'label meaning needs review; locale normalization is insufficient':'标签词义待核查，地区用词转换不足以修复',
'independent domain evidence despite incomplete description':'来源描述不全，凭独立分类或核心证据保留候选',
'foreign subject signal requires review':'存在其他学科信号',
'conflicting source branch and domain evidence':'分类分支与学科证据冲突',
'explicit non-academic subject':'明确非本批学术主题',
'out-of-scope source branch/type':'来源分支或类型越界',
'scoped source path or domain-specific definition':'明确的学科分支或定义'};
for(const name of ['retained','quarantined','excluded'])document.getElementById(name).textContent=stats[name].toLocaleString();
for(const reason of [...new Set(rows.map(r=>r.reason))]){const o=document.createElement('option');o.value=reason;o.textContent=labels[reason]||reason;document.getElementById('reason').append(o)}
let page=0,filtered=[];const size=80,cell=(text,small)=>{const c=document.createElement('td'),s=document.createElement('strong');s.textContent=text;c.append(s);if(small){const n=document.createElement('small');n.textContent=small;c.append(n)}return c};
function render(){const q=document.getElementById('query').value.trim().toLowerCase(),status=document.getElementById('status').value,domain=document.getElementById('domain').value,reason=document.getElementById('reason').value,locale=document.getElementById('locale').value,detail=document.getElementById('detail').value;
filtered=rows.filter(r=>(!status||r.status===status)&&(!domain||r.domain===domain)&&(!reason||r.reason===reason)&&(!locale||(locale==='core'?!!r.coreChanges:!!r.localeChanges))&&(!detail||(r.descriptionStatus!=='specific'&&(detail!=='recovered'||r.status==='retain')))&&(!q||[r.source,r.target,r.originalLabel,r.labelVariants,r.definition,r.roots].join(' ').toLowerCase().includes(q)));page=Math.min(page,Math.max(0,Math.ceil(filtered.length/size)-1));const body=document.getElementById('body');body.replaceChildren();for(const r of filtered.slice(page*size,(page+1)*size)){const tr=document.createElement('tr'),first=cell(r.source,r.roots),link=document.createElement('a');link.textContent='来源';if(/^https:\/\/www.wikidata.org\/wiki\/Q[1-9][0-9]*$/.test(r.url))link.href=r.url;link.target='_blank';link.rel='noreferrer';first.append(link);tr.append(first,cell(r.target,names[r.domain]+' · 原标签 '+r.originalLabel+' ('+r.language+')'+(r.localeChanges?' · 地区规范：'+r.localeChanges:'')+(r.coreChanges?' · 核心同实体：'+r.coreChanges:'')),cell(r.definition||'（无定义）',(labels[r.reason]||r.reason)+(r.evidence?' · 证据：'+r.evidence:'')));body.append(tr)}document.getElementById('count').textContent='当前筛选 '+filtered.length.toLocaleString()+' 条，每页 '+size+' 条。';document.getElementById('page').textContent=(page+1)+' / '+Math.max(1,Math.ceil(filtered.length/size));document.getElementById('prev').disabled=page===0;document.getElementById('next').disabled=(page+1)*size>=filtered.length}
for(const id of ['query','status','domain','reason','locale','detail'])document.getElementById(id).addEventListener(id==='query'?'input':'change',()=>{page=0;render()});document.getElementById('prev').onclick=()=>{page--;render()};document.getElementById('next').onclick=()=>{page++;render()};document.getElementById('export').onclick=()=>{const fields=['source','target','originalLabel','language','localeChanges','coreChanges','descriptionStatus','labelVariants','domain','definition','status','reason','evidence','roots','url'];const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';const content='\ufeff'+[fields.join(','),...filtered.map(r=>fields.map(f=>quote(r[f])).join(','))].join('\r\n'),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='am-screening.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};render();
</script></html>'''
# Preserve escaped JavaScript newlines; this HTML uses no external resources.
html = html.replace('PAYLOAD', payload)
output = ROOT / 'artifacts/glossary-research/screening-report.html'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(html)
print(output)
