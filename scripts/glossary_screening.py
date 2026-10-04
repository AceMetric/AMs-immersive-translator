"""Explainable, offline domain screening; never promotes a term to reviewed."""
from collections import Counter
import re


def screen_candidates(terms, evidence, policy, branches, core_terms=()):
    """Return retained terms/provenance and recoverable exclude/quarantine records.

    Only P279 parent paths saved in the collection plans are followed. Broad
    roots such as proposition/algorithm are intentionally not trusted anchors.
    Positive evidence selects scope, not the correctness of a Chinese label.
    """
    by_id = {e['id']: e for e in evidence}
    index = {(r['domain'], r['id']): r for r in branches}
    core_targets = {}
    for core in core_terms:
        core_targets.setdefault((core['domain'], core['source'].casefold()), set()).add(core['target'])
    excluded = policy['excludedBranches']
    uninformative = set(policy.get('uninformativeDefinitions', []))
    deny_patterns = [re.compile(p, re.I) for p in policy['excludedText']]
    compiled = {d: {
        'anchors': set(v['trustedAnchors']),
        'positive': [re.compile(p, re.I) for p in v['definitionPatterns']],
        'branch': [re.compile(p, re.I) for p in v.get('branchPatterns', [])],
        'foreign': [re.compile(p, re.I) for p in v['foreignPatterns']],
    } for d, v in policy['domains'].items()}

    def ancestry(domain, qid):
        visited = set()
        pending = [qid]
        while pending:
            current = pending.pop()
            if current in visited:
                continue
            visited.add(current)
            pending.extend(index.get((domain, current), {}).get('parents', []))
        return visited

    retained, accepted, quarantined, rejected = [], [], [], []
    branch_counts = Counter()
    for term in terms:
        item = by_id[term['id']]
        domain = term['domain']
        definitions = term.get('definition', '').strip()
        text = term['source'] + ' ' + term['target'] + ' ' + definitions
        rules = compiled[domain]
        roots = item['sources']
        trusted = []
        branch_signals = []
        blocked = set(item.get('directTypes', [])) & excluded.keys()
        for source in roots:
            root = source['root']
            parents = ancestry(domain, root['id'])
            blocked.update(parents & excluded.keys())
            # A trusted path must itself avoid blocked branches.
            if not parents & excluded.keys() and parents & rules['anchors']:
                trusted.append(root['id'])
            metadata = index.get((domain, root['id']), root)
            # Narrow family names, not incidental technical words in a broad
            # branch's description (e.g. marketing "AI infrastructure").
            branch_text = metadata.get('label', '')
            if not parents & excluded.keys():
                for pattern in rules['branch']:
                    match = pattern.search(branch_text)
                    if match:
                        branch_signals.append({'root': root['id'], 'pattern': pattern.pattern, 'match': match.group(0)})
        positive = [p.pattern for p in rules['positive'] if p.search(definitions)]
        foreign = [p.pattern for p in rules['foreign'] if p.search(text)]
        hard = [p.pattern for p in deny_patterns if p.search(text)]
        targets = sorted(core_targets.get((domain, term['source'].casefold()), set()))
        translation_issues = [e['reason'] for e in policy.get('translationReviewEntries', [])
                              if term['id'].endswith('-' + e['qid']) and term['source'] == e['source']]
        if hard:
            status, reason = 'exclude', 'explicit non-academic subject'
        elif blocked and not (trusted or positive or branch_signals):
            status, reason = 'exclude', 'out-of-scope source branch/type'
        elif blocked:
            status, reason = 'quarantine', 'conflicting source branch and domain evidence'
        elif not definitions:
            status, reason = 'quarantine', 'missing definition; scope cannot be established'
        elif definitions.casefold().strip(' .;:') in uninformative:
            status, reason = 'quarantine', 'definition only repeats a generic class; insufficient evidence'
        elif foreign:
            status, reason = 'quarantine', 'foreign subject signal requires review'
        elif translation_issues:
            status, reason = 'quarantine', 'label meaning needs review; locale normalization is insufficient'
        elif not (trusted or positive or branch_signals):
            status, reason = 'quarantine', 'generic taxonomy membership without specific domain evidence'
        elif targets and term['target'] not in targets:
            status, reason = 'quarantine', 'label differs from project-checked core; translation/sense needs review'
        else:
            status, reason = 'retain', 'scoped source path or domain-specific definition'
        decision = {'status': status, 'reason': reason, 'policyVersion': policy['version'],
                    'trustedRoots': sorted(set(trusted)), 'blockedBranches': sorted(blocked),
                    'coreTargets': targets,
                    'branchSignals': branch_signals, 'translationIssues': translation_issues,
                    'definitionMatches': [p.search(definitions).group(0) for p in rules['positive'] if p.search(definitions)],
                    'definitionSignals': positive, 'foreignSignals': foreign, 'exclusionSignals': hard}
        for source in roots:
            root = source['root']
            branch_counts[(domain, root['id'], root['label'], status)] += 1
        if status == 'retain':
            retained.append(term)
            accepted.append({**item, 'screening': decision})
        else:
            record = {'term': term, 'provenance': item, 'screening': decision}
            (quarantined if status == 'quarantine' else rejected).append(record)
    stats = {'policyVersion': policy['version'], 'input': len(terms),
             'retained': len(retained), 'quarantined': len(quarantined), 'excluded': len(rejected),
             'byDomain': {d: {'retained': sum(t['domain'] == d for t in retained),
                             'quarantined': sum(r['term']['domain'] == d for r in quarantined),
                             'excluded': sum(r['term']['domain'] == d for r in rejected)} for d in compiled},
             'reasons': dict(Counter(r['screening']['reason'] for r in quarantined + rejected)),
             'branches': [{'domain': d, 'qid': qid, 'label': label, 'status': status, 'count': count}
                          for (d, qid, label, status), count in sorted(branch_counts.items())]}
    assert len(retained) + len(quarantined) + len(rejected) == len(terms)
    return retained, accepted, quarantined, rejected, stats
