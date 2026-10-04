"""Clean provenance-backed bilingual candidates without promoting review status."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
LANG_RANK = {"zh-hans": 0, "zh-cn": 1, "zh": 2, "zh-tw": 3, "zh-hant": 4}
# Direct types plus description checks. These are conservative exclusion rules,
# not a claim that Wikidata's taxonomy is complete or professionally reviewed.
EXCLUDED_TYPES = {
    "Q5": "person", "Q43229": "organization", "Q4830453": "business",
    "Q4167410": "disambiguation", "Q4167836": "Wikimedia category",
    "Q13406463": "Wikimedia list", "Q13442814": "scientific article",
    "Q571": "book", "Q11424": "film", "Q5398426": "television series",
    "Q5633421": "scientific journal", "Q134556": "single song",
    "Q8142": "currency", "Q523": "individual star", "Q318": "individual galaxy",
}
NON_TERM_DESCRIPTION = re.compile(
    r"\b(scientific article|research paper|Wikimedia (?:category|disambiguation|list)|"
    r"(?:American|British|Chinese|German|French|Japanese|Canadian|Russian) (?:physicist|mathematician|scientist)|"
    r"(?:software|technology|telecommunications|tech) company|academic journal|"
    r"(?:book|novel|film|song) (?:by|published|released)|"
    r"star (?:in|of the)|galaxy (?:in|located)|asteroid|lunar crater)\b", re.I)
NON_TERM_LABEL = re.compile(r"^(?:Category:|Template:|List of |Wikipedia:|Wikimedia |inferred from |stated in |imported from |[0-9]+(?:st|nd|rd|th) )", re.I)
ADMINISTRATIVE_NUMBER = re.compile(r"\b(?:identification number|identifier for|identifier of|unique number to|number assigned to|street or area|bank account|license plate|postal code|passport number)\b", re.I)
OUTSIDE_PHYSICS = re.compile(r"\b(?:currency|currencies|monetary|banknote|coinage|legal tender|unit of currency|biological process|molecular biology|DNA|RNA|genetic|organism|species|disease|protein|enzyme|chemical reaction|saponification|industrial process used to produce|method of synthesizing|baseball|football|bowling|sports?|physical exercise|martial arts?|musical concept|musical temperament|circulating temperaments)\b", re.I)
COMMON_NUMBER = re.compile(r"^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)$", re.I)


def value(row, key):
    return row.get(key, {}).get("value", "").strip()


def collect(cache_dir):
    entities = {}
    sources = []
    for path in sorted(cache_dir.glob("*.json")):
        data = json.loads(path.read_text())
        if data.get("license") != "CC0-1.0" or not isinstance(data.get("rows"), list):
            raise ValueError(f"Not a successful, licensed collection cache: {path}")
        if hashlib.sha256(data["query"].encode()).hexdigest() != data["querySha256"]:
            raise ValueError(f"Query checksum mismatch: {path}")
        evidence = {"root": data.get("root", {"id": "batch", "label": "verified descendant roots"}), "snapshot": path.relative_to(ROOT).as_posix(),
                    "querySha256": data["querySha256"], "retrievedAt": data["retrievedAt"]}
        unique = set()
        for row in data["rows"]:
            row_evidence = evidence
            if data.get("roots"):
                qid_root = value(row, "root").rsplit("/", 1)[-1]
                root = next((r for r in data["roots"] if r["id"] == qid_root), None)
                if not root:
                    raise ValueError(f"Missing branch evidence for {qid_root}")
                row_evidence = {**evidence, "root": root}
            url = value(row, "item")
            qid = url.rsplit("/", 1)[-1]
            if not re.fullmatch(r"Q[1-9][0-9]*", qid):
                raise ValueError(f"Invalid entity URL: {url}")
            unique.add(qid)
            key = (data["domain"], qid)
            item = entities.setdefault(key, {"domain": key[0], "qid": qid, "en": set(),
                                            "zh": set(), "descriptions": set(), "types": set(), "evidence": []})
            if value(row, "en"):
                item["en"].add(value(row, "en"))
            if value(row, "zh"):
                item["zh"].add((row["zh"].get("xml:lang", "zh"), value(row, "zh")))
            if value(row, "description"):
                item["descriptions"].add(value(row, "description"))
            if value(row, "kind"):
                item["types"].add(value(row, "kind").rsplit("/", 1)[-1])
            if row_evidence not in item["evidence"]:
                item["evidence"].append(row_evidence)
        sources.append({**evidence, "rows": len(data["rows"]), "uniqueEntities": len(unique),
                        "possiblyLimited": len({(value(r, "item"), value(r, "en"), value(r, "zh")) for r in data["rows"]}) >= data["limit"]})
    return entities, sources


def clean(entities, exclusions=None):
    converter = OpenCC("t2s")
    terms = []
    rejected = []
    accepted_evidence = []
    reasons = Counter()
    for key, item in sorted(entities.items()):
        source = sorted(item["en"])[0] if item["en"] else ""
        label = min(item["zh"], key=lambda p: (LANG_RANK.get(p[0], 99), p[1])) if item["zh"] else ("", "")
        target = converter.convert(label[1])
        description = " / ".join(sorted(item["descriptions"]))
        reason = None
        excluded = next((e for e in (exclusions or []) if e["domain"] == item["domain"]
                         and ("qid" not in e or e["qid"] == item["qid"])
                         and ("source" not in e or e["source"].casefold() == source.casefold())
                         and ("target" not in e or e["target"] == target)
                         and e.get("descriptionContains", "").casefold() in description.casefold()), None)
        if excluded:
            reason = "editor-confirmed exclusion: " + excluded["reason"]
        elif not re.search(r"[A-Za-z]", source) or not re.search(r"[\u3400-\u9fff]", target):
            reason = "missing meaningful EN/ZH labels"
        elif len(source) > 100 or len(target) > 60:
            reason = "label too long"
        elif any(c in source + target for c in ("\n", "\r", "⟪", "⟫", "<", ">")):
            reason = "unsafe label"
        elif NON_TERM_LABEL.search(source) or COMMON_NUMBER.fullmatch(source):
            reason = "non-terminological label"
        elif source.casefold() == target.casefold():
            reason = "untranslated label"
        elif item["types"] & EXCLUDED_TYPES.keys():
            reason = "excluded entity type"
        elif NON_TERM_DESCRIPTION.search(description):
            reason = "non-terminological description"
        elif item["domain"] == "math" and ADMINISTRATIVE_NUMBER.search(description):
            reason = "administrative identifier rather than mathematical term"
        elif item["domain"] == "physics" and OUTSIDE_PHYSICS.search(source + " " + description):
            reason = "outside first physics scope"
        if reason:
            reasons[reason] += 1
            rejected.append({"domain": item["domain"], "qid": item["qid"], "source": source,
                             "target": target, "description": description, "reason": reason})
            continue
        term = {"id": f"wd-{item['domain']}-{item['qid']}", "source": source, "target": target,
                "domain": item["domain"], "sense": description or source, "aliases": [],
                "definition": description, "sourceUrl": f"https://www.wikidata.org/wiki/{item['qid']}",
                "sourceNote": "Wikidata 双语结构化标签；分类及清洗依据见 data/glossary-audit/candidates.json；未作专业审校。",
                "license": "CC0-1.0", "quality": "candidate", "enabled": True}
        terms.append(term)
        accepted_evidence.append({"id": term["id"], "originalLabel": label[1], "labelLanguage": label[0],
                                  "normalization": "OpenCC t2s 0.1.7", "directTypes": sorted(item["types"]),
                                  "sources": item["evidence"]})
    # Entities with identical labels and definition are merged rather than
    # counted twice. Different definitions of an English homograph survive.
    grouped = {}
    kept = set()
    for term in sorted(terms, key=lambda t: (t["domain"], t["source"].casefold(), t["id"])):
        identity = (term["domain"], term["source"].casefold(), term["sense"])
        grouped.setdefault(identity, []).append(term)
    unique = []
    for group in grouped.values():
        if len({t["target"] for t in group}) > 1:
            for term in group:
                reasons["conflicting translation with indistinguishable sense"] += 1
                rejected.append({"id": term["id"], "source": term["source"], "target": term["target"],
                                 "reason": "conflicting translation with indistinguishable sense"})
            continue
        primary, *duplicates = group
        unique.append(primary)
        kept.add(primary["id"])
        for term in duplicates:
            reasons["duplicate term/translation/sense"] += 1
            rejected.append({"id": term["id"], "source": term["source"], "reason": "duplicate term/translation/sense",
                             "kept": primary["id"]})
    return unique, [e for e in accepted_evidence if e["id"] in kept], rejected, reasons


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / "data/wikidata/collected")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/glossary-research/preview")
    parser.add_argument("--install-packs", action="store_true", help="Replace built-in candidates only after collection safety gates pass")
    args = parser.parse_args()
    entities, sources = collect(args.cache_dir)
    if not sources:
        parser.error("No successful snapshots; refusing to replace data with empty output")
    exclusions = json.loads((ROOT / "data/glossary-exclusions.json").read_text())["entries"]
    terms, evidence, rejected, reasons = clean(entities, exclusions)
    counts = dict(Counter(t["domain"] for t in terms))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for domain in ("math", "physics", "cs"):
        pack = {"name": f"AM {domain} extended", "version": "2026-10-04", "author": "Wikidata contributors",
                "license": "CC0-1.0", "domain": domain, "review": "分类筛选与格式清洗；未经专业审校，仅作候选。",
                "terms": [t for t in terms if t["domain"] == domain]}
        (args.output_dir / f"extended-{domain}.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
    audit = {"counts": counts, "total": len(terms), "inputDomainEntities": len(entities),
             "rejectionCounts": dict(reasons), "sourceSnapshots": sources,
             "entries": evidence, "rejected": rejected,
             "reviewStatus": "automatic-screening-only", "completeTarget": len(terms) >= 10000}
    (args.output_dir / "candidates.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
    if args.install_packs:
        if len(terms) < 10000 or any(not counts.get(domain) for domain in ("math", "physics", "cs")):
            raise ValueError("Refusing to install an incomplete 10,000-entry, three-domain collection")
        if any(source["possiblyLimited"] for source in sources):
            raise ValueError("Source query reached its limit; paginate before installing")
        directory = ROOT / "data/glossary-audit"
        directory.mkdir(exist_ok=True)
        (directory / "candidates.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
        for domain in ("math", "physics", "cs"):
            source = args.output_dir / f"extended-{domain}.json"
            destination = ROOT / "public/glossaries" / source.name
            destination.write_bytes(source.read_bytes())
        subprocess.run(["node", "scripts/split-glossaries.mjs"], cwd=ROOT, check=True)
        subprocess.run(["node", "scripts/validate-glossary.mjs"], cwd=ROOT, check=True)
    print(json.dumps({"actualCounts": counts, "total": len(terms), "rejected": dict(reasons)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
