"""Compare a candidate forked file with the file named by its foreign sessionId:
shared uuids, row order, where the file's own sessionId first appears, compact
boundaries. Prints counts and key names only. Usage: inspect_pair.py <dir> <file-id>"""
import sys, os, json, collections

d, fid = sys.argv[1], sys.argv[2]


def load(sid):
    rows = []
    for line in open(os.path.join(d, sid + ".jsonl"), encoding="utf-8", errors="replace"):
        try:
            o = json.loads(line)
        except Exception:
            continue
        if isinstance(o, dict):
            rows.append(o)
    return rows


a = load(fid)
foreign = collections.Counter(r.get("sessionId") for r in a)
print("sessionId distribution in file:", [(k == fid and "OWN" or "FOREIGN", v) for k, v in foreign.items()])
pid = [k for k in foreign if k != fid and k][0]
b = load(pid)
print("parent rows:", len(b), "child rows:", len(a))
bu = {r.get("uuid") for r in b if r.get("uuid")}
au = [r.get("uuid") for r in a if r.get("uuid")]
print("child uuids:", len(au), "shared with parent:", sum(1 for u in au if u in bu))
print("sequence of (type, ownership, shared) run-lengths in child:")
runs = []
for r in a:
    key = (r.get("type"), "own" if r.get("sessionId") == fid else ("foreign" if r.get("sessionId") else "nosid"),
           r.get("uuid") in bu if r.get("uuid") else None)
    if runs and runs[-1][0] == key:
        runs[-1][1] += 1
    else:
        runs.append([key, 1])
for k, n in runs[:40]:
    print(" ", k, n)
print("... total runs", len(runs))
for name, rows in (("child", a), ("parent", b)):
    cb = [(i, r.get("subtype"), sorted((r.get("compactMetadata") or {}).keys()),
           "logicalParentUuid" in r, r.get("parentUuid") is None) for i, r in enumerate(rows)
          if r.get("subtype") == "compact_boundary"]
    print(name, "compact_boundary rows:", cb)
    print(name, "rows with parentUuid null:", [(i, r.get("type")) for i, r in enumerate(rows) if "parentUuid" in r and r["parentUuid"] is None][:10])
print("child's first row keys:", sorted(a[0].keys()))
print("types in child not in parent (by uuid):", collections.Counter(r.get("type") for r in a if r.get("uuid") and r["uuid"] not in bu))
print("child parentUuid pointing into parent-only uuids but child lacks them:",
      sum(1 for r in a if r.get("parentUuid") and r["parentUuid"] not in set(au)))
