#!/usr/bin/env python3
"""The MUST scenarios that had no PTY script before the 0.1.0 release gate
(ticket 29): CT-COMPAT-001, CT-DATA-001..005, CT-TURN-001..005,
CT-UI-001..004 and CT-SEC-001, on one Claude Code version.

    $PY gate_scenarios.py --host 2.1.287 [--only compat-001,data-002,...] [--out DIR]

Every session is a synthetic transcript (or a new session) in the harness's
isolated, logged-out world. No model is called: a submitted prompt is
answered by the host's own "Not logged in" row, and CT-TURN-004's live
「进行中 · N 步」 runs against fake_api.py, a scripted local stand-in for the
Messages API. Verdicts come from toc_verifier against the session's own
transcript file wherever the Pane's entries are judged.

  compat-001     cold start with --plugin-dir: the Pane docks on the right by
                 itself and its whole list equals the verifier's; `claude
                 plugin validate` passes with no error
  data-001       a new session before its first message: the Pane's body is
                 the one line 本会话还没有对话 and no file exists; after the
                 first submit it lists the new file's chain
  data-002       the transcript unreadable (mode 000, then a directory in its
                 place), re-read by a hot reload: no entries, the reason at
                 the bottom; readable again: the entries are back
  data-003       three lines that are not rows in the file: the entries equal
                 the verifier's and the bottom says 有 3 行无法识别
  data-004       a 9 MiB transcript with rows across both 4,000,000 B chunk
                 edges: the whole list equals the verifier's; a submit is read
                 incrementally (one chunk, from the last offset)
  forms          the `forms` fixture's whole list equals the verifier's, and
                 the CT-TURN-001/002/003/004/005 and CT-DATA-005 forms are
                 checked one by one (one record per scenario ID)
  turn-004-live  a turn with two tool steps against fake_api.py: the last
                 entry reads 进行中, 进行中 · 1 步, 进行中 · 2 步, then 2 步
                 and the closing text
  ui-001         1/2/3 switch the View filter at once, each list equals the
                 verifier's for that filter, the preview region drawn under
                 it; the choice survives a new process; a value chat-toc does
                 not know reads as 全部
  ui-002         `l` and the Layout button cycle 卡片/紧凑/时间轴 listing the
                 same entries, each with the preview region under the list;
                 the choice survives a new process; an unknown value reads as
                 卡片 (the region at 36/44/56 columns: ct_preview.py widths)
  ui-003         focused, ↑↓ step one side at a time through the entries
                 without skipping a dimmed one; the inverse ring and the
                 highlight (the dark theme's `suggestion`) are drawn apart;
                 Enter jumps like a click
  ui-004         under dark, light, dark-ansi and light-ansi the lit marks are
                 the theme's `suggestion` and the dimmed text its `inactive`;
                 /theme from Dark to Light redraws the Pane at once; the
                 daltonized themes and auto are recorded, not judged
  sec-001        a synthetic marker prompt is drawn in the Pane and found in
                 none of chat-toc's store (which holds only the View filter,
                 the Layout and the preview's flag), its data directory, the
                 debug log's chat-toc lines, or the run's evidence
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fake_api  # noqa: E402
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402
import transcript_fixture as tf  # noqa: E402

PLUGIN = HERE.parent.parent
EMPTY = "本会话还没有对话"
DENIED = "没有权限读本会话的 transcript，目录无法显示"
FAILED = "读不到本会话的 transcript，目录无法显示"
REFUSED = "这一条当前没有显示在对话里"
# Each theme's `suggestion` (the lit rail marks) and `inactive` (what dimColor
# draws), as pyte reads them; measured the same on 2.1.287 and 2.1.295.
THEMES = {"dark": ("b1b9f9", "999999"), "light": ("5769f7", "666666"),
          "dark-ansi": ("brightblue", "white"), "light-ansi": ("blue", "brightblack")}
DIM = THEMES["dark"][1]                                 # the harness's world is dark
CHUNK = 4_000_000
MARKERS = PLUGIN / "build" / "sec-001-markers.txt"     # gitignored; read by release_gate.py's leak scan
PREVIEW_RULE = re.compile(r"^─ p: 预览 ─+$")
TALL = 60                                               # lines: room for 5 card groups beside the preview's 14 rows


# ---------- helpers ----------

def pane(t):
    return v.parse_pane(t.rows())


def listed(t):
    p = pane(t)
    return p if p is not None and p.entries else None


def right_text(rows):
    """Everything right of the Pane's border, spaces dropped."""
    return "".join("".join(r.rsplit("│", 1)[1].replace("✕", "").split()) for r in rows if "│" in r)


def flat(text):
    return "".join(text.split())


def launch(world, host, run, args=(), plugin=PLUGIN, log=None, env=None, columns=170, lines=44):
    extra = list(args) + (["--debug-file", str(log)] if log else [])
    return h.launch(world, host, [plugin], extra, run=run, env=env, columns=columns, lines=lines)


def submit(t, text):
    t.type(text)
    time.sleep(0.4)
    t.key("enter")
    t.wait_for(lambda term: term.find("Please run /login") is not None, "the host's not-logged-in answer", timeout=30)
    time.sleep(1.0)


def focus_pane(t):
    """Ctrl+X then Tab: the host moves the keyboard into the docked Pane."""
    t._write("\x18")
    time.sleep(0.25)
    t._write("\t")
    t.settle(quiet=0.6)


def pointer_off(t):
    t._write("\x1b[<35;6;6M")
    t.settle(quiet=0.5)


def whole(t, path, chosen=None, in_progress_last=False):
    """Every window of the Pane against the verifier's TOC of `path`."""
    windows = h.read_whole_pane(t)
    toc = v.expected_toc(path)
    result = v.compare_windows(toc.groups, windows, chosen)
    if in_progress_last and not result["ok"]:
        diffs = [v.compare_window(toc.groups, w, chosen, in_progress_last=True) for w in windows]
        result["ok"] = all(d["ok"] for d in diffs) and not result["missing"]
    diff_path = t.run.dir / f"whole-{len(list(t.run.dir.glob('whole-*.json'))) + 1:02d}.json"
    diff_path.write_text(json.dumps([v.compare_window(toc.groups, w, chosen) for w in windows], ensure_ascii=False, indent=1))
    return result, windows, diff_path


def hot_reload(t, plugin, log):
    mark = log.stat().st_size
    module = plugin / "hooks" / "register.tsx"
    module.write_text(module.read_text() + f"\n// gate reload {time.time()}\n")
    t.wait_for(lambda _t: "chat-toc@inline session.start settled" in log.read_text(errors="replace")[mark:],
               "the host to reload chat-toc", timeout=30)
    t.settle(quiet=1.5)


