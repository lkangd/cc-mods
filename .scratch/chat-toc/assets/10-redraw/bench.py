"""bench.py <tag> <mode> <claude-bin>: resume the synthetic session, scroll, report CPU/settle and dump probe log."""
import json, os, re, socket, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); S = os.path.dirname(HERE)
tag, mode, bin_ = sys.argv[1], sys.argv[2], sys.argv[3]; os.chdir(HERE)
SID = '10a0a0a0-0000-4000-8000-000000000300'

def c(q):
    s = socket.socket(socket.AF_UNIX); s.connect('drv.sock'); s.sendall(json.dumps(q).encode())
    d = b''
    while True:
        b = s.recv(1 << 20)
        if not b: break
        d += b
    return json.loads(d)

def cpu(root):
    out = subprocess.run(['ps', '-A', '-o', 'pid=,ppid=,time='], capture_output=True, text=True).stdout
    kids, t = {}, {}
    for l in out.split('\n'):
        p = l.split()
        if len(p) < 3: continue
        pid, ppid, tm = int(p[0]), int(p[1]), p[2]
        kids.setdefault(ppid, []).append(pid)
        parts = [float(x) for x in tm.split(':')]
        sec = 0
        for x in parts: sec = sec * 60 + x
        t[pid] = sec
    tot, st = 0, [root]
    while st:
        x = st.pop(); tot += t.get(x, 0); st += kids.get(x, [])
    return tot

def settle(timeout=20):
    t0 = time.time(); last, since = None, time.time()
    while time.time() - t0 < timeout:
        sc = c({'op': 'screen'})
        if sc != last: last, since = sc, time.time()
        elif time.time() - since > 0.8: return since - t0, sc
        time.sleep(0.05)
    return None, last

def state(sc):
    top = None; cp = None
    for i, l in enumerate(sc.split('\n')[:33]):
        left = l[3:126]
        m = re.search(r'T(\d{3}) (用户问题|回复)', left)
        if m and top is None and i > 0: top = int(m.group(1))
        m2 = re.search(r'cp=T(-?\d+)', l)
        if m2: cp = int(m2.group(1))
    return top, cp

subprocess.run(['python3', os.path.join(HERE, 'gen.py'), os.path.join(S, 'proj'), '300', SID], check=True, capture_output=True)
env = dict(os.environ, RP_MODE=mode, RP_TAG=tag)
srv = subprocess.Popen([os.path.join(S, 'venv/bin/python'), os.path.join(HERE, 'drv.py'), 'serve', os.path.join(S, 'proj'), '170', '44', '--',
                        bin_, '--resume', SID, '--plugin-dir', os.path.join(HERE, 'redraw-probe'), '--settings', os.path.join(HERE, 'settings.json'), '--model', 'haiku'],
                       env=env, stdout=open(os.path.join(HERE, 'serve.log'), 'w'), stderr=subprocess.STDOUT)
res = {'tag': tag, 'mode': mode}
try:
    for _ in range(100):
        time.sleep(0.3)
        try: sc = c({'op': 'screen'})
        except OSError: continue
        if 'cp=T' in sc: break
    else:
        raise SystemExit('no pane')
    pid = c({'op': 'pid'})
    settle()
    a = cpu(pid); time.sleep(5); res['idle_cpu_s_per_5s'] = round(cpu(pid) - a, 2)
    for name, up, ticks, gap in (('up', True, 80, 0.025), ('down', False, 80, 0.025), ('burst_up', True, 150, 0.004)):
        a = cpu(pid); t0 = time.time()
        c({'op': 'wheel', 'up': up, 'col': 40, 'row': 15, 'ticks': ticks, 'gap': gap})
        sent = time.time() - t0
        st, sc = settle()
        top, cp = state(sc)
        res[name] = {'send_s': round(sent, 2), 'settle_after_send_s': None if st is None else round(st, 2), 'cpu_s': round(cpu(pid) - a, 2), 'top_turn': top, 'pane_cp': cp}
    c({'op': 'type', 'text': '/rpd'}); time.sleep(0.5); c({'op': 'key', 'names': ['enter']}); time.sleep(1.5)
    sc = c({'op': 'screen'})
    m = re.findall(r'logs/(\S+\.json)', sc); res['log'] = m[-1] if m else None
    if not m: res['screen'] = sc
finally:
    try: c({'op': 'quit'})
    except OSError: pass
    srv.wait(timeout=10)
print(json.dumps(res, ensure_ascii=False))
