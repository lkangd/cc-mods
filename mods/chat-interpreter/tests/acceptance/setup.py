"""Exercise the marketplace-installed setup skill and both translation routes on a real PTY."""
import argparse
from collections import deque
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

PLUGIN = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN.parent / "chat-toc/tests/acceptance"))
import fake_api
import pty_harness as harness

TOOL = "mcp__chat-interpreter__setup"
SECRET = "synthetic-translator-acceptance"
SAMPLE = "The window is open."
PROMPT = "Close the door."
REPLY = "The door is closed."
FRENCH = {
    SAMPLE: "La fenêtre est ouverte.",
    PROMPT: "Fermez la porte.",
    REPLY: "La porte est fermée.",
}


def tool_result(messages, tool, action=None):
    ids = set()
    results = []
    for message in messages:
        blocks = message.get("content", [])
        for block in blocks if isinstance(blocks, list) else []:
            if block.get("type") == "tool_use" and block["name"] == tool:
                if action is None or block["input"].get("action") == action:
                    ids.add(block["id"])
            if block.get("type") == "tool_result" and block["tool_use_id"] in ids:
                raw = block["content"]
                if isinstance(raw, list):
                    raw = "".join(item["text"] for item in raw if item["type"] == "text")
                if block.get("is_error"):
                    raise AssertionError(f"{tool} {action} failed: {raw}")
                results.append(raw)
    assert results, f"No result for {tool} {action}"
    return json.loads(results[-1]) if tool == TOOL else results[-1]


def show_sample(messages):
    trial = tool_result(messages, TOOL, "trial")
    sample, = trial["samples"]
    return f"{sample['source']} → {sample['translation']} ({sample['target']}). Confirm both in {trial['scope']}?"


class Interview(fake_api.FakeApi):
    def __init__(self):
        super().__init__("unused", "unused")
        self.replies = deque()
        self.messages = []

    def answer(self, handler, body):
        if "/messages" not in handler.path or "count_tokens" in handler.path:
            return super().answer(handler, body)
        self.count += 1
        reply = "Fixture ready."
        if body.get("tools"):
            self.messages = body["messages"]
            if self.replies:
                reply = self.replies.popleft()
        if callable(reply):
            reply = reply(self.messages)
        if isinstance(reply, str):
            block, stop = {"type": "text", "text": reply}, "end_turn"
        else:
            name, arguments = reply
            block = {"type": "tool_use", "id": f"toolu_fixture_{self.count}", "name": name, "input": arguments}
            stop = "tool_use"
        events = fake_api._message([block], stop, self.count)
        if body.get("stream"):
            return handler._send(200, "text/event-stream", fake_api._sse(events))
        message = events[0]["message"] | {"content": [block], "stop_reason": stop}
        handler._send(200, "application/json", json.dumps(message).encode())


class TranslationApi(fake_api.FakeApi):
    def answer(self, handler, body):
        if handler.headers.get("X-Key") != SECRET:
            return handler._send(401, "application/json", b"{}")
        self.requests.append((body.get("text"), body.get("target")))
        if handler.path != "/translate" or body.get("text") not in FRENCH or body.get("target") != "fr":
            return handler._send(400, "application/json", b"{}")
        result = {"data": [{"translation": FRENCH[body["text"]]}]}
        handler._send(200, "application/json", json.dumps(result).encode())


def install(world, host):
    marketplace = world.base / "marketplace"
    manifest = marketplace / ".claude-plugin"
    manifest.mkdir(parents=True)
    shutil.copytree(PLUGIN, marketplace / "chat-interpreter", ignore=shutil.ignore_patterns("build", "__pycache__"))
    (manifest / "marketplace.json").write_text(json.dumps({
        "name": "setup-fixture", "owner": {"name": "Fixture"},
        "plugins": [{"name": "chat-interpreter", "source": "./chat-interpreter"}],
    }))
    for args in (["marketplace", "add", str(marketplace)], ["install", "chat-interpreter@setup-fixture", "--scope", "user"]):
        subprocess.run([host.binary, "plugin", *args], env=world.environment(), cwd=world.project, check=True)
    installed, = (world.config / "plugins/cache/setup-fixture/chat-interpreter").iterdir()
    return installed


def cli_fixture(world):
    program = world.project / "translate"
    program.with_suffix(".json").write_text(json.dumps(FRENCH))
    program.write_text("""#!/usr/bin/env python3
import json, sys
from pathlib import Path
if sys.argv[1:] == ["--help"]:
    print("translate --to LANG reads text from stdin")
    sys.exit(0)
source = sys.stdin.read()
with Path(__file__).with_suffix(".jsonl").open("a") as calls:
    calls.write(json.dumps([source, sys.argv[2]]) + "\\n")
if sys.argv[1:] != ["--to", "fr"]:
    sys.exit(1)
print(json.loads(Path(__file__).with_suffix(".json").read_text())[source])
""")
    program.chmod(0o700)
    return {"kind": "cli", "program": str(program), "args": ["--to", "{{target}}"], "stdin": "{{text}}", "resultPath": []}


