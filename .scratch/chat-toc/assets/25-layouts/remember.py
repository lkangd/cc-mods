"""remember.py <host>: CT-UI-001/002 across processes. Choose Agent and compact, quit, start again in the
same isolated config, and read the filter row; then corrupt the stored values and start once more."""
import sys, time, pathlib, json
W = str(pathlib.Path(__file__).resolve().parents[4])
sys.path.insert(0, W + "/mods/chat-toc/tests/acceptance")
import pty_harness as h
host = h.Host(sys.argv[1]); world = h.World()
run = h.Run(out=pathlib.Path(W) / f"mods/chat-toc/build/pty-runs/ct25-remember-{sys.argv[1]}", label="remember")
fx = world.fixture("turns", turns=8, version=host.version)
def session(label, keys):
    t = h.launch(world, host, [W + "/mods/chat-toc"], ["--resume", fx["session"]], run=run)
    try:
        t.wait_for(lambda t: "全部" in t.text(), "filter row", timeout=60)
        t.settle(quiet=1.0)
        if keys:
            t._write("\x18"); time.sleep(0.2); t._write("\t"); t.settle(quiet=0.6)
            for k in keys: t.type(k); t.settle(quiet=0.6)
        row = next(r for r in t.rows() if "全部" in r)
        t.snap(label)
        return row[row.find("1: "):]
    finally:
        t.close()
try:
    print("first ", session("first-choose-agent-compact", ["3", "l"]))
    print("second", session("second-remembered", []))
    stores = list(world.config.rglob("*chat-toc*"))
    print("store files", [str(p.relative_to(world.config)) for p in stores])
    for p in stores:
        if p.is_file():
            print("store text", p.read_text()[:200])
            p.write_text(json.dumps({"viewFilter": "nonsense", "layout": ["compact"]}))
    print("third ", session("third-unknown-values", []))
    print("RUN", run.dir)
finally:
    world.remove()
