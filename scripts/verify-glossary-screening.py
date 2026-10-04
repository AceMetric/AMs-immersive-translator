"""Replay every stored decision without network/OpenCC; reject missing or stale pools."""
import hashlib
import json
from pathlib import Path
from glossary_screening import screen_candidates

ROOT = Path(__file__).resolve().parents[1]


def main():
    audit = json.loads((ROOT / 'data/glossary-audit/candidates.json').read_text())
    pool = json.loads((ROOT / 'data/glossary-audit/candidate-quarantine.json').read_text())
    policy_path = ROOT / 'data/glossary-screening.json'
    policy = json.loads(policy_path.read_text())
    assert audit['screeningPolicySha256'] == hashlib.sha256(policy_path.read_bytes()).hexdigest(), 'Stale screening policy'
    terms = [t for path in (ROOT / 'public/glossaries').glob('extended-*.json') for t in json.loads(path.read_text())['terms']]
    core = [t for path in (ROOT / 'public/glossaries').glob('core-*.json') for t in json.loads(path.read_text())['terms']]
    branches = [r for name in ('branch-plan.json', 'branch-plan-level2.json')
                for r in json.loads((ROOT / 'data/wikidata' / name).read_text())['roots']]
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
