"""PROBE driver for ticket 12. bench12.py <tag> <claude-bin> <fixture many|heavy> <pane naive|cached> <cp naive|fast>
Generates a fresh 20 MiB fixture, resumes it headless (pyte PTY), times TOC readiness, scrolls, jumps, stresses, appends, dumps."""
import json, os, re, socket, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
tag, bin_, fx, pane, cpm, rd, reb = sys.argv[1:8]
PY = '<old-scratchpad>/venv/bin/python'
SID = {'many': '00000000-0000-4000-8000-000000000001', 'heavy': '00000000-0000-4000-8000-000000000002'}[fx]
CWD = '<old-scratchpad>/proj'
def c(q):
    s = socket.socket(socket.AF_UNIX); s.connect('drv.sock'); s.sendall(json.dumps(q).encode())
    d = b''
    while True:
        b = s.recv(1 << 20)
        if not b: break
        d += b
    return json.loads(d)
def settle(timeout=30, quiet=0.8):
    t0 = time.time(); last, since = None, time.time()
    while time.time() - t0 < timeout:
        sc = c({'op': 'screen'})
        if sc != last: last, since = sc, time.time()
        elif time.time() - since > quiet: return round(since - t0, 2), sc
        time.sleep(0.05)
    return None, last
def cmd(text, needle, timeout=20):
    c({'op': 'type', 'text': text}); time.sleep(0.4); c({'op': 'key', 'names': ['enter']})
    t0 = time.time()
    while time.time() - t0 < timeout:
        sc = c({'op': 'screen'})
        m = re.findall(needle + r'[^\n]*', sc)
        if m: return m[-1]
        time.sleep(0.2)
    return None
g = json.loads(subprocess.run(['python3', 'gen12.py', CWD, SID, fx, '20'], capture_output=True, text=True, check=True).stdout)
last_turn = g['turns'] - 1
while f'T{last_turn:04d} 用户问题' not in open(g['path'], encoding='utf-8').read()[-200000:]: last_turn -= 1
env = dict(os.environ, TP_PANE=pane, TP_CP=cpm, TP_TRIG='poll', TP_POLL='300', TP_READ=rd, TP_REB=reb, TP_TAG=f'{tag}-{fx}-{pane}-{cpm}-{rd}-{reb}')
res = {'tag': tag, 'fx': fx, 'pane': pane, 'cp': cpm, 'read': rd, 'reb': reb, 'fixture': g}
t_spawn = time.time()
srv = subprocess.Popen([PY, 'drv.py', 'serve', CWD, '170', '44', '--', bin_, '--resume', SID, '--plugin-dir', os.path.join(HERE, 'toc-perf'),
                        '--settings', os.path.join(HERE, 'settings.json'), '--model', 'haiku'], env=env, stdout=open('serve.log', 'w'), stderr=subprocess.STDOUT)
try:
    host = toc = None
    while time.time() - t_spawn < 90:
        time.sleep(0.05)
        try: sc = c({'op': 'screen'})
        except OSError: continue
        if 'trust' in sc.lower() and 'folder' in sc.lower(): c({'op': 'key', 'names': ['down', 'enter']}); time.sleep(1); continue
        if host is None and re.search(rf'T{last_turn:04d} (回复|用户问题)', sc): host = round(time.time() - t_spawn, 2)
        m = re.search(r'TP g(\d+)', sc)
        if toc is None and m and int(m.group(1)) > 0: toc = round(time.time() - t_spawn, 2)
        if host and toc: break
    res['wall_host_ready_s'], res['wall_toc_ready_s'] = host, toc
    if not toc: res['screen'] = sc; print(json.dumps(res, ensure_ascii=False)); raise SystemExit('no toc')
    settle()
    for name, col, up, ticks, gap in (('tr_up', 40, True, 150, 0.01), ('tr_down', 40, False, 150, 0.01), ('toc_up', 150, True, 100, 0.01), ('toc_down', 150, False, 60, 0.01)):
        t0 = time.time(); c({'op': 'wheel', 'up': up, 'col': col, 'row': 15, 'ticks': ticks, 'gap': gap}); st, _ = settle()
        res[name] = {'send_s': round(time.time() - t0, 2), 'settle_s': st}
    res['jump0'] = cmd('/tperf jump 0 u', 'TPJUMP'); st, sc = settle()
    res['jump0_top_visible'] = 'T0000 用户问题' in sc
    t0 = time.time(); c({'op': 'wheel', 'up': False, 'col': 40, 'row': 15, 'ticks': 400, 'gap': 0.004}); st, _ = settle()
    res['residue_scroll'] = {'send_s': round(time.time() - t0, 2), 'settle_s': st}
    res['cpstress'] = cmd('/tperf cpstress 3000', 'TPCP'); settle()
    res['panestress'] = cmd('/tperf panestress 42', 'TPPANE'); settle()
    res['reload'] = cmd('/tperf reload', 'TPRELOAD'); settle()
    ap = subprocess.run(['python3', 'append12.py', g['path'], '3', '10', '0.15', 'append.log'])
    time.sleep(2); settle()
    res['append_rows'] = [json.loads(l) for l in open('append.log')]
    d = cmd('/tperf dump', 'TPDUMP')
    time.sleep(1); import glob
    res['dump'] = sorted(glob.glob(os.path.join(HERE, 'logs', env['TP_TAG'] + '-*.json')))[-1]
    c({'op': 'type', 'text': f'/tperf jump {last_turn} u'}); time.sleep(0.4); c({'op': 'key', 'names': ['enter']}); st, sc = settle()
    res['end_jump_last_visible'] = f'T{last_turn:04d} 用户问题' in sc
finally:
    try: c({'op': 'quit'})
    except OSError: pass
    srv.wait(timeout=10)
print(json.dumps(res, ensure_ascii=False))
