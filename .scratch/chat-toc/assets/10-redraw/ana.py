import json, sys, statistics as st
for p in sys.argv[1:]:
    d = json.load(open(p)); ev = d['ev']; cnt = d['cnt']
    cps = [e for e in ev if e[1] == 'cp']; panes = [e for e in ev if e[1] == 'pane']; errs = [e for e in ev if e[1] == 'err']
    lat, miss = [], 0
    for i, e in enumerate(cps):
        nxt = cps[i + 1][0] if i + 1 < len(cps) else float('inf')
        hit = next((p for p in panes if p[0] >= e[0] and p[2] == e[2]), None)
        if hit and hit[0] < nxt + 1000: lat.append(hit[0] - e[0])
        else: miss += 1
    tr = cnt.get('t:UserMessage', 0) + cnt.get('t:AssistantMessage', 0)
    span = (ev[-1][0] - ev[0][0]) / 1000 if ev else 0
    print(json.dumps({'file': p.split('/')[-1], 'cnt': cnt, 'transcript_hook_runs': tr, 'cp_changes': len(cps), 'pane_renders': len(panes),
        'lat_ms_median': st.median(lat) if lat else None, 'lat_ms_p95': sorted(lat)[int(len(lat) * .95)] if lat else None, 'lat_ms_max': max(lat) if lat else None,
        'cp_never_shown': miss, 'errors': errs[:3]}, ensure_ascii=False))
