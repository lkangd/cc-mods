"""PTY acceptance of the Current position, CT-POS-001..003, CT-COEX-001 and
CT-LIFE-006, on one Claude Code version.

usage: python position_scenarios.py <host-version> [pos1 pos2 pos3 coex life6 map1]

Run with the pyte venv (see requirements.txt). No model calls: every
session is the synthetic `turns` transcript opened with --resume, in the
harness's isolated world, where turn i is group i (a prompt and a reply, a
/tui local command, or a `!echo`), and every row of the transcript names
its turn (`T0123`, `模块 123`). The group at the top of the transcript's
view is read from screen row 1 (row 0 is the host's pinned prompt once the
view is scrolled): the first line from there down that names a turn.

- pos1: at the end the last group is lit; a jump to /tui (a centred
  fallback jump: the view's top shows the group before) lights /tui and
  holds it after the redraws stop; the next wheel over the transcript lets
  go and the top's group is lit.
- pos2: 180 wheel ticks up the transcript in one go, then 90 down: each
  time the lit group is the group of screen row 1.
- pos3: the lit group is in the pane's window (it follows); wheeling the
  pane pauses: the window leaves the lit group and stays put (nothing says
  so: the footer keeps the count); the next move of the transcript follows
  again; /chat-toc (the pane gets the keyboard) pauses too: the transcript
  moved past the window, the window stays.
- coex: the project a git repository with a change; the built-in /diff pane
  opens in front and chat-toc's band draws with ‹ ›, taking no focus;
  chat-toc's tab brought forward (the band goes) and paused; Diff's tab in
  front again; the transcript moves; chat-toc's tab clicked: its first
  frame back follows the new position.

A resumed session draws a local command's echo and output, and a `!`
command, at no site chat-toc hooks, so a view whose top shows only those
rows lights the next group with a sited row: the checks read the top group
by the first prompt or reply line from row 1 down (`sitedTop`), and record
the plain first line naming a turn too (`top`).
- map1 (CT-MAP-001, ticket 38): the Minimap's row under the tab rule has a
  block per group; at the end only the last cell is not dim; a click on a
  cell jumps the transcript to that group (its prompt in view), lights that
  group's entry, and moves the one undimmed cell there.
- life6: a hot reload (the module edited under --plugin-dir); the lit group
  is right after the next wheel, and a jump lands and lights its group.
"""
import pathlib
import re
import shutil
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
VERSION = sys.argv[1]
ONLY = set(sys.argv[2:])
sys.path.insert(0, str(HERE))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402

PLUGIN = HERE.parent.parent
# The footer's left while the list is listed: the turn count (0.1.1 dropped
# the "⏸ 暂停跟随" note there; a pause shows only as a window that stays put)
COUNT = re.compile(r"^\d+ 轮")
BAND = "ChatTOC  ‹ ›"
TURN = re.compile(r"T(\d{4})|模块 (\d+)")
SITED = re.compile(r"^[❯⏺] T(\d{4}) |第 \d 行说明：模块 (\d+)")
# the 300-turn fixture's last group, and the last line of its reply
LAST = 299
LAST_LINE = "第 4 行说明：模块 299 的"
# a point over the transcript, left of the pane
TRANSCRIPT_POINT = (20, 15)


def pane_of(t):
    p = v.parse_pane(t.rows())
    if p is None:
        raise h.ScenarioFailure("no pane")
    return p


def turn_of(text):
    m = TURN.search(text or "")
    return int(m.group(1) or m.group(2)) if m else None


def top_group(rows, p):
    """The turn the transcript shows at screen row 1, by the first line from
    there down that names one."""
    for line in h.transcript_text(rows, p.left).splitlines()[1:]:
        n = turn_of(line)
        if n is not None:
            return n
    return None


def top_sited_group(rows, p):
    """The same, counting only lines of rows the host draws at a site
    chat-toc hooks (a prompt, a reply): a resumed session draws a local
    command's echo and output, and a `!` command, at none, so a view whose
    top shows only those lights the next group with a sited row."""
    for line in h.transcript_text(rows, p.left).splitlines()[1:]:
        m = SITED.search(line)
        if m:
            return int(m.group(1) or m.group(2))
    return None


