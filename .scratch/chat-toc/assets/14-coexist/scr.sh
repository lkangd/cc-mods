#!/bin/sh
# scr.sh : print the pane column, the prompt and recent command output lines
H=$(dirname "$0")
$H/c.sh '{"op":"screen"}' | python3 -c '
import sys
L=sys.stdin.read().split("\n")
for l in L[:6]: print("P", l[120:].rstrip())
for l in L:
  b=l[3:121].rstrip()
  if "⎿" in b or "❯" in b or "{" in b: print("L", b[:118])
'
