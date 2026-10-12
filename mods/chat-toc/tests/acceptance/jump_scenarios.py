"""PTY acceptance of the jumps, CT-JUMP-001..003, on one Claude Code version.

usage: python jump_scenarios.py <host-version> [001 002 002b 003 005]

Run with the pyte venv (see requirements.txt). No model calls: every
session is a synthetic transcript opened with --resume, in the harness's
isolated world. One run directory under build/pty-runs/, one run.jsonl
record per scenario.

- 001: resume 300 turns; turn 1's user side (never drawn) puts its prompt
  at the top, its Agent side its last reply.
- 002: a local command (/tui) and a !cmd jump to a neighbouring row,
  centred, the typed row still in view.
- 002b: a prompt-type command, a local command written as a user row, and an
  Agent side without text (its last tool row) jump without a refusal.
- 003: rewind in the host (Esc Esc, no model call); an entry the rewind took
  out of the host's list says so at the bottom, dims that side only, moves
  nothing; the saying goes after about 5 s and the side stays dim.
- 005: resume a session compacted after its second turn: the turns before
  the compaction are dim from the first drawing, the rest not (CT-JUMP-005);
  a click on one says 「⚠ 这一条在压缩之前，恢复会话后无法跳转」 at the bottom
  in the theme's warning colour, flashing inverse three times in about a
  second, then lit until it goes after about 5 s (CT-UI-005, sampled every
  ~30 ms); a turn after the compaction still jumps.
"""
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
VERSION = sys.argv[1]
ONLY = set(sys.argv[2:])
sys.path.insert(0, str(HERE))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402
import transcript_fixture as tf  # noqa: E402

PLUGIN = HERE.parent.parent
# The host draws dimColor text in the theme's `inactive`, not with SGR 2: this
# gray under the harness's dark theme.
DIM = "999999"
REFUSED = "这一条当前没有显示在对话里"
COMPACTED = "⚠ 这一条在压缩之前，恢复会话后无法跳转"
# The dark theme's `warning`, as both hosts' theme tables give it.
WARNING = "ffc107"


def pane_of(t):
    p = v.parse_pane(t.rows())
    if p is None:
        raise h.ScenarioFailure("no pane")
    return p


def side_dim(t, p, row):
    """Whether every non-blank cell of a pane row is drawn dim."""
    with t.lock:
        cells = [t.screen.buffer[row][x] for x in range(p.left + 1, t.screen.columns)]
    shown = [c for c in cells if c.data.strip()]
    return bool(shown) and all(c.fg == DIM for c in shown)


def wheel_pane_until(t, pred, down=True, limit=80):
    col, row = h._wheel_point(t)
    for _ in range(limit):
        p = v.parse_pane(t.settle(quiet=0.4))
        hit = pred(p)
        if hit:
            return p, hit
        t.wheel(col, row, up=not down, ticks=2, gap=0.05)
    raise h.ScenarioFailure("entry never showed in the pane")


def launch(run, kind, turns=300):
    host = h.Host(VERSION)
    world = h.World()
    fx = world.fixture(kind, turns=turns, version=host.version)
    t = h.launch(world, host, [PLUGIN], ["--resume", fx["session"]], run=run)
    t.wait_for(lambda t: (p := v.parse_pane(t.rows())) is not None and p.entries, "pane", timeout=40)
    t.settle()
    return host, world, fx, t


def jump001(run):
    host, world, fx, t = launch(run, "turns")
    actual, ev, ok = {}, [], True
    try:
        ev.append(t.snap("after resume"))
        top = h.pane_to_top(t)
        ev.append(t.snap("pane at top"))
        first = top.entries[0]
        actual["firstEntry"] = first.user_text
        # user side of turn 1
        t.click(top.left + 4, first.row + 1)
        rows = t.settle(quiet=1.0)
        ev.append(t.snap("after clicking T0000 user side"))
        txt = h.transcript_text(rows, top.left)
        user_ok = "T0000 用户问题" in "\n".join(txt.splitlines()[:6])
        actual["userJumpTopShowsT0000"] = user_ok
        # agent side of turn 1
        p = pane_of(t)
        e = next(e for e in p.entries if "T0000" in e.user_text)
        arow = e.row + 1 + len(e.user_lines)
        t.click(p.left + 4, arow)
        rows = t.settle(quiet=1.5)
        ev.append(t.snap("after clicking T0000 agent side"))
        txt = h.transcript_text(rows, p.left)
        agent_ok = "T0000 回复" in "\n".join(txt.splitlines()[:6]) and "T0000 用户问题" not in txt
        actual["agentJumpTopShowsT0000Reply"] = agent_ok
        actual["refusalShown"] = REFUSED in "\n".join(t.rows())
        ok = user_ok and agent_ok and not actual["refusalShown"]
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    run.record("CT-JUMP-001", host=host.version, plugin=str(PLUGIN), fixture="turns 300",
               expected="clicking turn 1's user side (never drawn after resume) puts its prompt at the top; its Agent side puts its last reply at the top",
               actual=actual, result="pass" if ok else "fail", evidence=ev)
    return ok


