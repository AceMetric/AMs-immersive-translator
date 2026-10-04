"""Discover one extra subclass level with retained parent links, never P279*."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("collector", ROOT / "scripts/collect-glossary.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=ROOT / "data/wikidata/branch-plan.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/wikidata/branch-plan-level2.json")
    args = parser.parse_args()
    parents = json.loads(args.plan.read_text())["roots"]
    directory = ROOT / "data/wikidata/discovery"
    directory.mkdir(exist_ok=True)
    roots = {}
    skipped = []
    for domain in ("math", "physics", "cs"):
        members = [p for p in parents if p["domain"] == domain]
        existing = {p["id"] for p in members}
        for start in range(0, len(members), 80):
            batch = members[start:start+80]
            values = " ".join("wd:" + p["id"] for p in batch)
            query = '''SELECT DISTINCT ?parent ?item ?en ?description WHERE {
              hint:Query hint:optimizer "None".
              VALUES ?parent { ''' + values + ''' }
              ?item wdt:P279 ?parent; rdfs:label ?en. FILTER(LANG(?en)="en")
              OPTIONAL { ?item schema:description ?description. FILTER(LANG(?description)="en") }
            }'''
            fingerprint = hashlib.sha256(query.encode()).hexdigest()
            path = directory / f"{domain}-{fingerprint[:12]}.json"
            data = collector.request_snapshot(query, path, {"name": f"discover {domain} {start+1}..{start+len(batch)}",
                                                           "domain": domain, "parents": batch}, retries=1)
            for row in data["rows"]:
                qid = row["item"]["value"].rsplit("/", 1)[-1]
                label = row["en"]["value"]
                parent = row["parent"]["value"].rsplit("/", 1)[-1]
                description = row.get("description", {}).get("value", "")
                reason = None
                if qid in existing:
                    continue
                if qid == "Q1374036":
                    reason = "known corrupted classification"
                elif re.search(r"\b(Wikimedia|disambiguation|scientific article|book by|company|organisation|organization)\b", label+" "+description, re.I):
                    reason = "not a terminology class"
                elif domain == "physics" and re.search(r"\b(biological|cellular|DNA|genetic|organism|species|disease|protein|chemical reaction)\b", label+" "+description, re.I):
                    reason = "outside first physics scope"
                if reason:
                    skipped.append({"domain": domain, "id": qid, "label": label, "parent": parent, "reason": reason})
                    continue
                key = (domain, qid)
                if key in roots:
                    if parent not in roots[key]["parents"]:
                        roots[key]["parents"].append(parent)
                else:
                    roots[key] = {"domain": domain, "id": qid, "label": label, "description": description,
                                  "parents": [parent], "discoverySnapshot": path.relative_to(ROOT).as_posix()}
    plan = {"version": "2026-10-04", "license": "CC0-1.0", "parentPlan": args.plan.relative_to(ROOT).as_posix(),
            "selection": "One additional direct P279 level, with explicit exclusions; source discovery only, not editorial approval.",
            "roots": sorted(roots.values(), key=lambda r: (r["domain"], r["label"].casefold())), "excludedRoots": skipped}
    args.output.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"roots": len(roots), "excluded": len(skipped)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
