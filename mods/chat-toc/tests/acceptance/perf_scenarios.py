"""CT-PERF-001 and CT-PERF-002: chat-toc on a 20 MiB transcript, timed in
the real host, the preview open (a click on the newest entry opens it).

usage:
  $PY perf_scenarios.py run <host-version|current> <many|heavy> [--runs 3] [--out DIR]
  $PY perf_scenarios.py table <run-dir>...          # the release report's tables

Each run resumes a fresh 20 MiB fixture (ticket 18's transcript_fixture.py:
`many` about 4400 turns, `heavy` about 110 turns with large tool results) in
the harness's isolated world, pyte at 170x44, no model call, with
CHAT_TOC_PERF=1 so chat-toc writes its timings (numbers only, perf.ts) to
the host's --debug-file. The load average is recorded at each run's start
and end. Steps, as ticket 12 measured them, with 0.2's search added (6):

  1. cold resume: when the transcript shows the last turn, when the Pane
     lists entries (screen polling, wall clock);
  2. wheel the transcript up and down 150 ticks, the Pane up 100 and down 60;
  3. reach the first group: wheel the Pane to its top (no paging), click
     T0000's prompt, the transcript shows it at the top;
  4. wheel the transcript down 1500 ticks fast from there: the on-screen
     records it leaves behind;
  5. reach the last group: wheel the Pane to its end, click the newest
     entry, the transcript shows the last turn;
  6. search: a click on the field, then each query typed a letter at a
     time and taken back with Backspace a letter at a time, every change
     one keystroke (keystroke to the redrawn Pane), Esc to leave;
  7. hot reload the plugin copy (idle whole read and regroup, the search
     index included);
  8. five prompts submitted while not logged in: the host writes the
     prompt and its "Not logged in" row, raising session.append, no model
     call (incremental reads, append to model update).

Synthetic prompts only. Every run directory gets run.jsonl (a CT-PERF-001
and a CT-PERF-002 record per run), the debug log, the samples as
perf-samples.json, and the screens.
"""
import argparse
import json
import os
import pathlib
import shutil
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pty_harness as h  # noqa: E402
import toc_verifier as v  # noqa: E402

PLUGIN = HERE.parent.parent
LEAD = "chat-toc-perf "            # perf.ts PERF_LEAD
RELOADED = "chat-toc@inline reloaded"
SUBMITS = 5

# CT-PERF-001 thresholds (spec §9), ms
LIMITS = {
    "tocLagMs": 4000, "idleWholeMs": 1000, "tailReadMs": 150, "appendModelMs": 1000,
    "paneOwnMs": 16, "paneTotalMs": 100, "positionMs": 2, "positionResidueMs": 5,
}
# CT-PERF-002 thresholds (0.2 spec §10), ms; the reads' and the Pane's stand
SEARCH_LIMITS = {"searchOwnMs": 50, "searchTotalMs": 100}

# Typed into the search field a letter at a time: one matching nearly every
# turn (CJK), one narrowing to a single turn, two words (T0100-T0199 in
# `many`, T0100-T0106 in `heavy`), none matching.
QUERIES = ["模块", "T0042", "正常 T01", "zzzz"]
KEY_GAP = 0.25                     # s between keystrokes: one redraw each


def load_average() -> list[float]:
    return [round(x, 2) for x in os.getloadavg()]


def pct(xs, p=0.95):
    xs = sorted(x for x in xs if x is not None)
    return None if not xs else xs[min(len(xs) - 1, int(len(xs) * p))]


def samples_of(log: pathlib.Path) -> dict:
    """The perf lines of a debug log, split at each hot reload: phase 0 is the
    module the host started with, phase 1 the first reload's, ..."""
    phases: list[dict] = [{}]
    broken = 0
    for line in log.read_text(errors="replace").splitlines():
        if RELOADED in line:
            phases.append({})
        at = line.find(LEAD)
        if at < 0:
            continue
        try:
            got = json.loads(line[at + len(LEAD):])
        except json.JSONDecodeError:
            broken += 1
            continue
        for metric, values in got.items():
            phases[-1].setdefault(metric, []).extend(values)
    return {"phases": phases, "brokenLines": broken}


