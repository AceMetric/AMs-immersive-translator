"""Fetch Chinese aliases to check translation variants, respecting API backoff."""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import re
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://www.wikidata.org/w/api.php"
UA = "AM-Academic-Translator/0.1.5 (https://github.com/AceMetric/AMs-immersive-translator)"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', nargs='+', help='Explicit source entities selected for editorial review; never auto-promoted')
    args = parser.parse_args()
    if args.ids:
        if any(not re.fullmatch(r'Q[1-9][0-9]*', qid) for qid in args.ids):
            parser.error('Every source entity must be a valid Q ID')
        ids = sorted(set(args.ids))
    else:
        audit = json.loads((ROOT / "data/glossary-audit/core-evidence.json").read_text())
        ids = sorted({c["qid"] for term in audit["entries"] if term["status"] == "needs-editor-review"
                      for c in term["candidates"][:5]})
    directory = ROOT / "data/wikidata/core-aliases"
    directory.mkdir(exist_ok=True)
    known = set()
    for file in directory.glob("*.json"):
        saved = json.loads(file.read_text())
        if saved.get("license") != "CC0-1.0":
            raise ValueError(f"Unlicensed alias snapshot: {file}")
        known.update(saved.get("entities", {}).keys())
    ids = [qid for qid in ids if qid not in known]
    print(f"Check Chinese aliases of {len(ids)} candidate entities", flush=True)
    for start in range(0, len(ids), 50):
        batch = ids[start:start+50]
        key = hashlib.sha256("|".join(batch).encode()).hexdigest()[:12]
        path = directory / f"aliases-{key}.json"
        if path.exists():
            saved = json.loads(path.read_text())
            if all(qid in saved.get("entities", {}) for qid in batch):
                continue
            raise ValueError(f"Incomplete cache: {path}")
        params = {"action": "wbgetentities", "ids": "|".join(batch), "props": "labels|aliases|descriptions|claims",
                  "languages": "en|zh|zh-hans|zh-cn", "format": "json", "maxlag": 5}
        url = ENDPOINT + "?" + urllib.parse.urlencode(params)
        for attempt in range(8):
            delay = 0
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
                with urllib.request.urlopen(req, timeout=30) as response:
                    raw = response.read()
                    if response.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    delay = float(response.headers.get("Retry-After", "0"))
                data = json.loads(raw)
                if data.get("error", {}).get("code") == "maxlag":
                    print(f"API replication lag; wait {max(delay,30):.0f}s before retry", flush=True)
                    time.sleep(max(delay, 30))
                    continue
                if "error" in data or not all(qid in data.get("entities", {}) for qid in batch):
                    raise ValueError(f"API response incomplete: {data.get('error')}")
                saved = {"endpoint": ENDPOINT, "parameters": params, "responseSha256": hashlib.sha256(raw).hexdigest(),
                         "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "license": "CC0-1.0", "entities": data["entities"]}
                temp = path.with_suffix(".tmp")
                temp.write_text(json.dumps(saved, ensure_ascii=False, indent=2) + "\n")
                temp.replace(path)
                print(f"saved aliases {start+len(batch)}/{len(ids)}", flush=True)
                time.sleep(1)
                break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                if isinstance(error, urllib.error.HTTPError):
                    if error.code not in (408, 429, 500, 502, 503, 504):
                        raise
                    delay = float(error.headers.get("Retry-After", "0"))
                    error.close()
                if attempt == 7:
                    raise
                print(f"API retry {attempt+1}: {error}", flush=True)
                time.sleep(max(delay, min(60, 5 * 2**attempt)))
        else:
            raise RuntimeError("Replication lag did not recover; no empty snapshot was written. Rerun to resume.")


if __name__ == "__main__":
    main()