def entry_turn(p, i):
    """The turn of pane entry i; an entry that names none (/tui) is the one
    after its neighbour's."""
    n = turn_of(p.entries[i].user_text)
    if n is not None:
        return n
    if i > 0 and (m := turn_of(p.entries[i - 1].user_text)) is not None:
        return m + 1
    if i + 1 < len(p.entries) and (m := turn_of(p.entries[i + 1].user_text)) is not None:
        return m - 1
    return None


def lit(p):
    """The turns of the lit entries in the pane's window."""
    return [entry_turn(p, i) for i, e in enumerate(p.entries) if e.highlighted]


def counts(p):
    """The footer shows the turn count, with no note of a pause."""
    return bool(COUNT.match(p.footer or ""))


def settle(t, quiet):
    """settle(), again when pyte trips over a cell it cannot render."""
    for _ in range(5):
        try:
            return t.settle(quiet=quiet)
        except IndexError:
            time.sleep(0.3)
    return t.settle(quiet=quiet)


def look(t, quiet=1.0):
    rows = settle(t, quiet)
    p = v.parse_pane(rows)
    if p is None:
        raise h.ScenarioFailure("no pane")
    text = h.transcript_text(rows, p.left)
    return rows, p, {"top": top_group(rows, p), "sitedTop": top_sited_group(rows, p), "lit": lit(p), "footerCounts": counts(p),
                     "window": [entry_turn(p, i) for i in range(len(p.entries))],
                     "lastWhole": LAST_LINE in text}


def expected_lit(s):
    """The view's top group (its top sited row's), or the last group with its
    last row wholly in view."""
    return [LAST] if s["lastWhole"] else [s["sitedTop"]]


def wheel_transcript(t, up, ticks, gap=0.03):
    t.wheel(*TRANSCRIPT_POINT, up=up, ticks=ticks, gap=gap)


def launch(run, turns=300, plugin=PLUGIN, extra=()):
    host = h.Host(VERSION)
    world = h.World()
    fx = world.fixture("turns", turns=turns, version=host.version)
    t = h.launch(world, host, [plugin], ["--resume", fx["session"], *extra], run=run)
    t.wait_for(lambda t: (p := v.parse_pane(t.rows())) is not None and p.entries, "pane", timeout=40)
    t.settle(quiet=1.5)
    return host, world, fx, t


def record(run, scenario, host, expected, actual, ok, ev, fixture="turns 300"):
    run.record(scenario, host=host.version, plugin=str(PLUGIN), fixture=fixture, expected=expected,
               actual=actual, result="pass" if ok else "fail", evidence=ev)
    print(f"{scenario} {host.version}: {'pass' if ok else 'fail'}  {actual}")
    return ok


def pos1(run):
    host, world, fx, t = launch(run, turns=40)
    actual, ev, ok = {}, [], True
    try:
        rows, p, s = look(t)
        ev.append(t.snap("at the end"))
        actual["atEnd"] = s
        ok = s["lit"] == [39]
        # the pane wheeled to the /tui entry of turn 27 (27 % 20 == 7)
        h.pane_to_top(t)
        col, row = h._wheel_point(t)
        for _ in range(80):
            p = v.parse_pane(t.settle(quiet=0.4))
            e = next((e for e in p.entries if e.user_text.startswith("/tui") and entry_turn(p, p.entries.index(e)) == 27), None)
            if e:
                break
            t.wheel(col, row, up=False, ticks=2, gap=0.05)
        else:
            raise h.ScenarioFailure("/tui of turn 27 never showed")
        t.click(p.left + 4, e.user_row)
        rows, p, s = look(t, quiet=1.5)
        ev.append(t.snap("after the jump to /tui"))
        actual["afterJump"] = s
        held = s["lit"] == [27] and s["top"] != 27
        time.sleep(1.0)
        rows, p, s = look(t)
        actual["aSecondLater"] = s
        held = held and s["lit"] == [27]
        wheel_transcript(t, up=True, ticks=2, gap=0.1)
        rows, p, s = look(t)
        ev.append(t.snap("after one wheel over the transcript"))
        actual["afterWheel"] = s
        released = s["lit"] == [s["top"]] and s["top"] != 27
        actual["held"], actual["released"] = held, released
        ok = ok and held and released
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    return record(run, "CT-POS-001", host,
                  "the last group lit at the end; a jump to /tui (centred) lights /tui while the view's top is the group "
                  "before, still a second later; the next wheel over the transcript lights the top's group", actual, ok, ev,
                  fixture="turns 40")