def plugin_copy(run):
    copy = run.dir / f"plugin-{secrets.token_hex(3)}"
    shutil.copytree(PLUGIN, copy, ignore=shutil.ignore_patterns("tests", "build", "node_modules"))
    return copy


def store_files(world):
    return sorted(p for p in (world.config / "plugins" / "store").glob("chat-toc_*.json")) \
        if (world.config / "plugins" / "store").exists() else []


def ring(t):
    """The inverse cells, one (row, text) per row: with the pointer off the
    Pane, the host's focus ring is the only inverse thing."""
    t.settle(quiet=0.6)
    out = []
    for y, row in enumerate(t.styles()):
        s = "".join(c[0] for c in row if c[3]).strip()
        if s:
            out.append((y, s))
    return out


def side_at(p, y):
    """(entry index, 'user'|'agent') of the side whose first line is screen row y."""
    for i, e in enumerate(p.entries):
        if e.user_row == y:
            return i, "user"
        if e.agent_row == y:
            return i, "agent"
    return None


TURN = re.compile(r"T(\d{4})")


def turn_of(text):
    m = TURN.search(text or "")
    return int(m.group(1)) if m else None


# ---------- scenarios: each returns (scenario id, fixture, expected, actual, ok, evidence) or a list of them ----------

def compat_001(host, run):
    world = h.World(token="")
    fx = world.fixture("turns", turns=40, version=host.version)
    log = run.dir / "debug-compat-001.log"
    t = launch(world, host, run, ["--resume", fx["session"]], log=log)
    actual, ev = {}, [log]
    try:
        p = t.wait_for(listed, "the Pane to dock by itself", timeout=40)
        t.settle()
        ev.append(t.snap("compat-001 docked by itself"))
        p = pane(t)
        actual["paneLeftColumn"] = p.left
        actual["dockedRight"] = p.left > 170 // 2
        opens = [line.split("[DEBUG] ", 1)[-1] for line in log.read_text(errors="replace").splitlines()
                 if "ui.open chat-toc chat-toc" in line]
        actual["hostOpens"] = opens
        actual["openedUnasked"] = any("(unasked" in line and "placed" in line for line in opens)
        result, windows, diff = whole(t, world.transcript(fx["session"]))
        ev.append(diff)
        actual["wholeList"] = {k: result[k] for k in ("ok", "covered", "missing")} | {"windows": len(windows)}
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    out = subprocess.run([host.binary, "plugin", "validate", str(PLUGIN)], capture_output=True, text=True)
    validate = run.dir / f"validate-{host.version}.log"
    validate.write_text(out.stdout + out.stderr)
    ev.append(validate)
    actual["validate"] = {"exit": out.returncode, "passed": "Validation passed" in out.stdout + out.stderr,
                          "errors": len(re.findall(r"✘|\berror\b", out.stdout + out.stderr, re.I))}
    ok = (actual.get("dockedRight") is True and actual.get("openedUnasked") is True
          and actual.get("wholeList", {}).get("ok") is True
          and actual["validate"]["exit"] == 0 and actual["validate"]["passed"] and actual["validate"]["errors"] == 0)
    return ("CT-COMPAT-001", "turns 40", "cold start, fullscreen, --plugin-dir: the Pane docks on the right by itself "
            "(host: unasked, placed); its whole list equals the verifier's; plugin validate passes with 0 errors",
            actual, ok, ev)


def data_001(host, run):
    world = h.World(token="")
    log = run.dir / "debug-data-001.log"
    t = launch(world, host, run, [], log=log)
    actual, ev = {}, [log]
    folder = tf.project_dir(world.config, str(world.project))
    try:
        p = t.wait_for(lambda term: (q := pane(term)) is not None and not q.entries and q.notes == [EMPTY] and q,
                       "the Pane with only 本会话还没有对话", timeout=40)
        t.settle()
        ev.append(t.snap("data-001 new session, before the first message"))
        p = pane(t)
        files = sorted(folder.glob("*.jsonl")) if folder.exists() else []
        actual["before"] = {"entries": len(p.entries), "notes": p.notes, "transcriptFiles": len(files)}
        submit(t, "CT-SYN 第一条合成 prompt")
        files = sorted(folder.glob("*.jsonl"))
        actual["filesAfterSubmit"] = len(files)
        path = files[0]

        def matches(term):
            q = pane(term)
            return q is not None and q.entries and v.compare_window(v.expected_toc(path).groups, q, in_progress_last=True)["ok"]
        t.wait_for(matches, "the Pane to list the first prompt", timeout=20)
        t.settle()
        ev.append(t.snap("data-001 after the first submit"))
        q = pane(t)
        actual["after"] = {"entries": [e.public() for e in q.entries],
                           "expected": [g.public()["userText"] for g in v.expected_toc(path).groups]}
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    ok = (actual.get("before") == {"entries": 0, "notes": [EMPTY], "transcriptFiles": 0}
          and actual.get("filesAfterSubmit") == 1 and "after" in actual and "failure" not in actual)
    return ("CT-DATA-001", "new session", "before the first message no transcript file exists and the Pane's body is the "
            "one line 本会话还没有对话; after the first submit it lists the new file's chain (verifier)", actual, ok, ev)


def data_002(host, run):
    world = h.World(token="")
    fx = world.fixture("turns", turns=6, version=host.version)
    path = world.transcript(fx["session"])
    copy = plugin_copy(run)
    log = run.dir / "debug-data-002.log"
    t = launch(world, host, run, ["--resume", fx["session"]], plugin=copy, log=log)
    actual, ev = {}, [log]
    aside = path.with_suffix(".aside")
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        t.settle()
        ev.append(t.snap("data-002 readable"))

        def says(text):
            return lambda term: (q := pane(term)) is not None and not q.entries and flat(text) in right_text(term.rows())
        os.chmod(path, 0)
        hot_reload(t, copy, log)
        t.wait_for(says(DENIED), "no entries and the denied reason", timeout=20)
        t.settle()
        ev.append(t.snap("data-002 mode 000 after a re-read"))
        actual["denied"] = {"entries": len(pane(t).entries), "reasonShown": True}

        os.chmod(path, 0o600)
        path.rename(aside)
        path.mkdir()
        hot_reload(t, copy, log)
        t.wait_for(says(FAILED), "no entries and the read-failure reason", timeout=20)
        t.settle()
        ev.append(t.snap("data-002 a directory in its place after a re-read"))
        actual["failed"] = {"entries": len(pane(t).entries), "reasonShown": True}

        path.rmdir()
        aside.rename(path)
        hot_reload(t, copy, log)
        back = t.wait_for(listed, "the entries back once readable", timeout=20)
        t.settle()
        ev.append(t.snap("data-002 readable again"))
        diff = v.compare_window(v.expected_toc(path).groups, pane(t))
        actual["readableAgain"] = {"ok": diff["ok"], "notes": pane(t).notes}
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        if path.is_dir():
            path.rmdir()
        if aside.exists():
            aside.rename(path)
        if path.exists():
            os.chmod(path, 0o600)
        t.close()
        world.remove()
        shutil.rmtree(copy, ignore_errors=True)
    ok = (actual.get("denied", {}).get("entries") == 0 and actual.get("failed", {}).get("entries") == 0
          and actual.get("readableAgain", {}).get("ok") is True and "failure" not in actual)
    return ("CT-DATA-002", "turns 6; mode 000, then a directory, re-read by hot reloads",
            "an unreadable transcript shows no entries and keeps the reason at the bottom (没有权限… / 读不到…), "
            "nothing pieced together from elsewhere; readable again, the entries come back", actual, ok, ev)


