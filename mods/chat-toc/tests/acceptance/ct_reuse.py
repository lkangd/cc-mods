#!/usr/bin/env python3
"""CT-REUSE-001 in a real host (chat-toc 0.2 spec §7; ticket 17): Reuse and
copy from the preview's label rows.

    $PY ct_reuse.py --host 2.1.287 [--host current] [--only fill,copy,rules,hidden,dialog,running,widths] [--out DIR]

  fill     `r` on R00 (a prompt with a code block) fills the empty composer
           with the input as typed, and the keyboard moves there; with a draft
           typed, `r` on R04 appends after a blank line; nothing is submitted
  copy     `c` puts R00's whole input on the clipboard and its Button reads
           `c: 已复制`; the keys stay in the Pane, so `a` then copies the reply
           as its Markdown source; about 2 s later both read `复制` again
  rules    the `!cmd` has `c` but no `r`, and `c` copies `!echo R01`; the
           image-only input has neither; R03 (text and an image) fills its
           text only, with the `图片未包含` toast
  hidden   folded by `p`, `r`, `c` and `a` do nothing; a short terminal whose
           preview cuts the `Agent` label row takes `a` with it, and after `e`
           `a` copies again
  dialog   a click on `r: 填入` under `/model`'s picker shows the
           `无法填入：有对话框打开` toast and leaves the composer empty
  running  a live turn against fake_api.py (no model): its preview has
           `r: 填入 · c: 复制` and no `a`; a click on `r: 填入` fills its input
           while it runs; once it ends `a: 复制` is drawn
  widths   at 36 columns the label rows hold their Buttons on one row, in
           Chinese and in English (`Copied` too)

The session is a synthetic transcript built here (the R fixture), resumed
in the harness's isolated, logged-out world: no model call. The person's
clipboard is saved first and put back at the end.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402
import transcript_fixture as tf  # noqa: E402
import fake_api  # noqa: E402
from gate_scenarios import FAKE_KEY, fake_api_world  # noqa: E402
from ct_preview import body, focus, listed, pane, pointer_off, shown_input, widen  # noqa: E402

PLUGIN = HERE.parent.parent
SESSION = "00000000-0000-4000-8000-0000000017a0"
ID = "CT-REUSE-001"
IMAGE = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}}
R00 = "R00 修一下\n\n```ts\nconst a = 1\n```"
R00_REPLY = "## R00 完成\n\n- `one`"
SENTINEL = "CT-REUSE clipboard before"


def r_fixture(world: h.World, host: h.Host) -> None:
    t = tf.Transcript(world.transcript(SESSION), str(world.project), SESSION, version=host.version)
    t.prompt(R00)
    t.reply(R00_REPLY)
    t.bang("echo R01", "R01")
    t.prompt([IMAGE])
    t.reply("R02 回复")
    t.prompt([{"type": "text", "text": "R03 看图 [Image #1]"}, IMAGE])
    t.reply("R03 回复")
    t.prompt("R04 小问题")
    t.reply("R04 回复")
    t.close()


# ---------- the clipboard, the composer, the label rows ----------

def pbpaste() -> str:
    return subprocess.run(["pbpaste"], capture_output=True).stdout.decode(errors="replace")


def pbcopy(text: str) -> None:
    subprocess.run(["pbcopy"], input=text.encode())


def composer(t) -> list[str]:
    """The prompt box's lines, between the last two full-width rules, its
    `❯ ` and continuation indent taken off."""
    rows = t.rows()
    rules = [i for i, r in enumerate(rows) if r.startswith("─" * 40)]
    if len(rules) < 2:
        return ["<no composer>"]
    lines = [r.rstrip() for r in rows[rules[-2] + 1:rules[-1]]]
    # the host draws the prompt mark with a no-break space after it
    return [line[2:] if line[:1] in ("❯", " ") and line[1:2] in (" ", "\xa0") else line.lstrip("❯") for line in lines]


def clear_composer(t, n: int = 120) -> None:
    t._write("\x7f" * n)
    time.sleep(0.6)


def labels(p) -> dict:
    """The label rows of the preview (or the expanded view), by label."""
    out = {}
    for row in body(p) if p is not None else []:
        words = row.split()
        if words[:1] in (["用户"], ["Agent"]) and words[0] not in out:
            out[words[0]] = " ".join(words[1:])
    return out


def walk_to(t, prefix: str) -> bool:
    for _ in range(40):
        t.key("up")
        if (shown_input(pane(t)) or "").startswith(prefix):
            return True
    return False


def groups_of(world) -> int:
    """The Turn groups the file holds: a submit would add one."""
    return len(v.expected_toc(world.transcript(SESSION)).groups)


def scenario(world, host, run, steps):
    """Runs `steps(t, actual, ev)` on the R fixture resumed, then removes the world."""
    actual, ev = {}, []
    t = h.launch(world, host, [PLUGIN], ["--resume", SESSION], run=run)
    try:
        t.wait_for(listed, "the Pane with its preview", timeout=60)
        steps(t, actual, ev)
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    return actual, ev


# ---------- scenarios: each returns (fixture, expected, actual, ok, evidence) ----------

def fill(host, run):
    world = h.World(token="")
    r_fixture(world, host)
    before = groups_of(world)

    def steps(t, actual, ev):
        focus(t)
        if not walk_to(t, "R00"):
            raise h.ScenarioFailure("the preview never showed R00")
        actual["labels"] = labels(pane(t))
        t.type("r")
        t.wait_for(lambda term: "R00 修一下" in composer(term), "R00 in the composer", timeout=5)
        actual["filled"] = composer(t)
        ev.append(t.snap("fill R00"))
        t.type("Q")
        time.sleep(0.6)
        actual["typedAfter"] = composer(t)[-1]
        clear_composer(t)
        t.type("R 草稿")
        time.sleep(0.5)
        focus(t)
        if not walk_to(t, "R04"):
            raise h.ScenarioFailure("the preview never showed R04")
        t.type("r")
        t.wait_for(lambda term: "R04 小问题" in composer(term), "R04 after the draft", timeout=5)
        actual["appended"] = composer(t)
        ev.append(t.snap("fill appended"))
        time.sleep(1.0)
        actual["notLoggedInAnswer"] = t.find("Please run /login") is not None
        actual["groups"] = {"before": before, "after": groups_of(world)}
        clear_composer(t)

    actual, ev = scenario(world, host, run, steps)
    groups = actual.get("groups", {})
    ok = (groups.get("before") == groups.get("after") == 5 and "failure" not in actual and actual.get("labels", {}).get("用户") == "r: 填入 · c: 复制"
          and actual.get("filled") == R00.split("\n") and actual.get("typedAfter") == "```Q"
          and actual.get("appended") == ["R 草稿", "", "R04 小问题"] and actual.get("notLoggedInAnswer") is False)
    return ("R fixture", "`r` on R00 fills the empty composer with its five lines as typed and the next key lands "
            "there (```Q); with `R 草稿` typed, `r` on R04 gives `R 草稿`, a blank line, `R04 小问题`; nothing is sent",
            actual, bool(ok), ev)


def copy(host, run):
    world = h.World(token="")
    r_fixture(world, host)
    pbcopy(SENTINEL)

    def steps(t, actual, ev):
        focus(t)
        if not walk_to(t, "R00"):
            raise h.ScenarioFailure("the preview never showed R00")
        t.type("c")
        time.sleep(0.8)
        actual["afterC"] = {"clipboard": pbpaste(), "labels": labels(pane(t))}
        ev.append(t.snap("copy c"))
        t.type("a")
        time.sleep(0.8)
        actual["afterA"] = {"clipboard": pbpaste(), "labels": labels(pane(t))}
        ev.append(t.snap("copy a"))
        time.sleep(2.5)
        actual["later"] = labels(pane(t))

    actual, ev = scenario(world, host, run, steps)
    c, a = actual.get("afterC", {}), actual.get("afterA", {})
    ok = ("failure" not in actual and c.get("clipboard") == R00 and c.get("labels", {}).get("用户") == "r: 填入 · c: 已复制"
          and a.get("clipboard") == R00_REPLY and a.get("labels", {}).get("Agent") == "a: 已复制"
          and actual.get("later") == {"用户": "r: 填入 · c: 复制", "Agent": "a: 复制"})
    return ("R fixture", "`c` on R00 copies its input whole (the code block too) and its Button reads `c: 已复制`; "
            "`a` copies the reply's Markdown source `## R00 完成…` and reads `a: 已复制`; 2.5 s later both read `复制`",
            actual, bool(ok), ev)


def rules(host, run):
    world = h.World(token="")
    r_fixture(world, host)
    pbcopy(SENTINEL)

    def steps(t, actual, ev):
        focus(t)
        if not walk_to(t, "!echo R01"):
            raise h.ScenarioFailure("the preview never showed R01")
        actual["shell"] = labels(pane(t))
        t.type("c")
        time.sleep(0.8)
        actual["shellCopied"] = pbpaste()
        ev.append(t.snap("rules shell"))
        if not walk_to(t, "（只有图片）"):
            raise h.ScenarioFailure("the preview never showed R02")
        actual["imageOnly"] = labels(pane(t))
        ev.append(t.snap("rules image only"))
        if not walk_to(t, "R03"):
            raise h.ScenarioFailure("the preview never showed R03")
        t.type("r")
        t.wait_for(lambda term: "R03 看图" in composer(term), "R03 in the composer", timeout=5)
        try:
            t.wait_for(lambda term: term.find("图片未包含") is not None, "the images toast", timeout=4)
            toast = True
        except h.ScenarioFailure:
            toast = False
        actual["withImages"] = {"composer": composer(t), "toast": toast}
        ev.append(t.snap("rules with images"))
        clear_composer(t)

    actual, ev = scenario(world, host, run, steps)
    ok = ("failure" not in actual and actual.get("shell", {}).get("用户") == "c: 复制" and actual.get("shellCopied") == "!echo R01"
          and actual.get("imageOnly", {}).get("用户") == "" and actual.get("imageOnly", {}).get("Agent") == "a: 复制"
          and actual.get("withImages") == {"composer": ["R03 看图"], "toast": True})
    return ("R fixture", "R01 (`!echo R01`): `c: 复制` alone, copying `!echo R01`; R02 (image only): `用户` bare, "
            "`a: 复制` kept; R03: `r` fills `R03 看图` and the `图片未包含` toast shows", actual, bool(ok), ev)


def hidden(host, run):
    world = h.World(token="")
    r_fixture(world, host)
    pbcopy(SENTINEL)

    def steps(t, actual, ev):
        focus(t)
        if not walk_to(t, "R00"):
            raise h.ScenarioFailure("the preview never showed R00")
        t.type("p")
        t.wait_for(lambda term: (q := pane(term)) is not None and q.preview is not None and not body(q), "the folded preview", timeout=5)
        # no hotkey is drawn: each key goes back to the composer as typed
        for key in "rca":
            t.type(key)
            time.sleep(0.5)
        actual["folded"] = {"composer": composer(t), "clipboard": pbpaste()}
        ev.append(t.snap("hidden folded"))
        clear_composer(t)
        focus(t)
        t.type("p")
        t.wait_for(lambda term: bool(body(pane(term))), "the preview shown again", timeout=5)
        if not walk_to(t, "R00"):
            raise h.ScenarioFailure("the preview never showed R00 again")
        cut = None
        for lines in range(44, 20, -1):
            t.resize(170, lines)
            time.sleep(0.6)
            t.settle(quiet=0.6)
            q = pane(t)
            if q is not None and q.preview and len(q.preview) <= 5 and (shown_input(q) or "").startswith("R00"):
                cut = lines
                break
        actual["cutAt"] = cut
        if cut is None:
            raise h.ScenarioFailure("no height cut the Agent label row")
        actual["cut"] = {"labels": labels(pane(t)), "preview": pane(t).preview}
        ev.append(t.snap("hidden cut"))
        t.type("a")
        time.sleep(0.6)
        actual["aCut"] = {"composer": composer(t), "clipboard": pbpaste()}
        clear_composer(t)
        focus(t)
        if not walk_to(t, "R00"):
            raise h.ScenarioFailure("the cut preview never showed R00 again")
        t.type("e")
        time.sleep(1.0)
        t.type("a")
        time.sleep(0.8)
        actual["aExpanded"] = pbpaste()
        ev.append(t.snap("hidden expanded"))

    actual, ev = scenario(world, host, run, steps)
    ok = ("failure" not in actual and actual.get("folded") == {"composer": ["rca"], "clipboard": SENTINEL}
          and "Agent" not in actual.get("cut", {}).get("labels", {"Agent": 1})
          and actual.get("aCut") == {"composer": ["a"], "clipboard": SENTINEL}
          and actual.get("aExpanded") == R00_REPLY)
    return ("R fixture", "folded by `p`, `r` `c` `a` are no hotkeys: typed into the composer as `rca`, nothing filled "
            "or copied; at a height whose preview cuts R00 before its `Agent` row, `a` is typed too and copies nothing; "
            "after `e`, `a` copies the reply",
            actual, bool(ok), ev)


def dialog(host, run):
    world = h.World(token="")
    r_fixture(world, host)

    def steps(t, actual, ev):
        pointer_off(t)
        t.command("/model", wait=1.5)
        t.wait_for(lambda term: term.find("Select model") is not None, "the /model picker", timeout=15)
        at = t.find("r: 填入")
        if at is None:
            raise h.ScenarioFailure("no r: 填入 drawn under the picker")
        t.click(at[1] + 1, at[0])
        time.sleep(0.4)
        t.wait_for(lambda term: term.find("无法填入：有对话框打开") is not None, "the dialog toast", timeout=4)
        actual["toast"] = True
        ev.append(t.snap("dialog toast"))
        t.key("esc")
        time.sleep(1.0)
        actual["composer"] = composer(t)
        ev.append(t.snap("dialog closed"))

    actual, ev = scenario(world, host, run, steps)
    ok = "failure" not in actual and actual.get("toast") is True and actual.get("composer") == [""]
    return ("R fixture, /model's picker open", "a click on `r: 填入` under the picker shows `无法填入：有对话框打开`; "
            "once the picker closes the composer is still empty (the text dropped)", actual, bool(ok), ev)


LIVE = "R05 进行中的合成一轮"


def running(host, run):
    world = h.World(token="")
    fake_api_world(world)
    (world.project / "notes.txt").write_text("CT-SYN notes\n")
    r_fixture(world, host)
    actual, ev = {}, []
    with fake_api.FakeApi("R05", str(world.project / "notes.txt"), steps=2, delay=8.0, reply="完成") as api:
        t = h.launch(world, host, [PLUGIN], ["--resume", SESSION], run=run,
                     env={"ANTHROPIC_BASE_URL": api.url, "ANTHROPIC_API_KEY": FAKE_KEY})
        try:
            t.wait_for(listed, "the Pane with its preview", timeout=60)
            t.type(LIVE)
            time.sleep(0.4)
            t.key("enter")
            seen = {}

            def running_now(term):
                q = pane(term)
                if q is None or "进行中" not in (body(q) or [""])[0] or not (shown_input(q) or "").startswith("R05"):
                    return False
                seen.update(labels=labels(q), anyA=term.find("a: 复制") is not None)
                return True

            t.wait_for(running_now, "the running group in the preview", timeout=20)
            actual["running"], actual["anyA"] = seen["labels"], seen["anyA"]
            ev.append(t.snap("running labels"))
            at = t.find("r: 填入")
            if at is None:
                raise h.ScenarioFailure("no r: 填入 while running")
            t.click(at[1] + 1, at[0])
            t.wait_for(lambda term: LIVE in composer(term), "the live input in the composer", timeout=5)
            actual["filledWhileRunning"] = {"composer": composer(t), "stillRunning": "进行中" in (body(pane(t)) or [""])[0]}
            ev.append(t.snap("running filled"))
            t.wait_for(lambda term: (q := pane(term)) is not None and "进行中" not in (body(q) or [""])[0]
                       and labels(q).get("Agent") == "a: 复制", "the turn ended with a: 复制", timeout=40)
            actual["ended"] = labels(pane(t))
            ev.append(t.snap("running ended"))
            clear_composer(t)
        except h.ScenarioFailure as failure:
            actual["failure"] = str(failure)
        finally:
            t.close()
            world.remove()
    ok = ("failure" not in actual and actual.get("running", {}).get("用户") == "r: 填入 · c: 复制" and actual.get("anyA") is False
          and actual.get("filledWhileRunning") == {"composer": [LIVE], "stillRunning": True}
          and actual.get("ended", {}).get("Agent") == "a: 复制")
    return ("R fixture + one live turn against fake_api.py (two Read steps, 8 s apart; no model)",
            "while the turn runs its preview shows `r: 填入 · c: 复制` and no `a: 复制`; a click on `r: 填入` fills "
            "`R05 …` while it still runs; once it ends the `Agent` row has `a: 复制`", actual, bool(ok), ev)


def widths(host, run):
    out = {}
    ev_all = []
    for language, env, user, reuse, copy_, copied, agent_copy in (
            ("zh", None, "用户", "r: 填入", "c: 复制", "c: 已复制", "a: 复制"),
            ("en", {"LC_MESSAGES": "en_US.UTF-8"}, "User", "r: Reuse", "c: Copy", "c: Copied", "a: Copy")):
        world = h.World(token="")
        r_fixture(world, host)
        pbcopy(SENTINEL)
        actual = {}
        t = h.launch(world, host, [PLUGIN], ["--resume", SESSION], run=run, env=env)
        try:
            t.wait_for(lambda term: term.find(f"{reuse} · {copy_}") is not None, "the label row", timeout=60)
            focus(t)
            widen(t, -2)
            pointer_off(t)
            rows = t.rows()
            y = next(i for i, r in enumerate(rows) if f"{reuse} · {copy_}" in r)
            border = rows[y].rfind("│", 0, rows[y].find(reuse))
            # the Pane's rows from the cell after its border (the transcript's
            # side may hold wide characters, so rows are read by cell)
            left = sum(h.cell_width(c) for c in rows[y][:border]) + 1
            right = [r for r in (v._right_of(line, left) for line in rows) if r is not None]
            row = next(r for r in right if reuse in r)
            actual["paneColumns"] = sum(h.cell_width(c) for c in rows[y][border + 1:])
            actual["userRow"] = row
            actual["agentRow"] = next((r for r in right if r.startswith("Agent ")), "")
            t.type("c")
            time.sleep(0.8)
            actual["copiedRow"] = next((r for r in (v._right_of(line, left) for line in t.rows()) if r is not None and copied in r), None)
            ev_all.append(t.snap(f"widths 36 {language}"))
        except (h.ScenarioFailure, StopIteration) as failure:
            actual["failure"] = repr(failure)
        finally:
            t.close()
            world.remove()
        actual["ok"] = ("failure" not in actual and actual["paneColumns"] == 36
                        and actual["userRow"].startswith(user) and actual["userRow"].endswith(f"{reuse} · {copy_}")
                        and actual["agentRow"].endswith(agent_copy)
                        and (actual["copiedRow"] or "").startswith(user) and actual["copiedRow"].endswith(f"{reuse} · {copied}"))
        out[language] = actual
    ok = all(x["ok"] for x in out.values())
    return ("R fixture, the Pane narrowed to 36 columns, Chinese and English",
            "the `用户`/`User` row holds `r: 填入 · c: 复制` / `r: Reuse · c: Copy` at its right on one row, `c: 已复制` / "
            "`c: Copied` too, and the `Agent` row `a: 复制` / `a: Copy`", out, bool(ok), ev_all)


SCENARIOS = {"fill": fill, "copy": copy, "rules": rules, "hidden": hidden, "dialog": dialog, "running": running,
             "widths": widths}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", action="append", default=[])
    parser.add_argument("--only", default="")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    failed = 0
    saved = pbpaste()
    try:
        for version in args.host or ["current"]:
            host = h.Host(version)
            run = h.Run(args.out, f"ct-reuse-{host.version}")
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
    finally:
        pbcopy(saved)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