def pane_of(t):
    return v.parse_pane(t.rows())


def wheel_pane_to(t, up: bool, done, limit: int = 2000, ticks: int = 20):
    """Wheels the Pane in one direction, batch after batch, until `done(pane)`;
    the pane, the batches and the seconds it took."""
    column, row = h._wheel_point(t)
    began, batches = time.monotonic(), 0
    for batches in range(1, limit + 1):
        t.wheel(column, row, up=up, ticks=ticks, gap=0.005)
        time.sleep(0.05)
        p = pane_of(t)
        if p is not None and done(p):
            p = v.parse_pane(t.settle(quiet=0.5))
            if p is not None and done(p):
                return p, batches, round(time.monotonic() - began, 2)
    raise h.ScenarioFailure("the Pane never got there")


def query_of(t) -> str | None:
    p = pane_of(t)
    return None if p is None or p.search is None else p.search.get("text")


def wait_query(t, text: str) -> None:
    t.wait_for(lambda _t: query_of(_t) == text, f"the field holding {text!r}", timeout=15)


def search_step(t, evidence: list, label: str) -> dict:
    """Step 6: every query typed into the field and taken back, a letter at
    a time; the keystrokes sent and the matches each full query listed."""
    p = pane_of(t)
    if p is None or p.search is None:
        raise h.ScenarioFailure("no search row")
    t.click(p.left + 10, p.filter_row + 2)
    time.sleep(0.5)
    keystrokes, counts = 0, {}
    for query in QUERIES:
        for char in query:
            t.type(char)
            keystrokes += 1
            time.sleep(KEY_GAP)
        wait_query(t, query)
        t.settle(quiet=0.4)
        counts[query] = (pane_of(t).search or {}).get("count")
        evidence.append(t.snap(f"{label} query {query}"))
        for _ in query:
            t.key("backspace", pause=KEY_GAP)
            keystrokes += 1
        wait_query(t, "")
    t.key("esc")
    t.settle(quiet=0.6)
    return {"keystrokes": keystrokes, "counts": counts}


def file_rows(path: pathlib.Path) -> int:
    with open(path, "rb") as handle:
        return sum(1 for _ in handle)


