"""Save explicitly selected official reference documents and upstream licenses.

This provides provenance only. Editorial definitions and review decisions remain
separate; downloaded text never automatically becomes a reviewed glossary term.
"""
import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'pytorch': dict(repo='pytorch/pytorch', branch='main', author='PyTorch contributors', license='BSD-3-Clause', licenseFile='LICENSE', marker='Redistribution and use in source and binary forms', documents=['docs/source/notes/autograd.md', 'docs/source/amp.md', 'docs/source/distributed.md', 'docs/source/distributed.pipelining.md']),
    'spinning-up': dict(repo='openai/spinningup', branch='master', author='OpenAI Spinning Up contributors', license='MIT', licenseFile='LICENSE', marker='The MIT License', documents=['docs/spinningup/rl_intro.rst', 'docs/spinningup/rl_intro2.rst','docs/algorithms/ddpg.rst']),
    'etcd': dict(repo='etcd-io/website', branch='main', author='etcd Authors', license='CC-BY-4.0', licenseFile='LICENSE', marker='Creative Commons Attribution 4.0 License', documents=['content/en/docs/v3.6/learning/api_guarantees.md','content/en/docs/v3.6/learning/glossary.md','content/en/docs/v3.6/faq.md']),
    'cypress': dict(repo='cypress-io/cypress-documentation', branch='main', author='Cypress.io contributors', license='MIT', licenseFile='LICENSE.md', marker='MIT License', documents=['docs/app/core-concepts/introduction-to-cypress.mdx']),
    'postgres': dict(repo='postgres/postgres', branch='master', author='PostgreSQL Global Development Group', license='PostgreSQL', licenseFile='COPYRIGHT', marker='Permission to use, copy, modify, and distribute', documents=['doc/src/sgml/queries.sgml']),
    'python': dict(repo='python/cpython', branch='main', author='Python Software Foundation and Python contributors', license='PSF-2.0', licenseFile='LICENSE', marker='PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2', documents=['Doc/library/threading.rst']),
    'cleverhans': dict(repo='cleverhans-lab/cleverhans', branch='master', author='CleverHans contributors', license='MIT', licenseFile='LICENSE', marker='MIT License', documents=['tutorials/torch/cifar10_tutorial.py','tutorials/torch/mnist_tutorial.py']),
    'transformers': dict(repo='huggingface/transformers', branch='main', author='Hugging Face Transformers contributors', license='Apache-2.0', licenseFile='LICENSE', marker='Apache License', documents=['src/transformers/generation/logits_process.py']),
    'mdn': dict(repo='mdn/content', branch='main', author='MDN contributors', license='CC-BY-SA-2.5', licenseFile='LICENSE.md', marker='Creative Commons Attribution-ShareAlike 2.5', documents=['files/en-us/glossary/asynchronous/index.md','files/en-us/glossary/synchronous/index.md','files/en-us/web/javascript/reference/operators/bitwise_and/index.md']),
}


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'AM-Glossary-Audit/0.1 (official-source evidence)'}), timeout=30) as response:
        return response.read()


def collect(name):
    source=SOURCES[name]
    directory=ROOT/'data/primary-sources'/name
    directory.mkdir(parents=True, exist_ok=True)
    revision_path=directory/'revision.json'
    if revision_path.exists():
        revision=json.loads(revision_path.read_text())['revision']
    else:
        revision=subprocess.check_output(['gh','api',f"repos/{source['repo']}/commits/{source['branch']}",'--jq','.sha'],text=True).strip()
        if len(revision)!=40 or any(c not in '0123456789abcdef' for c in revision):
            raise ValueError('Unexpected source revision')
        revision_path.write_text(json.dumps(dict(repo=source['repo'],revision=revision),indent=2)+'\n')
    base=f"https://raw.githubusercontent.com/{source['repo']}/{revision}/"
    license_path=directory/'LICENSE.txt'
    if not license_path.exists():
        license_text=fetch(base+source['licenseFile']).decode('utf-8')
        if source['marker'] not in license_text:
            raise ValueError('Unexpected upstream license: '+name)
        license_path.write_text(license_text)
    for document in source['documents']:
        path=directory/(document.replace('/','--')+'.json')
        url=base+document
        if path.exists():
            saved=json.loads(path.read_text())
            if saved['sourceUrl']!=url or saved['textSha256']!=hashlib.sha256(saved['text'].encode()).hexdigest() or saved['license']!=source['license']:
                raise ValueError('Invalid reference cache: '+str(path))
            print('cache',name,document,flush=True)
            continue
        raw=fetch(url)
        text=raw.decode('utf-8')
        if len(text)<100:
            raise ValueError('Incomplete reference document')
        snapshot=dict(sourceUrl=url,revision=revision,repo=source['repo'],upstreamPath=document,
                      author=source['author'],license=source['license'],licenseUrl=base+source['licenseFile'],
                      retrievedAt=datetime.now(timezone.utc).isoformat(),responseSha256=hashlib.sha256(raw).hexdigest(),
                      textSha256=hashlib.sha256(text.encode()).hexdigest(),transformation='UTF-8 source text; no content changes',text=text)
        path.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n')
        print('saved',name,document,len(text),flush=True)
    (directory/'ATTRIBUTION.md').write_text(f"# Reference source attribution\n\n{source['author']}.\n\nRepository: https://github.com/{source['repo']}\n\nRevision: {revision}\n\nUpstream license: {source['license']}; see LICENSE.txt.\n\nDocuments are copied as reference evidence without content changes. They are separate from AM's CC0 term dataset; source references do not imply the author's endorsement.\n")


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project',choices=list(SOURCES),action='append')
    args=parser.parse_args()
    for name in args.project or SOURCES:
        collect(name)


if __name__=='__main__':
    main()
