#!/usr/bin/env python3
"""CT-PREV-001 and CT-PREV-002 in a real host (chat-toc 0.2 spec §1, §3, §4;
tickets 13, 15 and 22): the preview region at the bottom of the Pane, opened
by `p` on an entry pressed (or its `p: 预览` Button) and closed by its ✕, and the preview expanded over the
list.

    $PY ct_preview.py --host 2.1.287 [--host current] [--only press,close,facts,cut,short,widths,expand,cap,running] [--out DIR]

CT-PREV-001:

  press    no preview until asked: none at the start, none while ↑ moves
           the ring; Enter on the ring's entry selects it, its row of Buttons
           under it, and `p` opens the preview on that group; ↑
           again, a click on another entry (which moves it there), scrolling
           the transcript (the Current position moves), a View filter switch
           and a new turn leave it on the group pressed
  close    `p` and a click on the rule's `✕` close it; the Pane closed by its
           own ✕ and opened again by /chat-toc starts with it closed, and so
           does a new process; the store holds no preview field
  facts    the meta line: the date and time, the steps, the duration (the
           group's turn_duration rows summed) and the output tokens (each
           message.id once); a group without turn_duration or usage leaves
           both out; the files line: changed names relative to the project or
           with ~, the rest counted, and the read ones counted
  cut      a long reply is cut by the region, its last row
           `↓ 还有 N 行 · e: 展开`
  short    with the preview open, as the terminal gets shorter the Minimap
           goes first, then the region shrinks (down to 4 rows), then it is
           drawn expanded; while the region shows, the list keeps 8 rows; at
           that height `e: ← 返回` closes it, and a press on an entry then
           its `p: 预览` opens it expanded again
  widths   opened by a press, the three Layouts at 36, 44 and 56 columns each
           draw the region whole: its rule `─ 预览 ─── p: ✕` across the Pane,
           the meta line, the footer below; the group stays across the switches

CT-PREV-002:
  expand   `e` on the cut line expands the preview over the list, the filter
           row kept, `e: ← 返回` at its top with `p: ✕`; the host scrolls the
           whole tree (wheel, PgDn/PgUp, ↓); `e` with the Back Button scrolled
           away, a click on it, and Esc each return to the list, its head at
           the top
  cap      a 200,000-character pasted input: expanded, it stops at the cap
           with `… 还有 N 字未显示 · c: 复制`, the reply and the footer after it
  running  a live turn against fake_api.py (no model): a press on its entry and `p: 预览`
           opens it, a click on its cut line expands it while it runs, and
           the expanded meta line and text follow the turn as it grows

The session is a synthetic transcript built here (the V fixture), resumed
in the harness's isolated, logged-out world: no model call.
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import re
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402
import transcript_fixture as tf  # noqa: E402
import fake_api  # noqa: E402
from gate_scenarios import FAKE_KEY, fake_api_world  # noqa: E402

PLUGIN = HERE.parent.parent
SESSION = "00000000-0000-4000-8000-0000000013a0"
ID = "CT-PREV-001"
LONG_LINES = 40
BACK = "e: ← 返回"


# ---------- the V fixture ----------

def _assistant(t: tf.Transcript, content: list, mid: str, output_tokens: int | None) -> dict:
    row = t.base("assistant")
    row["message"] = {"model": "claude-haiku-4-5", "id": mid, "type": "message", "role": "assistant",
                      "content": content, "stop_reason": "end_turn", "stop_sequence": None}
    if output_tokens is not None:
        row["message"]["usage"] = {"input_tokens": 3, "output_tokens": output_tokens,
                                   "cache_read_input_tokens": 90000, "cache_creation_input_tokens": 0}
    t.emit(row)
    return row


def _result(t: tf.Transcript, tid: str, **fields) -> None:
    t.user([{"type": "tool_result", "content": "ok", "tool_use_id": tid, "is_error": False}], **fields)


def _duration(t: tf.Transcript, ms: int) -> None:
    t.system("turn_duration", "", durationMs=ms, messageCount=4)


def v_fixture(world: h.World, host: h.Host) -> dict:
    """V00 touches files over four steps, its reply streamed under one
    message id over two rows; V01 states no usage and no duration; V02's
    reply is LONG_LINES lines; V03..V07 are small turns."""
    project = str(world.project)
    path = world.transcript(SESSION)
    t = tf.Transcript(path, project, SESSION, version=host.version)
    opened = {}
    row = t.prompt("V00 改几个文件")
    opened["V00"] = row["timestamp"]
    _assistant(t, [{"type": "text", "text": "先读一下。"},
                   {"type": "tool_use", "id": "tr", "name": "Read", "input": {"file_path": f"{project}/src/a.ts"}}], "msg_v0a", 100)
    _result(t, "tr")
    _assistant(t, [{"type": "tool_use", "id": "te", "name": "Edit", "input": {"file_path": f"{project}/hooks/pane.tsx"}}], "msg_v0b", 1200)
    _assistant(t, [{"type": "tool_use", "id": "tw", "name": "Write", "input": {"file_path": f"{project}/hooks/new.ts"}}], "msg_v0b", 1200)
    _result(t, "te")
    _result(t, "tw")
    _assistant(t, [{"type": "tool_use", "id": "tb", "name": "Bash", "input": {"command": "sed -i s/a/b/ hooks/text.ts"}}], "msg_v0c", 40)
    _result(t, "tb", toolUseResult={"stdout": "", "bashEditDiff": {"changedFiles": [f"{project}/hooks/text.ts", f"{world.home}/notes/todo.md"]}})
    _assistant(t, [{"type": "text", "text": "## V00 完成\n\n- 改了 `pane.tsx`"}], "msg_v0d", 300)
    _duration(t, 150_000)
    _duration(t, 50_000)
    row = t.prompt("V01 没有用量也没有时长")
    opened["V01"] = row["timestamp"]
    _assistant(t, [{"type": "text", "text": "V01 回复"}], "msg_v1", None)
    row = t.prompt("V02 很长的回复")
    opened["V02"] = row["timestamp"]
    _assistant(t, [{"type": "text", "text": "\n".join(f"V02 第 {i} 行" for i in range(LONG_LINES))}], "msg_v2", 2000)
    _duration(t, 9_000)
    for i in range(3, 8):
        t.prompt(f"V0{i} 小问题 {i}")
        _assistant(t, [{"type": "text", "text": f"V0{i} 回复"}], f"msg_v{i}", 20)
        _duration(t, 800)
    t.close()
    return {"session": SESSION, "path": path, "opened": opened}


def local_when(timestamp: str) -> str:
    at = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone()
    return f"{at.month}月{at.day}日 {at:%H:%M}"

# ---------- reading the Pane ----------

def pane(t):
    return v.parse_pane(t.rows())


def listed(t):
    """The Pane listing the session's entries (the preview open or not)."""
    p = pane(t)
    return p if p is not None and p.entries else None


