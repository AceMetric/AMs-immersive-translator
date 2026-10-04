"""Save Wikidata source-search candidates; search hits are never reviews.

Use --query for a specific concept, or --remaining-core to investigate the
unreviewed source words. Select a matching sense before fetching its entity
with collect-core-aliases.py --ids. No glossary is changed by this script.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = 'https://www.wikidata.org/w/api.php'


def search(query, directory):
    parameters = dict(action='wbsearchentities', search=query, language='en',
                      uselang='en', type='item', limit=10, format='json', maxlag=5)
    fingerprint = hashlib.sha256(json.dumps(parameters, sort_keys=True).encode()).hexdigest()
    path = directory / (fingerprint[:16] + '.json')
    if path.exists():
        saved = json.loads(path.read_text())
        if saved['parameters'] != parameters or saved['license'] != 'CC0-1.0':
            raise ValueError(f'Invalid search cache: {path}')
        print('cache', query, flush=True)
        return
    for attempt in range(4):
        try:
            request = Request(ENDPOINT + '?' + urlencode(parameters), headers={
                'User-Agent': 'AM-Academic-Translator/0.1.5 (https://github.com/AceMetric/AMs-immersive-translator)'})
            with urlopen(request, timeout=30) as response:
                raw = response.read()
            data = json.loads(raw)
            if data.get('error', {}).get('code') == 'maxlag':
                if attempt == 3:
                    raise ValueError('Wikidata replication lag; retry this same query later')
                print('replication lag; retry same query after 30 seconds', flush=True)
                time.sleep(30)
                continue
            if 'error' in data or not isinstance(data.get('search'), list):
                raise ValueError(f'Incomplete search response for {query}')
            if any(not re.fullmatch(r'Q[1-9][0-9]*', item.get('id', '')) for item in data['search']):
                raise ValueError('Source search returned a non-item entity')
            saved = dict(endpoint=ENDPOINT, parameters=parameters, license='CC0-1.0',
                         retrievedAt=datetime.now(timezone.utc).isoformat(),
                         responseSha256=hashlib.sha256(raw).hexdigest(),
                         reviewStatus='search-candidates-only', search=data['search'])
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + '\n')
            temp.replace(path)
            print('saved', query, len(data['search']), 'source candidates', flush=True)
            return
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            delay = max(float(error.headers.get('Retry-After', '0')), 2 ** attempt)
            print('temporary service limit; retry same query after', delay, 'seconds', flush=True)
            time.sleep(delay)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--query', action='append', default=[])
    parser.add_argument('--remaining-core', action='store_true')
    args = parser.parse_args()
    queries = args.query
    if args.remaining_core:
        reviews = json.loads((ROOT / 'data/glossary-audit/core-review.json').read_text())['entries']
        checked = {(e['domain'], e['source'], e['target']) for e in reviews}
        evidence = json.loads((ROOT / 'data/glossary-audit/core-evidence.json').read_text())['entries']
        queries += [e['source'] for e in evidence if (e['domain'], e['source'], e['target']) not in checked]
    if not queries:
        parser.error('Provide --query or --remaining-core')
    directory = ROOT / 'data/wikidata/discovery/core-search'
    directory.mkdir(parents=True, exist_ok=True)
    for query in dict.fromkeys(queries):
        search(query, directory)
        time.sleep(.5)


if __name__ == '__main__':
    main()
