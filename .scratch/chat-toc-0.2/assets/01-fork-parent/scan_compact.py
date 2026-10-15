"""Count the key sets of compact_boundary rows and compactMetadata objects in
existing transcripts, and check where logicalParentUuid and
compactMetadata.preservedSegment uuids point (same file or not). Field names and
counts only. Usage: scan_compact.py <root>"""
import sys, os, json, collections

root = sys.argv[1]
row_keys = collections.Counter()
meta_keys = collections.Counter()
seg_keys = collections.Counter()
n = 0
lp_in_file = collections.Counter()
for dp, dn, fn in os.walk(root):
    if "subagents" in dp:
        continue
    for f in fn:
        if not f.endswith(".jsonl"):
            continue
        rows = []
        for line in open(os.path.join(dp, f), encoding="utf-8", errors="replace"):
            try:
                o = json.loads(line)
            except Exception:
                continue
            if isinstance(o, dict):
                rows.append(o)
        uuids = {r.get("uuid") for r in rows if r.get("uuid")}
        for i, r in enumerate(rows):
            if r.get("subtype") != "compact_boundary":
                continue
            n += 1
            row_keys[tuple(sorted(r.keys()))] += 1
            m = r.get("compactMetadata") or {}
            meta_keys[tuple(sorted(m.keys()))] += 1
            seg = m.get("preservedSegment")
            if isinstance(seg, dict):
                seg_keys[tuple(sorted(seg.keys()))] += 1
            lp = r.get("logicalParentUuid")
            lp_in_file[("logicalParentUuid in same file" if lp in uuids else "absent from file") if lp else "no logicalParentUuid"] += 1
print("compact_boundary rows:", n)
print("row key sets:")
for k, c in row_keys.most_common():
    print(" ", c, k)
print("compactMetadata key sets:")
for k, c in meta_keys.most_common():
    print(" ", c, k)
print("preservedSegment key sets:", dict(seg_keys))
print("logicalParentUuid:", dict(lp_in_file))
