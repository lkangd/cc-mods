"""CT-COMPAT-003 in a real host (spec §2, ticket 26), as revised by the
acceptance contract's later revision: an unasked Pane is never placed
inline; while it cannot dock the status line says why and how to get the
dock; it docks by itself once the host has the room and the line clears.
/chat-toc where it cannot dock is placed inline and kept. A docked Pane the
host turns inline as the terminal narrows is closed by chat-toc (not kept
closed) and docks again once the terminal is wide enough.

The width is the host's to decide: `waiting` reads the floor from the
host's own `ui.open ... waits unplaced (unasked below N columns ...)` debug
line and samples N-1 and N only.

  waiting   fullscreen at 120 columns: no Pane, the status line; N-1 still
            waits; N docks it and clears the line
  narrowed  docked at 170; 130 (between the floors) stays docked; 100: the
            plugin closes the Pane the host turned inline, the status line
            says why; back at 170 it docks again and the line clears
  asked     fullscreen at 100: /chat-toc places it inline, listing entries,
            the status line says how to dock; 170 docks it and clears the
            line; 100 again withdraws it like any docked Pane
  main      the main screen (not fullscreen) at 170: nothing opens, the
            status line names /tui fullscreen; /chat-toc places it inline
  reload    waiting at 120, a hot reload keeps the status line and opens
            no second Pane

No model call: a synthetic transcript opened with --resume, local commands
only. Usage (pyte from requirements.txt):

  $PY ct_compat.py --host 2.1.287 [--host current] [--scenario waiting|narrowed|asked|main|reload]
"""

from __future__ import annotations

import argparse
import pathlib
import re
import shutil
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402

PLUGIN = pathlib.Path(__file__).resolve().parents[2]

# hooks/lifecycle.ts DOCK_STATUS, as the person reads them
MAIN_SCREEN = "目录只在全屏布局里停靠在右侧，运行 /tui fullscreen 切换"
NARROW = "终端太窄，目录没有停靠；把终端拉宽后会自动出现"
ASKED_NARROW = "终端太窄，目录暂时放在输入框上方；把终端拉宽后会停靠到右侧"
ASKED_MAIN_SCREEN = "非全屏布局里目录放在输入框上方；运行 /tui fullscreen 切换后会停靠到右侧"
STATUSES = (MAIN_SCREEN, NARROW, ASKED_NARROW, ASKED_MAIN_SCREEN)
FLOOR = re.compile(r"ui\.open chat-toc chat-toc \(unasked, (\d+) columns\): waits unplaced \(unasked below (\d+) columns")


def flat(t):
    return "".join(row.replace(" ", "") for row in t.rows())


def status(t):
    """Which of chat-toc's status lines is on screen, by its words (spaces
    dropped: the line may be cut at the screen's edge, so a prefix will do)."""
    text = flat(t)
    for line in STATUSES:
        if line.replace(" ", "")[:14] in text:
            return line
    return None


def docked(t):
    p = v.parse_pane(t.rows())
    return p is not None and bool(p.entries)


def inline(t):
    """The framed inline Pane above the prompt, listing entries: its rows."""
    rows = t.rows()
    top = next((y for y, row in enumerate(rows) if row.lstrip().startswith("╭")), None)
    if top is None:
        return None
    bottom = next((y for y in range(top + 1, len(rows)) if rows[y].lstrip().startswith("╰")), None)
    if bottom is None:
        return None
    body = rows[top + 1:bottom]
    # 2.1.287 gives the inline Pane a few rows only: the window may show an
    # Agent side (its branch ├╴) without its prompt
    return body if any(mark in row for row in body for mark in ("●  ", "◉  ", "├╴ ", "┣╸ ")) else None


def no_pane(t):
    return v.parse_pane(t.rows()) is None and inline(t) is None


def log_tail(log, mark):
    return log.read_text(errors="replace")[mark:]


def pane_lines(text):
    """The host's lines about chat-toc's opens and closes (not the module's
    load lines, which list the events it hooks)."""
    return [line.split("[DEBUG] ", 1)[-1] for line in text.splitlines()
            if "ui.open chat-toc chat-toc" in line
            or ("ui.close" in line and "chat-toc" in line and "events:" not in line and "hooks:" not in line)]


def launch(world, host, plugin, session, run, name, columns, fullscreen=True):
    log = run.dir / f"debug-{name}.log"
    t = h.launch(world, host, [plugin], ["--resume", session, "--debug-file", str(log)], run=run,
                 columns=columns, fullscreen=fullscreen)
    return t, log


def resize(t, columns):
    t.resize(columns, 44)
    time.sleep(1.0)


