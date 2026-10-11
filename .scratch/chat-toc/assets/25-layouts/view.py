import sys, unicodedata
def w(c): return 2 if unicodedata.east_asian_width(c) in ("W", "F") else 1
for path in sys.argv[2:]:
    rows = open(path, encoding="utf-8").read().split("\n")[1:]
    L = None
    for r in rows:
        i = r.find("1: ")
        if i >= 0 and "全部" in r: L = sum(w(c) for c in r[:i]); break
    print("==", path.split("/")[-1], "body left", L)
    for r in rows[:int(sys.argv[1])]:
        s, col = "", 0
        for c in r:
            if col >= (L or 0) - 1: s += c
            col += w(c)
        print(s)
