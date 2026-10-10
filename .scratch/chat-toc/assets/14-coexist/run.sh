#!/bin/sh
# run.sh <claude-bin> [extra env...] : start the PTY driver with both probe mods
cd /Users/liangkangda/Fe-project/cc-mods/.scratch/chat-toc/assets/14-coexist; rm -f drv.sock
BIN=$1; shift
exec env "$@" <old-scratchpad>/venv/bin/python drv.py serve <scratchpad>/proj 170 44 -- $BIN --plugin-dir /Users/liangkangda/Fe-project/cc-mods/.scratch/chat-toc/assets/14-coexist/toc-coex --plugin-dir /Users/liangkangda/Fe-project/cc-mods/.scratch/chat-toc/assets/14-coexist/other-coex --settings /Users/liangkangda/Fe-project/cc-mods/.scratch/chat-toc/assets/14-coexist/settings.json --model haiku
