#!/usr/bin/env python3
"""PTY scenarios for the conversation chain (ticket 21): compaction, rewind,
resume, continue, fork, in-session /resume, and two sessions of one project
side by side. Every verdict comes from toc_verifier against the session's
own transcript file.

    pty_harness's venv python chain_scenarios.py [--host current|2.1.287] [--only life-003,...]

Prompts are synthetic. The world is not logged in, so a submitted prompt is
written to the transcript and answered by the host's own "Not logged in"
row: a real submit that calls no model.
"""
import argparse
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402
import transcript_fixture as tf  # noqa: E402

PLUGIN = HERE.parent.parent
SESSION_A = "00000000-0000-4000-8000-0000000021a0"
SESSION_B = "00000000-0000-4000-8000-0000000021b0"


def write_session(world: h.World, host: h.Host, session: str, label: str, turns: int, compact_after=(),
                  rewind: bool = False, seed: int = 21) -> pathlib.Path:
    """`turns` plain turns named `<label>NN`; a compaction after each turn in
    `compact_after`; with `rewind`, one more turn left on a branch the
    conversation was rewound away from."""
    path = world.transcript(session)
    t = tf.Transcript(path, str(world.project), session, seed=seed, version=host.version)
    for i in range(turns):
        t.prompt(f"{label}{i:02d} 合成问题 {i}")
        if i % 2:
            t.tool(f"{label.lower()}{i}")
        last = t.reply(f"{label}{i:02d} 合成回复 {i}")
        if i in compact_after:
            t.compact()
    if rewind:
        t.prompt(f"{label}XX 被 rewind 抛弃的一轮")
        t.reply(f"{label}XX 抛弃的回复")
        t.rewind_to(last)
        t.prompt(f"{label}YY rewind 之后的一轮")
        t.reply(f"{label}YY 新分支的回复")
    t.close()
    return path


def wait_docked(term) -> None:
    term.wait_for(lambda t: (p := v.parse_pane(t.rows())) is not None and p.entries, "the Pane with entries", timeout=30)


def compare(term, path: pathlib.Path, label: str, whole: bool = False, timeout: float = 15.0) -> dict:
    """The Pane against the verifier's TOC of `path`, retried while reads
    catch up. Without `whole`, the one window must hold every entry."""
    deadline = time.monotonic() + timeout
    while True:
        toc = v.expected_toc(path)
        if whole:
            windows = h.read_whole_pane(term, snap=False)
        else:
            windows = [v.parse_pane(term.settle(quiet=0.6))]
        result = v.compare_windows(toc.groups, [w for w in windows if w is not None]) if all(windows) else {
            "ok": False, "covered": 0, "missing": list(range(len(toc.groups)))}
        if result["ok"] or time.monotonic() > deadline:
            break
        time.sleep(1)
    shot = term.snap(label)
    diffs = [v.compare_window(toc.groups, w) for w in windows]
    diff_path = term.run.dir / f"{shot.stem}-diff.json"
    diff_path.write_text(json.dumps(diffs, ensure_ascii=False, indent=1))
    return {"ok": result["ok"], "expected": len(toc.groups), "covered": result["covered"],
            "missing": result["missing"], "evidence": [shot, diff_path],
            "users": [g.public()["userText"] for g in toc.groups]}


def submit(term, text: str) -> None:
    """Submits a prompt; the host answers it with its "Not logged in" row."""
    term.type(text)
    time.sleep(0.4)
    term.key("enter")
    term.wait_for(lambda t: t.find("Please run /login") is not None, "the host's not-logged-in answer", timeout=30)
    time.sleep(1)


def clear_composer(term, count: int = 60) -> None:
    for _ in range(count):
        term.key("backspace", pause=0.01)


def newest_other(world: h.World, *not_these: str) -> pathlib.Path | None:
    folder = world.transcript(SESSION_A).parent
    found = [f for f in folder.glob("*.jsonl") if f.stem not in not_these]
    return max(found, key=lambda f: f.stat().st_mtime) if found else None


# ---------- scenarios: each returns (expected, actual, ok, evidence) ----------