def one_run(host: h.Host, kind: str, run: h.Run, n: int) -> dict:
    world = h.World(token="")
    fx = world.fixture(kind, mib=20, version=host.version)
    turns = fx["turns"]
    last = f"T{turns - 1:04d}"
    plugin = world.base / "chat-toc"
    shutil.copytree(PLUGIN, plugin, ignore=shutil.ignore_patterns("tests", "build", "node_modules", "release"))
    log = run.dir / f"debug-{kind}-{n}.log"
    actual: dict = {"fixture": {"kind": kind, "turns": turns, "bytes": fx["bytes"], "rows": fx["rows"]},
                    "loadAverage": {"start": load_average()}}
    evidence: list = [log]
    spawned = time.monotonic()
    t = h.launch(world, host, [plugin], ["--resume", fx["session"], "--debug-file", str(log)], run=run,
                 env={"CHAT_TOC_PERF": "1"})
    ok = True
    try:
        # 1. cold resume
        host_ready = toc_ready = None
        while time.monotonic() - spawned < 120 and not (host_ready and toc_ready):
            rows = t.rows()
            p = v.parse_pane(rows)
            text = h.transcript_text(rows, p.left) if p else "\n".join(rows)
            now = time.monotonic() - spawned
            if host_ready is None and last in text:
                host_ready = now
            if toc_ready is None and p is not None and p.entries:
                toc_ready = now
            time.sleep(0.05)
        if not (host_ready and toc_ready):
            raise h.ScenarioFailure(f"resume: transcript at {host_ready}, pane at {toc_ready}")
        actual["hostReadyS"], actual["tocReadyS"] = round(host_ready, 2), round(toc_ready, 2)
        actual["tocLagMs"] = round(max(0.0, toc_ready - host_ready) * 1000)
        rows = t.settle(quiet=1.0)
        evidence.append(t.snap(f"{kind}-{n} after resume"))
        # the preview is closed until a press (ticket 22): a click on the
        # newest entry opens it, and the later clicks keep it open
        opened = v.parse_pane(rows)
        if opened is not None and opened.entries and opened.entries[-1].user_row is not None:
            t.click(opened.left + 4, opened.entries[-1].user_row)
            rows = t.settle(quiet=1.0)
        shown = v.parse_pane(rows)
        actual["previewRows"] = len(shown.preview or []) if shown else 0

        # 2. wheel the transcript and the pane
        p = pane_of(t)
        for up, ticks in ((True, 150), (False, 150)):
            t.wheel(20, 15, up=up, ticks=ticks, gap=0.01)
            t.settle(quiet=0.6)
        column, row = h._wheel_point(t)
        for up, ticks in ((True, 100), (False, 60)):
            t.wheel(column, row, up=up, ticks=ticks, gap=0.01)
            t.settle(quiet=0.6)

        # 3. the first group: the Pane wheeled to its top, T0000 clicked
        top, batches, secs = wheel_pane_to(t, True, lambda p: bool(p.entries) and "T0000" in p.entries[0].user_text)
        actual["paneToTop"] = {"batches": batches, "ticks": batches * 20, "s": secs}
        evidence.append(t.snap(f"{kind}-{n} pane at its top"))
        t.click(top.left + 4, top.entries[0].user_row)
        rows = t.settle(quiet=1.0)
        reached_first = "T0000 用户问题" in "\n".join(h.transcript_text(rows, top.left).splitlines()[:6])
        actual["reachedFirst"] = reached_first
        evidence.append(t.snap(f"{kind}-{n} after clicking T0000"))

        # 4. the transcript wheeled fast from the top: records left behind (ticket 24)
        t.wheel(20, 15, up=False, ticks=1500, gap=0.004)
        t.settle(quiet=1.0)

        # 5. the last group: the Pane wheeled to its end, the newest clicked
        newest_text = v.expected_toc(world.transcript(fx["session"])).groups[-1].user_text[:12]
        is_newest = lambda e: e.user_text.startswith(newest_text)  # noqa: E731
        end, batches, secs = wheel_pane_to(t, False, lambda p: any(is_newest(e) for e in p.entries))
        actual["paneToEnd"] = {"batches": batches, "ticks": batches * 20, "s": secs}
        evidence.append(t.snap(f"{kind}-{n} pane at its end"))
        newest = next(e for e in end.entries if is_newest(e))
        t.click(end.left + 4, newest.user_row)
        rows = t.settle(quiet=1.0)
        reached_last = last in h.transcript_text(rows, end.left)
        actual["reachedLast"] = reached_last
        evidence.append(t.snap(f"{kind}-{n} after clicking the newest"))

        # 6. search: keystrokes into the field
        actual["search"] = search_step(t, evidence, f"{kind}-{n}")

        # 7. hot reload: an idle whole read and regroup
        mark = log.stat().st_size
        module = plugin / "hooks" / "register.tsx"
        module.write_text(module.read_text() + f"\n// perf reload {time.time()}\n")
        t.wait_for(lambda _t: RELOADED in log.read_text(errors="replace")[mark:], "the hot reload", timeout=30)
        t.wait_for(lambda _t: (p := pane_of(_t)) is not None and p.entries, "the Pane after the reload", timeout=30)
        t.settle(quiet=1.5)

        # 8. prompts submitted while not logged in
        transcript = world.transcript(fx["session"])
        for k in range(SUBMITS):
            before = file_rows(transcript)
            t.type(f"CT-PERF 追加的合成 prompt {k}")
            time.sleep(0.3)
            t.key("enter")
            t.wait_for(lambda _t: file_rows(transcript) >= before + 2, "the submit's rows", timeout=30)
            t.settle(quiet=1.0)
        evidence.append(t.snap(f"{kind}-{n} after the submits"))
        time.sleep(2.0)                                  # the last samples' flush (1 s)
    except h.ScenarioFailure as failure:
        ok, actual["failure"] = False, str(failure)
        evidence.append(t.snap(f"{kind}-{n} failure"))
    finally:
        t.close()
        world.remove()
    samples = samples_of(log)
    (run.dir / f"perf-samples-{kind}-{n}.json").write_text(json.dumps(samples))
    evidence.append(run.dir / f"perf-samples-{kind}-{n}.json")
    actual.update(summary_of(samples))
    actual["loadAverage"]["end"] = load_average()
    reached = actual.get("reachedFirst") is True and actual.get("reachedLast") is True
    is_preview_open = actual.get("previewRows", 0) > 1
    fixture = f"{kind} 20 MiB ({turns} turns)"
    run.record("CT-PERF-001", host=host.version, plugin=str(PLUGIN), fixture=fixture,
               expected="the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; "
                        "tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; "
                        "Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps",
               actual=actual, result="pass" if ok and reached and is_preview_open and within(actual) else "fail",
               evidence=evidence)
    run.record("CT-PERF-002", host=host.version, plugin=str(PLUGIN), fixture=fixture,
               expected="a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); "
                        "idle whole read with the index <= 1 s; tail read with the index <= 150 ms; "
                        "pane own with the preview open <= 16 ms",
               actual=actual, result="pass" if ok and is_preview_open and within_search(actual) else "fail",
               evidence=evidence)
    return actual


