"""Scan transcript JSONL files and print only field names and counts (never values).
Usage: scan_keys.py <root>"""
import sys, os, json, collections

root = sys.argv[1]
keys = collections.Counter()
fork_keys = collections.Counter()
files_with_fork = []
nfiles = 0
for dp, dn, fn in os.walk(root):
    if "subagents" in dp:
        continue
    for f in fn:
        if not f.endswith(".jsonl"):
            continue
        nfiles += 1
        p = os.path.join(dp, f)
        try:
            for line in open(p, encoding="utf-8", errors="replace"):
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if not isinstance(o, dict):
                    continue
                for k in o:
                    keys[(o.get("type"), k)] += 1
                    kl = k.lower()
                    if "fork" in kl or "parent" in kl or "origin" in kl or "branch" in kl:
                        fork_keys[k] += 1
                        if ("fork" in kl or "branch" in kl) and p not in files_with_fork:
                            files_with_fork.append(p)
        except Exception:
            pass
print("files", nfiles)
print("fork/parent/origin/branch-like keys:", dict(fork_keys))
print("files with fork/branch-like keys:", len(files_with_fork))
for p in files_with_fork[:40]:
    print(p)
print()
bytype = collections.defaultdict(list)
for (t, k), c in keys.items():
    bytype[t].append((k, c))
for t, l in sorted(bytype.items(), key=lambda x: str(x[0])):
    print(t, sorted(l))
