import sys,unicodedata
def w(c): return 2 if unicodedata.east_asian_width(c) in 'WF' else 1
lines=open(sys.argv[1]).read().split('\n')
col=int(sys.argv[2]) if len(sys.argv)>2 else 147
for i,l in enumerate(lines,1):
    x=0;out=''
    for ch in l:
        if x>=col: out+=ch
        x+=w(ch)
    print(f"{i:2d}|{out}")