def data_003(host, run):
    world = h.World(token="")
    fx = world.fixture("turns", turns=6, version=host.version)
    path = world.transcript(fx["session"])
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    junk = ["this line is not JSON\n", '["a JSON array, not a row"]\n', '{"truncated": \n']
    for at, line in zip((4, 9, 14), junk):
        lines.insert(at, line)
    path.write_text("".join(lines), encoding="utf-8")
    t = launch(world, host, run, ["--resume", fx["session"]])
    actual, ev = {}, []
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        note = "有 3 行无法识别，目录可能不完整"
        t.wait_for(lambda term: flat(note) in right_text(term.rows()), "the unreadable-lines note", timeout=20)
        t.settle()
        ev.append(t.snap("data-003 three unreadable lines"))
        toc = v.expected_toc(path)
        actual["verifierUnreadable"] = toc.unreadable
        actual["noteShown"] = True
        result, windows, diff = whole(t, path)
        ev.append(diff)
        actual["wholeList"] = {k: result[k] for k in ("ok", "covered", "missing")}
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    ok = actual.get("verifierUnreadable") == 3 and actual.get("noteShown") is True and actual.get("wholeList", {}).get("ok") is True
    return ("CT-DATA-003", "turns 6 with 3 lines that are not rows",
            "the lines are skipped, every row is still listed (verifier), and the bottom says 有 3 行无法识别，目录可能不完整 "
            "(N the actual count)", actual, ok, ev)


def straddles(path, edges):
    """For each byte offset, whether a line runs across it (starts before, ends after)."""
    found, offset = {e: False for e in edges}, 0
    with open(path, "rb") as handle:
        for line in handle:
            end = offset + len(line)
            for e in edges:
                if offset < e < end:
                    found[e] = True
            offset = end
    return found


def perf_samples(log):
    out = []
    for line in log.read_text(errors="replace").splitlines():
        at = line.find("chat-toc-perf ")
        if at >= 0:
            try:
                out.append(json.loads(line[at + len("chat-toc-perf "):]))
            except json.JSONDecodeError:
                pass
    return out


def data_004(host, run):
    world = h.World(token="")
    fx = world.fixture("heavy", mib=9, version=host.version)
    path = world.transcript(fx["session"])
    log = run.dir / "debug-data-004.log"
    t = launch(world, host, run, ["--resume", fx["session"]], log=log, env={"CHAT_TOC_PERF": "1"})
    actual, ev = {}, [log]
    try:
        actual["fileBytes"] = path.stat().st_size
        actual["linesAcrossChunkEdges"] = {str(k): s for k, s in straddles(path, (CHUNK, 2 * CHUNK)).items()}
        t.wait_for(listed, "the Pane with entries", timeout=60)
        t.settle(quiet=1.5)
        ev.append(t.snap("data-004 resumed 9 MiB"))
        result, windows, diff = whole(t, path)
        ev.append(diff)
        actual["wholeList"] = {k: result[k] for k in ("ok", "covered", "missing")} | {"windows": len(windows)}
        time.sleep(1.5)                                           # perf lines are flushed 1 s after the first sample
        before = len(perf_samples(log))
        size = path.stat().st_size
        submit(t, "CT-SYN 9 MiB 之后的合成 prompt")

        def matches(term):
            q = pane(term)
            return q is not None and q.entries and v.compare_window(v.expected_toc(path).groups, q, in_progress_last=True)["ok"]
        t.wait_for(matches, "the Pane to list the new prompt", timeout=30)
        t.settle()
        ev.append(t.snap("data-004 after a submit"))
        time.sleep(2.0)
        samples = perf_samples(log)
        whole_reads = [x for s in samples for x in s.get("read.whole", [])]
        tails = [x for s in samples[before:] for x in s.get("read.tail", [])]
        late_whole = [x for s in samples[before:] for x in s.get("read.whole", [])]
        actual["readWhole"] = [{"ms": x[0], "chunks": x[2], "groups": x[3], "size": x[5]} for x in whole_reads]
        actual["readTailAfterSubmit"] = [{"ms": x[0], "chunks": x[2], "size": x[5]} for x in tails]
        actual["wholeReadsAfterSubmit"] = len(late_whole)
        actual["sizeBeforeSubmit"] = size
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    ok = (all(actual.get("linesAcrossChunkEdges", {"x": False}).values())
          and actual.get("wholeList", {}).get("ok") is True
          and any(r["chunks"] >= 3 for r in actual.get("readWhole", []))
          and bool(actual.get("readTailAfterSubmit")) and all(r["chunks"] == 1 for r in actual["readTailAfterSubmit"])
          and actual.get("wholeReadsAfterSubmit") == 0)
    return ("CT-DATA-004", "heavy 9 MiB (rows across the 4,000,000 B and 8,000,000 B chunk edges)",
            "the chunked first read lists what the whole file holds (verifier, every window), rows split across chunk "
            "edges included; the next submit is read incrementally: one chunk from the last offset, no whole re-read",
            actual, ok, ev)