def jump002(run):
    host, world, fx, t = launch(run, "turns", turns=40)
    actual, ev, ok = {}, [], True
    try:
        h.pane_to_top(t)
        for label, needle, shown in (("local command", "/tui", ["/tui", "T0007 Current renderer"]),
                                     ("shell command", "!echo T0012", ["echo T0012"])):
            p, e = wheel_pane_until(t, lambda p: next((e for e in p.entries if e.user_text.startswith(needle)), None))
            ev.append(t.snap(f"pane shows {needle}"))
            t.click(p.left + 4, e.row + 1)
            rows = t.settle(quiet=1.0)
            ev.append(t.snap(f"after clicking {needle}"))
            txt = h.transcript_text(rows, p.left)
            lines = txt.splitlines()
            seen = all(s in txt for s in shown)
            # centred: the target is not at the very top of the view
            at = next((i for i, l in enumerate(lines) if shown[-1] in l), None)
            actual[label] = {"shown": seen, "row": at, "refused": REFUSED in "\n".join(rows)}
            ok = ok and seen and at is not None and at > 3 and REFUSED not in "\n".join(rows)
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    run.record("CT-JUMP-002", host=host.version, plugin=str(PLUGIN), fixture="turns 40",
               expected="a local command (/tui) and a !cmd jump to a neighbouring row, centred, the typed row still in view",
               actual=actual, result="pass" if ok else "fail", evidence=ev)
    return ok


def forms23(world, version):
    import transcript_fixture as tf
    session = "00000000-0000-4000-8000-000000000023"
    path = tf.project_dir(world.config, str(world.project)) / f"{session}.jsonl"
    t = tf.Transcript(path, str(world.project), session, seed=23, version=version)
    for i in range(6):
        t.prompt(f"P{i:02d} 普通问题")
        t.reply(f"P{i:02d} 回复")
    t.slash_prompt("review", "P06 main")
    t.tool("p06a")
    t.tool("p06b")
    t.reply("P06 回复：审查完成。")
    t.local_command_user_row("model", "P07", "Set model to haiku")
    t.prompt("P08 只有工具没有文字回复")
    t.tool("p08a")
    t.tool("p08b")
    for i in range(9, 40):
        t.prompt(f"P{i:02d} 普通问题")
        t.reply(f"P{i:02d} 回复")
    t.close()
    return session


def jump002b(run):
    host = h.Host(VERSION)
    world = h.World()
    session = forms23(world, host.version)
    t = h.launch(world, host, [PLUGIN], ["--resume", session], run=run)
    actual, ev, ok = {}, [], True
    try:
        t.wait_for(lambda t: (p := v.parse_pane(t.rows())) is not None and p.entries, "pane", timeout=40)
        h.pane_to_top(t)
        for label, needle, side, shown in (("prompt-type command", "/review", "user", ["/review P06 main", "Ran 2 shell commands"]),
                                           ("local command as a user row", "/model", "user", ["/model", "Set model to haiku"]),
                                           ("tools-only Agent side", "P08", "agent", ["TOP:Ran 2 shell commands", "P09 普通问题"])):
            p, e = wheel_pane_until(t, lambda p: next((e for e in p.entries if e.user_text.startswith(needle)
                                                       and (side == "user" or e.agent_head)), None))
            row = e.row + 1 if side == "user" else e.row + 1 + len(e.user_lines)
            t.click(p.left + 4, row)
            rows = t.settle(quiet=1.0)
            ev.append(t.snap(f"after clicking the {side} side of {needle}"))
            txt = h.transcript_text(rows, p.left)
            top4 = "\n".join(txt.splitlines()[1:4])
            seen = all((x[4:] in top4) if x.startswith("TOP:") else (x in txt) for x in shown)
            refused = REFUSED in "\n".join(rows)
            actual[label] = {"shown": seen, "refused": refused}
            ok = ok and seen and not refused
            t._write("\x1b[<35;6;6M")
            t.settle(quiet=0.4)
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    run.record("CT-JUMP-002", host=host.version, plugin=str(PLUGIN), fixture="forms23: /review, /model as a user row, a tools-only turn",
               expected="a prompt-type command and a user-row local command jump to the neighbouring drawn rows; an Agent side without text jumps to its last tool row; nothing refused",
               actual=actual, result="pass" if ok else "fail", evidence=ev)
    return ok


