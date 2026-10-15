"""Check, on existing transcripts, whether a child file can find its parent from the
fields the host writes: the most common foreign `session_id` among the file's rows
(candidate parent), and the first compact_boundary's logicalParentUuid looked up
across the folder's files. Aggregated counts only, no ids or content.
Usage: scan_fork_children.py <root>"""
import collections
import json
import os
import sys

root = sys.argv[1]
agg = collections.Counter()
detail = []
for dp, dn, fn in os.walk(root):
    if "subagents" in dp:
        continue
    names = [f for f in fn if f.endswith(".jsonl")]
    rows_of = {}

    def rows(f):
        if f not in rows_of:
            out = []
            for line in open(os.path.join(dp, f), encoding="utf-8", errors="replace"):
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if isinstance(o, dict):
                    out.append(o)
            rows_of[f] = out
        return rows_of[f]

    uuid_files = None
    for f in names:
        sid = f[:-6]
        r = rows(f)
        foreign = collections.Counter(o["session_id"] for o in r if "session_id" in o and o["session_id"] != o.get("sessionId", sid))
        if not foreign:
            continue
        agg["child files"] += 1
        cand, n = foreign.most_common(1)[0]
        agg["foreign session_id: distinct count %d" % min(len(foreign), 3)] += 1
        cand_file = cand + ".jsonl"
        in_folder = cand_file in names
        agg["candidate parent file in same folder" if in_folder else "candidate parent file not in folder"] += 1
        # compaction boundary at the start of the file?
        first_boundary = next((i for i, o in enumerate(r) if o.get("subtype") == "compact_boundary"), None)
        first_chain = next((i for i, o in enumerate(r) if o.get("uuid")), None)
        starts_at_boundary = first_boundary is not None and first_chain is not None and first_boundary == first_chain
        agg["file's first chain row is a compact_boundary" if starts_at_boundary else "file's first chain row is not a compact_boundary"] += 1
        if first_boundary is not None:
            lp = r[first_boundary].get("logicalParentUuid")
            if lp:
                if uuid_files is None:
                    uuid_files = collections.defaultdict(set)
                    for g in names:
                        for o in rows(g):
                            if o.get("uuid"):
                                uuid_files[o["uuid"]].add(g)
                holders = uuid_files.get(lp, set()) - {f}
                agg["first boundary's logicalParentUuid: held by %d other file(s)" % min(len(holders), 3)] += 1
                if cand_file in holders:
                    agg["  ...and the candidate parent is among them"] += 1
                if starts_at_boundary:
                    agg["  [starts at boundary] candidate in folder=%s holders=%d" % (in_folder, len(holders))] += 1
                    agg["starts at boundary AND lookup finds candidate"] += int(cand_file in holders)
                    agg["starts at boundary AND lookup finds >1 file"] += int(len(holders) > 1)
        if any("forkedFrom" in o for o in r):
            agg["has forkedFrom"] += 1
for k in sorted(agg):
    print(agg[k], k)