def forms(host, run):
    world = h.World(token="")
    fx = world.fixture("forms", version=host.version)
    path = world.transcript(fx["session"])
    t = launch(world, host, run, ["--resume", fx["session"]])
    actual, ev, entries, rows_seen = {}, [], {}, []
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        t.settle()
        ev.append(t.snap("forms after resume"))
        result, windows, diff = whole(t, path)
        ev.append(diff)
        actual["wholeList"] = {k: result[k] for k in ("ok", "covered", "missing")} | {"windows": len(windows)}
        groups = v.expected_toc(path).groups
        for w in windows:
            # the entry at each expected index, taken from a window where it is not cut off
            for e, r in zip(w.entries, v.compare_window(groups, w)["entries"]):
                if not e.clipped or r["index"] not in entries:
                    entries[r["index"]] = e
        entries = dict(sorted(entries.items()))
        rows_seen = [e.public() for e in entries.values()]
        (run.dir / "forms-entries.json").write_text(json.dumps(rows_seen, ensure_ascii=False, indent=1))
        ev.append(run.dir / "forms-entries.json")
        text_seen = "\n".join(" ".join(e.user_lines + e.agent_lines) for e in entries.values())
        actual["subagentTextShown"] = "子任务说明" in text_seen or "子 agent 的报告" in text_seen
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    whole_ok = actual.get("wholeList", {}).get("ok") is True
    found = list(entries.values())

    def by(prefix):
        return [e for e in found if e.user_text.startswith(prefix)]

    def one(prefix):
        got = by(prefix)
        return got[0] if len(got) == 1 else None

    checks = {}
    users = [e.user_text for e in found]
    checks["turn001"] = {
        "prompt": one("F01") is not None, "slashPrompt": one("/review F07 main") is not None,
        "localCommandUserRow": one("/model F08") is not None, "localCommandSystemRow": one("/tui F09") is not None,
        "bang": one("!echo F10") is not None, "queued": one("F15") is not None,
        "noOutputOrNoticeGroups": not any(u.startswith(("Set model", "Current renderer", "F10", "[Request", "合成提醒",
                                                        "F15 后台任务", "This session")) for u in users),
        "localCommandsUserSideOnly": all(one(p) is not None and one(p).agent_head is None for p in ("/model F08", "/tui F09", "!echo F10")),
    }
    checks["turn002"] = {"identicalPromptEntries": len(by("F06 完全相同的 prompt"))}
    f02, f03 = one("F02"), one("F03")
    checks["turn003"] = {
        "multilineTwoLinesWithEllipsis": bool(f02) and len(f02.user_lines) == 2 and f02.user_lines[-1].endswith("…"),
        "multilineLines": f02.user_lines if f02 else None,
        "pasteTagsGone": bool(f03) and "pasted_content" not in f03.user_text and "贴进来的一段文字" in f03.user_text,
        "imageOnly": one("（只有图片）") is not None,
    }
    f01, f12, f13, f14 = one("F01"), one("F12"), one("F13"), one("F14")
    checks["turn004"] = {
        "stepsAndLastText": bool(f01) and f01.agent_head == "1 步" and bool(f01.agent_lines),
        "noTextReply": bool(f14) and f14.agent_head == "2 步 · 无文字回复",
        "interrupted": bool(f12) and f12.agent_head == "已中断 · 1 步",
        "error": bool(f13) and f13.agent_head == "出错 · 1 步" and "API Error" in " ".join(f13.agent_lines),
    }
    f05 = one("F05")
    checks["turn005"] = {"noTimestampNoTime": bool(f05) and f05.time == "",
                         "othersTimed": all(re.fullmatch(r"\d\d:\d\d", e.time or "") is not None
                                            for e in found if e is not f05 and e.has_user)}
    f11 = one("F11")
    checks["data005"] = {"subagentOneStep": bool(f11) and f11.agent_head == "1 步",
                         "subagentContentNotListed": actual.get("subagentTextShown") is False}
    actual["checks"] = checks

    def all_true(d):
        return all(x is True for k, x in d.items() if isinstance(x, bool))
    out = []
    for sid, key, expected in (
            ("CT-TURN-001", "turn001", "prompts, slash commands (a user row, a system/local_command row), a prompt-type "
                                       "command, !cmd and a queued prompt each open a group; output, notices, interrupts "
                                       "and reminders open none; local commands and !cmd have a user side only"),
            ("CT-TURN-002", "turn002", "three identical prompts are three entries"),
            ("CT-TURN-003", "turn003", "multi-line CJK/emoji text is cut to 2 lines by cell width with …; "
                                       "<pasted_content> tags removed; an image-only prompt says （只有图片）"),
            ("CT-TURN-004", "turn004", "the Agent side reads N 步 with the last text, N 步 · 无文字回复, 已中断 · N 步, 出错 · N 步 "
                                       "as the file has it (the live 进行中 · N 步: turn-004-live)"),
            ("CT-TURN-005", "turn005", "time from the row's timestamp; the row without one shows no time"),
            ("CT-DATA-005", "data005", "a subagent's rows are not listed; the subagent call is 1 step")):
        c = checks[key]
        ok = whole_ok and (all_true(c) if key != "turn002" else c["identicalPromptEntries"] == 3)
        out.append((sid, "forms", expected + "; the whole list equals the verifier's",
                    {"wholeList": actual.get("wholeList"), "checks": c, **({"failure": actual["failure"]} if "failure" in actual else {})},
                    ok, ev))
    return out


FAKE_KEY = "sk-ant-api03-fake-chat-toc-gate-000000000000"


def fake_api_world(world):
    cfg = json.loads((world.config / ".claude.json").read_text())
    cfg["customApiKeyResponses"] = {"approved": [FAKE_KEY[-20:]], "rejected": []}
    (world.config / ".claude.json").write_text(json.dumps(cfg))


def turn_004_live(host, run):
    world = h.World(token="")
    fake_api_world(world)
    (world.project / "notes.txt").write_text("CT-SYN notes\n")
    fx = world.fixture("turns", turns=3, version=host.version)
    path = world.transcript(fx["session"])
    actual, ev, seen = {}, [], []
    with fake_api.FakeApi("CT-TURN-004", str(world.project / "notes.txt"), steps=2, delay=4.0, reply="完成") as api:
        t = launch(world, host, run, ["--resume", fx["session"]],
                   env={"ANTHROPIC_BASE_URL": api.url, "ANTHROPIC_API_KEY": FAKE_KEY})
        try:
            t.wait_for(listed, "the Pane with entries", timeout=40)
            t.settle()
            t.type("CT-TURN-004 进行中的合成一轮")
            time.sleep(0.4)
            t.key("enter")
            end = time.monotonic() + 40
            while time.monotonic() < end:
                p = pane(t)
                last = p.entries[-1] if p and p.entries else None
                state = (last.user_text, last.agent_head) if last else None
                if state and (not seen or seen[-1]["agentHead"] != state[1]):
                    seen.append({"user": state[0], "agentHead": state[1], "at": round(time.monotonic(), 2)})
                    ev.append(t.snap(f"turn-004-live {state[1]}"))
                if state and state[1] == "2 步" and state[0].startswith("CT-TURN-004"):
                    break
                time.sleep(0.15)
            t.settle(quiet=1.5)
            ev.append(t.snap("turn-004-live done"))
            p = pane(t)
            actual["final"] = p.entries[-1].public()
            actual["finalMatchesVerifier"] = v.compare_window(v.expected_toc(path).groups, p)["ok"]
        except h.ScenarioFailure as failure:
            actual["failure"] = str(failure)
        finally:
            t.close()
            world.remove()
        actual["requests"] = api.requests
    actual["agentHeads"] = [s["agentHead"] for s in seen if s["user"].startswith("CT-TURN-004")]
    heads = actual["agentHeads"]
    order = ["进行中", "进行中 · 1 步", "进行中 · 2 步", "2 步"]
    ok = (all(x in heads for x in order) and [heads.index(x) for x in order] == sorted(heads.index(x) for x in order)
          and actual.get("final", {}).get("agentLines") == ["完成"] and actual.get("finalMatchesVerifier") is True)
    return ("CT-TURN-004", "turns 3 + one live turn against fake_api.py (two Read steps, 4 s apart; no model)",
            "while the turn runs the last entry reads 进行中, then 进行中 · 1 步, 进行中 · 2 步 as the steps land; "
            "after it, 2 步 with the closing text, as the verifier reads the file", actual, ok, ev)


