"""Write a committable copy of a fork_experiment report.json: drop the screen text, mask the
synthetic title the host quotes in its branch notice, keep every structural field.
Usage: sanitize.py <report.json> <out.json>"""
import json
import re
import sys

r = json.load(open(sys.argv[1]))
r.get("cross_cwd", {}).pop("screen_head", None)
for s in r.get("system_content_samples", []):
    s["text"] = re.sub(r'\("[^"]*"\)', '("<title>")', s["text"])
json.dump(r, open(sys.argv[2], "w"), indent=1, ensure_ascii=True)
