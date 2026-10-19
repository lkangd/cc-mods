#!/usr/bin/env python3
"""CT-LIFE-007: chat-toc enabled in a session already running, no restart.

    $PY ct_mid_session.py --host 2.1.287 [--host current] [--scenario cli|ui] [--out DIR]

chat-toc is installed from a directory marketplace built in the run
directory and disabled before the session starts, so the host raises
`session.start` alone when it loads (no classic SessionStart, no
`transcript_path`). Either way of enabling it must list the conversation so
far before anything more is submitted:

  cli  a fresh session in a project whose path has CJK, spaces, dots and
       more than 200 characters (the host hashes the folder name), three
       prompts answered by the logged-out host; then `claude plugin enable`
       from outside and `/reload-plugins` inside.
  ui   a session resumed on a synthetic transcript; `/plugin` → Installed →
       Show disabled → chat-toc → Space, then Esc until the menu closes,
       which reloads the plugins by itself.

The Pane must open by itself and match the verifier's reading of the
session's file (the newest .jsonl under the config dir's projects/).
No model call.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402

PLUGIN = pathlib.Path(__file__).resolve().parents[2]
MARKETPLACE = "ctmid"
EMPTY = "本会话还没有对话"
UNLOCATED = "提交下一条消息后显示目录"
LONG_PROJECT = "项目 a.b_c/" + "long-segment-" * 14


def marketplace(run) -> pathlib.Path:
    """A directory marketplace holding a copy of the plugin."""
    root = run.dir / "mkt"
    shutil.rmtree(root, ignore_errors=True)
    shutil.copytree(PLUGIN, root / "chat-toc", ignore=shutil.ignore_patterns("tests", "build", "node_modules"))
    (root / ".claude-plugin").mkdir(parents=True)
    (root / ".claude-plugin" / "marketplace.json").write_text(json.dumps({
        "name": MARKETPLACE, "owner": {"name": "chat-toc acceptance"},
        "plugins": [{"name": "chat-toc", "source": "./chat-toc"}],
    }))
    return root


def cli(host, world, *args):
    out = subprocess.run([host.binary, *args], cwd=world.project, env=world.environment(),
                         capture_output=True, text=True, timeout=300)
    return {"argv": ["claude", *args], "exit": out.returncode, "output": (out.stdout + out.stderr).strip()}


def installed_disabled(host, world, run):
    steps = [cli(host, world, "plugin", "marketplace", "add", str(marketplace(run))),
             cli(host, world, "plugin", "install", f"chat-toc@{MARKETPLACE}"),
             cli(host, world, "plugin", "disable", f"chat-toc@{MARKETPLACE}")]
    if any(s["exit"] != 0 for s in steps):
        raise h.ScenarioFailure("installing chat-toc failed: " + json.dumps(steps, ensure_ascii=False))
    return steps


def move_project(world, name):
    """Moves the world's project to `name` under its base, trusted."""
    project = world.base / name
    project.mkdir(parents=True)
    world.project = project.resolve()
    path = world.config / ".claude.json"
    config = json.loads(path.read_text())
    config["projects"] = {str(world.project): {"hasTrustDialogAccepted": True, "hasCompletedProjectOnboarding": True}}
    path.write_text(json.dumps(config))


def session_file(world):
    files = list((world.config / "projects").rglob("*.jsonl"))
    return max(files, key=lambda f: f.stat().st_mtime) if files else None


def notes_but_minimap(p) -> list[str]:
    """The Pane's notes without the Minimap's rows (its bars and the dates
    under them), which the parser keeps as notes too."""
    bars = len(p.notes) >= 2 and set(p.notes[0]) <= set("▁▂▃▄▅▆▇█")
    return p.notes[2:] if bars else p.notes


def matches_file(world, last=None):
    """The Pane lists the session file's chain (the verifier's reading);
    `last` keeps the latest diff for the record."""
    def check(t):
        p = v.parse_pane(t.rows())
        found = session_file(world)
        if p is None or not p.entries or found is None:
            return None
        groups = v.expected_toc(found).groups
        diff = v.compare_window(groups, p) if groups else {"ok": False}
        if last is not None:
            last["diff"], last["notes"] = diff, notes_but_minimap(p)
        return p if diff["ok"] and not notes_but_minimap(p) else None
    return check


def submit(t, text):
    t.type(text)
    time.sleep(0.4)
    t.key("enter")
    t.wait_for(lambda term: term.text().count("Please run /login") >= 1 and text in term.text(),
               f"the host to answer {text!r}", timeout=30)
    t.settle()


def cursor_row(t):
    return next((row for row in t.rows() if "❯" in row and ("Plugin" in row or "Show disabled" in row)), "")


def select(t, needle, limit=30):
    """Moves the menu's cursor down to the row holding `needle`."""
    for _ in range(limit):
        if needle in cursor_row(t):
            return
        t.key("down", pause=0.25)
        t.settle(quiet=0.4)
    raise h.ScenarioFailure(f"no menu row with {needle!r}")


def outcome(world, t, evidence, actual, label):
    last = {}
    try:
        p = t.wait_for(matches_file(world, last), "the Pane to list the session's chain", timeout=30)
    except h.ScenarioFailure:
        actual["lastDiff"] = last
        raise
    t.settle()
    p = matches_file(world)(t) or p
    evidence.append(t.snap(f"{label} listed after enabling"))
    actual["entries"] = [e.public() for e in p.entries]
    actual["notes"] = p.notes
    actual["file"] = str(session_file(world).relative_to(world.config))
    actual["listed"] = True