def chosen_filter(t):
    """The filter the Pane's tab rule marks; None without a Pane."""
    p = v.parse_pane(t.rows())
    return p.filter if p is not None else None


def ui_001(host, run):
    world = h.World(token="")
    fx = world.fixture("turns", turns=9, version=host.version)       # turn 7 is a /tui: a user side only
    path = world.transcript(fx["session"])
    actual, ev = {}, []
    t = launch(world, host, run, ["--resume", fx["session"]])
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        t.settle()
        focus_pane(t)
        for key, chosen in (("2", "user"), ("3", "agent"), ("1", "all")):
            began = time.monotonic()
            t.type(key)
            t.wait_for(lambda term: chosen_filter(term) == chosen, f"the tab rule under {chosen}", timeout=5)
            took = round(time.monotonic() - began, 2)
            pointer_off(t)
            ev.append(t.snap(f"ui-001 filter {chosen}"))
            shown = pane(t)
            region = shown.preview[0] if shown is not None and shown.preview else None
            result, windows, diff = whole(t, path, chosen)
            ev.append(diff)
            actual[chosen] = {"redrawSeconds": took, "wholeList": {k: result[k] for k in ("ok", "covered", "missing")},
                              "previewRule": region}
        t.type("3")
        t.wait_for(lambda term: chosen_filter(term) == "agent", "Agent chosen before quitting", timeout=5)
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
    try:
        t = launch(world, host, run, ["--resume", fx["session"]])
        t.wait_for(listed, "the Pane in a new process", timeout=40)
        t.settle()
        ev.append(t.snap("ui-001 new process"))
        actual["newProcessFilter"] = chosen_filter(t)
        t.close()
        for store in store_files(world):
            store.write_text(json.dumps({"viewFilter": "nonsense", "layout": ["compact"]}))
        t = launch(world, host, run, ["--resume", fx["session"]])
        t.wait_for(listed, "the Pane after an unknown stored value", timeout=40)
        t.settle()
        ev.append(t.snap("ui-001 unknown stored value"))
        actual["unknownValueFilter"] = chosen_filter(t)
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    ok = (all(actual.get(c, {}).get("wholeList", {}).get("ok") is True and actual[c]["redrawSeconds"] <= 1.0
              and PREVIEW_RULE.match(actual[c].get("previewRule") or "") for c in ("user", "agent", "all"))
          and actual.get("newProcessFilter") == "agent" and actual.get("unknownValueFilter") == "all"
          and "failure" not in actual)
    return ("CT-UI-001", "turns 9 (a /tui group with a user side only)",
            "2/3/1 switch the filter and the Pane redraws at once (≤ 1 s from the key), each whole list equal to the "
            "verifier's for that filter (Agent hides the user-only group), the preview's rule `─ p: 预览 ───` under "
            "the list; the choice survives a new process; an unknown stored value reads as 全部", actual, ok, ev)


def layout_view(t):
    p = v.parse_pane(t.rows())
    if p is None:
        return {"label": None, "turns": [], "agentSides": 0, "preview": None}
    turns = sorted({int(n) for e in p.entries for n in re.findall(r"T(\d{4}) 用户问题", e.user_text)})
    agents = sum(e.agent_head is not None for e in p.entries)
    region = [r.strip() for r in p.preview or [] if r.strip()]
    return {"label": p.layout, "turns": turns, "agentSides": agents, "preview": region[:3]}


def click_layout_button(t):
    t.settle(quiet=0.6)
    at = t.find("l: 布局")
    if at is None:
        raise h.ScenarioFailure("no Layout button")
    t.click(at[1] + 1, at[0])


def ui_002(host, run):
    world = h.World(token="")
    fx = world.fixture("turns", turns=5, version=host.version)
    actual, ev, views = {}, [], []
    t = launch(world, host, run, ["--resume", fx["session"]], lines=TALL)
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        t.settle()
        pointer_off(t)
        views.append(layout_view(t))
        ev.append(t.snap("ui-002 card"))
        focus_pane(t)
        t.type("l")                                   # the hotkey
        t.wait_for(lambda term: layout_view(term)["label"] == "紧凑", "布局 紧凑", timeout=5)
        pointer_off(t)
        views.append(layout_view(t))
        ev.append(t.snap("ui-002 compact by l"))
        click_layout_button(t)                        # the button
        t.wait_for(lambda term: layout_view(term)["label"] == "时间轴", "布局 时间轴", timeout=5)
        pointer_off(t)
        views.append(layout_view(t))
        ev.append(t.snap("ui-002 timeline by a click"))
        # back to 卡片 and on to 紧凑 with the button, which leaves the keyboard where it was
        click_layout_button(t)
        t.wait_for(lambda term: layout_view(term)["label"] == "卡片", "布局 卡片 again", timeout=5)
        click_layout_button(t)
        t.wait_for(lambda term: layout_view(term)["label"] == "紧凑", "布局 紧凑 before quitting", timeout=5)
        time.sleep(0.5)
        actual["views"] = views
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
    shown = lambda term: layout_view(term)["label"] is not None and layout_view(term)["turns"]  # noqa: E731
    try:
        t = launch(world, host, run, ["--resume", fx["session"]], lines=TALL)
        t.wait_for(shown, "the Pane in a new process", timeout=40)
        t.settle()
        ev.append(t.snap("ui-002 new process"))
        actual["newProcessLayout"] = layout_view(t)["label"]
        t.close()
        for store in store_files(world):
            store.write_text(json.dumps({"viewFilter": "all", "layout": "spiral"}))
        t = launch(world, host, run, ["--resume", fx["session"]], lines=TALL)
        t.wait_for(shown, "the Pane after an unknown stored value", timeout=40)
        t.settle()
        actual["unknownValueLayout"] = layout_view(t)["label"]
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure)
    finally:
        t.close()
        world.remove()
    labels = [x["label"] for x in views]
    ok = (labels == ["卡片", "紧凑", "时间轴"] and all(x["turns"] == list(range(5)) and x["agentSides"] == 5 for x in views)
          and all(len(x["preview"] or []) >= 3 and PREVIEW_RULE.match(x["preview"][0]) and x["preview"][2].split()[:1] == ["用户"] for x in views)
          and actual.get("newProcessLayout") == "紧凑" and actual.get("unknownValueLayout") == "卡片" and "failure" not in actual)
    return ("CT-UI-002", f"turns 5 (fits the window in every Layout beside the preview at {TALL} lines)",
            "l and the 布局 button cycle 卡片 → 紧凑 → 时间轴, each listing the same 5 entries with their Agent sides "
            "and the preview region (its rule, the meta line, 用户) under the list; "
            "the choice survives a new process; an unknown stored value reads as 卡片", actual, ok, ev)