def summary_of(samples: dict) -> dict:
    """One run's samples, as the report counts them. Phase 0 is the cold
    resume, the last phase the hot-reloaded module (idle whole read, tail
    reads, appends)."""
    phases = samples["phases"]
    every = {}
    for phase in phases:
        for metric, values in phase.items():
            every.setdefault(metric, []).extend(values)
    first_whole = phases[0].get("read.whole", [[None]])[0][0]
    idle_whole = [s[0] for s in phases[-1].get("read.whole", [])] if len(phases) > 1 else []
    pane = every.get("pane", [])
    position = every.get("position", [])
    search = every.get("search", [])
    index = every.get("index", [])
    idle_index = [s[0] for s in phases[-1].get("index", [])] if len(phases) > 1 else []
    return {
        "searchOwnMs": [len(search), pct([s[0] for s in search], 0.5), pct([s[0] for s in search]),
                        max((s[0] for s in search), default=None)],
        "searchTotalMs": [len(search), pct([s[1] for s in search], 0.5), pct([s[1] for s in search]),
                          max((s[1] for s in search), default=None)],
        "searchMatchesMax": max((s[2] for s in search), default=None),
        "indexStartMs": (phases[0].get("index") or [[None]])[0][0],
        "indexIdleMs": max(idle_index) if idle_index else None,
        "indexTailMaxMs": max((s[0] for s in index if s[1] < s[2]), default=None),
        "startWholeMs": first_whole,
        "idleWholeMs": max(idle_whole) if idle_whole else None,
        "groups": (phases[0].get("read.whole") or [[None] * 4])[0][3],
        "tailReadMs": [len(every.get("read.tail", [])), pct([s[0] for s in every.get("read.tail", [])], 0.5),
                       pct([s[0] for s in every.get("read.tail", [])])],
        "appendModelMs": [len(every.get("append.model", [])), pct([s[0] for s in every.get("append.model", [])], 0.5),
                          pct([s[0] for s in every.get("append.model", [])])],
        "paneOwnMs": [len(pane), pct([s[0] for s in pane], 0.5), pct([s[0] for s in pane]), max((s[0] for s in pane), default=None)],
        "paneTotalMs": [len(pane), pct([s[1] for s in pane], 0.5), pct([s[1] for s in pane]), max((s[1] for s in pane), default=None)],
        "paneRebuiltOwnMaxMs": max((s[0] for s in pane if s[3] == 1), default=None),
        "positionMs": [len(position), pct([s[0] for s in position], 0.5), pct([s[0] for s in position]),
                       max((s[0] for s in position), default=None)],
        "onScreenRecordsMax": max((s[1] for s in position), default=None),
        "listedMs": (every.get("listed") or [[None]])[0][0],
        "brokenLogLines": samples.get("brokenLines", 0),
    }


