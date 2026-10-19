#!/usr/bin/env python3
"""Drives a real Claude Code (isolated world, not logged in) against a local
stand-in for the Messages API that states chosen `usage` figures, with
usage-probe loaded, and keeps what the probe logged plus a field-and-count
digest of the transcript it wrote under OUT/<host version>/.

Steps: a plain turn; a two-step tool turn; an interrupted turn; a prompt
queued during a turn; /compact; a turn after it; a turn reported near the
window's end, then a prompt that triggers auto-compaction.

    drive.py <host: "current" or a version> <out dir> [near-end cache reads]
"""
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "mods/chat-toc/tests/acceptance"))
import fake_api  # noqa: E402
import pty_harness as h  # noqa: E402

FAKE_KEY = "sk-ant-api03-fake-chat-toc-gate-000000000000"
TRIGGER = "USAGE-PROBE-STEPS"
# What the turn "near the window's end" reports as cache reads: argv[3], default 196000.
NEAR = int(sys.argv[3]) if len(sys.argv) > 3 else 196000
SLOW = "USAGE-PROBE-SLOW"


class UsageApi(fake_api.FakeApi):
    """FakeApi whose streamed answers state `self.usage` in message_start
    (input side) and message_delta (output), as the real API does."""

    usage = {"input_tokens": 3, "cache_creation_input_tokens": 2000, "cache_read_input_tokens": 40000, "output_tokens": 250}

    def answer(self, handler, body):
        path = handler.path
        if "/messages" in path and "count_tokens" not in path and body.get("stream"):
            self.count += 1
            n = self.count
            last = fake_api._last_user_text(body)
            record = {"path": path, "tools": len(body.get("tools") or []), "model": body.get("model"), "last": last[:40]}
            self.requests.append(record)
            blocks, stop = [{"type": "text", "text": "ok"}], "end_turn"
            if body.get("tools") and SLOW in last:
                time.sleep(12.0)
            elif body.get("tools") and TRIGGER in last:
                done = fake_api._results_since_trigger(body, TRIGGER)
                time.sleep(2.0)
                if done < 2:
                    blocks, stop = [{"type": "tool_use", "id": f"toolu_fake_{n:04d}", "name": "Read",
                                     "input": {"file_path": self.read_path}}], "tool_use"
                else:
                    blocks = [{"type": "text", "text": "first part"}, {"type": "text", "text": "second part"}]
            u = dict(self.usage)
            events = fake_api._message(blocks, stop, n)
            events[0]["message"]["usage"] = {k: v for k, v in u.items() if k != "output_tokens"} | {"output_tokens": 1}
            for e in events:
                if e["type"] == "message_delta":
                    e["usage"] = {"output_tokens": u["output_tokens"]}
            record["usage"] = u
            try:
                handler._send(200, "text/event-stream", fake_api._sse(events))
            except BrokenPipeError:
                record["broken"] = True
            return
        super().answer(handler, body)


def digest(path: pathlib.Path) -> list[dict]:
    """Each transcript row as type/subtype, ids, timestamp and the numeric
    fields this ticket asks about; no text."""
    out = []
    for line in path.read_text().splitlines():
        r = json.loads(line)
        m = r.get("message") or {}
        c = m.get("content")
        d = {"type": r.get("type"), "subtype": r.get("subtype"), "uuid": (r.get("uuid") or "")[:8],
             "parent": (r.get("parentUuid") or "")[:8], "ts": r.get("timestamp")}
        if r.get("logicalParentUuid"):
            d["logicalParent"] = r["logicalParentUuid"][:8]
        for k in ("isMeta", "isCompactSummary", "durationMs", "messageCount", "compactMetadata", "operation", "origin"):
            if k in r:
                d[k] = {kk: vv for kk, vv in r[k].items() if not isinstance(vv, (dict, list))} if isinstance(r[k], dict) else r[k]
        if m.get("id"):
            d["msg"] = m["id"]
            d["usage"] = {k: v for k, v in (m.get("usage") or {}).items() if isinstance(v, int)}
        if isinstance(c, list):
            d["blocks"] = [b.get("type") for b in c if isinstance(b, dict)]
        elif isinstance(c, str):
            d["textLength"] = len(c)
            d["head"] = c[:24] if c.startswith("<") or c.startswith("USAGE-PROBE") or c.startswith("[Request") else ""
        out.append(d)
    return out