def compacted_turns(world, host, turns, after):
    """The `turns` fixture's turns, compacted after turn `after`: resumed, the
    turns up to it are dim from the first drawing (CT-JUMP-005)."""
    session = "00000000-0000-4000-8000-000000000ac3"
    t = tf.Transcript(world.transcript(session), str(world.project), session, seed=12, version=host.version)
    for i in range(turns):
        tf._plain(t, i)
        if i == after:
            t.compact()
    t.close()
    return session


def is_dim(t, p, row, start=1):
    """Whether every non-blank cell of a pane row from column `start` on is
    drawn dim; 3 skips the rail mark."""
    with t.lock:
        cells = [t.screen.buffer[row][x] for x in range(p.left + start, t.screen.columns)]
    shown = [c for c in cells if c.data.strip()]
    return bool(shown) and all(c.fg == DIM for c in shown)


def is_lit(fg, theme="dark"):
    """The theme's `suggestion`, which the lit rail marks are drawn in."""
    return fg == THEMES[theme][0]


LIT_MARKS = "◉┣"


def lit_rows(t, p):
    """Screen rows whose rail mark is lit (◉ or ┣╸), with its colour."""
    out = []
    with t.lock:
        for e in p.entries:
            for row in (e.user_row, e.agent_row):
                if row is None:
                    continue
                c = t.screen.buffer[row][p.left]
                if c.data in LIT_MARKS:
                    out.append((row, c.fg))
    return out


def ui_003(host, run):
    world = h.World(token="")
    session = compacted_turns(world, host, 12, after=1)
    actual, ev = {}, []
    t = launch(world, host, run, ["--resume", session])
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        t.settle()
        pointer_off(t)
        col, row = h._wheel_point(t)
        for _ in range(40):
            p = v.parse_pane(t.settle(quiet=0.4))
            dimmed = next((e for e in p.entries if "T0001" in e.user_text), None)
            if dimmed:
                break
            t.wheel(col, row, up=True, ticks=2)
        else:
            raise h.ScenarioFailure("T0001 never showed in the Pane")
        actual["dimmedBeforeKeys"] = dimmed.user_off and is_dim(t, p, dimmed.user_row)
        ev.append(t.snap("ui-003 T0001, compacted before the resume, dimmed"))
        for _ in range(40):
            p = v.parse_pane(t.settle(quiet=0.4))
            if any("T0011" in e.user_text for e in p.entries):
                break
            t.wheel(col, row, up=False, ticks=2)

        # the keyboard: ↑ walks up one side a time. Where the ring starts
        # after Ctrl+X Tab is the host's (2.1.295 wraps from the filter row
        # to the last side; 2.1.287 may start a side lower); every later ↑
        # must land on the side just above.
        focus_pane(t)
        walk = []
        for _ in range(8):
            t.key("up", pause=0.3)
            pointer_off(t)
            got = ring(t)
            p = pane(t)
            where = side_at(p, got[0][0]) if len(got) == 1 else None
            entry = p.entries[where[0]] if where else None
            turn = turn_of(entry.user_text) if entry else None
            if entry is not None and turn is None and where[0] + 1 < len(p.entries):
                nxt = turn_of(p.entries[where[0] + 1].user_text)   # /tui names no turn: the one before its neighbour
                turn = nxt - 1 if nxt is not None else None
            walk.append({"ring": got, "turn": turn, "side": where[1] if where else None,
                         "dim": is_dim(t, p, entry.user_row) if entry and where[1] == "user" else None,
                         "lit": lit_rows(t, p)})
        ev.append(t.snap("ui-003 after the ↑ walk"))
        actual["walk"] = walk
        # the sides above one another: each turn's agent side then its user side; turn 7 (/tui) has a user side only
        order = [(n, s) for n in range(11, -1, -1) for s in (("user",) if n == 7 else ("agent", "user"))]
        # the ring may first stop on the footer's Layout Button, below the entries
        steps = [(w["turn"], w["side"]) for w in walk]
        while steps and steps[0][1] is None:
            steps.pop(0)
        actual["oneSideAtATime"] = (steps[0] in order and
                                    steps == order[order.index(steps[0]):order.index(steps[0]) + len(steps)])

        # Enter on the side the ring holds jumps like a click: walk on up to
        # T0002's user side, the first turn after the compaction
        for _ in range(30):
            got = ring(t)
            p = pane(t)
            where = side_at(p, got[0][0]) if len(got) == 1 else None
            if where and where[1] == "user" and turn_of(p.entries[where[0]].user_text) == 2:
                break
            t.key("up", pause=0.3)
            pointer_off(t)
        else:
            raise h.ScenarioFailure("the ring never reached T0002's user side")
        t.key("enter")
        rows = t.settle(quiet=1.2)
        pointer_off(t)
        ev.append(t.snap("ui-003 Enter on T0002"))
        top = h.transcript_text(rows, pane(t).left).splitlines()[:6]
        actual["enterJumped"] = "T0002 用户问题" in "\n".join(top)

        # the jump lights T0002; one ↑ moves the ring off it, onto T0001's
        # dimmed Agent side (not skipped), while the highlight stays
        t.key("up", pause=0.3)
        pointer_off(t)
        got = ring(t)
        p = pane(t)
        # T0001's user lines may sit above the window: read the ring's row,
        # the Agent side's first line, the hollow branch beside it, and the
        # reply's line under it (the ring's own row is drawn inverse)
        with t.lock:
            mark = "".join(t.screen.buffer[got[0][0]][p.left + i].data for i in range(2)) if len(got) == 1 else ""
        actual["ringOnDimmed"] = len(got) == 1 and mark == "├┄" and "T0001" in got[0][1] and is_dim(t, p, got[0][0] + 1, 3)
        lit = lit_rows(t, p)
        lit_turns = sorted({turn_of(e.user_text) for e in p.entries if e.highlighted})
        where = side_at(p, got[0][0]) if len(got) == 1 else None
        ev.append(t.snap("ui-003 ring moved off the lit entry"))
        actual["afterEnterAndUp"] = {"ring": got, "ringTurn": turn_of(p.entries[where[0]].user_text) if where else None,
                                     "litTurns": lit_turns, "litMarks": lit}
        with t.lock:
            reverse_lit = any(t.screen.buffer[r][p.left].reverse for r, _ in lit)
            ring_on_lit = len(got) == 1 and t.screen.buffer[got[0][0]][p.left].data in LIT_MARKS
        actual["ringAndHighlightApart"] = lit_turns == [2] and len(got) == 1 and not ring_on_lit
        actual["highlightColour"] = sorted({str(fg) for _, fg in lit})
        actual["highlightNotInverse"] = bool(lit) and not reverse_lit
    except (h.ScenarioFailure, StopIteration, IndexError) as failure:
        actual["failure"] = repr(failure)
    finally:
        t.close()
        world.remove()
    ok = all(actual.get(k) is True for k in ("dimmedBeforeKeys", "oneSideAtATime", "ringOnDimmed", "enterJumped",
                                               "ringAndHighlightApart", "highlightNotInverse")) \
        and len(actual.get("highlightColour", [])) == 1 and is_lit(actual["highlightColour"][0])
    return ("CT-UI-003", "turns 12 compacted after T0001, --resume: T0000-T0001 dimmed from the start",
            "focused, ↑ walks one side at a time (agent, user, the turn before's agent, ...); Enter on T0002's user side "
            "puts that prompt at the top and lights it; one more ↑ moves the inverse ring off it onto T0001's Agent side "
            "on its hollow branch (not skipped) while the lit ◉ in the theme's `suggestion` (not inverse) stays on T0002",
            actual, ok, ev)


