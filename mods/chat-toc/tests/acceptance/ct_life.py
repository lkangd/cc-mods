"""CT-LIFE-001 and CT-LIFE-002 in a real host (MVP spec §2, ticket 20).

  CT-LIFE-001  the Pane opens by itself; after the person's ✕ it stays closed
               (also across a hot reload); /chat-toc opens it again and a
               second /chat-toc does not close it; with it open, a hot reload
               makes no second open; a new process opens it by itself again.
               Hot reloads and opens are read from the host's --debug-file.
  CT-LIFE-002  /clear rebuilds the list for the new session (the verifier's
               reading of its file: the host records the /clear itself
               there), nothing of the old one and no line parting them;
               after the person's ✕, /clear opens the Pane again.

No model call: a synthetic transcript opened with --resume, local commands
only. Usage (pyte from requirements.txt):

  $PY ct_life.py --host 2.1.287 [--host current] [--scenario 001|002|fork]

  fork         part of CT-LIFE-005: before a --fork-session's first submit
               the Pane says the session's file is not written yet; after it
               (answered by the logged-out host, no model call) it lists the
               fork's chain.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402
import transcript_fixture  # noqa: E402

PLUGIN = pathlib.Path(__file__).resolve().parents[2]
EMPTY = "本会话还没有对话"


def pane(t):
    return v.parse_pane(t.rows())


def listed(t):
    p = pane(t)
    return p is not None and bool(p.entries)


def closed(t):
    return pane(t) is None


def empty(t):
    p = pane(t)
    return p is not None and not p.entries and EMPTY in p.notes


def close_mark(t):
    """Clicks the Pane's ✕: 2.1.295 draws it on the title row, 2.1.287 at the
    right end of the first content row."""
    p = pane(t)
    for y, row in enumerate(t.rows()):
        cells = 0
        for x, char in enumerate(row):
            if char == "✕" and cells > p.left:
                t.click(cells, y)
                return y, cells
            cells += h.cell_width(char)
    raise h.ScenarioFailure("no ✕ on the Pane")


def hot_reload(t, plugin, log):
    """Changes the plugin's hooks module so the host reloads it, as editing it
    under --plugin-dir does (/reload-plugins keeps an unchanged module), and
    returns the debug log the reload wrote: `session.start` raised again and
    any `ui.open` it made."""
    mark = log.stat().st_size
    module = plugin / "hooks" / "register.tsx"
    module.write_text(module.read_text() + f"\n// ct_life reload {time.time()}\n")
    def reloaded(_t):
        text = log.read_text(errors="replace")[mark:]
        return text if "chat-toc@inline reloaded" in text and "chat-toc@inline session.start settled" in text else None
    t.wait_for(reloaded, "the host to reload chat-toc and raise session.start", timeout=20)
    t.settle(quiet=1.5)
    return log.read_text(errors="replace")[mark:]


def opens_in(text):
    return [line.split("[DEBUG] ", 1)[-1] for line in text.splitlines() if "ui.open chat-toc chat-toc" in line]


def launch(world, host, plugin, session, run, name, extra=()):
    log = run.dir / f"debug-{name}.log"
    return h.launch(world, host, [plugin], ["--resume", session, *extra, "--debug-file", str(log)], run=run), log


def ct_life_001(host, run, plugin):
    world = h.World(token="")
    fx = world.fixture("turns", turns=6, version=host.version)
    evidence, actual, t = [], {}, None
    try:
        t, log = launch(world, host, plugin, fx["session"], run, "001-first")
        evidence.append(log)
        t.wait_for(listed, "the Pane to open by itself", timeout=30)
        t.settle()
        evidence.append(t.snap("001 opened by itself"))
        actual["openedByItself"] = True

        at = close_mark(t)
        t.wait_for(closed, "the Pane to close on ✕", timeout=10)
        evidence.append(t.snap(f"001 after clicking the close mark at {at}"))
        actual["closedOnMark"] = True

        text = hot_reload(t, plugin, log)
        actual["reloadWithPaneClosed"] = {"opens": opens_in(text)}
        actual["closedAfterReload"] = pane(t) is None and not opens_in(text)
        evidence.append(t.snap("001 after a hot reload with the Pane closed"))

        t.command("/chat-toc")
        t.wait_for(listed, "the Pane after /chat-toc", timeout=15)
        t.settle()
        evidence.append(t.snap("001 /chat-toc opened it"))
        actual["reopenedByCommand"] = True

        # The reopened Pane has the keyboard: its hotkey `l` (live only while
        # the Pane is focused) switches the Layout; `l` twice more goes back.
        t.type("l")
        rows = t.settle()
        actual["reopenedFocused"] = any("布局 紧凑" in row for row in rows)
        evidence.append(t.snap("001 l pressed after /chat-toc reopened it"))
        t.type("l")
        t.settle()
        t.type("l")
        t.key("esc")
        t.settle()

        t.command("/chat-toc")
        rows = t.settle()
        actual["stillOpenAfterSecondCommand"] = v.parse_pane(rows) is not None
        evidence.append(t.snap("001 a second /chat-toc"))

        text = hot_reload(t, plugin, log)
        actual["reloadWithPaneOpen"] = {"opens": opens_in(text)}
        actual["oneOpenAfterReload"] = pane(t) is not None and not opens_in(text)
        evidence.append(t.snap("001 after a hot reload with the Pane open"))
        t.close()
        t = None

        t, log = launch(world, host, plugin, fx["session"], run, "001-second")
        evidence.append(log)
        t.wait_for(listed, "the Pane to open by itself in a new process", timeout=30)
        t.settle()
        evidence.append(t.snap("001 new process opened it by itself"))
        actual["newProcessOpens"] = True
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        if t is not None:
            t.close()
        world.remove()
    keys = ("openedByItself", "closedOnMark", "closedAfterReload", "reopenedByCommand", "reopenedFocused",
            "stillOpenAfterSecondCommand", "oneOpenAfterReload", "newProcessOpens")
    ok = all(actual.get(k) is True for k in keys)
    run.record("CT-LIFE-001", host=host.version, plugin=str(plugin), fixture="turns 6", actual=actual,
               expected="opens by itself; ✕ keeps it closed across a hot reload (no ui.open); /chat-toc reopens it focused "
                        "and never closes; a hot reload with it open makes no ui.open; a new process opens it again",
               result="pass" if ok else "fail", evidence=evidence)
    return ok


def new_session(world, old):
    """The newest transcript besides the resumed one: the session /clear began."""
    folder = transcript_fixture.project_dir(world.config, str(world.project))
    files = [f for f in folder.glob("*.jsonl") if f.stem != old]
    return max(files, key=lambda f: f.stat().st_mtime) if files else None


def rebuilt(world, old):
    """The Pane lists exactly the new session's chain (the verifier's reading
    of its file, or the empty notice), nothing of the old one and no line
    parting them."""
    def check(t):
        p = pane(t)
        if p is None:
            return None
        found = new_session(world, old)
        groups = v.expected_toc(found).groups if found is not None else []
        if not groups:
            return p if not p.entries and p.notes == [EMPTY] else None
        diff = v.compare_window(groups, p)
        whole = diff["ok"] and diff["start"] == 0 and len(p.entries) == len(groups) and not p.notes
        return p if whole else None
    return check


def ct_life_002(host, run, plugin):
    world = h.World(token="")
    fx = world.fixture("turns", turns=6, version=host.version)
    evidence, actual, t = [], {}, None
    try:
        t, log = launch(world, host, plugin, fx["session"], run, "002")
        evidence.append(log)
        t.wait_for(listed, "the Pane to open by itself", timeout=30)
        t.settle()
        evidence.append(t.snap("002 opened by itself"))

        t.command("/clear", wait=2)
        p = t.wait_for(rebuilt(world, fx["session"]), "the Pane to list just the new session", timeout=15)
        t.settle()
        p = rebuilt(world, fx["session"])(t) or p
        actual["afterClearOpen"] = {"entries": [e.public() for e in p.entries], "notes": p.notes,
                                    "file": new_session(world, fx["session"]).name if new_session(world, fx["session"]) else None}
        actual["rebuilt"] = True
        evidence.append(t.snap("002 after /clear with the Pane open"))

        close_mark(t)
        t.wait_for(closed, "the Pane to close on ✕", timeout=10)
        evidence.append(t.snap("002 closed by ✕"))
        first = new_session(world, fx["session"])

        t.command("/clear", wait=2)
        p = t.wait_for(rebuilt(world, fx["session"]), "the Pane to open again after /clear", timeout=15)
        t.settle()
        second = new_session(world, fx["session"])
        actual["afterClearClosed"] = {"entries": [e.public() for e in p.entries], "notes": p.notes,
                                      "file": second.name if second else None,
                                      "anotherSession": first is None or second is None or first != second}
        actual["reopenedAfterClear"] = True
        evidence.append(t.snap("002 /clear after ✕ opened it again"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        if t is not None:
            t.close()
        world.remove()
    ok = actual.get("rebuilt") is True and actual.get("reopenedAfterClear") is True
    run.record("CT-LIFE-002", host=host.version, plugin=str(plugin), fixture="turns 6", actual=actual,
               expected="/clear lists just the new session's chain (verifier), nothing of the old and no line "
                        "parting them; after ✕, /clear opens the Pane again",
               result="pass" if ok else "fail", evidence=evidence)
    return ok


NOT_WRITTEN = "本会话还没写进 transcript 文件，提交第一条消息后显示目录"


def not_written(t):
    """The notice right of the Pane's border, wrapped over lines; the
    verifier knows the Pane by its entries or the no-conversation notice,
    neither of which is drawn here."""
    rows = t.rows()
    right = "".join("".join(row.rsplit("│", 1)[1].replace("✕", "").split()) for row in rows if "│" in row)
    return "".join(NOT_WRITTEN.split()) in right and not any(mark in right for mark in "●◉├┣")


def ct_life_fork(host, run, plugin):
    """Part of CT-LIFE-005: --fork-session shows the original's history in the
    transcript while the fork's own file is not written until the first
    submit; the Pane says so instead of claiming there is no conversation,
    then lists the fork's chain once a submit writes the file. The world is
    logged out, so the submit is answered by the host's own "Not logged in"
    row: no model call."""
    world = h.World(token="")
    fx = world.fixture("turns", turns=6, version=host.version)
    evidence, actual, t = [], {}, None
    try:
        t, log = launch(world, host, plugin, fx["session"], run, "fork", ["--fork-session"])
        evidence.append(log)
        t.wait_for(not_written, "the Pane to say the fork's file is not written yet", timeout=30)
        t.settle()
        evidence.append(t.snap("fork before the first submit"))
        actual["forkFileExists"] = new_session(world, fx["session"]) is not None
        actual["saysNotWritten"] = True

        t.type("CT-SYN first submit in the fork")
        time.sleep(0.4)
        t.key("enter")
        t.wait_for("Please run /login", "the host to answer the submit itself", timeout=30)
        fork = t.wait_for(lambda _t: new_session(world, fx["session"]), "the fork's file", timeout=15)
        def matches(term):
            groups = v.expected_toc(fork).groups
            p = pane(term)
            return p is not None and p.entries and v.compare_window(groups, p, in_progress_last=True)["ok"]
        t.wait_for(matches, "the Pane to list the fork's chain", timeout=20)
        t.settle()
        evidence.append(t.snap("fork after the first submit"))
        actual["listsForkChain"] = True
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        if t is not None:
            t.close()
        world.remove()
    ok = actual.get("saysNotWritten") is True and actual.get("forkFileExists") is False and actual.get("listsForkChain") is True
    run.record("CT-LIFE-005", host=host.version, plugin=str(plugin), fixture="turns 6, --fork-session", actual=actual,
               expected="before the fork's first submit its file does not exist and the Pane says " + NOT_WRITTEN
                        + "; after the submit the Pane matches the fork file's chain (verifier)",
               result="pass" if ok else "fail", evidence=evidence,
               notes="only the fork-before-first-submit part of CT-LIFE-005 (ticket 20); the rest is ticket 21's")
    return ok


SCENARIOS = {"001": ct_life_001, "002": ct_life_002, "fork": ct_life_fork}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", action="append", default=None, help="2.1.287, current, ... (repeatable)")
    parser.add_argument("--scenario", choices=tuple(SCENARIOS), action="append", default=None)
    parser.add_argument("--out", type=pathlib.Path, default=None)
    args = parser.parse_args()
    ok = True
    for version in args.host or ["2.1.287", "current"]:
        host = h.Host(version)
        run = h.Run(args.out, f"ct-life-{host.version}")
        # a copy, so /reload-plugins reloads what this run tests, never the working tree mid-edit
        copy = run.dir / "plugin"
        shutil.copytree(PLUGIN, copy, ignore=shutil.ignore_patterns("tests", "build", "node_modules"))
        for scenario in args.scenario or list(SCENARIOS):
            passed = SCENARIOS[scenario](host, run, copy)
            print(f"CT-LIFE {scenario} {host.version}: {'pass' if passed else 'fail'}  ({run.dir})")
            ok = ok and passed
        shutil.rmtree(copy, ignore_errors=True)
        time.sleep(0.5)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
