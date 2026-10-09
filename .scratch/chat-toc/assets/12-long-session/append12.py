"""PROBE helper: append in-progress turns to a transcript like a live session does.
append12.py <path> <turns> <steps> <gap_s> <log>: per turn a prompt, <steps> tool_use/tool_result pairs, a reply; one row per gap."""
import json, sys, time, uuid, datetime
path, turns, steps, gap, logp = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
last = None
with open(path, 'rb') as f:
    for l in f:
        try: r = json.loads(l)
        except Exception: continue
        if r.get('type') in ('user', 'assistant', 'system') and r.get('uuid'): last = r
parent, sid, cwd = last['uuid'], last['sessionId'], last['cwd']
lg = open(logp, 'w')
def write(r, what):
    global parent
    r.update({"parentUuid": parent, "isSidechain": False, "uuid": str(uuid.uuid4()), "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
              "userType": "external", "entrypoint": "cli", "cwd": cwd, "sessionId": sid, "version": "2.1.295", "gitBranch": "main"})
    parent = r["uuid"]
    with open(path, 'a') as f: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    lg.write(json.dumps({"t": time.time() * 1000, "what": what}) + "\n"); lg.flush()
    time.sleep(gap)
def asst(content):
    return {"type": "assistant", "message": {"id": "msg_" + uuid.uuid4().hex[:20], "role": "assistant", "content": content}}
for t in range(turns):
    write({"type": "user", "message": {"role": "user", "content": f"A{t:02d} 追加的用户问题"}, "origin": {"kind": "human"}, "promptSource": "typed"}, f"prompt{t}")
    for s in range(steps):
        tid = "toolu_" + uuid.uuid4().hex[:20]
        write(asst([{"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": "echo x"}}]), f"tool{t}.{s}")
        write({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "x" * 2000, "tool_use_id": tid}]}}, f"result{t}.{s}")
    write(asst([{"type": "text", "text": f"A{t:02d} 追加的回复"}]), f"reply{t}")
