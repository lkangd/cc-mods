import subprocess,sys,unicodedata,time
s,needle=sys.argv[1],sys.argv[2]
scr=subprocess.run(['cmux','read-screen','--surface',s],capture_output=True,text=True).stdout.split('\n')
def cells(t): return sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in t)
for i,l in enumerate(scr,1):
    j=l.find(needle)
    if j>=0:
        bar=l.rfind('│',0,j)
        if bar<0: continue
        col=cells(l[:j])+3
        subprocess.run(['cmux','send','--surface',s,f"\033[<0;{col};{i}M"],stdout=subprocess.DEVNULL)
        subprocess.run(['cmux','send','--surface',s,f"\033[<0;{col};{i}m"],stdout=subprocess.DEVNULL)
        print('clicked',needle,'at',col,i); break
else: print('not found',needle)
