#!/bin/sh
# Release evidence for Issue 21: on a 100,000-event Project Timeline, the p95
# of the helper calls behind opening the band (the latest batch), loading the
# next batch back, and showing a new entry (capture then re-read). The band's
# own parsing and drawing (at most 129 events per read) are not timed here.
# Then the same on one Run's single 100,000-deep lineage with a Run start
# every 1,000 events (backlog timeline-read-per-batch-cost): the first read,
# which walks the whole path once, and the reads after it, which the band
# sends with where the path began and an entry of it next to the batch.
# One warm-up, then ten runs each.
# Not part of verify-startup.sh: it builds a large archive and measures this
# machine. Works in a throwaway directory; prints identity, counts and timings
# only, never prompt text.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COUNT=${1:-100000}

exec python3 - "$ROOT" "$COUNT" <<'PY'
import json
import math
import pathlib
import platform
import subprocess
import sys
import tempfile
import time
import uuid

root = pathlib.Path(sys.argv[1])
count = int(sys.argv[2])
sys.path.insert(0, str(root / "tests"))
import timeline_fixture  # noqa: E402

helper = root / "bin" / "prompt-history-helper"
sha = json.loads((root / "artifacts" / "helper-manifest.json").read_text())["sha256"]
project = "b" * 64
runs = 10


def sysctl(name: str) -> str:
    return subprocess.run(
        ["/usr/sbin/sysctl", "-n", name], capture_output=True, text=True, check=True
    ).stdout.strip()


def helper_call(*argv: str, stdin: str | None = None) -> str:
    result = subprocess.run(
        [str(helper), *argv], input=stdin, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise SystemExit(f"{argv[0]} failed: {result.stderr.strip()}")
    return result.stdout


def p95(samples: list[float]) -> float:
    ordered = sorted(samples)
    return ordered[math.ceil(0.95 * len(ordered)) - 1]


with tempfile.TemporaryDirectory() as temporary:
    # The helper vouches only for a private, fully resolved plugin data root.
    plugin_data = pathlib.Path(temporary).resolve() / "plugin-data"
    plugin_data.mkdir(mode=0o700)
    archives = str(plugin_data / "archives")
    helper_call(
        "boundary-append", archives, project, str(uuid.uuid4()), str(uuid.uuid4()),
        str(uuid.uuid4()), "run-started", str(uuid.uuid4()), "1795000000000", "-", sha, "1",
    )
    built = time.perf_counter()
    events = timeline_fixture.build(
        pathlib.Path(archives) / f"{project}.sqlite3", project, count - 1
    )
    built = time.perf_counter() - built
    tip = next((e for e in reversed(events) if e["kind"] == "prompt"), None)
    if tip is None:
        sys.exit("benchmark-timeline: the fixture holds no Prompt Entry; use a larger count")
    total = events[-1]["sequence"]
    cursors = [total // 2, 200]
    state = {"loads": 0, "parent": tip["eventId"]}

    def read(*cursor: str, tip_id: str) -> None:
        payload = json.loads(helper_call(
            "timeline-read", archives, project, sha, "1", *cursor, tip["runId"], tip_id,
        ))
        assert len(payload["events"]) <= 129

    def expand() -> None:
        read(tip_id=tip["eventId"])

    def load_next_batch() -> None:
        cursor = cursors[state["loads"] % len(cursors)]
        state["loads"] += 1
        read("before", str(cursor), tip_id=tip["eventId"])

    def show_new_entry() -> None:
        event_id = str(uuid.uuid4())
        text = f"PH-BENCH {event_id[:8]}"
        helper_call(
            "capture-begin", archives, project, tip["runId"], tip["segmentId"],
            tip["branchId"], state["parent"], event_id, "1795000000000", "0", "-", "-",
            sha, "1", "--stdin", stdin=text,
        )
        helper_call("capture-confirm", archives, project, event_id, sha, "1", "--stdin", stdin=text)
        state["parent"] = event_id
        read(tip_id=event_id)

    deep_project = "c" * 64
    helper_call(
        "boundary-append", archives, deep_project, str(uuid.uuid4()), str(uuid.uuid4()),
        str(uuid.uuid4()), "run-started", str(uuid.uuid4()), "1795000000000", "-", sha, "1",
    )
    deep = timeline_fixture.lineage(
        pathlib.Path(archives) / f"{deep_project}.sqlite3", deep_project, count - 1,
        starts_every=1000,
    )
    deep_prompts = [e for e in deep if e["kind"] == "prompt"]
    deep_tip = deep_prompts[-1]
    deep_start = str(deep_prompts[0]["sequence"])
    deep_total = deep[-1]["sequence"]
    # Each cursor leaves at least one entry of the path below it, however
    # short the fixture.
    deep_cursors = [max(at, deep_prompts[0]["sequence"] + 1) for at in (deep_total // 2, 200)]
    deep_state = {"loads": 0}

    def deep_read(*argv: str) -> None:
        payload = json.loads(helper_call(
            "timeline-read", archives, deep_project, sha, "1", *argv,
        ))
        assert len(payload["events"]) <= 129

    def deep_first_read() -> None:
        deep_read(deep_tip["runId"], deep_tip["eventId"])

    def deep_expand() -> None:
        deep_read(deep_tip["runId"], deep_tip["eventId"], deep_start, "-")

    def deep_load_earlier() -> None:
        cursor = deep_cursors[deep_state["loads"] % len(deep_cursors)]
        deep_state["loads"] += 1
        # The path's highest entry below the window, as the read that brought
        # the window there answered it.
        below = next(e for e in reversed(deep_prompts) if e["sequence"] < cursor)
        deep_read(
            "before", str(cursor), deep_tip["runId"], deep_tip["eventId"],
            deep_start, below["eventId"],
        )

    results = {}
    for name, action in (
        ("expand", expand),
        ("loadNextBatch", load_next_batch),
        ("showNewEntry", show_new_entry),
        ("deepLineageFirstRead", deep_first_read),
        ("deepLineageExpand", deep_expand),
        ("deepLineageLoadNextBatch", deep_load_earlier),
    ):
        action()  # warm-up
        samples = []
        for _ in range(runs):
            started = time.perf_counter()
            action()
            samples.append(time.perf_counter() - started)
        results[name] = {
            "p95Ms": round(p95(samples) * 1000, 1),
            "medianMs": round(sorted(samples)[len(samples) // 2] * 1000, 1),
        }

    probe = json.loads(helper_call("probe", "--protocol", "1"))
    report = {
        "events": total,
        "fixtureBuildSeconds": round(built, 1),
        "warmup": 1,
        "runs": runs,
        "machine": sysctl("hw.model"),
        "cpu": sysctl("machdep.cpu.brand_string"),
        "memoryGiB": round(int(sysctl("hw.memsize")) / 2**30),
        "macOS": platform.mac_ver()[0],
        "sqliteVersionNumber": probe["sqliteVersionNumber"],
        "helperSha256": sha,
        "results": results,
    }
    print(json.dumps(report, indent=2))
    if any(result["p95Ms"] > 1000 for result in results.values()):
        raise SystemExit("p95 over 1 second")
PY
