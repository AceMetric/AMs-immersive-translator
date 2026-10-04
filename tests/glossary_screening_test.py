"""Offline regression for domain contamination, false positives and recovery."""
import importlib.util
import json
from pathlib import Path
import unittest
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('screening', ROOT / 'scripts/glossary_screening.py')
screening = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screening)
POLICY = json.loads((ROOT / 'data/glossary-screening.json').read_text())


def term(source, description, domain='math', target='测试'):
    return {'id': 'wd-' + domain + '-Q1', 'source': source, 'target': target,
            'domain': domain, 'definition': description, 'quality': 'candidate'}


def classify(t, roots=(), types=(), branches=(), core=()):
    evidence = [{'id': t['id'], 'sources': [{'root': {'id': qid, 'label': 'fixture'}} for qid in roots],
                 'directTypes': list(types)}]
    kept, accepted, quarantine, rejected, stats = screening.screen_candidates([t], evidence, POLICY, branches, core)
    return 'retain' if kept else 'quarantine' if quarantine else 'exclude'


class ScreeningTests(unittest.TestCase):
    def test_incomplete_description_can_use_typed_bilingual_evidence(self):
        examples = [('Fermat\'s little theorem', '费马小定理', '', 'math', 'Q65943'),
                    ('Cauchy\'s theorem', '柯西定理', 'theorem', 'math', 'Q65943'),
                    ('Andrica\'s conjecture', '安德里卡猜想', 'conjecture', 'math', 'Q319141'),
                    ('Edmonds–Karp algorithm', 'Edmonds–Karp算法', 'algorithm', 'cs', 'Q30503704'),
                    ('Circular Linked List', '循环链表', '', 'cs', 'Q175263')]
        for source, target, description, domain, qid in examples:
            self.assertEqual(classify(term(source, description, domain, target), [qid]), 'retain', source)
        self.assertEqual(classify(term('an old conjecture', '', 'math', '猜想'), ['Q108163']), 'quarantine')
        self.assertEqual(classify(term('a named theorem', '', 'math', '无关译名'), ['Q65943']), 'quarantine')
        self.assertEqual(classify(term('an arbitrary algorithm', '', 'cs', '算法'), ['Q8366']), 'quarantine')
        self.assertEqual(classify(term('copyright algorithm', '', 'cs', '版权判定算法'), ['Q30503704']), 'exclude')

    def test_independent_evidence_cannot_override_translation_or_foreign_conflicts(self):
        t = term('Cauchy\'s theorem', '', target='别人的定理')
        self.assertEqual(classify(t, ['Q65943'], core=[{'domain':'math','source':t['source'],'target':'柯西定理'}]), 'quarantine')
        self.assertEqual(classify(term('a sociological theorem', '', target='社会学定理'), ['Q65943']), 'quarantine')

    def test_algorithm_families_cover_reported_false_negatives_and_related_terms(self):
        examples = [('Aho–Corasick algorithm', 'string searching algorithm', 'cs'),
                    ('Knuth–Morris–Pratt algorithm', 'string searching algorithm', 'cs'),
                    ('baby-step giant-step', 'algorithm for solving the discrete logarithm problem', 'math'),
                    ('baby-step giant-step', 'algorithm for solving the discrete logarithm problem', 'cs'),
                    ('fast Fourier transform', 'divide-and-conquer algorithm to calculate discrete Fourier transforms', 'cs'),
                    ('quickselect', 'selection algorithm', 'cs')]
        for source, definition, domain in examples:
            self.assertEqual(classify(term(source, definition, domain), ['Q8366']), 'retain', source)
        self.assertEqual(classify(term('medical algorithm', 'procedure for treating disease', 'cs'), ['Q8366']), 'quarantine')

    def test_narrow_branch_names_help_but_incidental_metadata_does_not(self):
        branches = [{'domain': 'cs', 'id': 'Q2', 'label': 'exact string-matching algorithm', 'parents': ['Q8366']},
                    {'domain': 'cs', 'id': 'Q3', 'label': 'infrastructure intelligence',
                     'description': 'integration of artificial intelligence', 'parents': ['Q8366']}]
        self.assertEqual(classify(term('matcher', 'finds a pattern exactly', 'cs'), ['Q2'], branches=branches), 'retain')
        self.assertEqual(classify(term('product platform', 'a branded infrastructure platform', 'cs'), ['Q3'], branches=branches), 'quarantine')

    def test_reported_actual_terms_are_shipped_and_bad_meanings_still_quarantined(self):
        shipped = [t for p in (ROOT / 'public/glossaries').glob('extended-*.json') for t in json.loads(p.read_text())['terms']]
        ids = {t['id'] for t in shipped}
        self.assertTrue({'wd-cs-Q402342', 'wd-cs-Q797983', 'wd-math-Q797983'} <= ids)
        self.assertFalse(any('人工智慧' in t['target'] for t in shipped))
        self.assertFalse(any(t['source'] in ['AI-complete', 'Floyd Cycle Detection Algorithm', 'Gerchberg–Saxton algorithm'] for t in shipped))
        pool = json.loads((ROOT / 'data/glossary-audit/candidate-quarantine.json').read_text())
        self.assertEqual(sum(r['term']['source'] == 'AI-complete' for r in pool['quarantined']), 2)

    def test_reported_real_contamination_is_removed_and_recoverable(self):
        pool = json.loads((ROOT / 'data/glossary-audit/candidate-quarantine.json').read_text())
        records = pool['quarantined'] + pool['excluded']
        for qid in ('Q2740637', 'Q22763', 'Q29870196'):
            matches = [r for r in records if r['term']['id'].endswith('-' + qid)]
            self.assertTrue(matches, qid)
            self.assertTrue(all(r['screening']['status'] == 'exclude' and r['provenance']['sources'] for r in matches))
        shipped = [t for p in (ROOT / 'public/glossaries').glob('extended-*.json') for t in json.loads(p.read_text())['terms']]
        self.assertFalse(any(t['id'].endswith(('-Q2740637', '-Q22763', '-Q29870196')) for t in shipped))

    def test_dedicated_concepts_survive_including_plurals_and_computational_games(self):
        self.assertEqual(classify(term('dihedral angle', 'angle between two planes in space')), 'retain')
        self.assertEqual(classify(term('field electron emission', 'emission of electrons induced by an electrostatic field', 'physics')), 'retain')
        self.assertEqual(classify(term('eight queens puzzle', 'mathematical chess problem')), 'retain')
        self.assertEqual(classify(term('quantum linear systems', 'quantum linear algebra algorithm', 'cs')), 'retain')
        self.assertEqual(classify(term('Universal Chess Interface', 'communication protocol for chess software', 'cs'), ['Q132364']), 'retain')

    def test_generic_membership_and_missing_definition_do_not_admit_terms(self):
        self.assertEqual(classify(term('a belief', 'an untested claim'), ['Q108163']), 'quarantine')
        self.assertEqual(classify(term('a procedure', 'algorithm', 'cs'), ['Q8366']), 'quarantine')
        self.assertEqual(classify(term('a named theorem', ''), ['Q65943']), 'quarantine')
        self.assertEqual(classify(term('a named theorem', 'theorem'), ['Q65943']), 'quarantine')

    def test_negative_subject_overrides_trusted_but_incoherent_taxonomy(self):
        self.assertEqual(classify(term('A sharp', 'musical note'), ['Q748349']), 'exclude')
        self.assertEqual(classify(term('programming', 'kind of music production', 'cs'), ['Q188267']), 'quarantine')
        self.assertEqual(classify(term('social acceleration', 'sociological concept', 'physics'), ['Q11376']), 'quarantine')
        self.assertEqual(classify(term('soap film', 'physical law governing soap films', 'physics'), ['Q214070']), 'retain')

    def test_saved_subclass_paths_follow_deny_branch_and_terminate_cycles(self):
        branches = [{'domain': 'cs', 'id': 'Q2', 'parents': ['Q957502']},
                    {'domain': 'math', 'id': 'Q3', 'parents': ['Q4']},
                    {'domain': 'math', 'id': 'Q4', 'parents': ['Q3', 'Q748349']}]
        self.assertEqual(classify(term('a stratagem', 'old way to win a battle', 'cs'), ['Q2'], branches=branches), 'exclude')
        self.assertEqual(classify(term('an algebra', 'an abstract structure'), ['Q3'], branches=branches), 'retain')

    def test_core_translation_conflicts_are_quarantined_without_promoting_quality(self):
        t = term('vector space', 'mathematical structure', target='错误译名')
        core = [{'domain': 'math', 'source': 'vector space', 'target': '向量空间'}]
        self.assertEqual(classify(t, core=core), 'quarantine')
        t['target'] = '向量空间'
        self.assertEqual(classify(t, core=core), 'retain')
        self.assertEqual(t['quality'], 'candidate')


if __name__ == '__main__':
    unittest.main()
