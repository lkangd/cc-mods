"""ring_check.py [host ...]: where the focus ring lands after a filter or Layout
switch and after the arrows scroll the window (review fixes of tickets 24/25:
the ring move a drawing owes is sent from the drawing that shows its entry,
then once more from the next one). Exits 1 on a mismatch. No model calls."""
import sys, time, pathlib
W = str(pathlib.Path(__file__).resolve().parents[4])
sys.path.insert(0, W + "/mods/chat-toc/tests/acceptance")
import pty_harness as h


def ring(t):
    """The inverse cells of the screen, one (row, text) per row; the ring is
    the only inverse thing while the pointer is off the pane."""
    t.settle(quiet=0.6)
    out = []
    for y, row in enumerate(t.styles()):
        s = "".join(c[0] for c in row if c[3]).strip()
        if s:
            out.append((y, s))
    return out


def check(version):
    host = h.Host(version); world = h.World(token="")
    run = h.Run(label=f"ct25-ring-{host.version}")
    fx = world.fixture("turns", turns=30, version=host.version)
    t = h.launch(world, host, [W + "/mods/chat-toc"], ["--resume", fx["session"]], run=run)
    problems = []

    def step(*keys):
        for k in keys:
            if k == "focus":
                t._write("\x18"); time.sleep(0.2); t._write("\t")
            elif k in h.KEYS:
                t.key(k)
            else:
                t.type(k)
            time.sleep(0.4)

    def expect(label, test):
        got = ring(t)
        ok = len(got) == 1 and test(got[0][1])
        print(f"{host.version} {label}: {got} {'ok' if ok else 'FAIL'}")
        if not ok:
            problems.append(label)
            t.snap(label)

    try:
        t.wait_for(lambda t: "全部" in t.text(), "pane", timeout=60)
        t.settle(quiet=1.0)
        # Up from the filter row wraps to the last entry; up three times
        # lands on group 28's Agent side.
        step("focus", "up", "up", "up")
        expect("ring on g28 Agent", lambda s: s.startswith("↳ 2 步"))
        step("l")
        expect("compact keeps g28 Agent", lambda s: s.startswith("↳ 2 步 ·"))
        step("l")
        expect("timeline keeps g28 Agent", lambda s: s.startswith("↳ 2 步"))
        step("l")
        expect("card keeps g28 Agent", lambda s: s == "↳ 2 步")
        step("2")
        expect("user filter moves to g28 User input", lambda s: s.startswith("你 ·"))
        step("1")
        expect("all keeps g28 User input", lambda s: s.startswith("你 ·"))
        # Up past the window's top: the window scrolls and the ring follows.
        for i in range(20):
            step("up")
        first = ring(t)
        step("up")
        second = ring(t)
        ok = len(first) == 1 and len(second) == 1 and first[0][1] != second[0][1] and second[0][0] <= 3
        print(f"{host.version} reveal at the top: {first} -> {second} {'ok' if ok else 'FAIL'}")
        if not ok:
            problems.append("reveal at the top")
        for i in range(22):
            step("down")
        third = ring(t)
        ok = len(third) == 1 and not third[0][1].startswith(("1:", "2:", "3:", "l:"))
        print(f"{host.version} reveal at the bottom: {third} {'ok' if ok else 'FAIL'}")
        if not ok:
            problems.append("reveal at the bottom")
        run.record("CT-UI-003-ring", host=host.version, plugin="mods/chat-toc", fixture="turns 30",
                   expected="the ring stays on the selected entry across switches and window scrolls",
                   actual="; ".join(problems) or "as expected", result="fail" if problems else "pass", evidence=[])
    finally:
        t.close(); world.remove()
    print("RUN", run.dir)
    return problems


bad = []
for v in sys.argv[1:] or ["current", "2.1.287"]:
    bad += check(v)
sys.exit(1 if bad else 0)
