"""PROBE helper: synthetic transcripts for ticket 12. gen12.py <cwd> <sid> many|heavy <target_MiB>
many: ~5 KB turns (prompt, 1-3 Bash calls, 4-line reply, every 20th a /tui local command, every 25th a !cmd) until the target size.
heavy: real-shaped turns (~14 tool calls with 1-200 KB results, attachment rows) until the target size."""
import json, os, re, sys, uuid, datetime, random
cwd, sid, kind, mib = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
random.seed(12)
d = os.path.expanduser('~/.claude/projects/' + re.sub(r'[^A-Za-z0-9]', '-', cwd)); os.makedirs(d, exist_ok=True)
p = os.path.join(d, sid + '.jsonl')
t0 = datetime.datetime(2026, 10, 9, 1, 0, 0)
out = open(p, 'w'); size = 0; nrows = 0
parent, k = None, 0
def emit(r):
    global size, nrows
    s = json.dumps(r, ensure_ascii=False) + '\n'; out.write(s); size += len(s.encode()); nrows += 1
def base(typ, chained=True):
    global k, parent
    k += 1; u = str(uuid.uuid4())
    r = {"parentUuid": parent, "isSidechain": False, "type": typ, "uuid": u,
         "timestamp": (t0 + datetime.timedelta(seconds=k * 3)).isoformat() + "Z", "userType": "external",
         "entrypoint": "cli", "cwd": cwd, "sessionId": sid, "version": "2.1.295", "gitBranch": "main"}
    if chained: parent = u
    return r
def asst(content, stop):
    r = base("assistant"); r["requestId"] = "req_" + uuid.uuid4().hex[:20]
    r["message"] = {"model": "claude-haiku-4-5", "id": "msg_" + uuid.uuid4().hex[:20], "type": "message", "role": "assistant",
                    "content": content, "stop_reason": stop, "stop_sequence": None,
                    "usage": {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}
    emit(r); return r
def user(content, human=False):
    u = base("user"); u["message"] = {"role": "user", "content": content}
    if human: u["promptId"] = str(uuid.uuid4()); u["permissionMode"] = "default"; u["origin"] = {"kind": "human"}; u["promptSource"] = "typed"
    emit(u); return u
def sysrow(content):
    r = base("system"); r.update({"subtype": "local_command", "content": content, "level": "info", "isMeta": False}); emit(r)
def attachment(n):
    r = base("attachment"); r["attachment"] = {"type": "nested_memory", "content": "x" * n}; emit(r)
def tool(i, s, result_len):
    tid = "toolu_" + uuid.uuid4().hex[:20]
    a1 = asst([{"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": f"echo module-{i}-{s}", "description": "Print module"}}], "tool_use")
    body = (f"module-{i}-{s} " * (result_len // 16 + 1))[:result_len]
    tr = user([{"type": "tool_result", "content": body, "tool_use_id": tid, "is_error": False}])
    # host rows carry the result twice: in content and in toolUseResult
    tr  # emitted already
    return a1
def reply(i, lines=4):
    body = "\n".join(f"第 {j} 行说明：模块 {i} 的检查结果正常，没有发现需要处理的问题。" for j in range(1, lines + 1))
    asst([{"type": "text", "text": f"T{i:04d} 回复：\n{body}"}], "end_turn")
target = mib * 1048576; i = 0
while size < target:
    if kind == 'many' and i % 20 == 7:
        sysrow("<command-name>/tui</command-name>\n            <command-message>tui</command-message>\n            <command-args></command-args>")
        sysrow(f"<local-command-stdout>T{i:04d} Current renderer: fullscreen</local-command-stdout>")
    elif kind == 'many' and i % 25 == 12:
        user(f"<bash-input>echo T{i:04d}</bash-input>"); user(f"<bash-stdout>T{i:04d}</bash-stdout><bash-stderr></bash-stderr>")
    else:
        user(f"T{i:04d} 用户问题：请检查第 {i} 个模块的状态，\n并说明下一步该做什么。", human=True)
        if kind == 'many':
            for s in range(1 + i % 3): tool(i, s, 40)
        else:
            for s in range(14):
                x = random.random()
                n = random.randint(800, 3000) if x < .7 else random.randint(5000, 20000) if x < .95 else random.randint(50000, 200000)
                tool(i, s, n)
                for _ in range(3): attachment(random.randint(300, 1500))
        reply(i)
    i += 1
out.close()
print(json.dumps({"path": p, "turns": i, "rows": nrows, "bytes": size}))
