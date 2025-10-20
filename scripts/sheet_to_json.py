import csv, json, os, re
from datetime import datetime

CSV_PATH = "tmp/propositions.csv"    # downloaded by the workflow
JSON_PATH = "propositions.json"      # overwrite the root file you already have

REQUIRED_FIELDS = [
  "id","displayId","status","topics","one_line","summary_short_bullets",
  "summary_detailed","official_url","full_text_url","updated_at","cycle",
  "election_date","fiscal_impact","keywords","sources"
]

def split_semis(val):
    return [x.strip() for x in (val or "").split(";") if x.strip()]

def parse_sources(val):
    out = []
    for p in split_semis(val or ""):
        if "|" in p:
            name, url = p.split("|", 1)
            out.append({"name": name.strip(), "url": url.strip()})
    return out

def bullets(val):
    if not val:
        return []
    # keep each line as a bullet row (the leading "-" is okay to keep or omit; your UI can render it)
    return [ln.strip() for ln in val.splitlines() if ln.strip()]

def slugify(s):
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9\-() ]+", "", s)
    s = s.replace(" ", "-")
    return s

def normalize_row(r):
    # minimal validation
    for k in REQUIRED_FIELDS:
        if k not in r:
            raise SystemExit(f"CSV missing required header: {k}")

    rid = (r.get("id") or "").strip()
    if not rid and r.get("displayId"):
        rid = slugify(r["displayId"])

    full_text_url = (r.get("full_text_url") or "").strip()

    return {
        "id": rid,
        "displayId": (r.get("displayId") or "").strip(),
        "type": "prop",
        "topics": split_semis(r.get("topics")),
        "status": (r.get("status") or "").strip(),
        "official_url": (r.get("official_url") or "").strip(),
        # keep empty string if you want your code to fall back to official_url
        "full_text_url": full_text_url,
        "one_line": (r.get("one_line") or "").strip(),
        "summary_short_bullets": bullets(r.get("summary_short_bullets")),
        "summary_detailed": (r.get("summary_detailed") or "").strip(),
        "updated_at": (r.get("updated_at") or "").strip(),
        "cycle": (r.get("cycle") or "").strip(),
        "election_date": (r.get("election_date") or "").strip(),
        "fiscal_impact": (r.get("fiscal_impact") or "").strip(),
        "keywords": split_semis(r.get("keywords")),
        "sources": parse_sources(r.get("sources"))
    }

def parse_date(s):
    if not s:
        return datetime.min
    try:
        return datetime.fromisoformat(s.replace("Z",""))
    except Exception:
        return datetime.min

def main():
    if not os.path.exists(CSV_PATH):
        raise SystemExit(f"Missing {CSV_PATH}")
    rows = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(normalize_row(r))

    # sort by updated_at (desc), then election_date
    rows.sort(key=lambda o: (parse_date(o.get("updated_at")), parse_date(o.get("election_date"))), reverse=True)

    with open(JSON_PATH, "w", encoding="utf-8") as out:
        json.dump(rows, out, ensure_ascii=False, indent=2)
    print(f"Wrote {JSON_PATH} with {len(rows)} records.")

if __name__ == "__main__":
    main()
