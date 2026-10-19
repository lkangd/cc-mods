# chat-toc 0.2.0 release evidence

**Verdict: pass** (46 MUST scenarios under `--plugin-dir` × 2 Claude Code versions; 0 failed, 0 missing, 0 skipped; 0 CT-SEC-001 marker leaks in the evidence)

## What was tested, and where

- commit: `3ac792b`
  - The gate ran on 2026-10-17 with `plugin.json` at 0.1.3; the release raises it to 0.2.0 in `1cd431d`. Between `3ac792b` and `1cd431d` the plugin code changed only in comments (`git diff 3ac792b 1cd431d -- mods/chat-toc/hooks`), so the runs were not repeated.
  - CT-COMPAT-002 alone was run again on 2026-10-19 at `1cd431d`, so the local folder marketplace installs 0.2.0; the 0.1.3 run it replaces is not in this folder.
- pluginVersion: `0.2.0`
- claudeCodeVersions: `2.1.287, 2.1.295`
- minimumClaudeCode: `2.1.287`
- os: `macOS 15.8`
- arch: `arm64`
- cpu: `Apple M1 Pro`
- surface: `interactive terminal, fullscreen layout (pseudo-terminal read through pyte 0.8.2, 170x44 unless a scenario says otherwise)`
- loading: `--plugin-dir for every scenario; CT-COMPAT-002 and CT-LIFE-007 through local directory marketplaces`
- functionHooks: `not set (chat-toc does not need CLAUDE_CODE_ENABLE_FUNCTION_HOOKS)`
- account: `logged out; no model call (CT-TURN-004's live turn runs against fake_api.py, a local scripted stand-in)`
- python: `3.15.0`

Synthetic prompts only: every transcript was made by `tests/acceptance/transcript_fixture.py` or freshly submitted in an isolated world. Local paths are replaced by `<repo>`, `<home>`, `<tmp>`, `<npx>`.

## Automated gates

| Gate | Result | Detail | Log |
| --- | --- | --- | --- |
| plugin-validate@2.1.287 | pass |  | [log](logs/plugin-validate@2.1.287.log) |
| tsc@2.1.287 | pass |  | [log](logs/tsc@2.1.287.log) |
| plugin-validate@2.1.295 | pass |  | [log](logs/plugin-validate@2.1.295.log) |
| plugin-test@2.1.295 | pass | 475 pass, 0 fail; CT-PERF position groups=4432 chain=26590 live=12 p50/p95/max=0.005/0.009/0.897 ms; CT-PERF position-residue records=3012 p50/p95/max=0.335/0.39/65.839 ms; CT-PERF entry-table entries=8864 first=125.847 ms; redraw p95=0.001 ms; last group grown p50/p95/max=0.05/0.058/0.061 ms; CT-PERF search groups=4432 index=7.727 ms; keystroke "c" 4432 p50/p95/max=0.239/0.395/0.395 (matcher p95 0.244, narrowing p95 0.033); "ct-syn" 4432 p50/p95/max=0.254/0.274/0.274 (matcher p95 0.232, narrowing p95 0.026); "模块 正常" 4432 p50/p95/max=0.36/0.383/0.383 (matcher p95 1.177, narrowing p95 0.04); "T1" 1111 p50/p95/max=0.736/0.839/0.839 (matcher p95 0.185, narrowing p95 0.304); "T4431" 1 p50/p95/max=0.207/0.213/0.213 (matcher p95 2.936, narrowing p95 0.028); "zzz" 0 p50/p95/max=0.22/0.235/0.235 (matcher p95 0.164, narrowing p95 0.055) ms | [log](logs/plugin-test@2.1.295.log) |
| tsc@2.1.295 | pass |  | [log](logs/tsc@2.1.295.log) |
| acceptance-unit@2.1.295 | pass | 56 tests | [log](logs/acceptance-unit@2.1.295.log) |
| privacy-scan | pass | 15 CT-SEC-001 marker(s), 0 leak(s) in the evidence |  |

## MUST scenarios (the compatibility and acceptance contract §4 and its later revisions)

Each cell is that scenario ID's records on that version and their result (one ID can have several records, such as CT-COMPAT-003's five cases).

| Scenario | 2.1.287 | 2.1.295 |
|---|---|---|
| CT-COMPAT-001 | pass (1/1) | pass (1/1) |
| CT-COMPAT-002 | pass (1/1) | pass (1/1) |
| CT-COMPAT-003 | pass (5/5) | pass (5/5) |
| CT-DATA-001 | pass (1/1) | pass (1/1) |
| CT-DATA-002 | pass (1/1) | pass (1/1) |
| CT-DATA-003 | pass (1/1) | pass (1/1) |
| CT-DATA-004 | pass (1/1) | pass (1/1) |
| CT-DATA-005 | pass (1/1) | pass (1/1) |
| CT-DATA-006 | pass (1/1) | pass (1/1) |
| CT-TURN-001 | pass (1/1) | pass (1/1) |
| CT-TURN-002 | pass (1/1) | pass (1/1) |
| CT-TURN-003 | pass (1/1) | pass (1/1) |
| CT-TURN-004 | pass (2/2) | pass (2/2) |
| CT-TURN-005 | pass (1/1) | pass (1/1) |
| CT-LIFE-001 | pass (1/1) | pass (1/1) |
| CT-LIFE-002 | pass (1/1) | pass (1/1) |
| CT-LIFE-003 | pass (2/2) | pass (2/2) |
| CT-LIFE-004 | pass (1/1) | pass (1/1) |
| CT-LIFE-005 | pass (4/4) | pass (4/4) |
| CT-LIFE-006 | pass (1/1) | pass (1/1) |
| CT-LIFE-007 | pass (2/2) | pass (2/2) |
| CT-LIFE-008 | pass (1/1) | pass (1/1) |
| CT-UI-001 | pass (1/1) | pass (1/1) |
| CT-UI-002 | pass (1/1) | pass (1/1) |
| CT-UI-003 | pass (1/1) | pass (1/1) |
| CT-UI-004 | pass (6/6) | pass (6/6) |
| CT-UI-005 | pass (1/1) | pass (1/1) |
| CT-JUMP-001 | pass (1/1) | pass (1/1) |
| CT-JUMP-002 | pass (2/2) | pass (2/2) |
| CT-JUMP-003 | pass (1/1) | pass (1/1) |
| CT-JUMP-005 | pass (1/1) | pass (1/1) |
| CT-POS-001 | pass (1/1) | pass (1/1) |
| CT-POS-002 | pass (1/1) | pass (1/1) |
| CT-POS-003 | pass (1/1) | pass (1/1) |
| CT-PERF-001 | pass (6/6) | pass (6/6) |
| CT-SEC-001 | pass (1/1) | pass (1/1) |
| CT-COEX-001 | pass (1/1) | pass (1/1) |
| CT-CMPCT-001 | pass (2/2) | pass (2/2) |
| CT-CTX-001 | pass (1/1) | pass (1/1) |
| CT-PREV-001 | pass (6/6) | pass (6/6) |
| CT-PREV-002 | pass (3/3) | pass (3/3) |
| CT-FIND-001 | pass (4/4) | pass (4/4) |
| CT-FIND-002 | pass (4/4) | pass (4/4) |
| CT-STEP-001 | pass (2/2) | pass (2/2) |
| CT-REUSE-001 | pass (7/7) | pass (7/7) |
| CT-PERF-002 | pass (6/6) | pass (6/6) |

## CT-PERF-001 and CT-PERF-002 (20 MiB, two fixtures × two versions × 3 runs, the worst p95 of the runs)

CT-PERF-001

| Item | Limit | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| First listing: the TOC after the host shows the last turn | ≤ 4 s | 0.84 s | 0.61 s | 0.85 s | 0.62 s |
| Whole read and regroup at start (contends with the host's resume; for reference) | — | 387 ms | 229 ms | 393 ms | 229 ms |
| Whole read and regroup when idle (after a hot reload) | ≤ 1 s | 407 ms | 238 ms | 397 ms | 217 ms |
| Incremental read, each | ≤ 150 ms | 123.32 ms | 96.36 ms | 111.57 ms | 92.94 ms |
| An appended row to the TOC model update | ≤ 1 s | 499.03 ms | 337.62 ms | 504.2 ms | 365.88 ms |
| Pane redraw, the plugin's own work | ≤ 16 ms | 2.09 ms | 0.99 ms | 2.09 ms | 1.12 ms |
| Pane redraw, waiting on the host included | ≤ 100 ms | 6.21 ms | 9.64 ms | 6.51 ms | 10.62 ms |
| Current position, each computation | ≤ 2 ms | 0.03 ms | 0.02 ms | 0.03 ms | 0.02 ms |
| Long session: continuous scrolling, jumps to the first and last groups | must reach, no paging | yes | yes | yes | yes |
| On-screen records actually left (most) | — | 32 | 11 | 26 | 11 |
| Load average (1 min) at the runs' starts, least–most | — | 2.95–10.65 | 3.89–4.54 | 3.71–6.36 | 3.31–3.92 |
| Runs (all passed) | 3 | 3 (3) | 3 (3) | 3 (3) | 3 (3) |

CT-PERF-002

| Item | Limit | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| A keystroke in the search field to the Pane redrawn, the plugin's own work | ≤ 50 ms | 10.14 ms | 1.59 ms | 9.87 ms | 1.85 ms |
| The same, waiting on the host included | ≤ 100 ms | 22.65 ms | 15.32 ms | 23.55 ms | 22.65 ms |
| Whole read and regroup when idle, the search index included | ≤ 1 s | 407 ms | 238 ms | 397 ms | 217 ms |
| Of which the search index (for reference) | — | 12 ms | 0.32 ms | 15 ms | 0.31 ms |
| Incremental read, each, the index's rebuild included | ≤ 150 ms | 123.32 ms | 96.36 ms | 111.57 ms | 92.94 ms |
| Pane redraw with the preview open, the plugin's own work | ≤ 16 ms | 2.09 ms | 0.99 ms | 2.09 ms | 1.12 ms |
| Keystrokes timed (all runs) | — | 102 | 102 | 102 | 102 |
| Load average (1 min) at the runs' starts, least–most | — | 2.95–10.65 | 3.89–4.54 | 3.71–6.36 | 3.31–3.92 |
| Runs (all passed) | 3 | 3 (3) | 3 (3) | 3 (3) | 3 (3) |

## Visual check (awaiting the user's sign-off)

> Not a release blocker (contract §3, §5). The implementer does not sign it: the user looks at the screens below (and once in their own terminal), confirms how the three Layouts (Card, Compact, Timeline) look and that the highlight (the theme's `suggestion` colour) and the inverse selection cursor tell apart at a glance, then fills in this section.

- No screens were taken again by this release gate (no `signoff/` folder). The user looked at the Pane in the terminal and the Claude app with tickets 19, 22–24 (`.scratch/chat-toc-0.2/issues/`).
- Ticket 25's screens: `.scratch/chat-toc/assets/25-layouts/screens/` (2.1.287 and 2.1.295, 36/44/56 columns)
- Colour and inverse do not show in text screens; CT-UI-003 checks the colours (the highlight `▌` is the dark theme's `suggestion`, not inverse; the selection cursor is inverse, never on the same line) and CT-UI-004 (under four themes the highlight and the dim are each that theme's resolved values); how it looks still needs a person.

| Item | Verdict | Signed | Date |
| --- | --- | --- | --- |
| How the three Layouts look | to fill | awaiting the user | |
| Highlight and selection cursor tell apart | to fill | awaiting the user | |

## Records by scenario

### CT-COMPAT-001 · 2.1.287 · pass

- fixture: turns 40
- expected: cold start, fullscreen, --plugin-dir: the Pane docks on the right by itself (host: unasked, placed); its whole list equals the verifier's; plugin validate passes with 0 errors
- actual: `{"paneLeftColumn": 126, "dockedRight": true, "hostOpens": ["ui.open chat-toc chat-toc (unasked, 170 columns): placed"], "openedUnasked": true, "wholeList": {"ok": true, "covered": 40, "missing": [], "windows": 17}, "validate": {"exit": 0, "passed": true, "errors": 0}}`
- evidence: [debug-compat-001.log](pty/2.1.287/gate/debug-compat-001.log), [001-compat-001-docked-by-itself.txt](pty/2.1.287/gate/screens/001-compat-001-docked-by-itself.txt), [whole-01.json](pty/2.1.287/gate/whole-01.json), [validate-2.1.287.log](pty/2.1.287/gate/validate-2.1.287.log)

### CT-COMPAT-001 · 2.1.295 · pass

- fixture: turns 40
- expected: cold start, fullscreen, --plugin-dir: the Pane docks on the right by itself (host: unasked, placed); its whole list equals the verifier's; plugin validate passes with 0 errors
- actual: `{"paneLeftColumn": 126, "dockedRight": true, "hostOpens": ["ui.open chat-toc chat-toc (unasked, 170 columns): placed"], "openedUnasked": true, "wholeList": {"ok": true, "covered": 40, "missing": [], "windows": 18}, "validate": {"exit": 0, "passed": true, "errors": 0}}`
- evidence: [debug-compat-001.log](pty/2.1.295/gate/debug-compat-001.log), [001-compat-001-docked-by-itself.txt](pty/2.1.295/gate/screens/001-compat-001-docked-by-itself.txt), [whole-01.json](pty/2.1.295/gate/whole-01.json), [validate-2.1.295.log](pty/2.1.295/gate/validate-2.1.295.log)

### CT-COMPAT-002 · 2.1.287 · pass

- fixture: turns 12
- expected: marketplace add + install succeed; plugin list shows chat-toc@cc-mods 0.2.0 enabled; the Pane (loaded as chat-toc@cc-mods, no --plugin-dir) docks by itself; a click on T0000's user side puts that prompt at the top
- actual: `{"source": "<repo>", "exits": [0, 0, 0], "listed": {"version": "0.2.0", "status": "enabled"}, "installedManifests": ["plugins/cache/cc-mods/chat-toc/0.2.0/.claude-plugin/plugin.json"], "loadedAs": ["chat-toc@cc-mods"], "openedUnasked": true, "clickJumped": true}`
- evidence: [commands-local-2.1.287.txt](pty/2.1.287/ct-marketplace/commands-local-2.1.287.txt), [001-local-2-1-287-docked-by-itself.txt](pty/2.1.287/ct-marketplace/screens/001-local-2-1-287-docked-by-itself.txt), [002-local-2-1-287-after-clicking-T0000.txt](pty/2.1.287/ct-marketplace/screens/002-local-2-1-287-after-clicking-T0000.txt), [debug-local-2.1.287-chat-toc-lines.log](pty/2.1.287/ct-marketplace/debug-local-2.1.287-chat-toc-lines.log)

### CT-COMPAT-002 · 2.1.295 · pass

- fixture: turns 12
- expected: marketplace add + install succeed; plugin list shows chat-toc@cc-mods 0.2.0 enabled; the Pane (loaded as chat-toc@cc-mods, no --plugin-dir) docks by itself; a click on T0000's user side puts that prompt at the top
- actual: `{"source": "<repo>", "exits": [0, 0, 0], "listed": {"version": "0.2.0", "status": "enabled"}, "installedManifests": ["plugins/cache/cc-mods/chat-toc/0.2.0/.claude-plugin/plugin.json"], "loadedAs": ["chat-toc@cc-mods"], "openedUnasked": true, "clickJumped": true}`
- evidence: [commands-local-2.1.295.txt](pty/2.1.295/ct-marketplace/commands-local-2.1.295.txt), [003-local-2-1-295-docked-by-itself.txt](pty/2.1.295/ct-marketplace/screens/003-local-2-1-295-docked-by-itself.txt), [004-local-2-1-295-after-clicking-T0000.txt](pty/2.1.295/ct-marketplace/screens/004-local-2-1-295-after-clicking-T0000.txt), [debug-local-2.1.295-chat-toc-lines.log](pty/2.1.295/ct-marketplace/debug-local-2.1.295-chat-toc-lines.log)

### CT-COMPAT-003 asked · 2.1.287 · pass

- fixture: turns 6
- expected: at 100 columns the band stands for the waiting Pane; /chat-toc places it inline listing entries; at 170 the host docks it; back at 100 the host turns it inline and chat-toc keeps it; no status line
- actual: `{"bandNoPaneAt100": true, "inlineListsEntries": true, "docksWhenWide": true, "backAt100": {"placement": "inline", "hostLines": []}, "notClosedByPlugin": true, "keptInlineAt100": true, "noStatusLine": true}`
- evidence: [debug-asked.log](pty/2.1.287/ct-compat/debug-asked.log), [008-asked-100-before--chat-toc.txt](pty/2.1.287/ct-compat/screens/008-asked-100-before--chat-toc.txt), [009-asked-100-inline.txt](pty/2.1.287/ct-compat/screens/009-asked-100-inline.txt), [010-asked-170-docked.txt](pty/2.1.287/ct-compat/screens/010-asked-170-docked.txt), [011-asked-back-to-100.txt](pty/2.1.287/ct-compat/screens/011-asked-back-to-100.txt)

### CT-COMPAT-003 main · 2.1.287 · pass

- fixture: turns 6
- expected: on the main screen at 170 columns the Pane opens by itself inline, listing entries, and chat-toc keeps it; no status line
- actual: `{"atStart": {"placement": "inline", "hostLines": ["ui.open chat-toc chat-toc (unasked, 170 columns): placed"]}, "notClosedByPlugin": true, "inlineListsEntries": true, "noStatusLine": true}`
- evidence: [debug-main.log](pty/2.1.287/ct-compat/debug-main.log), [012-main-170.txt](pty/2.1.287/ct-compat/screens/012-main-170.txt)

### CT-COMPAT-003 narrowed · 2.1.287 · pass

- fixture: turns 6
- expected: docked at 170 stays docked at 130; at 100 the host turns it inline and chat-toc keeps it, listing entries (no close of origin plugin); back at 170 it is docked and the band gone; no status line
- actual: `{"stillDockedAt130": true, "at100": {"placement": "inline", "hostLines": []}, "notClosedByPluginAt100": true, "keptInlineAt100": true, "dockedAgain": true, "notClosedByPluginAt170": true, "noStatusLine": true}`
- evidence: [debug-narrowed.log](pty/2.1.287/ct-compat/debug-narrowed.log), [004-narrowed-170.txt](pty/2.1.287/ct-compat/screens/004-narrowed-170.txt), [005-narrowed-130.txt](pty/2.1.287/ct-compat/screens/005-narrowed-130.txt), [006-narrowed-100.txt](pty/2.1.287/ct-compat/screens/006-narrowed-100.txt), [007-narrowed-back-to-170.txt](pty/2.1.287/ct-compat/screens/007-narrowed-back-to-170.txt)

### CT-COMPAT-003 reload · 2.1.287 · pass

- fixture: turns 6
- expected: waiting at 120 columns, a hot reload opens no second Pane and the band is still drawn
- actual: `{"afterReload": [], "noSecondPane": true, "bandKept": true, "noStatusLine": true}`
- evidence: [debug-reload.log](pty/2.1.287/ct-compat/debug-reload.log), [013-reload-120-after.txt](pty/2.1.287/ct-compat/screens/013-reload-120-after.txt)

### CT-COMPAT-003 waiting · 2.1.287 · pass

- fixture: turns 6
- expected: unasked at 120 columns the Pane waits undrawn and the band stands for it; at the host's floor N-1 it still waits, at N it docks and the band goes; no status line
- actual: `{"bandNoPaneAt120": true, "hostFloor": 144, "hostLine": ["ui.open chat-toc chat-toc (unasked, 120 columns): waits unplaced (unasked below 144 columns (120 now): placed when the person opens it, or when the terminal is widened to 144 columns)"], "waitsBelowFloor": true, "docksAtFloor": true, "bandGoneOnDock": true, "noStatusLine": true}`
- evidence: [debug-waiting.log](pty/2.1.287/ct-compat/debug-waiting.log), [001-waiting-120.txt](pty/2.1.287/ct-compat/screens/001-waiting-120.txt), [002-waiting-143.txt](pty/2.1.287/ct-compat/screens/002-waiting-143.txt), [003-waiting-144-docked.txt](pty/2.1.287/ct-compat/screens/003-waiting-144-docked.txt)

### CT-COMPAT-003 asked · 2.1.295 · pass

- fixture: turns 6
- expected: at 100 columns the band stands for the waiting Pane; /chat-toc places it inline listing entries; at 170 the host docks it; back at 100 the host turns it inline and chat-toc keeps it; no status line
- actual: `{"bandNoPaneAt100": true, "inlineListsEntries": true, "docksWhenWide": true, "backAt100": {"placement": "inline", "hostLines": []}, "notClosedByPlugin": true, "keptInlineAt100": true, "noStatusLine": true}`
- evidence: [debug-asked.log](pty/2.1.295/ct-compat/debug-asked.log), [008-asked-100-before--chat-toc.txt](pty/2.1.295/ct-compat/screens/008-asked-100-before--chat-toc.txt), [009-asked-100-inline.txt](pty/2.1.295/ct-compat/screens/009-asked-100-inline.txt), [010-asked-170-docked.txt](pty/2.1.295/ct-compat/screens/010-asked-170-docked.txt), [011-asked-back-to-100.txt](pty/2.1.295/ct-compat/screens/011-asked-back-to-100.txt)

### CT-COMPAT-003 main · 2.1.295 · pass

- fixture: turns 6
- expected: on the main screen at 170 columns the Pane opens by itself inline, listing entries, and chat-toc keeps it; no status line
- actual: `{"atStart": {"placement": "inline", "hostLines": ["ui.open chat-toc chat-toc (unasked, 170 columns): placed"]}, "notClosedByPlugin": true, "inlineListsEntries": true, "noStatusLine": true}`
- evidence: [debug-main.log](pty/2.1.295/ct-compat/debug-main.log), [012-main-170.txt](pty/2.1.295/ct-compat/screens/012-main-170.txt)

### CT-COMPAT-003 narrowed · 2.1.295 · pass

- fixture: turns 6
- expected: docked at 170 stays docked at 130; at 100 the host turns it inline and chat-toc keeps it, listing entries (no close of origin plugin); back at 170 it is docked and the band gone; no status line
- actual: `{"stillDockedAt130": true, "at100": {"placement": "inline", "hostLines": []}, "notClosedByPluginAt100": true, "keptInlineAt100": true, "dockedAgain": true, "notClosedByPluginAt170": true, "noStatusLine": true}`
- evidence: [debug-narrowed.log](pty/2.1.295/ct-compat/debug-narrowed.log), [004-narrowed-170.txt](pty/2.1.295/ct-compat/screens/004-narrowed-170.txt), [005-narrowed-130.txt](pty/2.1.295/ct-compat/screens/005-narrowed-130.txt), [006-narrowed-100.txt](pty/2.1.295/ct-compat/screens/006-narrowed-100.txt), [007-narrowed-back-to-170.txt](pty/2.1.295/ct-compat/screens/007-narrowed-back-to-170.txt)

### CT-COMPAT-003 reload · 2.1.295 · pass

- fixture: turns 6
- expected: waiting at 120 columns, a hot reload opens no second Pane and the band is still drawn
- actual: `{"afterReload": [], "noSecondPane": true, "bandKept": true, "noStatusLine": true}`
- evidence: [debug-reload.log](pty/2.1.295/ct-compat/debug-reload.log), [013-reload-120-after.txt](pty/2.1.295/ct-compat/screens/013-reload-120-after.txt)

### CT-COMPAT-003 waiting · 2.1.295 · pass

- fixture: turns 6
- expected: unasked at 120 columns the Pane waits undrawn and the band stands for it; at the host's floor N-1 it still waits, at N it docks and the band goes; no status line
- actual: `{"bandNoPaneAt120": true, "hostFloor": 144, "hostLine": ["ui.open chat-toc chat-toc (unasked, 120 columns): waits unplaced (unasked below 144 columns (120 now): placed when the person opens it, or when the terminal is widened to 144 columns)"], "waitsBelowFloor": true, "docksAtFloor": true, "bandGoneOnDock": true, "noStatusLine": true}`
- evidence: [debug-waiting.log](pty/2.1.295/ct-compat/debug-waiting.log), [001-waiting-120.txt](pty/2.1.295/ct-compat/screens/001-waiting-120.txt), [002-waiting-143.txt](pty/2.1.295/ct-compat/screens/002-waiting-143.txt), [003-waiting-144-docked.txt](pty/2.1.295/ct-compat/screens/003-waiting-144-docked.txt)

### CT-DATA-001 · 2.1.287 · pass

- fixture: new session
- expected: before the first message no transcript file exists and the Pane's body is the one line 本会话还没有对话; after the first submit it lists the new file's chain (verifier)
- actual: `{"before": {"entries": 0, "notes": ["本会话还没有对话"], "transcriptFiles": 0}, "filesAfterSubmit": 1, "after": {"entries": [{"row": 4, "day": "今天 · 10月17日", "time": "17:44", "userLines": ["CT-SYN 第一条合成 prompt"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "running": false, "userOff": false, "agentOff": false, "highlighted": true}], "expected": ["CT-SYN 第一条合成 prompt"]}}`
- evidence: [debug-data-001.log](pty/2.1.287/gate/debug-data-001.log), [019-data-001-new-session--before-the-first-message.txt](pty/2.1.287/gate/screens/019-data-001-new-session--before-the-first-message.txt), [020-data-001-after-the-first-submit.txt](pty/2.1.287/gate/screens/020-data-001-after-the-first-submit.txt)

### CT-DATA-001 · 2.1.295 · pass

- fixture: new session
- expected: before the first message no transcript file exists and the Pane's body is the one line 本会话还没有对话; after the first submit it lists the new file's chain (verifier)
- actual: `{"before": {"entries": 0, "notes": ["本会话还没有对话"], "transcriptFiles": 0}, "filesAfterSubmit": 1, "after": {"entries": [{"row": 5, "day": "今天 · 10月17日", "time": "17:07", "userLines": ["CT-SYN 第一条合成 prompt"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "running": false, "userOff": false, "agentOff": false, "highlighted": true}], "expected": ["CT-SYN 第一条合成 prompt"]}}`
- evidence: [debug-data-001.log](pty/2.1.295/gate/debug-data-001.log), [020-data-001-new-session--before-the-first-message.txt](pty/2.1.295/gate/screens/020-data-001-new-session--before-the-first-message.txt), [021-data-001-after-the-first-submit.txt](pty/2.1.295/gate/screens/021-data-001-after-the-first-submit.txt)

### CT-DATA-002 · 2.1.287 · pass

- fixture: turns 6; mode 000, then a directory, re-read by hot reloads
- expected: an unreadable transcript shows no entries and keeps the reason at the bottom (没有权限… / 读不到…), nothing pieced together from elsewhere; readable again, the entries come back
- actual: `{"denied": {"entries": 0, "reasonShown": true}, "failed": {"entries": 0, "reasonShown": true}, "readableAgain": {"ok": true, "notes": ["▅▆█▅▆█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁", "10月9日 09:00                          09:03"]}}`
- evidence: [debug-data-002.log](pty/2.1.287/gate/debug-data-002.log), [021-data-002-readable.txt](pty/2.1.287/gate/screens/021-data-002-readable.txt), [022-data-002-mode-000-after-a-re-read.txt](pty/2.1.287/gate/screens/022-data-002-mode-000-after-a-re-read.txt), [023-data-002-a-directory-in-its-place-after-a-re-read.txt](pty/2.1.287/gate/screens/023-data-002-a-directory-in-its-place-after-a-re-read.txt), [024-data-002-readable-again.txt](pty/2.1.287/gate/screens/024-data-002-readable-again.txt)

### CT-DATA-002 · 2.1.295 · pass

- fixture: turns 6; mode 000, then a directory, re-read by hot reloads
- expected: an unreadable transcript shows no entries and keeps the reason at the bottom (没有权限… / 读不到…), nothing pieced together from elsewhere; readable again, the entries come back
- actual: `{"denied": {"entries": 0, "reasonShown": true}, "failed": {"entries": 0, "reasonShown": true}, "readableAgain": {"ok": true, "notes": ["▅▆█▅▆█▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁", "10月9日 09:00                          09:03"]}}`
- evidence: [debug-data-002.log](pty/2.1.295/gate/debug-data-002.log), [022-data-002-readable.txt](pty/2.1.295/gate/screens/022-data-002-readable.txt), [023-data-002-mode-000-after-a-re-read.txt](pty/2.1.295/gate/screens/023-data-002-mode-000-after-a-re-read.txt), [024-data-002-a-directory-in-its-place-after-a-re-read.txt](pty/2.1.295/gate/screens/024-data-002-a-directory-in-its-place-after-a-re-read.txt), [025-data-002-readable-again.txt](pty/2.1.295/gate/screens/025-data-002-readable-again.txt)

### CT-DATA-003 · 2.1.287 · pass

- fixture: turns 6 with 3 lines that are not rows
- expected: the lines are skipped, every row is still listed (verifier), and the bottom says 有 3 行无法识别，目录可能不完整 (N the actual count)
- actual: `{"verifierUnreadable": 3, "noteShown": true, "wholeList": {"ok": true, "covered": 6, "missing": []}}`
- evidence: [025-data-003-three-unreadable-lines.txt](pty/2.1.287/gate/screens/025-data-003-three-unreadable-lines.txt), [whole-02.json](pty/2.1.287/gate/whole-02.json)

### CT-DATA-003 · 2.1.295 · pass

- fixture: turns 6 with 3 lines that are not rows
- expected: the lines are skipped, every row is still listed (verifier), and the bottom says 有 3 行无法识别，目录可能不完整 (N the actual count)
- actual: `{"verifierUnreadable": 3, "noteShown": true, "wholeList": {"ok": true, "covered": 6, "missing": []}}`
- evidence: [026-data-003-three-unreadable-lines.txt](pty/2.1.295/gate/screens/026-data-003-three-unreadable-lines.txt), [whole-02.json](pty/2.1.295/gate/whole-02.json)

### CT-DATA-004 · 2.1.287 · pass

- fixture: heavy 9 MiB (rows across the 4,000,000 B and 8,000,000 B chunk edges)
- expected: the chunked first read lists what the whole file holds (verifier, every window), rows split across chunk edges included; the next submit is read incrementally: one chunk from the last offset, no whole re-read
- actual: `{"fileBytes": 9455432, "linesAcrossChunkEdges": {"4000000": true, "8000000": true}, "wholeList": {"ok": true, "covered": 48, "missing": [], "windows": 23}, "readWhole": [{"ms": 136.11, "chunks": 3, "groups": 48, "size": 9455515}], "readTailAfterSubmit": [{"ms": 73.95, "chunks": 1, "size": 9480524}, {"ms": 16.1, "chunks": 1, "size": 9513538}], "wholeReadsAfterSubmit": 0, "sizeBeforeSubmit": 945551…`
- evidence: [debug-data-004.log](pty/2.1.287/gate/debug-data-004.log), [027-data-004-resumed-9-MiB.txt](pty/2.1.287/gate/screens/027-data-004-resumed-9-MiB.txt), [whole-03.json](pty/2.1.287/gate/whole-03.json), [051-data-004-after-a-submit.txt](pty/2.1.287/gate/screens/051-data-004-after-a-submit.txt)

### CT-DATA-004 · 2.1.295 · pass

- fixture: heavy 9 MiB (rows across the 4,000,000 B and 8,000,000 B chunk edges)
- expected: the chunked first read lists what the whole file holds (verifier, every window), rows split across chunk edges included; the next submit is read incrementally: one chunk from the last offset, no whole re-read
- actual: `{"fileBytes": 9455432, "linesAcrossChunkEdges": {"4000000": true, "8000000": true}, "wholeList": {"ok": true, "covered": 48, "missing": [], "windows": 23}, "readWhole": [{"ms": 173.19, "chunks": 3, "groups": 48, "size": 9455515}], "readTailAfterSubmit": [{"ms": 81.44, "chunks": 1, "size": 9481317}, {"ms": 12.09, "chunks": 1, "size": 9514359}], "wholeReadsAfterSubmit": 0, "sizeBeforeSubmit": 94555…`
- evidence: [debug-data-004.log](pty/2.1.295/gate/debug-data-004.log), [029-data-004-resumed-9-MiB.txt](pty/2.1.295/gate/screens/029-data-004-resumed-9-MiB.txt), [whole-03.json](pty/2.1.295/gate/whole-03.json), [053-data-004-after-a-submit.txt](pty/2.1.295/gate/screens/053-data-004-after-a-submit.txt)

### CT-DATA-005 · 2.1.287 · pass

- fixture: forms
- expected: a subagent's rows are not listed; the subagent call is 1 step; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"subagentOneStep": true, "subagentContentNotListed": true}}`
- evidence: [052-forms-after-resume.txt](pty/2.1.287/gate/screens/052-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-DATA-005 · 2.1.295 · pass

- fixture: forms
- expected: a subagent's rows are not listed; the subagent call is 1 step; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"subagentOneStep": true, "subagentContentNotListed": true}}`
- evidence: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-DATA-006 · 2.1.287 · pass

- fixture: data-006
- expected: each terminal lists only its own session's chain, before and after a submit in one of them
- actual: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3"]}, "B": {"ok": true, "expected": 3, "covered": 3, "missing": [], "users": ["Q00 合成问题 0", "Q01 合成问题 1", "Q02 合成问题 2"]}, "AafterSubmit": {"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3", "P 终端一里提交的合成 …`
- evidence: [016-terminal-1--session-A.txt](pty/2.1.287/chain/screens/016-terminal-1--session-A.txt), [016-terminal-1--session-A-diff.json](pty/2.1.287/chain/016-terminal-1--session-A-diff.json), [017-terminal-2--session-B.txt](pty/2.1.287/chain/screens/017-terminal-2--session-B.txt), [017-terminal-2--session-B-diff.json](pty/2.1.287/chain/017-terminal-2--session-B-diff.json), [018-terminal-1-after-its-submit.txt](pty/2.1.287/chain/screens/018-terminal-1-after-its-submit.txt), [018-terminal-1-after-its-submit-diff.json](pty/2.1.287/chain/018-terminal-1-after-its-submit-diff.json) and 2 more

### CT-DATA-006 · 2.1.295 · pass

- fixture: data-006
- expected: each terminal lists only its own session's chain, before and after a submit in one of them
- actual: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3"]}, "B": {"ok": true, "expected": 3, "covered": 3, "missing": [], "users": ["Q00 合成问题 0", "Q01 合成问题 1", "Q02 合成问题 2"]}, "AafterSubmit": {"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3", "P 终端一里提交的合成 …`
- evidence: [016-terminal-1--session-A.txt](pty/2.1.295/chain/screens/016-terminal-1--session-A.txt), [016-terminal-1--session-A-diff.json](pty/2.1.295/chain/016-terminal-1--session-A-diff.json), [017-terminal-2--session-B.txt](pty/2.1.295/chain/screens/017-terminal-2--session-B.txt), [017-terminal-2--session-B-diff.json](pty/2.1.295/chain/017-terminal-2--session-B-diff.json), [018-terminal-1-after-its-submit.txt](pty/2.1.295/chain/screens/018-terminal-1-after-its-submit.txt), [018-terminal-1-after-its-submit-diff.json](pty/2.1.295/chain/018-terminal-1-after-its-submit-diff.json) and 2 more

### CT-TURN-001 · 2.1.287 · pass

- fixture: forms
- expected: prompts, slash commands (a user row, a system/local_command row), a prompt-type command, !cmd and a queued prompt each open a group; output, notices, interrupts and reminders open none; local commands and !cmd have a user side only; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"prompt": true, "slashPrompt": true, "localCommandUserRow": true, "localCommandSystemRow": true, "bang": true, "queued": true, "noOutputOrNoticeGroups": true, "localCommandsUserSideOnly": true}}`
- evidence: [052-forms-after-resume.txt](pty/2.1.287/gate/screens/052-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-001 · 2.1.295 · pass

- fixture: forms
- expected: prompts, slash commands (a user row, a system/local_command row), a prompt-type command, !cmd and a queued prompt each open a group; output, notices, interrupts and reminders open none; local commands and !cmd have a user side only; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"prompt": true, "slashPrompt": true, "localCommandUserRow": true, "localCommandSystemRow": true, "bang": true, "queued": true, "noOutputOrNoticeGroups": true, "localCommandsUserSideOnly": true}}`
- evidence: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-002 · 2.1.287 · pass

- fixture: forms
- expected: three identical prompts are three entries; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"identicalPromptEntries": 3}}`
- evidence: [052-forms-after-resume.txt](pty/2.1.287/gate/screens/052-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-002 · 2.1.295 · pass

- fixture: forms
- expected: three identical prompts are three entries; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"identicalPromptEntries": 3}}`
- evidence: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-003 · 2.1.287 · pass

