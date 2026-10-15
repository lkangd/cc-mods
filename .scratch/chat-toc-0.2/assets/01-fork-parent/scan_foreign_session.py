"""For each transcript file, count rows whose sessionId differs from the file's name
(a fork copies parent rows verbatim?), and whether those foreign ids exist as files in
the same folder. Prints counts and shapes only, no ids' content beyond a short prefix
count and no row content. Usage: scan_foreign_session.py <root>"""
import sys, os, json, collections

root = sys.argv[1]
summary = []
cont = []
for dp, dn, fn in os.walk(root):
    if "subagents" in dp:
        continue
    names = {f[:-6] for f in fn if f.endswith(".jsonl")}
    for f in fn:
        if not f.endswith(".jsonl"):
            continue
        sid = f[:-6]
        p = os.path.join(dp, f)
        total = 0
        foreign = collections.Counter()
        foreign_types = collections.Counter()
        first_types = []
        first_foreign_index = None
        idx = 0
        for line in open(p, encoding="utf-8", errors="replace"):
            try:
                o = json.loads(line)
            except Exception:
                continue
            if not isinstance(o, dict):
                continue
            idx += 1
            if len(first_types) < 6:
                first_types.append((o.get("type"), o.get("subtype")))
            s = o.get("sessionId")
            total += 1
            if s and s != sid:
                foreign[s] += 1
                foreign_types[o.get("type")] += 1
                if first_foreign_index is None:
                    first_foreign_index = idx
            if o.get("type") == "continued-in":
                cont.append((p, o.get("sessionId") == sid, o.get("continuedInSessionId") in names))
        if foreign:
            summary.append((f, total, sum(foreign.values()), len(foreign),
                            sum(1 for k in foreign if k in names), first_foreign_index,
                            dict(foreign_types), first_types))
print("files with foreign sessionId rows:", len(summary))
for s in summary[:60]:
    print(s)
print("continued-in rows (file, own sid, target in folder):", len(cont))
for c in cont:
    print(os.path.basename(c[0]), c[1], c[2])
