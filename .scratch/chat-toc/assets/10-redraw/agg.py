import json, statistics as st, subprocess, collections, sys
R = collections.defaultdict(list)
for l in open('results.jsonl'):
    if not l.startswith('{'): continue
    r = json.loads(l)
    if r.get('log'):
        a = json.loads(subprocess.run([sys.executable, 'ana.py', 'logs/' + r['log']], capture_output=True, text=True).stdout)
        r['ana'] = a
    R[(r['tag'], r['mode'])].append(r)
md = lambda xs: None if not xs or None in xs else round(st.median(xs), 2)
print('ver mode n | idle5s | cpu up/down/burst | settle up/burst | hookruns | inv set pane | lat med/p95/max | top/cp(up)')
for (tag, mode), rs in sorted(R.items()):
    g = lambda f: md([f(r) for r in rs])
    print(tag, mode, len(rs), '|', g(lambda r: r['idle_cpu_s_per_5s']), '|',
          g(lambda r: r['up']['cpu_s']), g(lambda r: r['down']['cpu_s']), g(lambda r: r['burst_up']['cpu_s']), '|',
          g(lambda r: r['up']['settle_after_send_s']), g(lambda r: r['burst_up']['settle_after_send_s']), '|',
          g(lambda r: r['ana']['transcript_hook_runs']), '|',
          g(lambda r: r['ana']['cnt'].get('inv', 0)), g(lambda r: r['ana']['cnt'].get('set', 0)), g(lambda r: r['ana']['pane_renders']), '|',
          g(lambda r: r['ana']['lat_ms_median']), g(lambda r: r['ana']['lat_ms_p95']), g(lambda r: r['ana']['lat_ms_max']), '|',
          [(r['up']['top_turn'], r['up']['pane_cp'], r['burst_up']['top_turn'], r['burst_up']['pane_cp']) for r in rs],
          'errs', sum(len(r['ana']['errors']) for r in rs))
