#!/bin/sh
# Build the host-specific throwaway helper used by this prototype.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cc -std=c17 -Wall -Wextra -Werror -O2 \
  "$root/src/prompt_history_sqlite_probe.c" \
  -lsqlite3 \
  -o "$root/plugin/bin/prompt-history-sqlite-probe"
chmod 755 "$root/plugin/bin/prompt-history-sqlite-probe"
