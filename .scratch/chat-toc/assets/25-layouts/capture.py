"""Three Layouts at 36/44/56 columns on both hosts; screens under build/pty-runs/ct25-layouts-<host>-<width>."""
import os, shutil, subprocess, sys, pathlib
HERE = pathlib.Path(__file__).parent
P = pathlib.Path(__file__).resolve().parents[4] / "mods/chat-toc/build/pty-runs"
RESIZE = {36: ["focus", "inv", "R", "inv", "R", "inv"], 44: ["focus", "inv"], 56: ["focus", "inv", "L", "inv", "L", "inv", "L", "inv"]}
hosts = sys.argv[1:] or ["current", "2.1.287"]
for v in hosts:
    for w in (36, 44, 56):
        out = P / f"ct25-layouts-{v}-{w}"
        shutil.rmtree(out, ignore_errors=True)
        steps = RESIZE[w] + [f"snap:w{w}-card", "l", f"snap:w{w}-compact", "l", f"snap:w{w}-timeline", "l",
                             "2", f"snap:w{w}-card-user", "3", f"snap:w{w}-card-agent", "1"]
        r = subprocess.run([sys.executable, str(HERE / "probe.py"), v, "30", *steps], env={**os.environ, "RUNDIR": str(out)},
                           capture_output=True, text=True, timeout=300)
        print(v, w, (r.stdout + r.stderr).strip().splitlines()[-1:])
