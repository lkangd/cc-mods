"""Print a compact reading of a fork_experiment report.json: per file, row types in
order with the ownership of sessionId, forkedFrom shape, and chain facts.
Usage: summarize.py <report.json>"""
import json
import sys

rep = json.load(open(sys.argv[1]))
print("host", rep["host"])
parent_rows = rep["parent"]["rows"]
puuid = {r["uuid"] for r in parent_rows if r["uuid"]}
print("parent: rows", len(parent_rows), "types", [(r["type"] if r["type"] != "system" else r["subtype"]) for r in parent_rows][:60])
print("parent compact_boundary: ", [(i, r["parentUuid"], r["logicalParentUuid"] is not None) for i, r in enumerate(parent_rows) if r["subtype"] == "compact_boundary"])
print("parent steps:", rep["steps"])


def show(name, key):
    blob = rep.get(key)
    if not blob:
        print(name, "missing")
        return
    rows = blob["rows"]
    fid = blob["id"]
    print(f"\n== {name} file {fid[:8]} rows {len(rows)}")
    seq = []
    for r in rows:
        ff = r["forkedFrom"]
        seq.append((r["type"] if r["type"] != "system" else r["subtype"],
                    "own" if r["sessionId"] == fid else ("none" if r["sessionId"] is None else "other"),
                    "FF" if ff != "<absent>" else "-"))
    print("rows (type, sessionId, forkedFrom):", seq)
    ffs = [r["forkedFrom"] for r in rows if r["forkedFrom"] != "<absent>"]
    print("forkedFrom count", len(ffs), "shapes", {tuple(sorted(f.keys())) for f in ffs})
    print("forkedFrom sessionIds distinct", {f["sessionId"][:8] for f in ffs})
    print("forkedFrom.messageUuid == row uuid:", all(r["forkedFrom"]["messageUuid"] == r["uuid"] for r in rows if r["forkedFrom"] != "<absent>"))
    print("forkedFrom rows' uuids in parent:", sum(1 for r in rows if r["forkedFrom"] != "<absent>" and r["uuid"] in puuid))
    print("compact_boundary rows:", sum(1 for r in rows if r["subtype"] == "compact_boundary"))
    print("isCompactSummary rows:", sum(1 for r in rows if r["isCompactSummary"]))
    first = [r for r in rows if r["uuid"]][:3]
    print("first uuid rows parentUuid:", [r["parentUuid"] if r["parentUuid"] is None else "uuid" for r in first])
    ids = {r["uuid"] for r in rows if r["uuid"]}
    dangling = [r["parentUuid"] for r in rows if r["parentUuid"] not in (None, "<absent>") and r["parentUuid"] not in ids]
    print("rows whose parentUuid is not in this file:", len(dangling))
    print("keys of first forked row:", next((r["keys"] for r in rows if r["forkedFrom"] != "<absent>"), None))
    print("keys of last row:", rows[-1]["keys"], "type", rows[-1]["type"])


show("A fork of P", "fork_F")
show("B fork of F", "fork_G")
show("D /branch of P", "branch_H")
print("\nC resume of F:", {k: v for k, v in rep.get("resume_F", {}).items() if k != "appended"})
print("C appended rows (type, sessionId==F, forkedFrom):",
      [(r["type"], r["sessionId"] == rep["fork_F"]["id"], r["forkedFrom"] != "<absent>") for r in rep.get("resume_F", {}).get("appended", [])])
print("parent after D:", rep.get("parent_after_D"))
print("parent after A rows:", rep.get("parent_after_A_rows"))