def composer_text(t) -> str:
    """The prompt box's text: the rows between the last two full-width rules."""
    rows = t.rows()
    rules = [i for i, r in enumerate(rows) if r.startswith("─" * 40)]
    return "\n".join(rows[rules[-2] + 1:rules[-1]]) if len(rules) >= 2 else ""


def clipboard() -> str:
    return subprocess.run(["pbpaste"], capture_output=True).stdout.decode(errors="replace")


def sec_001(host, run):
    marker = "CTSEC" + secrets.token_hex(8).upper()
    MARKERS.parent.mkdir(parents=True, exist_ok=True)
    with open(MARKERS, "a", encoding="utf-8") as handle:
        handle.write(marker + "\n")
    digest = hashlib.sha256(marker.encode()).hexdigest()[:16]
    world = h.World(token="")
    fx = world.fixture("turns", turns=6, version=host.version)
    copy = plugin_copy(run)
    log = run.dir / "debug-sec-001.log"
    t = launch(world, host, run, ["--resume", fx["session"]], plugin=copy, log=log, env={"CHAT_TOC_PERF": "1"})
    actual, ev = {"markerSha256": digest}, []
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        t.settle()
        submit(t, f"{marker} 合成的唯一标记 prompt")
        t.wait_for(lambda term: marker in right_text(term.rows()), "the marker drawn in the Pane", timeout=20)
        actual["drawnInPane"] = True
        focus_pane(t)                                      # store writes: the filter, the Layout, the preview
        for key in ("2", "1", "l", "l", "l", "p", "p"):
            t.type(key)
            time.sleep(0.5)
        t.key("esc")
        focus_pane(t)                                      # the marker in a query: $.state only (0.2)
        t.type("f")
        time.sleep(0.5)
        t.type(marker)
        # the field cuts a long query with … at the Pane's width: its start and the one match it leaves
        t.wait_for(lambda term: (q := pane(term)) is not None and (q.search or {}).get("text", "").startswith(marker[:12])
                   and len(q.entries) == 1, "the marker in the search field", timeout=10)
        actual["inQuery"] = True
        t.key("esc")
        time.sleep(0.5)
        # the marker reused and copied from the preview, which shows the match
        # (0.2): into the composer and the clipboard, nowhere else
        focus_pane(t)
        t.type("r")
        t.wait_for(lambda term: marker in composer_text(term), "the marker filled into the composer", timeout=10)
        actual["inComposer"] = True
        t._write("\x7f" * 200)
        time.sleep(0.6)
        saved = clipboard()
        try:
            focus_pane(t)
            t.type("c")
            time.sleep(0.8)
            actual["inClipboard"] = marker in clipboard()
        finally:
            subprocess.run(["pbcopy"], input=saved.encode())
        t.key("esc")
        time.sleep(0.5)
        p = pane(t)
        mine = next((e for e in p.entries if marker in e.user_text), None)
        if mine is not None:
            t.click(p.left + 4, mine.user_row)              # a jump
            time.sleep(1.0)
        hot_reload(t, copy, log)                            # a whole re-read
        time.sleep(1.5)
    except h.ScenarioFailure as failure:
        actual["failure"] = str(failure).replace(marker, "<marker>")
    finally:
        t.close()
    found = {}
    stores = store_files(world)
    data = world.config / "plugins" / "data"
    plugin_data = sorted(p for p in data.glob("chat-toc*") if p.exists()) if data.exists() else []
    for f in stores + [f for d in plugin_data for f in d.rglob("*") if f.is_file()]:
        if marker in f.read_text(errors="replace"):
            found[str(f.relative_to(world.config))] = True
    log_lines = log.read_text(errors="replace").splitlines()
    ours = [line for line in log_lines if "chat-toc" in line]
    found_in_log = [i for i, line in enumerate(ours) if marker in line]
    actual["storeFiles"] = [str(f.relative_to(world.config)) for f in stores]
    actual["storeKeys"] = sorted({k for f in stores for k in json.loads(f.read_text() or "{}")})
    actual["pluginDataDirs"] = [str(d.relative_to(world.config)) for d in plugin_data]
    actual["leaksInStoreOrData"] = sorted(found)
    actual["debugLogChatTocLines"] = len(ours)
    actual["leaksInChatTocLogLines"] = len(found_in_log)
    actual["hostLogLinesWithMarker"] = sum(marker in line for line in log_lines)
    world.remove()
    shutil.rmtree(copy, ignore_errors=True)
    # the debug log holds the host's own lines; keep only chat-toc's in the evidence
    kept = run.dir / "debug-sec-001-chat-toc-lines.log"
    kept.write_text("\n".join(line.replace(marker, "<marker>") for line in ours) + "\n")
    log.unlink()
    ev.append(kept)
    ok = (actual.get("drawnInPane") is True and actual.get("inQuery") is True and actual.get("inComposer") is True
          and actual.get("inClipboard") is True and not found and not found_in_log
          and set(actual["storeKeys"]) <= {"viewFilter", "layout", "preview"} and "preview" in actual["storeKeys"]
          and "failure" not in actual)
    return ("CT-SEC-001", "turns 6 + one submitted prompt holding a synthetic unique marker",
            "the marker is drawn in the Pane, typed into the search field, reused into the composer (r) and copied (c), and appears in none of: chat-toc's $.store file (which holds only viewFilter, "
            "layout and preview), its plugin data directory, the debug log's chat-toc lines (CHAT_TOC_PERF on, a jump, a hot reload); "
            "the release evidence is scanned for it too (release_gate.py)", actual, ok, ev)


