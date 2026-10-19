"""Measures the transcript facts chat-toc 0.2 rests on, over local transcripts.

Reads every main transcript under <config>/projects/*/*.jsonl (subagent files
only where a check needs them) and prints field names, counts and number
distributions, never conversation text. The chain and the Turn groups follow
chat-toc's own rules (hooks/chain.ts, hooks/groups.ts), simplified.

    python3 -I measure.py [--projects ~/.claude/projects] [--json out.json]
"""
import argparse
import collections
import glob
import json
import os
import re
import statistics
import sys
from datetime import datetime

CHAIN_TYPES = {"user", "assistant", "system"}
PATH_KEYS = ("file_path", "notebook_path", "path", "filePath")


def load(path):
    rows = []
    with open(path, errors="replace") as f:
        for line in f:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if isinstance(r, dict):
                rows.append(r)
    return rows


def chain_of(rows):
    by_id, leaf = {}, None
    for r in rows:
        if not isinstance(r.get("uuid"), str) or r.get("isSidechain"):
            continue
        by_id[r["uuid"]] = r
        if r.get("type") in CHAIN_TYPES:
            leaf = r["uuid"]
    back, seen, at = [], set(), leaf
    while at and at not in seen and at in by_id:
        seen.add(at)
        r = by_id[at]
        back.append(r)
        at = r.get("parentUuid") or (r.get("logicalParentUuid") if r.get("subtype") == "compact_boundary" else None)
    return back[::-1]


def blocks(content):
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def text_of(r):
    if r.get("type") == "system":
        return r.get("content") if isinstance(r.get("content"), str) else ""
    c = (r.get("message") or {}).get("content")
    if isinstance(c, str):
        return c
    return "\n".join(b.get("text", "") for b in blocks(c) if b.get("type") == "text")


def is_command(t):
    return bool(re.match(r"^\s*<command-(name|message)>", t)) and "<command-name>" in t


def kind_of(r):
    t = r.get("type")
    if t == "system":
        return "command" if r.get("subtype") == "local_command" and is_command(text_of(r)) else None
    if t != "user" or r.get("isMeta") or r.get("isCompactSummary"):
        return None
    c = (r.get("message") or {}).get("content")
    if any(b.get("type") == "tool_result" for b in blocks(c)):
        return None
    s = text_of(r)
    if re.match(r"^\s*<bash-input>", s):
        return "shell"
    if is_command(s):
        return "command"
    if (r.get("origin") or {}).get("kind") != "human":
        return None
    return "prompt" if s.strip() or any(b.get("type") == "image" for b in blocks(c)) else None


def command_name(r):
    m = re.search(r"<command-name>(.*?)</command-name>", text_of(r))
    return m.group(1).strip() if m else ""


def groups_of(chain):
    groups, cur = [], None
    for r in chain:
        k = kind_of(r)
        if k:
            cur = {"opener": r, "kind": k, "rows": []}
            groups.append(cur)
        if cur:
            cur["rows"].append(r)
    return groups


def ts(r):
    v = r.get("timestamp")
    if not isinstance(v, str):
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return None


def dist(values):
    v = sorted(values)
    if not v:
        return {"n": 0}
    q = lambda p: v[min(len(v) - 1, int(p * len(v)))]
    return {"n": len(v), "min": v[0], "p10": q(0.1), "median": statistics.median(v), "p90": q(0.9), "max": v[-1]}


