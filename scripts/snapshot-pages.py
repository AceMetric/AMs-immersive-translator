"""Download public HTML snapshots into ignored artifacts, only for local structural QA."""
import urllib.request,pathlib,json
folder=pathlib.Path('artifacts/snapshots');folder.mkdir(parents=True,exist_ok=True)
urls={'lean-basics':'https://leanprover-community.github.io/mathematics_in_lean/C02_Basics.html','lean':'https://leanprover-community.github.io/mathematics_in_lean/C03_Logic.html','arxiv':'https://arxiv.org/html/2407.10939v1','python':'https://docs.python.org/3/tutorial/datastructures.html'}
report=[]
for name,url in urls.items():
    request=urllib.request.Request(url,headers={'User-Agent':'AM-Academic-Translator-Local-Validation/0.1'})
    data=urllib.request.urlopen(request,timeout=30).read()
    (folder/(name+'.html')).write_bytes(data)
    report.append({'name':name,'url':url,'bytes':len(data)})
    print(name,len(data))
(folder/'sources.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
