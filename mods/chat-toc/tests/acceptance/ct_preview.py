#!/usr/bin/env python3
"""CT-PREV-001 in a real host (chat-toc 0.2 spec §1, §3, §4; ticket 13): the
preview region at the bottom of the Pane.

    $PY ct_preview.py --host 2.1.287 [--host current] [--only which,facts,cut,toggle,short,widths] [--out DIR]

  which    not focused, the preview shows the Current position's group (the
           lit one); with the keys in the Pane, every step of the ring onto an
           entry shows that entry's group; Esc gives the keys back and the lit
           group's shows again
  facts    the meta line: the date and time, the steps, the duration (the
           group's turn_duration rows summed) and the output tokens (each
           message.id once); a group without turn_duration or usage leaves
           both out; the files line: changed names relative to the project or
           with ~, the rest counted, and the read ones counted
  cut      a long reply is cut by the region, its last row
           `↓ 还有 N 行 · e: 展开`
  toggle   `p` folds the preview to its rule line and back; folded, it stays
           folded in a new process; the store holds the flag
  short    as the terminal gets shorter the Minimap goes first, then the
           preview shrinks (down to 4 rows), then `p: 预览（空间不足）`; while the
           preview shows, the list keeps 8 rows
  widths   the three Layouts at 36, 44 and 56 columns each draw the region
           whole: its rule across the Pane, the meta line, the footer below

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

PLUGIN = HERE.parent.parent
SESSION = "00000000-0000-4000-8000-0000000013a0"
ID = "CT-PREV-001"
LONG_LINES = 40


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
    p = pane(t)
    return p if p is not None and p.entries and p.preview else None


def body(p) -> list[str]:
    """The preview's rows under its rule, trailing blanks dropped."""
    rows = [r.rstrip() for r in (p.preview or [])[1:]]
    while rows and not rows[-1]:
        rows.pop()
    return rows


def shown_input(p) -> str | None:
    """The first line of the User input the preview shows."""
    rows = body(p)
    return rows[2] if len(rows) > 2 and rows[1] == "用户" else None


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


# ---------- scenarios: each returns (fixture, expected, actual, ok, evidence) ----------