def life_003(world, host, run):
    """Compactions: entries from before every compaction are still listed."""
    path = write_session(world, host, SESSION_A, "K", 9, compact_after=(2, 5), rewind=True)
    term = h.launch(world, host, [PLUGIN], ["--resume", SESSION_A], run=run)
    try:
        wait_docked(term)
        got = compare(term, path, "whole pane after resume, two compactions", whole=True)
    finally:
        term.close()
    return ("every group on the chain across both compact boundaries, the rewound branch left out",
            got, got["ok"], got.pop("evidence"))


def life_004(world, host, run):
    """Rewind with Esc Esc, then the next submit: the abandoned branch goes."""
    path = write_session(world, host, SESSION_A, "R", 6)
    term = h.launch(world, host, [PLUGIN], ["--resume", SESSION_A], run=run)
    evidence = []
    try:
        wait_docked(term)
        before = compare(term, path, "before rewind")
        evidence += before.pop("evidence")
        term.key("esc")
        time.sleep(0.3)
        term.key("esc")
        term.wait_for(lambda t: t.find("Rewind") is not None, "the rewind dialog", timeout=10)
        term.key("up", "up", "up")           # (current) -> R05 -> R04 -> R03
        time.sleep(0.5)
        evidence.append(term.snap("rewind dialog on R03"))
        term.key("enter")
        time.sleep(1)
        if term.find("Restore conversation") is not None:
            term.key("enter")
        term.wait_for(lambda t: t.find("Rewind") is None, "the rewind dialog to close", timeout=10)
        time.sleep(1)
        rows = term.settle()
        evidence.append(term.snap("after rewind, before the next submit"))
        pane = v.parse_pane(rows)
        old_still_listed = bool(pane) and any("R05" in e.user_text for e in pane.entries)
        clear_composer(term)
        submit(term, "R03 rewind 之后提交的合成 prompt")
        after = compare(term, path, "after the next submit")
        evidence += after.pop("evidence")
        gone = all(f"R0{i}" not in "\n".join(term.rows()) for i in (4, 5)) or after["ok"]
    finally:
        term.close()
    actual = {"before": before, "oldEntriesBeforeSubmit": old_still_listed, "after": after}
    return ("after the submit the Pane equals the chain: R00-R02 and the new prompt; R03-R05 gone",
            actual, before["ok"] and after["ok"] and gone, evidence)


def life_005_continue(world, host, run):
    write_session(world, host, SESSION_B, "O", 3, seed=1)
    time.sleep(1.1)
    path = write_session(world, host, SESSION_A, "N", 4, compact_after=(1,), rewind=True)
    term = h.launch(world, host, [PLUGIN], ["--continue"], run=run)
    try:
        wait_docked(term)
        got = compare(term, path, "after --continue")
    finally:
        term.close()
    return ("--continue opens the newest session; the Pane equals its chain", got, got["ok"], got.pop("evidence"))


def life_005_fork(world, host, run):
    """The fork's own file does not exist until its first submit, so until
    then the session's chain is empty; after it, the Pane lists the fork
    file's chain (the host copies the turns it holds, those after the last
    compaction), and the original file is left alone."""
    path = write_session(world, host, SESSION_A, "F", 4, compact_after=(1,), rewind=True)
    term = h.launch(world, host, [PLUGIN], ["--resume", SESSION_A, "--fork-session"], run=run)
    evidence, actual = [], {}
    try:
        term.wait_for(lambda t: v.parse_pane(t.rows()) is not None, "the Pane", timeout=30)
        rows = term.settle(quiet=1.5)
        evidence.append(term.snap("after --fork-session, before a submit"))
        pane = v.parse_pane(rows)
        fork_at_start = newest_other(world, SESSION_A)
        actual["atStart"] = {"forkFile": fork_at_start.name if fork_at_start else None,
                             "entries": len(pane.entries) if pane else None,
                             "emptyText": any("本会话还没有对话" in r for r in rows)}
        start_ok = fork_at_start is None and pane is not None and not pane.entries and actual["atStart"]["emptyText"]
        submit(term, "F 分叉之后的合成 prompt")
        forked = newest_other(world, SESSION_A)
        actual["forkFile"] = forked.name if forked else None
        after = compare(term, forked or path, "after the first submit in the fork")
        evidence += after.pop("evidence")
        actual["afterSubmit"] = after
        original = v.expected_toc(path)
        actual["originalUntouched"] = not any("分叉之后" in g.public()["userText"] for g in original.groups)
    finally:
        term.close()
    ok = start_ok and after["ok"] and forked is not None and actual["originalUntouched"]
    return ("before the first submit the fork has no file and the Pane lists nothing; after it the Pane equals "
            "the fork file's chain; the original file keeps its own", actual, ok, evidence)


