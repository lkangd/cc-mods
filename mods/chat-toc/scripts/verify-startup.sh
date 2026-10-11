#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MINIMUM_CLAUDE_VERSION=2.1.287
CURRENT_CLAUDE_VERSION=2.1.295
TYPESCRIPT_VERSION=5.6.3

# The hosts run with a config directory of their own: a switch an earlier
# session saved in the person's config can turn `plugin test` off.
host_config=$(mktemp -d "${TMPDIR:-/tmp}/chat-toc-host-config.XXXXXX")
trap 'rm -rf "$host_config"' EXIT
for claude_version in "$MINIMUM_CLAUDE_VERSION" "$CURRENT_CLAUDE_VERSION"; do
  CLAUDE_CONFIG_DIR=$host_config npx -y "@anthropic-ai/claude-code@$claude_version" plugin validate "$ROOT"
done
# 2.1.287's test kit has no bottom for `session.append`: tests run on the
# current host only.
CLAUDE_CONFIG_DIR=$host_config npx -y "@anthropic-ai/claude-code@$CURRENT_CLAUDE_VERSION" plugin test "$ROOT"
# Against the 2.1.287 declarations in .claude/types.
npx -y -p "typescript@$TYPESCRIPT_VERSION" tsc -p "$ROOT/tsconfig.json"
(cd "$ROOT/tests/acceptance" && python3 -m unittest -q test_toc_verifier test_transcript_fixture test_pty_harness)

printf '\nchat-toc startup verification passed.\n'
