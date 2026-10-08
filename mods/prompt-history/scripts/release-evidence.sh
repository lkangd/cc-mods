#!/bin/sh
# The release gate for Issue 31: every gate, the 100k benchmark, the PTY
# scenarios on the minimum and current Claude Code, and the privacy scan, in
# one report under build/evidence/. Exits non-zero unless it found zero
# failed, missing, skipped or leaked. `--only ID,...` runs a subset of the PTY
# scenarios for development; such a report is partial and never passes.
#
# Needs a token from `claude setup-token` in the keychain item
# "prompt-trail-release". Builds a private Python environment holding pinned
# pyte on first use (the network is needed once, for that).
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VENV=${PROMPT_HISTORY_RELEASE_VENV:-$HOME/.cache/prompt-history-release/venv}

# Install unless the environment holds exactly the pinned versions.
if ! "$VENV/bin/python" - "$ROOT/release/requirements.txt" 2>/dev/null <<'PY'
import importlib.metadata, sys
for line in open(sys.argv[1]):
    name, version = line.split()[0].split("==")
    if importlib.metadata.version(name) != version:
        sys.exit(1)
PY
then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --disable-pip-version-check --require-hashes \
    --only-binary=:all: -r "$ROOT/release/requirements.txt"
fi

exec "$VENV/bin/python" "$ROOT/release/release_evidence.py" "$@"
