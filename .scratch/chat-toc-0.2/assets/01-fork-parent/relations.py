"""Read a fork_experiment report.json and print how each produced file relates to
its parent by row uuids, parentUuid chains, logicalParentUuid and forkedFrom.
Usage: relations.py <report.json>"""
import json
import sys

rep = json.load(open(sys.argv[1]))
files = {"P": ("parent", rep["parent"]["rows"], None)}
files["F"] = ("fork-session of P", rep["fork_F"]["rows"], rep["fork_F"]["id"])
if "fork_G" in rep:
    files["G"] = ("fork-session of F", rep["fork_G"]["rows"], rep["fork_G"]["id"])
if "branch_H" in rep:
    files["H"] = ("/branch inside resumed P", rep["branch_H"]["rows"], rep["branch_H"]["id"])


if "branch_H2" in rep:
    files["H2"] = ("/branch inside resumed H", rep["branch_H2"]["rows"], rep["branch_H2"]["id"])
if "fork_I" in rep:
    files["I"] = ("fork-session of H", rep["fork_I"]["rows"], rep["fork_I"]["id"])


def uuids(rows):
    return [r["uuid"] for r in rows if r["uuid"]]


def conv(rows):
    return [r for r in rows if r["type"] in ("user", "assistant", "system", "attachment") and r["uuid"]]


for name, (label, rows, fid) in files.items():
    print(f"\n[{name}] {label}: rows {len(rows)}, rows with uuid {len(uuids(rows))}")
    print("  sessionId distribution:", {("own" if (r['sessionId'] == fid or (fid is None and r['sessionId'])) else r['sessionId']): 0 for r in rows[:0]} or "")
    own = sum(1 for r in rows if r["sessionId"] and (fid is None or r["sessionId"] == fid))
    print(f"  rows with sessionId: {sum(1 for r in rows if r['sessionId'])}, equal to the file's own id: {own}")
    boundary = [r for r in rows if r["subtype"] == "compact_boundary"]
    for b in boundary:
        print("  compact_boundary: parentUuid", b["parentUuid"], "| logicalParentUuid present:", b["logicalParentUuid"] != "<absent>" and b["logicalParentUuid"] is not None)
        print("    logicalParentUuid points at a row of: ", end="")
        where = [n for n, (_, rr, _) in files.items() if b["logicalParentUuid"] in set(uuids(rr))]
        print(where)
    for other, (olabel, orows, oid) in files.items():
        if other == name:
            continue
        shared = set(uuids(rows)) & set(uuids(orows))
        if shared:
            print(f"  shares {len(shared)} row uuids with [{other}]")
    ff = [r for r in rows if r["forkedFrom"] != "<absent>"]
    if ff:
        print(f"  forkedFrom on {len(ff)} rows; names sessions {sorted({f['forkedFrom']['sessionId'] for f in ff})}; "
              f"messageUuid equals the row's own uuid on {sum(1 for f in ff if f['forkedFrom']['messageUuid'] == f['uuid'])}")
        last = ff[-1]
        print("  last forkedFrom row type:", last["type"], "| position among the file's rows:", rows.index(last) + 1, "of", len(rows))

print("\nwhere another known session id appears (file: other id -> row type:key path x count):")
key = rep.get("raw_ref_key", {})
for fid, refs in rep.get("raw_refs", {}).items():
    print(" ", key.get(fid, fid))
    for other, hits in refs.items():
        print("     mentions", key.get(other, other), hits)
