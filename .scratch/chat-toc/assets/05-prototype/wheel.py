import subprocess,sys,time
s,n,btn,col,row,dt=sys.argv[1],int(sys.argv[2]),sys.argv[3],sys.argv[4],sys.argv[5],float(sys.argv[6])
seq=f"\033[<{btn};{col};{row}M"
t=time.time()
for i in range(n):
    subprocess.run(['cmux','send','--surface',s,seq],stdout=subprocess.DEVNULL)
    time.sleep(dt)
print('sent',n,'in',round(time.time()-t,2))
