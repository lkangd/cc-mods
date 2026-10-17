#!/usr/bin/env python3
"""CT-FIND-001 and CT-FIND-002 in a real host (chat-toc 0.2 spec §1, §2, §3;
tickets 16 and 22): the search row under the tab rule.

    $PY ct_search.py --host 2.1.287 [--host current] [--only narrow,filter,live,widths,keys,entry,keep,minimap] [--out DIR]

CT-FIND-001
  narrow   a query narrows the list to the groups holding every word, with
           the count `N / 8`: any case, AND, CJK substrings, NFKC (full-width
           letters), a path's substring; no match says 没有匹配的轮次
  filter   under 用户 only the User input matches, under Agent only the last
           text and the paths
  live     a turn submitted while a query is set joins the list when it
           matches
  widths   at 36, 44 and 56 columns, in Chinese and English, the search row
           holds `f:`, the query, the count, ✕ and ‹ › on one row
CT-FIND-002
  keys     `f` (the keys in the Pane) and a click focus the field; Enter jumps
           to the nearest match, opens the preview on it and ends the
           search; Esc keeps the query and
           gives the keys back; ✕, Ctrl+U, Backspace and Enter with no match
           clear it
  entry    ↓/Tab from the field reach the matches; Enter on an entry jumps,
           opens the preview on it and keeps the search
  keep     the query survives a View filter switch, a Layout switch, a back
           tab behind /diff, and a close and reopen
  minimap  the Minimap lights the matches' cells, all dim with no match

The session is a synthetic transcript built here (the S fixture), resumed in
the harness's isolated, logged-out world: no model call.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ct_preview as cp  # noqa: E402
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402
import transcript_fixture as tf  # noqa: E402

PLUGIN = HERE.parent.parent
SESSION = "00000000-0000-4000-8000-0000000016a0"
GROUPS = 8
BLOCKS = "▁▂▃▄▅▆▇█"


# ---------- the S fixture ----------

def s_fixture(world: h.World, host: h.Host) -> dict:
    """S00 edits src/LoginPage.tsx; S01 is English with Markdown in its reply;
    S02 reads docs/README.md; S03's reply is full-width letters; S04..S07
    are small turns."""
    project = str(world.project)
    path = world.transcript(SESSION)
    t = tf.Transcript(path, project, SESSION, version=host.version)
    t.prompt("S00 修改登录页面")
    cp._assistant(t, [{"type": "tool_use", "id": "te", "name": "Edit", "input": {"file_path": f"{project}/src/LoginPage.tsx"}}], "msg_s0a", 30)
    cp._result(t, "te")
    cp._assistant(t, [{"type": "text", "text": "S00 登录页已改好"}], "msg_s0b", 20)
    t.prompt("S01 Fix the Login button")
    cp._assistant(t, [{"type": "text", "text": "S01 The **button** is fixed now"}], "msg_s1", 20)
    t.prompt("S02 写一份 README")
    cp._assistant(t, [{"type": "tool_use", "id": "tr", "name": "Read", "input": {"file_path": f"{project}/docs/README.md"}}], "msg_s2a", 30)
    cp._result(t, "tr")
    cp._assistant(t, [{"type": "text", "text": "S02 写好了"}], "msg_s2b", 20)
    t.prompt("S03 全角的问题")
    cp._assistant(t, [{"type": "text", "text": "S03 ＦＵＬＬ　ＷＩＤＴＨ 的字"}], "msg_s3", 20)
    for i in range(4, GROUPS):
        t.prompt(f"S0{i} 小问题 {i}")
        cp._assistant(t, [{"type": "text", "text": f"S0{i} 回复"}], f"msg_s{i}", 20)
    t.close()
    return {"session": SESSION, "path": path}


def git_project(world):
    """The project a git repository with one uncommitted change, for /diff."""
    env = {"HOME": str(world.home), "PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1"}
    who = ["-c", "user.name=ct", "-c", "user.email=ct@example.invalid"]

    def git(*args):
        subprocess.run(["/usr/bin/git", *who, *args], cwd=world.project, env=env, check=True, capture_output=True)
    git("init", "-q")
    (world.project / "notes.txt").write_text("CT-SYN one\n")
    git("add", ".")
    git("commit", "-qm", "CT-SYN")
    (world.project / "notes.txt").write_text("CT-SYN one\nCT-SYN two\n")


# ---------- reading and driving the Pane ----------

pane = cp.pane


def label(e) -> str:
    """An entry's S-number: its User input's, else (under Agent) its reply's."""
    text = e.user_text or " ".join([e.agent_head or "", *e.agent_lines])
    m = re.search(r"\bS\d\d\b", text)
    return m.group(0) if m else text.strip()


