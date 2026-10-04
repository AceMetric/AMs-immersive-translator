"""Replay every stored decision without network/OpenCC; reject missing or stale pools."""
import hashlib
import json
from pathlib import Path
from glossary_screening import screen_candidates
from glossary_locale import normalize_region
from glossary_core_reference import core_reference

ROOT = Path(__file__).resolve().parents[1]


def main():
    audit = json.loads((ROOT / 'data/glossary-audit/candidates.json').read_text())
    pool = json.loads((ROOT / 'data/glossary-audit/candidate-quarantine.json').read_text())
    policy_path = ROOT / 'data/glossary-screening.json'
    policy = json.loads(policy_path.read_text())
    assert audit['screeningPolicySha256'] == hashlib.sha256(policy_path.read_bytes()).hexdigest(), 'Stale screening policy'
    locale_path = ROOT / 'data/glossary-locale.json'
    locale_policy = json.loads(locale_path.read_text())
    assert audit['localePolicySha256'] == hashlib.sha256(locale_path.read_bytes()).hexdigest(), 'Stale locale policy'
    terms = [t for path in (ROOT / 'public/glossaries').glob('extended-*.json') for t in json.loads(path.read_text())['terms']]
    core = [t for path in (ROOT / 'public/glossaries').glob('core-*.json') for t in json.loads(path.read_text())['terms']]
    branches = [r for name in ('branch-plan.json', 'branch-plan-level2.json')
                for r in json.loads((ROOT / 'data/wikidata' / name).read_text())['roots']]
    snapshots = {}
    for source in audit['sourceSnapshots']:
        snapshot = json.loads((ROOT / source['snapshot']).read_text())
        rows = {}
        for row in snapshot['rows']:
            qid = row['item']['value'].rsplit('/', 1)[-1]
            rows.setdefault(qid, []).append(row)
        snapshots[source['snapshot']] = (snapshot, rows)
    grouped = [('retain', terms, audit['entries'])]
    for status, field in [('quarantine', 'quarantined'), ('exclude', 'excluded')]:
        grouped.append((status, [r['term'] for r in pool[field]],
                        [{**r['provenance'], 'screening': r['screening']} for r in pool[field]]))
    records = {}; all_terms = []; all_evidence = []
    for status, group, evidence in grouped:
        assert len(group) == len(evidence)
        evidence_by_id = {e['id']: e for e in evidence}
        assert len(evidence_by_id) == len(evidence)
        for term in group:
            item = evidence_by_id[term['id']]
            assert term['id'] == item['id'] and term['quality'] == 'candidate'
            assert term['id'] not in records, 'Duplicate screening ID'
            assert item['screening']['status'] == status
            qid = term['id'].rsplit('-', 1)[-1]
            labels = set(); english = set(); descriptions = set(); types = set()
            assert item['sources'], 'Missing recoverable source evidence'
            for source in item['sources']:
                snapshot, rows = snapshots[source['snapshot']]
                assert snapshot['domain'] == term['domain'] and source['querySha256'] == snapshot['querySha256']
                matching = [row for row in rows.get(qid, [])
                            if row.get('root', {}).get('value', '').rsplit('/', 1)[-1] == source['root']['id']
                            or not row.get('root') and snapshot.get('root', {}).get('id') == source['root']['id']]
                assert matching, 'Source branch does not contain entity'
                for row in matching:
                    if row.get('zh', {}).get('value'):
                        labels.add((row['zh'].get('xml:lang', 'zh'), row['zh']['value'].strip()))
                    if row.get('en', {}).get('value'): english.add(row['en']['value'].strip())
                    if row.get('description', {}).get('value'): descriptions.add(row['description']['value'].strip())
                    if row.get('kind', {}).get('value'): types.add(row['kind']['value'].rsplit('/', 1)[-1])
            assert term['source'] in english and term['definition'] == ' / '.join(sorted(descriptions))
            assert (item['labelLanguage'], item['originalLabel']) in labels, 'Selected label lacks source'
            assert {(x['language'], x['label']) for x in item['availableLabels']} == labels
            assert set(item['directTypes']) == types
            locale = item['locale']
            assert locale['targetLocale'] == 'zh-CN' and locale['policyVersion'] == locale_policy['version']
            target, changes = normalize_region(locale['scriptLabel'], term['source'], term['definition'], term['domain'], locale_policy)
            regional_target = target
            checked = core_reference(term['source'], term['domain'], term['sourceUrl'], core)
            expected_reference = {**checked, 'inputTarget': regional_target} if checked else None
            assert item.get('coreCanonicalization') == expected_reference, 'Stale/mismatched core entity reference'
            assert (checked['target'] if checked else regional_target) == term['target'] and changes == locale['rules'], 'Stale normalization'
            if locale.get('equivalentAlternative'):
                alternative = locale['equivalentAlternative']
                assert (alternative['language'], alternative['originalLabel']) in labels
                target, changes = normalize_region(alternative['scriptLabel'], term['source'], term['definition'], term['domain'], locale_policy)
                assert target == regional_target and changes == alternative['rules'] and changes
            records[term['id']] = item['screening']
            all_terms.append(term); all_evidence.append(item)
    retained, accepted, quarantined, excluded, stats = screen_candidates(all_terms, all_evidence, policy, branches, core)
    assert stats == audit['screening'] == pool['screening'], 'Screening counts/branch audit changed'
    for item in accepted:
        assert item['screening'] == records[item['id']], 'Retained decision changed'
    for record in quarantined + excluded:
        assert record['screening'] == records[record['term']['id']], 'Pool decision changed'
    assert stats['input'] == len(records)
    assert stats['retained'] == audit['total'] == len(terms)
    assert len(terms) + len(quarantined) + len(excluded) == stats['input']
    print(f"Screening replay verified: {len(terms)} shipped; {len(quarantined)} quarantined; {len(excluded)} excluded; all recoverable")


if __name__ == '__main__':
    main()