def body(p) -> list[str]:
    """The preview's rows under its rule, trailing blanks dropped."""
    rows = [r.rstrip() for r in (p.preview or [])[1:]]
    while rows and not rows[-1]:
        rows.pop()
    return rows


def shown_input(p) -> str | None:
    """The first line of the User input the preview shows."""
    rows = body(p) if p is not None else []
    return rows[2] if len(rows) > 2 and rows[1].split()[:1] == ["用户"] else None


def focus(t):
    t._write("\x18")
    time.sleep(0.25)
    t._write("\t")
    t.settle(quiet=0.6)


def pointer_off(t):
    t._write("\x1b[<35;6;6M")
    t.settle(quiet=0.5)


def ring_row(t) -> int | None:
    t.settle(quiet=0.6)
    for y, row in enumerate(t.styles()):
        if "".join(c[0] for c in row if c[3]).strip():
            return y
    return None


def entry_at(p, y):
    for e in p.entries:
        if y in (e.user_row, e.agent_row):
            return e
    return None


def cell_of(row: str, x: int) -> int:
    return sum(h.cell_width(c) for c in row[:x])


def selected_entry(t, prefix: str):
    """The entry whose input starts with `prefix` when its row of Buttons
    (`p: 预览 · …`) shows under it."""
    p = pane(t)
    return next((e for e in (p.entries if p else []) if e.user_text.startswith(prefix) and e.action_row is not None), None)


def click_open(t, prefix: str) -> None:
    """A click on `p: 预览` under the selected entry `prefix`. A second click
    too soon after the press on the entry is lost, so it waits a moment."""
    time.sleep(1.0)
    e = selected_entry(t, prefix)
    if e is None:
        raise h.ScenarioFailure(f"no row of Buttons under {prefix}")
    click_text(t, "p: 预览", row=e.action_row, right_of=pane(t).left)


def click_entry(t, prefix: str, opens: bool = True, calm: bool = True) -> None:
    """A click on the User input of the entry whose input starts with
    `prefix`, the Pane's window scrolled up to it when it is not in sight.
    The click selects it, and moves an open preview there (0.2 spec §3); with
    `opens`, a closed preview is then opened by the `p: 预览` Button under
    the entry, until the preview shows that group. Without `calm` (a turn
    running: the screen never settles) the pointer is moved off without
    waiting."""
    there = lambda term: (shown_input(pane(term)) or "").startswith(prefix)
    for _ in range(8):
        p = pane(t)
        e = next((e for e in (p.entries if p else []) if e.user_text.startswith(prefix) and e.user_row is not None), None)
        if e is not None:
            t.click(p.left + 4, e.user_row)
            if opens:
                t.wait_for(lambda term: there(term) or selected_entry(term, prefix) is not None, f"{prefix} selected", timeout=10)
                if not there(t):
                    click_open(t, prefix)
                t.wait_for(there, f"the preview on {prefix}", timeout=10)
            if calm:
                pointer_off(t)
            else:
                t._write("[<35;6;6M")
            return
        if p is None:
            break
        t.wheel(p.left + 5, p.filter_row + 6, up=True, ticks=4)
        t.settle(quiet=0.6)
    raise h.ScenarioFailure(f"no entry {prefix} to press")


