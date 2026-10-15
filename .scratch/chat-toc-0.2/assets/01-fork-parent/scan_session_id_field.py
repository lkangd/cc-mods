"""In existing transcripts, find rows where the snake_case `session_id` field differs
from `sessionId` (a copy of a row written by another session), and say how many
files, how many such rows, whether the named session's file sits in the same
folder, and which row types carry the field. Counts only. Usage: scan_session_id_field.py <root>"""
import collections
import json
import os
import sys

root = sys.argv[1]
files_with = 0
total_rows = 0
types = collections.Counter()
same_folder = collections.Counter()
rows_with_field = 0
rows_with_field_equal = 0
for dp, dn, fn in os.walk(root):
    if "subagents" in dp:
        continue
    names = {f[:-6] for f in fn if f.endswith(".jsonl")}
    for f in fn:
        if not f.endswith(".jsonl"):
            continue
        sid = f[:-6]
        foreign = collections.Counter()
        for line in open(os.path.join(dp, f), encoding="utf-8", errors="replace"):
            try:
                o = json.loads(line)
            except Exception:
                continue
            if not isinstance(o, dict) or "session_id" not in o:
                continue
            rows_with_field += 1
            if o["session_id"] == o.get("sessionId", sid):
                rows_with_field_equal += 1
                continue
            foreign[o["session_id"]] += 1
            types[o.get("type")] += 1
        if foreign:
            files_with += 1
            total_rows += sum(foreign.values())
            for k in foreign:
                same_folder["file of the named session is in the same folder" if k in names else "not in the same folder"] += 1
print("rows carrying session_id:", rows_with_field, "of which equal to sessionId:", rows_with_field_equal)
print("files with rows whose session_id differs from sessionId:", files_with, "rows:", total_rows)
print("row types:", dict(types))
print("named sessions:", dict(same_folder))