def wait_status(t, line, what, timeout=15):
    t.wait_for(lambda term: status(term) == line, what, timeout=timeout)


def scenario(name, fixture_turns=6):
    def wrap(fn):
        def run_it(host, run, plugin):
            world = h.World(token="")
            fx = world.fixture("turns", turns=fixture_turns, version=host.version)
            actual, evidence, box = {}, [], {"t": None}
            try:
                fn(host, run, plugin, world, fx, actual, evidence, box)
            except h.ScenarioFailure as failure:
                actual["failure"] = str(failure)
            finally:
                if box["t"] is not None:
                    box["t"].close()
                world.remove()
            ok = "failure" not in actual and all(value is not False for value in actual.values() if isinstance(value, bool))
            run.record(f"CT-COMPAT-003 {name}", host=host.version, plugin=str(plugin), fixture=f"turns {fixture_turns}",
                       expected=fn.__doc__.strip(), actual=actual, result="pass" if ok else "fail", evidence=evidence)
            return ok
        run_it.__name__ = fn.__name__
        return run_it
    return wrap


@scenario("waiting")
def waiting(host, run, plugin, world, fx, actual, evidence, box):
    """unasked at 120 columns waits undrawn with the narrow status line; at the
    host's floor N-1 it still waits, at N it docks and the line clears"""
    t, log = launch(world, host, plugin, fx["session"], run, "waiting", 120)
    box["t"] = t
    evidence.append(log)
    wait_status(t, NARROW, "the narrow status line at 120 columns")
    t.settle()
    evidence.append(t.snap("waiting 120"))
    actual["noPaneAt120"] = no_pane(t)
    match = FLOOR.search(log.read_text(errors="replace"))
    if match is None:
        raise h.ScenarioFailure("no 'waits unplaced' line in the debug log")
    floor = int(match.group(2))
    actual["hostFloor"] = floor
    actual["hostLine"] = pane_lines(log.read_text(errors="replace"))

    resize(t, floor - 1)
    t.settle(quiet=1.5)
    evidence.append(t.snap(f"waiting {floor - 1}"))
    actual["waitsBelowFloor"] = no_pane(t) and status(t) == NARROW

    resize(t, floor)
    t.wait_for(docked, f"the Pane to dock at {floor} columns", timeout=15)
    t.wait_for(lambda term: status(term) is None, "the status line to clear", timeout=10)
    t.settle()
    evidence.append(t.snap(f"waiting {floor} docked"))
    actual["docksAtFloor"] = True
    actual["statusClearedOnDock"] = True


@scenario("narrowed")
def narrowed(host, run, plugin, world, fx, actual, evidence, box):
    """docked at 170 stays docked at 130; at 100 the plugin closes the Pane the
    host turned inline (origin plugin) and the narrow status line shows, no
    inline Pane is left; back at 170 it docks again and the line clears"""
    t, log = launch(world, host, plugin, fx["session"], run, "narrowed", 170)
    box["t"] = t
    evidence.append(log)
    t.wait_for(docked, "the Pane to dock at 170", timeout=30)
    t.settle()
    evidence.append(t.snap("narrowed 170"))

    resize(t, 130)
    t.settle(quiet=1.5)
    evidence.append(t.snap("narrowed 130"))
    actual["stillDockedAt130"] = docked(t) and status(t) is None

    mark = log.stat().st_size
    resize(t, 100)
    wait_status(t, NARROW, "the narrow status line at 100 columns")
    t.wait_for(no_pane, "no Pane, docked or inline, at 100", timeout=10)
    t.settle(quiet=1.5)
    evidence.append(t.snap("narrowed 100"))
    lines = pane_lines(log_tail(log, mark))
    actual["at100"] = lines
    actual["withdrawnAndWaiting"] = any("waits unplaced" in line for line in lines)
    actual["noInlineLeftAt100"] = no_pane(t)

    resize(t, 170)
    t.wait_for(docked, "the Pane to dock again at 170", timeout=15)
    t.wait_for(lambda term: status(term) is None, "the status line to clear at 170", timeout=10)
    t.settle()
    evidence.append(t.snap("narrowed back to 170"))
    actual["docksAgain"] = True