def pos2(run):
    host, world, fx, t = launch(run)
    actual, ev, ok = {}, [], True
    try:
        steps = [("up 180", True, 180), ("down 90", False, 90)] + [(f"down 7 #{i}", False, 7) for i in range(12)]
        for label, up, ticks in steps + [("up 180 fast", True, 180)]:
            wheel_transcript(t, up=up, ticks=ticks, gap=0.01 if "fast" in label else 0.03)
            rows, p, s = look(t, quiet=1.5)
            ev.append(t.snap(f"after {label}"))
            actual[label] = s
            ok = ok and s["top"] is not None and s["lit"] == expected_lit(s)
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    return record(run, "CT-POS-002", host, "after 180 wheel ticks up (and 90 down, and 180 up at 100/s) the lit group is "
                  "the group of screen row 1 (the last group when its last row is wholly in view)", actual, ok, ev)


def pos3(run):
    host, world, fx, t = launch(run)
    actual, ev, ok = {}, [], True
    try:
        wheel_transcript(t, up=True, ticks=60)
        rows, p, s = look(t)
        ev.append(t.snap("transcript scrolled up: the pane follows"))
        actual["follows"] = s
        ok = s["lit"] == expected_lit(s) and s["footerCounts"]
        col, row = h._wheel_point(t)
        t.wheel(col, row, up=True, ticks=12, gap=0.05)
        rows, p, s = look(t)
        ev.append(t.snap("pane wheeled: paused"))
        actual["paneWheeled"] = s
        window = s["window"]
        # paused: the window left the lit group behind and stays put; the
        # footer still counts, no note of the pause
        ok = ok and s["lit"] == [] and s["footerCounts"]
        time.sleep(1.0)
        rows, p, s = look(t)
        actual["paneWheeledLater"] = s
        ok = ok and s["window"] == window
        before = s["sitedTop"]
        for _ in range(10):
            wheel_transcript(t, up=False, ticks=3, gap=0.1)
            rows, p, s = look(t)
            if s["sitedTop"] != before:
                break
        ev.append(t.snap("transcript moved: following again"))
        actual["transcriptMoved"] = s
        ok = ok and s["lit"] == expected_lit(s)
        t.command("/chat-toc", wait=2.0)
        rows, p, s = look(t)
        window = s["window"]
        # the pane holding the keyboard pauses too: a move of the transcript
        # leaves the window where it was
        before = s["sitedTop"]
        for _ in range(10):
            wheel_transcript(t, up=True, ticks=10, gap=0.05)
            rows, p, s = look(t)
            if s["sitedTop"] not in [before, *window]:
                break
        ev.append(t.snap("/chat-toc: the pane has the keyboard, the transcript moved"))
        actual["focused"] = {**s, "windowBefore": window, "topBefore": before}
        ok = ok and s["window"] == window and s["sitedTop"] not in window and s["footerCounts"]
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    return record(run, "CT-POS-003", host, "the lit group is in the pane's window; wheeling the pane pauses: the window "
                  "leaves the lit group and stays put, the footer still counts; the next move of the transcript follows "
                  "again; the pane holding the keyboard (/chat-toc) pauses too: the transcript moved past the window, the "
                  "window stays", actual, ok, ev)


def git_project(world):
    """The project a git repository with one uncommitted change, for /diff."""
    import subprocess
    env = {"HOME": str(world.home), "PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1"}
    who = ["-c", "user.name=ct", "-c", "user.email=ct@example.invalid"]
    run = lambda *args: subprocess.run(["/usr/bin/git", *who, *args], cwd=world.project, env=env, check=True,
                                       capture_output=True)
    run("init", "-q")
    (world.project / "notes.txt").write_text("CT-SYN one\n")
    run("add", ".")
    run("commit", "-qm", "CT-SYN")
    (world.project / "notes.txt").write_text("CT-SYN one\nCT-SYN two\n")