def click_text(t, needle: str, row: int | None = None, right_of: int = 0) -> None:
    """Clicks the first cell of `needle` right of the Pane's border."""
    rows = t.rows()
    for y in [row] if row is not None else range(len(rows)):
        x = rows[y].find(needle)
        while x >= 0 and cell_of(rows[y], x) < right_of:
            x = rows[y].find(needle, x + 1)
        if x >= 0:
            t.click(cell_of(rows[y], x), y)
            time.sleep(0.4)
            return
    raise h.ScenarioFailure(f"no {needle!r} on the Pane")


def rule_row(t) -> int | None:
    """The screen row of the preview's rule, `─ 预览 ─── p: ✕`."""
    p = pane(t)
    if p is None:
        return None
    for y, row in enumerate(t.rows()):
        text = v._right_of(row, p.left)
        if text is not None and v._PREVIEW_RULE.match(text.strip()):
            return y
    return None


def click_close(t) -> None:
    """A click on the ✕ at the right end of the preview's rule."""
    y = rule_row(t)
    if y is None:
        raise h.ScenarioFailure("no preview rule to close")
    row = t.rows()[y]
    t.click(cell_of(row, row.rfind("✕")), y)
    time.sleep(0.4)


def close_mark(t) -> None:
    """Clicks the Pane's own ✕: 2.1.295 draws it on the title row, 2.1.287 at
    the right end of the filter row."""
    p = pane(t)
    for y in range(0, p.filter_row + 1):
        row = t.rows()[y]
        x = row.rfind("✕")
        if x >= 0 and cell_of(row, x) > p.left:
            t.click(cell_of(row, x), y)
            return
    raise h.ScenarioFailure("no ✕ on the Pane")


def lit(p) -> str | None:
    e = next((e for e in p.entries if e.highlighted), None) if p else None
    return e.user_text[:3] if e else None


def widen(t, steps):
    """Ctrl+X ← widens the focused docked Pane by 4 columns a step, → narrows it."""
    for _ in range(abs(steps)):
        t._write("\x18")
        time.sleep(0.2)
        t._write("\x1b[D" if steps > 0 else "\x1b[C")
        time.sleep(0.4)
    t.settle(quiet=0.6)


def launch(world, host, run, plugin=PLUGIN, lines=44):
    return h.launch(world, host, [plugin], ["--resume", SESSION], run=run, lines=lines)


def store(world) -> dict:
    out = {}
    folder = world.config / "plugins" / "store"
    for f in sorted(folder.glob("chat-toc_*.json")) if folder.exists() else []:
        out.update(json.loads(f.read_text() or "{}"))
    return out


def closed(t) -> bool:
    """The Pane listing its entries with nothing of the preview drawn."""
    p = pane(t)
    return p is not None and bool(p.entries) and p.preview is None and BACK not in "\n".join(t.rows())


# ---------- scenarios: each returns (fixture, expected, actual, ok, evidence) ----------