def exercise(route, world, host, model, service):
    world.settings({"permissions": {"allow": [TOOL, "Bash(./translate --help)"]}})
    installed = install(world, host)
    key = "sk-ant-api03-synthetic-loopback-only"
    config = world.config / ".claude.json"
    config.write_text(json.dumps(json.loads(config.read_text()) | {
        "customApiKeyResponses": {"approved": [key[-20:]], "rejected": []},
    }))
    term = harness.launch(world, host, env={
        "ANTHROPIC_BASE_URL": model.url, "ANTHROPIC_API_KEY": key, "LC_MESSAGES": "en_US.UTF-8",
    })

    def turn(prompt, calls, reply, visible=None):
        model.replies.extend(calls)
        model.replies.append(reply)
        term.command(prompt)
        expected = visible or reply
        term.wait_for(expected, expected)

    try:
        term.wait_for("Claude Code", "startup")
        turn("/chat-interpreter:setup", [(TOOL, {"action": "status"})], "Which translator do you have?")
        assert tool_result(model.messages, TOOL, "status")["scope"] == "project"
        # Local marketplaces may expand the skill's plugin root to its source or cache.
        helper = next((root / "scripts/provision.py" for root in (world.base / "marketplace/chat-interpreter", installed)
                       if str(root / "scripts/provision.py") in json.dumps(model.messages)), None)
        assert helper and helper.is_file(), "The installed skill must give a usable credential helper path"

        calls = []
        if route == "HTTP":
            connection = {"kind": "http", "url": service.url + "/translate", "credential": {"header": "X-Key", "prefix": ""},
                          "body": {"text": "{{text}}", "target": "{{target}}"}, "resultPath": ["data", 0, "translation"]}
        else:
            connection = cli_fixture(world)
            calls.append(("Bash", {"command": "./translate --help", "description": "Read the local translator usage"}))
        calls.append((TOOL, {"action": "stage", "connection": connection}))
        turn(f"Use my {route} translator for French input and output.", calls, "The candidate is staged.")
        staged = tool_result(model.messages, TOOL, "stage")
        if route == "HTTP":
            assert staged["credentialReady"] is False
            subprocess.run([sys.executable, str(helper), staged["candidateId"],
                            "--from-env", "FIXTURE_KEY"], check=True, env=world.environment(extra={"FIXTURE_KEY": SECRET}))
        else:
            assert "reads text from stdin" in tool_result(model.messages, "Bash")

        trial = {"action": "trial", "scope": "project", "translateInput": True, "outputMode": "automatic", "inputTarget": "fr", "outputTarget": "fr"}
        visible = "The window is open. → La fenêtre est ouverte. (fr). Confirm both in project?"
        turn("Configuration is ready.", [(TOOL, {"action": "status"}), (TOOL, trial)], show_sample, visible)
        assert tool_result(model.messages, TOOL, "status")["credentialReady"] is True
        turn("Yes, enable both.", [(TOOL, {"action": "confirm"})], "Saved the verified connection.")
        assert tool_result(model.messages, TOOL, "confirm") == {"saved": True, "scope": "project"}
        turn(PROMPT, [], REPLY, FRENCH[REPLY])
        assert FRENCH[PROMPT] in fake_api._last_user_text({"messages": model.messages})
        assert SECRET not in json.dumps(model.messages) and SECRET not in term.text()
        session_log, = (world.config / "projects").glob("*/*.jsonl")
        replies = []
        for line in session_log.read_text().splitlines():
            row = json.loads(line)
            if row.get("type") == "assistant":
                replies.extend(b["text"] for b in row["message"]["content"] if b["type"] == "text")
        assert REPLY in replies and FRENCH[REPLY] not in replies, "Stored assistant reply must keep its original text"
        if route == "HTTP":
            requests = service.requests
        else:
            requests = [tuple(json.loads(line)) for line in (world.project / "translate.jsonl").read_text().splitlines()]
        assert requests == [(SAMPLE, "fr"), (PROMPT, "fr"), (REPLY, "fr")], requests
        print(f"PASS {route} / Claude Code {host.version}: one shared trial, confirmed input, translated reply display.")
    except Exception:
        print(term.text().replace(SECRET, "[redacted]"), file=sys.stderr)
        raise
    finally:
        term.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route", choices=("HTTP", "CLI"))
    args = parser.parse_args()
    host = harness.Host()
    for route in [args.route] if args.route else ["HTTP", "CLI"]:
        with TemporaryDirectory() as root, Interview() as model, TranslationApi("unused", "unused") as service:
            exercise(route, harness.World(root=Path(root), token=""), host, model, service)