def within(a: dict) -> bool:
    checks = [
        a.get("tocLagMs") is not None and a["tocLagMs"] <= LIMITS["tocLagMs"],
        a.get("idleWholeMs") is not None and a["idleWholeMs"] <= LIMITS["idleWholeMs"],
        a["tailReadMs"][2] is not None and a["tailReadMs"][2] <= LIMITS["tailReadMs"],
        a["appendModelMs"][2] is not None and a["appendModelMs"][2] <= LIMITS["appendModelMs"],
        a["paneOwnMs"][2] is not None and a["paneOwnMs"][2] <= LIMITS["paneOwnMs"],
        a["paneTotalMs"][2] is not None and a["paneTotalMs"][2] <= LIMITS["paneTotalMs"],
        a["positionMs"][2] is not None and a["positionMs"][2] <= LIMITS["positionMs"],
    ]
    return all(checks)


def within_search(a: dict) -> bool:
    sent = (a.get("search") or {}).get("keystrokes", 0)
    checks = [
        # every keystroke redraws once, unless two came in one drawing
        sent > 0 and a["searchOwnMs"][0] >= sent // 2,
        a["searchOwnMs"][2] is not None and a["searchOwnMs"][2] <= SEARCH_LIMITS["searchOwnMs"],
        a["searchTotalMs"][2] is not None and a["searchTotalMs"][2] <= SEARCH_LIMITS["searchTotalMs"],
        a.get("idleWholeMs") is not None and a["idleWholeMs"] <= LIMITS["idleWholeMs"],
        a["tailReadMs"][2] is not None and a["tailReadMs"][2] <= LIMITS["tailReadMs"],
        a["paneOwnMs"][2] is not None and a["paneOwnMs"][2] <= LIMITS["paneOwnMs"],
    ]
    return all(checks)


# ---------- the report's tables ----------

SEARCH_ROWS = [
    ("A keystroke in the search field to the Pane redrawn, the plugin's own work", "≤ 50 ms", "searchOwnMs", "sample", 1, "ms"),
    ("The same, waiting on the host included", "≤ 100 ms", "searchTotalMs", "sample", 1, "ms"),
    ("Whole read and regroup when idle, the search index included", "≤ 1 s", "idleWholeMs", "run", 1, "ms"),
    ("Of which the search index (for reference)", "—", "indexIdleMs", "run", 1, "ms"),
    ("Incremental read, each, the index's rebuild included", "≤ 150 ms", "tailReadMs", "sample", 1, "ms"),
    ("Pane redraw with the preview open, the plugin's own work", "≤ 16 ms", "paneOwnMs", "sample", 1, "ms"),
]

ROWS = [
    ("First listing: the TOC after the host shows the last turn", "≤ 4 s", "tocLagMs", "run", 1 / 1000, "s"),
    ("Whole read and regroup at start (contends with the host's resume; for reference)", "—", "startWholeMs", "run", 1, "ms"),
    ("Whole read and regroup when idle (after a hot reload)", "≤ 1 s", "idleWholeMs", "run", 1, "ms"),
    ("Incremental read, each", "≤ 150 ms", "tailReadMs", "sample", 1, "ms"),
    ("An appended row to the TOC model update", "≤ 1 s", "appendModelMs", "sample", 1, "ms"),
    ("Pane redraw, the plugin's own work", "≤ 16 ms", "paneOwnMs", "sample", 1, "ms"),
    ("Pane redraw, waiting on the host included", "≤ 100 ms", "paneTotalMs", "sample", 1, "ms"),
    ("Current position, each computation", "≤ 2 ms", "positionMs", "sample", 1, "ms"),
]


