import subprocess,sys,re
s=sys.argv[1]
L=subprocess.run(['cmux','read-screen','--surface',s],capture_output=True,text=True).stdout.split('\n')
left=[l.split('│')[0].rstrip() for l in L[:6]]
foot=[m for l in L for m in re.findall(r'cp\d+[^│]*',l)]
print(' | '.join(x[:46] for x in left[:4]), '|| footer', foot[-1][:14] if foot else None)
