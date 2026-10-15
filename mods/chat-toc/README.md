# chat-toc (developer notes)

chat-toc is a Claude Code plugin: in a fullscreen terminal it docks the current session's conversation contents to the right of the transcript, and a click on an entry jumps back to that turn.

- How to use it (requirements, install, controls, display rules, privacy, uninstall, known limits) is written only in [the root README's chat-toc section](../../README.md#chat-toc); this file does not repeat it.
- Domain terms (Transcript, Turn group, User input, Agent reply, View filter, Layout, Current position, Jump target) are in [`CONTEXT.md`](CONTEXT.md). The code and this file use these terms; text for users always uses the words on screen.
- Spec and tickets: `.scratch/chat-toc/spec.md`, `.scratch/chat-toc/issues/`.

## Layout of the folder

```text
mods/chat-toc/
├── .claude-plugin/plugin.json   name chat-toc, version, "types": "./types/index.d.ts"
├── .claude/types/claude-code.d.ts   2.1.287's host type declarations (tsc checks the minimum version with them)
├── types/index.d.ts             the $.state contract (members written inline in PluginState['chat-toc'])
├── hooks/
│   ├── hooks.json               loads ./register.tsx only
│   ├── register.tsx             every line that touches $, and every hook; the other files are pure functions
│   ├── text.ts                  every word drawn or said, English and Chinese, picked by the locale
│   ├── transcript.ts            parses JSONL rows
│   ├── chain.ts                 the current branch's conversation chain (parentUuid; across a compaction boundary, logicalParentUuid)
│   ├── groups.ts                when a group opens, the User input text, steps, last text, ending
│   ├── regroup.ts               incremental regrouping (only from the last group's opening row)
│   ├── model.ts                 whole regrouping; a test oracle only, register does not use it
│   ├── source.ts                whole read up to 4 MiB, 4,000,000 B chunks past it (sh dd+head / Windows PowerShell 5.1)
│   ├── reader.ts                the gate: 300 ms trailing, reads merged while one runs
│   ├── entries.ts               entries for the three Layouts and the View filter, day rules, time format, the Agent side's state words
│   ├── table.ts                 the entry table: entries cached per group, rebuilt only when the data, width, filter or Layout change; group-to-entry lookup
│   ├── cells.ts                 terminal cell widths and folding (no closing punctuation at a line's start, English words kept whole)
│   ├── window.ts                the Pane's own visible window
│   ├── bars.ts                  the terminal Minimap: a one-cell Button per Turn group, blocks by steps, buckets past the width, the press target, the hide rule
│   ├── ring.ts                  the host's focus ring on an entry's first line, scrolling at the window's ends
│   ├── view.ts                  the View filter / Layout $.store keys, the default for a value not known
│   ├── sites.ts                 transcript site records and the four-step requestId → row match
│   ├── jump.ts                  each side's jump candidates, refusal notes and dimming
│   ├── position.ts              Current position: on-screen row runs, binary search, the jump lock
│   ├── perf.ts                  timing samples under CHAT_TOC_PERF (numbers only), written to the host's debug log
│   ├── lifecycle.ts             the close mark, when to reopen, placement outcomes
│   ├── locate.ts                works out the transcript path when enabled mid-session (the host's project folder naming)
│   ├── rewind.ts                after a rewind, lines the host's messages up with the file to find the groups no longer held
│   ├── pane.tsx                 the terminal Pane (filter row and tab rule, entries on the time rail, footer)
│   ├── desktop.tsx              the Pane on Desktop / VS Code / mobile (another tree, split on e.surface)
│   └── minimap.ts               the SVG strip of steps per turn over the desktop list
└── tests/
    ├── *.test.ts                the claude plugin test suite
    ├── fixture.ts, host.ts      the synthetic transcript builder; the host stand-in over the test kit
    ├── acceptance/              the independent verifier, fixture generator, PTY driver and scenario scripts
    └── evidence/<version>/      release evidence (added by the release commit)
```

The host has a static check at load: `$` may only be passed to functions declared at the top of `register.tsx`, spelled `$.noun.method(...)`. Passing it to an imported function or a closure makes the module fail to load, so new code that touches `$` always goes in `register.tsx`.

## Language

The words follow the system's language (`hooks/text.ts`): Chinese when the first set of `LC_ALL`, `LC_MESSAGES` and `LANG` starts with `zh`, English otherwise. The host has no locale API, so `register.tsx` reads those variables once a load, at the first start event. A new word goes into both tables in `text.ts`; tests for the English words are in `tests/language.test.ts`. The older suites check the Chinese words: `tests/host.ts` starts its worlds with `LANG=zh_CN.UTF-8`, the pure tests call `setLanguage('zh')`, and the PTY worlds set `LC_MESSAGES=zh_CN.UTF-8`.

## Loading it locally

```sh
claude --plugin-dir /path/to/cc-mods/mods/chat-toc
```

- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is not needed. Turn on the fullscreen layout with `/tui fullscreen` (or `"tui": "fullscreen"` in settings).
- Hot reload: change (or touch) `hooks/register.tsx` under `--plugin-dir`. `/reload-plugins` does not reload an unchanged hooks module (debug log `hooks modules unchanged, kept as loaded`).
- To see what the plugin did, start with `--debug-file <path>`: the log has lines like `hooks module chat-toc@inline reloaded`, `ui.open chat-toc chat-toc (unasked|asked, N columns): …`, `ui.close …`.
- To time it, also set `CHAT_TOC_PERF=1`: the plugin writes the time spent reading, regrouping, redrawing the Pane and computing the Current position as `chat-toc-perf {...}` lines in the debug log, at most one batch a second. Numbers only (milliseconds and counts), no prompts, uuids or paths; without the variable nothing is timed or written.
- Do not enable it together with a marketplace install.

Do not install the minimum host, 2.1.287, globally; either:

```sh
npm install --prefix <temp dir>/cc287 @anthropic-ai/claude-code@2.1.287   # the binary is node_modules/.bin/claude
npx -y -p @anthropic-ai/claude-code@2.1.287 claude ...                     # what the PTY driver's Host("2.1.287") does
```

## Automated tests

The fast gate `mods/chat-toc/scripts/verify-startup.sh` (about 20 seconds) runs the checks below and the acceptance tools' unit tests, both versions through `npx`, with nothing installed globally. The repository's pre-commit hook (`.githooks/pre-commit`; enable it once per clone with `git config core.hooksPath .githooks`) runs a mod's gate when a commit touches that mod's non-Markdown files.

To run one of them, from the repository root:

```sh
claude plugin test mods/chat-toc                 # only the current version must pass
claude plugin validate mods/chat-toc             # current version
<cc287>/node_modules/.bin/claude plugin validate mods/chat-toc   # 2.1.287
(cd mods/chat-toc && npx -y -p typescript@5.6.3 tsc -p tsconfig.json)   # against 2.1.287's type declarations
```

- 2.1.287's test kit has no bottom for `session.append`, so the tests that rely on it run on the current version only.
- The test kit hands neither the plugin's `$.ui.scroll` of the transcript nor its own `$.ui.focus` to the test's hooks (it says no implementation), and cannot press the person's ✕. Jumps, where the focus lands and the person's close are tested on pure functions; their real effect is checked in PTY acceptance.
- To type-check against 2.1.295 or another newer version, write a tsconfig outside the plugin that includes the `types/claude-code.d.ts` the `plugin-authoring` skill writes and `mods/chat-toc/{types,hooks,tests}`.

The acceptance tools' own unit tests (verifier, fixture generator, driver) use the standard library only:

```sh
cd mods/chat-toc/tests/acceptance && python3 -m unittest test_toc_verifier test_transcript_fixture test_pty_harness
```

## PTY acceptance

The second layer runs in the real host, judged by `tests/acceptance/toc_verifier.py`: it works out the expected entries on its own along the transcript file's conversation chain and compares them one by one with the entries read off the Pane, sharing no code with the plugin.

**Setup**. Driving the terminal needs pyte, at the version in `tests/acceptance/requirements.txt`:

```sh
python3 -m venv <venv> && <venv>/bin/pip install --require-hashes -r mods/chat-toc/tests/acceptance/requirements.txt
PY=<venv>/bin/python
```

Every start is in a temporary HOME and `CLAUDE_CONFIG_DIR`: onboarding done, the project trusted, fullscreen, no plugin but the one given with `--plugin-dir`, not logged in. Your own `~/.claude` is never touched. Logged out, you can `--resume` a synthetic transcript, click, scroll and run local slash commands, and a submitted prompt is still written to the transcript (the host answers with its own line `Not logged in · Please run /login`), all without calling a model. When a real turn is needed, set `CHAT_TOC_PTY_TOKEN` (a token from `claude setup-token`): the driver passes it as `CLAUDE_CODE_OAUTH_TOKEN` and adds `--model haiku`. Synthetic prompts only; no real conversation content.

**Scenario scripts** (run from the repository root; `--host` takes `2.1.287` or `current`, the latter the `claude` on PATH):

| Scenario | Command |
| --- | --- |
| Smoke: the whole list matches the verifier, a click jumps | `$PY mods/chat-toc/tests/acceptance/pty_harness.py smoke --host 2.1.287 --plugin mods/chat-toc [--fixture forms] [--terminal cmux]` |
| CT-COMPAT-003 | `$PY mods/chat-toc/tests/acceptance/ct_compat.py --host 2.1.287 --host current [--scenario waiting\|narrowed\|asked\|main\|reload]` |
| CT-LIFE-001, 002, 005 (fork) | `$PY mods/chat-toc/tests/acceptance/ct_life.py --host 2.1.287 --host current [--scenario 001\|002\|fork]` |
| CT-LIFE-007 | `$PY mods/chat-toc/tests/acceptance/ct_mid_session.py --host 2.1.287 --host current [--scenario cli\|ui]` (installs from a folder marketplace set up in the run folder, disabled first, then enabled mid-session from the CLI and from the `/plugin` screen) |
| CT-LIFE-003, 004, 005, 008, CT-DATA-006 | `$PY mods/chat-toc/tests/acceptance/chain_scenarios.py --host 2.1.287 [--only life-003,...]` |
| CT-JUMP-001–003, 005, CT-UI-005 | `$PY mods/chat-toc/tests/acceptance/jump_scenarios.py 2.1.287 [001 002 002b 003 005]` (005 also records CT-UI-005: the notice line's inverse and foreground read about every 30 ms) |
| CT-POS-001–003, CT-COEX-001, CT-LIFE-006, CT-MAP-001 | `$PY mods/chat-toc/tests/acceptance/position_scenarios.py 2.1.287 [pos1 pos2 pos3 coex life6 map1]` (coex runs `git init` on a repository with changes in a temporary project, so `/diff` opens) |
| CT-PERF-001 (20 MiB many/heavy, 3 runs each) | `$PY mods/chat-toc/tests/acceptance/perf_scenarios.py run 2.1.287 many --runs 3` (then `heavy`, `current`); the release report's table: `$PY mods/chat-toc/tests/acceptance/perf_scenarios.py table <run folder>...`. The Current position and the entry table under 3000 stale on-screen records are measured in `tests/long_session.test.ts` (`claude plugin test` prints `CT-PERF` lines) |
| CT-COMPAT-001, CT-DATA-001–005, CT-TURN-001–005, CT-UI-001–003, CT-SEC-001 | `$PY mods/chat-toc/tests/acceptance/gate_scenarios.py --host 2.1.287 [--only compat-001,data-002,forms,turn-004-live,ui-003,sec-001,...]` |
| CT-COMPAT-002 (marketplace smoke) | `$PY mods/chat-toc/tests/acceptance/ct_marketplace.py --host 2.1.287 --host current --source local\|github` (`local` is this repository's folder, run before a release; `github` is `lkangd/cc-mods`, the install-level check after it) |
| Screens of the three Layouts (for the visual check) | `.scratch/chat-toc/assets/25-layouts/capture.py` (with `check_screens.py`, `probe.py`, `remember.py`, `ring_check.py`) |
| The whole release gate | `$PY mods/chat-toc/tests/acceptance/release_gate.py run --host 2.1.287 --gate <folder> --screens` (the current version also takes `--types <claude-code.d.ts>`); the two versions can run in parallel. Then `release_gate.py report --gate <folder> --out mods/chat-toc/tests/evidence/<version> --commit <commit under test> --screens` writes the evidence folder |

CT-TURN-004's in-progress state (`进行中 · N 步`) needs a turn actually running: `gate_scenarios.py`'s `turn-004-live` uses `fake_api.py` (a local stand-in for the Messages API that answers from a script; `ANTHROPIC_BASE_URL` points at it) to run two Read steps and finish, with no model call. The fixture generator `transcript_fixture.py` has four kinds, with fixed seeds: `forms` (every row shape the spec names), `turns`, `many` (20 MiB, about 4500 turns), `heavy` (20 MiB, about 108 turns with large tool results).

The PTY worlds check the Chinese words (see Language). The English words are covered by `tests/language.test.ts` only; no PTY scenario runs in English yet.

**cmux**. The scenario scripts use pyte by default (headless, sized at will, colours readable). To watch a run in cmux, `pty_harness.py smoke --terminal cmux` opens a `--focus false` split in the current workspace and closes it at the end; it only touches the split it opened. Note:

- A cmux split's width is not under control. Below 144 columns the pane does not dock by itself, so smoke uses `/chat-toc` instead (docks from 110 columns), which adds a group to the transcript.
- The wheel and click sequences cmux sends are also taken by the host as Escape: each click may raise the rewind dialog, and wheeling the Pane during a turn interrupts it. Use pyte for whole-list comparisons.
- The host draws `dimColor` as the current theme's `inactive` foreground (not SGR 2; the acceptance worlds use the dark theme, `999999`), and a hovered entry is inverse. Move the pointer off before judging dimness in pyte.

**Run records**. Each run writes to `mods/chat-toc/build/pty-runs/<time>-<label>/` (gitignored): `run.jsonl` has one line per scenario (scenario ID, Claude Code version, plugin, fixture, expected, actual, result, evidence, OS, architecture, time); `screens/` holds the screen texts. A release copies only the chosen run folders into the evidence folder.

## Evidence folder

- `tests/evidence/<plugin version>/`, one folder per version, committed. A new version reruns the full MUST gate in a new folder; old folders are not changed. There is no CHANGELOG.
- The folder holds three files:
  - `report.md`: for people; both Claude Code versions in one report, a column each, with the visual check's sign-off;
  - `report.json`: one record per scenario with the plugin version, Claude Code version, OS, architecture, fixture, scenario ID, expected, actual, result and evidence links, plus the hash of the commit under test;
  - `marketplace.md`: the local folder marketplace smoke (CT-COMPAT-002) and the GitHub install-level check after the release.
- The scenario list and MUST levels follow `.scratch/chat-toc/issues/06-grill-acceptance-contract.md` §4. Any MUST that fails, is missing, is skipped or has no traceable evidence blocks the release.
- Evidence holds synthetic prompts only. CT-SEC-001's unique marker must not appear in it.

## Release checklist

Tick in order; stop at the first step that fails:

1. [ ] `version` in `plugin.json` is the version to release; `tests/evidence/<version>/` is created.
2. [ ] On this macOS machine, run every MUST scenario once with `--plugin-dir` on 2.1.287 and on the current version of the day: no failures, nothing missing, nothing skipped; `claude plugin test`, `validate` on both versions and `tsc` on both versions are clean.
3. [ ] Run the CT-COMPAT-002 smoke from a local folder marketplace on both versions (install, the Pane opens by itself, one click on a User input side jumps), and write it into `marketplace.md`.
4. [ ] Check by eye how the three Layouts look and whether the highlight (the theme's `suggestion` colour) and the inverse selection cursor tell apart, and sign in `report.md` (does not block the release).
5. [ ] The release commit: in **one commit**, the marketplace entry (`.claude-plugin/marketplace.json`: `name`/`source`/`description`/`version`/`author`, no `category` or `tags`), the root README's table row and chat-toc section (for a new version, update that row and the passing results under Development), and `tests/evidence/<version>/`. No git tag.
6. [ ] After pushing, first confirm `gh repo view lkangd/cc-mods --json defaultBranchRef -q .defaultBranchRef.name` prints `main` (`marketplace add lkangd/cc-mods` reads the default branch; 0.1.0's first release was withdrawn because it was not `main`), then run an install-level check from `lkangd/cc-mods`: `claude plugin marketplace add lkangd/cc-mods`, `claude plugin install chat-toc@cc-mods`, the right version and enabled in `claude plugin list`, and the Pane opening by itself as a fullscreen session starts. Add the result to `marketplace.md` (this step is not a new release). A local folder marketplace runs the source folder as is; only the GitHub marketplace copies it to the cache, so this step cannot be skipped.
7. [ ] If step 6 fails, withdraw the release commit.
