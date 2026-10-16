#!/usr/bin/env python3
"""CT-STEP-001 in a real host (chat-toc 0.2 spec §6; ticket 18): the ‹ ›
Buttons stepping the transcript to the previous or next Turn group.

    $PY ct_step.py --host 2.1.287 [--host current] [--only pane,keys] [--out DIR]

  pane   clicks on the search row's ‹ ›: from the newest group › does
         nothing; ‹ walks back group by group to K02 (each lit, its prompt
         at the transcript's top); K00 and K01, compacted before the resume,
         have no Jump target, so ‹ from K02 says 无法跳转 on the notes line
         and stays; › goes on to K03. Under Agent › skips K04 (no reply) for
         K05, landing on its reply. With the query `needle` (K06, K08) ›
         walks K06, K08, then nothing; ‹ goes back to K06; the query stays.
  keys   the world's keybindings.json binds meta+k / meta+j to the borrowed
         actions: from the composer they step as the clicks do, during a
         running turn too (fake_api.py, no model); with the Pane closed the
         band draws ‹ › and the keys and a click on it step; with /diff in
         front the band draws them again and the keys step; the Pane's tab
         clicked back to the front, the band goes.

The session is the K fixture built here, resumed in the harness's isolated,
logged-out world: no model call outside the scripted turn.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ct_preview as cp  # noqa: E402
import ct_search as cs  # noqa: E402
import fake_api  # noqa: E402
import pty_harness as h  # noqa: E402
import transcript_fixture as tf  # noqa: E402
from gate_scenarios import FAKE_KEY, fake_api_world  # noqa: E402

PLUGIN = HERE.parent.parent
SESSION = "00000000-0000-4000-8000-0000000018a0"
GROUPS = 10
NO_REPLY = 4
NEEDLE = (6, 8)
# each reply taller than the screen's half, so a jump moves the view
REPLY_LINES = 24
PREVIOUS, NEXT = "\x1bk", "\x1bj"
BINDINGS = {"bindings": [{"context": "Global", "bindings": {
    "meta+k": "app:toggleDiffNoiseFilter", "meta+j": "app:toggleDiffPreSession"}}]}
BAND = "☰ ChatTOC"


# ---------- the K fixture ----------

def k_fixture(world: h.World, host: h.Host) -> dict:
    """K00 and K01, then a compaction, then K02..K09; K04 has no reply; the
    replies of K06 and K08 hold `needle`."""
    t = tf.Transcript(world.transcript(SESSION), str(world.project), SESSION, version=host.version)
    for i in range(GROUPS):
        if i == 2:
            t.compact(trigger="auto")
        t.prompt(f"K{i:02d} 问题 {i}")
        if i != NO_REPLY:
            body = "\n".join(f"第 {n} 行说明" for n in range(1, REPLY_LINES))
            t.reply(f"K{i:02d} 回复" + (" needle" if i in NEEDLE else "") + "\n\n" + body)
    t.close()
    return {"session": SESSION}


# ---------- reading ----------

pane = cp.pane


def label(e) -> int | None:
    text = e.user_text or " ".join([e.agent_head or "", *e.agent_lines])
    m = re.search(r"\bK(\d\d)\b", text)
    return int(m.group(1)) if m else None


def lit(p) -> int | None:
    e = next((e for e in p.entries if e.highlighted), None) if p else None
    return label(e) if e else None


def top(t) -> list[int]:
    """The groups the transcript's first rows name (by prompt or reply),
    from row 1: row 0 holds the host's pinned prompt once scrolled."""
    rows = t.rows()
    p = pane(t)
    text = h.transcript_text(rows, p.left) if p else "\n".join(rows)
    return [int(n) for n in re.findall(r"K(\d\d) (?:问题|回复)", "\n".join(text.splitlines()[1:6]))]


def shown(t) -> list[int]:
    """The groups whose prompt the transcript shows anywhere."""
    rows = t.rows()
    p = pane(t)
    text = h.transcript_text(rows, p.left) if p else "\n".join(rows)
    return sorted({int(n) for n in re.findall(r"K(\d\d) 问题", text)})


def front_side(t) -> list[str]:
    """What the pane in front draws: the rows right of its border."""
    return [r.rsplit("│", 1)[1].strip() for r in t.rows() if "│" in r and r.rsplit("│", 1)[1].strip()]