def press(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane listing the session", timeout=60)
        pointer_off(t)
        actual["atStart"] = {"closed": closed(t)}
        ev.append(t.snap("press at start"))
        focus(t)
        moves, on = [], None
        for _ in range(12):
            t.key("up")
            pointer_off(t)
            y = ring_row(t)
            p = pane(t)
            e = entry_at(p, y) if y is not None and p is not None else None
            moves.append({"ring": e.user_text[:3] if e else None, "closed": closed(t)})
            if e is not None and len([m for m in moves if m["ring"]]) >= 2:
                on = e.user_text[:3]
                break
        actual["ringMovesClosed"] = moves
        if on is None:
            raise h.ScenarioFailure("↑ never reached an entry")
        t.key("enter")
        t.wait_for(lambda term: selected_entry(term, on) is not None, f"Enter selecting {on}", timeout=10)
        pointer_off(t)
        e = selected_entry(t, on)
        actual["enter"] = {"ring": on, "selected": e.user_text[:3] if e else None, "actions": e.actions if e else None,
                           "closed": closed(t)}
        ev.append(t.snap(f"press Enter on {on}"))
        t.type("p")
        t.wait_for(lambda term: (shown_input(pane(term)) or "").startswith(on), f"p opening the preview on {on}", timeout=10)
        pointer_off(t)
        actual["p"] = {"preview": (shown_input(pane(t)) or "")[:3], "rowGone": selected_entry(t, on) is None}
        ev.append(t.snap(f"press p on {on}"))
        held = []
        for _ in range(2):
            t.key("up")
            pointer_off(t)
            held.append((shown_input(pane(t)) or "")[:3])
        actual["ringMovesOpen"] = held
        t.key("esc")
        time.sleep(0.6)
        other = "V05" if on != "V05" else "V04"
        click_entry(t, other)
        actual["click"] = {"pressed": other, "preview": (shown_input(pane(t)) or "")[:3]}
        ev.append(t.snap(f"press click on {other}"))
        before = lit(pane(t))
        t.wheel(10, 15, up=True, ticks=15)
        t.settle(quiet=1.0)
        pointer_off(t)
        actual["scrolled"] = {"litBefore": before, "litAfter": lit(pane(t)), "preview": (shown_input(pane(t)) or "")[:3]}
        ev.append(t.snap("press transcript scrolled"))
        p = pane(t)
        click_text(t, "2: 用户", row=p.filter_row, right_of=p.left)
        t.wait_for(lambda term: (q := pane(term)) is not None and q.filter == "user", "the 用户 filter", timeout=10)
        pointer_off(t)
        actual["filter"] = (shown_input(pane(t)) or "")[:3]
        click_text(t, "1: 全部", row=pane(t).filter_row, right_of=pane(t).left)
        time.sleep(0.5)
        t.type("CT-PREV-001 新的一轮")
        time.sleep(0.4)
        t.key("enter")
        t.wait_for(lambda term: (q := listed(term)) is not None and any(e.user_text.startswith("CT-PREV-001") for e in q.entries),
                   "the new turn listed", timeout=20)
        pointer_off(t)
        actual["newTurn"] = (shown_input(pane(t)) or "")[:3]
        ev.append(t.snap("press after a new turn"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    x = actual
    other = x.get("click", {}).get("pressed")
    ok = ("failure" not in x and x["atStart"]["closed"] and all(m["closed"] for m in x["ringMovesClosed"])
          and x["enter"]["selected"] == x["enter"]["ring"] and x["enter"]["closed"] and x["enter"]["actions"][:1] == ["p: 预览"]
          and x["p"]["preview"] == x["enter"]["ring"] and x["p"]["rowGone"]
          and all(s == x["enter"]["ring"] for s in x["ringMovesOpen"])
          and x["click"]["preview"] == other
          and x["scrolled"]["litAfter"] != x["scrolled"]["litBefore"] and x["scrolled"]["preview"] == other
          and x["filter"] == other and x["newTurn"] == other)
    return ("V fixture (8 groups), then one submit (not logged in: no model call)",
            "no preview at the start nor while ↑ moves the ring; Enter on the ring's entry selects it (its row "
            "`p: 预览 · …` under it, the preview still closed), p opens it on that group and the row goes, and ↑ "
            "leaves it there; a click on another entry moves it there; scrolling the transcript (the lit group moves), a "
            "switch to 用户 and a new turn leave it on the group clicked", actual, bool(ok), ev)


def close(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane listing the session", timeout=60)
        pointer_off(t)
        click_entry(t, "V06")
        focus(t)
        t.type("p")
        t.wait_for(closed, "p closing the preview", timeout=5)
        actual["p"] = True
        ev.append(t.snap("close by p"))
        t.key("esc")
        time.sleep(0.5)
        click_entry(t, "V06")
        ev.append(t.snap("close reopened by a press"))
        click_close(t)
        t.wait_for(closed, "the ✕ closing the preview", timeout=5)
        actual["closeMark"] = True
        click_entry(t, "V06")
        close_mark(t)
        t.wait_for(lambda term: pane(term) is None, "the Pane closed", timeout=10)
        t.command("/chat-toc", wait=2.0)
        t.wait_for(listed, "the Pane opened again", timeout=15)
        t.settle(quiet=1.0)
        actual["reopened"] = {"closed": closed(t)}
        ev.append(t.snap("close the Pane opened again"))
        time.sleep(0.5)
        actual["store"] = store(world)
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
    try:
        t = launch(world, host, run)
        t.wait_for(listed, "the Pane in a new process", timeout=60)
        t.settle(quiet=1.0)
        actual["newProcess"] = {"closed": closed(t)}
        ev.append(t.snap("close new process"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    ok = ("failure" not in actual and actual.get("p") and actual.get("closeMark") and actual["reopened"]["closed"]
          and actual["newProcess"]["closed"] and "preview" not in actual.get("store", {}))
    return ("V fixture", "p and a click on the rule's ✕ close the preview; the Pane closed by its ✕ and opened by /chat-toc "
            "draws no preview, nor does a new process; the store has no preview field", actual, bool(ok), ev)


FILES = re.compile(r"^改 (?P<names>.+?)(?: \+(?P<more>\d+))? · 读 (?P<read>\d+)$")


def facts(host, run):
    world = h.World(token="")
    fx = v_fixture(world, host)
    expected_names = ["hooks/pane.tsx", "hooks/new.ts", "hooks/text.ts", "~/notes/todo.md"]
    want = {
        # 46 cells: the Pane is widened to 56 columns first (at 44 the tokens go, whole)
        "V00": f"{local_when(fx['opened']['V00'])} · 4 步 · 3 分 20 秒 · 输出 1.6k",
        "V01": local_when(fx["opened"]["V01"]),
    }
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane listing the session", timeout=60)
        focus(t)
        widen(t, 3)
        t.key("esc")
        time.sleep(0.5)
        for key in ("V01", "V00"):
            click_entry(t, key)
            rows = body(pane(t))
            actual[key] = {"meta": rows[0] if rows else None, "rows": rows}
            ev.append(t.snap(f"facts {key}"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    files = None
    for row in actual.get("V00", {}).get("rows", []):
        if m := FILES.match(row.strip()):
            names = m.group("names").split(", ")
            files = {"names": names, "more": int(m.group("more") or 0), "read": int(m.group("read"))}
    actual["V00files"] = files
    ok = ("failure" not in actual
          and all(actual.get(k, {}).get("meta") == meta for k, meta in want.items())
          and files is not None and files["names"] == expected_names[: len(files["names"])]
          and files["more"] == len(expected_names) - len(files["names"]) and files["read"] == 1)
    return ("V fixture: V00 (4 steps, turn_duration 150 s + 50 s, output 100 + 1200 under one id twice + 40 + 300), "
            "V01 (no usage, no turn_duration); each opened by a click on its entry and its `p: 预览`",
            {"meta": want, "files": "改 " + ", ".join(expected_names) + " (a prefix, the rest as +N) · 读 1"},
            actual, bool(ok), ev)


def cut(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane listing the session", timeout=60)
        click_entry(t, "V02")
        p = pane(t)
        actual["rows"] = body(p)
        actual["regionRows"] = len(p.preview or [])
        ev.append(t.snap("cut V02"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    rows = actual.get("rows", [])
    last = rows[-1].strip() if rows else ""
    m = re.match(r"^↓ 还有 (\d+) 行 · e: 展开$", last)
    shown = sum(1 for r in rows if r.strip().startswith("V02 第 "))
    actual["cutLine"] = last
    ok = ("failure" not in actual and m is not None and shown >= 1 and int(m.group(1)) == LONG_LINES - shown
          and "V02 第 0 行" in rows)
    return ("V fixture: V02's reply of 40 lines, opened by a click and `p: 预览`", "the region shows the reply's first lines and ends in "
            "`↓ 还有 N 行 · e: 展开` with N the lines not shown", actual, bool(ok), ev)


def regions(t) -> dict:
    """The Pane's rows by part: the Minimap, the list, the region, or the expanded view."""
    rows = t.rows()
    p = v.parse_pane(rows)
    if p is None:
        return {"pane": None}
    expanded = any((r := v._right_of(row, p.left)) is not None and r.strip().startswith(BACK) for row in rows)
    bars = len(p.notes) >= 2 and set(p.notes[0]) <= set("▁▂▃▄▅▆▇█")
    top = p.filter_row + 2 + (1 if p.search is not None else 0) + (3 if bars else 0)
    rule = rule_row(t)
    return {"minimap": bars, "region": len(p.preview or []), "expanded": expanded,
            "listRows": (rule - top) if rule is not None else None}


def short(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {"heights": []}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane listing the session", timeout=60)
        click_entry(t, "V07")
        for lines in range(44, 13, -1):
            t.resize(170, lines)
            time.sleep(0.8)
            t.settle(quiet=0.8)
            actual["heights"].append(regions(t) | {"lines": lines})
            ev.append(t.snap(f"short {lines} lines"))
        tall = [x["lines"] for x in actual["heights"] if x.get("expanded")]
        if not tall:
            raise h.ScenarioFailure("the open preview never went expanded")
        lines = max(tall)
        t.resize(170, lines)
        time.sleep(0.8)
        t.settle(quiet=0.8)
        y, x = t.find(BACK) or (None, None)
        if y is None:
            raise h.ScenarioFailure(f"no {BACK} at {lines} lines")
        t.click(x + 4, y)
        t.wait_for(closed, f"{BACK} closing the preview at {lines} lines", timeout=5)
        actual["backCloses"] = {"lines": lines}
        ev.append(t.snap(f"short back closed at {lines}"))
        p = pane(t)
        e = p.entries[-1]
        t.click(p.left + 4, e.user_row)
        t.wait_for(lambda term: selected_entry(term, e.user_text[:3]) is not None, "the press selecting the entry", timeout=5)
        actual["pressSelects"] = {"lines": lines, "pressed": e.user_text[:3], "closed": closed(t)}
        click_open(t, e.user_text[:3])
        t.wait_for(lambda term: BACK in "\n".join(term.rows()), "p: 预览 opening it expanded", timeout=5)
        actual["pressExpands"] = {"lines": lines, "pressed": e.user_text[:3]}
        ev.append(t.snap(f"short press expanded at {lines}"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    seen = [x for x in actual["heights"] if "region" in x]
    with_bars = [x for x in seen if x["region"] > 1 and x["minimap"]]
    without_bars = [x for x in seen if x["region"] > 1 and not x["minimap"]]
    expanded = [x for x in seen if x["expanded"]]
    order_ok = (with_bars and without_bars and expanded
                and min(x["lines"] for x in with_bars) > max(x["lines"] for x in without_bars)
                and min(x["lines"] for x in without_bars) > max(x["lines"] for x in expanded))
    floor_ok = all((x["listRows"] or 0) >= 8 for x in with_bars + without_bars)
    shrink_ok = min((x["region"] for x in without_bars), default=0) == 4
    ok = ("failure" not in actual and bool(order_ok) and floor_ok and shrink_ok
          and "backCloses" in actual and actual.get("pressSelects", {}).get("closed") and "pressExpands" in actual)
    actual["checks"] = {"order": bool(order_ok), "listKeeps8": floor_ok, "shrinksTo4": shrink_ok}
    return ("V fixture, the preview opened on V07, the terminal from 44 lines down to 14",
            "the Minimap leaves first, then the region shrinks down to 4 rows, then the preview is drawn expanded; while "
            "the region shows, the list keeps 8 rows; at the tallest of those heights `e: ← 返回` closes it, and a press on "
            "an entry selects it (still closed) and its `p: 预览` opens the preview expanded", actual, bool(ok), ev)


def widths(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    steps = {36: -2, 56: 5, 44: -3}
    try:
        t.wait_for(listed, "the Pane listing the session", timeout=60)
        click_entry(t, "V05")
        focus(t)                                    # the keys stay in the Pane from here on
        for width in (36, 56, 44):
            widen(t, steps[width])
            for layout in ("卡片", "紧凑", "时间轴"):
                t.wait_for(lambda term: (p := pane(term)) is not None and p.layout == layout, f"布局 {layout}", timeout=5)
                pointer_off(t)
                p = pane(t)
                columns = 170 - p.left
                y = rule_row(t)
                rule = (v._right_of(t.rows()[y], p.left) or "") if y is not None else ""
                actual[f"{width}-{layout}"] = {"paneColumns": columns, "rule": rule, "meta": (body(p) or [None])[0],
                                               "input": (shown_input(p) or "")[:3], "footer": p.footer,
                                               "ruleCells": sum(v.cell_width(c) for c in rule.rstrip())}
                ev.append(t.snap(f"widths {width} {layout}"))
                t.type("l")
                time.sleep(0.5)
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    views = [x for k, x in actual.items() if k != "failure"]
    ok = ("failure" not in actual and len(views) == 9
          and all(x["rule"].startswith("─ 预览 ") and x["rule"].rstrip().endswith("p: ✕") and x["ruleCells"] == x["paneColumns"]
                  and x["meta"] and x["input"] == "V05" and x["footer"] for x in views)
          and sorted({x["paneColumns"] for x in views}) == [36, 44, 56])
    return ("V fixture, the preview opened on V05", "in 卡片, 紧凑 and 时间轴 at 36, 44 and 56 columns the region's rule "
            "`─ 预览 ─── p: ✕` spans the Pane, the meta line shows under it, the footer below it, and it stays on V05",
            actual, bool(ok), ev)


# ---------- CT-PREV-002: the expanded preview ----------

def pane_rows(t, left) -> list[str]:
    """The Pane's rows right of its border, as drawn now (the head may have
    scrolled away, so the Pane is found by the column it was at)."""
    return [r for r in (v._right_of(row, left) for row in t.rows()) if r is not None]


def has_back(rows: list[str]) -> bool:
    """Whether the expanded view's Back row, `e: ← 返回 … p: ✕`, is drawn."""
    return any(r.strip().startswith(BACK) for r in rows)


def expanded_view(rows: list[str]) -> dict:
    lines = [r.strip() for r in rows]
    return {"back": has_back(rows), "close": any(r.startswith(BACK) and r.endswith("p: ✕") for r in lines),
            "entries": any(v._is_entry_line(r) for r in rows),
            "first": next((r for r in lines if r), None), "filterRow": any(v._is_filter_row(r) for r in rows),
            "replyLines": [int(m.group(1)) for r in lines if (m := re.match(r"^V02 第 (\d+) 行$", r))],
            "footer": any(re.match(r"^\d+ 轮", r) for r in lines)}


def expand(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane listing the session", timeout=60)
        left = pane(t).left
        click_entry(t, "V02")
        focus(t)
        t.type("e")
        t.wait_for(lambda term: expanded_view(pane_rows(term, left))["back"], "the expanded preview", timeout=5)
        pointer_off(t)
        actual["expanded"] = expanded_view(pane_rows(t, left))
        actual["expandedRows"] = pane_rows(t, left)[:8]
        ev.append(t.snap("expand expanded"))
        t.wheel(left + 5, 20, up=False, ticks=5)
        t.settle(quiet=0.8)
        actual["wheel"] = expanded_view(pane_rows(t, left))
        ev.append(t.snap("expand wheel down"))
        t.key("pgdn")
        t.settle(quiet=0.8)
        actual["pgdn"] = expanded_view(pane_rows(t, left))
        ev.append(t.snap("expand pgdn"))
        t.key("pgup")
        t.settle(quiet=0.8)
        actual["pgup"] = expanded_view(pane_rows(t, left))
        t.key("down")
        t.settle(quiet=0.8)
        actual["down"] = expanded_view(pane_rows(t, left))
        ev.append(t.snap("expand down"))
        t.wheel(left + 5, 20, up=False, ticks=10)
        t.settle(quiet=0.8)
        actual["scrolledAway"] = expanded_view(pane_rows(t, left))
        t.type("e")
        t.settle(quiet=0.8)
        pointer_off(t)
        actual["eAgain"] = expanded_view(pane_rows(t, left))
        ev.append(t.snap("expand e again"))
        t.type("e")
        t.wait_for(lambda term: expanded_view(pane_rows(term, left))["back"], "expanded again", timeout=5)
        y, x = t.find(BACK)
        t.click(x + 4, y)
        t.settle(quiet=0.8)
        pointer_off(t)
        actual["backPressed"] = expanded_view(pane_rows(t, left))
        ev.append(t.snap("expand back pressed"))
        t.type("e")
        t.wait_for(lambda term: expanded_view(pane_rows(term, left))["back"], "expanded once more", timeout=5)
        t.key("esc")
        time.sleep(0.6)
        t.settle(quiet=0.8)
        actual["esc"] = expanded_view(pane_rows(t, left))
        ev.append(t.snap("expand esc"))
        focus(t)
        t.type("e")
        t.wait_for(lambda term: expanded_view(pane_rows(term, left))["back"], "expanded to be closed", timeout=5)
        t.type("p")
        t.wait_for(closed, "p closing the expanded preview", timeout=5)
        actual["pClosesExpanded"] = True
        ev.append(t.snap("expand closed by p"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    x = actual
    top = lambda view: view["back"] and view["close"] and view["filterRow"] and not view["entries"] and view["replyLines"][:1] == [0]
    listed_again = lambda view: view["entries"] and view["filterRow"] and not view["back"]
    last = lambda view: max(view["replyLines"], default=-1)
    checks = {}
    if "failure" not in x:
        checks = {
            "expanded": top(x["expanded"]) and not x["expanded"]["footer"],
            "wheel": not x["wheel"]["back"] and last(x["wheel"]) >= last(x["expanded"]) + 3,
            "pgdn": x["pgdn"]["footer"] and last(x["pgdn"]) == LONG_LINES - 1,
            "pgup": top(x["pgup"]),
            "down": last(x["down"]) == last(x["pgup"]) + 1,
            "eWithBackScrolledAway": not x["scrolledAway"]["back"] and listed_again(x["eAgain"]),
            "backPressed": listed_again(x["backPressed"]),
            "escLeaves": listed_again(x["esc"]),
            "pClosesExpanded": bool(x.get("pClosesExpanded")),
        }
    x["checks"] = checks
    ok = "failure" not in x and all(checks.values())
    return ("V fixture: V02's reply of 40 lines, opened by a click and `p: 预览`, the Pane focused",
            "e expands the preview over the list (the filter row kept, the Back Button `e: ← 返回` at its top with "
            "`p: ✕`, no entry); the host scrolls the whole tree: 5 wheel ticks, PgDn to the end with the footer, PgUp to "
            "the top, ↓ one row; e with the Back Button scrolled away, a click on it, and Esc each return to the list with "
            "its head at the top; p closes it from the expanded view", actual, bool(ok), ev)


PASTED_LINES = 4_000
CAP_LINE = re.compile(r"^… 还有 (\d{1,3}(?:,\d{3})*) 字未显示 · c: 复制$")


def cap(host, run):
    """P01's input is a 200,000-character paste of PASTED_LINES lines."""
    world = h.World(token="")
    project = str(world.project)
    t_ = tf.Transcript(world.transcript(SESSION), project, SESSION, version=host.version)
    pasted = "\n".join(f"P01 pasted line {i:04d} " + "x" * 30 for i in range(PASTED_LINES))
    for i, prompt in enumerate(["P00 小问题", pasted, "P02 小问题"]):
        t_.prompt(prompt)
        _assistant(t_, [{"type": "text", "text": f"P0{i} 回复"}], f"msg_p{i}", 20)
    t_.close()
    actual, ev = {"pasted": len(pasted)}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane listing the session", timeout=60)
        left = pane(t).left
        click_entry(t, "P01")
        ev.append(t.snap("cap region"))
        focus(t)
        t.type("e")
        t.wait_for(lambda term: has_back(pane_rows(term, left)), "the expanded preview", timeout=10)
        top = [r.strip() for r in pane_rows(t, left)]
        actual["top"] = top[:8]
        ev.append(t.snap("cap expanded top"))
        t.key("end")
        t.settle(quiet=1.0)
        bottom = [r.strip() for r in pane_rows(t, left)]
        actual["bottom"] = bottom[-12:]
        ev.append(t.snap("cap expanded end"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    bottom = actual.get("bottom", [])
    cut = next((CAP_LINE.match(r) for r in bottom if CAP_LINE.match(r)), None)
    left_out = int(cut.group(1).replace(",", "")) if cut else None
    shown = [r for r in bottom if r.startswith("P01 pasted line ")]
    actual["cut"] = left_out
    ok = ("failure" not in actual and "P01 pasted line 0000" in actual.get("top", [])
          and left_out is not None and 130_000 <= left_out < len(pasted) and shown
          and int(shown[-1].split()[3]) < PASTED_LINES - 1
          and "P01 回复" in bottom and any(re.match(r"^\d+ 轮", r) for r in bottom))
    return ("P fixture: P01's input a paste of 4,000 lines (about 200,000 characters), a short reply",
            "opened by a click and `p: 预览`, then expanded, the input starts whole at the top; at the end (End) it stops early with "
            "`… 还有 N 字未显示 · c: 复制` (N about 140,000), the reply and the footer drawn after it",
            actual, bool(ok), ev)


LIVE = "CT-PREV-002 进行中的合成一轮 " + "很长的输入用来让预览区切掉它，" * 30


def running(host, run):
    """A live turn against fake_api.py, its input long enough to be cut by
    the region; a press on its entry and `p: 预览` open it, and a click on the cut line
    expands it while it runs."""
    world = h.World(token="")
    fake_api_world(world)
    (world.project / "notes.txt").write_text("CT-SYN notes\n")
    v_fixture(world, host)
    actual, ev, metas = {}, [], []
    with fake_api.FakeApi("CT-PREV-002", str(world.project / "notes.txt"), steps=2, delay=4.0, reply="完成") as api:
        t = h.launch(world, host, [PLUGIN], ["--resume", SESSION], run=run,
                     env={"ANTHROPIC_BASE_URL": api.url, "ANTHROPIC_API_KEY": FAKE_KEY})
        try:
            t.wait_for(listed, "the Pane listing the session", timeout=60)
            left = pane(t).left
            t.type(LIVE)
            time.sleep(0.4)
            t.key("enter")
            t.wait_for(lambda term: any(e.user_text.startswith("CT-PREV-002") for e in (pane(term).entries if pane(term) else [])),
                       "the running group listed", timeout=20)
            click_entry(t, "CT-PREV-002", calm=False)
            t.wait_for(lambda term: term.find("e: 展开") is not None, "the running group cut in the region", timeout=20)
            y, x = t.find("e: 展开")
            t.click(x + 3, y)
            t.wait_for(lambda term: has_back(pane_rows(term, left)), "the expanded preview", timeout=5)
            end = time.monotonic() + 40
            while time.monotonic() < end:
                rows = [r.strip() for r in pane_rows(t, left)]
                at = next((i for i, r in enumerate(rows) if r.startswith(BACK)), None)
                meta = rows[at + 1] if at is not None and at + 1 < len(rows) else None
                if meta and (not metas or metas[-1] != meta):
                    metas.append(meta)
                    ev.append(t.snap(f"running {meta}"))
                if meta and "进行中" not in meta and "完成" in rows:
                    break
                time.sleep(0.2)
            actual["final"] = [r.strip() for r in pane_rows(t, left)]
        except h.ScenarioFailure as failure:
            actual["failure"] = str(failure)
        finally:
            t.close()
            world.remove()
    actual["metas"] = metas
    states = [re.sub(r"^\S+ \d\d:\d\d · ", "", m) for m in metas]
    actual["states"] = states
    ok = ("failure" not in actual and any(s.startswith("进行中 · 1 步") for s in states)
          and any(s.startswith("进行中 · 2 步") for s in states) and states[-1].startswith("2 步")
          and "完成" in actual.get("final", []) and has_back(actual.get("final", [])))
    return ("V fixture + one live turn against fake_api.py (two Read steps, 4 s apart; no model)",
            "a press on the running group's entry and its `p: 预览` open it, a click on its cut line expands it; still expanded, its meta "
            "line goes 进行中 · 1 步, 进行中 · 2 步, then 2 步 with the closing text 完成 under Agent", actual, bool(ok), ev)


SCENARIOS = {"press": press, "close": close, "facts": facts, "cut": cut, "short": short, "widths": widths,
             "expand": expand, "cap": cap, "running": running}
IDS = {"expand": "CT-PREV-002", "cap": "CT-PREV-002", "running": "CT-PREV-002"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", action="append", default=[])
    parser.add_argument("--only", default="")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    failed = 0
    for version in args.host or ["current"]:
        host = h.Host(version)
        run = h.Run(args.out, f"ct-preview-{host.version}")
        for name in [n for n in args.only.split(",") if n] or list(SCENARIOS):
            try:
                fixture, expected, actual, ok, evidence = SCENARIOS[name](host, run)
            except Exception as error:                      # a scenario that crashed is a failed scenario
                fixture, expected, actual, ok, evidence = name, name, {"error": repr(error)}, False, []
            run.record(IDS.get(name, ID), host=host.version, plugin=str(PLUGIN), fixture=fixture, expected=expected,
                       actual=json.loads(json.dumps(actual, ensure_ascii=False, default=str)),
                       result="pass" if ok else "fail", evidence=evidence, notes=name)
            print(f"{name} ({IDS.get(name, ID)}) on {host.version}: {'pass' if ok else 'fail'}", flush=True)
            failed += not ok
        print("run directory:", run.dir)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
