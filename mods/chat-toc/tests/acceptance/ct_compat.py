"""CT-COMPAT-003 in a real host (spec §2, ticket 26), as the user revised it
on 2026-10-14 (f1f5494, MVP spec "Opening by itself checks nothing") and
0.2 spec §6: at every start chat-toc asks for its Pane; the host places an
unasked Pane only from its floor (144 columns) and leaves it waiting
undrawn below that, while the band above the prompt (`☰ ChatTOC … 展开目录
❯`) stands for it. Whatever placement the host gives, dock or inline, is
kept: chat-toc never closes its own Pane. No status line is written.

The width is the host's to decide: `waiting` reads the floor from the
host's own `ui.open ... waits unplaced (unasked below N columns ...)` debug
line and samples N-1 and N only.

  waiting   fullscreen at 120 columns: no Pane, the band; N-1 still waits;
            N docks it and the band goes
  narrowed  docked at 170; 130 stays docked; at 100 the host turns it inline
            and chat-toc keeps it, listing entries (no close of origin plugin
            in the host's log); back at 170 it is docked, the band gone
  asked     fullscreen at 100: the band; /chat-toc places the Pane inline,
            listing entries; 170 docks it; 100 again: kept inline
  main      the main screen (not fullscreen) at 170: the Pane opens by itself
            inline, listing entries, and is kept; no status line
  reload    waiting at 120, a hot reload opens no second Pane and the band
            is still drawn

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

# the old status lines (before f1f5494): none may show any more
OLD_STATUSES = ("目录只在全屏布局里停靠在右侧", "终端太窄，目录没有停靠", "终端太窄，目录暂时放在输入框上方", "非全屏布局里目录放在输入框上方")
BAND = "☰ ChatTOC"
BAND_OPEN = "展开目录"
FLOOR = re.compile(r"ui\.open chat-toc chat-toc \(unasked, (\d+) columns\): waits unplaced \(unasked below (\d+) columns")


def flat(t):
    return "".join(row.replace(" ", "") for row in t.rows())


def old_status(t):
    """Whether one of the removed status lines is on screen (spaces dropped:
    the line may be cut at the screen's edge, so a prefix will do)."""
    text = flat(t)
    return any(line.replace(" ", "")[:12] in text for line in OLD_STATUSES)


def band(t):
    """The band above the prompt: its title and its open Button."""
    text = "\n".join(t.rows())
    return BAND in text and BAND_OPEN in text


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


def placement(t) -> str:
    """What stands for chat-toc on screen: its Pane docked or inline, the band, or nothing."""
    return "docked" if docked(t) else "inline" if inline(t) is not None else "band" if band(t) else "none"


def log_tail(log, mark):
    return log.read_text(errors="replace")[mark:]


def pane_lines(text):
    """The host's lines about chat-toc's opens and closes (not the module's
    load lines, which list the events it hooks)."""
    return [line.split("[DEBUG] ", 1)[-1] for line in text.splitlines()
            if "ui.open chat-toc chat-toc" in line
            or ("ui.close" in line and "chat-toc" in line and "events:" not in line and "hooks:" not in line)]


def closed_by_plugin(lines) -> bool:
    """Whether the host logged a close of chat-toc's Pane that the plugin asked for."""
    return any("ui.close" in line and "plugin" in line for line in lines)


def launch(world, host, plugin, session, run, name, columns, fullscreen=True):
    log = run.dir / f"debug-{name}.log"
    t = h.launch(world, host, [plugin], ["--resume", session, "--debug-file", str(log)], run=run,
                 columns=columns, fullscreen=fullscreen)
    return t, log


def resize(t, columns):
    t.resize(columns, 44)
    time.sleep(1.0)


def scenario(name, fixture_turns=6):
    def wrap(fn):
        def run_it(host, run, plugin):
            world = h.World(token="")
            fx = world.fixture("turns", turns=fixture_turns, version=host.version)
            actual, evidence, box = {}, [], {"t": None}
            try:
                fn(host, run, plugin, world, fx, actual, evidence, box)
                actual["noStatusLine"] = not box["sawStatus"] if "sawStatus" in box else True
            except h.ScenarioFailure as failure:
                actual["failure"] = str(failure)
            finally:
                if box["t"] is not None:
                    box["t"].close()
                world.remove()
            ok = "failure" not in actual and all(value is not False for value in actual.values() if isinstance(value, bool))
            run.record(f"CT-COMPAT-003 {name}", host=host.version, plugin=str(plugin), fixture=f"turns {fixture_turns}",
                       expected=" ".join(fn.__doc__.split()), actual=actual, result="pass" if ok else "fail", evidence=evidence)
            return ok
        run_it.__name__ = fn.__name__
        return run_it
    return wrap


def snap(t, box, evidence, label):
    """A screen for the evidence; any old status line on it is remembered."""
    t.settle(quiet=1.2)
    box["sawStatus"] = box.get("sawStatus", False) or old_status(t)
    evidence.append(t.snap(label))


@scenario("waiting")
def waiting(host, run, plugin, world, fx, actual, evidence, box):
    """unasked at 120 columns the Pane waits undrawn and the band stands for
    it; at the host's floor N-1 it still waits, at N it docks and the band
    goes; no status line"""
    t, log = launch(world, host, plugin, fx["session"], run, "waiting", 120)
    box["t"] = t
    evidence.append(log)
    t.wait_for(band, "the band at 120 columns", timeout=30)
    snap(t, box, evidence, "waiting 120")
    actual["bandNoPaneAt120"] = no_pane(t) and band(t)
    match = FLOOR.search(log.read_text(errors="replace"))
    if match is None:
        raise h.ScenarioFailure("no 'waits unplaced' line in the debug log")
    floor = int(match.group(2))
    actual["hostFloor"] = floor
    actual["hostLine"] = pane_lines(log.read_text(errors="replace"))

    resize(t, floor - 1)
    snap(t, box, evidence, f"waiting {floor - 1}")
    actual["waitsBelowFloor"] = no_pane(t) and band(t)

    resize(t, floor)
    t.wait_for(docked, f"the Pane to dock at {floor} columns", timeout=15)
    t.wait_for(lambda term: not band(term), "the band to go", timeout=10)
    snap(t, box, evidence, f"waiting {floor} docked")
    actual["docksAtFloor"] = True
    actual["bandGoneOnDock"] = True


@scenario("narrowed")
def narrowed(host, run, plugin, world, fx, actual, evidence, box):
    """docked at 170 stays docked at 130; at 100 the host turns it inline and
    chat-toc keeps it, listing entries (no close of origin plugin); back at 170
    it is docked and the band gone; no status line"""
    t, log = launch(world, host, plugin, fx["session"], run, "narrowed", 170)
    box["t"] = t
    evidence.append(log)
    t.wait_for(docked, "the Pane to dock at 170", timeout=30)
    snap(t, box, evidence, "narrowed 170")

    resize(t, 130)
    snap(t, box, evidence, "narrowed 130")
    actual["stillDockedAt130"] = docked(t)

    mark = log.stat().st_size
    resize(t, 100)
    time.sleep(1.5)
    snap(t, box, evidence, "narrowed 100")
    lines = pane_lines(log_tail(log, mark))
    actual["at100"] = {"placement": placement(t), "hostLines": lines}
    actual["notClosedByPluginAt100"] = not closed_by_plugin(lines)
    actual["keptInlineAt100"] = inline(t) is not None

    mark = log.stat().st_size
    resize(t, 170)
    t.wait_for(docked, "the Pane docked again at 170", timeout=15)
    t.wait_for(lambda term: not band(term), "no band at 170", timeout=10)
    snap(t, box, evidence, "narrowed back to 170")
    actual["dockedAgain"] = True
    actual["notClosedByPluginAt170"] = not closed_by_plugin(pane_lines(log_tail(log, mark)))


@scenario("asked")
def asked(host, run, plugin, world, fx, actual, evidence, box):
    """at 100 columns the band stands for the waiting Pane; /chat-toc places it
    inline listing entries; at 170 the host docks it; back at 100 the host
    turns it inline and chat-toc keeps it; no status line"""
    t, log = launch(world, host, plugin, fx["session"], run, "asked", 100)
    box["t"] = t
    evidence.append(log)
    t.wait_for(band, "the band at 100 columns", timeout=30)
    snap(t, box, evidence, "asked 100 before /chat-toc")
    actual["bandNoPaneAt100"] = no_pane(t)

    t.command("/chat-toc")
    t.wait_for(inline, "an inline Pane after /chat-toc", timeout=15)
    snap(t, box, evidence, "asked 100 inline")
    actual["inlineListsEntries"] = inline(t) is not None

    resize(t, 170)
    t.wait_for(docked, "the asked Pane to dock at 170", timeout=15)
    snap(t, box, evidence, "asked 170 docked")
    actual["docksWhenWide"] = True

    mark = log.stat().st_size
    resize(t, 100)
    time.sleep(1.5)
    snap(t, box, evidence, "asked back to 100")
    lines = pane_lines(log_tail(log, mark))
    actual["backAt100"] = {"placement": placement(t), "hostLines": lines}
    actual["notClosedByPlugin"] = not closed_by_plugin(lines)
    actual["keptInlineAt100"] = inline(t) is not None


@scenario("main")
def main_screen(host, run, plugin, world, fx, actual, evidence, box):
    """on the main screen at 170 columns the Pane opens by itself inline,
    listing entries, and chat-toc keeps it; no status line"""
    t, log = launch(world, host, plugin, fx["session"], run, "main", 170, fullscreen=False)
    box["t"] = t
    evidence.append(log)
    t.wait_for(inline, "an inline Pane on the main screen", timeout=30)
    time.sleep(1.5)
    snap(t, box, evidence, "main 170")
    lines = pane_lines(log.read_text(errors="replace"))
    actual["atStart"] = {"placement": placement(t), "hostLines": lines}
    actual["notClosedByPlugin"] = not closed_by_plugin(lines)
    actual["inlineListsEntries"] = inline(t) is not None


@scenario("reload")
def reload(host, run, plugin, world, fx, actual, evidence, box):
    """waiting at 120 columns, a hot reload opens no second Pane and the band
    is still drawn"""
    t, log = launch(world, host, plugin, fx["session"], run, "reload", 120)
    box["t"] = t
    evidence.append(log)
    t.wait_for(band, "the band at 120 columns", timeout=30)
    mark = log.stat().st_size
    module = plugin / "hooks" / "register.tsx"
    module.write_text(module.read_text() + f"\n// ct_compat reload {time.time()}\n")
    t.wait_for(lambda _t: "chat-toc@inline reloaded" in log_tail(log, mark)
               and "chat-toc@inline session.start settled" in log_tail(log, mark),
               "the host to reload chat-toc", timeout=20)
    time.sleep(1.0)
    snap(t, box, evidence, "reload 120 after")
    lines = pane_lines(log_tail(log, mark))
    actual["afterReload"] = lines
    actual["noSecondPane"] = no_pane(t) and sum("placed" in line for line in lines) == 0
    actual["bandKept"] = band(t)


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
