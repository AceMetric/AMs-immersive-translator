"""Save the official Google ML glossary as reference evidence, never auto-review.

The upstream reference remains CC BY 4.0, separate from AM's CC0 term data.
"""
import hashlib
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://developers.google.com/machine-learning/glossary?hl=en'
SOURCE = 'https://developers.google.com/machine-learning/glossary'
NOTICE = 'Creative Commons Attribution 4.0 License'
LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'


class Sections(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.heading = False
        self.sections = []
        self.current = None
        self.all_parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if self.skip:
            return
        if tag == 'h2':
            self.heading = True
            self.current = {'id': dict(attrs).get('id', ''), 'heading': '', 'parts': []}
            self.sections.append(self.current)
        if tag in ('p', 'div', 'li', 'br', 'pre', 'h2', 'h3', 'h4', 'tr'):
            self.all_parts.append('\n')
            if self.current:
                self.current['parts'].append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1
        if tag == 'h2':
            self.heading = False

    def handle_data(self, data):
        if self.skip:
            return
        self.all_parts.append(data)
        if self.current:
            self.current['parts'].append(data)
            if self.heading:
                self.current['heading'] += data


def normalized(parts):
    return '\n'.join(line.strip() for line in ''.join(parts).splitlines() if line.strip())


def main():
    path = ROOT / 'data/primary-sources/google-ml/glossary.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        data = json.loads(path.read_text())
        if data['sourceUrl'] != SOURCE or data['textSha256'] != hashlib.sha256(data['text'].encode()).hexdigest():
            raise ValueError('Invalid source cache')
        print('cache Google ML glossary', len(data['sections']), flush=True)
        return
    request = Request(URL, headers={'User-Agent': 'AM-Glossary-Audit/0.1 (public-documentation evidence)'})
    with urlopen(request, timeout=45) as response:
        raw = response.read()
        resolved = response.geturl()
    parser = Sections()
    parser.feed(raw.decode('utf-8'))
    if NOTICE not in normalized(parser.all_parts):
        raise ValueError('The official license notice is absent; no snapshot was saved')
    sections = [{'id': s['id'], 'heading': s['heading'].strip(), 'text': normalized(s['parts'])}
                for s in parser.sections if s['id'] and s['heading'].strip()]
    if len(sections) < 100:
        raise ValueError('Incomplete glossary response')
    text = '\n\n'.join(s['text'] for s in sections)
    snapshot = dict(sourceUrl=SOURCE, resolvedUrl=resolved,
                    retrievedAt=datetime.now(timezone.utc).isoformat(),
                    author='Google for Developers', license='CC-BY-4.0',
                    licenseUrl=LICENSE_URL, licenseNotice=NOTICE,
                    responseSha256=hashlib.sha256(raw).hexdigest(),
                    textSha256=hashlib.sha256(text.encode()).hexdigest(),
                    transformation='HTML h2 sections; scripts/styles omitted; whitespace normalized; content not rewritten',
                    sections=sections, text=text)
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    (path.parent / 'ATTRIBUTION.md').write_text(
        '# Source attribution\n\nGoogle for Developers, Machine Learning Glossary.\n\n'
        f'Source: {SOURCE}\n\nLicense: [CC BY 4.0]({LICENSE_URL}).\n\n'
        'HTML converted to text with whitespace normalization. This source text is '
        'reference evidence; it is not relicensed as part of the CC0 AM terminology dataset.\n')
    print('saved Google ML glossary', len(sections), flush=True)


if __name__ == '__main__':
    main()