def click_tab(t, title):
    at = next(((y, x) for y in range(2) for x in [t.rows()[y].find(title)] if x > 0), None)
    if at is None:
        raise h.ScenarioFailure(f"no {title} tab")
    y, x = at
    t.click(sum(h.cell_width(c) for c in t.rows()[y][:x]) + 1, y)


def coex(run):
    host = h.Host(VERSION)
    world = h.World()
    fx = world.fixture("turns", turns=300, version=host.version)
    git_project(world)
    t = h.launch(world, host, [PLUGIN], ["--resume", fx["session"]], run=run)
    actual, ev, ok = {}, [], True
    try:
        t.wait_for(lambda t: (q := v.parse_pane(t.rows())) is not None and q.entries, "pane", timeout=40)
        settle(t, 1.5)
        t.command("/diff", wait=3.0)
        rows = settle(t, 1.5)
        ev.append(t.snap("/diff opened in front"))
        actual["diffInFront"] = "Diff" in rows[0] + rows[1] and (v.parse_pane(rows) is None or not v.parse_pane(rows).entries)
        # chat-toc a back tab: the band above the prompt carries ‹ › (0.2),
        # and takes no focus: the focus ring is not on it, the composer
        # takes the letters typed
        t._write("\x1b[<35;6;6M")
        rows = settle(t, 0.8)
        band = next((y for y, r in enumerate(rows) if BAND in r), None)
        styles = t.styles()
        t.type("zz")
        time.sleep(0.6)
        typed = any(re.match(r"^❯\s+zz\s*$", r) for r in t.rows())
        t.key("backspace", "backspace")
        actual["band"] = {"row": rows[band].strip() if band is not None else None,
                          "ringOnBand": band is not None and any(c[3] for c in styles[band]), "composerTyped": typed}
        ok = (actual["diffInFront"] and band is not None and "‹ ›" in rows[band] and not actual["band"]["ringOnBand"]
              and typed)
        click_tab(t, "ChatTOC")
        rows, p, s = look(t, quiet=1.5)
        actual["bandGoneInFront"] = not any(BAND in r for r in rows)
        ok = ok and actual["bandGoneInFront"]
        wheel_transcript(t, up=True, ticks=60)
        col, row = h._wheel_point(t)
        t.wheel(col, row, up=True, ticks=12, gap=0.05)
        rows, p, s = look(t)
        ev.append(t.snap("chat-toc in front, paused"))
        actual["pausedBefore"] = s
        # paused: the window left the lit group behind
        ok = ok and s["lit"] == []
        click_tab(t, "Diff")
        rows = settle(t, 1.5)
        ev.append(t.snap("Diff in front again"))
        behind = v.parse_pane(rows)
        actual["tocBehind"] = behind is None or not behind.entries
        ok = ok and actual["tocBehind"]
        wheel_transcript(t, up=True, ticks=40, gap=0.05)
        settle(t, 1.5)
        click_tab(t, "ChatTOC")
        rows, p, s = look(t, quiet=1.0)
        ev.append(t.snap("chat-toc tab clicked: in front again"))
        actual["back"] = s
        ok = ok and s["lit"] == expected_lit(s) and s["sitedTop"] != actual["pausedBefore"]["sitedTop"] and s["footerCounts"]
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    return record(run, "CT-COEX-001", host, "with /diff in front chat-toc's band draws with ‹ ›, the focus ring not on it "
                  "and the composer taking the letters typed; chat-toc's tab clicked, the band goes; paused there and Diff "
                  "in front again, a move of the transcript ends the pause: back in front its first frame lights and shows "
                  "the view's group", actual, ok, ev)


