"""Collect exact label/alias evidence for each core term; no automatic promotion."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("collector", ROOT / "scripts/collect-glossary.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=80)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 100:
        parser.error("batch-size must be 1..100")
    terms = []
    domain = ""
    for line in (ROOT / "data/core.tsv").read_text().splitlines():
        if line.startswith("# "):
            domain = line[2:]
        elif line.strip():
            source, target = line.split("\t")
            terms.append({"domain": domain, "source": source, "target": target})
    directory = ROOT / "data/wikidata/core-evidence"
    directory.mkdir(parents=True, exist_ok=True)
    for start in range(0, len(terms), args.batch_size):
        batch = terms[start:start + args.batch_size]
        labels = sorted({label for term in batch for label in (term["source"], term["source"].lower())})
        values = " ".join(json.dumps(label, ensure_ascii=False) + "@en" for label in labels)
        query = '''SELECT DISTINCT ?item ?matchedLabel ?en ?zh ?description ?kind WHERE {
          VALUES ?matchedLabel { ''' + values + ''' }
          ?item (rdfs:label|skos:altLabel) ?matchedLabel.
          FILTER(STRSTARTS(STR(?item), "http://www.wikidata.org/entity/Q"))
          OPTIONAL { ?item rdfs:label ?en. FILTER(LANG(?en)="en") }
          OPTIONAL { ?item rdfs:label ?zh. FILTER(LANG(?zh) IN ("zh-hans","zh-cn","zh")) }
          OPTIONAL { ?item schema:description ?description. FILTER(LANG(?description)="en") }
          OPTIONAL { ?item wdt:P31 ?kind }
        }'''
        fingerprint = hashlib.sha256(query.encode()).hexdigest()
        path = directory / f"core-{start:04d}-{fingerprint[:12]}.json"
        collector.request_snapshot(query, path, {"name": f"core evidence {start+1}..{start+len(batch)}",
                                                "inputTerms": batch}, args.retries)


if __name__ == "__main__":
    main()
