#!/usr/bin/env python3
import json, re, sys, argparse, datetime, pathlib, time
from typing import Dict, List, Any
import requests
from bs4 import BeautifulSoup

# --------- CONFIG: adjust if needed ----------
SOS_QUALIFIED_URL = "https://www.sos.ca.gov/elections/ballot-measures/qualified-ballot-measures"
LAO_INDEX_URL     = "https://lao.ca.gov/BallotAnalysis"
OUTPUT_JSON       = "propositions.json"
USER_AGENT        = "CivicLensBot/1.0 (+https://github.com/your-username/civiclens-data)"
# ------------------------------------------------

def load_existing(path: str) -> List[Dict[str, Any]]:
    p = pathlib.Path(path)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[warn] could not parse {path}: {e}")
        return []

def save_json(path: str, rows: List[Dict[str, Any]]) -> None:
    # stable sort: pending first, then newest updated_at desc, then id
    def key(d):
        status_rank = 0 if d.get("status","").lower() == "pending" else 1
        try:
            upd = datetime.datetime.fromisoformat(d.get("updated_at","").replace("Z",""))
        except Exception:
            upd = datetime.datetime.fromtimestamp(0)
        return (status_rank, -int(upd.timestamp()), d.get("id",""))
    rows_sorted = sorted(rows, key=key)
    pathlib.Path(path).write_text(json.dumps(rows_sorted, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[ok] wrote {path} with {len(rows_sorted)} items")

def fetch_html(url: str) -> str:
    print(f"[fetch] {url}")
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
    r.raise_for_status()
    return r.text

def parse_sos_qualified(html: str) -> List[Dict[str, Any]]:
    """
    Very forgiving parser:
    - looks for 'Proposition' or 'Prop' followed by a number
    - captures nearby title text
    - returns list of {id, displayId, official_url}
    """
    soup = BeautifulSoup(html, "lxml")
    # Collect all links and headings that look like "Proposition X" / "Prop X"
    candidates = []
    prop_re = re.compile(r"\b(Proposition|Prop)\s+(\d+)\b", re.I)

    # search links
    for a in soup.find_all("a"):
        text = " ".join(a.get_text(" ").split())
        m = prop_re.search(text or "")
        if m:
            num = m.group(2)
            display = f"Prop {num}"
            url = a.get("href") or ""
            if url and url.startswith("/"):
                # make absolute
                # best-effort base
                url = "https://www.sos.ca.gov" + url
            candidates.append({"num": num, "displayId": display, "official_url": url, "title": text})

    # search headings/paragraphs for titles if not already captured
    for tag in soup.find_all(["h1","h2","h3","h4","p","li"]):
        text = " ".join(tag.get_text(" ").split())
        m = prop_re.search(text or "")
        if m:
            num = m.group(2)
            display = f"Prop {num}"
            # avoid duplicates
            if not any(c["num"] == num for c in candidates):
                candidates.append({"num": num, "displayId": display, "official_url": SOS_QUALIFIED_URL, "title": text})

    # dedupe by prop number
    uniq = {}
    for c in candidates:
        uniq[c["num"]] = c
    out = []
    for num, c in uniq.items():
        out.append({
            "id": f"prop-{num}",
            "displayId": c["displayId"],
            "type": "prop",
            "topics": [],  # you can fill later
            "status": "pending",  # on 'qualified' list => pending by default
            "official_url": c.get("official_url") or SOS_QUALIFIED_URL,
            "full_text_url": c.get("official_url") or SOS_QUALIFIED_URL,
            "one_line": "",  # keep empty; we preserve if exists
            "summary_short_bullets": [],
            "summary_detailed": "",
            "updated_at": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "sources": [{"name":"CA Secretary of State","url": SOS_QUALIFIED_URL}],
        })
    print(f"[parse] sos qualified -> {len(out)} props")
    return out

def parse_lao_index(html: str) -> Dict[str, str]:
    """
    Build map { 'prop-22': 'https://lao.ca.gov/...' }
    by scanning links that contain 'Proposition' + number.
    """
    soup = BeautifulSoup(html, "lxml")
    prop_re = re.compile(r"\b(Proposition|Prop)\s+(\d+)\b", re.I)
    mapping = {}
    for a in soup.find_all("a"):
        text = " ".join(a.get_text(" ").split())
        m = prop_re.search(text or "")
        href = a.get("href") or ""
        if m and href:
            num = m.group(2)
            if href.startswith("/"):
                href = "https://lao.ca.gov" + href
            mapping[f"prop-{num}"] = href
    print(f"[parse] lao index -> {len(mapping)} matches")
    return mapping

def merge(existing: List[Dict[str, Any]], updates: List[Dict[str, Any]], lao_map: Dict[str,str]) -> List[Dict[str, Any]]:
    existing_by_id = {x["id"]: x for x in existing}
    now_iso = datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"

    for u in updates:
        eid = u["id"]
        if eid in existing_by_id:
            cur = existing_by_id[eid]
            # preserve your summaries if they already exist
            for k in ["one_line","summary_short_bullets","summary_detailed","topics","status"]:
                if cur.get(k):
                    u[k] = cur[k]
            # merge sources
            srcs = { (s.get("name"), s.get("url")) for s in cur.get("sources",[]) }
            for s in u.get("sources",[]):
                srcs.add((s.get("name"), s.get("url")))
            # add LAO if found
            lao = lao_map.get(eid)
            if lao:
                srcs.add(("LAO Analysis", lao))
            u["sources"] = [{"name": n, "url": u} for (n,u) in srcs if n and u]
            # keep previous updated_at if summaries unchanged; else bump
            u["updated_at"] = now_iso
            existing_by_id[eid] = u
        else:
            # new item
            lao = lao_map.get(eid)
            if lao:
                u["sources"].append({"name":"LAO Analysis","url": lao})
            existing_by_id[eid] = u

    # keep any old items that didn't show up (e.g., historical)
    for eid, cur in list(existing_by_id.items()):
        if eid not in [u["id"] for u in updates]:
            # just leave as-is
            pass

    return list(existing_by_id.values())

def main():
    ap = argparse.ArgumentParser(description="Update propositions.json from CA SoS and LAO.")
    ap.add_argument("--sos", default=SOS_QUALIFIED_URL, help="SoS 'Qualified statewide ballot measures' URL")
    ap.add_argument("--lao", default=LAO_INDEX_URL, help="LAO ballot analysis index URL")
    ap.add_argument("--out", default=OUTPUT_JSON, help="Output JSON file (propositions.json)")
    ap.add_argument("--dry-run", action="store_true", help="Print summary, don't write file")
    args = ap.parse_args()

    existing = load_existing(args.out)

    sos_html = fetch_html(args.sos)
    sos_items = parse_sos_qualified(sos_html)

    # LAO is optional; failures shouldn't kill the run
    lao_map = {}
    try:
        lao_html = fetch_html(args.lao)
        lao_map = parse_lao_index(lao_html)
    except Exception as e:
        print(f"[warn] LAO fetch failed: {e}")

    merged = merge(existing, sos_items, lao_map)

    if args.dry_run:
        print(json.dumps(merged[:5], indent=2)[:2000])
        print(f"[dry-run] would write {len(merged)} items to {args.out}")
        return

    save_json(args.out, merged)

if __name__ == "__main__":
    main()

