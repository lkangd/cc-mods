"""Shape of one real child file whose rows carry another session's id: where the
child's own-sessionId rows sit and what types they are, which parent rows the
child repeats, and what the parent file's tail looks like. Prints counts and
type names only. Usage: inspect_real_pair.py <dir> <child-id> <parent-id>"""
import json
import os
import sys

d, cid, pid = sys.argv[1:4]


def load(i):
    rows = []
    for line in open(os.path.join(d, i + ".jsonl"), encoding="utf-8", errors="replace"):
        try:
            o = json.loads(line)
        except Exception:
            continue
        if isinstance(o, dict):
            rows.append(o)
    return rows


c, p = load(cid), load(pid)
print("child rows", len(c), "parent rows", len(p))
own = [(i, r.get("type"), r.get("subtype")) for i, r in enumerate(c) if r.get("sessionId") == cid]
print("child own rows (index, type):", own[:60])
pu = [r.get("uuid") for r in p if r.get("uuid")]
pset = set(pu)
shared_idx = [i for i, r in enumerate(c) if r.get("uuid") in pset]
print("child rows sharing uuid with parent: first idx", shared_idx[:1], "last idx", shared_idx[-1:], "count", len(shared_idx))
# position in parent of the first and last shared uuid
pos = {u: i for i, u in enumerate(pu)}
cu = [c[i]["uuid"] for i in shared_idx]
print("parent uuid-row positions of shared rows: min", min(pos[u] for u in cu), "max", max(pos[u] for u in cu), "of", len(pu))
print("order preserved:", [pos[u] for u in cu] == sorted(pos[u] for u in cu))
print("parent tail (type, subtype):", [(r.get("type"), r.get("subtype")) for r in p[-8:]])
print("parent has compact_boundary rows:", sum(1 for r in p if r.get("subtype") == "compact_boundary"))
print("parent first rows (type):", [r.get("type") for r in p[:6]])
print("child first rows (type, own?):", [(r.get("type"), r.get("sessionId") == cid) for r in c[:8]])
print("keys on child's first uuid row that parent's same-uuid row lacks / differs:")
first = next(r for r in c if r.get("uuid") in pset)
orig = next(r for r in p if r.get("uuid") == first["uuid"])
print("  child-only keys", sorted(set(first) - set(orig)), "parent-only keys", sorted(set(orig) - set(first)),
      "changed values for keys", sorted(k for k in first if k in orig and first[k] != orig[k]))
print("child parentUuid==parent's parentUuid for shared rows:",
      sum(1 for i in shared_idx if c[i].get("parentUuid") == next(r for r in p if r.get("uuid") == c[i]["uuid"]).get("parentUuid")), "of", len(shared_idx))
print("timestamps: child first/last shared row vs own first row ordering ok:",
      c[shared_idx[0]].get("timestamp") is not None)
print("worktree-state / relocated / continued-in rows in child:",
      [(r.get("type"), r.get("sessionId") == cid) for r in c if r.get("type") in ("worktree-state", "relocated", "continued-in")])
print("worktree-state / relocated / continued-in rows in parent:",
      [(r.get("type"), r.get("sessionId") == pid) for r in p if r.get("type") in ("worktree-state", "relocated", "continued-in")])