def life_005_in_session(world, host, run):
    path_b = write_session(world, host, SESSION_B, "B", 3, seed=2, rewind=True)
    time.sleep(1.1)
    path_a = write_session(world, host, SESSION_A, "A", 4, seed=3)
    term = h.launch(world, host, [PLUGIN], ["--resume", SESSION_A], run=run)
    evidence = []
    try:
        wait_docked(term)
        first = compare(term, path_a, "session A before /resume")
        evidence += first.pop("evidence")
        term.type("/resume")
        time.sleep(0.6)
        term.key("enter")
        term.wait_for(lambda t: t.find("B00") is not None or t.find("BYY") is not None, "the resume picker", timeout=15)
        evidence.append(term.snap("resume picker"))
        for _ in range(6):
            rows = term.rows()
            chosen = next((r for r in rows if "❯" in r), "")
            if "B0" in chosen or "BYY" in chosen:
                break
            term.key("down")
            time.sleep(0.3)
        term.key("enter")
        term.wait_for(lambda t: t.find("B00 合成问题") is not None and t.find("A00 合成问题") is None,
                      "session B in the transcript", timeout=20)
        second = compare(term, path_b, "session B after in-session /resume")
        evidence += second.pop("evidence")
    finally:
        term.close()
    return ("after /resume picks B, the Pane equals B's chain", {"A": first, "B": second},
            first["ok"] and second["ok"], evidence)


def data_006(world, host, run):
    path_a = write_session(world, host, SESSION_A, "P", 4, seed=4)
    path_b = write_session(world, host, SESSION_B, "Q", 3, seed=5, compact_after=(0,))
    one = h.launch(world, host, [PLUGIN], ["--resume", SESSION_A], run=run)
    two = h.launch(world, host, [PLUGIN], ["--resume", SESSION_B], run=run)
    evidence = []
    try:
        wait_docked(one)
        wait_docked(two)
        a1, b1 = compare(one, path_a, "terminal 1, session A"), compare(two, path_b, "terminal 2, session B")
        submit(one, "P 终端一里提交的合成 prompt")
        a2, b2 = compare(one, path_a, "terminal 1 after its submit"), compare(two, path_b, "terminal 2 after terminal 1's submit")
        for got in (a1, b1, a2, b2):
            evidence += got.pop("evidence")
    finally:
        one.close()
        two.close()
    ok = all(x["ok"] for x in (a1, b1, a2, b2))
    return ("each terminal lists only its own session's chain, before and after a submit in one of them",
            {"A": a1, "B": b1, "AafterSubmit": a2, "BafterSubmit": b2}, ok, evidence)


SCENARIOS = {
    "life-003": ("CT-LIFE-003", life_003),
    "life-004": ("CT-LIFE-004", life_004),
    "life-005-continue": ("CT-LIFE-005", life_005_continue),
    "life-005-fork": ("CT-LIFE-005", life_005_fork),
    "life-005-in-session": ("CT-LIFE-005", life_005_in_session),
    "data-006": ("CT-DATA-006", data_006),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="current")
    parser.add_argument("--only", default="")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    host = h.Host(args.host)
    run = h.Run(args.out, f"chain-{host.version}")
    names = [n for n in args.only.split(",") if n] or list(SCENARIOS)
    failed = 0
    for name in names:
        scenario, fn = SCENARIOS[name]
        world = h.World(token="")
        try:
            expected, actual, ok, evidence = fn(world, host, run)
            result = "pass" if ok else "fail"
        except h.ScenarioFailure as error:
            expected, actual, ok, evidence, result = name, {"error": str(error)}, False, [], "fail"
        finally:
            world.remove()
        run.record(scenario, host=host.version, plugin=str(PLUGIN), fixture=name, expected=expected,
                   actual=json.loads(json.dumps(actual, default=str)), result=result, evidence=evidence)
        print(f"{name} ({scenario}) on {host.version}: {result}")
        failed += not ok
    print("run directory:", run.dir)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
