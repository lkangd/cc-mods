#!/bin/sh
cd <scratchpad>/p10
for rep in 1 2 3; do for m in off sync micro-state after-state poll-state loop; do
  <scratchpad>/venv/bin/python bench.py v295 $m claude 2>&1 | tail -1 >> results.jsonl
  <scratchpad>/venv/bin/python bench.py v287 $m <scratchpad>/cc287/node_modules/.bin/claude 2>&1 | tail -1 >> results.jsonl
done; done
for m in micro after-inv poll-inv; do
  <scratchpad>/venv/bin/python bench.py v287 $m <scratchpad>/cc287/node_modules/.bin/claude 2>&1 | tail -1 >> results.jsonl
done
echo done >> results.jsonl