def scenario_cli(host, run):
    world = h.World(token="")
    evidence, actual, t = [], {"way": "claude plugin enable + /reload-plugins"}, None
    try:
        move_project(world, LONG_PROJECT)
        actual["projectPathLength"] = len(str(world.project))
        actual["install"] = [s["exit"] for s in installed_disabled(host, world, run)]
        log = run.dir / f"debug-cli-{host.version}.log"
        evidence.append(log)
        t = h.launch(world, host, [], ["--debug-file", str(log)], run=run)
        t.settle(quiet=1.5)
        for prompt in ("CT-SYN alpha one", "CT-SYN beta two", "CT-SYN gamma three"):
            submit(t, prompt)
        actual["paneBeforeEnable"] = v.parse_pane(t.rows()) is not None
        evidence.append(t.snap("cli three prompts, chat-toc disabled"))
        mark = log.stat().st_size
        enabled = cli(host, world, "plugin", "enable", f"chat-toc@{MARKETPLACE}")
        actual["enableExit"] = enabled["exit"]
        # The host hears of the settings file's change a moment later; a
        # /reload-plugins before that still finds chat-toc disabled.
        t.wait_for(lambda _t: "Settings changed from userSettings" in log.read_text(errors="replace")[mark:],
                   "the host to see the enable in its settings", timeout=15)
        t.command("/reload-plugins", wait=2)
        outcome(world, t, evidence, actual, "cli")
        actual["folderHashed"] = len(session_file(world).parent.name) > 200
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        if t is not None:
            t.close()
        world.remove()
    ok = (actual.get("listed") is True and actual.get("paneBeforeEnable") is False and actual.get("enableExit") == 0
          and actual.get("folderHashed") is True)
    return run.record("CT-LIFE-007", host=host.version, plugin=f"chat-toc@{MARKETPLACE} (directory marketplace)",
                      fixture=f"fresh session in a {actual.get('projectPathLength')}-character CJK project path, 3 prompts",
                      actual=actual,
                      expected="after `claude plugin enable` and /reload-plugins, with nothing more submitted, the Pane "
                               "opens by itself and matches the session file's chain (verifier)",
                      result="pass" if ok else "fail", evidence=evidence, notes="enable by CLI")["result"] == "pass"


def scenario_ui(host, run):
    world = h.World(token="")
    evidence, actual, t = [], {"way": "/plugin menu, closed with Esc"}, None
    try:
        actual["install"] = [s["exit"] for s in installed_disabled(host, world, run)]
        fx = world.fixture("turns", turns=6, version=host.version)
        log = run.dir / f"debug-ui-{host.version}.log"
        evidence.append(log)
        t = h.launch(world, host, [], ["--resume", fx["session"], "--debug-file", str(log)], run=run)
        t.wait_for("T0005", "the resumed transcript", timeout=30)
        t.settle(quiet=1.5)
        actual["paneBeforeEnable"] = v.parse_pane(t.rows()) is not None
        t.command("/plugin", wait=2)
        t.wait_for("Installed", "the /plugin menu", timeout=15)
        t.key("right")
        t.settle(quiet=0.8)
        select(t, "Show disabled")
        t.key("enter")
        t.settle(quiet=0.8)
        select(t, "chat-toc")
        t.type(" ")
        t.settle(quiet=0.8)
        evidence.append(t.snap("ui chat-toc toggled in /plugin"))
        for _ in range(4):
            if "Installed" not in t.text():
                break
            t.key("esc")
            t.settle(quiet=0.8)
        outcome(world, t, evidence, actual, "ui")
        actual["sessionFile"] = session_file(world).stem == fx["session"]
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        if t is not None:
            t.close()
        world.remove()
    ok = actual.get("listed") is True and actual.get("paneBeforeEnable") is False and actual.get("sessionFile") is True
    return run.record("CT-LIFE-007", host=host.version, plugin=f"chat-toc@{MARKETPLACE} (directory marketplace)",
                      fixture="turns 6, --resume", actual=actual,
                      expected="after enabling in /plugin and closing the menu (the host reloads by itself), with "
                               "nothing submitted, the Pane opens by itself and matches the session file's chain (verifier)",
                      result="pass" if ok else "fail", evidence=evidence, notes="enable in the /plugin menu")["result"] == "pass"


SCENARIOS = {"cli": scenario_cli, "ui": scenario_ui}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", action="append", default=None, help="2.1.287, current, ... (repeatable)")
    parser.add_argument("--scenario", choices=tuple(SCENARIOS), action="append", default=None)
    parser.add_argument("--out", type=pathlib.Path, default=None)
    args = parser.parse_args()
    ok = True
    for version in args.host or ["2.1.287", "current"]:
        host = h.Host(version)
        run = h.Run(args.out, f"ct-mid-session-{host.version}")
        for scenario in args.scenario or list(SCENARIOS):
            passed = SCENARIOS[scenario](host, run)
            print(f"CT-LIFE-007 {scenario} {host.version}: {'pass' if passed else 'fail'}  ({run.dir})")
            ok = ok and passed
        shutil.rmtree(run.dir / "mkt", ignore_errors=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
