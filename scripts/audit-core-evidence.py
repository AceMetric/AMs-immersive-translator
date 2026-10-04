"""Produce a per-term evidence queue. Equality is evidence, not expert review."""
import hashlib
import importlib.util
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cleaner", ROOT / "scripts/clean-glossary.py")
cleaner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleaner)
DOMAIN_KEYWORDS = {
    "math": ("math", "algebra", "set", "topolog", "geometr", "logic", "theorem", "function", "number", "calculus", "categor", "proof", "polynomial", "vector", "matrix", "statistic", "probabil", "graph theory"),
    "physics": ("physic", "energy", "force", "quantum", "particle", "electr", "magnet", "thermo", "wave", "motion", "optical", "optics", "momentum", "light", "mechanic", "radiat", "relativ", "fluid", "mass", "accelerat"),
    "cs": ("comput", "program", "software", "algorithm", "data", "network", "memory", "operating system", "processor", "compiler", "crypt", "machine learning", "artificial intelligence", "internet", "neural", "language model"),
}


def main():
    converter = OpenCC("t2s")
    entities = {}
    matches = defaultdict(set)
    snapshots = []
    for path in sorted((ROOT / "data/wikidata/core-evidence").glob("*.json")):
        data = json.loads(path.read_text())
        if hashlib.sha256(data["query"].encode()).hexdigest() != data["querySha256"]:
            raise ValueError(f"Invalid evidence checksum: {path}")
        snapshots.append({"file": path.relative_to(ROOT).as_posix(), "querySha256": data["querySha256"],
                          "retrievedAt": data["retrievedAt"]})
        for row in data["rows"]:
            qid = row["item"]["value"].rsplit("/", 1)[-1]
            if not re.fullmatch(r"Q[1-9][0-9]*", qid):
                continue
            item = entities.setdefault(qid, {"labels": set(), "zh": set(), "descriptions": set(), "types": set(), "snapshots": set()})
            # Explicit entity snapshots have en labels but no search matchedLabel.
            for field in ("matchedLabel", "en"):
                if row.get(field):
                    matches[row[field]["value"].casefold()].add(qid)
            for field, output in (("en", "labels"), ("zh", "zh"), ("description", "descriptions")):
                if row.get(field):
                    item[output].add(row[field]["value"])
            if row.get("kind"):
                item["types"].add(row["kind"]["value"].rsplit("/", 1)[-1])
            item["snapshots"].add(path.relative_to(ROOT).as_posix())
    for path in sorted((ROOT / "data/wikidata/core-aliases").glob("*.json")):
        data = json.loads(path.read_text())
        if data.get("license") != "CC0-1.0":
            raise ValueError(f"Missing alias data license: {path}")
        snapshots.append({"file": path.relative_to(ROOT).as_posix(), "responseSha256": data["responseSha256"],
                          "retrievedAt": data["retrievedAt"]})
        for qid, entity in data["entities"].items():
            if not re.fullmatch(r"Q[1-9][0-9]*", qid):
                continue
            item = entities.setdefault(qid, {"labels": set(), "zh": set(), "descriptions": set(), "types": set(), "snapshots": set()})
            labels = entity.get('labels', {})
            english = {value['value'] for lang, value in labels.items() if lang == 'en'}
            english.update(alias['value'] for alias in entity.get('aliases', {}).get('en', []))
            item['labels'].update(english)
            for label in english:
                matches[label.casefold()].add(qid)
            item['zh'].update(value['value'] for lang, value in labels.items() if lang in ('zh', 'zh-hans', 'zh-cn'))
            description = entity.get('descriptions', {}).get('en', {}).get('value')
            if description:
                item['descriptions'].add(description)
            for claim in entity.get('claims', {}).get('P31', []):
                type_id = claim.get('mainsnak', {}).get('datavalue', {}).get('value', {}).get('id')
                if type_id:
                    item['types'].add(type_id)
            chinese_aliases = [alias["value"] for lang, aliases in entity.get("aliases", {}).items()
                               if lang in ("zh", "zh-hans", "zh-cn") for alias in aliases]
            item.setdefault("zhAliases", set()).update(chinese_aliases)
            item["snapshots"].add(path.relative_to(ROOT).as_posix())
    terms = []
    domain = ""
    for line in (ROOT / "data/core.tsv").read_text().splitlines():
        if line.startswith("# "):
            domain = line[2:]
            continue
        if not line.strip():
            continue
        source, target = line.split("\t")
        candidates = []
        for qid in matches[source.casefold()]:
            item = entities[qid]
            description = " / ".join(sorted(item["descriptions"]))
            if item["types"] & cleaner.EXCLUDED_TYPES.keys() or cleaner.NON_TERM_DESCRIPTION.search(description):
                continue
            agreement = target in {converter.convert(label) for label in item["zh"] | item.get("zhAliases", set())}
            domain_hits = [word for word in DOMAIN_KEYWORDS[domain] if word in description.casefold()]
            candidates.append({"qid": qid, "sourceUrl": f"https://www.wikidata.org/wiki/{qid}",
                               "labels": sorted(item["labels"]), "rawChineseLabels": sorted(item["zh"]),
                               "rawChineseAliases": sorted(item.get("zhAliases", set())),
                               "description": description, "directTypes": sorted(item["types"]),
                               "snapshots": sorted(item["snapshots"]), "exactChineseAgreement": agreement,
                               "domainKeywordEvidence": domain_hits})
        candidates.sort(key=lambda c: (-c["exactChineseAgreement"], -len(c["domainKeywordEvidence"]), c["qid"]))
        supported = any(c["exactChineseAgreement"] and c["domainKeywordEvidence"] for c in candidates)
        terms.append({"domain": domain, "source": source, "target": target,
                      "status": "bilingual-label-and-context-supported" if supported else "needs-editor-review",
                      "candidates": candidates})
    counts = dict(Counter(t["status"] for t in terms))
    directory = ROOT / "data/glossary-audit"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "core-evidence.json").write_text(json.dumps({"version": "2026-10-04", "license": "CC0-1.0",
        "reviewStatus": "source-cross-check-only", "counts": counts, "sourceSnapshots": snapshots,
        "entries": terms}, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(counts, ensure_ascii=False))


if __name__ == "__main__":
    main()
