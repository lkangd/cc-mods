#!/bin/sh
# seq.sh : the coexistence sequence, printing the pane header after each step
H=$(dirname "$0"); cd $H
hdr() { echo "== $1"; ./c.sh '{"op":"screen"}' | python3 -c 'import sys;L=sys.stdin.read().split("\n");[print("  ",l[3:].split("│",1)[-1].rstrip()) for l in L[:2]]'; }
esc() { ./c.sh '{"op":"key","names":["esc"]}' >/dev/null; sleep 0.5; }
sleep 3; hdr start
./cmd.sh /oto 3 >/dev/null; hdr "other unasked open"
sleep 3; hdr "3s later (toc in back)"
./cmd.sh /tco 2 >/dev/null; hdr "toc asked open, no focus"
./cmd.sh /tcf 2 >/dev/null; hdr "toc asked open, focus"; esc
./cmd.sh /otf 2 >/dev/null; hdr "other asked focus"; esc
./cmd.sh /otc 2 >/dev/null; hdr "other closed by plugin"
./cmd.sh /oto 3 >/dev/null; hdr "other unasked again"
x=$(./c.sh '{"op":"find","needle":"✕"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)[0][1])')
./c.sh "{\"op\":\"click\",\"col\":$x,\"row\":0}" >/dev/null; sleep 2; hdr "other closed by person ✕"
./cmd.sh /oto 3 >/dev/null; ./cmd.sh /tcf 2 >/dev/null; esc
x=$(./c.sh '{"op":"find","needle":"✕"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)[0][1])')
./c.sh "{\"op\":\"click\",\"col\":$x,\"row\":0}" >/dev/null; sleep 2; hdr "toc closed by person ✕ (other behind)"
./cmd.sh /tcp 2 | grep 'toc-coex: '
./cmd.sh /otc 2 >/dev/null; ./cmd.sh /tco 2 >/dev/null; ./cmd.sh /diff 3 >/dev/null; hdr "diff after toc"; esc
./cmd.sh /diff 3 >/dev/null; hdr "diff toggled off"
./cmd.sh /diff 3 >/dev/null; esc; ./cmd.sh /tcx 2 >/dev/null; ./cmd.sh /clear 4 >/dev/null; hdr "after /clear (diff open, toc was closed by plugin)"
./cmd.sh /tcd 2 | grep -o 'logs/toc-[0-9]*.json'