@scenario("asked")
def asked(host, run, plugin, world, fx, actual, evidence, box):
    """at 100 columns /chat-toc places the Pane inline listing entries and the
    status line says how to dock; at 170 the host docks it and the line
    clears; back at 100 it is withdrawn like any docked Pane"""
    t, log = launch(world, host, plugin, fx["session"], run, "asked", 100)
    box["t"] = t
    evidence.append(log)
    wait_status(t, NARROW, "the narrow status line at 100 columns")
    t.settle()
    evidence.append(t.snap("asked 100 before /chat-toc"))

    t.command("/chat-toc")
    t.wait_for(inline, "an inline Pane after /chat-toc", timeout=15)
    wait_status(t, ASKED_NARROW, "the asked-inline status line")
    t.settle(quiet=1.5)
    evidence.append(t.snap("asked 100 inline"))
    actual["inlineListsEntries"] = inline(t) is not None
    actual["inlineKept"] = inline(t) is not None and status(t) == ASKED_NARROW

    resize(t, 170)
    t.wait_for(docked, "the asked Pane to dock at 170", timeout=15)
    t.wait_for(lambda term: status(term) is None, "the status line to clear at 170", timeout=10)
    t.settle()
    evidence.append(t.snap("asked 170 docked"))
    actual["docksWhenWide"] = True

    resize(t, 100)
    wait_status(t, NARROW, "the narrow status line after narrowing again")
    t.wait_for(no_pane, "no Pane at 100 after it had docked", timeout=10)
    t.settle()
    evidence.append(t.snap("asked back to 100"))
    actual["withdrawnAfterDocking"] = True


@scenario("main")
def main_screen(host, run, plugin, world, fx, actual, evidence, box):
    """on the main screen nothing opens by itself and the status line names
    /tui fullscreen; /chat-toc places the Pane inline, listing entries, with
    the asked main-screen status line"""
    t, log = launch(world, host, plugin, fx["session"], run, "main", 170, fullscreen=False)
    box["t"] = t
    evidence.append(log)
    wait_status(t, MAIN_SCREEN, "the main-screen status line")
    t.settle(quiet=1.5)
    evidence.append(t.snap("main 170"))
    actual["noPane"] = no_pane(t)
    actual["opens"] = pane_lines(log.read_text(errors="replace"))
    actual["noOpenByItself"] = not actual["opens"]

    t.command("/chat-toc")
    t.wait_for(inline, "an inline Pane after /chat-toc", timeout=15)
    wait_status(t, ASKED_MAIN_SCREEN, "the asked main-screen status line")
    t.settle(quiet=1.5)
    evidence.append(t.snap("main /chat-toc inline"))
    actual["inlineListsEntries"] = True


@scenario("reload")
def reload(host, run, plugin, world, fx, actual, evidence, box):
    """waiting at 120 columns, a hot reload opens no second Pane and the narrow
    status line is still up afterwards"""
    t, log = launch(world, host, plugin, fx["session"], run, "reload", 120)
    box["t"] = t
    evidence.append(log)
    wait_status(t, NARROW, "the narrow status line at 120 columns")
    mark = log.stat().st_size
    module = plugin / "hooks" / "register.tsx"
    module.write_text(module.read_text() + f"\n// ct_compat reload {time.time()}\n")
    t.wait_for(lambda _t: "chat-toc@inline reloaded" in log_tail(log, mark)
               and "chat-toc@inline session.start settled" in log_tail(log, mark),
               "the host to reload chat-toc", timeout=20)
    t.settle(quiet=2.0)
    evidence.append(t.snap("reload 120 after"))
    lines = pane_lines(log_tail(log, mark))
    actual["afterReload"] = lines
    actual["noSecondOpen"] = not any("ui.open" in line for line in lines)
    actual["statusKept"] = status(t) == NARROW and no_pane(t)


SCENARIOS = {"waiting": waiting, "narrowed": narrowed, "asked": asked, "main": main_screen, "reload": reload}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", action="append", default=None, help="2.1.287, current, ... (repeatable)")
    parser.add_argument("--scenario", choices=tuple(SCENARIOS), action="append", default=None)
    parser.add_argument("--out", type=pathlib.Path, default=None)
    args = parser.parse_args()
    ok = True
    for version in args.host or ["2.1.287", "current"]:
        host = h.Host(version)
        run = h.Run(args.out, f"ct-compat-{host.version}")
        # a copy, so a hot reload edits what this run tests, never the working tree
        copy = run.dir / "plugin"
        shutil.copytree(PLUGIN, copy, ignore=shutil.ignore_patterns("tests", "build", "node_modules"))
        for name in args.scenario or list(SCENARIOS):
            passed = SCENARIOS[name](host, run, copy)
            print(f"CT-COMPAT-003 {name} {host.version}: {'pass' if passed else 'fail'}  ({run.dir})")
            ok = ok and passed
        shutil.rmtree(copy, ignore_errors=True)
        time.sleep(0.5)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
