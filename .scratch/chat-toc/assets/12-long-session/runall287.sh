#!/bin/sh
cd <scratchpad>/p12
V=<old-scratchpad>/venv/bin/python
for rep in 1 2 3; do for fx in many heavy; do
  $V bench12.py v287 <old-scratchpad>/cc287/node_modules/.bin/claude $fx cached fast dd extend 2>&1 | grep '^{' >> results287.jsonl
done; done
for fx in many heavy; do
  $V bench12.py v287 <old-scratchpad>/cc287/node_modules/.bin/claude $fx naive naive tail full 2>&1 | grep '^{' >> results287.jsonl
  $V bench12.py v295label claude $fx cached fast dd extend 2>&1 | grep '^{' >> results287.jsonl
done
echo done >> results287.jsonl
