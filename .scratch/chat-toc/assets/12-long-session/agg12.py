"""Aggregate ticket-12 bench results: agg12.py results.jsonl"""
import json, sys, statistics as st, collections
def pct(xs, p):
    xs = sorted(x for x in xs if x is not None)
    return None if not xs else xs[min(len(xs) - 1, int(len(xs) * p))]
R = collections.defaultdict(list)
for l in open(sys.argv[1]):
    if not l.startswith('{'): continue
    r = json.loads(l)
    if not r.get('dump'): print('FAILED', r.get('tag'), r.get('fx'), r.get('pane')); continue
    d = json.load(open(r['dump'])); r['d'] = d
    R[(r['fx'], r['pane'] + '/' + r['cp'] + '/' + r['read'] + '/' + r['reb'], r['tag'])].append(r)
rows = []
for (fx, cfg, tag), rs in sorted(R.items()):
    S = lambda k: sum((x['d']['series'].get(k, []) for x in rs), [])
    ev = lambda name, why=None: [e for x in rs for e in x['d']['ev'] if e['ev'] == name and (why is None or e.get('why') == why)]
    start, force = ev('load', 'start'), ev('load', 'force')
    lat = []
    for x in rs:
        T0 = x['d']['T0']; loads = [(T0 + e['t'], e) for e in x['d']['ev'] if e['ev'] == 'load' and e['from'] > 0]
        for a in x['append_rows']:
            hit = next((t for t, e in loads if t >= a['t']), None)
            if hit: lat.append(hit - a['t'])
    out = {
        'fx': fx, 'cfg': cfg, 'ver': tag, 'n': len(rs),
        'groups': rs[0]['d']['state']['groups'], 'MiB': round(rs[0]['fixture']['bytes'] / 1048576, 1),
        'host_ready_s': [x['wall_host_ready_s'] for x in rs], 'toc_ready_s': [x['wall_toc_ready_s'] for x in rs],
        'toc_lag_s': [round(x['wall_toc_ready_s'] - x['wall_host_ready_s'], 2) for x in rs],
        'start_load_ms': [e['totalMs'] for e in start], 'start_chunks_ms': [e['procMs'] for e in start],
        'idle_full_load_ms': [e['totalMs'] for e in force], 'idle_chunk_ms_p50': pct(sum((e['procMs'] for e in force), []), .5),
        'idle_ingest_ms': [e['ingestMs'] for e in force], 'idle_rebuild_ms': [e['rebuildMs'] for e in force],
        'inc_load_ms_p50_p95': (pct(S('incLoadMs'), .5), pct(S('incLoadMs'), .95)), 'inc_read_p50_p95': (pct(S('incReadMs'), .5), pct(S('incReadMs'), .95)),
        'inc_rebuild_p50_p95': (pct(S('incRebuildMs'), .5), pct(S('incRebuildMs'), .95)),
        'append_to_model_ms_p50_p95': (pct(lat, .5), pct(lat, .95)),
        'pane_total_p50_p95': (pct(S('paneMs'), .5), pct(S('paneMs'), .95)),
        'pane_own_p95': pct([a + b for x in rs for a, b in zip(x['d']['series'].get('paneBuildMs', []), x['d']['series'].get('paneDrawMs', []))], .95),
        'pane_await_p95': pct(S('paneAwaitMs'), .95), 'pane_build_max': max(S('paneBuildMs') or [0]),
        'cp_ms_p95_max': (pct(S('cpMs'), .95), max(S('cpMs') or [0])), 'hook_ms_p95': pct(S('hookMs'), .95),
        'stat_ms_p50_p95': (pct(S('statMs'), .5), pct(S('statMs'), .95)),
        'cpstress_naive_p50_p95': (pct([e['naive']['p50'] for e in ev('cpstress')], .5), pct([e['naive']['p95'] for e in ev('cpstress')], .5)),
        'cpstress_fast_p50_p95': (pct([e['fast']['p50'] for e in ev('cpstress')], .5), pct([e['fast']['p95'] for e in ev('cpstress')], .5)),
        'panestress_all_p50': [e['all']['p50'] for e in ev('panestress')],
        'jump_ms': S('jumpMs'), 'reach_first': [x['jump0_top_visible'] for x in rs], 'reach_last': [x.get('end_jump_last_visible') for x in rs],
        'verify_same': [e['sameAsFull'] for e in ev('verify')], 'unknown': [x['d']['state']['unknown'] for x in rs],
    }
    rows.append(out)
for o in rows:
    print(json.dumps(o, ensure_ascii=False))
