#!/bin/sh
cmux send-key --surface $1 escape >/dev/null; sleep 0.3; cmux send --surface $1 "$2" >/dev/null; cmux send-key --surface $1 enter >/dev/null; sleep 1.5
