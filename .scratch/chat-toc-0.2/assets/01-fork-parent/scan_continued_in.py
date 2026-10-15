"""For each `continued-in` row in existing transcripts: where it sits in its file,
whether the target session's file exists in the same folder, and whether the two
files share row uuids or the target's rows carry the source's sessionId. Counts
and shapes only. Usage: scan_continued_in.py <root>"""
import sys, os, json

root = sys.argv[1]


def load(p):
    rows = []
    for line in open(p, encoding="utf-8", errors="replace"):
        try:
            o = json.loads(line)
        except Exception:
            continue
        if isinstance(o, dict):
            rows.append(o)
    return rows


for dp, dn, fn in os.walk(root):
    if "subagents" in dp:
        continue
    for f in fn:
        if not f.endswith(".jsonl"):
            continue
        p = os.path.join(dp, f)
        rows = load(p)
        for i, r in enumerate(rows):
            if r.get("type") != "continued-in":
                continue
            tgt = r.get("continuedInSessionId")
            tp = os.path.join(dp, tgt + ".jsonl")
            info = {"file": f[:8], "index_from_end": len(rows) - 1 - i, "keys": sorted(r.keys()), "target_exists": os.path.exists(tp)}
            if info["target_exists"]:
                t = load(tp)
                su = {x.get("uuid") for x in rows if x.get("uuid")}
                tu = [x.get("uuid") for x in t if x.get("uuid")]
                info["target_rows"] = len(t)
                info["shared_uuids"] = sum(1 for u in tu if u in su)
                info["target_rows_with_source_sessionId"] = sum(1 for x in t if x.get("sessionId") == f[:-6])
                info["target_first_types"] = [(x.get("type"), x.get("subtype")) for x in t[:4]]
                info["target_has_forkedFrom"] = any("forkedFrom" in x for x in t)
            print(info)
