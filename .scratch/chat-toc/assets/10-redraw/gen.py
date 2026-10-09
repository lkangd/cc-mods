"""Write a synthetic N-turn transcript for `claude --resume`: gen.py <cwd> <n> <sessionId>."""
import json, os, re, sys, uuid, datetime
cwd, n, sid = sys.argv[1], int(sys.argv[2]), sys.argv[3]
d = os.path.expanduser('~/.claude/projects/' + re.sub(r'[^A-Za-z0-9]', '-', cwd)); os.makedirs(d, exist_ok=True)
t0 = datetime.datetime(2026, 10, 9, 1, 0, 0)
rows, parent, k = [], None, 0
def base(typ):
    global k, parent
    k += 1; u = str(uuid.uuid4())
    r = {"parentUuid": parent, "isSidechain": False, "type": typ, "uuid": u,
         "timestamp": (t0 + datetime.timedelta(seconds=k * 7)).isoformat() + "Z", "userType": "external",
         "entrypoint": "cli", "cwd": cwd, "sessionId": sid, "version": "2.1.287", "gitBranch": "main"}
    parent = u; return r
def asst(content, stop):
    r = base("assistant"); r["requestId"] = "req_" + uuid.uuid4().hex[:20]
    r["message"] = {"model": "claude-haiku-4-5", "id": "msg_" + uuid.uuid4().hex[:20], "type": "message", "role": "assistant",
                    "content": content, "stop_reason": stop, "stop_sequence": None,
                    "usage": {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}
    return r
for i in range(n):
    u = base("user"); u["message"] = {"role": "user", "content": f"T{i:03d} 用户问题：请检查第 {i} 个模块的状态，\n并说明下一步该做什么。"}
    u["promptId"] = str(uuid.uuid4()); u["permissionMode"] = "default"; u["origin"] = {"kind": "human"}; u["promptSource"] = "typed"
    rows.append(u)
    tid = "toolu_" + uuid.uuid4().hex[:20]
    a1 = asst([{"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": f"echo module-{i}", "description": "Print module"}}], "tool_use"); rows.append(a1)
    tr = base("user"); tr["message"] = {"role": "user", "content": [{"type": "tool_result", "content": f"module-{i}", "tool_use_id": tid, "is_error": False}]}
    tr["toolUseResult"] = {"stdout": f"module-{i}", "stderr": "", "interrupted": False, "isImage": False}; tr["sourceToolAssistantUUID"] = a1["uuid"]
    rows.append(tr)
    body = "\n".join(f"第 {j} 行说明：模块 {i} 的检查结果正常，没有发现需要处理的问题。" for j in range(1, 5))
    rows.append(asst([{"type": "text", "text": f"T{i:03d} 回复：\n{body}"}], "end_turn"))
p = os.path.join(d, sid + ".jsonl")
with open(p, "w") as f:
    for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(p, len(rows), os.path.getsize(p))