def table(dirs: list[pathlib.Path], scenario: str = "CT-PERF-001") -> str:
    records = [r for d in dirs for line in (d / "run.jsonl").read_text().splitlines()
               if line.strip() and (r := json.loads(line))["scenario"] == scenario]
    combos = sorted({(r["host"], r["actual"]["fixture"]["kind"]) for r in records}, key=lambda c: (c[0], c[1] != "many"))
    head = "| Item | Limit | " + " | ".join(f"{host} {kind}" for host, kind in combos) + " |"
    out = [head, "|" + "---|" * (2 + len(combos))]
    by = {c: [r for r in records if (r["host"], r["actual"]["fixture"]["kind"]) == c] for c in combos}
    if scenario == "CT-PERF-002":
        cells(out, by, combos, SEARCH_ROWS)
        out.append("| Keystrokes timed (all runs) | — | " + " | ".join(
            str(sum(r["actual"]["searchOwnMs"][0] for r in by[c])) for c in combos) + " |")
    else:
        cells(out, by, combos, ROWS)
        reached = []
        for c in combos:
            rs = by[c]
            reached.append("yes" if rs and all(r["actual"].get("reachedFirst") and r["actual"].get("reachedLast") for r in rs) else "no")
        out.append("| Long session: continuous scrolling, jumps to the first and last groups | must reach, no paging | " + " | ".join(reached) + " |")
        out.append("| On-screen records actually left (most) | — | " + " | ".join(
            str(max((r["actual"].get("onScreenRecordsMax") or 0) for r in by[c])) for c in combos) + " |")
    out.append("| Load average (1 min) at the runs' starts, least–most | — | " + " | ".join(
        load_range([r["actual"].get("loadAverage", {}).get("start", [None])[0] for r in by[c]]) for c in combos) + " |")
    out.append("| Runs (all passed) | 3 | " + " | ".join(
        f"{len(by[c])} ({sum(r['result'] == 'pass' for r in by[c])})" for c in combos) + " |")
    return "\n".join(out)


def cells(out: list, by: dict, combos: list, rows: list) -> None:
    """One table row per item: per run, items counted per run take the
    largest of the runs, items counted per sample each run's p95, then the
    largest."""
    for label, limit, key, scope, scale, unit in rows:
        line = []
        for c in combos:
            values = [r["actual"].get(key) for r in by[c]]
            if scope == "run":
                xs = [x for x in values if x is not None]
                m = max(xs) if xs else None
                line.append("—" if m is None else f"{m * scale:.2f} {unit}" if unit == "s" or m < 10 else f"{m:.0f} {unit}")
            else:
                p95s = [x[2] for x in values if x and x[2] is not None]
                line.append("—" if not p95s else f"{max(p95s):g} {unit}")
        out.append(f"| {label} | {limit} | " + " | ".join(line) + " |")


def load_range(starts: list) -> str:
    xs = sorted(x for x in starts if x is not None)
    return "—" if not xs else f"{xs[0]:g}" if xs[0] == xs[-1] else f"{xs[0]:g}–{xs[-1]:g}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("host")
    r.add_argument("kind", choices=["many", "heavy"])
    r.add_argument("--runs", type=int, default=3)
    r.add_argument("--out", type=pathlib.Path)
    tb = sub.add_parser("table")
    tb.add_argument("dirs", nargs="+", type=pathlib.Path)
    a = parser.parse_args()
    if a.cmd == "table":
        for scenario in ("CT-PERF-001", "CT-PERF-002"):
            print(f"{scenario}\n\n{table(a.dirs, scenario)}\n")
        return 0
    host = h.Host(a.host)
    run = h.Run(a.out, f"ct-perf-{host.version}-{a.kind}")
    results = [one_run(host, a.kind, run, n) for n in range(1, a.runs + 1)]
    print(json.dumps(results, ensure_ascii=False, indent=1))
    print(run.dir)
    return 0 if all(rec["result"] == "pass" for rec in run.records) else 1


if __name__ == "__main__":
    sys.exit(main())