def band_row(t) -> str | None:
    return next((r for r in t.rows() if BAND in r), None)


def notes(t) -> bool:
    return any("无法跳转" in r for r in t.rows())


def click_step(t, mark: str) -> None:
    p = pane(t)
    cs.click_text(t, mark, row=cs.search_row(t), right_of=p.left)
    cp.pointer_off(t)


def click_band(t, mark: str) -> None:
    y = next(y for y, r in enumerate(t.rows()) if BAND in r)
    row = t.rows()[y]
    t.click(cs.cell_of(row, row.index(mark, row.index(BAND))), y)
    time.sleep(0.4)
    cp.pointer_off(t)


def wait_lit(t, group: int, what: str):
    return t.wait_for(lambda term: (q := pane(term)) is not None and lit(q) == group and q, what, timeout=10)


def launch(world, host, run, env=None):
    return h.launch(world, host, [PLUGIN], ["--resume", SESSION], run=run, env=env)


def ready(t):
    t.wait_for(lambda term: (p := pane(term)) is not None and p.entries and p.search is not None and lit(p) == GROUPS - 1,
               "the Pane, the newest group lit", timeout=60)
    cp.pointer_off(t)


# ---------- CT-STEP-001 ----------

def pane_clicks(host, run):
    world = h.World(token="")
    k_fixture(world, host)
    actual, ev = {}, []
    t = launch(world, host, run)
    try:
        ready(t)
        actual["searchRow"] = pane(t).search
        before = top(t)
        click_step(t, "›")
        time.sleep(1.0)
        actual["nextAtEnd"] = {"lit": lit(pane(t)), "top": top(t), "topBefore": before}
        walk = []
        for want in range(GROUPS - 2, 1, -1):
            click_step(t, "‹")
            p = wait_lit(t, want, f"‹ lighting K{want:02d}")
            walk.append({"lit": lit(p), "top": top(t)})
        actual["back"] = walk
        ev.append(t.snap("pane walked back to K02"))
        click_step(t, "‹")
        t.wait_for(lambda term: notes(term), "the notice for the compacted groups", timeout=10)
        actual["pastCompacted"] = {"notice": True, "lit": lit(pane(t)), "top": top(t)}
        ev.append(t.snap("pane ‹ from K02: the notice"))
        click_step(t, "›")
        p = wait_lit(t, 3, "› lighting K03")
        actual["forward"] = {"lit": lit(p), "top": top(t)}
        p = pane(t)
        cs.click_text(t, "3: Agent", row=p.filter_row, right_of=p.left)
        t.wait_for(lambda term: (q := pane(term)) is not None and q.filter == "agent", "the Agent filter", timeout=10)
        click_step(t, "›")
        p = wait_lit(t, 5, "› under Agent lighting K05")
        actual["agent"] = {"lit": lit(p), "top": top(t),
                           "replyAtTop": "K05 回复" in "\n".join(h.transcript_text(t.rows(), p.left).splitlines()[1:6])}
        ev.append(t.snap("pane › under Agent: K05's reply"))
        cs.click_text(t, "1: 全部", row=p.filter_row, right_of=p.left)
        t.wait_for(lambda term: (q := pane(term)) is not None and q.filter == "all", "the All filter", timeout=10)
        cs.set_query(t, "needle")
        t.key("esc")
        time.sleep(0.5)
        cp.pointer_off(t)
        query = []
        for mark, want in (("›", 6), ("›", 8)):
            click_step(t, mark)
            p = wait_lit(t, want, f"{mark} under the query lighting K{want:02d}")
            query.append({"lit": lit(p), "top": top(t), "search": p.search, "listed": [label(e) for e in p.entries]})
        click_step(t, "›")
        time.sleep(1.0)
        p = pane(t)
        query.append({"lit": lit(p), "top": top(t), "search": p.search})
        click_step(t, "‹")
        p = wait_lit(t, 6, "‹ under the query lighting K06")
        query.append({"lit": lit(p), "top": top(t), "search": p.search})
        actual["query"] = query
        ev.append(t.snap("pane under the query needle"))
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
        ev.append(t.snap("failure"))
    finally:
        t.close()
        world.remove()
    q = actual.get("query", [])
    ok = ("failure" not in actual and (actual["searchRow"] or {}).get("step")
          and actual["nextAtEnd"]["lit"] == GROUPS - 1 and actual["nextAtEnd"]["top"] == actual["nextAtEnd"]["topBefore"]
          and [w["lit"] for w in actual["back"]] == list(range(GROUPS - 2, 1, -1))
          and all(w["top"][:1] == [w["lit"]] for w in actual["back"])
          and actual["pastCompacted"]["lit"] == 2
          and actual["forward"]["lit"] == 3 and actual["forward"]["top"][:1] == [3]
          and actual["agent"]["lit"] == 5 and actual["agent"]["replyAtTop"]
          and [x["lit"] for x in q] == [6, 8, 8, 6] and all(x["search"].get("text") == "needle" for x in q)
          and q[0]["listed"] == [6, 8])
    return ("K fixture (K00-K01 compacted before the resume, K04 without a reply, needle in K06 and K08)",
            "the search row ends in ‹ ›; › at the newest group does nothing; ‹ walks K08..K02, each lit with its prompt "
            "at the transcript's top; ‹ from K02 says 无法跳转 (K00, K01 unjumpable) and stays; › to K03; under Agent "
            "› skips K04 for K05's reply; with the query needle › walks K06, K08, then nothing, ‹ back to K06, the "
            "query kept", actual, bool(ok), ev)


