#!/usr/bin/env bash
# One local request only. This is RSSHub readiness, not production API acceptance.
set -euo pipefail
command -v python3 >/dev/null
task_tmp=$(mktemp)
trap 'rm -f "$task_tmp"' EXIT
curl --fail --silent --show-error --connect-timeout 3 --max-time 12 \
  --max-filesize 2097152 \
  -o "$task_tmp" 'http://127.0.0.1:1200/36kr/newsflashes?limit=5'
python3 - "$task_tmp" <<'PY'
import json, sys, xml.etree.ElementTree as ET
from urllib.parse import urlparse
body = open(sys.argv[1], "rb").read()
if len(body) > 2097152 or b"<!DOCTYPE" in body.upper() or b"<!ENTITY" in body.upper():
    raise SystemExit("STOP: oversize or unsafe XML")
root = ET.fromstring(body)
items = root.findall("./channel/item")
if not items:
    raise SystemExit("STOP: no RSS items")
samples = []
for item in items[:5]:
    title = item.findtext("title", "").strip()
    link = item.findtext("link", "").strip()
    date = item.findtext("pubDate", "").strip()
    parsed = urlparse(link)
    host = (parsed.hostname or "").lower()
    if not title or not date or parsed.scheme not in ("http", "https") or not (host == "36kr.com" or host.endswith(".36kr.com")):
        raise SystemExit("STOP: missing title/date or unexpected publisher link")
    samples.append(dict(title=title, url=link, publishedAt=date))
print(json.dumps(dict(scope="LIGHTHOUSE_LOCAL_RSS_ONLY", bytes=len(body), rawCount=len(items), samples=samples[:3]), ensure_ascii=False, indent=2))
PY
