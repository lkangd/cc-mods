"""Throwaway probe for ticket 15: does the host scroll the whole Pane tree
when chat-toc's ui.scroll hook lets the person's scroll through?

Run against a throwaway patch of hooks/register.tsx (not kept): the cut
line's `e` swaps the Pane's tree for a `PROBE back` Button (hotkey e) and
200 `PROBE row N` Texts, and the `ui.scroll` hook returns `next(e)` while it
does. Prints the first and last PROBE row on screen after each input.

2026-10-16, pyte 170x44, both hosts:
  2.1.295 expanded (0,36) wheel x5 (4,41) PgDn (42,79) down (43,80) down x3 (46,83) PgUp (8,45) wheel up (0,36) up at top (0,36)
  2.1.287 expanded (0,37) wheel x5 (4,42) PgDn (43,81) down (44,82) down x3 (47,85) PgUp (8,46) wheel up (0,37) up at top (0,37)
"""
import pathlib, re, sys, time

ROOT = pathlib.Path("/Users/liangkangda/Fe-project/cc-mods/.claude/worktrees/agent-a5efcac505aa771c3")
A = ROOT / "mods/chat-toc/tests/acceptance"
sys.path.insert(0, str(A))
import pty_harness as h  # noqa
import ct_preview as cp  # noqa

version = sys.argv[1]
host = h.Host(version)
run = h.Run(label=f"probe-scroll-{version}")
world = h.World(token="")
cp.v_fixture(world, host)
t = cp.launch(world, host, run)


def probe_rows():
    rows = [int(m.group(1)) for r in t.rows() for m in [re.search(r"PROBE row (\d+)", r)] if m]
    back = any("PROBE back" in r for r in t.rows())
    return (min(rows) if rows else None, max(rows) if rows else None, back)


out = {}
try:
    t.wait_for(cp.listed, "pane", timeout=60)
    cp.focus(t)
    # walk up to V02 so the cut line shows
    for _ in range(40):
        t.key("up")
        p = cp.pane(t)
        if (cp.shown_input(p) or "").startswith("V02"):
            break
    t.type("e")
    t.wait_for(lambda term: probe_rows()[0] is not None, "probe tree", timeout=10)
    t.settle(quiet=0.8)
    out["expanded"] = probe_rows()
    t.snap("expanded")
    p = cp.pane(t)
    col = (p.left + 5) if p else 140
    t.wheel(col, 20, up=False, ticks=5)
    t.settle(quiet=0.8)
    out["wheelDown5"] = probe_rows()
    t.snap("wheel down")
    t.key("pgdn")
    t.settle(quiet=0.8)
    out["pgdn"] = probe_rows()
    t.snap("pgdn")
    t.key("down")
    t.settle(quiet=0.8)
    out["down1"] = probe_rows()
    t.key("down", "down", "down")
    t.settle(quiet=0.8)
    out["down4"] = probe_rows()
    t.snap("down")
    t.key("pgup")
    t.settle(quiet=0.8)
    out["pgup"] = probe_rows()
    t.wheel(col, 20, up=True, ticks=30)
    t.settle(quiet=0.8)
    out["wheelUpTop"] = probe_rows()
    t.snap("top")
    t.key("up")
    t.settle(quiet=0.8)
    out["upAtTop"] = probe_rows()
finally:
    t.close()
    world.remove()
print(version, out)
print("run dir", run.dir)
