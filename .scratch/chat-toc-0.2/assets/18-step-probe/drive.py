#!/usr/bin/env python3
"""Drives a real Claude Code (isolated world, not logged in) with step-probe
loaded, a 30-turn fixture resumed and the world's keybindings.json binding
`meta+k` / `meta+j` to the two borrowed actions, and records:

1. what `$.ui.scroll` answers to a press that came by a bound key, from the
   pane and from the band, and whether the transcript moved;
2. whether the band is drawn again when the pane becomes, or stops being, a
   back tab by a pure tab switch (`ctrl+x .` -> pane:next).

    drive.py <host: current|version> <out dir>
"""
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "mods/chat-toc/tests/acceptance"))
import pty_harness as h  # noqa: E402

BINDINGS = {"bindings": [{"context": "Global", "bindings": {
    "meta+k": "app:toggleDiffNoiseFilter",
    "meta+j": "app:toggleDiffPreSession",
    "ctrl+x .": "pane:next",
}}]}

PREV, NEXT, TAB = "\x1bk", "\x1bj", "\x18."
SESSION = "00000000-0000-4000-8000-000000000018"


def user_uuid(path: pathlib.Path, marker: str) -> str:
    for line in path.read_text().splitlines():
        row = json.loads(line)
        content = row.get("message", {}).get("content") if row.get("type") == "user" else None
        if isinstance(content, str) and content.startswith(marker):
            return row["uuid"]
    raise RuntimeError(f"no user row {marker}")


def transcript_side(rows: list[str]) -> str:
    """The rows left of the pane's border (or whole rows with no pane)."""
    out = []
    for r in rows:
        cut = r.find("│", 60)
        out.append(r[:cut] if cut > 0 else r)
    return "\n".join(out)


def main() -> None:
    host = h.Host(sys.argv[1])
    out = pathlib.Path(sys.argv[2]).resolve() / host.version
    out.mkdir(parents=True, exist_ok=True)
    world = h.World(token="")
    (world.config / "keybindings.json").write_text(json.dumps(BINDINGS, indent=1))
    world.fixture("turns", session=SESSION, turns=30, version=host.version)
    path = world.transcript(SESSION)
    prev, nxt = user_uuid(path, "T0020"), user_uuid(path, "T0003")
    log = out / "step-probe.log"
    debug = out / "debug.log"
    for f in (log, debug):
        f.unlink(missing_ok=True)
    env = world.environment(extra={"PROBE_LOG": str(log), "PROBE_PREV": prev, "PROBE_NEXT": nxt})
    argv = world.argv(host, [HERE / "step-probe"], ["--resume", SESSION, "--debug-file", str(debug)])
    t = h.PyteTerminal(argv, env, world.project, 170, 44)
    record = []
    n = 0

    def lines():
        return log.read_text().splitlines() if log.exists() else []

    def step(label, send=None, wait=1.5):
        nonlocal n
        before = len(lines())
        if send is not None:
            t._write(send)
        time.sleep(wait)
        rows = t.settle(quiet=0.6, timeout=20)
        n += 1
        (out / f"{n:03d}-{label}.txt").write_text("\n".join(rows) + "\n")
        side = transcript_side(rows)
        record.append({
            "step": label,
            "log": lines()[before:],
            "band_drawn": any("PROBEBAND" in r for r in rows),
            "pane_front": any("PROBEPANE r" in r for r in rows),
            "pane2_front": any("PROBEPANE2" in r for r in rows),
            "transcript_shows": [m for m in ("T0003", "T0020", "T0030") if m in side],
        })
        return rows

    def command(text, label):
        t.type(text)
        time.sleep(0.4)
        step(label, "\r", wait=2.0)

    try:
        t.wait_for(lambda s: any("─" * 20 in r for r in s.rows()), "the prompt", 40)
        t.settle()
        t._write("\x1b[<35;6;6M")
        step("start")
        command("/stepprobe", "open-pane")
        step("pane-meta-j-next", NEXT)
        step("pane-meta-k-prev", PREV)
        command("/stepprobe open2", "open-pane2-in-front")
        step("tab-switch-1-probe-front", TAB, wait=2.0)
        step("idle-after-switch-1", None, wait=3.0)
        step("tab-switch-2-pane2-front", TAB, wait=2.0)
        step("idle-after-switch-2", None, wait=3.0)
        step("backtab-meta-j-next", NEXT)
        step("backtab-meta-k-prev", PREV)
        command("/stepprobe close2", "close-pane2")
        command("/stepprobe close", "close-pane")
        step("closed-meta-j-next", NEXT)
        step("closed-meta-k-prev", PREV)
    except h.ScenarioFailure as failure:
        record.append({"failure": str(failure)})
    finally:
        (out / "steps.json").write_text(json.dumps(record, ensure_ascii=False, indent=1))
        t.close()
        world.remove()
        refusals = [l for l in debug.read_text().splitlines() if "scroll" in l.lower()] if debug.exists() else []
        (out / "scroll-lines.txt").write_text("\n".join(refusals) + "\n")


if __name__ == "__main__":
    main()