def jump003(run):
    host, world, fx, t = launch(run, "turns", turns=12)
    actual, ev, ok = {}, [], True
    try:
        ev.append(t.snap("after resume"))
        # rewind: Esc Esc on the empty composer opens the message selector
        t.key("esc", "esc", pause=0.4)
        t.settle(quiet=1.0)
        ev.append(t.snap("message selector"))
        for _ in range(4):
            t.key("up", pause=0.3)
        t.settle(quiet=0.6)
        ev.append(t.snap("message selector, picked"))
        t.key("enter")
        t.settle(quiet=1.0)
        ev.append(t.snap("after enter"))
        # a confirmation of what to restore, when the host asks
        if "Restore" in t.text() or "restore" in t.text():
            t.key("enter")
            t.settle(quiet=1.0)
            ev.append(t.snap("after confirming"))
        # clear whatever the rewind put back into the composer
        for _ in range(120):
            t.key("backspace", pause=0.0)
        rows = t.settle(quiet=1.0)
        ev.append(t.snap("rewound"))
        # the pane follows the view the rewind left near the top: wheel it to
        # the rewound-away entry (which pauses its following)
        p, e = wheel_pane_until(t, lambda p: next((e for e in reversed(p.entries) if "T0011" in e.user_text), None))
        rows = t.settle(quiet=1.0)
        before = h.transcript_text(rows, p.left)
        t.click(p.left + 4, e.row + 1)
        rows = t.settle(quiet=1.0)
        ev.append(t.snap("after clicking a rewound-away entry"))
        after = h.transcript_text(rows, p.left)
        said = REFUSED in "\n".join(rows)
        t._write("\x1b[<35;6;6M")   # the pointer off the entry: hover draws it inverse
        t.settle(quiet=0.6)
        ev.append(t.snap("pointer moved off"))
        # the pane's window may have moved with the click: read it again
        p = pane_of(t)
        e = next(o for o in p.entries if "T0011" in o.user_text)
        other = next(o for o in p.entries if "T0010" in o.user_text)
        actual["dim"] = side_dim(t, p, e.row + 1), side_dim(t, p, other.row + 1)
        actual["refusalShown"] = said
        actual["transcriptUnmoved"] = before == after
        time.sleep(6)
        rows = t.settle(quiet=1.0)
        ev.append(t.snap("6 s later"))
        actual["refusalGoneAfter6s"] = REFUSED not in "\n".join(rows)
        p = pane_of(t)
        e = next(o for o in p.entries if "T0011" in o.user_text)
        actual["dimAfter6s"] = side_dim(t, p, e.row + 1)
        ok = (said and actual["transcriptUnmoved"] and actual["refusalGoneAfter6s"]
              and actual["dim"] == (True, False) and actual["dimAfter6s"])
    except h.ScenarioFailure as f:
        ok, actual["failure"] = False, str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    run.record("CT-JUMP-003", host=host.version, plugin=str(PLUGIN), fixture="turns 12, rewound in the host",
               expected="clicking an entry the rewind took out of the host's list says so at the bottom, dims the side, moves nothing; the saying goes after ~5 s",
               actual=actual, result="pass" if ok else "fail", evidence=ev)
    return ok


def notice_cells(t):
    """The ⚠ line right of the Pane border: its text, whether it is drawn
    inverse, and its foreground; None while there is none."""
    for row in t.styles():
        text = "".join(c[0] for c in row)
        at = text.find("⚠")
        if at >= 0 and "│" in text[:at]:
            shown = [c for c in row[at:] if c[0].strip()]
            return {"text": "".join(c[0] for c in row[at:]).strip(), "reverse": all(c[3] for c in shown),
                    "fg": sorted({c[1] for c in shown})}
    return None


def runs_of(samples):
    """The inverse runs among timed samples: [(first ms, last ms)]."""
    out, start, last = [], None, None
    for ms, on in samples:
        if on and start is None:
            start = ms
        if not on and start is not None:
            out.append((start, last))
            start = None
        last = ms
    if start is not None:
        out.append((start, last))
    return out


