#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO=$(CDPATH= cd -- "$ROOT/../.." && pwd)
MINIMUM_CLAUDE_VERSION=2.1.290
CURRENT_CLAUDE_VERSION=2.1.290
TYPESCRIPT_VERSION=5.9.3

for path in .claude-plugin hooks bin artifacts scripts src tests tsconfig.json CONTEXT.md; do
  if [ -e "$REPO/$path" ]; then
    printf 'repository root unexpectedly owns %s\n' "$path" >&2
    exit 1
  fi
done

# The files scripts/build-artifacts.sh writes, one per line in artifact-paths.txt:
# the release gate (release/release_evidence.py) reads the same list.
artifact_state() {
  while read -r path; do
    /usr/bin/shasum -a 256 "$ROOT/$path"
  done < "$ROOT/scripts/artifact-paths.txt"
  while read -r path; do
    case $path in
      bin/*) /usr/bin/stat -f '%N|type=%HT|mode=%Lp' "$ROOT/$path" ;;
    esac
  done < "$ROOT/scripts/artifact-paths.txt"
}

before_build=$(artifact_state)
"$ROOT/scripts/build-artifacts.sh"
after_build=$(artifact_state)
if [ "$before_build" != "$after_build" ]; then
  printf '%s\n' \
    'Prompt Trail release artifacts were stale and have been rebuilt.' \
    'Review the regenerated files, then rerun verification.' >&2
  exit 1
fi

# The hosts run with a config directory of their own: a switch an earlier
# session saved in the person's config can turn `plugin test` off, and the
# tests read nothing from that config anyway.
failure=
host_config=$(mktemp -d "${TMPDIR:-/tmp}/prompt-trail-host-config.XXXXXX")
trap 'rm -rf "$host_config"; [ -z "$failure" ] || rm -f "$failure"' EXIT
failure=$(mktemp "${TMPDIR:-/tmp}/prompt-trail-probe.XXXXXX")
for claude_version in $(printf '%s\n' "$MINIMUM_CLAUDE_VERSION" "$CURRENT_CLAUDE_VERSION" | sort -u); do
  CLAUDE_CONFIG_DIR=$host_config npx -y "@anthropic-ai/claude-code@$claude_version" plugin validate "$ROOT"
  CLAUDE_CONFIG_DIR=$host_config npx -y "@anthropic-ai/claude-code@$claude_version" plugin test "$ROOT"
done
npx -y -p "typescript@$TYPESCRIPT_VERSION" tsc -p "$ROOT/tsconfig.json"
# The runner owns the module list the release gate runs too, and exits non-zero
# on any test that does not pass; its verbose log goes to stderr.
python3 "$ROOT/release/unit_runner.py" >/dev/null
"$ROOT/bin/prompt-trail-helper" probe --protocol 1

if "$ROOT/bin/prompt-trail-helper" probe --protocol 99 >/dev/null 2>"$failure"; then
  printf 'protocol mismatch probe unexpectedly succeeded\n' >&2
  exit 1
fi
if ! grep -q '"category":"protocol-mismatch"' "$failure"; then
  printf 'protocol mismatch probe returned the wrong category\n' >&2
  exit 1
fi

printf '\nPrompt Trail startup verification passed.\n'
