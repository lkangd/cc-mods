"""Read the fork-probe JSON files of one host run: the SessionStart payload keys per
step, whether $.session.id() inside the hook equals the event's session_id, and the
$.session / $.ui.scroll probe results. Ids are masked by the step's order.
Usage: probe_files.py <host-dir>"""
import glob
import json
import os
import sys

d = sys.argv[1]
for step in sorted(glob.glob(os.path.join(d, "probe-*"))):
    name = os.path.basename(step)
    for f in sorted(glob.glob(os.path.join(step, "classic-start-*.json"))):
        j = json.load(open(f))
        e = j["event"]
        print(name, "classic.SessionStart source=%s" % e.get("source"), "keys=%s" % sorted(e.keys()),
              "| $.session.id() == event.session_id:", j["sessionId"] == e["session_id"])
    for f in sorted(glob.glob(os.path.join(step, "session-start-*.json"))):
        j = json.load(open(f))
        print(name, "session.start keys=%s" % sorted(j["event"].keys()))
    for f in sorted(glob.glob(os.path.join(step, "probe-*.json"))):
        j = json.load(open(f))
        print(name, os.path.basename(f), "turns", j["turns"], "messages", j["messageCount"], "messageKeys", sorted({k for m in j["messageKeys"] for k in m}),
              "scrollPre", j.get("scrollPre"), "scrollPost", j.get("scrollPost"))