def ids(p) -> list[str]:
    """The groups listed, by their S-number."""
    return [label(e) for e in p.entries] if p else []


def search(t) -> dict:
    p = pane(t)
    return (p.search if p else None) or {}


def lit(p) -> str | None:
    e = next((e for e in p.entries if e.highlighted), None) if p else None
    return label(e) if e else None


def cell_of(row: str, x: int) -> int:
    return sum(h.cell_width(c) for c in row[:x])


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


def search_row(t) -> int:
    p = pane(t)
    if p is None or p.search is None:
        raise h.ScenarioFailure("no search row")
    return p.filter_row + 2


def click_field(t) -> None:
    """A click on the field gives it the keys straight from the composer."""
    p = pane(t)
    y = search_row(t)
    t.click(p.left + 10, y)
    time.sleep(0.5)


def click_clear(t) -> None:
    p = pane(t)
    click_text(t, "✕", row=search_row(t), right_of=p.left)


def wait_query(t, text: str, what: str = ""):
    return t.wait_for(lambda term: search(term).get("text") == text and pane(term), what or f"the field holding {text!r}", timeout=10)


def set_query(t, text: str):
    """Into the field (a click), emptied with Ctrl+U, then typed."""
    click_field(t)
    t._write("\x15")
    time.sleep(0.4)
    t._write(text)
    return wait_query(t, text)


def ring_row(t) -> int | None:
    return cp.ring_row(t)


def bar_cells(t, p) -> list[bool]:
    """Whether each Minimap cell is lit (not dim), left to right."""
    y = p.filter_row + 3
    rows, styles = t.rows(), t.styles()
    out = []
    for x, char in v._cells(rows[y]):
        if x < p.left:
            continue
        if char not in BLOCKS or styles[y][x][1] not in ("999999", "default"):
            break
        out.append(styles[y][x][1] != "999999")
    return out


def close_mark(t) -> None:
    """Clicks the Pane's own ✕: 2.1.295 draws it on the title row, 2.1.287 at
    the right end of the filter row; the search row's ✕ comes after both."""
    p = pane(t)
    for y in range(0, p.filter_row + 1):
        row = t.rows()[y]
        x = row.rfind("✕")
        if x >= 0 and cell_of(row, x) > p.left:
            t.click(cell_of(row, x), y)
            return
    raise h.ScenarioFailure("no ✕ on the Pane")


def click_tab(t, title):
    at = next(((y, x) for y in range(2) for x in [t.rows()[y].find(title)] if x > 0), None)
    if at is None:
        raise h.ScenarioFailure(f"no {title} tab")
    y, x = at
    t.click(cell_of(t.rows()[y], x) + 1, y)


def launch(world, host, run, columns=170, lines=44, env=None):
    return h.launch(world, host, [PLUGIN], ["--resume", SESSION], run=run, columns=columns, lines=lines, env=env)


def ready(t):
    t.wait_for(lambda term: (p := pane(term)) is not None and p.entries and p.search is not None, "the Pane with its search row", timeout=60)
    cp.pointer_off(t)


# ---------- CT-FIND-001 ----------

