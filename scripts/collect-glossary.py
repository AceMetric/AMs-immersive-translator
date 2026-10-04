"""Resumable, serial Wikidata collection. A successful empty query is cached;
an error never becomes an empty source. Raw labels remain CC0 candidates.

This collector does not generate translations or declare editorial review.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENDPOINT = "https://query.wikidata.org/sparql"
UA = "AM-Academic-Translator/0.1.5 (https://github.com/AceMetric/AMs-immersive-translator)"
# IDs verified against the structured entity labels before adding a source.
SOURCES = [
    ("math", "Q24034552", "mathematical concept"),
    ("math", "Q246672", "mathematical object"),
    ("math", "Q65943", "theorem"),
    ("math", "Q748349", "mathematical structure"),
    ("physics", "Q33104303", "concept in physics"),
    ("physics", "Q107715", "physical quantity"),
    ("physics", "Q214070", "physical law"),
    ("physics", "Q1293220", "physical phenomenon"),
    ("cs", "Q66747126", "computer science term"),
    ("cs", "Q8366", "algorithm"),
    ("cs", "Q175263", "data structure"),
    ("cs", "Q3435924", "computational problem"),
    ("cs", "Q132364", "communication protocol"),
]


def query_for(qid, limit):
    # Direct indexed statements first. Descendant roots are separately
    # discovered and recorded, rather than an unbounded join with all labels.
    return f'''SELECT DISTINCT ?item ?en ?zh ?description ?kind WHERE {{
      {{ SELECT DISTINCT ?item ?en ?zh WHERE {{
        {{ ?item wdt:P279 wd:{qid} }} UNION {{ ?item wdt:P31 wd:{qid} }} UNION {{ VALUES ?item {{ wd:{qid} }} }}
        ?item rdfs:label ?en, ?zh.
        FILTER(LANG(?en)="en" && LANG(?zh) IN ("zh-hans", "zh-cn", "zh", "zh-tw", "zh-hant"))
        FILTER NOT EXISTS {{ ?item wdt:P31 wd:Q5 }}
      }} LIMIT {limit} }}
      OPTIONAL {{ ?item schema:description ?description. FILTER(LANG(?description)="en") }}
      OPTIONAL {{ ?item wdt:P31 ?kind }}
    }}'''


def branch_query(roots, limit):
    values = " ".join("wd:" + root["id"] for root in roots)
    if any(not re.fullmatch(r"Q[1-9][0-9]*", root["id"]) for root in roots):
        raise ValueError("Invalid branch entity ID")
    return f'''SELECT DISTINCT ?root ?item ?en ?zh ?description ?kind WHERE {{
      hint:Query hint:optimizer "None".
      {{ SELECT DISTINCT ?root ?item ?en ?zh WHERE {{
        {{ VALUES ?root {{ {values} }} ?item wdt:P31 ?root }}
        UNION {{ VALUES ?root {{ {values} }} ?item wdt:P279 ?root }}
        UNION {{ VALUES ?root {{ {values} }} BIND(?root AS ?item) }}
        ?item rdfs:label ?en, ?zh.
        FILTER(LANG(?en)="en" && LANG(?zh) IN ("zh-hans", "zh-cn", "zh", "zh-tw", "zh-hant"))
        FILTER NOT EXISTS {{ ?item wdt:P31 wd:Q5 }}
      }} LIMIT {limit} }}
      OPTIONAL {{ ?item schema:description ?description. FILTER(LANG(?description)="en") }}
      OPTIONAL {{ ?item wdt:P31 ?kind }}
    }}'''


def fetch(domain, qid, label, limit, cache_dir, retries, interval):
    query = query_for(qid, limit)
    fingerprint = hashlib.sha256(query.encode()).hexdigest()
    path = cache_dir / f"{domain}-{qid}-{fingerprint[:12]}.json"
    return request_snapshot(query, path, {"domain": domain, "root": {"id": qid, "label": label}, "limit": limit}, retries, interval)


def request_snapshot(query, path, metadata, retries=2, interval=10):
    fingerprint = hashlib.sha256(query.encode()).hexdigest()
    name = metadata.get("name", str(metadata.get("root", {}).get("label", path.stem)))
    if path.exists():
        saved = json.loads(path.read_text())
        if saved.get("querySha256") != fingerprint or "rows" not in saved:
            raise ValueError(f"Invalid cache: {path}")
        print(f"cache {name}: {len(saved['rows'])} rows", flush=True)
        return saved
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    for attempt in range(retries + 1):
        start = time.monotonic()
        retry_after = 0
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
            with urllib.request.urlopen(req, timeout=90) as response:
                payload = response.read()
            data = json.loads(payload)
            rows = data["results"]["bindings"]
            saved = {"endpoint": ENDPOINT, "query": query, "querySha256": fingerprint,
                     "responseSha256": hashlib.sha256(payload).hexdigest(),
                     "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                     "license": "CC0-1.0", **metadata, "rows": rows}
            temp = path.with_suffix(".tmp")
            temp.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n")
            temp.replace(path)
            elapsed = time.monotonic() - start
            print(f"saved {name}: {len(rows)} rows ({elapsed:.1f}s)", flush=True)
            time.sleep(max(interval, elapsed))
            return saved
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as error:
            if isinstance(error, urllib.error.HTTPError):
                try:
                    retry_after = float(error.headers.get("Retry-After", "0"))
                except ValueError:
                    retry_after = 60
                error.close()
                if error.code not in (408, 429, 500, 502, 503, 504):
                    raise
            print(f"error {name}, attempt {attempt+1}: {type(error).__name__}: {error}", flush=True)
            if attempt == retries:
                raise
            time.sleep(max(retry_after, 65, 15 * 2 ** attempt))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", choices=("math", "physics", "cs"))
    parser.add_argument("--root", help="Collect one verified root ID")
    parser.add_argument("--limit", type=int, default=20000)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--interval", type=float, default=10)
    parser.add_argument("--cache-dir", type=pathlib.Path, default=ROOT / "data/wikidata/collected")
    parser.add_argument("--branch-plan", type=pathlib.Path, help="Verified descendant roots grouped in batches of 20")
    args = parser.parse_args()
    if not 1 <= args.limit <= 50000 or args.interval < 1 or args.retries < 0:
        parser.error("limit must be 1..50000; interval >=1; retries >=0")
    selected = [s for s in SOURCES if (not args.domain or s[0] == args.domain) and (not args.root or s[1] == args.root)]
    if not selected:
        parser.error("No verified source matches the selection")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    failed = []
    if args.branch_plan:
        plan = json.loads(args.branch_plan.read_text())
        for domain in ("math", "physics", "cs"):
            if args.domain and args.domain != domain:
                continue
            roots = [r for r in plan["roots"] if r["domain"] == domain and (not args.root or r["id"] == args.root)]
            for start in range(0, len(roots), 20):
                batch = roots[start:start+20]
                query = branch_query(batch, args.limit)
                fingerprint = hashlib.sha256(query.encode()).hexdigest()
                path = args.cache_dir / f"{domain}-branches-{fingerprint[:12]}.json"
                try:
                    request_snapshot(query, path, {"domain": domain, "roots": batch, "limit": args.limit,
                                                   "name": f"{domain} branches {start+1}..{start+len(batch)}"}, args.retries, args.interval)
                except Exception as error:
                    failed.append({"domain": domain, "batch": start, "error": str(error)})
        print(json.dumps({"failed": failed}, ensure_ascii=False), flush=True)
        if failed:
            raise SystemExit(1)
        return
    for source in selected:
        try:
            fetch(*source, args.limit, args.cache_dir, args.retries, args.interval)
        except Exception as error:
            failed.append({"root": source[1], "error": str(error)})
    print(json.dumps({"selected": len(selected), "failed": failed}, ensure_ascii=False), flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