def jump005(run):
    host = h.Host(VERSION)
    world = h.World()
    session = "00000000-0000-4000-8000-000000000035"
    fx = tf.Transcript(world.transcript(session), str(world.project), session, seed=35, version=host.version)
    for i in range(4):
        fx.prompt(f"K{i:02d} 合成问题 {i}")
        fx.reply(f"K{i:02d} 合成回复 {i}")
        if i == 1:
            fx.compact()
    fx.close()
    t = h.launch(world, host, [PLUGIN], ["--resume", session], run=run)
    jump, ui, ev = {}, {}, []
    ok_jump = ok_ui = False
    try:
        t.wait_for(lambda t: (p := v.parse_pane(t.rows())) is not None and len(p.entries) >= 4, "pane", timeout=40)
        t._write("\x1b[<35;6;6M")   # the pointer off the Pane: hover draws inverse
        t.settle(quiet=1.0)
        ev.append(t.snap("005 after resume, nothing pressed"))
        p = pane_of(t)
        entry = {k: next(e for e in p.entries if k in e.user_text) for k in ("K00", "K01", "K02", "K03")}
        agent_row = lambda e: e.row + 1 + len(e.user_lines) + 1
        jump["dimBeforePress"] = {k: [side_dim(t, p, e.row + 1), side_dim(t, p, agent_row(e))] for k, e in entry.items()}
        jump["noticeBeforePress"] = notice_cells(t)
        t.click(p.left + 4, entry["K00"].row + 1)
        began = time.monotonic()
        samples, seen = [], None
        while time.monotonic() - began < 6.5:
            cells = notice_cells(t)
            ms = round((time.monotonic() - began) * 1000)
            if cells is not None:
                seen = seen or cells
                samples.append((ms, cells["reverse"], cells["fg"], cells["text"]))
            elif samples:
                samples.append((ms, None, None, None))
            time.sleep(0.03)
        ev.append(t.snap("005 6.5 s after clicking K00"))
        shown = [s for s in samples if s[1] is not None]
        jump["saysCompacted"] = bool(shown) and all(s[3] == COMPACTED for s in shown)
        ui["inverseRuns"] = runs_of([(s[0], s[1]) for s in shown])
        ui["foregrounds"] = sorted({fg for s in shown for fg in s[2]})
        ui["shownMs"] = [shown[0][0], shown[-1][0]] if shown else None
        ui["goneBy6500"] = bool(samples) and samples[-1][1] is None
        ui["samples"] = len(samples)
        runs = ui["inverseRuns"]
        ok_ui = (jump["saysCompacted"] and ui["foregrounds"] == [WARNING] and len(runs) == 3 and runs[0][0] < 400
                 and runs[-1][1] < 1500 and shown[-1][0] > 4000 and not shown[-1][1] and ui["goneBy6500"])
        # a turn after the compaction still jumps: no refusal said
        p = pane_of(t)
        e = next(o for o in p.entries if "K02" in o.user_text)
        t.click(p.left + 4, e.row + 1)
        t.settle(quiet=1.0)
        ev.append(t.snap("005 after clicking K02"))
        jump["afterCompactionRefused"] = notice_cells(t) is not None
        dim = jump["dimBeforePress"]
        ok_jump = (dim["K00"] == [True, True] and dim["K01"] == [True, True] and dim["K02"] == [False, False]
                   and dim["K03"] == [False, False] and jump["noticeBeforePress"] is None and jump["saysCompacted"]
                   and not jump["afterCompactionRefused"])
    except h.ScenarioFailure as f:
        jump["failure"] = ui["failure"] = str(f)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    fixture = "4 turns, compacted after the second, --resume"
    run.record("CT-JUMP-005", host=host.version, plugin=str(PLUGIN), fixture=fixture,
               expected="the two turns before the compaction are dim on both sides before anything is pressed, the two "
                        "after not; a click on K00 says " + COMPACTED + "; a click on K02 jumps with nothing said",
               actual=jump, result="pass" if ok_jump else "fail", evidence=ev)
    run.record("CT-UI-005", host=host.version, plugin=str(PLUGIN), fixture=fixture,
               expected=f"the ⚠ line is drawn in {WARNING} (the dark theme's warning); it flashes inverse 3 times, the "
                        "first at once and the last over within 1.5 s, then stays lit (not inverse) past 4 s and is gone by 6.5 s",
               actual=ui, result="pass" if ok_ui else "fail", evidence=ev)
    return ok_jump and ok_ui


def main():
    run = h.Run(label=f"CT-JUMP-{VERSION}")
    results = {}
    for name, fn in (("001", jump001), ("002", jump002), ("002b", jump002b), ("003", jump003), ("005", jump005)):
        if ONLY and name not in ONLY:
            continue
        results[name] = fn(run)
    print(json.dumps(results))
    print("run directory:", run.dir)
    for r in run.records:
        print(json.dumps(r, ensure_ascii=False))


main()