def life6(run):
    copy = run.dir / "plugin"
    shutil.copytree(PLUGIN, copy, ignore=shutil.ignore_patterns("tests", "build", "node_modules"))
    log = run.dir / "debug-life6.log"
    host, world, fx, t = launch(run, plugin=copy, extra=("--debug-file", str(log)))
    actual, ev, ok = {}, [], True
    try:
        wheel_transcript(t, up=True, ticks=40)
        rows, p, s = look(t)
        actual["before"] = s
        mark = log.stat().st_size
        module = copy / "hooks" / "register.tsx"
        module.write_text(module.read_text() + f"\n// life6 reload {time.time()}\n")
        t.wait_for(lambda _t: "session.start settled" in log.read_text(errors="replace")[mark:], "the hot reload", timeout=30)
        rows, p, s = look(t, quiet=1.5)
        ev.append(t.snap("after the hot reload"))
        actual["afterReload"] = s
        wheel_transcript(t, up=True, ticks=6, gap=0.1)
        rows, p, s = look(t)
        ev.append(t.snap("after a wheel"))
        actual["afterWheel"] = s
        ok = s["lit"] == expected_lit(s)
        # a jump to the user side of a prompt in the window other than the lit one
        i, e = next((i, e) for i, e in enumerate(p.entries) if not e.highlighted and turn_of(e.user_text) is not None
                    and e.user_text.startswith("T"))
        want = entry_turn(p, i)
        t.click(p.left + 4, e.user_row)
        rows, p, s = look(t, quiet=1.5)
        ev.append(t.snap(f"after jumping to T{want:04d}"))
        actual["jump"] = {"to": want, **s}
        ok = ok and s["lit"] == [want] and f"T{want:04d} 用户问题" in "\n".join(h.transcript_text(rows, p.left).splitlines()[:4])
    except (h.ScenarioFailure, StopIteration) as f:
        ok, actual["failure"] = False, repr(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
        shutil.rmtree(copy, ignore_errors=True)
    return record(run, "CT-LIFE-006", host, "after a hot reload the lit group is the view's (after a wheel), and a jump "
                  "lands its prompt at the top and lights its group", actual, ok, ev)


BLOCKS = "▁▂▃▄▅▆▇█"
MAP_TURNS = 30


def bar_cells(t, rows, p):
    """The Minimap's cells under the search row: (column, block, dim), with the
    row they are on; the row is the one under the tab rule, made of blocks."""
    y = p.filter_row + 2 + (1 if p.search is not None else 0)
    styles = t.styles()
    cells = []
    for x, char in v._cells(rows[y]):
        if x < p.left:
            continue
        # the baseline past the last group is a dim-edge Text, not a cell: another colour
        if char not in BLOCKS or styles[y][x][1] not in ("999999", "default"):
            break
        cells.append((x, char, styles[y][x][1] == "999999"))
    return y, cells


def map1(run):
    host, world, fx, t = launch(run, turns=MAP_TURNS)
    actual, ev, ok = {}, [], True
    try:
        rows, p, s = look(t)
        y, cells = bar_cells(t, rows, p)
        ev.append(t.snap("at the end"))
        bright = [i for i, c in enumerate(cells) if not c[2]]
        actual["cells"], actual["brightAtEnd"] = len(cells), bright
        ok = len(cells) == MAP_TURNS and bright == [MAP_TURNS - 1]
        # (turn 7 is a /tui, a centred fallback jump; turns 8 and 21 are prompts)
        for target in (8, 21):
            t.click(cells[target][0], y)
            rows, p, s = look(t, quiet=1.5)
            ev.append(t.snap(f"after a click on cell {target}"))
            y, cells = bar_cells(t, rows, p)
            bright = [i for i, c in enumerate(cells) if not c[2]]
            # the pointer rests on the cell clicked, drawn inverse: it is the bright one
            actual[f"click{target}"] = {"top": s["top"], "sitedTop": s["sitedTop"], "lit": s["lit"], "bright": bright}
            ok = ok and s["lit"] == [target] and s["top"] in (target, target - 1) and bright == [target]
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    return record(run, "CT-MAP-001", host,
                  f"a block per group under the tab rule, only the last cell undimmed at the end; a click on a cell jumps to its group "
                  f"(its prompt at the top), lights its entry and moves the undimmed cell there", actual, ok, ev,
                  fixture=f"turns {MAP_TURNS}")


SCENARIOS = {"pos1": pos1, "pos2": pos2, "pos3": pos3, "coex": coex, "life6": life6, "map1": map1}


def main():
    run = h.Run(label=f"CT-POS-{VERSION}")
    ok = True
    for name, scenario in SCENARIOS.items():
        if ONLY and name not in ONLY:
            continue
        ok = scenario(run) and ok
    print(run.dir)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