def narrow(host, run):
    world = h.World(token="")
    s_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    cases = [("login", ["S00", "S01"]), ("LOGIN fixed", ["S01"]), ("登录", ["S00"]), ("录页", ["S00"]),
             ("full width", ["S03"]), ("src/loginpage", ["S00"]), ("nowhere", [])]
    try:
        ready(t)
        actual["idle"] = search(t)
        for query, want in cases:
            set_query(t, query)
            p = t.wait_for(lambda term: (q := pane(term)) is not None and ids(q) == want and q, f"{query!r} listing {want}", timeout=10) \
                if want else t.wait_for(lambda term: (q := pane(term)) is not None and not q.entries and q, f"{query!r} listing none", timeout=10)
            cp.pointer_off(t)
            p = pane(t)
            actual[query] = {"listed": ids(p), "search": p.search, "notes": [n for n in p.notes if not set(n) <= set(BLOCKS) and "月" not in n]}
            ev.append(t.snap(f"narrow {query}"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    ok = ("failure" not in actual and {k: x for k, x in actual["idle"].items() if k != "step"} == {"text": "", "count": None, "clear": False, "focused": False}
          and all(actual[q]["listed"] == want and actual[q]["search"]["count"] == f"{len(want)} / {GROUPS}"
                  and actual[q]["search"]["clear"] for q, want in cases)
          and "没有匹配的轮次" in actual["nowhere"]["notes"])
    return ("S fixture", "idle: the placeholder, no count, no ✕; each query lists the groups holding every word with the "
            "count `N / 8` and ✕: login→S00 (path), S01; `LOGIN fixed`→S01 (AND, case); 登录, 录页→S00 (CJK); "
            "`full width`→S03 (NFKC); src/loginpage→S00 (path); nowhere→none, 没有匹配的轮次", actual, bool(ok), ev)


def filter_fields(host, run):
    world = h.World(token="")
    s_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    cases = {"fixed": {"全部": ["S01"], "用户": [], "Agent": ["S01"]},
             "loginpage": {"全部": ["S00"], "用户": [], "Agent": ["S00"]},
             "readme": {"全部": ["S02"], "用户": ["S02"], "Agent": ["S02"]},
             "修改": {"全部": ["S00"], "用户": ["S00"], "Agent": []}}
    keys = {"全部": "1: 全部", "用户": "2: 用户", "Agent": "3: Agent"}
    try:
        ready(t)
        for query, by in cases.items():
            set_query(t, query)
            t.key("esc")
            for name, want in by.items():
                p = pane(t)
                click_text(t, keys[name], row=p.filter_row, right_of=p.left)
                p = t.wait_for(lambda term: (q := pane(term)) is not None and ids(q) == want and q.search.get("text") == query and q,
                               f"{query!r} under {name}", timeout=10)
                actual[f"{query} {name}"] = {"listed": ids(p), "count": p.search["count"], "filter": p.filter}
            ev.append(t.snap(f"filter {query}"))
            p = pane(t)
            click_text(t, keys["全部"], row=p.filter_row, right_of=p.left)
            time.sleep(0.5)
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    ok = "failure" not in actual and all(actual.get(f"{q} {n}", {}).get("listed") == want for q, by in cases.items() for n, want in by.items())
    return ("S fixture", "the View filter picks the fields: fixed (reply) and loginpage (path) match under 全部 and Agent, "
            "not 用户; readme (input and path) under all three; 修改 (input only) under 全部 and 用户, not Agent",
            actual, bool(ok), ev)


def live(host, run):
    world = h.World(token="")
    s_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        ready(t)
        set_query(t, "登录")
        t.key("esc")
        time.sleep(0.5)
        actual["before"] = {"listed": ids(pane(t)), "count": search(t).get("count")}
        t.type("S08 再改一次登录页")
        time.sleep(0.4)
        t.key("enter")
        p = t.wait_for(lambda term: (q := pane(term)) is not None and ids(q) == ["S00", "S08"] and q, "S08 joining the matches", timeout=30)
        actual["after"] = {"listed": ids(p), "count": p.search["count"], "query": p.search["text"]}
        ev.append(t.snap("live S08 joined"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    ok = ("failure" not in actual and actual["before"] == {"listed": ["S00"], "count": f"1 / {GROUPS}"}
          and actual["after"] == {"listed": ["S00", "S08"], "count": f"2 / {GROUPS + 1}", "query": "登录"})
    return ("S fixture + a prompt submitted while 登录 is the query", "the new matching group S08 joins the list and "
            "the count goes from 1 / 8 to 2 / 9; the query stays", actual, bool(ok), ev)


def search_text_row(t) -> str | None:
    """The search row right of the Pane's border, whatever the language."""
    for row in t.rows():
        if "│" in row:
            right = row.rsplit("│", 1)[1].strip()
            if right.startswith("f: "):
                return right
    return None


def widths(host, run):
    actual, ev = {}, []
    steps = {36: -2, 56: 5, 44: -3}
    for language, env, query, count, word in (("zh", None, "登录", "1 / 8", "f: 搜索"),
                                              ("en", {"LC_MESSAGES": "en_US.UTF-8"}, "login", "2 of 8", "f: Find")):
        world = h.World(token="")
        s_fixture(world, host)
        t = launch(world, host, run, env=env)
        try:
            t.wait_for(lambda term: search_text_row(term) is not None, "the search row", timeout=60)
            cp.pointer_off(t)
            p = pane(t) if language == "zh" else None
            y = next(y for y, r in enumerate(t.rows()) if "│" in r and r.rsplit("│", 1)[1].strip().startswith("f: "))
            left = cell_of(t.rows()[y], t.rows()[y].rfind("│")) + 1
            t.click(left + 10, y)
            time.sleep(0.5)
            t._write(query)
            t.wait_for(lambda term: query in (search_text_row(term) or ""), f"{query} in the field", timeout=10)
            actual[f"{language} placeholder gone, focused"] = search_text_row(t)
            t.key("esc")
            time.sleep(0.5)
            cp.focus(t)
            for width in (36, 56, 44):
                cp.widen(t, steps[width])
                cp.pointer_off(t)
                row = search_text_row(t) or ""
                border = next(r for r in t.rows() if "│" in r and r.rsplit("│", 1)[1].strip().startswith("f: "))
                columns = 170 - (cell_of(border, border.rfind("│")) + 1)
                actual[f"{language} {width}"] = {"paneColumns": columns, "row": row,
                                                 "whole": row.startswith(word) and query in row and row.endswith(f"{count} ✕ ‹ ›")}
                ev.append(t.snap(f"widths {language} {width}"))
            del p
        except h.ScenarioFailure as failure:
            actual[f"{language} failure"] = str(failure)
            ev.append(t.snap("failure"))
        finally:
            t.close()
            world.remove()
    views = [x for k, x in actual.items() if isinstance(x, dict)]
    ok = (not any(k.endswith("failure") for k in actual) and len(views) == 6 and all(x["whole"] for x in views)
          and sorted({x["paneColumns"] for x in views}) == [36, 44, 56])
    return ("S fixture, Chinese and English", "at 36, 56 and 44 columns the search row holds `f: 搜索` / `f: Find`, the query, "
            "the count (`1 / 8`, `2 of 8`), ✕ and ‹ › on one row; nothing gives way", actual, bool(ok), ev)


# ---------- CT-FIND-002 ----------

def keys(host, run):
    world = h.World(token="")
    s_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        ready(t)
        actual["litAtStart"] = lit(pane(t))
        cp.focus(t)
        t.type("f")
        t.wait_for(lambda term: search(term).get("focused"), "f moving the keys into the field", timeout=10)
        actual["fFocuses"] = True
        t._write("S02")
        p = t.wait_for(lambda term: (q := pane(term)) is not None and ids(q) == ["S02"] and q, "S02 alone", timeout=10)
        ev.append(t.snap("keys typed S02"))
        t.key("enter")
        p = t.wait_for(lambda term: (q := pane(term)) is not None and q.search.get("text") == "" and len(q.entries) > 1 and lit(q) == "S02"
                       and (cp.shown_input(q) or "").startswith("S02") and q,
                       "Enter jumping to S02, opening the preview on it and ending the search", timeout=15)
        transcript = h.transcript_text(t.rows(), p.left)
        actual["enter"] = {"query": p.search["text"], "listed": len(p.entries), "lit": lit(p), "transcriptShowsS02": "S02 写一份 README" in transcript,
                           "preview": (cp.shown_input(p) or "")[:3]}
        ev.append(t.snap("keys Enter jumped"))
        t.key("esc")
        time.sleep(0.5)
        click_field(t)
        t._write("S05")
        wait_query(t, "S05", "a click focusing the field")
        actual["clickFocuses"] = search(t)
        t.key("esc")
        time.sleep(0.5)
        t._write("zz")
        time.sleep(0.8)
        actual["escKeeps"] = {"search": search(t), "composerGotZz": any(re.match(r"^❯\s+zz\s*$", r) for r in t.rows())}
        ev.append(t.snap("keys Esc kept the query, zz in the composer"))
        t.key(*["backspace"] * 2)
        click_clear(t)
        p = t.wait_for(lambda term: (q := pane(term)) is not None and q.search.get("text") == "" and len(q.entries) > 1 and q,
                       "✕ clearing the query", timeout=10)
        actual["clearMark"] = {"search": p.search, "listed": len(p.entries)}
        set_query(t, "abc")
        t._write("\x15")
        p = wait_query(t, "", "Ctrl+U clearing the query")
        actual["ctrlU"] = {"search": p.search, "listed": len(p.entries)}
        t._write("ab")
        wait_query(t, "ab")
        t.key("backspace", "backspace")
        p = wait_query(t, "", "Backspace clearing the query")
        actual["backspace"] = {"search": p.search, "listed": len(p.entries)}
        before = lit(p)
        t._write("nowhere")
        t.wait_for(lambda term: search(term).get("count") == f"0 / {GROUPS}", "no match", timeout=10)
        t.key("enter")
        p = wait_query(t, "", "Enter with no match clearing the query")
        time.sleep(1.0)
        actual["enterNoMatch"] = {"search": search(t), "litBefore": before, "litAfter": lit(pane(t)), "listed": len(pane(t).entries)}
        ev.append(t.snap("keys Enter with no match"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    cleared = lambda x: x is not None and x["search"].get("text") == "" and not x["search"].get("clear") and x["listed"] > 1  # noqa: E731
    ok = ("failure" not in actual and actual.get("fFocuses")
          and actual["enter"]["lit"] == "S02" and actual["enter"]["query"] == "" and actual["enter"]["transcriptShowsS02"]
          and actual["enter"]["preview"] == "S02"
          and actual["clickFocuses"].get("focused") and actual["clickFocuses"].get("text") == "S05"
          and actual["escKeeps"]["search"].get("text") == "S05" and not actual["escKeeps"]["search"].get("focused")
          and actual["escKeeps"]["composerGotZz"]
          and cleared(actual.get("clearMark")) and cleared(actual.get("ctrlU")) and cleared(actual.get("backspace"))
          and actual["enterNoMatch"]["search"].get("text") == "" and actual["enterNoMatch"]["litAfter"] == actual["enterNoMatch"]["litBefore"])
    return ("S fixture", "f focuses the field; Enter on S02 jumps there (lit, in the transcript), opens the preview on it "
            "and ends the search; a "
            "click focuses the field; Esc keeps the query and the next letters go to the composer; ✕, Ctrl+U and "
            "Backspace empty it; Enter with no match only clears it", actual, bool(ok), ev)


def entry(host, run):
    world = h.World(token="")
    s_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        ready(t)
        set_query(t, "login")
        t.wait_for(lambda term: ids(pane(term)) == ["S00", "S01"], "S00 and S01", timeout=10)
        target = None
        for step in range(6):
            t.key("down")
            y = ring_row(t)
            p = pane(t)
            e = cp.entry_at(p, y) if y is not None else None
            actual.setdefault("ring", []).append({"row": y, "entry": e.user_text if e else None})
            if e is not None:
                target = label(e)
                break
        if target is None:
            raise h.ScenarioFailure("↓ from the field never reached an entry")
        ev.append(t.snap("entry ring on a match"))
        t.key("enter")
        p = t.wait_for(lambda term: (q := pane(term)) is not None and lit(q) == target and (cp.shown_input(q) or "").startswith(target) and q,
                       f"Enter jumping to {target} and opening the preview on it", timeout=15)
        actual["after"] = {"target": target, "lit": lit(p), "search": p.search, "listed": ids(p), "preview": (cp.shown_input(p) or "")[:3]}
        ev.append(t.snap("entry Enter jumped, search kept"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    ok = ("failure" not in actual and actual["after"]["lit"] == actual["after"]["target"] in ("S00", "S01")
          and actual["after"]["search"].get("text") == "login" and actual["after"]["listed"] == ["S00", "S01"]
          and actual["after"]["preview"] == actual["after"]["target"])
    return ("S fixture, the query login", "↓ from the field reaches a match; Enter on it jumps (lit) and opens the preview "
            "on it, and the search stays: the query and the two matches", actual, bool(ok), ev)


def keep(host, run):
    world = h.World(token="")
    s_fixture(world, host)
    git_project(world)
    actual, ev = {}, []
    t = launch(world, host, run)
    query = "登录"
    held = lambda term: (q := pane(term)) is not None and q.search is not None and q.search.get("text") == query and q  # noqa: E731
    try:
        ready(t)
        set_query(t, query)
        t.key("esc")
        time.sleep(0.5)
        p = pane(t)
        click_text(t, "2: 用户", row=p.filter_row, right_of=p.left)
        p = t.wait_for(lambda term: (q := held(term)) and q.filter == "user" and q, "the query after a filter switch", timeout=10)
        actual["filter"] = {"filter": p.filter, "search": p.search, "listed": ids(p)}
        click_text(t, "1: 全部", row=p.filter_row, right_of=p.left)
        time.sleep(0.5)
        click_text(t, "l: 布局", right_of=pane(t).left)
        p = t.wait_for(lambda term: (q := held(term)) and q.layout == "紧凑" and q, "the query after a Layout switch", timeout=10)
        actual["layout"] = {"layout": p.layout, "search": p.search}
        ev.append(t.snap("keep after filter and Layout"))
        t.command("/diff", wait=3.0)
        rows = t.settle(quiet=1.5)
        behind = v.parse_pane(rows)
        actual["diffInFront"] = behind is None or behind.search is None
        click_tab(t, "目录")
        p = t.wait_for(held, "the query after a back tab", timeout=10)
        actual["backTab"] = {"search": p.search}
        ev.append(t.snap("keep after a back tab"))
        close_mark(t)
        t.wait_for(lambda term: pane(term) is None or pane(term).search is None, "the Pane closed", timeout=10)
        actual["closed"] = True
        t.command("/chat-toc", wait=2.0)
        p = t.wait_for(held, "the query after a close and reopen", timeout=15)
        actual["reopened"] = {"search": p.search, "listed": ids(p)}
        ev.append(t.snap("keep after close and reopen"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    ok = ("failure" not in actual and actual.get("diffInFront") and actual.get("closed")
          and all(actual[k]["search"].get("text") == query for k in ("filter", "layout", "backTab", "reopened")))
    return ("S fixture, the query 登录", "the query stays in the field after a switch to 用户, a switch to 紧凑, /diff in "
            "front and the Pane's tab clicked back, and the Pane closed by its ✕ and reopened by /chat-toc", actual, bool(ok), ev)


def minimap(host, run):
    world = h.World(token="")
    s_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        ready(t)
        for query, want in (("login", [0, 1]), ("S02", [2]), ("nowhere", [])):
            set_query(t, query)
            time.sleep(0.6)
            cp.pointer_off(t)
            cells = bar_cells(t, pane(t))
            actual[query] = {"cells": len(cells), "lit": [i for i, on in enumerate(cells) if on]}
            ev.append(t.snap(f"minimap {query}"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    ok = ("failure" not in actual and all(actual[q]["cells"] == GROUPS for q in ("login", "S02", "nowhere"))
          and actual["login"]["lit"] == [0, 1] and actual["S02"]["lit"] == [2] and actual["nowhere"]["lit"] == [])
    return ("S fixture", "the Minimap still draws all 8 cells; login lights cells 0 and 1, S02 cell 2, nowhere none",
            actual, bool(ok), ev)


SCENARIOS = {
    "narrow": ("CT-FIND-001", narrow), "filter": ("CT-FIND-001", filter_fields), "live": ("CT-FIND-001", live),
    "widths": ("CT-FIND-001", widths),
    "keys": ("CT-FIND-002", keys), "entry": ("CT-FIND-002", entry), "keep": ("CT-FIND-002", keep),
    "minimap": ("CT-FIND-002", minimap),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", action="append", default=[])
    parser.add_argument("--only", default="")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    failed = 0
    for version in args.host or ["current"]:
        host = h.Host(version)
        run = h.Run(args.out, f"ct-search-{host.version}")
        for name in [n for n in args.only.split(",") if n] or list(SCENARIOS):
            scenario, fn = SCENARIOS[name]
            try:
                fixture, expected, actual, ok, evidence = fn(host, run)
            except Exception as error:                      # a scenario that crashed is a failed scenario
                fixture, expected, actual, ok, evidence = name, name, {"error": repr(error)}, False, []
            run.record(scenario, host=host.version, plugin=str(PLUGIN), fixture=fixture, expected=expected,
                       actual=json.loads(json.dumps(actual, ensure_ascii=False, default=str)),
                       result="pass" if ok else "fail", evidence=[e for e in evidence if e], notes=name)
            print(f"{scenario} {name} {host.version}: {'pass' if ok else 'FAIL'}", flush=True)
            failed += 0 if ok else 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
