"""Print the cross-cwd result, step file counts and the system rows that name a session id.
Usage: extras.py <report.json>"""
import json
import sys

r = json.load(open(sys.argv[1]))
print("host", r["host"])
print("steps", r["steps"])
print("cross_cwd", r.get("cross_cwd"))
print("parent after A rows", r.get("parent_after_A_rows"), "| parent after D", r.get("parent_after_D"))
for s in r["system_content_samples"]:
    print("system row naming ids:", s["subtype"], s["level"], "|", s["text"][:260])
print("resume of fork F:", {k: v for k, v in r.get("resume_F", {}).items() if k != "appended"})