def which(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {"steps": []}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane with its preview", timeout=60)
        pointer_off(t)
        p = pane(t)
        lit = [e for e in p.entries if e.highlighted]
        actual["unfocused"] = {"lit": lit[0].user_text if lit else None, "preview": shown_input(p)}
        ev.append(t.snap("which unfocused"))
        focus(t)
        seen = set()
        for _ in range(40):
            t.key("up")
            pointer_off(t)
            p = pane(t)
            y = ring_row(t)
            e = entry_at(p, y) if y is not None else None
            if e is None:
                continue
            got = shown_input(p)
            actual["steps"].append({"ring": e.user_text[:3] if e.user_text else None, "preview": (got or "")[:3]})
            seen.add(got[:3] if got else None)
            if got and got.startswith("V00"):
                break
        ev.append(t.snap("which focused on V00"))
        t.key("esc")
        time.sleep(0.6)
        pointer_off(t)
        p = pane(t)
        lit = [e for e in p.entries if e.highlighted]
        actual["givenBack"] = {"preview": shown_input(p)}
        ev.append(t.snap("which given back"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    steps = actual["steps"]
    ok = ("failure" not in actual and actual["unfocused"]["lit"] and actual["unfocused"]["preview"] == actual["unfocused"]["lit"]
          and len(steps) >= 5 and all(s["ring"] == s["preview"] for s in steps if s["ring"])
          and steps[-1]["preview"] == "V00"
          and actual["givenBack"]["preview"] == actual["unfocused"]["lit"])
    return ("V fixture (8 groups)",
            "unfocused, the preview shows the lit group's input; focused, each ↑ onto an entry shows that entry's group "
            "up to V00; Esc gives the keys back and the Current position's group (the lit V07, scrolled out of the "
            "paused window) shows again", actual, bool(ok), ev)


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
        t.wait_for(listed, "the Pane with its preview", timeout=60)
        focus(t)
        widen(t, 3)
        for _ in range(40):
            t.key("up")
            p = pane(t)
            got = shown_input(p) or ""
            key = got[:3]
            if key in want and key not in actual:
                rows = body(p)
                actual[key] = {"meta": rows[0] if rows else None, "rows": rows}
                ev.append(t.snap(f"facts {key}"))
            if key == "V00":
                break
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
            "V01 (no usage, no turn_duration)",
            {"meta": want, "files": "改 " + ", ".join(expected_names) + " (a prefix, the rest as +N) · 读 1"},
            actual, bool(ok), ev)


def cut(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane with its preview", timeout=60)
        focus(t)
        for _ in range(40):
            t.key("up")
            p = pane(t)
            if (shown_input(p) or "").startswith("V02"):
                rows = body(p)
                actual["rows"] = rows
                actual["regionRows"] = len(p.preview or [])
                ev.append(t.snap("cut V02"))
                break
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
    return ("V fixture: V02's reply of 40 lines", "the region shows the reply's first lines and ends in "
            "`↓ 还有 N 行 · e: 展开` with N the lines not shown", actual, bool(ok), ev)


def toggle(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane with its preview", timeout=60)
        focus(t)
        t.type("p")
        t.wait_for(lambda term: (p := pane(term)) is not None and p.preview is not None and not body(p), "the folded preview", timeout=5)
        ev.append(t.snap("toggle folded"))
        actual["folded"] = pane(t).preview[0]
        time.sleep(0.5)
        actual["storeAfterP"] = store(world).get("preview")
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
    try:
        t = launch(world, host, run)
        t.wait_for(lambda term: (p := pane(term)) is not None and p.entries and p.preview is not None, "the Pane in a new process", timeout=60)
        t.settle(quiet=1.0)
        p = pane(t)
        actual["newProcessFolded"] = not body(p)
        ev.append(t.snap("toggle new process"))
        focus(t)
        t.type("p")
        t.wait_for(lambda term: (p := pane(term)) is not None and bool(body(p)), "the preview shown again", timeout=5)
        actual["shownAgain"] = body(pane(t))[:3]
        time.sleep(0.5)
        actual["storeAfterSecondP"] = store(world).get("preview")
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    ok = ("failure" not in actual and re.match(r"^─ p: 预览 ─+$", actual.get("folded") or "")
          and actual.get("storeAfterP") == "hidden" and actual.get("newProcessFolded") is True
          and actual.get("storeAfterSecondP") == "shown")
    return ("V fixture", "focused, p folds the preview to `─ p: 预览 ───` with nothing under it and the store holds "
            "preview: hidden; a new process starts folded; p shows it again (store: shown)", actual, bool(ok), ev)


def regions(p) -> dict:
    """The Pane's rows by part: the Minimap, the list, the preview."""
    bars = len(p.notes) >= 2 and set(p.notes[0]) <= set("▁▂▃▄▅▆▇█")
    return {"minimap": bars, "preview": len(p.preview or []), "state": (p.preview or [""])[0]}


def short(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {"heights": []}, []
    t = launch(world, host, run)
    try:
        t.wait_for(listed, "the Pane with its preview", timeout=60)
        for lines in range(44, 13, -1):
            t.resize(170, lines)
            time.sleep(0.8)
            rows = t.settle(quiet=0.8)
            p = v.parse_pane(rows)
            if p is None:
                actual["heights"].append({"lines": lines, "pane": None})
                continue
            top = p.filter_row + 2 + (3 if regions(p)["minimap"] else 0)
            rule = next((y for y in range(len(rows)) if (txt := v._right_of(rows[y], p.left)) and v._PREVIEW_RULE.match(txt.strip())), None)
            r = regions(p) | {"lines": lines, "listRows": (rule - top) if rule is not None else None}
            actual["heights"].append(r)
            ev.append(t.snap(f"short {lines} lines"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    seen = [x for x in actual["heights"] if "state" in x]
    shown = [x for x in seen if re.match(r"^─ p: 预览 ─+$", x["state"]) and x["preview"] > 1]
    no_room = [x for x in seen if "空间不足" in x["state"]]
    with_bars = [x for x in shown if x["minimap"]]
    without_bars = [x for x in shown if not x["minimap"]]
    order_ok = (with_bars and without_bars and no_room
                and min(x["lines"] for x in with_bars) > max(x["lines"] for x in without_bars)
                and min(x["lines"] for x in without_bars) > max(x["lines"] for x in no_room)
                and not any(x["minimap"] for x in no_room))
    floor_ok = all((x["listRows"] or 0) >= 8 for x in shown)
    shrink_ok = min((x["preview"] for x in without_bars), default=0) == 4
    ok = "failure" not in actual and bool(order_ok) and floor_ok and shrink_ok
    actual["checks"] = {"order": bool(order_ok), "listKeeps8": floor_ok, "shrinksTo4": shrink_ok}
    return ("V fixture, the terminal from 44 lines down to 14", "the Minimap leaves first, then the preview shrinks down "
            "to 4 rows, then it is the one line `p: 预览（空间不足）`; while the preview shows, the list keeps 8 rows",
            actual, bool(ok), ev)


def widths(host, run):
    world = h.World(token="")
    v_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    steps = {36: -2, 56: 5, 44: -3}
    try:
        t.wait_for(listed, "the Pane with its preview", timeout=60)
        focus(t)                                    # the keys stay in the Pane from here on
        for width in (36, 56, 44):
            widen(t, steps[width])
            for layout in ("卡片", "紧凑", "时间轴"):
                t.wait_for(lambda term: (p := pane(term)) is not None and p.layout == layout, f"布局 {layout}", timeout=5)
                pointer_off(t)
                p = pane(t)
                columns = 170 - p.left
                rule = (p.preview or [""])[0]
                actual[f"{width}-{layout}"] = {"paneColumns": columns, "rule": rule, "meta": (body(p) or [None])[0],
                                               "footer": p.footer, "ruleCells": sum(v.cell_width(c) for c in rule)}
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
          and all(x["rule"].startswith("─ p: 预览 ") and x["ruleCells"] == x["paneColumns"] and x["meta"] and x["footer"] for x in views)
          and sorted({x["paneColumns"] for x in views}) == [36, 44, 56])
    return ("V fixture", "in 卡片, 紧凑 and 时间轴 at 36, 44 and 56 columns the region's rule spans the Pane, the meta line "
            "shows under it and the footer below it", actual, bool(ok), ev)


SCENARIOS = {"which": which, "facts": facts, "cut": cut, "toggle": toggle, "short": short, "widths": widths}


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
            run.record(ID, host=host.version, plugin=str(PLUGIN), fixture=fixture, expected=expected,
                       actual=json.loads(json.dumps(actual, ensure_ascii=False, default=str)),
                       result="pass" if ok else "fail", evidence=evidence, notes=name)
            print(f"{name} ({ID}) on {host.version}: {'pass' if ok else 'fail'}", flush=True)
            failed += not ok
        print("run directory:", run.dir)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
