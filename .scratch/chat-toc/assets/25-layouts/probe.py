"""probe.py <version> <fixture-turns> <steps...>
steps: down/up/tab/enter/esc/l/1/2/3 keys; focus (ctrl+x tab); 'c<col>x<row>' click; 'R'/'L' ctrl+x right/left;
'snap:<label>' snapshot; 'pane' print pane rows; 'inv' print inverse cells"""
import sys, time, pathlib, os
W = str(pathlib.Path(__file__).resolve().parents[4])
sys.path.insert(0, W + "/mods/chat-toc/tests/acceptance")
import pty_harness as h
VER, TURNS, STEPS = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
host = h.Host(VER); world = h.World()
run = h.Run(out=pathlib.Path(os.environ["RUNDIR"]) if os.environ.get("RUNDIR") else None, label=f"p25-{host.version}")
fx = world.fixture("turns", turns=TURNS, version=host.version)
t = h.launch(world, host, [W + "/mods/chat-toc"], ["--resume", fx["session"]], run=run, columns=int(os.environ.get("COLS", "170")), lines=int(os.environ.get("LINES_", "44")))
def left():
    for r in t.rows():
        i = r.find("全部")
        if i >= 0:
            return max(0, sum(h.cell_width(c) for c in r[:i]) - 6)
    return 110
def pane_rows():
    L = left(); out = []
    for r in t.rows():
        s, col = "", 0
        for c in r:
            if col >= L: s += c
            col += h.cell_width(c)
        out.append(s)
    return out
def inv():
    res = []
    for y, row in enumerate(t.styles()):
        s = "".join(c[0] for c in row if c[3]).strip()
        if s: res.append((y, s))
    return res
try:
    t.wait_for(lambda t: "全部" in t.text() or "你 ·" in t.text(), "pane", timeout=60)
    t.settle(quiet=1.0)
    for s in STEPS:
        if s == "focus": t._write("\x18"); time.sleep(0.2); t._write("\t")
        elif s in ("R", "L"): t._write("\x18"); time.sleep(0.2); t._write("\x1b[C" if s == "R" else "\x1b[D")
        elif s.startswith("c") and "x" in s: c, r = s[1:].split("x"); t.click(int(c), int(r))
        elif s.startswith("snap:"): t.settle(quiet=0.6); print("SNAP", t.snap(s[5:])); continue
        elif s == "pane": t.settle(quiet=0.6); print("\n".join(f"{i:2d}|{r}" for i, r in enumerate(pane_rows()))); continue
        elif s == "inv": t.settle(quiet=0.6); print("INV", inv()); continue
        elif s in h.KEYS: t.key(s)
        else: t.type(s)
        time.sleep(0.35)
    print("RUN", run.dir)
finally:
    t.close(); world.remove()
