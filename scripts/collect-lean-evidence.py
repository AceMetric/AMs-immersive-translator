"""Save official Lean reference text for individually edited term reviews.

Upstream text remains Apache-2.0; it is not part of the CC0 term dataset.
No scraper output is automatically marked reviewed.
"""
import hashlib
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://lean-lang.org/doc/reference/latest/'
CHAPTERS = [
    'The-Type-System', 'The-Type-System/Functions',
    'The-Type-System/Propositions', 'The-Type-System/Universes',
    'The-Type-System/Inductive-Types', 'The-Type-System/Quotients',
    'Elaboration-and-Compilation', 'Type-Classes',
    'Type-Classes/Instance-Declarations', 'Type-Classes/Instance-Synthesis',
    'Type-Classes/Class-Declarations', 'Tactic-Proofs',
    'The-Simplifier', 'Coercions', 'Namespaces-and-Sections',
    'Definitions/Recursive-Definitions', 'Basic-Types/Tuples',
    'Basic-Propositions/Propositional-Equality', 'Terms/Function-Types',
    'Terms/Function-Application', 'Notations-and-Macros',
]
HEADERS = {'User-Agent': 'AM-Glossary-Audit/0.1 (public-documentation evidence)'}


class MainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_main = False
        self.skip = 0
        self.parts = []
        self.anchors = []

    def handle_starttag(self, tag, attrs):
        if tag == 'main':
            self.in_main = True
        if not self.in_main:
            return
        if tag in ('script', 'style'):
            self.skip += 1
        if dict(attrs).get('id'):
            self.anchors.append(dict(attrs)['id'])
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'li', 'br', 'pre'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag == 'main':
            self.in_main = False
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if self.in_main and not self.skip:
            self.parts.append(data)


def main():
    directory = ROOT / 'data/primary-sources/lean-reference'
    directory.mkdir(parents=True, exist_ok=True)
    license_url = 'https://raw.githubusercontent.com/leanprover/reference-manual/main/LICENSE'
    license_path = directory / 'LICENSE.txt'
    if not license_path.exists():
        with urlopen(Request(license_url, headers=HEADERS), timeout=30) as response:
            license_text = response.read().decode('utf-8')
        if 'Apache License' not in license_text or 'Version 2.0' not in license_text:
            raise ValueError('Unexpected upstream license; do not relabel it as CC0')
        license_path.write_text(license_text)
    for chapter in CHAPTERS:
        url = BASE + chapter + '/'
        path = directory / (chapter.replace('/', '--') + '.json')
        if path.exists():
            old = json.loads(path.read_text())
            if old['sourceUrl'] != url or old['textSha256'] != hashlib.sha256(old['text'].encode()).hexdigest():
                raise ValueError(f'Invalid snapshot: {path}')
            print('cache', chapter, flush=True)
            continue
        with urlopen(Request(url, headers=HEADERS), timeout=30) as response:
            body = response.read()
            resolved = response.geturl()
        parser = MainText()
        parser.feed(body.decode('utf-8'))
        text = '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())
        if len(text) < 100:
            raise ValueError(f'Missing reference content: {url}')
        snapshot = dict(sourceUrl=url, resolvedUrl=resolved,
                        retrievedAt=datetime.now(timezone.utc).isoformat(),
                        author='Lean reference-manual contributors',
                        license='Apache-2.0', licenseUrl=license_url,
                        responseSha256=hashlib.sha256(body).hexdigest(),
                        textSha256=hashlib.sha256(text.encode()).hexdigest(),
                        transformation='HTML main text; scripts/styles omitted; whitespace normalized; content not rewritten',
                        anchors=sorted(set(parser.anchors)), text=text)
        path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
        print('saved', chapter, len(text), flush=True)


if __name__ == '__main__':
    main()