def pane_colours(t, p):
    """The Pane's colours: the lit marks' (◉ ┣╸), the other nodes' (●), the
    rail's (├╴ │), the dimmed text's (each Agent reply and the time at the
    right of a prompt) and the prompts' text."""
    out = {"lit": set(), "node": set(), "rail": set(), "dimmed": set(), "text": set()}
    with t.lock:
        buf = t.screen.buffer
        for e in p.entries:
            sides = [("user", e.user_row, len(e.user_lines)), ("agent", e.agent_row, max(1, len(e.agent_lines)))]
            for side, first, count in sides:
                if first is None:
                    continue
                for row in range(first, min(first + count, t.screen.lines)):
                    mark = buf[row][p.left]
                    if mark.data in LIT_MARKS:
                        out["lit"].add(mark.fg)
                    elif mark.data == "●":
                        out["node"].add(mark.fg)
                    elif mark.data in "├│":
                        out["rail"].add(mark.fg)
                    cells = [buf[row][x] for x in range(p.left + 3, t.screen.columns) if buf[row][x].data.strip()]
                    cells = [c for c in cells if not c.reverse]
                    if side == "user" and row == first and e.time and len(cells) >= 5:
                        # the time at the right: lit with its group, else dim
                        out["lit" if e.highlighted else "dimmed"].update(c.fg for c in cells[-5:])
                        cells = cells[:-5]
                    out["dimmed" if side == "agent" else "text"].update(c.fg for c in cells)
    return {k: sorted(v) for k, v in out.items()}


def themed_world(host, theme):
    world = h.World(token="")
    config = world.config / ".claude.json"
    config.write_text(json.dumps(json.loads(config.read_text()) | {"theme": theme}))
    return world, world.fixture("turns", turns=12, version=host.version)


def ui_004(host, run):
    """One record per judged theme, one for the live switch, one recording
    the themes that are not judged."""
    out = []
    for theme, (lit, dim) in THEMES.items():
        world, fx = themed_world(host, theme)
        t = launch(world, host, run, ["--resume", fx["session"]])
        actual, ev = {"theme": theme, "expected": {"lit": lit, "dimmed": dim}}, []
        try:
            t.wait_for(listed, "the Pane with entries", timeout=40)
            t.settle()
            pointer_off(t)
            actual |= pane_colours(t, pane(t))
            ev.append(t.snap(f"ui-004 {theme}"))
        except h.ScenarioFailure as failure:
            actual["failure"] = repr(failure)
        finally:
            t.close()
            world.remove()
        ok = (actual.get("lit") == [lit] and actual.get("dimmed") == [dim] and actual.get("node") == [dim])
        out.append(("CT-UI-004", f"turns 12, theme {theme}",
                    f"the lit ◉ ┣╸ are {lit} (the theme's suggestion); the Agent replies, the prompts' times and the "
                    f"other nodes ● are {dim} (its inactive)", actual, ok, ev))

    world, fx = themed_world(host, "dark")
    t = launch(world, host, run, ["--resume", fx["session"]])
    actual, ev = {}, []
    try:
        t.wait_for(listed, "the Pane with entries", timeout=40)
        t.settle()
        pointer_off(t)
        actual["before"] = pane_colours(t, pane(t))
        t.command("/theme", wait=2.0)
        t.wait_for(lambda term: term.find("Light mode") is not None, "the /theme picker", timeout=15)
        t.key("down", pause=0.5)
        if not any("❯" in r and "Light mode" in r and "colorblind" not in r for r in t.rows()):
            raise h.ScenarioFailure("the picker's cursor is not on Light mode")
        t.key("enter", pause=0.5)
        t.wait_for(lambda term: term.find("Choose the text style") is None, "the picker to close", timeout=15)
        t.settle()
        pointer_off(t)
        actual["after"] = pane_colours(t, pane(t))
        ev.append(t.snap("ui-004 after /theme to Light"))
    except (h.ScenarioFailure, AttributeError) as failure:
        actual["failure"] = repr(failure)
    finally:
        t.close()
        world.remove()
    dark, light = THEMES["dark"], THEMES["light"]
    ok = (actual.get("before", {}).get("lit") == [dark[0]] and actual.get("before", {}).get("dimmed") == [dark[1]]
          and actual.get("after", {}).get("lit") == [light[0]] and actual.get("after", {}).get("dimmed") == [light[1]])
    out.append(("CT-UI-004", "turns 12, theme dark, then /theme → Light mode in the same session",
                "the Pane redraws at once in the light theme's suggestion and inactive, with no reopen", actual, ok, ev))

    seen, ev = {}, []
    for theme in ("dark-daltonized", "light-daltonized", "auto"):
        world, fx = themed_world(host, theme)
        t = launch(world, host, run, ["--resume", fx["session"]])
        try:
            t.wait_for(listed, "the Pane with entries", timeout=40)
            t.settle()
            pointer_off(t)
            seen[theme] = pane_colours(t, pane(t))
            ev.append(t.snap(f"ui-004 {theme}"))
        except h.ScenarioFailure as failure:
            seen[theme] = {"failure": repr(failure)}
        finally:
            t.close()
            world.remove()
    out.append(("CT-UI-004", "turns 12, themes dark-daltonized, light-daltonized and auto",
                "recorded for the record, not judged: the Pane draws under each", seen,
                all("failure" not in c for c in seen.values()), ev))
    return out


SCENARIOS = {
    "compat-001": compat_001, "data-001": data_001, "data-002": data_002, "data-003": data_003, "data-004": data_004,
    "forms": forms, "turn-004-live": turn_004_live, "ui-001": ui_001, "ui-002": ui_002, "ui-003": ui_003,
    "ui-004": ui_004, "sec-001": sec_001,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="current")
    parser.add_argument("--only", default="")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    host = h.Host(args.host)
    run = h.Run(args.out, f"gate-{host.version}")
    names = [n for n in args.only.split(",") if n] or list(SCENARIOS)
    failed = 0
    for name in names:
        try:
            got = SCENARIOS[name](host, run)
        except Exception as error:                      # a scenario that crashed is a failed scenario
            got = [(name, name, name, {"error": repr(error)}, False, [])]
        for sid, fixture, expected, actual, ok, evidence in (got if isinstance(got, list) else [got]):
            run.record(sid, host=host.version, plugin=str(PLUGIN), fixture=fixture, expected=expected,
                       actual=json.loads(json.dumps(actual, ensure_ascii=False, default=str)),
                       result="pass" if ok else "fail", evidence=evidence)
            print(f"{name} ({sid}) on {host.version}: {'pass' if ok else 'fail'}", flush=True)
            failed += not ok
    print("run directory:", run.dir)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