def keys(host, run):
    world = h.World(token="")
    fake_api_world(world)
    (world.config / "keybindings.json").write_text(json.dumps(BINDINGS, indent=1))
    (world.project / "notes.txt").write_text("CT-SYN notes\n")
    k_fixture(world, host)
    cs.git_project(world)
    actual, ev = {}, []
    with fake_api.FakeApi("KSTEP-TURN", str(world.project / "notes.txt"), steps=3, delay=5.0, reply="K10 完成") as api:
        t = launch(world, host, run, env={"ANTHROPIC_BASE_URL": api.url, "ANTHROPIC_API_KEY": FAKE_KEY})
        try:
            ready(t)
            steps = []
            for key, want in ((PREVIOUS, 8), (PREVIOUS, 7), (NEXT, 8)):
                t._write(key)
                p = wait_lit(t, want, f"{'meta+k' if key == PREVIOUS else 'meta+j'} lighting K{want:02d}")
                steps.append({"lit": lit(p), "top": top(t)})
            actual["composer"] = steps
            composer = cs.search(t)
            actual["composerUntouched"] = not any(re.match(r"^❯\s+\S", r) for r in t.rows()[-8:])
            ev.append(t.snap("keys from the composer"))
            t.type("KSTEP-TURN go")
            time.sleep(0.4)
            t.key("enter")
            t.wait_for(lambda term: (q := pane(term)) is not None and any(e.agent_head and "进行中" in e.agent_head for e in q.entries),
                       "the running turn", timeout=20)
            t._write(PREVIOUS)
            p = t.wait_for(lambda term: (q := pane(term)) is not None and lit(q) == GROUPS - 1 and q, "meta+k during the turn", timeout=6)
            actual["duringTurn"] = {"lit": lit(p), "top": top(t), "inView": shown(t),
                                    "running": any(e.agent_head and "进行中" in e.agent_head for e in p.entries)}
            ev.append(t.snap("keys meta+k during a turn"))
            t.wait_for(lambda term: (q := pane(term)) is not None and not any(e.agent_head and "进行中" in e.agent_head for e in q.entries),
                       "the turn ending", timeout=40)
            del composer
            # the Pane closed: the band carries ‹ ›
            cs.close_mark(t)
            t.wait_for(lambda term: pane(term) is None and band_row(term) is not None, "the band with the Pane closed", timeout=10)
            cp.pointer_off(t)
            actual["bandClosed"] = band_row(t).strip()
            before = top(t)
            t._write(PREVIOUS)
            t.wait_for(lambda term: top(term) != before and top(term), "meta+k from the band moving the transcript", timeout=10)
            after = top(t)
            click_band(t, "‹")
            t.wait_for(lambda term: top(term) != after and top(term), "a click on the band's ‹ moving the transcript", timeout=10)
            actual["closed"] = {"before": before, "afterKey": after, "afterClick": top(t)}
            ev.append(t.snap("keys band with the Pane closed"))
            t.command("/chat-toc", wait=2.0)
            t.key("esc")
            t.wait_for(lambda term: pane(term) is not None and band_row(term) is None, "the Pane back, no band", timeout=10)
            # /diff in front: the Pane a back tab, the band again
            t.command("/diff", wait=3.0)
            t.wait_for(lambda term: band_row(term) is not None, "the band with /diff in front", timeout=10)
            cp.pointer_off(t)
            actual["bandBackTab"] = band_row(t).strip()
            # the last groups (the turn's, /diff's) sit at the transcript's
            # end, where a jump moves little: three steps each way. The Diff
            # pane in front leaves the two borrowed actions to the band.
            before, front_before = top(t), front_side(t)
            for _ in range(3):
                t._write(PREVIOUS)
                time.sleep(1.0)
            cp.pointer_off(t)
            t.wait_for(lambda term: top(term) != before and top(term), "meta+k from the band moving the transcript", timeout=10)
            actual["backTabKey"] = {"before": before, "after": top(t), "frontBefore": front_before, "frontAfter": front_side(t)}
            ev.append(t.snap("keys meta+k with /diff in front"))
            before = top(t)
            for _ in range(3):
                click_band(t, "‹")
                time.sleep(0.8)
            t.wait_for(lambda term: top(term) != before and top(term), "clicks on the band's ‹ moving the transcript", timeout=10)
            actual["backTabClick"] = {"before": before, "after": top(t)}
            ev.append(t.snap("keys band with /diff in front"))
            cs.click_tab(t, "目录")
            t.wait_for(lambda term: pane(term) is not None and pane(term).entries and band_row(term) is None, "the band gone with the Pane in front", timeout=10)
            actual["bandGoneInFront"] = True
            ev.append(t.snap("keys Pane in front again, no band"))
        except h.ScenarioFailure as failure:
            actual["failure"] = str(failure)
            ev.append(t.snap("failure"))
        finally:
            t.close()
            world.remove()
    has_step = lambda row: row is not None and "‹ ›" in row  # noqa: E731
    ok = ("failure" not in actual and [s["lit"] for s in actual["composer"]] == [8, 7, 8]
          and all(s["top"][:1] == [s["lit"]] for s in actual["composer"]) and actual["composerUntouched"]
          and actual["duringTurn"]["lit"] == GROUPS - 1 and actual["duringTurn"]["running"] and GROUPS - 1 in actual["duringTurn"]["inView"]
          and actual["backTabKey"]["frontAfter"] == actual["backTabKey"]["frontBefore"]
          and actual["backTabClick"]["after"] != actual["backTabClick"]["before"]
          and has_step(actual.get("bandClosed")) and has_step(actual.get("bandBackTab")) and actual.get("bandGoneInFront"))
    return ("K fixture, keybindings.json binding meta+k / meta+j, one live turn against fake_api.py (no model)",
            "from the composer meta+k, meta+k, meta+j light K08, K07, K08 with each prompt at the top and the composer "
            "untouched; during a running turn meta+k lights K09 (in view); the Pane closed, the band draws ‹ › and "
            "meta+k and a click on its ‹ move the transcript; with /diff in front the band draws ‹ › again, meta+k "
            "moves the transcript and leaves Diff as it was, clicks on its ‹ move it too; the Pane's tab clicked, "
            "the band goes", actual, bool(ok), ev)


SCENARIOS = {"pane": pane_clicks, "keys": keys}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", action="append", default=[])
    parser.add_argument("--only", default="")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    failed = 0
    for version in args.host or ["current"]:
        host = h.Host(version)
        run = h.Run(args.out, f"ct-step-{host.version}")
        for name in [n for n in args.only.split(",") if n] or list(SCENARIOS):
            fn = SCENARIOS[name]
            try:
                fixture, expected, actual, ok, evidence = fn(host, run)
            except Exception as error:                      # a scenario that crashed is a failed scenario
                fixture, expected, actual, ok, evidence = name, name, {"error": repr(error)}, False, []
            run.record("CT-STEP-001", host=host.version, plugin=str(PLUGIN), fixture=fixture, expected=expected,
                       actual=json.loads(json.dumps(actual, ensure_ascii=False, default=str)),
                       result="pass" if ok else "fail", evidence=[e for e in evidence if e], notes=name)
            print(f"CT-STEP-001 {name} {host.version}: {'pass' if ok else 'FAIL'}", flush=True)
            if not ok:
                print(json.dumps(actual, ensure_ascii=False, default=str)[:3000], flush=True)
            failed += 0 if ok else 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
