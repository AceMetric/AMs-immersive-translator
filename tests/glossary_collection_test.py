"""Collection safety checks run offline; no API calls or LLM output."""
import importlib.util
import io
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


cleaner = module("cleaner", "scripts/clean-glossary.py")
collector = module("collector", "scripts/collect-glossary.py")
lean_collector = module("lean_collector", "scripts/collect-lean-evidence.py")
core_audit = module("core_audit", "scripts/audit-core-evidence.py")


def entity(qid, source="field", zh="域", sense="algebraic structure", types=None, languages=None):
    return {"domain": "math", "qid": qid, "en": {source}, "zh": languages or {("zh", zh)},
            "descriptions": {sense}, "types": set(types or []), "evidence": []}


class CleaningTests(unittest.TestCase):
    def test_selected_entity_snapshot_without_search_label_enters_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = root / 'data/wikidata/core-evidence'
            sources.mkdir(parents=True)
            (root / 'data/core.tsv').write_text('# math\nremainder\t余项\n')
            query = 'offline selected entity fixture'
            snapshot = {'query': query, 'querySha256': hashlib.sha256(query.encode()).hexdigest(),
                        'retrievedAt': 'offline-fixture', 'rows': [
                            {'item': {'value': 'http://www.wikidata.org/entity/Q1'},
                             'en': {'value': 'remainder'}, 'zh': {'value': '余项'},
                             'description': {'value': 'a mathematical series remainder'}}]}
            (sources / 'fixture.json').write_text(json.dumps(snapshot))
            with patch.object(core_audit, 'ROOT', root):
                core_audit.main()
            result = json.loads((root / 'data/glossary-audit/core-evidence.json').read_text())
            self.assertEqual(result['entries'][0]['candidates'][0]['qid'], 'Q1')
            self.assertEqual(result['reviewStatus'], 'source-cross-check-only')
            self.assertFalse((root / 'data/glossary-audit/core-review.json').exists())

    def test_new_source_aliases_enter_evidence_queue_but_properties_and_auto_review_do_not(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data/wikidata/core-evidence').mkdir(parents=True)
            aliases = root / 'data/wikidata/core-aliases'
            aliases.mkdir()
            (root / 'data/core.tsv').write_text('# math\ndifferentiable\t可微的\n')
            snapshot = {'license': 'CC0-1.0', 'responseSha256': 'offline-fixture', 'retrievedAt': 'offline-fixture',
                        'entities': {
                            'Q2': {'labels': {'en': {'value': 'differentiable function'}, 'zh': {'value': '可微函数'}},
                                   'aliases': {'en': [{'value': 'differentiable'}]},
                                   'descriptions': {'en': {'value': 'a mathematical function with derivatives'}}},
                            'P2': {'labels': {'en': {'value': 'differentiable'}, 'zh': {'value': '可微的'}},
                                   'descriptions': {'en': {'value': 'a mathematical property definition'}}}}}
            (aliases / 'fixture.json').write_text(json.dumps(snapshot))
            with patch.object(core_audit, 'ROOT', root):
                core_audit.main()
            result = json.loads((root / 'data/glossary-audit/core-evidence.json').read_text())
            self.assertEqual([c['qid'] for c in result['entries'][0]['candidates']], ['Q2'])
            self.assertEqual(result['reviewStatus'], 'source-cross-check-only')
            self.assertEqual(result['entries'][0]['status'], 'needs-editor-review')
            self.assertFalse((root / 'data/glossary-audit/core-review.json').exists())

    def test_language_preference_and_simplification_do_not_inflate_count(self):
        terms, evidence, rejected, _ = cleaner.clean({("math", "Q1"): entity("Q1", source="group", languages={
            ("zh", "群組"), ("zh-hans", "群"), ("zh-hant", "群")})})
        self.assertEqual(len(terms), 1)
        self.assertEqual(terms[0]["target"], "群")
        self.assertEqual(terms[0]["quality"], "candidate")
        self.assertEqual(evidence[0]["labelLanguage"], "zh-hans")
        self.assertFalse(rejected)
        terms, *_ = cleaner.clean({("math", "Q2"): entity("Q2", zh="線性變換")})
        self.assertEqual(terms[0]["target"], "线性变换")

    def test_indistinguishable_duplicates_merge_but_distinct_senses_survive(self):
        items = {("math", "Q1"): entity("Q1"), ("math", "Q2"): entity("Q2"),
                 ("math", "Q3"): entity("Q3", zh="场", sense="physical field")}
        terms, _, rejected, _ = cleaner.clean(items)
        self.assertEqual(len(terms), 2)
        self.assertEqual(rejected[0]["kept"], "wd-math-Q1")

    def test_same_sense_different_translations_are_quarantined(self):
        terms, _, rejected, _ = cleaner.clean({("math", "Q1"): entity("Q1"), ("math", "Q2"): entity("Q2", zh="场")})
        self.assertFalse(terms)
        self.assertEqual(len(rejected), 2)

    def test_people_publications_and_editor_confirmed_errors_are_rejected(self):
        items = {("math", "Q1"): entity("Q1", types=["Q5"]),
                 ("math", "Q2"): entity("Q2", sense="scientific article published in 2025"),
                 ("math", "Q3"): entity("Q3", source="closed graph theorem", zh="稠定线性算子")}
        terms, _, rejected, _ = cleaner.clean(items, [{"domain": "math", "source": "closed graph theorem",
                                                     "target": "稠定线性算子", "reason": "different concepts"}])
        self.assertFalse(terms)
        self.assertEqual(len(rejected), 3)


class CacheTests(unittest.TestCase):
    def test_primary_reference_keeps_code_and_math_without_navigation_or_scripts(self):
        parser = lean_collector.MainText()
        parser.feed('''<nav id="navigation">unrelated universe</nav>
            <main><h1 id="universes">Universes</h1>
            <p>Sort <code>u</code> and Type <code>u</code> &amp; levels.</p>
            <pre id="example">#check ∀ (α : Type u), α → α</pre>
            <style>.fake {content: "wrong definition"}</style>
            <script>const fake = "wrong meaning";</script></main>
            <footer>outside main</footer>''')
        text = ''.join(parser.parts)
        self.assertIn('Sort u and Type u & levels.', text)
        self.assertIn('#check ∀ (α : Type u), α → α', text)
        self.assertEqual(parser.anchors, ['universes', 'example'])
        for excluded in ('unrelated universe', 'wrong definition', 'wrong meaning', 'outside main'):
            self.assertNotIn(excluded, text)

    def test_truncated_json_is_not_saved_as_an_empty_source(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(collector.time, "sleep"):
            path = Path(directory) / "snapshot.json"
            with patch.object(collector.urllib.request, "urlopen", return_value=io.BytesIO(b'{"results":')):
                with self.assertRaises(json.JSONDecodeError):
                    collector.request_snapshot("query", path, {"name": "test"}, retries=0)
            self.assertFalse(path.exists())

    def test_successful_empty_response_is_cached_and_reused(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(collector.time, "sleep"):
            path = Path(directory) / "snapshot.json"
            with patch.object(collector.urllib.request, "urlopen", return_value=io.BytesIO(b'{"results":{"bindings":[]}}')) as call:
                collector.request_snapshot("query", path, {"name": "test"}, retries=0)
                saved = collector.request_snapshot("query", path, {"name": "test"}, retries=0)
                self.assertEqual(call.call_count, 1)
                self.assertEqual(saved["rows"], [])

    def test_rate_limit_retry_after_is_honored_without_caching_error(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(collector.time, "sleep") as sleep:
            path = Path(directory) / "snapshot.json"
            error = urllib.error.HTTPError("url", 429, "rate limited", {"Retry-After": "90"}, None)
            with patch.object(collector.urllib.request, "urlopen", side_effect=[error, io.BytesIO(b'{"results":{"bindings":[]}}')]):
                collector.request_snapshot("query", path, {"name": "test"}, retries=1)
            self.assertEqual(sleep.call_args_list[0].args[0], 90)
            self.assertEqual(json.loads(path.read_text())["rows"], [])


if __name__ == "__main__":
    unittest.main()