def is_interruption(r):
    return r.get("type") == "user" and re.match(r"^\s*\[Request interrupted by user", text_of(r) or "") is not None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projects", default=os.path.join(os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude")), "projects"))
    ap.add_argument("--json")
    args = ap.parse_args()
    files = sorted(glob.glob(os.path.join(args.projects, "*", "*.jsonl")))

    out = collections.defaultdict(dict)
    C = collections.defaultdict(collections.Counter)
    N = collections.defaultdict(list)
    biggest = (0, None)

    for path in files:
        rows = load(path)
        chain = chain_of(rows)
        groups = groups_of(chain)
        if len(groups) > biggest[0]:
            biggest = (len(groups), path)
        on_chain = {r.get("uuid") for r in chain}
        C["files"]["main"] += 1
        C["files"]["with groups"] += bool(groups)
        C["rows"]["sidechain rows in main files"] += sum(1 for r in rows if r.get("isSidechain"))

        # ---- compactions
        bounds = [r for r in rows if r.get("subtype") == "compact_boundary"]
        C["compact per file"][len(bounds)] += 1
        index = {r.get("uuid"): i for i, r in enumerate(chain)}
        group_at = {}
        for g in groups:
            for r in g["rows"]:
                group_at[r.get("uuid")] = g
        for b in bounds:
            trig = (b.get("compactMetadata") or {}).get("trigger")
            C["compact"][f"boundaries ({trig})"] += 1
            if b.get("uuid") not in on_chain:
                C["compact"][f"off the chain ({trig})"] += 1
                continue
            C["compact"]["parentUuid null"] += b.get("parentUuid") is None
            C["compact"]["logicalParentUuid set"] += bool(b.get("logicalParentUuid"))
            i = index[b["uuid"]]
            nxt = chain[i + 1] if i + 1 < len(chain) else None
            C["compact"]["next chain row is the summary"] += bool(nxt and nxt.get("isCompactSummary"))
            C["compact"]["summary's parentUuid is the boundary"] += bool(nxt and nxt.get("isCompactSummary") and nxt.get("parentUuid") == b["uuid"])
            if nxt and nxt.get("isCompactSummary"):
                C["compact summary.isVisibleInTranscriptOnly"][str(nxt.get("isVisibleInTranscriptOnly"))] += 1
                C["compact summary.message.content type"][type((nxt.get("message") or {}).get("content")).__name__] += 1
            g = group_at.get(b["uuid"])
            if g is None:
                C["compact place"][f"{trig}: before the first group"] += 1
                continue
            after = g["rows"][g["rows"].index(b) + 1:]
            agent_after = sum(1 for r in after if r.get("type") == "assistant")
            agent_before = sum(1 for r in g["rows"][: g["rows"].index(b)] if r.get("type") == "assistant")
            label = command_name(g["opener"]) if g["kind"] == "command" else g["kind"]
            where = ("agent rows before and after" if agent_before and agent_after else
                     "agent rows after only" if agent_after else
                     "agent rows before only" if agent_before else "no agent rows in the group")
            C["compact place"][f"{trig}: in a group opened by {label}; {where}"] += 1
            N[f"compact preTokens ({trig})"].append((b.get("compactMetadata") or {}).get("preTokens"))
            N[f"compact durationMs ({trig})"].append((b.get("compactMetadata") or {}).get("durationMs"))
            # what the opener of the next group looks like right after a boundary
            if nxt and nxt.get("isCompactSummary"):
                j = i + 2
                while j < len(chain) and chain[j].get("type") not in ("user", "assistant"):
                    j += 1
                if j < len(chain):
                    n2 = chain[j]
                    C["compact: first user/assistant row after the summary"][
                        f"{n2.get('type')}{' opener ' + (kind_of(n2) or '') if kind_of(n2) else ''}{' meta' if n2.get('isMeta') else ''}"] += 1
        on_chain_bounds = [b for b in bounds if b.get("uuid") in on_chain]
        N["compactions on the chain per file with any"].extend([len(on_chain_bounds)] if on_chain_bounds else [])

        # ---- tokens
        for r in chain:
            if r.get("type") != "assistant":
                continue
            m = r.get("message") or {}
            u = m.get("usage")
            C["assistant chain rows"]["with usage" if isinstance(u, dict) else "without usage"] += 1
            if m.get("model") == "<synthetic>":
                C["assistant chain rows"]["model <synthetic>"] += 1
        by_msg = collections.defaultdict(list)
        for r in chain:
            if r.get("type") == "assistant":
                by_msg[(r.get("message") or {}).get("id") or r.get("uuid")].append(r)
        for mid, rs in by_msg.items():
            C["rows per message.id"][min(len(rs), 6)] += 1
            usages = [json.dumps((x.get("message") or {}).get("usage"), sort_keys=True) for x in rs]
            if len(rs) > 1:
                C["repeated message.id: usage across its rows"]["identical" if len(set(usages)) == 1 else "differs"] += 1
                if len(set(usages)) > 1:
                    a, z = (json.loads(usages[0]) or {}), (json.loads(usages[-1]) or {})
                    for k in set(a) | set(z):
                        if a.get(k) != z.get(k):
                            C["repeated message.id: fields that differ first vs last"][k] += 1
            u = (rs[-1].get("message") or {}).get("usage") or {}
            it = u.get("iterations")
            if isinstance(it, list) and len(it) == 1:
                i0 = it[0]
                same = all(i0.get(k) == u.get(k) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
                C["usage.iterations[0] equals the top-level counts"][same] += 1
        # same message.id across files rows not on chain (sidechain)
        for g in groups:
            ids, tot = set(), collections.Counter()
            for r in g["rows"]:
                if r.get("type") != "assistant":
                    continue
                m = r.get("message") or {}
                mid = m.get("id") or r.get("uuid")
                if mid in ids:
                    continue
                ids.add(mid)
                u = m.get("usage") or {}
                for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"):
                    tot[k] += u.get(k) or 0
            if ids:
                N["turn: requests (unique message.id)"].append(len(ids))
                N["turn: output_tokens"].append(tot["output_tokens"])
                N["turn: input_tokens (uncached)"].append(tot["input_tokens"])
                N["turn: cache_read_input_tokens"].append(tot["cache_read_input_tokens"])
                N["turn: cache_creation_input_tokens"].append(tot["cache_creation_input_tokens"])
                N["turn: all four summed"].append(sum(tot.values()))
            # subagents: the Agent tool's result in the main file
            for r in g["rows"]:
                tr = r.get("toolUseResult")
                if isinstance(tr, dict) and "totalTokens" in tr:
                    C["subagent results in the main file"]["with totalTokens"] += 1
                    C["subagent results: usage keys"].update((tr.get("usage") or {}).keys())
                    aid = tr.get("agentId")
                    sub = glob.glob(os.path.join(os.path.splitext(path)[0], "subagents", f"agent-{aid}.jsonl")) if aid else []
                    if sub:
                        srows = load(sub[0])
                        seen, s = set(), collections.Counter()
                        last_in = None
                        for x in srows:
                            if x.get("type") != "assistant":
                                continue
                            m = x.get("message") or {}
                            if m.get("id") in seen:
                                continue
                            seen.add(m.get("id"))
                            u = m.get("usage") or {}
                            for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"):
                                s[k] += u.get(k) or 0
                            last_in = u
                        last_total = sum((last_in or {}).get(k) or 0 for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
                        C["subagent totalTokens vs its file"][
                            "equals the last request's four counts" if tr["totalTokens"] == last_total else
                            "equals the sum over requests" if tr["totalTokens"] == sum(s.values()) else "neither"] += 1
                        C["subagent usage vs its file's last request"][json.dumps(tr.get("usage"), sort_keys=True) == json.dumps(last_in, sort_keys=True)] += 1
                    else:
                        C["subagent totalTokens vs its file"]["no subagent file found"] += 1

        # ---- duration
        for gi, g in enumerate(groups):
            tds = [r for r in g["rows"] if r.get("subtype") == "turn_duration"]
            agent = [r for r in g["rows"] if r.get("type") == "assistant"]
            ending = "interrupted" if any(is_interruption(r) for r in g["rows"]) else ("error" if agent and agent[-1].get("isApiErrorMessage") else "done")
            has_compact = any(r.get("subtype") == "compact_boundary" for r in g["rows"])
            label = f"{g['kind']}{' with agent rows' if agent else ' no agent rows'}, {ending}{', spans a compaction' if has_compact else ''}"
            C["turn_duration rows per group"][f"{label}: {min(len(tds), 2)}"] += 1
            v = g["opener"].get("version") or "?"
            if g["kind"] == "prompt" and agent and ending == "done":
                C["turn_duration present, prompt groups done, by version"][f"{v} {'yes' if tds else 'no'}"] += 1
            t0 = ts(g["opener"])
            for td in tds:
                d = td.get("durationMs")
                if t0 is None or not isinstance(d, (int, float)):
                    continue
                tdt = ts(td)
                last_agent = ts(agent[-1]) if agent else None
                if tdt is not None:
                    N[f"turn_duration.durationMs - (its row time - opener time), ms ({ending})"].append(round(d - (tdt - t0)))
                if last_agent is not None:
                    N[f"turn_duration.durationMs - (last agent row - opener), ms ({ending})"].append(round(d - (last_agent - t0)))
                pos = g["rows"].index(td)
                tail = [r.get("type") + ("/" + r.get("subtype") if r.get("subtype") else "") for r in g["rows"][pos + 1:]]
                C["rows after turn_duration in its group"][", ".join(sorted(set(tail))) or "none"] += 1
                C["turn_duration.messageCount present"][isinstance(td.get("messageCount"), int)] += 1
        # queued prompts: an opener whose parent is not the previous group's last row
        for r in rows:
            if r.get("type") == "queue-operation":
                C["queue-operation"][r.get("operation")] += 1

        # ---- files
        for r in chain:
            if r.get("type") != "assistant":
                continue
            for b in blocks((r.get("message") or {}).get("content")):
                if b.get("type") != "tool_use":
                    continue
                name, inp = b.get("name"), b.get("input") if isinstance(b.get("input"), dict) else {}
                keys = [k for k in PATH_KEYS if isinstance(inp.get(k), str)]
                tool = name if not str(name).startswith("mcp__") else "mcp__*"
                C["tool_use calls"][tool] += 1
                for k in keys:
                    p = inp[k]
                    C["tool_use path field"][f"{tool}.{k} {'absolute' if p.startswith('/') or re.match(r'^[A-Za-z]:[\\\\/]', p) else '~' if p.startswith('~') else 'relative'}"] += 1
                if name == "MultiEdit":
                    C["MultiEdit input keys"].update(inp.keys())

    out["most Turn groups in one file"] = biggest[0]
    for k, v in C.items():
        out["counts"][k] = {str(a): b for a, b in v.most_common()}
    for k, v in N.items():
        out["distributions"][k] = dist([x for x in v if isinstance(x, (int, float))])
    text = json.dumps(out, indent=1, ensure_ascii=False, sort_keys=True)
    if args.json:
        with open(args.json, "w") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    sys.exit(main())