def main():
    host = h.Host(sys.argv[1])
    out = pathlib.Path(sys.argv[2]).resolve() / (host.version + (f"-near{NEAR}" if len(sys.argv) > 3 else ""))
    out.mkdir(parents=True, exist_ok=True)
    log = out / "usage-probe.log"
    log.unlink(missing_ok=True)
    world = h.World(token="")
    cfg = json.loads((world.config / ".claude.json").read_text())
    cfg["customApiKeyResponses"] = {"approved": [FAKE_KEY[-20:]], "rejected": []}
    (world.config / ".claude.json").write_text(json.dumps(cfg))
    (world.project / "notes.txt").write_text("probe notes\n")
    session = "00000000-0000-4000-8000-0000000000aa"
    steps = []

    with UsageApi(TRIGGER, str(world.project / "notes.txt")) as api:
        env = world.environment(extra={"PROBE_LOG": str(log), "ANTHROPIC_BASE_URL": api.url, "ANTHROPIC_API_KEY": FAKE_KEY})
        argv = world.argv(host, [HERE / "usage-probe"], ["--session-id", session, "--debug-file", str(out / "debug.log")])
        t = h.PyteTerminal(argv, env, world.project, 170, 48)

        def mark(label):
            n = len(log.read_text().splitlines()) if log.exists() else 0
            steps.append({"step": label, "at": time.time(), "logLine": n})

        def prompt(text, wait=6.0):
            t.type(text)
            time.sleep(0.4)
            t.key("enter")
            time.sleep(wait)

        try:
            t.wait_for(lambda s: any("─" * 20 in r for r in s.rows()), "the prompt", 40)
            t.settle()
            mark("start")
            t.command("/usageprobe", wait=1.5)
            mark("plain turn")
            prompt("USAGE-PROBE plain", 5)
            t.command("/usageprobe summary", wait=4)
            mark("tool turn (2 Read steps, 2 s per request)")
            prompt(f"{TRIGGER} two steps", 10)
            mark("interrupted turn")
            prompt(f"{SLOW} interrupt me", 3)
            t.key("esc")
            time.sleep(3)
            mark("queued prompt during a slow turn")
            prompt(f"{SLOW} the running one", 2)
            prompt("USAGE-PROBE queued while running", 18)
            mark("/compact")
            t.command("/compact", wait=10)
            t.command("/usageprobe", wait=1.5)
            t.command("/usageprobe turns", wait=1.5)
            mark("turn after /compact")
            prompt("USAGE-PROBE after compact", 5)
            mark("turn near the window's end")
            api.usage = {"input_tokens": 3, "cache_creation_input_tokens": 1000, "cache_read_input_tokens": NEAR, "output_tokens": 250}
            prompt("USAGE-PROBE near the end", 5)
            t.command("/usageprobe summary", wait=4)
            api.usage = {"input_tokens": 3, "cache_creation_input_tokens": 2000, "cache_read_input_tokens": 30000, "output_tokens": 250}
            mark("prompt that may trigger auto-compaction")
            prompt("USAGE-PROBE after the end", 15)
            t.command("/usageprobe", wait=1.5)
            mark("end")
            (out / "screen-end.txt").write_text("\n".join(t.rows()) + "\n")
        finally:
            t.close()
        (out / "requests.json").write_text(json.dumps(api.requests, ensure_ascii=False, indent=1))
    (out / "steps.json").write_text(json.dumps(steps, indent=1))
    tr = world.transcript(session)
    if tr.exists():
        (out / "transcript-digest.json").write_text(json.dumps(digest(tr), ensure_ascii=False, indent=1))
    world.remove()
    print(out)


if __name__ == "__main__":
    main()
