"""Download reproducible, CC0 bilingual candidates. No model-generated entries."""
import concurrent.futures, json, pathlib, re, time, urllib.parse, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
ROOT.joinpath('public/glossaries').mkdir(parents=True, exist_ok=True)
CLASSES = {
    'math': ['Q24034552','Q246672','Q65943'],
    'physics': ['Q33104303','Q107715','Q408891'],
    'cs': ['Q8366','Q66747126'],
}
def fetch(pair):
    domain, qid = pair
    query = f'''SELECT DISTINCT ?item ?en ?zh WHERE {{
      ?item wdt:P31 wd:{qid} .
      ?item rdfs:label ?en, ?zh . FILTER(LANG(?en)="en" && LANG(?zh)="zh")
      FILTER NOT EXISTS {{ ?item wdt:P31 wd:Q5 }}
    }} LIMIT 500'''
    url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query':query,'format':'json'})
    cache = ROOT / 'data' / 'wikidata' / f'{domain}-{qid}.json'
    if cache.exists(): return domain, json.loads(cache.read_text())
    cache.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1):
        try:
            req = urllib.request.Request(url,headers={'User-Agent':'AM-Academic-Translator/0.1 (open-source glossary research)','Accept':'application/sparql-results+json'})
            rows = json.load(urllib.request.urlopen(req,timeout=90))['results']['bindings']
            cache.write_text(json.dumps(rows,ensure_ascii=False,indent=2))
            print(domain,qid,len(rows),flush=True)
            time.sleep(61)
            return domain, rows
        except Exception as e:
            print(domain,qid,type(e).__name__,str(e)[:100],flush=True)
            time.sleep(61)
    return domain, []
def main():
    terms={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        for domain,rows in pool.map(fetch,[(d,q) for d,qs in CLASSES.items() for q in qs]):
            for r in rows:
                en,zh,url=r['en']['value'].strip(),r['zh']['value'].strip(),r['item']['value']
                if not re.search('[A-Za-z]',en) or not re.search('[\u4e00-\u9fff]',zh) or len(en)>100 or len(zh)>60: continue
                if en.lower()==zh.lower() or re.search(r'^(Category:|Template:|List of|Wikipedia:)',en): continue
                qid=url.rsplit('/',1)[-1]; key=(domain,en.casefold())
                terms[key]={'id':f'wd-{domain}-{qid}','source':en,'target':zh,'domain':domain,'sense':en,'aliases':[], 'sourceUrl':f'https://www.wikidata.org/wiki/{qid}','license':'CC0-1.0','quality':'candidate','enabled':True}
    pack={'name':'Wikidata 理工科扩展候选库','version':'2026-10-02','author':'Wikidata contributors','license':'CC0-1.0','terms':sorted(terms.values(),key=lambda t:(t['domain'],t['source'].lower()))}
    ROOT.joinpath('public/glossaries/extended.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2))
    print('TOTAL',len(terms),flush=True)
if __name__=='__main__': main()