- fixture: forms
- expected: multi-line CJK/emoji text is cut to 2 lines by cell width with …; <pasted_content> tags removed; an image-only prompt says （只有图片）; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"multilineTwoLinesWithEllipsis": true, "multilineLines": ["F02 多行与宽字符：第一行中文 第二行", "emoji 🚀✨ 与全角，ＡＢＣ 第三行很长很长…"], "pasteTagsGone": true, "imageOnly": true}}`
- evidence: [052-forms-after-resume.txt](pty/2.1.287/gate/screens/052-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-003 · 2.1.295 · pass

- fixture: forms
- expected: multi-line CJK/emoji text is cut to 2 lines by cell width with …; <pasted_content> tags removed; an image-only prompt says （只有图片）; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"multilineTwoLinesWithEllipsis": true, "multilineLines": ["F02 多行与宽字符：第一行中文 第二行", "emoji 🚀✨ 与全角，ＡＢＣ 第三行很长很长…"], "pasteTagsGone": true, "imageOnly": true}}`
- evidence: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-004 · 2.1.287 · pass

- fixture: forms
- expected: the Agent side reads N 步 with the last text, N 步 · 无文字回复, 已中断 · N 步, 出错 · N 步 as the file has it (the live 进行中 · N 步: turn-004-live); the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"stepsAndLastText": true, "noTextReply": true, "interrupted": true, "error": true}}`
- evidence: [052-forms-after-resume.txt](pty/2.1.287/gate/screens/052-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-004 · 2.1.287 · pass

- fixture: turns 3 + one live turn against fake_api.py (two Read steps, 4 s apart; no model)
- expected: while the turn runs the last entry reads 进行中, then 进行中 · 1 步, 进行中 · 2 步 as the steps land; after it, 2 步 with the closing text, as the verifier reads the file
- actual: `{"final": {"row": 23, "day": "今天 · 10月17日", "time": "17:45", "userLines": ["CT-TURN-004 进行中的合成一轮"], "agentHead": "2 步", "agentLines": ["完成"], "running": false, "userOff": false, "agentOff": false, "highlighted": true}, "finalMatchesVerifier": true, "requests": [{"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 0}, {"method": "POST", "path": "/v1/message…`
- evidence: [059-turn-004-live-3-步.txt](pty/2.1.287/gate/screens/059-turn-004-live-3-步.txt), [060-turn-004-live-进行中.txt](pty/2.1.287/gate/screens/060-turn-004-live-进行中.txt), [061-turn-004-live-进行中---1-步.txt](pty/2.1.287/gate/screens/061-turn-004-live-进行中---1-步.txt), [062-turn-004-live-进行中---2-步.txt](pty/2.1.287/gate/screens/062-turn-004-live-进行中---2-步.txt), [063-turn-004-live-2-步.txt](pty/2.1.287/gate/screens/063-turn-004-live-2-步.txt), [064-turn-004-live-done.txt](pty/2.1.287/gate/screens/064-turn-004-live-done.txt)

### CT-TURN-004 · 2.1.295 · pass

- fixture: forms
- expected: the Agent side reads N 步 with the last text, N 步 · 无文字回复, 已中断 · N 步, 出错 · N 步 as the file has it (the live 进行中 · N 步: turn-004-live); the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"stepsAndLastText": true, "noTextReply": true, "interrupted": true, "error": true}}`
- evidence: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-004 · 2.1.295 · pass

- fixture: turns 3 + one live turn against fake_api.py (two Read steps, 4 s apart; no model)
- expected: while the turn runs the last entry reads 进行中, then 进行中 · 1 步, 进行中 · 2 步 as the steps land; after it, 2 步 with the closing text, as the verifier reads the file
- actual: `{"final": {"row": 24, "day": "今天 · 10月17日", "time": "17:09", "userLines": ["CT-TURN-004 进行中的合成一轮"], "agentHead": "2 步", "agentLines": ["完成"], "running": false, "userOff": false, "agentOff": false, "highlighted": true}, "finalMatchesVerifier": true, "requests": [{"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 0}, {"method": "POST", "path": "/v1/message…`
- evidence: [061-turn-004-live-3-步.txt](pty/2.1.295/gate/screens/061-turn-004-live-3-步.txt), [062-turn-004-live-进行中.txt](pty/2.1.295/gate/screens/062-turn-004-live-进行中.txt), [063-turn-004-live-进行中---1-步.txt](pty/2.1.295/gate/screens/063-turn-004-live-进行中---1-步.txt), [064-turn-004-live-进行中---2-步.txt](pty/2.1.295/gate/screens/064-turn-004-live-进行中---2-步.txt), [065-turn-004-live-2-步.txt](pty/2.1.295/gate/screens/065-turn-004-live-2-步.txt), [066-turn-004-live-done.txt](pty/2.1.295/gate/screens/066-turn-004-live-done.txt)

### CT-TURN-005 · 2.1.287 · pass

- fixture: forms
- expected: time from the row's timestamp; the row without one shows no time; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"noTimestampNoTime": true, "othersTimed": true}}`
- evidence: [052-forms-after-resume.txt](pty/2.1.287/gate/screens/052-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-005 · 2.1.295 · pass

- fixture: forms
- expected: time from the row's timestamp; the row without one shows no time; the whole list equals the verifier's
- actual: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 6}, "checks": {"noTimestampNoTime": true, "othersTimed": true}}`
- evidence: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-LIFE-001 · 2.1.287 · pass

- fixture: turns 6
- expected: opens by itself; ✕ keeps it closed across a hot reload (no ui.open); /chat-toc reopens it focused and never closes; a hot reload with it open makes no ui.open; a new process opens it again
- actual: `{"openedByItself": true, "closedOnMark": true, "reloadWithPaneClosed": {"opens": []}, "closedAfterReload": true, "reopenedByCommand": true, "reopenedFocused": true, "stillOpenAfterSecondCommand": true, "reloadWithPaneOpen": {"opens": []}, "oneOpenAfterReload": true, "newProcessOpens": true}`
- evidence: [debug-001-first.log](pty/2.1.287/ct-life/debug-001-first.log), [001-001-opened-by-itself.txt](pty/2.1.287/ct-life/screens/001-001-opened-by-itself.txt), [002-001-after-clicking-the-close-mark-at--0--169-.txt](pty/2.1.287/ct-life/screens/002-001-after-clicking-the-close-mark-at--0--169-.txt), [003-001-after-a-hot-reload-with-the-Pane-closed.txt](pty/2.1.287/ct-life/screens/003-001-after-a-hot-reload-with-the-Pane-closed.txt), [004-001--chat-toc-opened-it.txt](pty/2.1.287/ct-life/screens/004-001--chat-toc-opened-it.txt), [005-001-l-pressed-after--chat-toc-reopened-it.txt](pty/2.1.287/ct-life/screens/005-001-l-pressed-after--chat-toc-reopened-it.txt) and 4 more

### CT-LIFE-001 · 2.1.295 · pass

- fixture: turns 6
- expected: opens by itself; ✕ keeps it closed across a hot reload (no ui.open); /chat-toc reopens it focused and never closes; a hot reload with it open makes no ui.open; a new process opens it again
- actual: `{"openedByItself": true, "closedOnMark": true, "reloadWithPaneClosed": {"opens": []}, "closedAfterReload": true, "reopenedByCommand": true, "reopenedFocused": true, "stillOpenAfterSecondCommand": true, "reloadWithPaneOpen": {"opens": []}, "oneOpenAfterReload": true, "newProcessOpens": true}`
- evidence: [debug-001-first.log](pty/2.1.295/ct-life/debug-001-first.log), [001-001-opened-by-itself.txt](pty/2.1.295/ct-life/screens/001-001-opened-by-itself.txt), [002-001-after-clicking-the-close-mark-at--0--168-.txt](pty/2.1.295/ct-life/screens/002-001-after-clicking-the-close-mark-at--0--168-.txt), [003-001-after-a-hot-reload-with-the-Pane-closed.txt](pty/2.1.295/ct-life/screens/003-001-after-a-hot-reload-with-the-Pane-closed.txt), [004-001--chat-toc-opened-it.txt](pty/2.1.295/ct-life/screens/004-001--chat-toc-opened-it.txt), [005-001-l-pressed-after--chat-toc-reopened-it.txt](pty/2.1.295/ct-life/screens/005-001-l-pressed-after--chat-toc-reopened-it.txt) and 4 more

### CT-LIFE-002 · 2.1.287 · pass

- fixture: turns 6
- expected: /clear lists just the new session's chain (verifier), nothing of the old and no line parting them; after ✕, /clear opens the Pane again
- actual: `{"afterClearOpen": {"entries": [{"row": 4, "day": "今天 · 10月17日", "time": "17:36", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "running": false, "userOff": false, "agentOff": false, "highlighted": false}], "notes": [], "file": "f280d682-599d-4295-9f03-12b6c26b0288.jsonl"}, "rebuilt": true, "afterClearClosed": {"entries": [{"row": 4, "day": "今天 · 10月17日", "time": "17:36", "userLin…`
- evidence: [debug-002.log](pty/2.1.287/ct-life/debug-002.log), [009-002-opened-by-itself.txt](pty/2.1.287/ct-life/screens/009-002-opened-by-itself.txt), [010-002-after--clear-with-the-Pane-open.txt](pty/2.1.287/ct-life/screens/010-002-after--clear-with-the-Pane-open.txt), [011-002-closed-by--.txt](pty/2.1.287/ct-life/screens/011-002-closed-by--.txt), [012-002--clear-after---opened-it-again.txt](pty/2.1.287/ct-life/screens/012-002--clear-after---opened-it-again.txt)

### CT-LIFE-002 · 2.1.295 · pass

- fixture: turns 6
- expected: /clear lists just the new session's chain (verifier), nothing of the old and no line parting them; after ✕, /clear opens the Pane again
- actual: `{"afterClearOpen": {"entries": [{"row": 5, "day": "今天 · 10月17日", "time": "17:00", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "running": false, "userOff": false, "agentOff": false, "highlighted": false}], "notes": [], "file": "4f17835a-2570-4092-ae92-a6a510815a4a.jsonl"}, "rebuilt": true, "afterClearClosed": {"entries": [{"row": 5, "day": "今天 · 10月17日", "time": "17:01", "userLin…`
- evidence: [debug-002.log](pty/2.1.295/ct-life/debug-002.log), [009-002-opened-by-itself.txt](pty/2.1.295/ct-life/screens/009-002-opened-by-itself.txt), [010-002-after--clear-with-the-Pane-open.txt](pty/2.1.295/ct-life/screens/010-002-after--clear-with-the-Pane-open.txt), [011-002-closed-by--.txt](pty/2.1.295/ct-life/screens/011-002-closed-by--.txt), [012-002--clear-after---opened-it-again.txt](pty/2.1.295/ct-life/screens/012-002--clear-after---opened-it-again.txt)

### CT-LIFE-003 · 2.1.287 · pass

- fixture: life-003
- expected: every group on the chain across both compact boundaries, the rewound branch left out
- actual: `{"ok": true, "expected": 10, "covered": 10, "missing": [], "users": ["K00 合成问题 0", "K01 合成问题 1", "K02 合成问题 2", "K03 合成问题 3", "K04 合成问题 4", "K05 合成问题 5", "K06 合成问题 6", "K07 合成问题 7", "K08 合成问题 8", "KYY rewind 之后的一轮"]}`
- evidence: [001-whole-pane-after-resume--two-compactions.txt](pty/2.1.287/chain/screens/001-whole-pane-after-resume--two-compactions.txt), [001-whole-pane-after-resume--two-compactions-diff.json](pty/2.1.287/chain/001-whole-pane-after-resume--two-compactions-diff.json)

### CT-LIFE-003 · 2.1.287 · pass

- fixture: live /compact
- expected: after /compact the rule shows after the /compact entry and the context use hides until the next response
- actual: `{"afterCompact": "2 轮", "hiddenAfterCompact": true, "ruleAfterCompactEntry": true, "compactRule": {"ok": true, "expected": [{"before": 2, "text": "已压缩 17:38"}], "actual": [{"text": "已压缩 17:38", "before": 2}], "windowStart": 0}, "afterNextResponse": "3 轮 · 上下文已用 47%"}`
- evidence: [008-ctx-before-the-first-response.txt](pty/2.1.287/compaction/screens/008-ctx-before-the-first-response.txt), [009-ctx-after-the-first-response.txt](pty/2.1.287/compaction/screens/009-ctx-after-the-first-response.txt), [010-ctx-after--compact.txt](pty/2.1.287/compaction/screens/010-ctx-after--compact.txt), [011-ctx-back-with-the-next-response.txt](pty/2.1.287/compaction/screens/011-ctx-back-with-the-next-response.txt), [012-ctx-in-the-band.txt](pty/2.1.287/compaction/screens/012-ctx-in-the-band.txt), [013-ctx-timeline-at-44-columns.txt](pty/2.1.287/compaction/screens/013-ctx-timeline-at-44-columns.txt) and 1 more

### CT-LIFE-003 · 2.1.295 · pass

- fixture: life-003
- expected: every group on the chain across both compact boundaries, the rewound branch left out
- actual: `{"ok": true, "expected": 10, "covered": 10, "missing": [], "users": ["K00 合成问题 0", "K01 合成问题 1", "K02 合成问题 2", "K03 合成问题 3", "K04 合成问题 4", "K05 合成问题 5", "K06 合成问题 6", "K07 合成问题 7", "K08 合成问题 8", "KYY rewind 之后的一轮"]}`
- evidence: [001-whole-pane-after-resume--two-compactions.txt](pty/2.1.295/chain/screens/001-whole-pane-after-resume--two-compactions.txt), [001-whole-pane-after-resume--two-compactions-diff.json](pty/2.1.295/chain/001-whole-pane-after-resume--two-compactions-diff.json)

### CT-LIFE-003 · 2.1.295 · pass

- fixture: live /compact
- expected: after /compact the rule shows after the /compact entry and the context use hides until the next response
- actual: `{"afterCompact": "2 轮", "hiddenAfterCompact": true, "ruleAfterCompactEntry": true, "compactRule": {"ok": true, "expected": [{"before": 2, "text": "已压缩 17:02"}], "actual": [{"text": "已压缩 17:02", "before": 2}], "windowStart": 0}, "afterNextResponse": "3 轮 · 上下文已用 47%"}`
- evidence: [008-ctx-before-the-first-response.txt](pty/2.1.295/compaction/screens/008-ctx-before-the-first-response.txt), [009-ctx-after-the-first-response.txt](pty/2.1.295/compaction/screens/009-ctx-after-the-first-response.txt), [010-ctx-after--compact.txt](pty/2.1.295/compaction/screens/010-ctx-after--compact.txt), [011-ctx-back-with-the-next-response.txt](pty/2.1.295/compaction/screens/011-ctx-back-with-the-next-response.txt), [012-ctx-in-the-band.txt](pty/2.1.295/compaction/screens/012-ctx-in-the-band.txt), [013-ctx-timeline-at-44-columns.txt](pty/2.1.295/compaction/screens/013-ctx-timeline-at-44-columns.txt) and 1 more

### CT-LIFE-004 · 2.1.287 · pass

- fixture: life-004
- expected: within 500 ms of the restore, with the file unchanged, the Pane lists R00-R02 only; after the next submit it equals the file's chain: R00-R02 and the new prompt
- actual: `{"before": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "droppedAfterMs": 12, "fileUnchanged": true, "heldBeforeSubmit": true, "after": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 rewind 之后提交的合成 prompt"]}}`
- evidence: [002-before-rewind.txt](pty/2.1.287/chain/screens/002-before-rewind.txt), [002-before-rewind-diff.json](pty/2.1.287/chain/002-before-rewind-diff.json), [003-rewind-dialog-on-R03.txt](pty/2.1.287/chain/screens/003-rewind-dialog-on-R03.txt), [004-after-rewind--before-the-next-submit.txt](pty/2.1.287/chain/screens/004-after-rewind--before-the-next-submit.txt), [005-after-the-next-submit.txt](pty/2.1.287/chain/screens/005-after-the-next-submit.txt), [005-after-the-next-submit-diff.json](pty/2.1.287/chain/005-after-the-next-submit-diff.json)

### CT-LIFE-004 · 2.1.295 · pass

- fixture: life-004
- expected: within 500 ms of the restore, with the file unchanged, the Pane lists R00-R02 only; after the next submit it equals the file's chain: R00-R02 and the new prompt
- actual: `{"before": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "droppedAfterMs": 12, "fileUnchanged": true, "heldBeforeSubmit": true, "after": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 rewind 之后提交的合成 prompt"]}}`
- evidence: [002-before-rewind.txt](pty/2.1.295/chain/screens/002-before-rewind.txt), [002-before-rewind-diff.json](pty/2.1.295/chain/002-before-rewind-diff.json), [003-rewind-dialog-on-R03.txt](pty/2.1.295/chain/screens/003-rewind-dialog-on-R03.txt), [004-after-rewind--before-the-next-submit.txt](pty/2.1.295/chain/screens/004-after-rewind--before-the-next-submit.txt), [005-after-the-next-submit.txt](pty/2.1.295/chain/screens/005-after-the-next-submit.txt), [005-after-the-next-submit-diff.json](pty/2.1.295/chain/005-after-the-next-submit-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-continue
- expected: --continue opens the newest session; the Pane equals its chain
- actual: `{"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["N00 合成问题 0", "N01 合成问题 1", "N02 合成问题 2", "N03 合成问题 3", "NYY rewind 之后的一轮"]}`
- evidence: [010-after---continue.txt](pty/2.1.287/chain/screens/010-after---continue.txt), [010-after---continue-diff.json](pty/2.1.287/chain/010-after---continue-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-fork
- expected: before the first submit the fork has no file and the Pane says it is not written yet; after it the Pane equals the fork file's chain and shows the fork line; the original file keeps its own
- actual: `{"atStart": {"forkFile": null, "entries": 0, "notWrittenText": true, "emptyText": false}, "forkFile": "8853e2d3-3664-4cf4-8b42-c6aad0edb329.jsonl", "afterSubmit": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["F02 合成问题 2", "F03 合成问题 3", "FYY rewind 之后的一轮", "F 分叉之后的合成 prompt"]}, "forkLineExpected": true, "forkLine": true, "originalUntouched": true}`
- evidence: [011-after---fork-session--before-a-submit.txt](pty/2.1.287/chain/screens/011-after---fork-session--before-a-submit.txt), [012-after-the-first-submit-in-the-fork.txt](pty/2.1.287/chain/screens/012-after-the-first-submit-in-the-fork.txt), [012-after-the-first-submit-in-the-fork-diff.json](pty/2.1.287/chain/012-after-the-first-submit-in-the-fork-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-in-session
- expected: after /resume picks B, the Pane equals B's chain
- actual: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["A00 合成问题 0", "A01 合成问题 1", "A02 合成问题 2", "A03 合成问题 3"]}, "B": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["B00 合成问题 0", "B01 合成问题 1", "B02 合成问题 2", "BYY rewind 之后的一轮"]}}`
- evidence: [013-session-A-before--resume.txt](pty/2.1.287/chain/screens/013-session-A-before--resume.txt), [013-session-A-before--resume-diff.json](pty/2.1.287/chain/013-session-A-before--resume-diff.json), [014-resume-picker.txt](pty/2.1.287/chain/screens/014-resume-picker.txt), [015-session-B-after-in-session--resume.txt](pty/2.1.287/chain/screens/015-session-B-after-in-session--resume.txt), [015-session-B-after-in-session--resume-diff.json](pty/2.1.287/chain/015-session-B-after-in-session--resume-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: turns 6, --fork-session
- expected: before the fork's first submit its file does not exist and the Pane says 本会话还没写进 transcript 文件，提交第一条消息后显示目录; after the submit the Pane matches the fork file's chain (verifier)
- actual: `{"forkFileExists": false, "saysNotWritten": true, "listsForkChain": true}`
- evidence: [debug-fork.log](pty/2.1.287/ct-life/debug-fork.log), [013-fork-before-the-first-submit.txt](pty/2.1.287/ct-life/screens/013-fork-before-the-first-submit.txt), [014-fork-after-the-first-submit.txt](pty/2.1.287/ct-life/screens/014-fork-after-the-first-submit.txt)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-continue
- expected: --continue opens the newest session; the Pane equals its chain
- actual: `{"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["N00 合成问题 0", "N01 合成问题 1", "N02 合成问题 2", "N03 合成问题 3", "NYY rewind 之后的一轮"]}`
- evidence: [010-after---continue.txt](pty/2.1.295/chain/screens/010-after---continue.txt), [010-after---continue-diff.json](pty/2.1.295/chain/010-after---continue-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-fork
- expected: before the first submit the fork has no file and the Pane says it is not written yet; after it the Pane equals the fork file's chain and shows the fork line; the original file keeps its own
- actual: `{"atStart": {"forkFile": null, "entries": 0, "notWrittenText": true, "emptyText": false}, "forkFile": "336d150c-4833-4efc-9c7e-795528e80e18.jsonl", "afterSubmit": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["F02 合成问题 2", "F03 合成问题 3", "FYY rewind 之后的一轮", "F 分叉之后的合成 prompt"]}, "forkLineExpected": true, "forkLine": true, "originalUntouched": true}`
- evidence: [011-after---fork-session--before-a-submit.txt](pty/2.1.295/chain/screens/011-after---fork-session--before-a-submit.txt), [012-after-the-first-submit-in-the-fork.txt](pty/2.1.295/chain/screens/012-after-the-first-submit-in-the-fork.txt), [012-after-the-first-submit-in-the-fork-diff.json](pty/2.1.295/chain/012-after-the-first-submit-in-the-fork-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-in-session
- expected: after /resume picks B, the Pane equals B's chain
- actual: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["A00 合成问题 0", "A01 合成问题 1", "A02 合成问题 2", "A03 合成问题 3"]}, "B": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["B00 合成问题 0", "B01 合成问题 1", "B02 合成问题 2", "BYY rewind 之后的一轮"]}}`
- evidence: [013-session-A-before--resume.txt](pty/2.1.295/chain/screens/013-session-A-before--resume.txt), [013-session-A-before--resume-diff.json](pty/2.1.295/chain/013-session-A-before--resume-diff.json), [014-resume-picker.txt](pty/2.1.295/chain/screens/014-resume-picker.txt), [015-session-B-after-in-session--resume.txt](pty/2.1.295/chain/screens/015-session-B-after-in-session--resume.txt), [015-session-B-after-in-session--resume-diff.json](pty/2.1.295/chain/015-session-B-after-in-session--resume-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: turns 6, --fork-session
- expected: before the fork's first submit its file does not exist and the Pane says 本会话还没写进 transcript 文件，提交第一条消息后显示目录; after the submit the Pane matches the fork file's chain (verifier)
- actual: `{"forkFileExists": false, "saysNotWritten": true, "listsForkChain": true}`
- evidence: [debug-fork.log](pty/2.1.295/ct-life/debug-fork.log), [013-fork-before-the-first-submit.txt](pty/2.1.295/ct-life/screens/013-fork-before-the-first-submit.txt), [014-fork-after-the-first-submit.txt](pty/2.1.295/ct-life/screens/014-fork-after-the-first-submit.txt)

### CT-LIFE-006 · 2.1.287 · pass

- fixture: turns 300
- expected: after a hot reload the lit group is the view's (after a wheel), and a jump lands its prompt at the top and lights its group
- actual: `{"before": {"top": 291, "sitedTop": 291, "lit": [291], "footerCounts": true, "window": [291, 292, 293, 294, 295, 296], "lastWhole": false}, "afterReload": {"top": 291, "sitedTop": 291, "lit": [291], "footerCounts": true, "window": [291, 292, 293, 294, 295, 296], "lastWhole": false}, "afterWheel": {"top": 290, "sitedTop": 290, "lit": [290], "footerCounts": true, "window": [290, 291, 292, 293, 294,…`
- evidence: [027-after-the-hot-reload.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/027-after-the-hot-reload.txt), [028-after-a-wheel.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/028-after-a-wheel.txt), [029-after-jumping-to-T0291.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/029-after-jumping-to-T0291.txt)

### CT-LIFE-006 · 2.1.295 · pass

- fixture: turns 300
- expected: after a hot reload the lit group is the view's (after a wheel), and a jump lands its prompt at the top and lights its group
- actual: `{"before": {"top": 289, "sitedTop": 289, "lit": [289], "footerCounts": true, "window": [289, 290, 291, 292, 293, 294], "lastWhole": false}, "afterReload": {"top": 289, "sitedTop": 289, "lit": [289], "footerCounts": true, "window": [289, 290, 291, 292, 293, 294], "lastWhole": false}, "afterWheel": {"top": 289, "sitedTop": 289, "lit": [289], "footerCounts": true, "window": [289, 290, 291, 292, 293,…`
- evidence: [027-after-the-hot-reload.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/027-after-the-hot-reload.txt), [028-after-a-wheel.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/028-after-a-wheel.txt), [029-after-jumping-to-T0290.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/029-after-jumping-to-T0290.txt)

### CT-LIFE-007 · 2.1.287 · pass

- fixture: fresh session in a 262-character CJK project path, 3 prompts
- expected: after `claude plugin enable` and /reload-plugins, with nothing more submitted, the Pane opens by itself and matches the session file's chain (verifier)
- actual: `{"way": "claude plugin enable + /reload-plugins", "projectPathLength": 262, "install": [0, 0, 0], "paneBeforeEnable": false, "enableExit": 0, "entries": [{"row": 7, "day": "今天 · 10月17日", "time": "17:37", "userLines": ["CT-SYN alpha one"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "running": false, "userOff": false, "agentOff": false, "highlighted": false}, {"row": 10…`
- evidence: [debug-cli-2.1.287.log](pty/2.1.287/ct-mid-session/debug-cli-2.1.287.log), [001-cli-three-prompts--chat-toc-disabled.txt](pty/2.1.287/ct-mid-session/screens/001-cli-three-prompts--chat-toc-disabled.txt), [002-cli-listed-after-enabling.txt](pty/2.1.287/ct-mid-session/screens/002-cli-listed-after-enabling.txt)

### CT-LIFE-007 · 2.1.287 · pass

- fixture: turns 6, --resume
- expected: after enabling in /plugin and closing the menu (the host reloads by itself), with nothing submitted, the Pane opens by itself and matches the session file's chain (verifier)
- actual: `{"way": "/plugin menu, closed with Esc", "install": [0, 0, 0], "paneBeforeEnable": false, "entries": [{"row": 6, "day": null, "time": "09:00", "userLines": ["T0001 用户问题：请检查第 1 个模块的", "状态， 并说明下一步该做什么。"], "agentHead": "2 步", "agentLines": ["T0001 回复： 第 1 行说明：模块 1", "的检查结果正常，没有发现需要处理的问题。…"], "running": false, "userOff": false, "agentOff": false, "highlighted": false}, {"row": 11, "day": null, "time"…`
- evidence: [debug-ui-2.1.287.log](pty/2.1.287/ct-mid-session/debug-ui-2.1.287.log), [003-ui-chat-toc-toggled-in--plugin.txt](pty/2.1.287/ct-mid-session/screens/003-ui-chat-toc-toggled-in--plugin.txt), [004-ui-listed-after-enabling.txt](pty/2.1.287/ct-mid-session/screens/004-ui-listed-after-enabling.txt)

### CT-LIFE-007 · 2.1.295 · pass

- fixture: fresh session in a 262-character CJK project path, 3 prompts
- expected: after `claude plugin enable` and /reload-plugins, with nothing more submitted, the Pane opens by itself and matches the session file's chain (verifier)
- actual: `{"way": "claude plugin enable + /reload-plugins", "projectPathLength": 262, "install": [0, 0, 0], "paneBeforeEnable": false, "enableExit": 0, "entries": [{"row": 8, "day": "今天 · 10月17日", "time": "17:01", "userLines": ["CT-SYN alpha one"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "running": false, "userOff": false, "agentOff": false, "highlighted": false}, {"row": 11…`
- evidence: [debug-cli-2.1.295.log](pty/2.1.295/ct-mid-session/debug-cli-2.1.295.log), [001-cli-three-prompts--chat-toc-disabled.txt](pty/2.1.295/ct-mid-session/screens/001-cli-three-prompts--chat-toc-disabled.txt), [002-cli-listed-after-enabling.txt](pty/2.1.295/ct-mid-session/screens/002-cli-listed-after-enabling.txt)

### CT-LIFE-007 · 2.1.295 · pass

- fixture: turns 6, --resume
- expected: after enabling in /plugin and closing the menu (the host reloads by itself), with nothing submitted, the Pane opens by itself and matches the session file's chain (verifier)
- actual: `{"way": "/plugin menu, closed with Esc", "install": [0, 0, 0], "paneBeforeEnable": false, "entries": [{"row": 7, "day": null, "time": "09:00", "userLines": ["T0001 用户问题：请检查第 1 个模块的", "状态， 并说明下一步该做什么。"], "agentHead": "2 步", "agentLines": ["T0001 回复： 第 1 行说明：模块 1", "的检查结果正常，没有发现需要处理的问题。…"], "running": false, "userOff": false, "agentOff": false, "highlighted": false}, {"row": 12, "day": null, "time"…`
- evidence: [debug-ui-2.1.295.log](pty/2.1.295/ct-mid-session/debug-ui-2.1.295.log), [003-ui-chat-toc-toggled-in--plugin.txt](pty/2.1.295/ct-mid-session/screens/003-ui-chat-toc-toggled-in--plugin.txt), [004-ui-listed-after-enabling.txt](pty/2.1.295/ct-mid-session/screens/004-ui-listed-after-enabling.txt)

### CT-LIFE-008 · 2.1.287 · pass

- fixture: life-008
- expected: after quitting a rewound session without a submit and resuming it, the Pane equals the file's whole chain R00-R05, and R05 shows in the transcript too
- actual: `{"afterResume": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "paneListsR05": true, "transcriptShowsR05": true}`
- evidence: [006-rewind-dialog-on-R03.txt](pty/2.1.287/chain/screens/006-rewind-dialog-on-R03.txt), [007-008-rewound--not-submitted.txt](pty/2.1.287/chain/screens/007-008-rewound--not-submitted.txt), [008-008-resumed-after-quitting.txt](pty/2.1.287/chain/screens/008-008-resumed-after-quitting.txt), [008-008-resumed-after-quitting-diff.json](pty/2.1.287/chain/008-008-resumed-after-quitting-diff.json), [009-008-after-resume.txt](pty/2.1.287/chain/screens/009-008-after-resume.txt)

### CT-LIFE-008 · 2.1.295 · pass

- fixture: life-008
- expected: after quitting a rewound session without a submit and resuming it, the Pane equals the file's whole chain R00-R05, and R05 shows in the transcript too
- actual: `{"afterResume": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "paneListsR05": true, "transcriptShowsR05": true}`
- evidence: [006-rewind-dialog-on-R03.txt](pty/2.1.295/chain/screens/006-rewind-dialog-on-R03.txt), [007-008-rewound--not-submitted.txt](pty/2.1.295/chain/screens/007-008-rewound--not-submitted.txt), [008-008-resumed-after-quitting.txt](pty/2.1.295/chain/screens/008-008-resumed-after-quitting.txt), [008-008-resumed-after-quitting-diff.json](pty/2.1.295/chain/008-008-resumed-after-quitting-diff.json), [009-008-after-resume.txt](pty/2.1.295/chain/screens/009-008-after-resume.txt)

### CT-UI-001 · 2.1.287 · pass

- fixture: turns 9 (a /tui group with a user side only)
- expected: 2/3/1 switch the filter and the Pane redraws at once (≤ 1 s from the key), each whole list equal to the verifier's for that filter (Agent hides the user-only group), the preview's rule `─ 预览 ─── p: ✕` under the list, on the group clicked before the switches; the choice survives a new process; an unknown stored value reads as 全部
- actual: `{"pressed": 8, "user": {"redrawSeconds": 0.12, "wholeList": {"ok": true, "covered": 9, "missing": []}, "previewRule": "─ 预览 ──────────────────────────────── p:", "previewTurn": 8}, "agent": {"redrawSeconds": 0.12, "wholeList": {"ok": true, "covered": 8, "missing": []}, "previewRule": "─ 预览 ──────────────────────────────── p:", "previewTurn": 8}, "all": {"redrawSeconds": 0.12, "wholeList": {"ok": …`
- evidence: [065-ui-001-filter-user.txt](pty/2.1.287/gate/screens/065-ui-001-filter-user.txt), [whole-05.json](pty/2.1.287/gate/whole-05.json), [068-ui-001-filter-agent.txt](pty/2.1.287/gate/screens/068-ui-001-filter-agent.txt), [whole-06.json](pty/2.1.287/gate/whole-06.json), [071-ui-001-filter-all.txt](pty/2.1.287/gate/screens/071-ui-001-filter-all.txt), [whole-07.json](pty/2.1.287/gate/whole-07.json) and 2 more

### CT-UI-001 · 2.1.295 · pass

- fixture: turns 9 (a /tui group with a user side only)
- expected: 2/3/1 switch the filter and the Pane redraws at once (≤ 1 s from the key), each whole list equal to the verifier's for that filter (Agent hides the user-only group), the preview's rule `─ 预览 ─── p: ✕` under the list, on the group clicked before the switches; the choice survives a new process; an unknown stored value reads as 全部
- actual: `{"pressed": 8, "user": {"redrawSeconds": 0.12, "wholeList": {"ok": true, "covered": 9, "missing": []}, "previewRule": "─ 预览 ──────────────────────────────── p:", "previewTurn": 8}, "agent": {"redrawSeconds": 0.12, "wholeList": {"ok": true, "covered": 8, "missing": []}, "previewRule": "─ 预览 ──────────────────────────────── p:", "previewTurn": 8}, "all": {"redrawSeconds": 0.12, "wholeList": {"ok": …`
- evidence: [067-ui-001-filter-user.txt](pty/2.1.295/gate/screens/067-ui-001-filter-user.txt), [whole-05.json](pty/2.1.295/gate/whole-05.json), [070-ui-001-filter-agent.txt](pty/2.1.295/gate/screens/070-ui-001-filter-agent.txt), [whole-06.json](pty/2.1.295/gate/whole-06.json), [073-ui-001-filter-all.txt](pty/2.1.295/gate/screens/073-ui-001-filter-all.txt), [whole-07.json](pty/2.1.295/gate/whole-07.json) and 2 more

### CT-UI-002 · 2.1.287 · pass

- fixture: turns 5 (fits the window in every Layout beside the preview at 60 lines)
- expected: l and the 布局 button cycle 卡片 → 紧凑 → 时间轴, each listing the same 5 entries with their Agent sides and the preview region (its rule, the meta line, 用户) under the list, on the group clicked first; the choice survives a new process; an unknown stored value reads as 卡片
- actual: `{"pressed": 4, "views": [{"label": "卡片", "turns": [0, 1, 2, 3, 4], "agentSides": 5, "preview": ["─ 预览 ──────────────────────────────── p:", "10月9日 09:02 · 2 步 · 输出 60", "用户                       r: 填入 · c: 复制"], "previewTurn": 4}, {"label": "紧凑", "turns": [0, 1, 2, 3, 4], "agentSides": 5, "preview": ["─ 预览 ──────────────────────────────── p:", "10月9日 09:02 · 2 步 · 输出 60", "用户                     …`
- evidence: [078-ui-002-card.txt](pty/2.1.287/gate/screens/078-ui-002-card.txt), [079-ui-002-compact-by-l.txt](pty/2.1.287/gate/screens/079-ui-002-compact-by-l.txt), [080-ui-002-timeline-by-a-click.txt](pty/2.1.287/gate/screens/080-ui-002-timeline-by-a-click.txt), [081-ui-002-new-process.txt](pty/2.1.287/gate/screens/081-ui-002-new-process.txt)

### CT-UI-002 · 2.1.295 · pass

- fixture: turns 5 (fits the window in every Layout beside the preview at 60 lines)
- expected: l and the 布局 button cycle 卡片 → 紧凑 → 时间轴, each listing the same 5 entries with their Agent sides and the preview region (its rule, the meta line, 用户) under the list, on the group clicked first; the choice survives a new process; an unknown stored value reads as 卡片
- actual: `{"pressed": 4, "views": [{"label": "卡片", "turns": [0, 1, 2, 3, 4], "agentSides": 5, "preview": ["─ 预览 ──────────────────────────────── p:", "10月9日 09:02 · 2 步 · 输出 60", "用户                       r: 填入 · c: 复制"], "previewTurn": 4}, {"label": "紧凑", "turns": [0, 1, 2, 3, 4], "agentSides": 5, "preview": ["─ 预览 ──────────────────────────────── p:", "10月9日 09:02 · 2 步 · 输出 60", "用户                     …`
- evidence: [080-ui-002-card.txt](pty/2.1.295/gate/screens/080-ui-002-card.txt), [081-ui-002-compact-by-l.txt](pty/2.1.295/gate/screens/081-ui-002-compact-by-l.txt), [082-ui-002-timeline-by-a-click.txt](pty/2.1.295/gate/screens/082-ui-002-timeline-by-a-click.txt), [083-ui-002-new-process.txt](pty/2.1.295/gate/screens/083-ui-002-new-process.txt)

### CT-UI-003 · 2.1.287 · pass

- fixture: turns 12 compacted after T0001, --resume: T0000-T0001 dimmed from the start
- expected: focused, ↑ walks one side at a time (agent, user, the turn before's agent, ...), opening no preview; Enter on T0002's user side puts that prompt at the top, lights it and selects it, opening no preview; p opens the preview on it; one more ↑ moves the inverse ring off it onto T0001's Agent side on its hollow branch (not skipped) while the lit ◉ in the theme's `suggestion` (not inverse) stays on T0002; `f` then Tab from the field lands on an entry, and ↑ from it never stops on ‹ or ›
- actual: `{"dimmedBeforeKeys": true, "walk": [{"ring": [[38, "l: 布局 卡片"]], "turn": null, "side": null, "dim": null, "lit": [[33, "b1b9f9"], [35, "b1b9f9"]], "preview": false}, {"ring": [[35, "p: 预览"]], "turn": null, "side": null, "dim": null, "lit": [[31, "b1b9f9"], [33, "b1b9f9"]], "preview": false}, {"ring": [[38, "l: 布局 卡片"]], "turn": null, "side": null, "dim": null, "lit": [[31, "b1b9f9"], [33, "b1b9f9…`
- evidence: [082-ui-003-T0001--compacted-before-the-resume--dimmed.txt](pty/2.1.287/gate/screens/082-ui-003-T0001--compacted-before-the-resume--dimmed.txt), [083-ui-003-after-the---walk.txt](pty/2.1.287/gate/screens/083-ui-003-after-the---walk.txt), [084-ui-003-Enter-on-T0002.txt](pty/2.1.287/gate/screens/084-ui-003-Enter-on-T0002.txt), [085-ui-003-p-on-T0002.txt](pty/2.1.287/gate/screens/085-ui-003-p-on-T0002.txt), [086-ui-003-ring-moved-off-the-lit-entry.txt](pty/2.1.287/gate/screens/086-ui-003-ring-moved-off-the-lit-entry.txt), [087-ui-003-the-ring-past----.txt](pty/2.1.287/gate/screens/087-ui-003-the-ring-past----.txt)

### CT-UI-003 · 2.1.295 · pass

- fixture: turns 12 compacted after T0001, --resume: T0000-T0001 dimmed from the start
- expected: focused, ↑ walks one side at a time (agent, user, the turn before's agent, ...), opening no preview; Enter on T0002's user side puts that prompt at the top, lights it and selects it, opening no preview; p opens the preview on it; one more ↑ moves the inverse ring off it onto T0001's Agent side on its hollow branch (not skipped) while the lit ◉ in the theme's `suggestion` (not inverse) stays on T0002; `f` then Tab from the field lands on an entry, and ↑ from it never stops on ‹ or ›
- actual: `{"dimmedBeforeKeys": true, "walk": [{"ring": [[38, "l: 布局 卡片"]], "turn": null, "side": null, "dim": null, "lit": [[34, "b1b9f9"]], "preview": false}, {"ring": [[34, "T0011 用户问题：请检查第 11 个模块"]], "turn": 11, "side": "user", "dim": false, "lit": [[34, "b1b9f9"]], "preview": false}, {"ring": [[31, "2 步 · T0010 回复： 第 1 行说明：模块 10"]], "turn": 10, "side": "agent", "dim": null, "lit": [[35, "b1b9f9"]], "pr…`
- evidence: [084-ui-003-T0001--compacted-before-the-resume--dimmed.txt](pty/2.1.295/gate/screens/084-ui-003-T0001--compacted-before-the-resume--dimmed.txt), [085-ui-003-after-the---walk.txt](pty/2.1.295/gate/screens/085-ui-003-after-the---walk.txt), [086-ui-003-Enter-on-T0002.txt](pty/2.1.295/gate/screens/086-ui-003-Enter-on-T0002.txt), [087-ui-003-p-on-T0002.txt](pty/2.1.295/gate/screens/087-ui-003-p-on-T0002.txt), [088-ui-003-ring-moved-off-the-lit-entry.txt](pty/2.1.295/gate/screens/088-ui-003-ring-moved-off-the-lit-entry.txt), [089-ui-003-the-ring-past----.txt](pty/2.1.295/gate/screens/089-ui-003-the-ring-past----.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme dark
- expected: the lit ◉ ┣╸ are b1b9f9 (the theme's suggestion); the Agent replies, the prompts' times and the other nodes ● are 999999 (its inactive)
- actual: `{"theme": "dark", "expected": {"lit": "b1b9f9", "dimmed": "999999"}, "lit": ["b1b9f9"], "node": ["999999"], "rail": ["505050"], "dimmed": ["999999"], "text": ["default"]}`
- evidence: [088-ui-004-dark.txt](pty/2.1.287/gate/screens/088-ui-004-dark.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme light
- expected: the lit ◉ ┣╸ are 5769f7 (the theme's suggestion); the Agent replies, the prompts' times and the other nodes ● are 666666 (its inactive)
- actual: `{"theme": "light", "expected": {"lit": "5769f7", "dimmed": "666666"}, "lit": ["5769f7"], "node": ["666666"], "rail": ["afafaf"], "dimmed": ["666666"], "text": ["default"]}`
- evidence: [089-ui-004-light.txt](pty/2.1.287/gate/screens/089-ui-004-light.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme dark-ansi
- expected: the lit ◉ ┣╸ are brightblue (the theme's suggestion); the Agent replies, the prompts' times and the other nodes ● are white (its inactive)
- actual: `{"theme": "dark-ansi", "expected": {"lit": "brightblue", "dimmed": "white"}, "lit": ["brightblue"], "node": ["white"], "rail": ["white"], "dimmed": ["white"], "text": ["default"]}`
- evidence: [090-ui-004-dark-ansi.txt](pty/2.1.287/gate/screens/090-ui-004-dark-ansi.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme light-ansi
- expected: the lit ◉ ┣╸ are blue (the theme's suggestion); the Agent replies, the prompts' times and the other nodes ● are brightblack (its inactive)
- actual: `{"theme": "light-ansi", "expected": {"lit": "blue", "dimmed": "brightblack"}, "lit": ["blue"], "node": ["brightblack"], "rail": ["brightblack"], "dimmed": ["brightblack"], "text": ["default"]}`
- evidence: [091-ui-004-light-ansi.txt](pty/2.1.287/gate/screens/091-ui-004-light-ansi.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme dark, then /theme → Light mode in the same session
- expected: the Pane redraws at once in the light theme's suggestion and inactive, with no reopen
- actual: `{"before": {"lit": ["b1b9f9"], "node": ["999999"], "rail": ["505050"], "dimmed": ["999999"], "text": ["default"]}, "after": {"lit": ["5769f7"], "node": ["666666"], "rail": ["afafaf"], "dimmed": ["666666"], "text": ["default"]}}`
- evidence: [092-ui-004-after--theme-to-Light.txt](pty/2.1.287/gate/screens/092-ui-004-after--theme-to-Light.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, themes dark-daltonized, light-daltonized and auto
- expected: recorded for the record, not judged: the Pane draws under each
- actual: `{"dark-daltonized": {"lit": ["99ccff"], "node": ["999999"], "rail": ["505050"], "dimmed": ["999999"], "text": ["default"]}, "light-daltonized": {"lit": ["3366ff"], "node": ["666666"], "rail": ["afafaf"], "dimmed": ["666666"], "text": ["default"]}, "auto": {"lit": ["b1b9f9"], "node": ["999999"], "rail": ["505050"], "dimmed": ["999999"], "text": ["default"]}}`
- evidence: [093-ui-004-dark-daltonized.txt](pty/2.1.287/gate/screens/093-ui-004-dark-daltonized.txt), [094-ui-004-light-daltonized.txt](pty/2.1.287/gate/screens/094-ui-004-light-daltonized.txt), [095-ui-004-auto.txt](pty/2.1.287/gate/screens/095-ui-004-auto.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme dark
- expected: the lit ◉ ┣╸ are b1b9f9 (the theme's suggestion); the Agent replies, the prompts' times and the other nodes ● are 999999 (its inactive)
- actual: `{"theme": "dark", "expected": {"lit": "b1b9f9", "dimmed": "999999"}, "lit": ["b1b9f9"], "node": ["999999"], "rail": ["505050"], "dimmed": ["999999"], "text": ["default"]}`
- evidence: [090-ui-004-dark.txt](pty/2.1.295/gate/screens/090-ui-004-dark.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme light
- expected: the lit ◉ ┣╸ are 5769f7 (the theme's suggestion); the Agent replies, the prompts' times and the other nodes ● are 666666 (its inactive)
- actual: `{"theme": "light", "expected": {"lit": "5769f7", "dimmed": "666666"}, "lit": ["5769f7"], "node": ["666666"], "rail": ["afafaf"], "dimmed": ["666666"], "text": ["default"]}`
- evidence: [091-ui-004-light.txt](pty/2.1.295/gate/screens/091-ui-004-light.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme dark-ansi
- expected: the lit ◉ ┣╸ are brightblue (the theme's suggestion); the Agent replies, the prompts' times and the other nodes ● are white (its inactive)
- actual: `{"theme": "dark-ansi", "expected": {"lit": "brightblue", "dimmed": "white"}, "lit": ["brightblue"], "node": ["white"], "rail": ["white"], "dimmed": ["white"], "text": ["default"]}`
- evidence: [092-ui-004-dark-ansi.txt](pty/2.1.295/gate/screens/092-ui-004-dark-ansi.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme light-ansi
- expected: the lit ◉ ┣╸ are blue (the theme's suggestion); the Agent replies, the prompts' times and the other nodes ● are brightblack (its inactive)
- actual: `{"theme": "light-ansi", "expected": {"lit": "blue", "dimmed": "brightblack"}, "lit": ["blue"], "node": ["brightblack"], "rail": ["brightblack"], "dimmed": ["brightblack"], "text": ["default"]}`
- evidence: [093-ui-004-light-ansi.txt](pty/2.1.295/gate/screens/093-ui-004-light-ansi.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme dark, then /theme → Light mode in the same session
- expected: the Pane redraws at once in the light theme's suggestion and inactive, with no reopen
- actual: `{"before": {"lit": ["b1b9f9"], "node": ["999999"], "rail": ["505050"], "dimmed": ["999999"], "text": ["default"]}, "after": {"lit": ["5769f7"], "node": ["666666"], "rail": ["afafaf"], "dimmed": ["666666"], "text": ["default"]}}`
- evidence: [094-ui-004-after--theme-to-Light.txt](pty/2.1.295/gate/screens/094-ui-004-after--theme-to-Light.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, themes dark-daltonized, light-daltonized and auto
- expected: recorded for the record, not judged: the Pane draws under each
- actual: `{"dark-daltonized": {"lit": ["99ccff"], "node": ["999999"], "rail": ["505050"], "dimmed": ["999999"], "text": ["default"]}, "light-daltonized": {"lit": ["3366ff"], "node": ["666666"], "rail": ["afafaf"], "dimmed": ["666666"], "text": ["default"]}, "auto": {"lit": ["b1b9f9"], "node": ["999999"], "rail": ["505050"], "dimmed": ["999999"], "text": ["default"]}}`
- evidence: [095-ui-004-dark-daltonized.txt](pty/2.1.295/gate/screens/095-ui-004-dark-daltonized.txt), [096-ui-004-light-daltonized.txt](pty/2.1.295/gate/screens/096-ui-004-light-daltonized.txt), [097-ui-004-auto.txt](pty/2.1.295/gate/screens/097-ui-004-auto.txt)

### CT-UI-005 · 2.1.287 · pass

- fixture: 4 turns, compacted after the second, --resume
- expected: the ⚠ line is drawn in ffc107 (the dark theme's warning); it flashes inverse 3 times, the first at once and the last over within 1.5 s, then stays lit (not inverse) past 4 s and is gone by 6.5 s
- actual: `{"inverseRuns": [[44, 167], [363, 448], [649, 777]], "foregrounds": ["ffc107"], "shownMs": [44, 4999], "goneBy6500": true, "samples": 160}`
- evidence: [015-005-after-resume--nothing-pressed.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/015-005-after-resume--nothing-pressed.txt), [016-005-6-5-s-after-clicking-K00.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/016-005-6-5-s-after-clicking-K00.txt), [017-005-after-clicking-K02.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/017-005-after-clicking-K02.txt)

### CT-UI-005 · 2.1.295 · pass

- fixture: 4 turns, compacted after the second, --resume
- expected: the ⚠ line is drawn in ffc107 (the dark theme's warning); it flashes inverse 3 times, the first at once and the last over within 1.5 s, then stays lit (not inverse) past 4 s and is gone by 6.5 s
- actual: `{"inverseRuns": [[43, 157], [362, 437], [646, 760]], "foregrounds": ["ffc107"], "shownMs": [43, 5013], "goneBy6500": true, "samples": 162}`
- evidence: [015-005-after-resume--nothing-pressed.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/015-005-after-resume--nothing-pressed.txt), [016-005-6-5-s-after-clicking-K00.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/016-005-6-5-s-after-clicking-K00.txt), [017-005-after-clicking-K02.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/017-005-after-clicking-K02.txt)

### CT-JUMP-001 · 2.1.287 · pass

- fixture: turns 300
- expected: clicking turn 1's user side (never drawn after resume) puts its prompt at the top; its Agent side puts its last reply at the top
- actual: `{"firstEntry": "T0000 用户问题：请检查第 0 个模块的 状态， 并说明下一步该做什么。", "userJumpTopShowsT0000": true, "agentJumpTopShowsT0000Reply": true, "refusalShown": false}`
- evidence: [001-after-resume.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/001-after-resume.txt), [002-pane-at-top.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/002-pane-at-top.txt), [003-after-clicking-T0000-user-side.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/003-after-clicking-T0000-user-side.txt), [004-after-clicking-T0000-agent-side.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/004-after-clicking-T0000-agent-side.txt)

### CT-JUMP-001 · 2.1.295 · pass

- fixture: turns 300
- expected: clicking turn 1's user side (never drawn after resume) puts its prompt at the top; its Agent side puts its last reply at the top
- actual: `{"firstEntry": "T0000 用户问题：请检查第 0 个模块的 状态， 并说明下一步该做什么。", "userJumpTopShowsT0000": true, "agentJumpTopShowsT0000Reply": true, "refusalShown": false}`
- evidence: [001-after-resume.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/001-after-resume.txt), [002-pane-at-top.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/002-pane-at-top.txt), [003-after-clicking-T0000-user-side.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/003-after-clicking-T0000-user-side.txt), [004-after-clicking-T0000-agent-side.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/004-after-clicking-T0000-agent-side.txt)

### CT-JUMP-002 · 2.1.287 · pass

- fixture: turns 40
- expected: a local command (/tui) and a !cmd jump to a neighbouring row, centred, the typed row still in view
- actual: `{"local command": {"shown": true, "row": 20, "refused": false}, "shell command": {"shown": true, "row": 17, "refused": false}}`
- evidence: [005-pane-shows--tui.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/005-pane-shows--tui.txt), [006-after-clicking--tui.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/006-after-clicking--tui.txt), [007-pane-shows--echo-T0012.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/007-pane-shows--echo-T0012.txt), [008-after-clicking--echo-T0012.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/008-after-clicking--echo-T0012.txt)

### CT-JUMP-002 · 2.1.287 · pass

- fixture: forms23: /review, /model as a user row, a tools-only turn
- expected: a prompt-type command and a user-row local command jump to the neighbouring drawn rows; an Agent side without text jumps to its last tool row; nothing refused
- actual: `{"prompt-type command": {"shown": true, "refused": false}, "local command as a user row": {"shown": true, "refused": false}, "tools-only Agent side": {"shown": true, "refused": false}}`
- evidence: [009-after-clicking-the-user-side-of--review.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/009-after-clicking-the-user-side-of--review.txt), [010-after-clicking-the-user-side-of--model.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/010-after-clicking-the-user-side-of--model.txt), [011-after-clicking-the-agent-side-of-P08.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/011-after-clicking-the-agent-side-of-P08.txt)

### CT-JUMP-002 · 2.1.295 · pass

- fixture: turns 40
- expected: a local command (/tui) and a !cmd jump to a neighbouring row, centred, the typed row still in view
- actual: `{"local command": {"shown": true, "row": 20, "refused": false}, "shell command": {"shown": true, "row": 17, "refused": false}}`
- evidence: [005-pane-shows--tui.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/005-pane-shows--tui.txt), [006-after-clicking--tui.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/006-after-clicking--tui.txt), [007-pane-shows--echo-T0012.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/007-pane-shows--echo-T0012.txt), [008-after-clicking--echo-T0012.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/008-after-clicking--echo-T0012.txt)

### CT-JUMP-002 · 2.1.295 · pass

- fixture: forms23: /review, /model as a user row, a tools-only turn
- expected: a prompt-type command and a user-row local command jump to the neighbouring drawn rows; an Agent side without text jumps to its last tool row; nothing refused
- actual: `{"prompt-type command": {"shown": true, "refused": false}, "local command as a user row": {"shown": true, "refused": false}, "tools-only Agent side": {"shown": true, "refused": false}}`
- evidence: [009-after-clicking-the-user-side-of--review.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/009-after-clicking-the-user-side-of--review.txt), [010-after-clicking-the-user-side-of--model.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/010-after-clicking-the-user-side-of--model.txt), [011-after-clicking-the-agent-side-of-P08.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/011-after-clicking-the-agent-side-of-P08.txt)

### CT-JUMP-003 · 2.1.287 · pass

- fixture: 4 turns compacted after the second, --resume, chat-toc swapped in after the start
- expected: J00 (compacted before the resume, unknown to a chat-toc that came later) is not marked before a press; clicking it says so at the bottom, puts that side only on a hollow mark with its prompt dim (J01 not), moves nothing; the saying goes after ~5 s and the side stays marked
- actual: `{"dimBeforePress": false, "dim": [true, false], "refusalShown": true, "transcriptUnmoved": true, "refusalGoneAfter6s": true, "dimAfter6s": true}`
- evidence: [012-003-chat-toc-swapped-in--nothing-pressed.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/012-003-chat-toc-swapped-in--nothing-pressed.txt), [013-003-after-clicking-J00.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/013-003-after-clicking-J00.txt), [014-003-6-s-later.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/014-003-6-s-later.txt)

### CT-JUMP-003 · 2.1.295 · pass

- fixture: 4 turns compacted after the second, --resume, chat-toc swapped in after the start
- expected: J00 (compacted before the resume, unknown to a chat-toc that came later) is not marked before a press; clicking it says so at the bottom, puts that side only on a hollow mark with its prompt dim (J01 not), moves nothing; the saying goes after ~5 s and the side stays marked
- actual: `{"dimBeforePress": false, "dim": [true, false], "refusalShown": true, "transcriptUnmoved": true, "refusalGoneAfter6s": true, "dimAfter6s": true}`
- evidence: [012-003-chat-toc-swapped-in--nothing-pressed.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/012-003-chat-toc-swapped-in--nothing-pressed.txt), [013-003-after-clicking-J00.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/013-003-after-clicking-J00.txt), [014-003-6-s-later.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/014-003-6-s-later.txt)

### CT-JUMP-005 · 2.1.287 · pass

- fixture: 4 turns, compacted after the second, --resume
- expected: the two turns before the compaction hang on hollow marks on both sides, their prompts dim, before anything is pressed, the two after not; a click on K00 says ⚠ 这一条在压缩之前，恢复会话后无法跳转; a click on K02 jumps with nothing said
- actual: `{"dimBeforePress": {"K00": [true, true], "K01": [true, true], "K02": [false, false], "K03": [false, false]}, "noticeBeforePress": null, "saysCompacted": true, "afterCompactionRefused": false}`
- evidence: [015-005-after-resume--nothing-pressed.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/015-005-after-resume--nothing-pressed.txt), [016-005-6-5-s-after-clicking-K00.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/016-005-6-5-s-after-clicking-K00.txt), [017-005-after-clicking-K02.txt](pty/2.1.287/20261017-173903-CT-JUMP-2.1.287/screens/017-005-after-clicking-K02.txt)

### CT-JUMP-005 · 2.1.295 · pass

- fixture: 4 turns, compacted after the second, --resume
- expected: the two turns before the compaction hang on hollow marks on both sides, their prompts dim, before anything is pressed, the two after not; a click on K00 says ⚠ 这一条在压缩之前，恢复会话后无法跳转; a click on K02 jumps with nothing said
- actual: `{"dimBeforePress": {"K00": [true, true], "K01": [true, true], "K02": [false, false], "K03": [false, false]}, "noticeBeforePress": null, "saysCompacted": true, "afterCompactionRefused": false}`
- evidence: [015-005-after-resume--nothing-pressed.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/015-005-after-resume--nothing-pressed.txt), [016-005-6-5-s-after-clicking-K00.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/016-005-6-5-s-after-clicking-K00.txt), [017-005-after-clicking-K02.txt](pty/2.1.295/20261017-170309-CT-JUMP-current/screens/017-005-after-clicking-K02.txt)

### CT-POS-001 · 2.1.287 · pass

- fixture: turns 40
- expected: the last group lit at the end; a jump to /tui (centred) lights /tui while the view's top is the group before, still a second later; the next wheel over the transcript lights the top's group
- actual: `{"atEnd": {"top": 35, "sitedTop": 35, "lit": [39], "footerCounts": true, "window": [33, 34, 35, 36, 37, 38, 39], "lastWhole": false}, "afterJump": {"top": 25, "sitedTop": 25, "lit": [27], "footerCounts": true, "window": [22, 23, 24, 25, 26, 27], "lastWhole": false}, "aSecondLater": {"top": 25, "sitedTop": 25, "lit": [27], "footerCounts": true, "window": [22, 23, 24, 25, 26, 27], "lastWhole": fals…`
- evidence: [001-at-the-end.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/001-at-the-end.txt), [002-after-the-jump-to--tui.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/002-after-the-jump-to--tui.txt), [003-after-one-wheel-over-the-transcript.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/003-after-one-wheel-over-the-transcript.txt)

### CT-POS-001 · 2.1.295 · pass

- fixture: turns 40
- expected: the last group lit at the end; a jump to /tui (centred) lights /tui while the view's top is the group before, still a second later; the next wheel over the transcript lights the top's group
- actual: `{"atEnd": {"top": 35, "sitedTop": 35, "lit": [39], "footerCounts": true, "window": [34, 35, 36, 37, 38, 39], "lastWhole": false}, "afterJump": {"top": 25, "sitedTop": 25, "lit": [27], "footerCounts": true, "window": [22, 23, 24, 25, 26, 27, 28], "lastWhole": false}, "aSecondLater": {"top": 25, "sitedTop": 25, "lit": [27], "footerCounts": true, "window": [22, 23, 24, 25, 26, 27, 28], "lastWhole": …`
- evidence: [001-at-the-end.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/001-at-the-end.txt), [002-after-the-jump-to--tui.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/002-after-the-jump-to--tui.txt), [003-after-one-wheel-over-the-transcript.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/003-after-one-wheel-over-the-transcript.txt)

### CT-POS-002 · 2.1.287 · pass

- fixture: turns 300
- expected: after 180 wheel ticks up (and 90 down, and 180 up at 100/s) the lit group is the group of screen row 1 (the last group when its last row is wholly in view)
- actual: `{"up 180": {"top": 276, "sitedTop": 276, "lit": [276], "footerCounts": true, "window": [276, 277, 278, 279, 280, 281], "lastWhole": false}, "down 90": {"top": 285, "sitedTop": 285, "lit": [285], "footerCounts": true, "window": [282, 283, 284, 285, 286, 287], "lastWhole": false}, "down 7 #0": {"top": 286, "sitedTop": 286, "lit": [286], "footerCounts": true, "window": [282, 283, 284, 285, 286, 287]…`
- evidence: [004-after-up-180.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/004-after-up-180.txt), [005-after-down-90.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/005-after-down-90.txt), [006-after-down-7--0.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/006-after-down-7--0.txt), [007-after-down-7--1.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/007-after-down-7--1.txt), [008-after-down-7--2.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/008-after-down-7--2.txt), [009-after-down-7--3.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/009-after-down-7--3.txt) and 9 more

### CT-POS-002 · 2.1.295 · pass

- fixture: turns 300
- expected: after 180 wheel ticks up (and 90 down, and 180 up at 100/s) the lit group is the group of screen row 1 (the last group when its last row is wholly in view)
- actual: `{"up 180": {"top": 270, "sitedTop": 270, "lit": [270], "footerCounts": true, "window": [270, 271, 272, 273, 274, 275], "lastWhole": false}, "down 90": {"top": 282, "sitedTop": 282, "lit": [282], "footerCounts": true, "window": [282, 283, 284, 285, 286, 287], "lastWhole": false}, "down 7 #0": {"top": 283, "sitedTop": 283, "lit": [283], "footerCounts": true, "window": [282, 283, 284, 285, 286, 287]…`
- evidence: [004-after-up-180.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/004-after-up-180.txt), [005-after-down-90.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/005-after-down-90.txt), [006-after-down-7--0.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/006-after-down-7--0.txt), [007-after-down-7--1.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/007-after-down-7--1.txt), [008-after-down-7--2.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/008-after-down-7--2.txt), [009-after-down-7--3.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/009-after-down-7--3.txt) and 9 more

### CT-POS-003 · 2.1.287 · pass

- fixture: turns 300
- expected: the lit group is in the pane's window; wheeling the pane pauses: the window leaves the lit group and stays put, the footer still counts; the next move of the transcript follows again; the pane holding the keyboard (/chat-toc) pauses too: the transcript moved past the window, the window stays
- actual: `{"follows": {"top": 289, "sitedTop": 289, "lit": [289], "footerCounts": true, "window": [289, 290, 291, 292, 293, 294], "lastWhole": false}, "paneWheeled": {"top": 289, "sitedTop": 289, "lit": [], "footerCounts": true, "window": [282, 283, 284, 285, 286, 287, 288], "lastWhole": false}, "paneWheeledLater": {"top": 289, "sitedTop": 289, "lit": [], "footerCounts": true, "window": [282, 283, 284, 285…`
- evidence: [019-transcript-scrolled-up--the-pane-follows.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/019-transcript-scrolled-up--the-pane-follows.txt), [020-pane-wheeled--paused.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/020-pane-wheeled--paused.txt), [021-transcript-moved--following-again.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/021-transcript-moved--following-again.txt), [022--chat-toc--the-pane-has-the-keyboard--the-transcript-moved.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/022--chat-toc--the-pane-has-the-keyboard--the-transcript-moved.txt)

### CT-POS-003 · 2.1.295 · pass

- fixture: turns 300
- expected: the lit group is in the pane's window; wheeling the pane pauses: the window leaves the lit group and stays put, the footer still counts; the next move of the transcript follows again; the pane holding the keyboard (/chat-toc) pauses too: the transcript moved past the window, the window stays
- actual: `{"follows": {"top": 285, "sitedTop": 285, "lit": [285], "footerCounts": true, "window": [285, 286, 287, 288, 289, 290], "lastWhole": false}, "paneWheeled": {"top": 285, "sitedTop": 285, "lit": [], "footerCounts": true, "window": [279, 280, 281, 282, 283, 284], "lastWhole": false}, "paneWheeledLater": {"top": 285, "sitedTop": 285, "lit": [], "footerCounts": true, "window": [279, 280, 281, 282, 283…`
- evidence: [019-transcript-scrolled-up--the-pane-follows.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/019-transcript-scrolled-up--the-pane-follows.txt), [020-pane-wheeled--paused.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/020-pane-wheeled--paused.txt), [021-transcript-moved--following-again.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/021-transcript-moved--following-again.txt), [022--chat-toc--the-pane-has-the-keyboard--the-transcript-moved.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/022--chat-toc--the-pane-has-the-keyboard--the-transcript-moved.txt)

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [3.89, 3.95, 4.18], "end": [4.48, 4.14, 4.24]}, "hostReadyS": 0.69, "tocReadyS": 1.3, "tocLagMs": 609, "previewRows": 14, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.17}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.76}, "reachedLast": true, "search": {"keystrokes":…`
- evidence: [debug-heavy-1.log](pty/2.1.287/perf-heavy/debug-heavy-1.log), [001-heavy-1-after-resume.txt](pty/2.1.287/perf-heavy/screens/001-heavy-1-after-resume.txt), [002-heavy-1-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/002-heavy-1-pane-at-its-top.txt), [003-heavy-1-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/003-heavy-1-after-clicking-T0000.txt), [004-heavy-1-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/004-heavy-1-pane-at-its-end.txt), [005-heavy-1-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/005-heavy-1-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [4.48, 4.14, 4.24], "end": [4.54, 4.2, 4.25]}, "hostReadyS": 0.67, "tocReadyS": 1.23, "tocLagMs": 566, "previewRows": 14, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.19}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.74}, "reachedLast": true, "search": {"keystrokes":…`
- evidence: [debug-heavy-2.log](pty/2.1.287/perf-heavy/debug-heavy-2.log), [011-heavy-2-after-resume.txt](pty/2.1.287/perf-heavy/screens/011-heavy-2-after-resume.txt), [012-heavy-2-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/012-heavy-2-pane-at-its-top.txt), [013-heavy-2-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/013-heavy-2-after-clicking-T0000.txt), [014-heavy-2-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/014-heavy-2-pane-at-its-end.txt), [015-heavy-2-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/015-heavy-2-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [4.54, 4.2, 4.25], "end": [5.51, 4.5, 4.36]}, "hostReadyS": 0.7, "tocReadyS": 1.25, "tocLagMs": 546, "previewRows": 14, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.09}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.72}, "reachedLast": true, "search": {"keystrokes": 3…`
- evidence: [debug-heavy-3.log](pty/2.1.287/perf-heavy/debug-heavy-3.log), [021-heavy-3-after-resume.txt](pty/2.1.287/perf-heavy/screens/021-heavy-3-after-resume.txt), [022-heavy-3-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/022-heavy-3-pane-at-its-top.txt), [023-heavy-3-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/023-heavy-3-after-clicking-T0000.txt), [024-heavy-3-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/024-heavy-3-pane-at-its-end.txt), [025-heavy-3-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/025-heavy-3-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [10.65, 5.86, 4.76], "end": [4.0, 4.89, 4.6]}, "hostReadyS": 1.02, "tocReadyS": 1.86, "tocLagMs": 844, "previewRows": 14, "paneToTop": {"batches": 500, "ticks": 10000, "s": 104.23}, "reachedFirst": true, "paneToEnd": {"batches": 405, "ticks": 8100, "s": 84.49}, "reachedLast": true, "search": {"…`
- evidence: [debug-many-1.log](pty/2.1.287/perf-many/debug-many-1.log), [001-many-1-after-resume.txt](pty/2.1.287/perf-many/screens/001-many-1-after-resume.txt), [002-many-1-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/002-many-1-pane-at-its-top.txt), [003-many-1-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/003-many-1-after-clicking-T0000.txt), [004-many-1-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/004-many-1-pane-at-its-end.txt), [005-many-1-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/005-many-1-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [4.0, 4.89, 4.6], "end": [2.95, 3.96, 4.26]}, "hostReadyS": 1.08, "tocReadyS": 1.89, "tocLagMs": 810, "previewRows": 14, "paneToTop": {"batches": 499, "ticks": 9980, "s": 103.8}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 84.56}, "reachedLast": true, "search": {"key…`
- evidence: [debug-many-2.log](pty/2.1.287/perf-many/debug-many-2.log), [011-many-2-after-resume.txt](pty/2.1.287/perf-many/screens/011-many-2-after-resume.txt), [012-many-2-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/012-many-2-pane-at-its-top.txt), [013-many-2-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/013-many-2-after-clicking-T0000.txt), [014-many-2-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/014-many-2-pane-at-its-end.txt), [015-many-2-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/015-many-2-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [2.95, 3.96, 4.26], "end": [3.89, 3.95, 4.18]}, "hostReadyS": 1.02, "tocReadyS": 1.82, "tocLagMs": 795, "previewRows": 14, "paneToTop": {"batches": 497, "ticks": 9940, "s": 103.36}, "reachedFirst": true, "paneToEnd": {"batches": 405, "ticks": 8100, "s": 84.32}, "reachedLast": true, "search": {"…`
- evidence: [debug-many-3.log](pty/2.1.287/perf-many/debug-many-3.log), [021-many-3-after-resume.txt](pty/2.1.287/perf-many/screens/021-many-3-after-resume.txt), [022-many-3-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/022-many-3-pane-at-its-top.txt), [023-many-3-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/023-many-3-after-clicking-T0000.txt), [024-many-3-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/024-many-3-pane-at-its-end.txt), [025-many-3-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/025-many-3-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [3.92, 4.43, 4.67], "end": [3.31, 4.19, 4.56]}, "hostReadyS": 0.68, "tocReadyS": 1.3, "tocLagMs": 620, "previewRows": 13, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.23}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.75}, "reachedLast": true, "search": {"keystrokes":…`
- evidence: [debug-heavy-1.log](pty/2.1.295/perf-heavy/debug-heavy-1.log), [001-heavy-1-after-resume.txt](pty/2.1.295/perf-heavy/screens/001-heavy-1-after-resume.txt), [002-heavy-1-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/002-heavy-1-pane-at-its-top.txt), [003-heavy-1-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/003-heavy-1-after-clicking-T0000.txt), [004-heavy-1-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/004-heavy-1-pane-at-its-end.txt), [005-heavy-1-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/005-heavy-1-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [3.31, 4.19, 4.56], "end": [3.54, 4.1, 4.5]}, "hostReadyS": 0.67, "tocReadyS": 1.23, "tocLagMs": 561, "previewRows": 13, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.22}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.77}, "reachedLast": true, "search": {"keystrokes": …`
- evidence: [debug-heavy-2.log](pty/2.1.295/perf-heavy/debug-heavy-2.log), [011-heavy-2-after-resume.txt](pty/2.1.295/perf-heavy/screens/011-heavy-2-after-resume.txt), [012-heavy-2-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/012-heavy-2-pane-at-its-top.txt), [013-heavy-2-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/013-heavy-2-after-clicking-T0000.txt), [014-heavy-2-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/014-heavy-2-pane-at-its-end.txt), [015-heavy-2-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/015-heavy-2-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [3.54, 4.1, 4.5], "end": [3.91, 4.05, 4.45]}, "hostReadyS": 0.67, "tocReadyS": 1.23, "tocLagMs": 562, "previewRows": 13, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.24}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.7}, "reachedLast": true, "search": {"keystrokes": 3…`
- evidence: [debug-heavy-3.log](pty/2.1.295/perf-heavy/debug-heavy-3.log), [021-heavy-3-after-resume.txt](pty/2.1.295/perf-heavy/screens/021-heavy-3-after-resume.txt), [022-heavy-3-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/022-heavy-3-pane-at-its-top.txt), [023-heavy-3-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/023-heavy-3-after-clicking-T0000.txt), [024-heavy-3-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/024-heavy-3-pane-at-its-end.txt), [025-heavy-3-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/025-heavy-3-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [3.71, 4.18, 4.3], "end": [6.36, 4.94, 4.58]}, "hostReadyS": 1.05, "tocReadyS": 1.87, "tocLagMs": 826, "previewRows": 13, "paneToTop": {"batches": 502, "ticks": 10040, "s": 104.57}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 84.4}, "reachedLast": true, "search": {"k…`
- evidence: [debug-many-1.log](pty/2.1.295/perf-many/debug-many-1.log), [001-many-1-after-resume.txt](pty/2.1.295/perf-many/screens/001-many-1-after-resume.txt), [002-many-1-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/002-many-1-pane-at-its-top.txt), [003-many-1-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/003-many-1-after-clicking-T0000.txt), [004-many-1-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/004-many-1-pane-at-its-end.txt), [005-many-1-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/005-many-1-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [6.36, 4.94, 4.58], "end": [4.54, 5.52, 5.05]}, "hostReadyS": 1.09, "tocReadyS": 1.89, "tocLagMs": 800, "previewRows": 13, "paneToTop": {"batches": 500, "ticks": 10000, "s": 104.12}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 83.78}, "reachedLast": true, "search": {…`
- evidence: [debug-many-2.log](pty/2.1.295/perf-many/debug-many-2.log), [011-many-2-after-resume.txt](pty/2.1.295/perf-many/screens/011-many-2-after-resume.txt), [012-many-2-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/012-many-2-pane-at-its-top.txt), [013-many-2-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/013-many-2-after-clicking-T0000.txt), [014-many-2-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/014-many-2-pane-at-its-end.txt), [015-many-2-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/015-many-2-after-clicking-the-newest.txt) and 6 more

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- expected: the preview open; first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [4.54, 5.52, 5.05], "end": [3.92, 4.43, 4.67]}, "hostReadyS": 1.03, "tocReadyS": 1.88, "tocLagMs": 854, "previewRows": 13, "paneToTop": {"batches": 491, "ticks": 9820, "s": 100.21}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 84.39}, "reachedLast": true, "search": {"…`
- evidence: [debug-many-3.log](pty/2.1.295/perf-many/debug-many-3.log), [021-many-3-after-resume.txt](pty/2.1.295/perf-many/screens/021-many-3-after-resume.txt), [022-many-3-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/022-many-3-pane-at-its-top.txt), [023-many-3-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/023-many-3-after-clicking-T0000.txt), [024-many-3-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/024-many-3-pane-at-its-end.txt), [025-many-3-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/025-many-3-after-clicking-the-newest.txt) and 6 more

### CT-SEC-001 · 2.1.287 · pass

- fixture: turns 6 + one submitted prompt holding a synthetic unique marker
- expected: the marker is drawn in the Pane, typed into the search field (Enter selecting the match), reused into the composer (r) and copied (c) from its row, and appears in none of: chat-toc's $.store file (which holds only viewFilter and layout), its plugin data directory, the debug log's chat-toc lines (CHAT_TOC_PERF on, a jump, a hot reload); the release evidence is scanned for it too (release_gate.py)
- actual: `{"markerSha256": "7167a1f32ad39316", "drawnInPane": true, "inQuery": true, "inComposer": true, "inClipboard": true, "storeFiles": ["plugins/store/chat-toc_inline-8255bb3c209a.json"], "storeKeys": ["layout", "viewFilter"], "pluginDataDirs": [], "leaksInStoreOrData": [], "debugLogChatTocLines": 231, "leaksInChatTocLogLines": 0, "hostLogLinesWithMarker": 0}`
- evidence: [debug-sec-001-chat-toc-lines.log](pty/2.1.287/gate/debug-sec-001-chat-toc-lines.log)

### CT-SEC-001 · 2.1.295 · pass

- fixture: turns 6 + one submitted prompt holding a synthetic unique marker
- expected: the marker is drawn in the Pane, typed into the search field (Enter selecting the match), reused into the composer (r) and copied (c) from its row, and appears in none of: chat-toc's $.store file (which holds only viewFilter and layout), its plugin data directory, the debug log's chat-toc lines (CHAT_TOC_PERF on, a jump, a hot reload); the release evidence is scanned for it too (release_gate.py)
- actual: `{"markerSha256": "15860dfbb3bb7f3c", "drawnInPane": true, "inQuery": true, "inComposer": true, "inClipboard": true, "storeFiles": ["plugins/store/chat-toc_inline-8255bb3c209a.json"], "storeKeys": ["layout", "viewFilter"], "pluginDataDirs": [], "leaksInStoreOrData": [], "debugLogChatTocLines": 232, "leaksInChatTocLogLines": 0, "hostLogLinesWithMarker": 0}`
- evidence: [debug-sec-001-chat-toc-lines.log](pty/2.1.295/gate/debug-sec-001-chat-toc-lines.log)

### CT-COEX-001 · 2.1.287 · pass

- fixture: turns 300
- expected: with /diff in front chat-toc's band draws with ‹ ›, the focus ring not on it and the composer taking the letters typed; chat-toc's tab clicked, the band goes; paused there and Diff in front again, a move of the transcript ends the pause: back in front its first frame lights and shows the view's group
- actual: `{"diffInFront": true, "band": {"row": "☰ ChatTOC  ‹ ›  │  用户 301 轮 · Agent 552 步 · 上下文已用 0%   展开目录 ❯                [-]│", "ringOnBand": false, "composerTyped": true}, "bandGoneInFront": true, "pausedBefore": {"top": 290, "sitedTop": 290, "lit": [], "footerCounts": true, "window": [283, 284, 285, 286, 287, 288, 289], "lastWhole": false}, "tocBehind": true, "back": {"top": 285, "sitedTop": 285, "l…`
- evidence: [023--diff-opened-in-front.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/023--diff-opened-in-front.txt), [024-chat-toc-in-front--paused.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/024-chat-toc-in-front--paused.txt), [025-Diff-in-front-again.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/025-Diff-in-front-again.txt), [026-chat-toc-tab-clicked--in-front-again.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/026-chat-toc-tab-clicked--in-front-again.txt)

### CT-COEX-001 · 2.1.295 · pass

- fixture: turns 300
- expected: with /diff in front chat-toc's band draws with ‹ ›, the focus ring not on it and the composer taking the letters typed; chat-toc's tab clicked, the band goes; paused there and Diff in front again, a move of the transcript ends the pause: back in front its first frame lights and shows the view's group
- actual: `{"diffInFront": true, "band": {"row": "☰ ChatTOC  ‹ ›  │  用户 301 轮 · Agent 552 步 · 上下文已用 0%   展开目录 ❯               [-] │", "ringOnBand": false, "composerTyped": true}, "bandGoneInFront": true, "pausedBefore": {"top": 289, "sitedTop": 289, "lit": [], "footerCounts": true, "window": [282, 283, 284, 285, 286, 287, 288], "lastWhole": false}, "tocBehind": true, "back": {"top": 284, "sitedTop": 284, "l…`
- evidence: [023--diff-opened-in-front.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/023--diff-opened-in-front.txt), [024-chat-toc-in-front--paused.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/024-chat-toc-in-front--paused.txt), [025-Diff-in-front-again.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/025-Diff-in-front-again.txt), [026-chat-toc-tab-clicked--in-front-again.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/026-chat-toc-tab-clicked--in-front-again.txt)

### CT-CMPCT-001 · 2.1.287 · pass

- fixture: fixture
- expected: rules as the verifier places them: manual after the /compact entry, auto at a submit before its group, mid-turn after its group, three in a row as one ×3 rule; in card, compact and timeline and under All, User and Agent; with the query 合成 between its matches K00, K01, K04, K05, the two before K04 as one ×2 rule; no fork line in a file holding the whole conversation
- actual: `{"card all": {"ok": true, "filter": "all", "layout": "卡片", "expected": [{"before": 2, "text": "已压缩 09:00"}, {"before": 3, "text": "自动压缩 09:01"}, {"before": 5, "text": "自动压缩 09:01"}, {"before": 6, "text": "自动压缩 ×3 · 09:03"}], "actual": [{"text": "已压缩 09:00", "before": 2}, {"text": "自动压缩 09:01", "before": 3}, {"text": "自动压缩 09:01", "before": 5}, {"text": "自动压缩 ×3 · 09:03", "before": 6}], "allListed…`
- evidence: [001-card--All.txt](pty/2.1.287/compaction/screens/001-card--All.txt), [002-compact--All.txt](pty/2.1.287/compaction/screens/002-compact--All.txt), [003-timeline--All.txt](pty/2.1.287/compaction/screens/003-timeline--All.txt), [004-card--User.txt](pty/2.1.287/compaction/screens/004-card--User.txt), [005-card--Agent.txt](pty/2.1.287/compaction/screens/005-card--Agent.txt), [006-card--All--query-合成.txt](pty/2.1.287/compaction/screens/006-card--All--query-合成.txt)

### CT-CMPCT-001 · 2.1.287 · pass

- fixture: fork
- expected: a file starting at a boundary whose parent it does not hold shows 更早的轮次不在本会话的文件里 at the list's top, above the first rule
- actual: `{"expectedForkLine": true, "forkLine": true, "forkLineAboveRule": true, "rules": {"ok": true, "expected": [{"before": 1, "text": "已压缩 09:00"}], "actual": [{"text": "已压缩 09:00", "before": 1}], "windowStart": 0}}`
- evidence: [007-a-file-starting-at-a-foreign-boundary.txt](pty/2.1.287/compaction/screens/007-a-file-starting-at-a-foreign-boundary.txt)

### CT-CMPCT-001 · 2.1.295 · pass

- fixture: fixture
- expected: rules as the verifier places them: manual after the /compact entry, auto at a submit before its group, mid-turn after its group, three in a row as one ×3 rule; in card, compact and timeline and under All, User and Agent; with the query 合成 between its matches K00, K01, K04, K05, the two before K04 as one ×2 rule; no fork line in a file holding the whole conversation
- actual: `{"card all": {"ok": true, "filter": "all", "layout": "卡片", "expected": [{"before": 2, "text": "已压缩 09:00"}, {"before": 3, "text": "自动压缩 09:01"}, {"before": 5, "text": "自动压缩 09:01"}, {"before": 6, "text": "自动压缩 ×3 · 09:03"}], "actual": [{"text": "已压缩 09:00", "before": 2}, {"text": "自动压缩 09:01", "before": 3}, {"text": "自动压缩 09:01", "before": 5}, {"text": "自动压缩 ×3 · 09:03", "before": 6}], "allListed…`
- evidence: [001-card--All.txt](pty/2.1.295/compaction/screens/001-card--All.txt), [002-compact--All.txt](pty/2.1.295/compaction/screens/002-compact--All.txt), [003-timeline--All.txt](pty/2.1.295/compaction/screens/003-timeline--All.txt), [004-card--User.txt](pty/2.1.295/compaction/screens/004-card--User.txt), [005-card--Agent.txt](pty/2.1.295/compaction/screens/005-card--Agent.txt), [006-card--All--query-合成.txt](pty/2.1.295/compaction/screens/006-card--All--query-合成.txt)

### CT-CMPCT-001 · 2.1.295 · pass

- fixture: fork
- expected: a file starting at a boundary whose parent it does not hold shows 更早的轮次不在本会话的文件里 at the list's top, above the first rule
- actual: `{"expectedForkLine": true, "forkLine": true, "forkLineAboveRule": true, "rules": {"ok": true, "expected": [{"before": 1, "text": "已压缩 09:00"}], "actual": [{"text": "已压缩 09:00", "before": 1}], "windowStart": 0}}`
- evidence: [007-a-file-starting-at-a-foreign-boundary.txt](pty/2.1.295/compaction/screens/007-a-file-starting-at-a-foreign-boundary.txt)

### CT-CTX-001 · 2.1.287 · pass

- fixture: live
- expected: no context use before the first response; 上下文已用 62% after it; hidden at /compact, whose rule goes after the /compact entry (verifier); 上下文已用 47% with the next response; the band says it once the Pane is closed; at 36 columns in the timeline Layout the footer says 已用 47%
- actual: `{"beforeFirstResponse": true, "afterFirstResponse": "1 轮 · 上下文已用 62%", "afterCompact": "2 轮", "hiddenAfterCompact": true, "compactRule": {"ok": true, "expected": [{"before": 2, "text": "已压缩 17:38"}], "actual": [{"text": "已压缩 17:38", "before": 2}], "windowStart": 0}, "ruleAfterCompactEntry": true, "afterNextResponse": "3 轮 · 上下文已用 47%", "band": "☰ ChatTOC  ‹ ›  │  用户 3 轮 · Agent 0 步 · 上下文已用 47%   …`
- evidence: [008-ctx-before-the-first-response.txt](pty/2.1.287/compaction/screens/008-ctx-before-the-first-response.txt), [009-ctx-after-the-first-response.txt](pty/2.1.287/compaction/screens/009-ctx-after-the-first-response.txt), [010-ctx-after--compact.txt](pty/2.1.287/compaction/screens/010-ctx-after--compact.txt), [011-ctx-back-with-the-next-response.txt](pty/2.1.287/compaction/screens/011-ctx-back-with-the-next-response.txt), [012-ctx-in-the-band.txt](pty/2.1.287/compaction/screens/012-ctx-in-the-band.txt), [013-ctx-timeline-at-44-columns.txt](pty/2.1.287/compaction/screens/013-ctx-timeline-at-44-columns.txt) and 1 more

### CT-CTX-001 · 2.1.295 · pass

- fixture: live
- expected: no context use before the first response; 上下文已用 62% after it; hidden at /compact, whose rule goes after the /compact entry (verifier); 上下文已用 47% with the next response; the band says it once the Pane is closed; at 36 columns in the timeline Layout the footer says 已用 47%
- actual: `{"beforeFirstResponse": true, "afterFirstResponse": "1 轮 · 上下文已用 62%", "afterCompact": "2 轮", "hiddenAfterCompact": true, "compactRule": {"ok": true, "expected": [{"before": 2, "text": "已压缩 17:02"}], "actual": [{"text": "已压缩 17:02", "before": 2}], "windowStart": 0}, "ruleAfterCompactEntry": true, "afterNextResponse": "3 轮 · 上下文已用 47%", "band": "☰ ChatTOC  ‹ ›  │  用户 3 轮 · Agent 0 步 · 上下文已用 47%   …`
- evidence: [008-ctx-before-the-first-response.txt](pty/2.1.295/compaction/screens/008-ctx-before-the-first-response.txt), [009-ctx-after-the-first-response.txt](pty/2.1.295/compaction/screens/009-ctx-after-the-first-response.txt), [010-ctx-after--compact.txt](pty/2.1.295/compaction/screens/010-ctx-after--compact.txt), [011-ctx-back-with-the-next-response.txt](pty/2.1.295/compaction/screens/011-ctx-back-with-the-next-response.txt), [012-ctx-in-the-band.txt](pty/2.1.295/compaction/screens/012-ctx-in-the-band.txt), [013-ctx-timeline-at-44-columns.txt](pty/2.1.295/compaction/screens/013-ctx-timeline-at-44-columns.txt) and 1 more

### CT-PREV-001 · 2.1.287 · pass

- fixture: V fixture (8 groups), then one submit (not logged in: no model call)
- expected: no preview at the start nor while ↑ moves the ring; Enter on the ring's entry selects it (its row `p: 预览 · …` under it, the preview still closed), p opens it on that group and the row goes, and ↑ leaves it there; a click on another entry moves it there; scrolling the transcript (the lit group moves), a switch to 用户 and a new turn leave it on the group clicked
- actual: `{"atStart": {"closed": true}, "ringMovesClosed": [{"ring": null, "closed": true}, {"ring": "V07", "closed": true}, {"ring": "V07", "closed": true}], "enter": {"ring": "V07", "selected": "V07", "actions": ["p: 预览", "r: 填入", "c: 复制"], "closed": true}, "p": {"preview": "V07", "rowGone": true}, "ringMovesOpen": ["V07", "V07"], "click": {"pressed": "V05", "preview": "V05"}, "scrolled": {"litBefore": "…`
- evidence: [001-press-at-start.txt](pty/2.1.287/ct-preview/screens/001-press-at-start.txt), [002-press-Enter-on-V07.txt](pty/2.1.287/ct-preview/screens/002-press-Enter-on-V07.txt), [003-press-p-on-V07.txt](pty/2.1.287/ct-preview/screens/003-press-p-on-V07.txt), [004-press-click-on-V05.txt](pty/2.1.287/ct-preview/screens/004-press-click-on-V05.txt), [005-press-transcript-scrolled.txt](pty/2.1.287/ct-preview/screens/005-press-transcript-scrolled.txt), [006-press-after-a-new-turn.txt](pty/2.1.287/ct-preview/screens/006-press-after-a-new-turn.txt)

### CT-PREV-001 · 2.1.287 · pass

- fixture: V fixture
- expected: p and a click on the rule's ✕ close the preview; the Pane closed by its ✕ and opened by /chat-toc draws no preview, nor does a new process; the store has no preview field
- actual: `{"p": true, "closeMark": true, "reopened": {"closed": true}, "store": {}, "newProcess": {"closed": true}}`
- evidence: [007-close-by-p.txt](pty/2.1.287/ct-preview/screens/007-close-by-p.txt), [008-close-reopened-by-a-press.txt](pty/2.1.287/ct-preview/screens/008-close-reopened-by-a-press.txt), [009-close-the-Pane-opened-again.txt](pty/2.1.287/ct-preview/screens/009-close-the-Pane-opened-again.txt), [010-close-new-process.txt](pty/2.1.287/ct-preview/screens/010-close-new-process.txt)

### CT-PREV-001 · 2.1.287 · pass

- fixture: V fixture: V00 (4 steps, turn_duration 150 s + 50 s, output 100 + 1200 under one id twice + 40 + 300), V01 (no usage, no turn_duration); each opened by a click on its entry and its `p: 预览`
- expected: {'meta': {'V00': '10月9日 09:00 · 4 步 · 3 分 20 秒 · 输出 1.6k', 'V01': '10月9日 09:01'}, 'files': '改 hooks/pane.tsx, hooks/new.ts, hooks/text.ts, ~/notes/todo.md (a prefix, the rest as +N) · 读 1'}
- actual: `{"V01": {"meta": "10月9日 09:01", "rows": ["10月9日 09:01", "用户                                   r: 填入 · c: 复制", "V01 没有用量也没有时长", "Agent                                            a: 复制", "V01 回复"]}, "V00": {"meta": "10月9日 09:00 · 4 步 · 3 分 20 秒 · 输出 1.6k", "rows": ["10月9日 09:00 · 4 步 · 3 分 20 秒 · 输出 1.6k", "用户                                   r: 填入 · c: 复制", "V00 改几个文件", "Agent                    …`
- evidence: [011-facts-V01.txt](pty/2.1.287/ct-preview/screens/011-facts-V01.txt), [012-facts-V00.txt](pty/2.1.287/ct-preview/screens/012-facts-V00.txt)

### CT-PREV-001 · 2.1.287 · pass

- fixture: V fixture: V02's reply of 40 lines, opened by a click and `p: 预览`
- expected: the region shows the reply's first lines and ends in `↓ 还有 N 行 · e: 展开` with N the lines not shown
- actual: `{"rows": ["10月9日 09:01 · 9 秒 · 输出 2k", "用户                       r: 填入 · c: 复制", "V02 很长的回复", "Agent                                a: 复制", "V02 第 0 行", "V02 第 1 行", "V02 第 2 行", "V02 第 3 行", "V02 第 4 行", "V02 第 5 行", "V02 第 6 行", "V02 第 7 行", "↓ 还有 32 行 · e: 展开"], "regionRows": 14, "cutLine": "↓ 还有 32 行 · e: 展开"}`
- evidence: [013-cut-V02.txt](pty/2.1.287/ct-preview/screens/013-cut-V02.txt)

### CT-PREV-001 · 2.1.287 · pass

- fixture: V fixture, the preview opened on V07, the terminal from 44 lines down to 14
- expected: the Minimap leaves first, then the region shrinks down to 4 rows, then the preview is drawn expanded; while the region shows, the list keeps 8 rows; at the tallest of those heights `e: ← 返回` closes it, and a press on an entry selects it (still closed) and its `p: 预览` opens the preview expanded
- actual: `{"heights": [{"minimap": true, "region": 14, "expanded": false, "listRows": 17, "lines": 44}, {"minimap": true, "region": 13, "expanded": false, "listRows": 17, "lines": 43}, {"minimap": true, "region": 13, "expanded": false, "listRows": 16, "lines": 42}, {"minimap": true, "region": 12, "expanded": false, "listRows": 16, "lines": 41}, {"minimap": true, "region": 12, "expanded": false, "listRows":…`
- evidence: [014-short-44-lines.txt](pty/2.1.287/ct-preview/screens/014-short-44-lines.txt), [015-short-43-lines.txt](pty/2.1.287/ct-preview/screens/015-short-43-lines.txt), [016-short-42-lines.txt](pty/2.1.287/ct-preview/screens/016-short-42-lines.txt), [017-short-41-lines.txt](pty/2.1.287/ct-preview/screens/017-short-41-lines.txt), [018-short-40-lines.txt](pty/2.1.287/ct-preview/screens/018-short-40-lines.txt), [019-short-39-lines.txt](pty/2.1.287/ct-preview/screens/019-short-39-lines.txt) and 27 more

### CT-PREV-001 · 2.1.287 · pass

- fixture: V fixture, the preview opened on V05
- expected: in 卡片, 紧凑 and 时间轴 at 36, 44 and 56 columns the region's rule `─ 预览 ─── p: ✕` spans the Pane, the meta line shows under it, the footer below it, and it stays on V05
- actual: `{"36-卡片": {"paneColumns": 36, "rule": "─ 预览 ──────────────────────── p: ✕", "meta": "10月9日 09:02 · <1 秒 · 输出 20", "input": "V05", "footer": "8 轮 · 上下文已用 45%", "ruleCells": 36}, "36-紧凑": {"paneColumns": 36, "rule": "─ 预览 ──────────────────────── p: ✕", "meta": "10月9日 09:02 · <1 秒 · 输出 20", "input": "V05", "footer": "8 轮 · 上下文已用 45%", "ruleCells": 36}, "36-时间轴": {"paneColumns": 36, "rule": "─ 预览 ──…`
- evidence: [047-widths-36-卡片.txt](pty/2.1.287/ct-preview/screens/047-widths-36-卡片.txt), [048-widths-36-紧凑.txt](pty/2.1.287/ct-preview/screens/048-widths-36-紧凑.txt), [049-widths-36-时间轴.txt](pty/2.1.287/ct-preview/screens/049-widths-36-时间轴.txt), [050-widths-56-卡片.txt](pty/2.1.287/ct-preview/screens/050-widths-56-卡片.txt), [051-widths-56-紧凑.txt](pty/2.1.287/ct-preview/screens/051-widths-56-紧凑.txt), [052-widths-56-时间轴.txt](pty/2.1.287/ct-preview/screens/052-widths-56-时间轴.txt) and 3 more

### CT-PREV-001 · 2.1.295 · pass

- fixture: V fixture (8 groups), then one submit (not logged in: no model call)
- expected: no preview at the start nor while ↑ moves the ring; Enter on the ring's entry selects it (its row `p: 预览 · …` under it, the preview still closed), p opens it on that group and the row goes, and ↑ leaves it there; a click on another entry moves it there; scrolling the transcript (the lit group moves), a switch to 用户 and a new turn leave it on the group clicked
- actual: `{"atStart": {"closed": true}, "ringMovesClosed": [{"ring": null, "closed": true}, {"ring": "V07", "closed": true}, {"ring": "V07", "closed": true}], "enter": {"ring": "V07", "selected": "V07", "actions": ["p: 预览", "r: 填入", "c: 复制"], "closed": true}, "p": {"preview": "V07", "rowGone": true}, "ringMovesOpen": ["V07", "V07"], "click": {"pressed": "V05", "preview": "V05"}, "scrolled": {"litBefore": "…`
- evidence: [001-press-at-start.txt](pty/2.1.295/ct-preview/screens/001-press-at-start.txt), [002-press-Enter-on-V07.txt](pty/2.1.295/ct-preview/screens/002-press-Enter-on-V07.txt), [003-press-p-on-V07.txt](pty/2.1.295/ct-preview/screens/003-press-p-on-V07.txt), [004-press-click-on-V05.txt](pty/2.1.295/ct-preview/screens/004-press-click-on-V05.txt), [005-press-transcript-scrolled.txt](pty/2.1.295/ct-preview/screens/005-press-transcript-scrolled.txt), [006-press-after-a-new-turn.txt](pty/2.1.295/ct-preview/screens/006-press-after-a-new-turn.txt)

### CT-PREV-001 · 2.1.295 · pass

- fixture: V fixture
- expected: p and a click on the rule's ✕ close the preview; the Pane closed by its ✕ and opened by /chat-toc draws no preview, nor does a new process; the store has no preview field
- actual: `{"p": true, "closeMark": true, "reopened": {"closed": true}, "store": {}, "newProcess": {"closed": true}}`
- evidence: [007-close-by-p.txt](pty/2.1.295/ct-preview/screens/007-close-by-p.txt), [008-close-reopened-by-a-press.txt](pty/2.1.295/ct-preview/screens/008-close-reopened-by-a-press.txt), [009-close-the-Pane-opened-again.txt](pty/2.1.295/ct-preview/screens/009-close-the-Pane-opened-again.txt), [010-close-new-process.txt](pty/2.1.295/ct-preview/screens/010-close-new-process.txt)

### CT-PREV-001 · 2.1.295 · pass

- fixture: V fixture: V00 (4 steps, turn_duration 150 s + 50 s, output 100 + 1200 under one id twice + 40 + 300), V01 (no usage, no turn_duration); each opened by a click on its entry and its `p: 预览`
- expected: {'meta': {'V00': '10月9日 09:00 · 4 步 · 3 分 20 秒 · 输出 1.6k', 'V01': '10月9日 09:01'}, 'files': '改 hooks/pane.tsx, hooks/new.ts, hooks/text.ts, ~/notes/todo.md (a prefix, the rest as +N) · 读 1'}
- actual: `{"V01": {"meta": "10月9日 09:01", "rows": ["10月9日 09:01", "用户                                   r: 填入 · c: 复制", "V01 没有用量也没有时长", "Agent                                            a: 复制", "V01 回复"]}, "V00": {"meta": "10月9日 09:00 · 4 步 · 3 分 20 秒 · 输出 1.6k", "rows": ["10月9日 09:00 · 4 步 · 3 分 20 秒 · 输出 1.6k", "用户                                   r: 填入 · c: 复制", "V00 改几个文件", "Agent                    …`
- evidence: [011-facts-V01.txt](pty/2.1.295/ct-preview/screens/011-facts-V01.txt), [012-facts-V00.txt](pty/2.1.295/ct-preview/screens/012-facts-V00.txt)

### CT-PREV-001 · 2.1.295 · pass

- fixture: V fixture: V02's reply of 40 lines, opened by a click and `p: 预览`
- expected: the region shows the reply's first lines and ends in `↓ 还有 N 行 · e: 展开` with N the lines not shown
- actual: `{"rows": ["10月9日 09:01 · 9 秒 · 输出 2k", "用户                       r: 填入 · c: 复制", "V02 很长的回复", "Agent                                a: 复制", "V02 第 0 行", "V02 第 1 行", "V02 第 2 行", "V02 第 3 行", "V02 第 4 行", "V02 第 5 行", "V02 第 6 行", "↓ 还有 33 行 · e: 展开"], "regionRows": 13, "cutLine": "↓ 还有 33 行 · e: 展开"}`
- evidence: [013-cut-V02.txt](pty/2.1.295/ct-preview/screens/013-cut-V02.txt)

### CT-PREV-001 · 2.1.295 · pass

- fixture: V fixture, the preview opened on V07, the terminal from 44 lines down to 14
- expected: the Minimap leaves first, then the region shrinks down to 4 rows, then the preview is drawn expanded; while the region shows, the list keeps 8 rows; at the tallest of those heights `e: ← 返回` closes it, and a press on an entry selects it (still closed) and its `p: 预览` opens the preview expanded
- actual: `{"heights": [{"minimap": true, "region": 13, "expanded": false, "listRows": 17, "lines": 44}, {"minimap": true, "region": 13, "expanded": false, "listRows": 16, "lines": 43}, {"minimap": true, "region": 12, "expanded": false, "listRows": 16, "lines": 42}, {"minimap": true, "region": 12, "expanded": false, "listRows": 15, "lines": 41}, {"minimap": true, "region": 12, "expanded": false, "listRows":…`
- evidence: [014-short-44-lines.txt](pty/2.1.295/ct-preview/screens/014-short-44-lines.txt), [015-short-43-lines.txt](pty/2.1.295/ct-preview/screens/015-short-43-lines.txt), [016-short-42-lines.txt](pty/2.1.295/ct-preview/screens/016-short-42-lines.txt), [017-short-41-lines.txt](pty/2.1.295/ct-preview/screens/017-short-41-lines.txt), [018-short-40-lines.txt](pty/2.1.295/ct-preview/screens/018-short-40-lines.txt), [019-short-39-lines.txt](pty/2.1.295/ct-preview/screens/019-short-39-lines.txt) and 27 more

### CT-PREV-001 · 2.1.295 · pass

- fixture: V fixture, the preview opened on V05
- expected: in 卡片, 紧凑 and 时间轴 at 36, 44 and 56 columns the region's rule `─ 预览 ─── p: ✕` spans the Pane, the meta line shows under it, the footer below it, and it stays on V05
- actual: `{"36-卡片": {"paneColumns": 36, "rule": "─ 预览 ──────────────────────── p: ✕", "meta": "10月9日 09:02 · <1 秒 · 输出 20", "input": "V05", "footer": "8 轮 · 上下文已用 45%", "ruleCells": 36}, "36-紧凑": {"paneColumns": 36, "rule": "─ 预览 ──────────────────────── p: ✕", "meta": "10月9日 09:02 · <1 秒 · 输出 20", "input": "V05", "footer": "8 轮 · 上下文已用 45%", "ruleCells": 36}, "36-时间轴": {"paneColumns": 36, "rule": "─ 预览 ──…`
- evidence: [047-widths-36-卡片.txt](pty/2.1.295/ct-preview/screens/047-widths-36-卡片.txt), [048-widths-36-紧凑.txt](pty/2.1.295/ct-preview/screens/048-widths-36-紧凑.txt), [049-widths-36-时间轴.txt](pty/2.1.295/ct-preview/screens/049-widths-36-时间轴.txt), [050-widths-56-卡片.txt](pty/2.1.295/ct-preview/screens/050-widths-56-卡片.txt), [051-widths-56-紧凑.txt](pty/2.1.295/ct-preview/screens/051-widths-56-紧凑.txt), [052-widths-56-时间轴.txt](pty/2.1.295/ct-preview/screens/052-widths-56-时间轴.txt) and 3 more

### CT-PREV-002 · 2.1.287 · pass

- fixture: V fixture: V02's reply of 40 lines, opened by a click and `p: 预览`, the Pane focused
- expected: e expands the preview over the list (the filter row kept, the Back Button `e: ← 返回` at its top with `p: ✕`, no entry); the host scrolls the whole tree: 5 wheel ticks, PgDn to the end with the footer, PgUp to the top, ↓ one row; e with the Back Button scrolled away, a click on it, and Esc each return to the list with its head at the top; p closes it from the expanded view
- actual: `{"expanded": {"back": true, "close": true, "entries": false, "first": "1: 全部   2: 用户   3: Agent               ✕", "filterRow": true, "replyLines": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], "footer": false}, "expandedRows": ["1: 全部   2: 用户   3: Agent               ✕", "━━━━━━━─────────────────────────────────────", "f: 搜索 词或…`
- evidence: [056-expand-expanded.txt](pty/2.1.287/ct-preview/screens/056-expand-expanded.txt), [057-expand-wheel-down.txt](pty/2.1.287/ct-preview/screens/057-expand-wheel-down.txt), [058-expand-pgdn.txt](pty/2.1.287/ct-preview/screens/058-expand-pgdn.txt), [059-expand-down.txt](pty/2.1.287/ct-preview/screens/059-expand-down.txt), [060-expand-e-again.txt](pty/2.1.287/ct-preview/screens/060-expand-e-again.txt), [061-expand-back-pressed.txt](pty/2.1.287/ct-preview/screens/061-expand-back-pressed.txt) and 2 more

### CT-PREV-002 · 2.1.287 · pass

- fixture: P fixture: P01's input a paste of 4,000 lines (about 200,000 characters), a short reply
- expected: opened by a click and `p: 预览`, then expanded, the input starts whole at the top; at the end (End) it stops early with `… 还有 N 字未显示 · c: 复制` (N about 140,000), the reply and the footer drawn after it
- actual: `{"pasted": 207999, "top": ["1: 全部   2: 用户   3: Agent               ✕", "━━━━━━━─────────────────────────────────────", "f: 搜索 词或文件路径                     ‹ ›", "e: ← 返回                               p: ✕", "10月9日 09:00 · 输出 20", "用户                       r: 填入 · c: 复制", "P01 pasted line 0000", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"], "bottom": ["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "P01 pasted line 1151", "…`
- evidence: [064-cap-region.txt](pty/2.1.287/ct-preview/screens/064-cap-region.txt), [065-cap-expanded-top.txt](pty/2.1.287/ct-preview/screens/065-cap-expanded-top.txt), [066-cap-expanded-end.txt](pty/2.1.287/ct-preview/screens/066-cap-expanded-end.txt)

### CT-PREV-002 · 2.1.287 · pass

- fixture: V fixture + one live turn against fake_api.py (two Read steps, 4 s apart; no model)
- expected: a press on the running group's entry and its `p: 预览` open it, a click on its cut line expands it; still expanded, its meta line goes 进行中 · 1 步, 进行中 · 2 步, then 2 步 with the closing text 完成 under Agent
- actual: `{"final": ["1: 全部   2: 用户   3: Agent               ✕", "━━━━━━━─────────────────────────────────────", "f: 搜索 词或文件路径                     ‹ ›", "e: ← 返回                               p: ✕", "10月17日 17:50 · 2 步 · 9 秒 · 输出 15", "用户                       r: 填入 · c: 复制", "CT-PREV-002 进行中的合成一轮", "很长的输入用来让预览区切掉它，很长的输入用来", "让预览区切掉它，很长的输入用来让预览区切掉它", "，很长的输入用来让预览区切掉它，很长的输入用", "来让预览区切掉它，很长的输入用来让预览区切掉", "它，很…`
- evidence: [067-running-10月17日-17-50---进行中---1-步---输出-5.txt](pty/2.1.287/ct-preview/screens/067-running-10月17日-17-50---进行中---1-步---输出-5.txt), [068-running-10月17日-17-50---进行中---2-步---输出-10.txt](pty/2.1.287/ct-preview/screens/068-running-10月17日-17-50---进行中---2-步---输出-10.txt), [069-running-10月17日-17-50---2-步---9-秒---输出-15.txt](pty/2.1.287/ct-preview/screens/069-running-10月17日-17-50---2-步---9-秒---输出-15.txt)

### CT-PREV-002 · 2.1.295 · pass

- fixture: V fixture: V02's reply of 40 lines, opened by a click and `p: 预览`, the Pane focused
- expected: e expands the preview over the list (the filter row kept, the Back Button `e: ← 返回` at its top with `p: ✕`, no entry); the host scrolls the whole tree: 5 wheel ticks, PgDn to the end with the footer, PgUp to the top, ↓ one row; e with the Back Button scrolled away, a click on it, and Esc each return to the list with its head at the top; p closes it from the expanded view
- actual: `{"expanded": {"back": true, "close": true, "entries": false, "first": "✕", "filterRow": true, "replyLines": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29], "footer": false}, "expandedRows": ["                                          ✕", "1: 全部   2: 用户   3: Agent", "━━━━━━━─────────────────────────────────────", "f: 搜索 词或文件路径        …`
- evidence: [056-expand-expanded.txt](pty/2.1.295/ct-preview/screens/056-expand-expanded.txt), [057-expand-wheel-down.txt](pty/2.1.295/ct-preview/screens/057-expand-wheel-down.txt), [058-expand-pgdn.txt](pty/2.1.295/ct-preview/screens/058-expand-pgdn.txt), [059-expand-down.txt](pty/2.1.295/ct-preview/screens/059-expand-down.txt), [060-expand-e-again.txt](pty/2.1.295/ct-preview/screens/060-expand-e-again.txt), [061-expand-back-pressed.txt](pty/2.1.295/ct-preview/screens/061-expand-back-pressed.txt) and 2 more

### CT-PREV-002 · 2.1.295 · pass

- fixture: P fixture: P01's input a paste of 4,000 lines (about 200,000 characters), a short reply
- expected: opened by a click and `p: 预览`, then expanded, the input starts whole at the top; at the end (End) it stops early with `… 还有 N 字未显示 · c: 复制` (N about 140,000), the reply and the footer drawn after it
- actual: `{"pasted": 207999, "top": ["✕", "1: 全部   2: 用户   3: Agent", "━━━━━━━─────────────────────────────────────", "f: 搜索 词或文件路径                     ‹ ›", "e: ← 返回                               p: ✕", "10月9日 09:00 · 输出 20", "用户                       r: 填入 · c: 复制", "P01 pasted line 0000"], "bottom": ["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "P01 pasted line 1151", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "P01 pasted …`
- evidence: [064-cap-region.txt](pty/2.1.295/ct-preview/screens/064-cap-region.txt), [065-cap-expanded-top.txt](pty/2.1.295/ct-preview/screens/065-cap-expanded-top.txt), [066-cap-expanded-end.txt](pty/2.1.295/ct-preview/screens/066-cap-expanded-end.txt)

### CT-PREV-002 · 2.1.295 · pass

- fixture: V fixture + one live turn against fake_api.py (two Read steps, 4 s apart; no model)
- expected: a press on the running group's entry and its `p: 预览` open it, a click on its cut line expands it; still expanded, its meta line goes 进行中 · 1 步, 进行中 · 2 步, then 2 步 with the closing text 完成 under Agent
- actual: `{"final": ["✕", "1: 全部   2: 用户   3: Agent", "━━━━━━━─────────────────────────────────────", "f: 搜索 词或文件路径                     ‹ ›", "e: ← 返回                               p: ✕", "10月17日 17:14 · 2 步 · 9 秒 · 输出 15", "用户                       r: 填入 · c: 复制", "CT-PREV-002 进行中的合成一轮", "很长的输入用来让预览区切掉它，很长的输入用来", "让预览区切掉它，很长的输入用来让预览区切掉它", "，很长的输入用来让预览区切掉它，很长的输入用", "来让预览区切掉它，很长的输入用来让预览区切掉", "它，很长的输入用来让预览区切…`
- evidence: [067-running-10月17日-17-14---进行中---1-步---输出-5.txt](pty/2.1.295/ct-preview/screens/067-running-10月17日-17-14---进行中---1-步---输出-5.txt), [068-running-10月17日-17-14---进行中---2-步---输出-10.txt](pty/2.1.295/ct-preview/screens/068-running-10月17日-17-14---进行中---2-步---输出-10.txt), [069-running-10月17日-17-14---2-步---9-秒---输出-15.txt](pty/2.1.295/ct-preview/screens/069-running-10月17日-17-14---2-步---9-秒---输出-15.txt)

### CT-FIND-001 · 2.1.287 · pass

- fixture: S fixture
- expected: idle: the placeholder, no count, no ✕; each query lists the groups holding every word with the count `N / 8` and ✕: login→S00 (path), S01; `LOGIN fixed`→S01 (AND, case); 登录, 录页→S00 (CJK); `full width`→S03 (NFKC); src/loginpage→S00 (path); nowhere→none, 没有匹配的轮次
- actual: `{"idle": {"text": "", "count": null, "clear": false, "focused": false, "step": true}, "login": {"listed": ["S00", "S01"], "search": {"text": "login", "count": "2 / 8", "clear": true, "focused": true, "step": true}, "notes": []}, "LOGIN fixed": {"listed": ["S01"], "search": {"text": "LOGIN fixed", "count": "1 / 8", "clear": true, "focused": true, "step": true}, "notes": []}, "登录": {"listed": ["S00…`
- evidence: [001-narrow-login.txt](pty/2.1.287/ct-search/screens/001-narrow-login.txt), [002-narrow-LOGIN-fixed.txt](pty/2.1.287/ct-search/screens/002-narrow-LOGIN-fixed.txt), [003-narrow-登录.txt](pty/2.1.287/ct-search/screens/003-narrow-登录.txt), [004-narrow-录页.txt](pty/2.1.287/ct-search/screens/004-narrow-录页.txt), [005-narrow-full-width.txt](pty/2.1.287/ct-search/screens/005-narrow-full-width.txt), [006-narrow-src-loginpage.txt](pty/2.1.287/ct-search/screens/006-narrow-src-loginpage.txt) and 1 more

### CT-FIND-001 · 2.1.287 · pass

- fixture: S fixture
- expected: the View filter picks the fields: fixed (reply) and loginpage (path) match under 全部 and Agent, not 用户; readme (input and path) under all three; 修改 (input only) under 全部 and 用户, not Agent
- actual: `{"fixed 全部": {"listed": ["S01"], "count": "1 / 8", "filter": "all"}, "fixed 用户": {"listed": [], "count": "0 / 8", "filter": "user"}, "fixed Agent": {"listed": ["S01"], "count": "1 / 8", "filter": "agent"}, "loginpage 全部": {"listed": ["S00"], "count": "1 / 8", "filter": "all"}, "loginpage 用户": {"listed": [], "count": "0 / 8", "filter": "user"}, "loginpage Agent": {"listed": ["S00"], "count": "1 / …`
- evidence: [008-filter-fixed.txt](pty/2.1.287/ct-search/screens/008-filter-fixed.txt), [009-filter-loginpage.txt](pty/2.1.287/ct-search/screens/009-filter-loginpage.txt), [010-filter-readme.txt](pty/2.1.287/ct-search/screens/010-filter-readme.txt), [011-filter-修改.txt](pty/2.1.287/ct-search/screens/011-filter-修改.txt)

### CT-FIND-001 · 2.1.287 · pass

- fixture: S fixture + a prompt submitted while 登录 is the query
- expected: the new matching group S08 joins the list and the count goes from 1 / 8 to 2 / 9; the query stays
- actual: `{"before": {"listed": ["S00"], "count": "1 / 8"}, "after": {"listed": ["S00", "S08"], "count": "2 / 9", "query": "登录"}}`
- evidence: [012-live-S08-joined.txt](pty/2.1.287/ct-search/screens/012-live-S08-joined.txt)

### CT-FIND-001 · 2.1.287 · pass

- fixture: S fixture, Chinese and English
- expected: at 36, 56 and 44 columns the search row holds `f: 搜索` / `f: Find`, the query, the count (`1 / 8`, `2 of 8`), ✕ and ‹ › on one row; nothing gives way
- actual: `{"zh placeholder gone, focused": "f: 搜索 登录  ⏎ 跳转             1 / 8 ✕ ‹ ›", "zh 36": {"paneColumns": 36, "row": "f: 搜索 登录             1 / 8 ✕ ‹ ›", "whole": true}, "zh 56": {"paneColumns": 56, "row": "f: 搜索 登录                                 1 / 8 ✕ ‹ ›", "whole": true}, "zh 44": {"paneColumns": 44, "row": "f: 搜索 登录                     1 / 8 ✕ ‹ ›", "whole": true}, "en placeholder gone, focused": …`
- evidence: [013-widths-zh-36.txt](pty/2.1.287/ct-search/screens/013-widths-zh-36.txt), [014-widths-zh-56.txt](pty/2.1.287/ct-search/screens/014-widths-zh-56.txt), [015-widths-zh-44.txt](pty/2.1.287/ct-search/screens/015-widths-zh-44.txt), [016-widths-en-36.txt](pty/2.1.287/ct-search/screens/016-widths-en-36.txt), [017-widths-en-56.txt](pty/2.1.287/ct-search/screens/017-widths-en-56.txt), [018-widths-en-44.txt](pty/2.1.287/ct-search/screens/018-widths-en-44.txt)

### CT-FIND-001 · 2.1.295 · pass

- fixture: S fixture
- expected: idle: the placeholder, no count, no ✕; each query lists the groups holding every word with the count `N / 8` and ✕: login→S00 (path), S01; `LOGIN fixed`→S01 (AND, case); 登录, 录页→S00 (CJK); `full width`→S03 (NFKC); src/loginpage→S00 (path); nowhere→none, 没有匹配的轮次
- actual: `{"idle": {"text": "", "count": null, "clear": false, "focused": false, "step": true}, "login": {"listed": ["S00", "S01"], "search": {"text": "login", "count": "2 / 8", "clear": true, "focused": true, "step": true}, "notes": []}, "LOGIN fixed": {"listed": ["S01"], "search": {"text": "LOGIN fixed", "count": "1 / 8", "clear": true, "focused": true, "step": true}, "notes": []}, "登录": {"listed": ["S00…`
- evidence: [001-narrow-login.txt](pty/2.1.295/ct-search/screens/001-narrow-login.txt), [002-narrow-LOGIN-fixed.txt](pty/2.1.295/ct-search/screens/002-narrow-LOGIN-fixed.txt), [003-narrow-登录.txt](pty/2.1.295/ct-search/screens/003-narrow-登录.txt), [004-narrow-录页.txt](pty/2.1.295/ct-search/screens/004-narrow-录页.txt), [005-narrow-full-width.txt](pty/2.1.295/ct-search/screens/005-narrow-full-width.txt), [006-narrow-src-loginpage.txt](pty/2.1.295/ct-search/screens/006-narrow-src-loginpage.txt) and 1 more

### CT-FIND-001 · 2.1.295 · pass

- fixture: S fixture
- expected: the View filter picks the fields: fixed (reply) and loginpage (path) match under 全部 and Agent, not 用户; readme (input and path) under all three; 修改 (input only) under 全部 and 用户, not Agent
- actual: `{"fixed 全部": {"listed": ["S01"], "count": "1 / 8", "filter": "all"}, "fixed 用户": {"listed": [], "count": "0 / 8", "filter": "user"}, "fixed Agent": {"listed": ["S01"], "count": "1 / 8", "filter": "agent"}, "loginpage 全部": {"listed": ["S00"], "count": "1 / 8", "filter": "all"}, "loginpage 用户": {"listed": [], "count": "0 / 8", "filter": "user"}, "loginpage Agent": {"listed": ["S00"], "count": "1 / …`
- evidence: [008-filter-fixed.txt](pty/2.1.295/ct-search/screens/008-filter-fixed.txt), [009-filter-loginpage.txt](pty/2.1.295/ct-search/screens/009-filter-loginpage.txt), [010-filter-readme.txt](pty/2.1.295/ct-search/screens/010-filter-readme.txt), [011-filter-修改.txt](pty/2.1.295/ct-search/screens/011-filter-修改.txt)

### CT-FIND-001 · 2.1.295 · pass

- fixture: S fixture + a prompt submitted while 登录 is the query
- expected: the new matching group S08 joins the list and the count goes from 1 / 8 to 2 / 9; the query stays
- actual: `{"before": {"listed": ["S00"], "count": "1 / 8"}, "after": {"listed": ["S00", "S08"], "count": "2 / 9", "query": "登录"}}`
- evidence: [012-live-S08-joined.txt](pty/2.1.295/ct-search/screens/012-live-S08-joined.txt)

### CT-FIND-001 · 2.1.295 · pass

- fixture: S fixture, Chinese and English
- expected: at 36, 56 and 44 columns the search row holds `f: 搜索` / `f: Find`, the query, the count (`1 / 8`, `2 of 8`), ✕ and ‹ › on one row; nothing gives way
- actual: `{"zh placeholder gone, focused": "f: 搜索 登录  ⏎ 跳转             1 / 8 ✕ ‹ ›", "zh 36": {"paneColumns": 36, "row": "f: 搜索 登录             1 / 8 ✕ ‹ ›", "whole": true}, "zh 56": {"paneColumns": 56, "row": "f: 搜索 登录                                 1 / 8 ✕ ‹ ›", "whole": true}, "zh 44": {"paneColumns": 44, "row": "f: 搜索 登录                     1 / 8 ✕ ‹ ›", "whole": true}, "en placeholder gone, focused": …`
- evidence: [013-widths-zh-36.txt](pty/2.1.295/ct-search/screens/013-widths-zh-36.txt), [014-widths-zh-56.txt](pty/2.1.295/ct-search/screens/014-widths-zh-56.txt), [015-widths-zh-44.txt](pty/2.1.295/ct-search/screens/015-widths-zh-44.txt), [016-widths-en-36.txt](pty/2.1.295/ct-search/screens/016-widths-en-36.txt), [017-widths-en-56.txt](pty/2.1.295/ct-search/screens/017-widths-en-56.txt), [018-widths-en-44.txt](pty/2.1.295/ct-search/screens/018-widths-en-44.txt)

### CT-FIND-002 · 2.1.287 · pass

- fixture: S fixture
- expected: f focuses the field; Enter on S02 jumps there (lit, in the transcript), selects it, opens no preview and ends the search; a click focuses the field; Esc keeps the query and the next letters go to the composer; ✕, Ctrl+U and Backspace empty it; Enter with no match only clears it
- actual: `{"litAtStart": "S07", "fFocuses": true, "enter": {"query": "", "listed": 8, "lit": "S02", "transcriptShowsS02": true, "selected": "S02", "previewClosed": true}, "clickFocuses": {"text": "S05", "count": "1 / 8", "clear": true, "focused": true, "step": true}, "escKeeps": {"search": {"text": "S05", "count": "1 / 8", "clear": true, "focused": false, "step": true}, "composerGotZz": true}, "clearMark":…`
- evidence: [019-keys-typed-S02.txt](pty/2.1.287/ct-search/screens/019-keys-typed-S02.txt), [020-keys-Enter-jumped.txt](pty/2.1.287/ct-search/screens/020-keys-Enter-jumped.txt), [021-keys-Esc-kept-the-query--zz-in-the-composer.txt](pty/2.1.287/ct-search/screens/021-keys-Esc-kept-the-query--zz-in-the-composer.txt), [022-keys-Enter-with-no-match.txt](pty/2.1.287/ct-search/screens/022-keys-Enter-with-no-match.txt)

### CT-FIND-002 · 2.1.287 · pass

- fixture: S fixture, the query login
- expected: ↓ from the field reaches a match; Enter on it jumps (lit) and selects it, the preview still closed; p opens it on that group; the search stays: the query and the two matches
- actual: `{"ring": [{"row": 2, "entry": null}, {"row": 7, "entry": "S00 修改登录页面"}], "enter": {"selected": "S00", "previewClosed": true}, "after": {"target": "S00", "lit": "S00", "search": {"text": "login", "count": "2 / 8", "clear": true, "focused": false, "step": true}, "listed": ["S00", "S01"], "preview": "S00"}}`
- evidence: [023-entry-ring-on-a-match.txt](pty/2.1.287/ct-search/screens/023-entry-ring-on-a-match.txt), [024-entry-Enter-jumped--search-kept.txt](pty/2.1.287/ct-search/screens/024-entry-Enter-jumped--search-kept.txt)

### CT-FIND-002 · 2.1.287 · pass

- fixture: S fixture, the query 登录
- expected: the query stays in the field after a switch to 用户, a switch to 紧凑, /diff in front and the Pane's tab clicked back, and the Pane closed by its ✕ and reopened by /chat-toc
- actual: `{"filter": {"filter": "user", "search": {"text": "登录", "count": "1 / 8", "clear": true, "focused": false, "step": true}, "listed": ["S00"]}, "layout": {"layout": "紧凑", "search": {"text": "登录", "count": "1 / 8", "clear": true, "focused": false, "step": true}}, "diffInFront": true, "backTab": {"search": {"text": "登录", "count": "1 / 9", "clear": true, "focused": false, "step": true}}, "closed": true…`
- evidence: [025-keep-after-filter-and-Layout.txt](pty/2.1.287/ct-search/screens/025-keep-after-filter-and-Layout.txt), [026-keep-after-a-back-tab.txt](pty/2.1.287/ct-search/screens/026-keep-after-a-back-tab.txt), [027-keep-after-close-and-reopen.txt](pty/2.1.287/ct-search/screens/027-keep-after-close-and-reopen.txt)

### CT-FIND-002 · 2.1.287 · pass

- fixture: S fixture
- expected: the Minimap still draws all 8 cells; login lights cells 0 and 1, S02 cell 2, nowhere none
- actual: `{"login": {"cells": 8, "lit": [0, 1]}, "S02": {"cells": 8, "lit": [2]}, "nowhere": {"cells": 8, "lit": []}}`
- evidence: [028-minimap-login.txt](pty/2.1.287/ct-search/screens/028-minimap-login.txt), [029-minimap-S02.txt](pty/2.1.287/ct-search/screens/029-minimap-S02.txt), [030-minimap-nowhere.txt](pty/2.1.287/ct-search/screens/030-minimap-nowhere.txt)

### CT-FIND-002 · 2.1.295 · pass

- fixture: S fixture
- expected: f focuses the field; Enter on S02 jumps there (lit, in the transcript), selects it, opens no preview and ends the search; a click focuses the field; Esc keeps the query and the next letters go to the composer; ✕, Ctrl+U and Backspace empty it; Enter with no match only clears it
- actual: `{"litAtStart": "S07", "fFocuses": true, "enter": {"query": "", "listed": 8, "lit": "S02", "transcriptShowsS02": true, "selected": "S02", "previewClosed": true}, "clickFocuses": {"text": "S05", "count": "1 / 8", "clear": true, "focused": true, "step": true}, "escKeeps": {"search": {"text": "S05", "count": "1 / 8", "clear": true, "focused": false, "step": true}, "composerGotZz": true}, "clearMark":…`
- evidence: [019-keys-typed-S02.txt](pty/2.1.295/ct-search/screens/019-keys-typed-S02.txt), [020-keys-Enter-jumped.txt](pty/2.1.295/ct-search/screens/020-keys-Enter-jumped.txt), [021-keys-Esc-kept-the-query--zz-in-the-composer.txt](pty/2.1.295/ct-search/screens/021-keys-Esc-kept-the-query--zz-in-the-composer.txt), [022-keys-Enter-with-no-match.txt](pty/2.1.295/ct-search/screens/022-keys-Enter-with-no-match.txt)

### CT-FIND-002 · 2.1.295 · pass

- fixture: S fixture, the query login
- expected: ↓ from the field reaches a match; Enter on it jumps (lit) and selects it, the preview still closed; p opens it on that group; the search stays: the query and the two matches
- actual: `{"ring": [{"row": 3, "entry": null}, {"row": 8, "entry": "S00 修改登录页面"}], "enter": {"selected": "S00", "previewClosed": true}, "after": {"target": "S00", "lit": "S00", "search": {"text": "login", "count": "2 / 8", "clear": true, "focused": false, "step": true}, "listed": ["S00", "S01"], "preview": "S00"}}`
- evidence: [023-entry-ring-on-a-match.txt](pty/2.1.295/ct-search/screens/023-entry-ring-on-a-match.txt), [024-entry-Enter-jumped--search-kept.txt](pty/2.1.295/ct-search/screens/024-entry-Enter-jumped--search-kept.txt)

### CT-FIND-002 · 2.1.295 · pass

- fixture: S fixture, the query 登录
- expected: the query stays in the field after a switch to 用户, a switch to 紧凑, /diff in front and the Pane's tab clicked back, and the Pane closed by its ✕ and reopened by /chat-toc
- actual: `{"filter": {"filter": "user", "search": {"text": "登录", "count": "1 / 8", "clear": true, "focused": false, "step": true}, "listed": ["S00"]}, "layout": {"layout": "紧凑", "search": {"text": "登录", "count": "1 / 8", "clear": true, "focused": false, "step": true}}, "diffInFront": true, "backTab": {"search": {"text": "登录", "count": "1 / 9", "clear": true, "focused": false, "step": true}}, "closed": true…`
- evidence: [025-keep-after-filter-and-Layout.txt](pty/2.1.295/ct-search/screens/025-keep-after-filter-and-Layout.txt), [026-keep-after-a-back-tab.txt](pty/2.1.295/ct-search/screens/026-keep-after-a-back-tab.txt), [027-keep-after-close-and-reopen.txt](pty/2.1.295/ct-search/screens/027-keep-after-close-and-reopen.txt)

### CT-FIND-002 · 2.1.295 · pass

- fixture: S fixture
- expected: the Minimap still draws all 8 cells; login lights cells 0 and 1, S02 cell 2, nowhere none
- actual: `{"login": {"cells": 8, "lit": [0, 1]}, "S02": {"cells": 8, "lit": [2]}, "nowhere": {"cells": 8, "lit": []}}`
- evidence: [028-minimap-login.txt](pty/2.1.295/ct-search/screens/028-minimap-login.txt), [029-minimap-S02.txt](pty/2.1.295/ct-search/screens/029-minimap-S02.txt), [030-minimap-nowhere.txt](pty/2.1.295/ct-search/screens/030-minimap-nowhere.txt)

### CT-STEP-001 · 2.1.287 · pass

- fixture: K fixture (K00-K01 compacted before the resume, K04 without a reply, needle in K06 and K08)
- expected: the search row ends in ‹ ›; › at the newest group does nothing; ‹ walks K08..K02, each lit with its prompt at the transcript's top; ‹ from K02 says 无法跳转 (K00, K01 unjumpable) and stays; › to K03; under Agent › skips K04 for K05's reply; with the query needle › walks K06, K08, then nothing, ‹ back to K06, the query kept
- actual: `{"searchRow": {"text": "", "count": null, "clear": false, "focused": false, "step": true}, "nextAtEnd": {"lit": 9, "top": [], "topBefore": []}, "back": [{"lit": 8, "top": [8, 8]}, {"lit": 7, "top": [7, 7]}, {"lit": 6, "top": [6, 6]}, {"lit": 5, "top": [5, 5]}, {"lit": 4, "top": [4, 5]}, {"lit": 3, "top": [3, 3]}, {"lit": 2, "top": [2, 2]}], "pastCompacted": {"notice": true, "lit": 2, "top": [2, 2…`
- evidence: [001-pane-walked-back-to-K02.txt](pty/2.1.287/ct-step/screens/001-pane-walked-back-to-K02.txt), [002-pane---from-K02--the-notice.txt](pty/2.1.287/ct-step/screens/002-pane---from-K02--the-notice.txt), [003-pane---under-Agent--K05-s-reply.txt](pty/2.1.287/ct-step/screens/003-pane---under-Agent--K05-s-reply.txt), [004-pane-under-the-query-needle.txt](pty/2.1.287/ct-step/screens/004-pane-under-the-query-needle.txt)

### CT-STEP-001 · 2.1.287 · pass

- fixture: K fixture, keybindings.json binding meta+k / meta+j, one live turn against fake_api.py (no model)
- expected: from the composer meta+k, meta+k, meta+j light K08, K07, K08 with each prompt at the top and the composer untouched; during a running turn meta+k lights K09 (in view); the Pane closed, the band draws ‹ › and meta+k and a click on its ‹ move the transcript; with /diff in front the band draws ‹ › again, meta+k moves the transcript and leaves Diff as it was, clicks on its ‹ move it too; the Pane's tab clicked, the band goes
- actual: `{"composer": [{"lit": 8, "top": [8, 8]}, {"lit": 7, "top": [7, 7]}, {"lit": 8, "top": [8, 8]}], "composerUntouched": true, "duringTurn": {"lit": 9, "top": [], "inView": [9], "running": true}, "bandClosed": "☰ ChatTOC  ‹ ›  │  用户 11 轮 · Agent 3 步 · 上下文已用 0%   展开目录 ❯                                                                                               [-]", "closed": {"before": [8, 8], "aft…`
- evidence: [005-keys-from-the-composer.txt](pty/2.1.287/ct-step/screens/005-keys-from-the-composer.txt), [006-keys-meta-k-during-a-turn.txt](pty/2.1.287/ct-step/screens/006-keys-meta-k-during-a-turn.txt), [007-keys-band-with-the-Pane-closed.txt](pty/2.1.287/ct-step/screens/007-keys-band-with-the-Pane-closed.txt), [008-keys-meta-k-with--diff-in-front.txt](pty/2.1.287/ct-step/screens/008-keys-meta-k-with--diff-in-front.txt), [009-keys-band-with--diff-in-front.txt](pty/2.1.287/ct-step/screens/009-keys-band-with--diff-in-front.txt), [010-keys-Pane-in-front-again--no-band.txt](pty/2.1.287/ct-step/screens/010-keys-Pane-in-front-again--no-band.txt)

### CT-STEP-001 · 2.1.295 · pass

- fixture: K fixture (K00-K01 compacted before the resume, K04 without a reply, needle in K06 and K08)
- expected: the search row ends in ‹ ›; › at the newest group does nothing; ‹ walks K08..K02, each lit with its prompt at the transcript's top; ‹ from K02 says 无法跳转 (K00, K01 unjumpable) and stays; › to K03; under Agent › skips K04 for K05's reply; with the query needle › walks K06, K08, then nothing, ‹ back to K06, the query kept
- actual: `{"searchRow": {"text": "", "count": null, "clear": false, "focused": false, "step": true}, "nextAtEnd": {"lit": 9, "top": [], "topBefore": []}, "back": [{"lit": 8, "top": [8, 8]}, {"lit": 7, "top": [7, 7]}, {"lit": 6, "top": [6, 6]}, {"lit": 5, "top": [5, 5]}, {"lit": 4, "top": [4, 5]}, {"lit": 3, "top": [3, 3]}, {"lit": 2, "top": [2, 2]}], "pastCompacted": {"notice": true, "lit": 2, "top": [2, 2…`
- evidence: [001-pane-walked-back-to-K02.txt](pty/2.1.295/ct-step/screens/001-pane-walked-back-to-K02.txt), [002-pane---from-K02--the-notice.txt](pty/2.1.295/ct-step/screens/002-pane---from-K02--the-notice.txt), [003-pane---under-Agent--K05-s-reply.txt](pty/2.1.295/ct-step/screens/003-pane---under-Agent--K05-s-reply.txt), [004-pane-under-the-query-needle.txt](pty/2.1.295/ct-step/screens/004-pane-under-the-query-needle.txt)

### CT-STEP-001 · 2.1.295 · pass

- fixture: K fixture, keybindings.json binding meta+k / meta+j, one live turn against fake_api.py (no model)
- expected: from the composer meta+k, meta+k, meta+j light K08, K07, K08 with each prompt at the top and the composer untouched; during a running turn meta+k lights K09 (in view); the Pane closed, the band draws ‹ › and meta+k and a click on its ‹ move the transcript; with /diff in front the band draws ‹ › again, meta+k moves the transcript and leaves Diff as it was, clicks on its ‹ move it too; the Pane's tab clicked, the band goes
- actual: `{"composer": [{"lit": 8, "top": [8, 8]}, {"lit": 7, "top": [7, 7]}, {"lit": 8, "top": [8, 8]}], "composerUntouched": true, "duringTurn": {"lit": 9, "top": [], "inView": [9], "running": true}, "bandClosed": "☰ ChatTOC  ‹ ›  │  用户 11 轮 · Agent 3 步 · 上下文已用 0%   展开目录 ❯                                                                                              [-]", "closed": {"before": [8, 8], "afte…`
- evidence: [005-keys-from-the-composer.txt](pty/2.1.295/ct-step/screens/005-keys-from-the-composer.txt), [006-keys-meta-k-during-a-turn.txt](pty/2.1.295/ct-step/screens/006-keys-meta-k-during-a-turn.txt), [007-keys-band-with-the-Pane-closed.txt](pty/2.1.295/ct-step/screens/007-keys-band-with-the-Pane-closed.txt), [008-keys-meta-k-with--diff-in-front.txt](pty/2.1.295/ct-step/screens/008-keys-meta-k-with--diff-in-front.txt), [009-keys-band-with--diff-in-front.txt](pty/2.1.295/ct-step/screens/009-keys-band-with--diff-in-front.txt), [010-keys-Pane-in-front-again--no-band.txt](pty/2.1.295/ct-step/screens/010-keys-Pane-in-front-again--no-band.txt)

### CT-REUSE-001 · 2.1.287 · pass

- fixture: R fixture
- expected: `r` on R00 fills the empty composer with its five lines as typed and the next key lands there (```Q); with `R 草稿` typed, `r` on R04 gives `R 草稿`, a blank line, `R04 小问题`; nothing is sent
- actual: `{"labels": {"用户": "r: 填入 · c: 复制", "Agent": "a: 复制"}, "filled": ["R00 修一下", "", "```ts", "const a = 1", "```"], "typedAfter": "```Q", "appended": ["R 草稿", "", "R04 小问题"], "notLoggedInAnswer": false, "groups": {"before": 5, "after": 5}}`
- evidence: [001-fill-R00.txt](pty/2.1.287/ct-reuse/screens/001-fill-R00.txt), [002-fill-appended.txt](pty/2.1.287/ct-reuse/screens/002-fill-appended.txt)

### CT-REUSE-001 · 2.1.287 · pass

- fixture: R fixture
- expected: `c` on R00 copies its input whole (the code block too) and its Button reads `c: 已复制`; `a` copies the reply's Markdown source `## R00 完成…` and reads `a: 已复制`; 2.5 s later both read `复制`
- actual: `{"afterC": {"clipboard": "R00 修一下\n\n```ts\nconst a = 1\n```", "labels": {"用户": "r: 填入 · c: 已复制", "Agent": "a: 复制"}}, "afterA": {"clipboard": "## R00 完成\n\n- `one`", "labels": {"用户": "r: 填入 · c: 复制", "Agent": "a: 已复制"}}, "later": {"用户": "r: 填入 · c: 复制", "Agent": "a: 复制"}}`
- evidence: [003-copy-c.txt](pty/2.1.287/ct-reuse/screens/003-copy-c.txt), [004-copy-a.txt](pty/2.1.287/ct-reuse/screens/004-copy-a.txt)

### CT-REUSE-001 · 2.1.287 · pass

- fixture: R fixture
- expected: R01 (`!echo R01`): `c: 复制` alone, copying `!echo R01`; R02 (image only): `用户` bare, `a: 复制` kept; R03: `r` fills `R03 看图` and the `图片未包含` toast shows
- actual: `{"shell": {"用户": "c: 复制"}, "shellCopied": "!echo R01", "imageOnly": {"用户": "", "Agent": "a: 复制"}, "withImages": {"composer": ["R03 看图"], "toast": true}}`
- evidence: [005-rules-shell.txt](pty/2.1.287/ct-reuse/screens/005-rules-shell.txt), [006-rules-image-only.txt](pty/2.1.287/ct-reuse/screens/006-rules-image-only.txt), [007-rules-with-images.txt](pty/2.1.287/ct-reuse/screens/007-rules-with-images.txt)

### CT-REUSE-001 · 2.1.287 · pass

- fixture: R fixture
- expected: before any press `r` `c` `a` are no hotkeys: typed into the composer as `rca`, nothing filled or copied; once `p` closed the preview, R00's row `p: 预览 · r: 填入 · c: 复制` is back, `a` is typed into the composer, `c` copies the side selected (`c: 已复制`) and `r` fills R00's input; at a height whose preview cuts R00 before its `Agent` row, `a` is typed too and copies nothing; after `e`, `a` copies the reply
- actual: `{"beforePress": {"composer": ["rca"], "clipboard": "CT-REUSE clipboard before"}, "closedByP": {"row": ["p: 预览", "r: 填入", "c: 复制"], "composer": ["a"], "clipboard": "CT-REUSE clipboard before"}, "rowCopy": {"side": "agent", "clipboard": "## R00 完成\n\n- `one`", "row": ["p: 预览", "r: 填入", "c: 已复制"]}, "rowFill": ["R00 修一下", "", "```ts", "const a = 1", "```"], "cutAt": 23, "cut": {"labels": {"用户": "r: 填…`
- evidence: [008-closed-before-a-press.txt](pty/2.1.287/ct-reuse/screens/008-closed-before-a-press.txt), [009-closed-by-p.txt](pty/2.1.287/ct-reuse/screens/009-closed-by-p.txt), [010-closed-row-copy.txt](pty/2.1.287/ct-reuse/screens/010-closed-row-copy.txt), [011-closed-cut.txt](pty/2.1.287/ct-reuse/screens/011-closed-cut.txt), [012-closed-expanded.txt](pty/2.1.287/ct-reuse/screens/012-closed-expanded.txt)

### CT-REUSE-001 · 2.1.287 · pass

- fixture: R fixture, /model's picker open
- expected: a click on `r: 填入` under the picker shows `无法填入：有对话框打开`; once the picker closes the composer is still empty (the text dropped)
- actual: `{"toast": true, "composer": [""]}`
- evidence: [013-dialog-toast.txt](pty/2.1.287/ct-reuse/screens/013-dialog-toast.txt), [014-dialog-closed.txt](pty/2.1.287/ct-reuse/screens/014-dialog-closed.txt)

### CT-REUSE-001 · 2.1.287 · pass

- fixture: R fixture + one live turn against fake_api.py (two Read steps, 8 s apart; no model)
- expected: while the turn runs its preview shows `r: 填入 · c: 复制` and no `a: 复制`; a click on `r: 填入` fills `R05 …` while it still runs; once it ends the `Agent` row has `a: 复制`
- actual: `{"running": {"用户": "r: 填入 · c: 复制"}, "anyA": false, "filledWhileRunning": {"composer": ["R05 进行中的合成一轮"], "stillRunning": true}, "ended": {"用户": "r: 填入 · c: 复制", "Agent": "a: 复制"}}`
- evidence: [015-running-labels.txt](pty/2.1.287/ct-reuse/screens/015-running-labels.txt), [016-running-filled.txt](pty/2.1.287/ct-reuse/screens/016-running-filled.txt), [017-running-ended.txt](pty/2.1.287/ct-reuse/screens/017-running-ended.txt)

### CT-REUSE-001 · 2.1.287 · pass

- fixture: R fixture, the Pane narrowed to 36 columns, Chinese and English
- expected: the `用户`/`User` row holds `r: 填入 · c: 复制` / `r: Reuse · c: Copy` at its right on one row, `c: 已复制` / `c: Copied` too, and the `Agent` row `a: 复制` / `a: Copy`
- actual: `{"zh": {"paneColumns": 36, "userRow": "用户               r: 填入 · c: 复制", "agentRow": "Agent                        a: 复制", "copiedRow": "用户             r: 填入 · c: 已复制", "ok": true}, "en": {"paneColumns": 36, "userRow": "User              r: Reuse · c: Copy", "agentRow": "Agent                        a: Copy", "copiedRow": "User            r: Reuse · c: Copied", "ok": true}}`
- evidence: [018-widths-36-zh.txt](pty/2.1.287/ct-reuse/screens/018-widths-36-zh.txt), [019-widths-36-en.txt](pty/2.1.287/ct-reuse/screens/019-widths-36-en.txt)

### CT-REUSE-001 · 2.1.295 · pass

- fixture: R fixture
- expected: `r` on R00 fills the empty composer with its five lines as typed and the next key lands there (```Q); with `R 草稿` typed, `r` on R04 gives `R 草稿`, a blank line, `R04 小问题`; nothing is sent
- actual: `{"labels": {"用户": "r: 填入 · c: 复制", "Agent": "a: 复制"}, "filled": ["R00 修一下", "", "```ts", "const a = 1", "```"], "typedAfter": "```Q", "appended": ["R 草稿", "", "R04 小问题"], "notLoggedInAnswer": false, "groups": {"before": 5, "after": 5}}`
- evidence: [001-fill-R00.txt](pty/2.1.295/ct-reuse/screens/001-fill-R00.txt), [002-fill-appended.txt](pty/2.1.295/ct-reuse/screens/002-fill-appended.txt)

### CT-REUSE-001 · 2.1.295 · pass

- fixture: R fixture
- expected: `c` on R00 copies its input whole (the code block too) and its Button reads `c: 已复制`; `a` copies the reply's Markdown source `## R00 完成…` and reads `a: 已复制`; 2.5 s later both read `复制`
- actual: `{"afterC": {"clipboard": "R00 修一下\n\n```ts\nconst a = 1\n```", "labels": {"用户": "r: 填入 · c: 已复制", "Agent": "a: 复制"}}, "afterA": {"clipboard": "## R00 完成\n\n- `one`", "labels": {"用户": "r: 填入 · c: 复制", "Agent": "a: 已复制"}}, "later": {"用户": "r: 填入 · c: 复制", "Agent": "a: 复制"}}`
- evidence: [003-copy-c.txt](pty/2.1.295/ct-reuse/screens/003-copy-c.txt), [004-copy-a.txt](pty/2.1.295/ct-reuse/screens/004-copy-a.txt)

### CT-REUSE-001 · 2.1.295 · pass

- fixture: R fixture
- expected: R01 (`!echo R01`): `c: 复制` alone, copying `!echo R01`; R02 (image only): `用户` bare, `a: 复制` kept; R03: `r` fills `R03 看图` and the `图片未包含` toast shows
- actual: `{"shell": {"用户": "c: 复制"}, "shellCopied": "!echo R01", "imageOnly": {"用户": "", "Agent": "a: 复制"}, "withImages": {"composer": ["R03 看图"], "toast": true}}`
- evidence: [005-rules-shell.txt](pty/2.1.295/ct-reuse/screens/005-rules-shell.txt), [006-rules-image-only.txt](pty/2.1.295/ct-reuse/screens/006-rules-image-only.txt), [007-rules-with-images.txt](pty/2.1.295/ct-reuse/screens/007-rules-with-images.txt)

### CT-REUSE-001 · 2.1.295 · pass

- fixture: R fixture
- expected: before any press `r` `c` `a` are no hotkeys: typed into the composer as `rca`, nothing filled or copied; once `p` closed the preview, R00's row `p: 预览 · r: 填入 · c: 复制` is back, `a` is typed into the composer, `c` copies the side selected (`c: 已复制`) and `r` fills R00's input; at a height whose preview cuts R00 before its `Agent` row, `a` is typed too and copies nothing; after `e`, `a` copies the reply
- actual: `{"beforePress": {"composer": ["rca"], "clipboard": "CT-REUSE clipboard before"}, "closedByP": {"row": ["p: 预览", "r: 填入", "c: 复制"], "composer": ["a"], "clipboard": "CT-REUSE clipboard before"}, "rowCopy": {"side": "agent", "clipboard": "## R00 完成\n\n- `one`", "row": ["p: 预览", "r: 填入", "c: 已复制"]}, "rowFill": ["R00 修一下", "", "```ts", "const a = 1", "```"], "cutAt": 24, "cut": {"labels": {"用户": "r: 填…`
- evidence: [008-closed-before-a-press.txt](pty/2.1.295/ct-reuse/screens/008-closed-before-a-press.txt), [009-closed-by-p.txt](pty/2.1.295/ct-reuse/screens/009-closed-by-p.txt), [010-closed-row-copy.txt](pty/2.1.295/ct-reuse/screens/010-closed-row-copy.txt), [011-closed-cut.txt](pty/2.1.295/ct-reuse/screens/011-closed-cut.txt), [012-closed-expanded.txt](pty/2.1.295/ct-reuse/screens/012-closed-expanded.txt)

### CT-REUSE-001 · 2.1.295 · pass

- fixture: R fixture, /model's picker open
- expected: a click on `r: 填入` under the picker shows `无法填入：有对话框打开`; once the picker closes the composer is still empty (the text dropped)
- actual: `{"toast": true, "composer": [""]}`
- evidence: [013-dialog-toast.txt](pty/2.1.295/ct-reuse/screens/013-dialog-toast.txt), [014-dialog-closed.txt](pty/2.1.295/ct-reuse/screens/014-dialog-closed.txt)

### CT-REUSE-001 · 2.1.295 · pass

- fixture: R fixture + one live turn against fake_api.py (two Read steps, 8 s apart; no model)
- expected: while the turn runs its preview shows `r: 填入 · c: 复制` and no `a: 复制`; a click on `r: 填入` fills `R05 …` while it still runs; once it ends the `Agent` row has `a: 复制`
- actual: `{"running": {"用户": "r: 填入 · c: 复制"}, "anyA": false, "filledWhileRunning": {"composer": ["R05 进行中的合成一轮"], "stillRunning": true}, "ended": {"用户": "r: 填入 · c: 复制", "Agent": "a: 复制"}}`
- evidence: [015-running-labels.txt](pty/2.1.295/ct-reuse/screens/015-running-labels.txt), [016-running-filled.txt](pty/2.1.295/ct-reuse/screens/016-running-filled.txt), [017-running-ended.txt](pty/2.1.295/ct-reuse/screens/017-running-ended.txt)

### CT-REUSE-001 · 2.1.295 · pass

- fixture: R fixture, the Pane narrowed to 36 columns, Chinese and English
- expected: the `用户`/`User` row holds `r: 填入 · c: 复制` / `r: Reuse · c: Copy` at its right on one row, `c: 已复制` / `c: Copied` too, and the `Agent` row `a: 复制` / `a: Copy`
- actual: `{"zh": {"paneColumns": 36, "userRow": "用户               r: 填入 · c: 复制", "agentRow": "Agent                        a: 复制", "copiedRow": "用户             r: 填入 · c: 已复制", "ok": true}, "en": {"paneColumns": 36, "userRow": "User              r: Reuse · c: Copy", "agentRow": "Agent                        a: Copy", "copiedRow": "User            r: Reuse · c: Copied", "ok": true}}`
- evidence: [018-widths-36-zh.txt](pty/2.1.295/ct-reuse/screens/018-widths-36-zh.txt), [019-widths-36-en.txt](pty/2.1.295/ct-reuse/screens/019-widths-36-en.txt)

### CT-PERF-002 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [3.89, 3.95, 4.18], "end": [4.48, 4.14, 4.24]}, "hostReadyS": 0.69, "tocReadyS": 1.3, "tocLagMs": 609, "previewRows": 14, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.17}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.76}, "reachedLast": true, "search": {"keystrokes":…`
- evidence: [debug-heavy-1.log](pty/2.1.287/perf-heavy/debug-heavy-1.log), [001-heavy-1-after-resume.txt](pty/2.1.287/perf-heavy/screens/001-heavy-1-after-resume.txt), [002-heavy-1-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/002-heavy-1-pane-at-its-top.txt), [003-heavy-1-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/003-heavy-1-after-clicking-T0000.txt), [004-heavy-1-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/004-heavy-1-pane-at-its-end.txt), [005-heavy-1-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/005-heavy-1-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [4.48, 4.14, 4.24], "end": [4.54, 4.2, 4.25]}, "hostReadyS": 0.67, "tocReadyS": 1.23, "tocLagMs": 566, "previewRows": 14, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.19}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.74}, "reachedLast": true, "search": {"keystrokes":…`
- evidence: [debug-heavy-2.log](pty/2.1.287/perf-heavy/debug-heavy-2.log), [011-heavy-2-after-resume.txt](pty/2.1.287/perf-heavy/screens/011-heavy-2-after-resume.txt), [012-heavy-2-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/012-heavy-2-pane-at-its-top.txt), [013-heavy-2-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/013-heavy-2-after-clicking-T0000.txt), [014-heavy-2-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/014-heavy-2-pane-at-its-end.txt), [015-heavy-2-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/015-heavy-2-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [4.54, 4.2, 4.25], "end": [5.51, 4.5, 4.36]}, "hostReadyS": 0.7, "tocReadyS": 1.25, "tocLagMs": 546, "previewRows": 14, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.09}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.72}, "reachedLast": true, "search": {"keystrokes": 3…`
- evidence: [debug-heavy-3.log](pty/2.1.287/perf-heavy/debug-heavy-3.log), [021-heavy-3-after-resume.txt](pty/2.1.287/perf-heavy/screens/021-heavy-3-after-resume.txt), [022-heavy-3-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/022-heavy-3-pane-at-its-top.txt), [023-heavy-3-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/023-heavy-3-after-clicking-T0000.txt), [024-heavy-3-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/024-heavy-3-pane-at-its-end.txt), [025-heavy-3-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/025-heavy-3-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [10.65, 5.86, 4.76], "end": [4.0, 4.89, 4.6]}, "hostReadyS": 1.02, "tocReadyS": 1.86, "tocLagMs": 844, "previewRows": 14, "paneToTop": {"batches": 500, "ticks": 10000, "s": 104.23}, "reachedFirst": true, "paneToEnd": {"batches": 405, "ticks": 8100, "s": 84.49}, "reachedLast": true, "search": {"…`
- evidence: [debug-many-1.log](pty/2.1.287/perf-many/debug-many-1.log), [001-many-1-after-resume.txt](pty/2.1.287/perf-many/screens/001-many-1-after-resume.txt), [002-many-1-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/002-many-1-pane-at-its-top.txt), [003-many-1-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/003-many-1-after-clicking-T0000.txt), [004-many-1-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/004-many-1-pane-at-its-end.txt), [005-many-1-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/005-many-1-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [4.0, 4.89, 4.6], "end": [2.95, 3.96, 4.26]}, "hostReadyS": 1.08, "tocReadyS": 1.89, "tocLagMs": 810, "previewRows": 14, "paneToTop": {"batches": 499, "ticks": 9980, "s": 103.8}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 84.56}, "reachedLast": true, "search": {"key…`
- evidence: [debug-many-2.log](pty/2.1.287/perf-many/debug-many-2.log), [011-many-2-after-resume.txt](pty/2.1.287/perf-many/screens/011-many-2-after-resume.txt), [012-many-2-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/012-many-2-pane-at-its-top.txt), [013-many-2-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/013-many-2-after-clicking-T0000.txt), [014-many-2-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/014-many-2-pane-at-its-end.txt), [015-many-2-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/015-many-2-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [2.95, 3.96, 4.26], "end": [3.89, 3.95, 4.18]}, "hostReadyS": 1.02, "tocReadyS": 1.82, "tocLagMs": 795, "previewRows": 14, "paneToTop": {"batches": 497, "ticks": 9940, "s": 103.36}, "reachedFirst": true, "paneToEnd": {"batches": 405, "ticks": 8100, "s": 84.32}, "reachedLast": true, "search": {"…`
- evidence: [debug-many-3.log](pty/2.1.287/perf-many/debug-many-3.log), [021-many-3-after-resume.txt](pty/2.1.287/perf-many/screens/021-many-3-after-resume.txt), [022-many-3-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/022-many-3-pane-at-its-top.txt), [023-many-3-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/023-many-3-after-clicking-T0000.txt), [024-many-3-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/024-many-3-pane-at-its-end.txt), [025-many-3-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/025-many-3-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [3.92, 4.43, 4.67], "end": [3.31, 4.19, 4.56]}, "hostReadyS": 0.68, "tocReadyS": 1.3, "tocLagMs": 620, "previewRows": 13, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.23}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.75}, "reachedLast": true, "search": {"keystrokes":…`
- evidence: [debug-heavy-1.log](pty/2.1.295/perf-heavy/debug-heavy-1.log), [001-heavy-1-after-resume.txt](pty/2.1.295/perf-heavy/screens/001-heavy-1-after-resume.txt), [002-heavy-1-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/002-heavy-1-pane-at-its-top.txt), [003-heavy-1-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/003-heavy-1-after-clicking-T0000.txt), [004-heavy-1-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/004-heavy-1-pane-at-its-end.txt), [005-heavy-1-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/005-heavy-1-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [3.31, 4.19, 4.56], "end": [3.54, 4.1, 4.5]}, "hostReadyS": 0.67, "tocReadyS": 1.23, "tocLagMs": 561, "previewRows": 13, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.22}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.77}, "reachedLast": true, "search": {"keystrokes": …`
- evidence: [debug-heavy-2.log](pty/2.1.295/perf-heavy/debug-heavy-2.log), [011-heavy-2-after-resume.txt](pty/2.1.295/perf-heavy/screens/011-heavy-2-after-resume.txt), [012-heavy-2-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/012-heavy-2-pane-at-its-top.txt), [013-heavy-2-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/013-heavy-2-after-clicking-T0000.txt), [014-heavy-2-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/014-heavy-2-pane-at-its-end.txt), [015-heavy-2-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/015-heavy-2-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "loadAverage": {"start": [3.54, 4.1, 4.5], "end": [3.91, 4.05, 4.45]}, "hostReadyS": 0.67, "tocReadyS": 1.23, "tocLagMs": 562, "previewRows": 13, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.24}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.7}, "reachedLast": true, "search": {"keystrokes": 3…`
- evidence: [debug-heavy-3.log](pty/2.1.295/perf-heavy/debug-heavy-3.log), [021-heavy-3-after-resume.txt](pty/2.1.295/perf-heavy/screens/021-heavy-3-after-resume.txt), [022-heavy-3-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/022-heavy-3-pane-at-its-top.txt), [023-heavy-3-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/023-heavy-3-after-clicking-T0000.txt), [024-heavy-3-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/024-heavy-3-pane-at-its-end.txt), [025-heavy-3-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/025-heavy-3-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [3.71, 4.18, 4.3], "end": [6.36, 4.94, 4.58]}, "hostReadyS": 1.05, "tocReadyS": 1.87, "tocLagMs": 826, "previewRows": 13, "paneToTop": {"batches": 502, "ticks": 10040, "s": 104.57}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 84.4}, "reachedLast": true, "search": {"k…`
- evidence: [debug-many-1.log](pty/2.1.295/perf-many/debug-many-1.log), [001-many-1-after-resume.txt](pty/2.1.295/perf-many/screens/001-many-1-after-resume.txt), [002-many-1-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/002-many-1-pane-at-its-top.txt), [003-many-1-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/003-many-1-after-clicking-T0000.txt), [004-many-1-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/004-many-1-pane-at-its-end.txt), [005-many-1-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/005-many-1-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [6.36, 4.94, 4.58], "end": [4.54, 5.52, 5.05]}, "hostReadyS": 1.09, "tocReadyS": 1.89, "tocLagMs": 800, "previewRows": 13, "paneToTop": {"batches": 500, "ticks": 10000, "s": 104.12}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 83.78}, "reachedLast": true, "search": {…`
- evidence: [debug-many-2.log](pty/2.1.295/perf-many/debug-many-2.log), [011-many-2-after-resume.txt](pty/2.1.295/perf-many/screens/011-many-2-after-resume.txt), [012-many-2-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/012-many-2-pane-at-its-top.txt), [013-many-2-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/013-many-2-after-clicking-T0000.txt), [014-many-2-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/014-many-2-pane-at-its-end.txt), [015-many-2-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/015-many-2-after-clicking-the-newest.txt) and 6 more

### CT-PERF-002 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- expected: a keystroke in the search field to the Pane redrawn: own <= 50 ms, with the host <= 100 ms (p95); idle whole read with the index <= 1 s; tail read with the index <= 150 ms; pane own with the preview open <= 16 ms
- actual: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "loadAverage": {"start": [4.54, 5.52, 5.05], "end": [3.92, 4.43, 4.67]}, "hostReadyS": 1.03, "tocReadyS": 1.88, "tocLagMs": 854, "previewRows": 13, "paneToTop": {"batches": 491, "ticks": 9820, "s": 100.21}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 84.39}, "reachedLast": true, "search": {"…`
- evidence: [debug-many-3.log](pty/2.1.295/perf-many/debug-many-3.log), [021-many-3-after-resume.txt](pty/2.1.295/perf-many/screens/021-many-3-after-resume.txt), [022-many-3-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/022-many-3-pane-at-its-top.txt), [023-many-3-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/023-many-3-after-clicking-T0000.txt), [024-many-3-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/024-many-3-pane-at-its-end.txt), [025-many-3-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/025-many-3-after-clicking-the-newest.txt) and 6 more

### CT-MAP-001 · 2.1.287 · pass

- fixture: turns 30
- expected: a block per group under the tab rule, only the last cell undimmed at the end; a click on a cell jumps to its group (its prompt at the top), lights its entry and moves the undimmed cell there
- actual: `{"cells": 30, "brightAtEnd": [29], "click8": {"top": 8, "sitedTop": 8, "lit": [8], "bright": [8]}, "click21": {"top": 21, "sitedTop": 21, "lit": [21], "bright": [21]}}`
- evidence: [030-at-the-end.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/030-at-the-end.txt), [031-after-a-click-on-cell-8.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/031-after-a-click-on-cell-8.txt), [032-after-a-click-on-cell-21.txt](pty/2.1.287/20261017-174108-CT-POS-2.1.287/screens/032-after-a-click-on-cell-21.txt)

### CT-MAP-001 · 2.1.295 · pass

- fixture: turns 30
- expected: a block per group under the tab rule, only the last cell undimmed at the end; a click on a cell jumps to its group (its prompt at the top), lights its entry and moves the undimmed cell there
- actual: `{"cells": 30, "brightAtEnd": [29], "click8": {"top": 8, "sitedTop": 8, "lit": [8], "bright": [8]}, "click21": {"top": 21, "sitedTop": 21, "lit": [21], "bright": [21]}}`
- evidence: [030-at-the-end.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/030-at-the-end.txt), [031-after-a-click-on-cell-8.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/031-after-a-click-on-cell-8.txt), [032-after-a-click-on-cell-21.txt](pty/2.1.295/20261017-170511-CT-POS-current/screens/032-after-a-click-on-cell-21.txt)

