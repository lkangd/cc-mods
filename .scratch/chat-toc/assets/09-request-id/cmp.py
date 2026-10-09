import json,sys
log=[json.loads(l) for l in open(sys.argv[1])]
tp=sys.argv[2]
print('transcript',tp)
rows=[json.loads(l) for l in open(tp)]
idx={}
for i,r in enumerate(rows):
    for k in ('uuid',):
        if r.get(k): idx.setdefault(r[k],[]).append((i,'uuid'))
    m=r.get('message') or {}
    if isinstance(m,dict) and m.get('id'): idx.setdefault(m['id'],[]).append((i,'message.id'))
    if r.get('requestId'): idx.setdefault(r['requestId'],[]).append((i,'requestId'))
    if r.get('promptId'): idx.setdefault(r['promptId'],[]).append((i,'promptId'))
def desc(r):
    m=r.get('message') or {}
    c=m.get('content') if isinstance(m,dict) else None
    if isinstance(c,list): c=[(b.get('type'), (b.get('text') or b.get('name') or str(b.get('content'))[:30] or '')[:30]) for b in c]
    elif isinstance(c,str): c=c[:50]
    return f"{r.get('type')} sub={r.get('subtype')} meta={r.get('isMeta')} {c}"
for l in log:
    if l.get('ev')=='first':
        hits=idx.get(l['id'],[])
        print(f"{l['c'][:4]} {l['id'][:13]} o={l['origin']} f={l['first']} p={l['p'][:28]!r}")
        for i,k in hits: print(f"     -> row{i} via {k}: {desc(rows[i])[:110]}")
        if not hits: print("     -> NO MATCH")
