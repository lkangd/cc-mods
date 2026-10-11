# chat-toc 0.1.0 发布证据

**结论：通过**（`--plugin-dir` 下 32 个 MUST 场景 × 2 个 Claude Code 版本；失败 0、缺失 0、跳过 0；证据里 CT-SEC-001 标记泄漏 0 处）

## 被测对象与环境

- commit: `a83f74c205023e18d204caef32491840cda0f0c2`
- pluginVersion: `0.1.0`
- claudeCodeVersions: `2.1.287, 2.1.295`
- minimumClaudeCode: `2.1.287`
- os: `macOS 15.8`
- arch: `arm64`
- cpu: `Apple M1 Pro`
- surface: `interactive terminal, fullscreen layout (pseudo-terminal read through pyte 0.8.2, 170x44 unless a scenario says otherwise)`
- loading: `--plugin-dir for every scenario; CT-COMPAT-002 through a local directory marketplace`
- functionHooks: `not set (chat-toc does not need CLAUDE_CODE_ENABLE_FUNCTION_HOOKS)`
- account: `logged out; no model call (CT-TURN-004's live turn runs against fake_api.py, a local scripted stand-in)`
- python: `3.14.8`

只用合成 prompt；transcript 都是 `tests/acceptance/transcript_fixture.py` 生成的或在隔离世界里新提交的。本机路径换成了 `<repo>`、`<home>`、`<tmp>`、`<npx>`。

## 自动化门禁

| 门禁 | 结果 | 说明 | 日志 |
| --- | --- | --- | --- |
| plugin-validate@2.1.287 | pass |  | [log](logs/plugin-validate@2.1.287.log) |
| tsc@2.1.287 | pass |  | [log](logs/tsc@2.1.287.log) |
| plugin-validate@2.1.295 | pass |  | [log](logs/plugin-validate@2.1.295.log) |
| plugin-test@2.1.295 | pass | 210 pass, 0 fail; CT-PERF position groups=4432 chain=26590 live=12 p50/p95/max=0.005/0.007/0.023 ms; CT-PERF position-residue records=3012 p50/p95/max=0.322/1.272/115.143 ms; CT-PERF entry-table entries=8864 first=82.165 ms; redraw p95=0.001 ms; last group grown p50/p95/max=0.046/0.053/0.055 ms | [log](logs/plugin-test@2.1.295.log) |
| tsc@2.1.295 | pass |  | [log](logs/tsc@2.1.295.log) |
| acceptance-unit@2.1.295 | pass | 43 tests | [log](logs/acceptance-unit@2.1.295.log) |
| privacy-scan | pass | 5 CT-SEC-001 marker(s), 0 leak(s) in the evidence |  |

## MUST 场景（定稿兼容与验收契约 §4 及其后续修订）

每格是该版本上这个场景 ID 的记录数与结果（一个 ID 可以有多条记录，例如 CT-COMPAT-003 的五种情形）。

| 场景 | 2.1.287 | 2.1.295 |
|---|---|---|
| CT-COMPAT-001 | 通过（1/1） | 通过（1/1） |
| CT-COMPAT-002 | 通过（1/1） | 通过（1/1） |
| CT-COMPAT-003 | 通过（5/5） | 通过（5/5） |
| CT-DATA-001 | 通过（1/1） | 通过（1/1） |
| CT-DATA-002 | 通过（1/1） | 通过（1/1） |
| CT-DATA-003 | 通过（1/1） | 通过（1/1） |
| CT-DATA-004 | 通过（1/1） | 通过（1/1） |
| CT-DATA-005 | 通过（1/1） | 通过（1/1） |
| CT-DATA-006 | 通过（1/1） | 通过（1/1） |
| CT-TURN-001 | 通过（1/1） | 通过（1/1） |
| CT-TURN-002 | 通过（1/1） | 通过（1/1） |
| CT-TURN-003 | 通过（1/1） | 通过（1/1） |
| CT-TURN-004 | 通过（2/2） | 通过（2/2） |
| CT-TURN-005 | 通过（1/1） | 通过（1/1） |
| CT-LIFE-001 | 通过（1/1） | 通过（1/1） |
| CT-LIFE-002 | 通过（1/1） | 通过（1/1） |
| CT-LIFE-003 | 通过（1/1） | 通过（1/1） |
| CT-LIFE-004 | 通过（1/1） | 通过（1/1） |
| CT-LIFE-005 | 通过（4/4） | 通过（4/4） |
| CT-LIFE-006 | 通过（1/1） | 通过（1/1） |
| CT-UI-001 | 通过（1/1） | 通过（1/1） |
| CT-UI-002 | 通过（1/1） | 通过（1/1） |
| CT-UI-003 | 通过（1/1） | 通过（1/1） |
| CT-JUMP-001 | 通过（1/1） | 通过（1/1） |
| CT-JUMP-002 | 通过（2/2） | 通过（2/2） |
| CT-JUMP-003 | 通过（1/1） | 通过（1/1） |
| CT-POS-001 | 通过（1/1） | 通过（1/1） |
| CT-POS-002 | 通过（1/1） | 通过（1/1） |
| CT-POS-003 | 通过（1/1） | 通过（1/1） |
| CT-PERF-001 | 通过（6/6） | 通过（6/6） |
| CT-SEC-001 | 通过（1/1） | 通过（1/1） |
| CT-COEX-001 | 通过（1/1） | 通过（1/1） |

## CT-PERF-001（20 MiB，两种 fixture × 两个版本 × 3 次，取各次 p95 中最差的）

| 项 | 阈值 | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| 首次出目录：TOC 比宿主 transcript 显示末轮晚 | ≤ 4 s | 0.70 s | 0.53 s | 0.70 s | 0.53 s |
| 启动时首次整份读取加重组（与宿主 resume 争抢，参考） | — | 362 ms | 218 ms | 361 ms | 209 ms |
| 空闲时整份读取加重组（热重载后） | ≤ 1 s | 359 ms | 192 ms | 360 ms | 209 ms |
| 增量读取，单次 | ≤ 150 ms | 120.15 ms | 43 ms | 105.75 ms | 141.49 ms |
| 追加一行到目录模型更新 | ≤ 1 s | 480.79 ms | 347.54 ms | 470.75 ms | 331.84 ms |
| Pane 重画，插件自身计算 | ≤ 16 ms | 0.38 ms | 0.37 ms | 0.38 ms | 0.39 ms |
| Pane 重画，含等宿主 | ≤ 100 ms | 2.58 ms | 8.67 ms | 2.38 ms | 8.16 ms |
| Current position 每次计算 | ≤ 2 ms | 0.03 ms | 0.02 ms | 0.03 ms | 0.02 ms |
| 长会话连续滚动、跳转到首组和末组 | 必须能到达，不分页 | 是 | 是 | 是 | 是 |
| 实际残留在屏记录（最多） | — | 31 | 11 | 30 | 11 |
| 运行次数（全部通过） | 3 | 3（3） | 3（3） | 3（3） | 3（3） |

## 人工目检（待使用者签字）

> 不是发布阻断项（契约 §3、§5）。实现者没有签这一项：请使用者看下面的截屏（以及在自己的终端里实际看一次），确认三种 Layout（卡片、紧凑、时间轴）的观感，以及青色高亮与反色选择光标能一眼分清，然后在本节填写。

- 本次发布门禁重新截的屏（被测提交、两个版本、36/44/56 列，每组：卡片、紧凑、时间轴、卡片+只看用户、卡片+只看 Agent）：`signoff/<版本>-<列宽>/`
- 25 号票当时的截屏：`.scratch/chat-toc/assets/25-layouts/screens/`（2.1.287 与 2.1.295，36/44/56 列）
- 青色与反色在文本截屏里看不出颜色；颜色由 CT-UI-003 自动核对（高亮 `▌` 前景 `05a2c2`、不反色；选择光标反色，二者不在同一行），观感仍需真人看。

| 项 | 结论 | 签字 | 日期 |
| --- | --- | --- | --- |
| 三种 Layout 的观感 | 待填 | 待使用者签字 | |
| 青色高亮与反色选择光标能分清 | 待填 | 待使用者签字 | |

## 各场景记录

### CT-COMPAT-001 · 2.1.287 · pass

- fixture: turns 40
- 预期: cold start, fullscreen, --plugin-dir: the Pane docks on the right by itself (host: unasked, placed); its whole list equals the verifier's; plugin validate passes with 0 errors
- 实际: `{"paneLeftColumn": 126, "dockedRight": true, "hostOpens": ["ui.open chat-toc chat-toc (unasked, 170 columns): placed"], "openedUnasked": true, "wholeList": {"ok": true, "covered": 40, "missing": [], "windows": 18}, "validate": {"exit": 0, "passed": true, "errors": 0}}`
- 证据: [debug-compat-001.log](pty/2.1.287/gate/debug-compat-001.log), [001-compat-001-docked-by-itself.txt](pty/2.1.287/gate/screens/001-compat-001-docked-by-itself.txt), [whole-01.json](pty/2.1.287/gate/whole-01.json), [validate-2.1.287.log](pty/2.1.287/gate/validate-2.1.287.log)

### CT-COMPAT-001 · 2.1.295 · pass

- fixture: turns 40
- 预期: cold start, fullscreen, --plugin-dir: the Pane docks on the right by itself (host: unasked, placed); its whole list equals the verifier's; plugin validate passes with 0 errors
- 实际: `{"paneLeftColumn": 126, "dockedRight": true, "hostOpens": ["ui.open chat-toc chat-toc (unasked, 170 columns): placed"], "openedUnasked": true, "wholeList": {"ok": true, "covered": 40, "missing": [], "windows": 18}, "validate": {"exit": 0, "passed": true, "errors": 0}}`
- 证据: [debug-compat-001.log](pty/2.1.295/gate/debug-compat-001.log), [001-compat-001-docked-by-itself.txt](pty/2.1.295/gate/screens/001-compat-001-docked-by-itself.txt), [whole-01.json](pty/2.1.295/gate/whole-01.json), [validate-2.1.295.log](pty/2.1.295/gate/validate-2.1.295.log)

### CT-COMPAT-002 · 2.1.287 · pass

- fixture: turns 12
- 预期: marketplace add + install succeed; plugin list shows chat-toc@cc-mods 0.1.0 enabled; the Pane (loaded as chat-toc@cc-mods, no --plugin-dir) docks by itself; a click on T0000's user side puts that prompt at the top
- 实际: `{"source": "<repo>", "exits": [0, 0, 0], "listed": {"version": "0.1.0", "status": "enabled"}, "installedManifests": ["plugins/cache/cc-mods/chat-toc/0.1.0/.claude-plugin/plugin.json"], "loadedAs": ["chat-toc@cc-mods"], "openedUnasked": true, "clickJumped": true}`
- 证据: [commands-local-2.1.287.txt](pty/2.1.287/ct-marketplace/commands-local-2.1.287.txt), [001-local-2-1-287-docked-by-itself.txt](pty/2.1.287/ct-marketplace/screens/001-local-2-1-287-docked-by-itself.txt), [002-local-2-1-287-after-clicking-T0000.txt](pty/2.1.287/ct-marketplace/screens/002-local-2-1-287-after-clicking-T0000.txt), [debug-local-2.1.287-chat-toc-lines.log](pty/2.1.287/ct-marketplace/debug-local-2.1.287-chat-toc-lines.log)

### CT-COMPAT-002 · 2.1.295 · pass

- fixture: turns 12
- 预期: marketplace add + install succeed; plugin list shows chat-toc@cc-mods 0.1.0 enabled; the Pane (loaded as chat-toc@cc-mods, no --plugin-dir) docks by itself; a click on T0000's user side puts that prompt at the top
- 实际: `{"source": "<repo>", "exits": [0, 0, 0], "listed": {"version": "0.1.0", "status": "enabled"}, "installedManifests": ["plugins/cache/cc-mods/chat-toc/0.1.0/.claude-plugin/plugin.json"], "loadedAs": ["chat-toc@cc-mods"], "openedUnasked": true, "clickJumped": true}`
- 证据: [commands-local-2.1.295.txt](pty/2.1.295/ct-marketplace/commands-local-2.1.295.txt), [001-local-2-1-295-docked-by-itself.txt](pty/2.1.295/ct-marketplace/screens/001-local-2-1-295-docked-by-itself.txt), [002-local-2-1-295-after-clicking-T0000.txt](pty/2.1.295/ct-marketplace/screens/002-local-2-1-295-after-clicking-T0000.txt), [debug-local-2.1.295-chat-toc-lines.log](pty/2.1.295/ct-marketplace/debug-local-2.1.295-chat-toc-lines.log)

### CT-COMPAT-003 asked · 2.1.287 · pass

- fixture: turns 6
- 预期: at 100 columns /chat-toc places the Pane inline listing entries and the
status line says how to dock; at 170 the host docks it and the line
clears; back at 100 it is withdrawn like any docked Pane
- 实际: `{"inlineListsEntries": true, "inlineKept": true, "docksWhenWide": true, "withdrawnAfterDocking": true}`
- 证据: [debug-asked.log](pty/2.1.287/ct-compat/debug-asked.log), [008-asked-100-before--chat-toc.txt](pty/2.1.287/ct-compat/screens/008-asked-100-before--chat-toc.txt), [009-asked-100-inline.txt](pty/2.1.287/ct-compat/screens/009-asked-100-inline.txt), [010-asked-170-docked.txt](pty/2.1.287/ct-compat/screens/010-asked-170-docked.txt), [011-asked-back-to-100.txt](pty/2.1.287/ct-compat/screens/011-asked-back-to-100.txt)

### CT-COMPAT-003 main · 2.1.287 · pass

- fixture: turns 6
- 预期: on the main screen nothing opens by itself and the status line names
/tui fullscreen; /chat-toc places the Pane inline, listing entries, with
the asked main-screen status line
- 实际: `{"noPane": true, "opens": [], "noOpenByItself": true, "inlineListsEntries": true}`
- 证据: [debug-main.log](pty/2.1.287/ct-compat/debug-main.log), [012-main-170.txt](pty/2.1.287/ct-compat/screens/012-main-170.txt), [013-main--chat-toc-inline.txt](pty/2.1.287/ct-compat/screens/013-main--chat-toc-inline.txt)

### CT-COMPAT-003 narrowed · 2.1.287 · pass

- fixture: turns 6
- 预期: docked at 170 stays docked at 130; at 100 the plugin closes the Pane the
host turned inline (origin plugin) and the narrow status line shows, no
inline Pane is left; back at 170 it docks again and the line clears
- 实际: `{"stillDockedAt130": true, "at100": ["hooks module chat-toc@inline ui.close skipped: re-entry (the plugin's own code raised it; origin chat-toc)", "ui.open chat-toc chat-toc (unasked, 100 columns): waits unplaced (unasked below 144 columns (100 now): placed when the person opens it, or when the terminal is widened to 144 columns)", "hooks module chat-toc@inline ui.close skipped: re-entry (the plu…`
- 证据: [debug-narrowed.log](pty/2.1.287/ct-compat/debug-narrowed.log), [004-narrowed-170.txt](pty/2.1.287/ct-compat/screens/004-narrowed-170.txt), [005-narrowed-130.txt](pty/2.1.287/ct-compat/screens/005-narrowed-130.txt), [006-narrowed-100.txt](pty/2.1.287/ct-compat/screens/006-narrowed-100.txt), [007-narrowed-back-to-170.txt](pty/2.1.287/ct-compat/screens/007-narrowed-back-to-170.txt)

### CT-COMPAT-003 reload · 2.1.287 · pass

- fixture: turns 6
- 预期: waiting at 120 columns, a hot reload opens no second Pane and the narrow
status line is still up afterwards
- 实际: `{"afterReload": [], "noSecondOpen": true, "statusKept": true}`
- 证据: [debug-reload.log](pty/2.1.287/ct-compat/debug-reload.log), [014-reload-120-after.txt](pty/2.1.287/ct-compat/screens/014-reload-120-after.txt)

### CT-COMPAT-003 waiting · 2.1.287 · pass

- fixture: turns 6
- 预期: unasked at 120 columns waits undrawn with the narrow status line; at the
host's floor N-1 it still waits, at N it docks and the line clears
- 实际: `{"noPaneAt120": true, "hostFloor": 144, "hostLine": ["ui.open chat-toc chat-toc (unasked, 120 columns): waits unplaced (unasked below 144 columns (120 now): placed when the person opens it, or when the terminal is widened to 144 columns)"], "waitsBelowFloor": true, "docksAtFloor": true, "statusClearedOnDock": true}`
- 证据: [debug-waiting.log](pty/2.1.287/ct-compat/debug-waiting.log), [001-waiting-120.txt](pty/2.1.287/ct-compat/screens/001-waiting-120.txt), [002-waiting-143.txt](pty/2.1.287/ct-compat/screens/002-waiting-143.txt), [003-waiting-144-docked.txt](pty/2.1.287/ct-compat/screens/003-waiting-144-docked.txt)

### CT-COMPAT-003 asked · 2.1.295 · pass

- fixture: turns 6
- 预期: at 100 columns /chat-toc places the Pane inline listing entries and the
status line says how to dock; at 170 the host docks it and the line
clears; back at 100 it is withdrawn like any docked Pane
- 实际: `{"inlineListsEntries": true, "inlineKept": true, "docksWhenWide": true, "withdrawnAfterDocking": true}`
- 证据: [debug-asked.log](pty/2.1.295/ct-compat/debug-asked.log), [008-asked-100-before--chat-toc.txt](pty/2.1.295/ct-compat/screens/008-asked-100-before--chat-toc.txt), [009-asked-100-inline.txt](pty/2.1.295/ct-compat/screens/009-asked-100-inline.txt), [010-asked-170-docked.txt](pty/2.1.295/ct-compat/screens/010-asked-170-docked.txt), [011-asked-back-to-100.txt](pty/2.1.295/ct-compat/screens/011-asked-back-to-100.txt)

### CT-COMPAT-003 main · 2.1.295 · pass

- fixture: turns 6
- 预期: on the main screen nothing opens by itself and the status line names
/tui fullscreen; /chat-toc places the Pane inline, listing entries, with
the asked main-screen status line
- 实际: `{"noPane": true, "opens": [], "noOpenByItself": true, "inlineListsEntries": true}`
- 证据: [debug-main.log](pty/2.1.295/ct-compat/debug-main.log), [012-main-170.txt](pty/2.1.295/ct-compat/screens/012-main-170.txt), [013-main--chat-toc-inline.txt](pty/2.1.295/ct-compat/screens/013-main--chat-toc-inline.txt)

### CT-COMPAT-003 narrowed · 2.1.295 · pass

- fixture: turns 6
- 预期: docked at 170 stays docked at 130; at 100 the plugin closes the Pane the
host turned inline (origin plugin) and the narrow status line shows, no
inline Pane is left; back at 170 it docks again and the line clears
- 实际: `{"stillDockedAt130": true, "at100": ["hooks module chat-toc@inline ui.close skipped: re-entry (the plugin's own code raised it; origin chat-toc)", "ui.open chat-toc chat-toc (unasked, 100 columns): waits unplaced (unasked below 144 columns (100 now): placed when the person opens it, or when the terminal is widened to 144 columns)"], "withdrawnAndWaiting": true, "noInlineLeftAt100": true, "docksAg…`
- 证据: [debug-narrowed.log](pty/2.1.295/ct-compat/debug-narrowed.log), [004-narrowed-170.txt](pty/2.1.295/ct-compat/screens/004-narrowed-170.txt), [005-narrowed-130.txt](pty/2.1.295/ct-compat/screens/005-narrowed-130.txt), [006-narrowed-100.txt](pty/2.1.295/ct-compat/screens/006-narrowed-100.txt), [007-narrowed-back-to-170.txt](pty/2.1.295/ct-compat/screens/007-narrowed-back-to-170.txt)

### CT-COMPAT-003 reload · 2.1.295 · pass

- fixture: turns 6
- 预期: waiting at 120 columns, a hot reload opens no second Pane and the narrow
status line is still up afterwards
- 实际: `{"afterReload": [], "noSecondOpen": true, "statusKept": true}`
- 证据: [debug-reload.log](pty/2.1.295/ct-compat/debug-reload.log), [014-reload-120-after.txt](pty/2.1.295/ct-compat/screens/014-reload-120-after.txt)

### CT-COMPAT-003 waiting · 2.1.295 · pass

- fixture: turns 6
- 预期: unasked at 120 columns waits undrawn with the narrow status line; at the
host's floor N-1 it still waits, at N it docks and the line clears
- 实际: `{"noPaneAt120": true, "hostFloor": 144, "hostLine": ["ui.open chat-toc chat-toc (unasked, 120 columns): waits unplaced (unasked below 144 columns (120 now): placed when the person opens it, or when the terminal is widened to 144 columns)"], "waitsBelowFloor": true, "docksAtFloor": true, "statusClearedOnDock": true}`
- 证据: [debug-waiting.log](pty/2.1.295/ct-compat/debug-waiting.log), [001-waiting-120.txt](pty/2.1.295/ct-compat/screens/001-waiting-120.txt), [002-waiting-143.txt](pty/2.1.295/ct-compat/screens/002-waiting-143.txt), [003-waiting-144-docked.txt](pty/2.1.295/ct-compat/screens/003-waiting-144-docked.txt)

### CT-DATA-001 · 2.1.287 · pass

- fixture: new session
- 预期: before the first message no transcript file exists and the Pane's body is the one line 本会话还没有对话; after the first submit it lists the new file's chain (verifier)
- 实际: `{"before": {"entries": 0, "notes": ["本会话还没有对话"], "transcriptFiles": 0}, "filesAfterSubmit": 1, "after": {"entries": [{"row": 1, "userHead": "你 · 10月11日 19:32", "userLines": ["CT-SYN 第一条合成 prompt"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "highlighted": true}], "expected": ["CT-SYN 第一条合成 prompt"]}}`
- 证据: [debug-data-001.log](pty/2.1.287/gate/debug-data-001.log), [020-data-001-new-session--before-the-first-message.txt](pty/2.1.287/gate/screens/020-data-001-new-session--before-the-first-message.txt), [021-data-001-after-the-first-submit.txt](pty/2.1.287/gate/screens/021-data-001-after-the-first-submit.txt)

### CT-DATA-001 · 2.1.295 · pass

- fixture: new session
- 预期: before the first message no transcript file exists and the Pane's body is the one line 本会话还没有对话; after the first submit it lists the new file's chain (verifier)
- 实际: `{"before": {"entries": 0, "notes": ["本会话还没有对话"], "transcriptFiles": 0}, "filesAfterSubmit": 1, "after": {"entries": [{"row": 2, "userHead": "你 · 10月11日 19:32", "userLines": ["CT-SYN 第一条合成 prompt"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "highlighted": true}], "expected": ["CT-SYN 第一条合成 prompt"]}}`
- 证据: [debug-data-001.log](pty/2.1.295/gate/debug-data-001.log), [020-data-001-new-session--before-the-first-message.txt](pty/2.1.295/gate/screens/020-data-001-new-session--before-the-first-message.txt), [021-data-001-after-the-first-submit.txt](pty/2.1.295/gate/screens/021-data-001-after-the-first-submit.txt)

### CT-DATA-002 · 2.1.287 · pass

- fixture: turns 6; mode 000, then a directory, re-read by hot reloads
- 预期: an unreadable transcript shows no entries and keeps the reason at the bottom (没有权限… / 读不到…), nothing pieced together from elsewhere; readable again, the entries come back
- 实际: `{"denied": {"entries": 0, "reasonShown": true}, "failed": {"entries": 0, "reasonShown": true}, "readableAgain": {"ok": true, "notes": []}}`
- 证据: [debug-data-002.log](pty/2.1.287/gate/debug-data-002.log), [022-data-002-readable.txt](pty/2.1.287/gate/screens/022-data-002-readable.txt), [023-data-002-mode-000-after-a-re-read.txt](pty/2.1.287/gate/screens/023-data-002-mode-000-after-a-re-read.txt), [024-data-002-a-directory-in-its-place-after-a-re-read.txt](pty/2.1.287/gate/screens/024-data-002-a-directory-in-its-place-after-a-re-read.txt), [025-data-002-readable-again.txt](pty/2.1.287/gate/screens/025-data-002-readable-again.txt)

### CT-DATA-002 · 2.1.295 · pass

- fixture: turns 6; mode 000, then a directory, re-read by hot reloads
- 预期: an unreadable transcript shows no entries and keeps the reason at the bottom (没有权限… / 读不到…), nothing pieced together from elsewhere; readable again, the entries come back
- 实际: `{"denied": {"entries": 0, "reasonShown": true}, "failed": {"entries": 0, "reasonShown": true}, "readableAgain": {"ok": true, "notes": []}}`
- 证据: [debug-data-002.log](pty/2.1.295/gate/debug-data-002.log), [022-data-002-readable.txt](pty/2.1.295/gate/screens/022-data-002-readable.txt), [023-data-002-mode-000-after-a-re-read.txt](pty/2.1.295/gate/screens/023-data-002-mode-000-after-a-re-read.txt), [024-data-002-a-directory-in-its-place-after-a-re-read.txt](pty/2.1.295/gate/screens/024-data-002-a-directory-in-its-place-after-a-re-read.txt), [025-data-002-readable-again.txt](pty/2.1.295/gate/screens/025-data-002-readable-again.txt)

### CT-DATA-003 · 2.1.287 · pass

- fixture: turns 6 with 3 lines that are not rows
- 预期: the lines are skipped, every row is still listed (verifier), and the bottom says 有 3 行无法识别，目录可能不完整 (N the actual count)
- 实际: `{"verifierUnreadable": 3, "noteShown": true, "wholeList": {"ok": true, "covered": 6, "missing": []}}`
- 证据: [026-data-003-three-unreadable-lines.txt](pty/2.1.287/gate/screens/026-data-003-three-unreadable-lines.txt), [whole-02.json](pty/2.1.287/gate/whole-02.json)

### CT-DATA-003 · 2.1.295 · pass

- fixture: turns 6 with 3 lines that are not rows
- 预期: the lines are skipped, every row is still listed (verifier), and the bottom says 有 3 行无法识别，目录可能不完整 (N the actual count)
- 实际: `{"verifierUnreadable": 3, "noteShown": true, "wholeList": {"ok": true, "covered": 6, "missing": []}}`
- 证据: [026-data-003-three-unreadable-lines.txt](pty/2.1.295/gate/screens/026-data-003-three-unreadable-lines.txt), [whole-02.json](pty/2.1.295/gate/whole-02.json)

### CT-DATA-004 · 2.1.287 · pass

- fixture: heavy 9 MiB (rows across the 4,000,000 B and 8,000,000 B chunk edges)
- 预期: the chunked first read lists what the whole file holds (verifier, every window), rows split across chunk edges included; the next submit is read incrementally: one chunk from the last offset, no whole re-read
- 实际: `{"fileBytes": 9455432, "linesAcrossChunkEdges": {"4000000": true, "8000000": true}, "wholeList": {"ok": true, "covered": 48, "missing": [], "windows": 23}, "readWhole": [{"ms": 124.94, "chunks": 3, "groups": 48, "size": 9455515}], "readTailAfterSubmit": [{"ms": 12.78, "chunks": 1, "size": 9513538}], "wholeReadsAfterSubmit": 0, "sizeBeforeSubmit": 9455515}`
- 证据: [debug-data-004.log](pty/2.1.287/gate/debug-data-004.log), [029-data-004-resumed-9-MiB.txt](pty/2.1.287/gate/screens/029-data-004-resumed-9-MiB.txt), [whole-03.json](pty/2.1.287/gate/whole-03.json), [053-data-004-after-a-submit.txt](pty/2.1.287/gate/screens/053-data-004-after-a-submit.txt)

### CT-DATA-004 · 2.1.295 · pass

- fixture: heavy 9 MiB (rows across the 4,000,000 B and 8,000,000 B chunk edges)
- 预期: the chunked first read lists what the whole file holds (verifier, every window), rows split across chunk edges included; the next submit is read incrementally: one chunk from the last offset, no whole re-read
- 实际: `{"fileBytes": 9455432, "linesAcrossChunkEdges": {"4000000": true, "8000000": true}, "wholeList": {"ok": true, "covered": 48, "missing": [], "windows": 23}, "readWhole": [{"ms": 153.88, "chunks": 3, "groups": 48, "size": 9455515}], "readTailAfterSubmit": [{"ms": 11.74, "chunks": 1, "size": 9512670}, {"ms": 26.92, "chunks": 1, "size": 9514359}], "wholeReadsAfterSubmit": 0, "sizeBeforeSubmit": 94555…`
- 证据: [debug-data-004.log](pty/2.1.295/gate/debug-data-004.log), [029-data-004-resumed-9-MiB.txt](pty/2.1.295/gate/screens/029-data-004-resumed-9-MiB.txt), [whole-03.json](pty/2.1.295/gate/whole-03.json), [053-data-004-after-a-submit.txt](pty/2.1.295/gate/screens/053-data-004-after-a-submit.txt)

### CT-DATA-005 · 2.1.287 · pass

- fixture: forms
- 预期: a subagent's rows are not listed; the subagent call is 1 step; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"subagentOneStep": true, "subagentContentNotListed": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.287/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-DATA-005 · 2.1.295 · pass

- fixture: forms
- 预期: a subagent's rows are not listed; the subagent call is 1 step; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"subagentOneStep": true, "subagentContentNotListed": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-DATA-006 · 2.1.287 · pass

- fixture: data-006
- 预期: each terminal lists only its own session's chain, before and after a submit in one of them
- 实际: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3"]}, "B": {"ok": true, "expected": 3, "covered": 3, "missing": [], "users": ["Q00 合成问题 0", "Q01 合成问题 1", "Q02 合成问题 2"]}, "AafterSubmit": {"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3", "P 终端一里提交的合成 …`
- 证据: [012-terminal-1--session-A.txt](pty/2.1.287/chain/screens/012-terminal-1--session-A.txt), [012-terminal-1--session-A-diff.json](pty/2.1.287/chain/012-terminal-1--session-A-diff.json), [013-terminal-2--session-B.txt](pty/2.1.287/chain/screens/013-terminal-2--session-B.txt), [013-terminal-2--session-B-diff.json](pty/2.1.287/chain/013-terminal-2--session-B-diff.json), [014-terminal-1-after-its-submit.txt](pty/2.1.287/chain/screens/014-terminal-1-after-its-submit.txt), [014-terminal-1-after-its-submit-diff.json](pty/2.1.287/chain/014-terminal-1-after-its-submit-diff.json) 等 8 个

### CT-DATA-006 · 2.1.295 · pass

- fixture: data-006
- 预期: each terminal lists only its own session's chain, before and after a submit in one of them
- 实际: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3"]}, "B": {"ok": true, "expected": 3, "covered": 3, "missing": [], "users": ["Q00 合成问题 0", "Q01 合成问题 1", "Q02 合成问题 2"]}, "AafterSubmit": {"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3", "P 终端一里提交的合成 …`
- 证据: [012-terminal-1--session-A.txt](pty/2.1.295/chain/screens/012-terminal-1--session-A.txt), [012-terminal-1--session-A-diff.json](pty/2.1.295/chain/012-terminal-1--session-A-diff.json), [013-terminal-2--session-B.txt](pty/2.1.295/chain/screens/013-terminal-2--session-B.txt), [013-terminal-2--session-B-diff.json](pty/2.1.295/chain/013-terminal-2--session-B-diff.json), [014-terminal-1-after-its-submit.txt](pty/2.1.295/chain/screens/014-terminal-1-after-its-submit.txt), [014-terminal-1-after-its-submit-diff.json](pty/2.1.295/chain/014-terminal-1-after-its-submit-diff.json) 等 8 个

### CT-TURN-001 · 2.1.287 · pass

- fixture: forms
- 预期: prompts, slash commands (a user row, a system/local_command row), a prompt-type command, !cmd and a queued prompt each open a group; output, notices, interrupts and reminders open none; local commands and !cmd have a user side only; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"prompt": true, "slashPrompt": true, "localCommandUserRow": true, "localCommandSystemRow": true, "bang": true, "queued": true, "noOutputOrNoticeGroups": true, "localCommandsUserSideOnly": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.287/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-001 · 2.1.295 · pass

- fixture: forms
- 预期: prompts, slash commands (a user row, a system/local_command row), a prompt-type command, !cmd and a queued prompt each open a group; output, notices, interrupts and reminders open none; local commands and !cmd have a user side only; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"prompt": true, "slashPrompt": true, "localCommandUserRow": true, "localCommandSystemRow": true, "bang": true, "queued": true, "noOutputOrNoticeGroups": true, "localCommandsUserSideOnly": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-002 · 2.1.287 · pass

- fixture: forms
- 预期: three identical prompts are three entries; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"identicalPromptEntries": 3}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.287/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-002 · 2.1.295 · pass

- fixture: forms
- 预期: three identical prompts are three entries; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"identicalPromptEntries": 3}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-003 · 2.1.287 · pass

- fixture: forms
- 预期: multi-line CJK/emoji text is cut to 2 lines by cell width with …; <pasted_content> tags removed; an image-only prompt says （只有图片）; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"multilineTwoLinesWithEllipsis": true, "multilineLines": ["F02 多行与宽字符：第一行中文 第二行 emoji", "🚀✨ 与全角，ＡＢＣ 第三行很长很长很长很…"], "pasteTagsGone": true, "imageOnly": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.287/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-003 · 2.1.295 · pass

- fixture: forms
- 预期: multi-line CJK/emoji text is cut to 2 lines by cell width with …; <pasted_content> tags removed; an image-only prompt says （只有图片）; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"multilineTwoLinesWithEllipsis": true, "multilineLines": ["F02 多行与宽字符：第一行中文 第二行 emoji", "🚀✨ 与全角，ＡＢＣ 第三行很长很长很长很…"], "pasteTagsGone": true, "imageOnly": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-004 · 2.1.287 · pass

- fixture: forms
- 预期: the Agent side reads N 步 with the last text, N 步 · 无文字回复, 已中断 · N 步, 出错 · N 步 as the file has it (the live 进行中 · N 步: turn-004-live); the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"stepsAndLastText": true, "noTextReply": true, "interrupted": true, "error": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.287/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-004 · 2.1.287 · pass

- fixture: turns 3 + one live turn against fake_api.py (two Read steps, 4 s apart; no model)
- 预期: while the turn runs the last entry reads 进行中, then 进行中 · 1 步, 进行中 · 2 步 as the steps land; after it, 2 步 with the closing text, as the verifier reads the file
- 实际: `{"final": {"row": 22, "userHead": "你 · 10月11日 19:34", "userLines": ["CT-TURN-004 进行中的合成一轮"], "agentHead": "2 步", "agentLines": ["完成"], "highlighted": true}, "finalMatchesVerifier": true, "requests": [{"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 0}, {"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 1}, {"m…`
- 证据: [062-turn-004-live-3-步.txt](pty/2.1.287/gate/screens/062-turn-004-live-3-步.txt), [063-turn-004-live-进行中.txt](pty/2.1.287/gate/screens/063-turn-004-live-进行中.txt), [064-turn-004-live-进行中---1-步.txt](pty/2.1.287/gate/screens/064-turn-004-live-进行中---1-步.txt), [065-turn-004-live-进行中---2-步.txt](pty/2.1.287/gate/screens/065-turn-004-live-进行中---2-步.txt), [066-turn-004-live-2-步.txt](pty/2.1.287/gate/screens/066-turn-004-live-2-步.txt), [067-turn-004-live-done.txt](pty/2.1.287/gate/screens/067-turn-004-live-done.txt)

### CT-TURN-004 · 2.1.295 · pass

- fixture: forms
- 预期: the Agent side reads N 步 with the last text, N 步 · 无文字回复, 已中断 · N 步, 出错 · N 步 as the file has it (the live 进行中 · N 步: turn-004-live); the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"stepsAndLastText": true, "noTextReply": true, "interrupted": true, "error": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-004 · 2.1.295 · pass

- fixture: turns 3 + one live turn against fake_api.py (two Read steps, 4 s apart; no model)
- 预期: while the turn runs the last entry reads 进行中, then 进行中 · 1 步, 进行中 · 2 步 as the steps land; after it, 2 步 with the closing text, as the verifier reads the file
- 实际: `{"final": {"row": 23, "userHead": "你 · 10月11日 19:34", "userLines": ["CT-TURN-004 进行中的合成一轮"], "agentHead": "2 步", "agentLines": ["完成"], "highlighted": true}, "finalMatchesVerifier": true, "requests": [{"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 0}, {"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 1}, {"m…`
- 证据: [062-turn-004-live-3-步.txt](pty/2.1.295/gate/screens/062-turn-004-live-3-步.txt), [063-turn-004-live-进行中.txt](pty/2.1.295/gate/screens/063-turn-004-live-进行中.txt), [064-turn-004-live-进行中---1-步.txt](pty/2.1.295/gate/screens/064-turn-004-live-进行中---1-步.txt), [065-turn-004-live-进行中---2-步.txt](pty/2.1.295/gate/screens/065-turn-004-live-进行中---2-步.txt), [066-turn-004-live-2-步.txt](pty/2.1.295/gate/screens/066-turn-004-live-2-步.txt), [067-turn-004-live-done.txt](pty/2.1.295/gate/screens/067-turn-004-live-done.txt)

### CT-TURN-005 · 2.1.287 · pass

- fixture: forms
- 预期: time from the row's timestamp; the row without one shows no time; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"noTimestampNoTime": true, "othersTimed": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.287/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-005 · 2.1.295 · pass

- fixture: forms
- 预期: time from the row's timestamp; the row without one shows no time; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"noTimestampNoTime": true, "othersTimed": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-LIFE-001 · 2.1.287 · pass

- fixture: turns 6
- 预期: opens by itself; ✕ keeps it closed across a hot reload (no ui.open); /chat-toc reopens it focused and never closes; a hot reload with it open makes no ui.open; a new process opens it again
- 实际: `{"openedByItself": true, "closedOnMark": true, "reloadWithPaneClosed": {"opens": []}, "closedAfterReload": true, "reopenedByCommand": true, "reopenedFocused": true, "stillOpenAfterSecondCommand": true, "reloadWithPaneOpen": {"opens": []}, "oneOpenAfterReload": true, "newProcessOpens": true}`
- 证据: [debug-001-first.log](pty/2.1.287/ct-life/debug-001-first.log), [001-001-opened-by-itself.txt](pty/2.1.287/ct-life/screens/001-001-opened-by-itself.txt), [002-001-after-clicking-the-close-mark-at--0--169-.txt](pty/2.1.287/ct-life/screens/002-001-after-clicking-the-close-mark-at--0--169-.txt), [003-001-after-a-hot-reload-with-the-Pane-closed.txt](pty/2.1.287/ct-life/screens/003-001-after-a-hot-reload-with-the-Pane-closed.txt), [004-001--chat-toc-opened-it.txt](pty/2.1.287/ct-life/screens/004-001--chat-toc-opened-it.txt), [005-001-l-pressed-after--chat-toc-reopened-it.txt](pty/2.1.287/ct-life/screens/005-001-l-pressed-after--chat-toc-reopened-it.txt) 等 10 个

### CT-LIFE-001 · 2.1.295 · pass

- fixture: turns 6
- 预期: opens by itself; ✕ keeps it closed across a hot reload (no ui.open); /chat-toc reopens it focused and never closes; a hot reload with it open makes no ui.open; a new process opens it again
- 实际: `{"openedByItself": true, "closedOnMark": true, "reloadWithPaneClosed": {"opens": []}, "closedAfterReload": true, "reopenedByCommand": true, "reopenedFocused": true, "stillOpenAfterSecondCommand": true, "reloadWithPaneOpen": {"opens": []}, "oneOpenAfterReload": true, "newProcessOpens": true}`
- 证据: [debug-001-first.log](pty/2.1.295/ct-life/debug-001-first.log), [001-001-opened-by-itself.txt](pty/2.1.295/ct-life/screens/001-001-opened-by-itself.txt), [002-001-after-clicking-the-close-mark-at--0--168-.txt](pty/2.1.295/ct-life/screens/002-001-after-clicking-the-close-mark-at--0--168-.txt), [003-001-after-a-hot-reload-with-the-Pane-closed.txt](pty/2.1.295/ct-life/screens/003-001-after-a-hot-reload-with-the-Pane-closed.txt), [004-001--chat-toc-opened-it.txt](pty/2.1.295/ct-life/screens/004-001--chat-toc-opened-it.txt), [005-001-l-pressed-after--chat-toc-reopened-it.txt](pty/2.1.295/ct-life/screens/005-001-l-pressed-after--chat-toc-reopened-it.txt) 等 10 个

### CT-LIFE-002 · 2.1.287 · pass

- fixture: turns 6
- 预期: /clear lists just the new session's chain (verifier), nothing of the old and no line parting them; after ✕, /clear opens the Pane again
- 实际: `{"afterClearOpen": {"entries": [{"row": 1, "userHead": "你 · 10月11日 19:27", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "highlighted": false}], "notes": [], "file": "c27419fb-0d8c-4b05-b71c-d81fa2f8c8ee.jsonl"}, "rebuilt": true, "afterClearClosed": {"entries": [{"row": 1, "userHead": "你 · 10月11日 19:27", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "highlighted": …`
- 证据: [debug-002.log](pty/2.1.287/ct-life/debug-002.log), [009-002-opened-by-itself.txt](pty/2.1.287/ct-life/screens/009-002-opened-by-itself.txt), [010-002-after--clear-with-the-Pane-open.txt](pty/2.1.287/ct-life/screens/010-002-after--clear-with-the-Pane-open.txt), [011-002-closed-by--.txt](pty/2.1.287/ct-life/screens/011-002-closed-by--.txt), [012-002--clear-after---opened-it-again.txt](pty/2.1.287/ct-life/screens/012-002--clear-after---opened-it-again.txt)

### CT-LIFE-002 · 2.1.295 · pass

- fixture: turns 6
- 预期: /clear lists just the new session's chain (verifier), nothing of the old and no line parting them; after ✕, /clear opens the Pane again
- 实际: `{"afterClearOpen": {"entries": [{"row": 2, "userHead": "你 · 10月11日 19:27", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "highlighted": false}], "notes": [], "file": "9d7f9c2a-b2da-4b94-81bb-5872ff16f080.jsonl"}, "rebuilt": true, "afterClearClosed": {"entries": [{"row": 2, "userHead": "你 · 10月11日 19:27", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "highlighted": …`
- 证据: [debug-002.log](pty/2.1.295/ct-life/debug-002.log), [009-002-opened-by-itself.txt](pty/2.1.295/ct-life/screens/009-002-opened-by-itself.txt), [010-002-after--clear-with-the-Pane-open.txt](pty/2.1.295/ct-life/screens/010-002-after--clear-with-the-Pane-open.txt), [011-002-closed-by--.txt](pty/2.1.295/ct-life/screens/011-002-closed-by--.txt), [012-002--clear-after---opened-it-again.txt](pty/2.1.295/ct-life/screens/012-002--clear-after---opened-it-again.txt)

### CT-LIFE-003 · 2.1.287 · pass

- fixture: life-003
- 预期: every group on the chain across both compact boundaries, the rewound branch left out
- 实际: `{"ok": true, "expected": 10, "covered": 10, "missing": [], "users": ["K00 合成问题 0", "K01 合成问题 1", "K02 合成问题 2", "K03 合成问题 3", "K04 合成问题 4", "K05 合成问题 5", "K06 合成问题 6", "K07 合成问题 7", "K08 合成问题 8", "KYY rewind 之后的一轮"]}`
- 证据: [001-whole-pane-after-resume--two-compactions.txt](pty/2.1.287/chain/screens/001-whole-pane-after-resume--two-compactions.txt), [001-whole-pane-after-resume--two-compactions-diff.json](pty/2.1.287/chain/001-whole-pane-after-resume--two-compactions-diff.json)

### CT-LIFE-003 · 2.1.295 · pass

- fixture: life-003
- 预期: every group on the chain across both compact boundaries, the rewound branch left out
- 实际: `{"ok": true, "expected": 10, "covered": 10, "missing": [], "users": ["K00 合成问题 0", "K01 合成问题 1", "K02 合成问题 2", "K03 合成问题 3", "K04 合成问题 4", "K05 合成问题 5", "K06 合成问题 6", "K07 合成问题 7", "K08 合成问题 8", "KYY rewind 之后的一轮"]}`
- 证据: [001-whole-pane-after-resume--two-compactions.txt](pty/2.1.295/chain/screens/001-whole-pane-after-resume--two-compactions.txt), [001-whole-pane-after-resume--two-compactions-diff.json](pty/2.1.295/chain/001-whole-pane-after-resume--two-compactions-diff.json)

### CT-LIFE-004 · 2.1.287 · pass

- fixture: life-004
- 预期: after the submit the Pane equals the chain: R00-R02 and the new prompt; R03-R05 gone
- 实际: `{"before": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "oldEntriesBeforeSubmit": true, "after": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 rewind 之后提交的合成 prompt"]}}`
- 证据: [002-before-rewind.txt](pty/2.1.287/chain/screens/002-before-rewind.txt), [002-before-rewind-diff.json](pty/2.1.287/chain/002-before-rewind-diff.json), [003-rewind-dialog-on-R03.txt](pty/2.1.287/chain/screens/003-rewind-dialog-on-R03.txt), [004-after-rewind--before-the-next-submit.txt](pty/2.1.287/chain/screens/004-after-rewind--before-the-next-submit.txt), [005-after-the-next-submit.txt](pty/2.1.287/chain/screens/005-after-the-next-submit.txt), [005-after-the-next-submit-diff.json](pty/2.1.287/chain/005-after-the-next-submit-diff.json)

### CT-LIFE-004 · 2.1.295 · pass

- fixture: life-004
- 预期: after the submit the Pane equals the chain: R00-R02 and the new prompt; R03-R05 gone
- 实际: `{"before": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "oldEntriesBeforeSubmit": true, "after": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 rewind 之后提交的合成 prompt"]}}`
- 证据: [002-before-rewind.txt](pty/2.1.295/chain/screens/002-before-rewind.txt), [002-before-rewind-diff.json](pty/2.1.295/chain/002-before-rewind-diff.json), [003-rewind-dialog-on-R03.txt](pty/2.1.295/chain/screens/003-rewind-dialog-on-R03.txt), [004-after-rewind--before-the-next-submit.txt](pty/2.1.295/chain/screens/004-after-rewind--before-the-next-submit.txt), [005-after-the-next-submit.txt](pty/2.1.295/chain/screens/005-after-the-next-submit.txt), [005-after-the-next-submit-diff.json](pty/2.1.295/chain/005-after-the-next-submit-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-continue
- 预期: --continue opens the newest session; the Pane equals its chain
- 实际: `{"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["N00 合成问题 0", "N01 合成问题 1", "N02 合成问题 2", "N03 合成问题 3", "NYY rewind 之后的一轮"]}`
- 证据: [006-after---continue.txt](pty/2.1.287/chain/screens/006-after---continue.txt), [006-after---continue-diff.json](pty/2.1.287/chain/006-after---continue-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-fork
- 预期: before the first submit the fork has no file and the Pane says it is not written yet; after it the Pane equals the fork file's chain; the original file keeps its own
- 实际: `{"atStart": {"forkFile": null, "entries": 0, "notWrittenText": true, "emptyText": false}, "forkFile": "a6d476a9-587f-4876-8914-644646a92df9.jsonl", "afterSubmit": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["F02 合成问题 2", "F03 合成问题 3", "FYY rewind 之后的一轮", "F 分叉之后的合成 prompt"]}, "originalUntouched": true}`
- 证据: [007-after---fork-session--before-a-submit.txt](pty/2.1.287/chain/screens/007-after---fork-session--before-a-submit.txt), [008-after-the-first-submit-in-the-fork.txt](pty/2.1.287/chain/screens/008-after-the-first-submit-in-the-fork.txt), [008-after-the-first-submit-in-the-fork-diff.json](pty/2.1.287/chain/008-after-the-first-submit-in-the-fork-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-in-session
- 预期: after /resume picks B, the Pane equals B's chain
- 实际: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["A00 合成问题 0", "A01 合成问题 1", "A02 合成问题 2", "A03 合成问题 3"]}, "B": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["B00 合成问题 0", "B01 合成问题 1", "B02 合成问题 2", "BYY rewind 之后的一轮"]}}`
- 证据: [009-session-A-before--resume.txt](pty/2.1.287/chain/screens/009-session-A-before--resume.txt), [009-session-A-before--resume-diff.json](pty/2.1.287/chain/009-session-A-before--resume-diff.json), [010-resume-picker.txt](pty/2.1.287/chain/screens/010-resume-picker.txt), [011-session-B-after-in-session--resume.txt](pty/2.1.287/chain/screens/011-session-B-after-in-session--resume.txt), [011-session-B-after-in-session--resume-diff.json](pty/2.1.287/chain/011-session-B-after-in-session--resume-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: turns 6, --fork-session
- 预期: before the fork's first submit its file does not exist and the Pane says 本会话还没写进 transcript 文件，提交第一条消息后显示目录; after the submit the Pane matches the fork file's chain (verifier)
- 实际: `{"forkFileExists": false, "saysNotWritten": true, "listsForkChain": true}`
- 证据: [debug-fork.log](pty/2.1.287/ct-life/debug-fork.log), [013-fork-before-the-first-submit.txt](pty/2.1.287/ct-life/screens/013-fork-before-the-first-submit.txt), [014-fork-after-the-first-submit.txt](pty/2.1.287/ct-life/screens/014-fork-after-the-first-submit.txt)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-continue
- 预期: --continue opens the newest session; the Pane equals its chain
- 实际: `{"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["N00 合成问题 0", "N01 合成问题 1", "N02 合成问题 2", "N03 合成问题 3", "NYY rewind 之后的一轮"]}`
- 证据: [006-after---continue.txt](pty/2.1.295/chain/screens/006-after---continue.txt), [006-after---continue-diff.json](pty/2.1.295/chain/006-after---continue-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-fork
- 预期: before the first submit the fork has no file and the Pane says it is not written yet; after it the Pane equals the fork file's chain; the original file keeps its own
- 实际: `{"atStart": {"forkFile": null, "entries": 0, "notWrittenText": true, "emptyText": false}, "forkFile": "d36e4673-8aad-4115-8920-570dddd8ef0a.jsonl", "afterSubmit": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["F02 合成问题 2", "F03 合成问题 3", "FYY rewind 之后的一轮", "F 分叉之后的合成 prompt"]}, "originalUntouched": true}`
- 证据: [007-after---fork-session--before-a-submit.txt](pty/2.1.295/chain/screens/007-after---fork-session--before-a-submit.txt), [008-after-the-first-submit-in-the-fork.txt](pty/2.1.295/chain/screens/008-after-the-first-submit-in-the-fork.txt), [008-after-the-first-submit-in-the-fork-diff.json](pty/2.1.295/chain/008-after-the-first-submit-in-the-fork-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-in-session
- 预期: after /resume picks B, the Pane equals B's chain
- 实际: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["A00 合成问题 0", "A01 合成问题 1", "A02 合成问题 2", "A03 合成问题 3"]}, "B": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["B00 合成问题 0", "B01 合成问题 1", "B02 合成问题 2", "BYY rewind 之后的一轮"]}}`
- 证据: [009-session-A-before--resume.txt](pty/2.1.295/chain/screens/009-session-A-before--resume.txt), [009-session-A-before--resume-diff.json](pty/2.1.295/chain/009-session-A-before--resume-diff.json), [010-resume-picker.txt](pty/2.1.295/chain/screens/010-resume-picker.txt), [011-session-B-after-in-session--resume.txt](pty/2.1.295/chain/screens/011-session-B-after-in-session--resume.txt), [011-session-B-after-in-session--resume-diff.json](pty/2.1.295/chain/011-session-B-after-in-session--resume-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: turns 6, --fork-session
- 预期: before the fork's first submit its file does not exist and the Pane says 本会话还没写进 transcript 文件，提交第一条消息后显示目录; after the submit the Pane matches the fork file's chain (verifier)
- 实际: `{"forkFileExists": false, "saysNotWritten": true, "listsForkChain": true}`
- 证据: [debug-fork.log](pty/2.1.295/ct-life/debug-fork.log), [013-fork-before-the-first-submit.txt](pty/2.1.295/ct-life/screens/013-fork-before-the-first-submit.txt), [014-fork-after-the-first-submit.txt](pty/2.1.295/ct-life/screens/014-fork-after-the-first-submit.txt)

### CT-LIFE-006 · 2.1.287 · pass

- fixture: turns 300
- 预期: after a hot reload the lit group is the view's (after a wheel), and a jump lands its prompt at the top and lights its group
- 实际: `{"before": {"top": 290, "sitedTop": 290, "lit": [290], "paused": false, "window": [290, 291, 292, 293, 294], "lastWhole": false}, "afterReload": {"top": 290, "sitedTop": 290, "lit": [290], "paused": false, "window": [290, 291, 292, 293, 294], "lastWhole": false}, "afterWheel": {"top": 289, "sitedTop": 289, "lit": [289], "paused": false, "window": [289, 290, 291, 292, 293], "lastWhole": false}, "j…`
- 证据: [027-after-the-hot-reload.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/027-after-the-hot-reload.txt), [028-after-a-wheel.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/028-after-a-wheel.txt), [029-after-jumping-to-T0290.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/029-after-jumping-to-T0290.txt)

### CT-LIFE-006 · 2.1.295 · pass

- fixture: turns 300
- 预期: after a hot reload the lit group is the view's (after a wheel), and a jump lands its prompt at the top and lights its group
- 实际: `{"before": {"top": 291, "sitedTop": 291, "lit": [291], "paused": false, "window": [291, 292, 293, 294, 295], "lastWhole": false}, "afterReload": {"top": 291, "sitedTop": 291, "lit": [291], "paused": false, "window": [291, 292, 293, 294, 295], "lastWhole": false}, "afterWheel": {"top": 290, "sitedTop": 290, "lit": [290], "paused": false, "window": [290, 291, 292, 293, 294], "lastWhole": false}, "j…`
- 证据: [027-after-the-hot-reload.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/027-after-the-hot-reload.txt), [028-after-a-wheel.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/028-after-a-wheel.txt), [029-after-jumping-to-T0291.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/029-after-jumping-to-T0291.txt)

### CT-UI-001 · 2.1.287 · pass

- fixture: turns 9 (a /tui group with a user side only)
- 预期: 2/3/1 switch the filter and the Pane redraws at once (≤ 1 s from the key), each whole list equal to the verifier's for that filter (Agent hides the user-only group); the choice survives a new process; an unknown stored value reads as 全部
- 实际: `{"user": {"redrawSeconds": 0.12, "wholeList": {"ok": true, "covered": 9, "missing": []}}, "agent": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 8, "missing": []}}, "all": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 9, "missing": []}}, "newProcessFilterRow": "1: ○全部 2: ○用户 3: ●Agent  l: 布局:卡片  ✕", "unknownValueFilterRow": "1: ●全部 2: ○用户 3: ○Agent  l: 布局:卡片  ✕"}`
- 证据: [068-ui-001-filter-user.txt](pty/2.1.287/gate/screens/068-ui-001-filter-user.txt), [whole-05.json](pty/2.1.287/gate/whole-05.json), [070-ui-001-filter-agent.txt](pty/2.1.287/gate/screens/070-ui-001-filter-agent.txt), [whole-06.json](pty/2.1.287/gate/whole-06.json), [072-ui-001-filter-all.txt](pty/2.1.287/gate/screens/072-ui-001-filter-all.txt), [whole-07.json](pty/2.1.287/gate/whole-07.json) 等 8 个

### CT-UI-001 · 2.1.295 · pass

- fixture: turns 9 (a /tui group with a user side only)
- 预期: 2/3/1 switch the filter and the Pane redraws at once (≤ 1 s from the key), each whole list equal to the verifier's for that filter (Agent hides the user-only group); the choice survives a new process; an unknown stored value reads as 全部
- 实际: `{"user": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 9, "missing": []}}, "agent": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 8, "missing": []}}, "all": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 9, "missing": []}}, "newProcessFilterRow": "1: ○全部 2: ○用户 3: ●Agent  l: 布局:卡片", "unknownValueFilterRow": "1: ●全部 2: ○用户 3: ○Agent  l: 布局:卡片"}`
- 证据: [068-ui-001-filter-user.txt](pty/2.1.295/gate/screens/068-ui-001-filter-user.txt), [whole-05.json](pty/2.1.295/gate/whole-05.json), [070-ui-001-filter-agent.txt](pty/2.1.295/gate/screens/070-ui-001-filter-agent.txt), [whole-06.json](pty/2.1.295/gate/whole-06.json), [072-ui-001-filter-all.txt](pty/2.1.295/gate/screens/072-ui-001-filter-all.txt), [whole-07.json](pty/2.1.295/gate/whole-07.json) 等 8 个

### CT-UI-002 · 2.1.287 · pass

- fixture: turns 5 (fits the window in every Layout)
- 预期: l and the 布局 button cycle 卡片 → 紧凑 → 时间轴, each listing the same 5 entries with their Agent sides; the choice survives a new process; an unknown stored value reads as 卡片
- 实际: `{"views": [{"label": "卡片", "turns": [0, 1, 2, 3, 4], "agentSides": 5}, {"label": "紧凑", "turns": [0, 1, 2, 3, 4], "agentSides": 5}, {"label": "时间轴", "turns": [0, 1, 2, 3, 4], "agentSides": 5}], "newProcessLayout": "紧凑", "unknownValueLayout": "卡片"}`
- 证据: [078-ui-002-card.txt](pty/2.1.287/gate/screens/078-ui-002-card.txt), [079-ui-002-compact-by-l.txt](pty/2.1.287/gate/screens/079-ui-002-compact-by-l.txt), [080-ui-002-timeline-by-a-click.txt](pty/2.1.287/gate/screens/080-ui-002-timeline-by-a-click.txt), [081-ui-002-new-process.txt](pty/2.1.287/gate/screens/081-ui-002-new-process.txt)

### CT-UI-002 · 2.1.295 · pass

- fixture: turns 5 (fits the window in every Layout)
- 预期: l and the 布局 button cycle 卡片 → 紧凑 → 时间轴, each listing the same 5 entries with their Agent sides; the choice survives a new process; an unknown stored value reads as 卡片
- 实际: `{"views": [{"label": "卡片", "turns": [0, 1, 2, 3, 4], "agentSides": 5}, {"label": "紧凑", "turns": [0, 1, 2, 3, 4], "agentSides": 5}, {"label": "时间轴", "turns": [0, 1, 2, 3, 4], "agentSides": 5}], "newProcessLayout": "紧凑", "unknownValueLayout": "卡片"}`
- 证据: [078-ui-002-card.txt](pty/2.1.295/gate/screens/078-ui-002-card.txt), [079-ui-002-compact-by-l.txt](pty/2.1.295/gate/screens/079-ui-002-compact-by-l.txt), [080-ui-002-timeline-by-a-click.txt](pty/2.1.295/gate/screens/080-ui-002-timeline-by-a-click.txt), [081-ui-002-new-process.txt](pty/2.1.295/gate/screens/081-ui-002-new-process.txt)

### CT-UI-003 · 2.1.287 · pass

- fixture: turns 12, rewound in the host, T0011's user side refused and dimmed
- 预期: focused, ↑ walks one side at a time (agent, user, the turn before's agent, ...) and stops on the dimmed side too; Enter on T0002's user side puts that prompt at the top and lights it; one more ↑ moves the inverse ring off it while the cyan ▌ (not inverse) stays on T0002
- 实际: `{"dimmedBeforeKeys": true, "walk": [{"ring": [[32, "你 · 10月9日 09:07"]], "turn": 11, "side": "user", "dim": true, "lit": []}, {"ring": [[28, "↳ 2 步"]], "turn": 10, "side": "agent", "dim": null, "lit": []}, {"ring": [[25, "你 · 10月9日 09:06"]], "turn": 10, "side": "user", "dim": false, "lit": []}, {"ring": [[21, "↳ 1 步"]], "turn": 9, "side": "agent", "dim": null, "lit": []}, {"ring": [[18, "你 · 10月9日…`
- 证据: [082-ui-003-rewound.txt](pty/2.1.287/gate/screens/082-ui-003-rewound.txt), [083-ui-003-T0011-refused-and-dimmed.txt](pty/2.1.287/gate/screens/083-ui-003-T0011-refused-and-dimmed.txt), [084-ui-003-after-the---walk.txt](pty/2.1.287/gate/screens/084-ui-003-after-the---walk.txt), [085-ui-003-Enter-on-T0002.txt](pty/2.1.287/gate/screens/085-ui-003-Enter-on-T0002.txt), [086-ui-003-ring-moved-off-the-lit-entry.txt](pty/2.1.287/gate/screens/086-ui-003-ring-moved-off-the-lit-entry.txt)

### CT-UI-003 · 2.1.295 · pass

- fixture: turns 12, rewound in the host, T0011's user side refused and dimmed
- 预期: focused, ↑ walks one side at a time (agent, user, the turn before's agent, ...) and stops on the dimmed side too; Enter on T0002's user side puts that prompt at the top and lights it; one more ↑ moves the inverse ring off it while the cyan ▌ (not inverse) stays on T0002
- 实际: `{"dimmedBeforeKeys": true, "walk": [{"ring": [[33, "↳ 3 步"]], "turn": 11, "side": "agent", "dim": null, "lit": []}, {"ring": [[30, "你 · 10月9日 09:07"]], "turn": 11, "side": "user", "dim": true, "lit": []}, {"ring": [[26, "↳ 2 步"]], "turn": 10, "side": "agent", "dim": null, "lit": []}, {"ring": [[23, "你 · 10月9日 09:06"]], "turn": 10, "side": "user", "dim": false, "lit": []}, {"ring": [[19, "↳ 1 步"]]…`
- 证据: [082-ui-003-rewound.txt](pty/2.1.295/gate/screens/082-ui-003-rewound.txt), [083-ui-003-T0011-refused-and-dimmed.txt](pty/2.1.295/gate/screens/083-ui-003-T0011-refused-and-dimmed.txt), [084-ui-003-after-the---walk.txt](pty/2.1.295/gate/screens/084-ui-003-after-the---walk.txt), [085-ui-003-Enter-on-T0002.txt](pty/2.1.295/gate/screens/085-ui-003-Enter-on-T0002.txt), [086-ui-003-ring-moved-off-the-lit-entry.txt](pty/2.1.295/gate/screens/086-ui-003-ring-moved-off-the-lit-entry.txt)

### CT-JUMP-001 · 2.1.287 · pass

- fixture: turns 300
- 预期: clicking turn 1's user side (never drawn after resume) puts its prompt at the top; its Agent side puts its last reply at the top
- 实际: `{"firstEntry": "T0000 用户问题：请检查第 0 个模块的状态， 并说明下一步该做什么。", "userJumpTopShowsT0000": true, "agentJumpTopShowsT0000Reply": true, "refusalShown": false}`
- 证据: [001-after-resume.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/001-after-resume.txt), [002-pane-at-top.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/002-pane-at-top.txt), [003-after-clicking-T0000-user-side.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/003-after-clicking-T0000-user-side.txt), [004-after-clicking-T0000-agent-side.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/004-after-clicking-T0000-agent-side.txt)

### CT-JUMP-001 · 2.1.295 · pass

- fixture: turns 300
- 预期: clicking turn 1's user side (never drawn after resume) puts its prompt at the top; its Agent side puts its last reply at the top
- 实际: `{"firstEntry": "T0000 用户问题：请检查第 0 个模块的状态， 并说明下一步该做什么。", "userJumpTopShowsT0000": true, "agentJumpTopShowsT0000Reply": true, "refusalShown": false}`
- 证据: [001-after-resume.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/001-after-resume.txt), [002-pane-at-top.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/002-pane-at-top.txt), [003-after-clicking-T0000-user-side.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/003-after-clicking-T0000-user-side.txt), [004-after-clicking-T0000-agent-side.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/004-after-clicking-T0000-agent-side.txt)

### CT-JUMP-002 · 2.1.287 · pass

- fixture: turns 40
- 预期: a local command (/tui) and a !cmd jump to a neighbouring row, centred, the typed row still in view
- 实际: `{"local command": {"shown": true, "row": 20, "refused": false}, "shell command": {"shown": true, "row": 17, "refused": false}}`
- 证据: [005-pane-shows--tui.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/005-pane-shows--tui.txt), [006-after-clicking--tui.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/006-after-clicking--tui.txt), [007-pane-shows--echo-T0012.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/007-pane-shows--echo-T0012.txt), [008-after-clicking--echo-T0012.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/008-after-clicking--echo-T0012.txt)

### CT-JUMP-002 · 2.1.287 · pass

- fixture: forms23: /review, /model as a user row, a tools-only turn
- 预期: a prompt-type command and a user-row local command jump to the neighbouring drawn rows; an Agent side without text jumps to its last tool row; nothing refused
- 实际: `{"prompt-type command": {"shown": true, "refused": false}, "local command as a user row": {"shown": true, "refused": false}, "tools-only Agent side": {"shown": true, "refused": false}}`
- 证据: [009-after-clicking-the-user-side-of--review.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/009-after-clicking-the-user-side-of--review.txt), [010-after-clicking-the-user-side-of--model.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/010-after-clicking-the-user-side-of--model.txt), [011-after-clicking-the-agent-side-of-P08.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/011-after-clicking-the-agent-side-of-P08.txt)

### CT-JUMP-002 · 2.1.295 · pass

- fixture: turns 40
- 预期: a local command (/tui) and a !cmd jump to a neighbouring row, centred, the typed row still in view
- 实际: `{"local command": {"shown": true, "row": 20, "refused": false}, "shell command": {"shown": true, "row": 17, "refused": false}}`
- 证据: [005-pane-shows--tui.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/005-pane-shows--tui.txt), [006-after-clicking--tui.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/006-after-clicking--tui.txt), [007-pane-shows--echo-T0012.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/007-pane-shows--echo-T0012.txt), [008-after-clicking--echo-T0012.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/008-after-clicking--echo-T0012.txt)

### CT-JUMP-002 · 2.1.295 · pass

- fixture: forms23: /review, /model as a user row, a tools-only turn
- 预期: a prompt-type command and a user-row local command jump to the neighbouring drawn rows; an Agent side without text jumps to its last tool row; nothing refused
- 实际: `{"prompt-type command": {"shown": true, "refused": false}, "local command as a user row": {"shown": true, "refused": false}, "tools-only Agent side": {"shown": true, "refused": false}}`
- 证据: [009-after-clicking-the-user-side-of--review.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/009-after-clicking-the-user-side-of--review.txt), [010-after-clicking-the-user-side-of--model.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/010-after-clicking-the-user-side-of--model.txt), [011-after-clicking-the-agent-side-of-P08.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/011-after-clicking-the-agent-side-of-P08.txt)

### CT-JUMP-003 · 2.1.287 · pass

- fixture: turns 12, rewound in the host
- 预期: clicking an entry the rewind took out of the host's list says so at the bottom, dims the side, moves nothing; the saying goes after ~5 s
- 实际: `{"dim": [true, false], "refusalShown": true, "transcriptUnmoved": true, "refusalGoneAfter6s": true, "dimAfter6s": true}`
- 证据: [012-after-resume.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/012-after-resume.txt), [013-message-selector.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/013-message-selector.txt), [014-message-selector--picked.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/014-message-selector--picked.txt), [015-after-enter.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/015-after-enter.txt), [016-after-confirming.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/016-after-confirming.txt), [017-rewound.txt](pty/2.1.287/20261011-192819-CT-JUMP-2.1.287/screens/017-rewound.txt) 等 9 个

### CT-JUMP-003 · 2.1.295 · pass

- fixture: turns 12, rewound in the host
- 预期: clicking an entry the rewind took out of the host's list says so at the bottom, dims the side, moves nothing; the saying goes after ~5 s
- 实际: `{"dim": [true, false], "refusalShown": true, "transcriptUnmoved": true, "refusalGoneAfter6s": true, "dimAfter6s": true}`
- 证据: [012-after-resume.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/012-after-resume.txt), [013-message-selector.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/013-message-selector.txt), [014-message-selector--picked.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/014-message-selector--picked.txt), [015-after-enter.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/015-after-enter.txt), [016-after-confirming.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/016-after-confirming.txt), [017-rewound.txt](pty/2.1.295/20261011-192821-CT-JUMP-current/screens/017-rewound.txt) 等 9 个

### CT-POS-001 · 2.1.287 · pass

- fixture: turns 40
- 预期: the last group lit at the end; a jump to /tui (centred) lights /tui while the view's top is the group before, still a second later; the next wheel over the transcript lights the top's group
- 实际: `{"atEnd": {"top": 35, "sitedTop": 35, "lit": [39], "paused": false, "window": [34, 35, 36, 37, 38, 39], "lastWhole": false}, "afterJump": {"top": 25, "sitedTop": 25, "lit": [27], "paused": false, "window": [23, 24, 25, 26, 27, 28], "lastWhole": false}, "aSecondLater": {"top": 25, "sitedTop": 25, "lit": [27], "paused": false, "window": [23, 24, 25, 26, 27, 28], "lastWhole": false}, "afterWheel": {…`
- 证据: [001-at-the-end.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/001-at-the-end.txt), [002-after-the-jump-to--tui.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/002-after-the-jump-to--tui.txt), [003-after-one-wheel-over-the-transcript.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/003-after-one-wheel-over-the-transcript.txt)

### CT-POS-001 · 2.1.295 · pass

- fixture: turns 40
- 预期: the last group lit at the end; a jump to /tui (centred) lights /tui while the view's top is the group before, still a second later; the next wheel over the transcript lights the top's group
- 实际: `{"atEnd": {"top": 35, "sitedTop": 35, "lit": [39], "paused": false, "window": [34, 35, 36, 37, 38, 39], "lastWhole": false}, "afterJump": {"top": 25, "sitedTop": 25, "lit": [27], "paused": false, "window": [23, 24, 25, 26, 27], "lastWhole": false}, "aSecondLater": {"top": 25, "sitedTop": 25, "lit": [27], "paused": false, "window": [23, 24, 25, 26, 27], "lastWhole": false}, "afterWheel": {"top": 2…`
- 证据: [001-at-the-end.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/001-at-the-end.txt), [002-after-the-jump-to--tui.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/002-after-the-jump-to--tui.txt), [003-after-one-wheel-over-the-transcript.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/003-after-one-wheel-over-the-transcript.txt)

### CT-POS-002 · 2.1.287 · pass

- fixture: turns 300
- 预期: after 180 wheel ticks up (and 90 down, and 180 up at 100/s) the lit group is the group of screen row 1 (the last group when its last row is wholly in view)
- 实际: `{"up 180": {"top": 277, "sitedTop": 277, "lit": [277], "paused": false, "window": [277, 278, 279, 280, 281], "lastWhole": false}, "down 90": {"top": 289, "sitedTop": 289, "lit": [289], "paused": false, "window": [287, 288, 289, 290, 291, 292], "lastWhole": false}, "down 7 #0": {"top": 289, "sitedTop": 289, "lit": [289], "paused": false, "window": [287, 288, 289, 290, 291, 292], "lastWhole": false…`
- 证据: [004-after-up-180.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/004-after-up-180.txt), [005-after-down-90.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/005-after-down-90.txt), [006-after-down-7--0.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/006-after-down-7--0.txt), [007-after-down-7--1.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/007-after-down-7--1.txt), [008-after-down-7--2.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/008-after-down-7--2.txt), [009-after-down-7--3.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/009-after-down-7--3.txt) 等 15 个

### CT-POS-002 · 2.1.295 · pass

- fixture: turns 300
- 预期: after 180 wheel ticks up (and 90 down, and 180 up at 100/s) the lit group is the group of screen row 1 (the last group when its last row is wholly in view)
- 实际: `{"up 180": {"top": 269, "sitedTop": 269, "lit": [269], "paused": false, "window": [269, 270, 271, 272, 273], "lastWhole": false}, "down 90": {"top": 279, "sitedTop": 279, "lit": [279], "paused": false, "window": [279, 280, 281, 282, 283], "lastWhole": false}, "down 7 #0": {"top": 280, "sitedTop": 280, "lit": [280], "paused": false, "window": [279, 280, 281, 282, 283], "lastWhole": false}, "down 7…`
- 证据: [004-after-up-180.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/004-after-up-180.txt), [005-after-down-90.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/005-after-down-90.txt), [006-after-down-7--0.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/006-after-down-7--0.txt), [007-after-down-7--1.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/007-after-down-7--1.txt), [008-after-down-7--2.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/008-after-down-7--2.txt), [009-after-down-7--3.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/009-after-down-7--3.txt) 等 15 个

### CT-POS-003 · 2.1.287 · pass

- fixture: turns 300
- 预期: the lit group is in the pane's window; wheeling the pane says 暂停 and keeps the window; the next move of the transcript follows again; the pane focused says 暂停
- 实际: `{"follows": {"top": 286, "sitedTop": 286, "lit": [286], "paused": false, "window": [286, 287, 288, 289, 290, 291], "lastWhole": false}, "paneWheeled": {"top": 286, "sitedTop": 286, "lit": [], "paused": true, "window": [280, 281, 282, 283, 284], "lastWhole": false}, "transcriptMoved": {"top": 287, "sitedTop": 288, "lit": [288], "paused": false, "window": [287, 288, 289, 290, 291, 292], "lastWhole"…`
- 证据: [019-transcript-scrolled-up--the-pane-follows.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/019-transcript-scrolled-up--the-pane-follows.txt), [020-pane-wheeled--paused.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/020-pane-wheeled--paused.txt), [021-transcript-moved--following-again.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/021-transcript-moved--following-again.txt), [022--chat-toc--the-pane-has-the-keyboard.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/022--chat-toc--the-pane-has-the-keyboard.txt)

### CT-POS-003 · 2.1.295 · pass

- fixture: turns 300
- 预期: the lit group is in the pane's window; wheeling the pane says 暂停 and keeps the window; the next move of the transcript follows again; the pane focused says 暂停
- 实际: `{"follows": {"top": 290, "sitedTop": 290, "lit": [290], "paused": false, "window": [290, 291, 292, 293, 294], "lastWhole": false}, "paneWheeled": {"top": 290, "sitedTop": 290, "lit": [], "paused": true, "window": [283, 284, 285, 286, 287, 288], "lastWhole": false}, "transcriptMoved": {"top": 291, "sitedTop": 291, "lit": [291], "paused": false, "window": [291, 292, 293, 294, 295], "lastWhole": fal…`
- 证据: [019-transcript-scrolled-up--the-pane-follows.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/019-transcript-scrolled-up--the-pane-follows.txt), [020-pane-wheeled--paused.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/020-pane-wheeled--paused.txt), [021-transcript-moved--following-again.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/021-transcript-moved--following-again.txt), [022--chat-toc--the-pane-has-the-keyboard.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/022--chat-toc--the-pane-has-the-keyboard.txt)

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.7, "tocReadyS": 1.23, "tocLagMs": 534, "paneToTop": {"batches": 7, "ticks": 140, "s": 1.96}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.73}, "reachedLast": true, "startWholeMs": 207.31, "idleWholeMs": 189.99, "groups": 107, "tailReadMs": [6, 21.35, 25.73], "appendModelMs": [6, …`
- 证据: [debug-heavy-1.log](pty/2.1.287/perf-heavy/debug-heavy-1.log), [001-heavy-1-after-resume.txt](pty/2.1.287/perf-heavy/screens/001-heavy-1-after-resume.txt), [002-heavy-1-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/002-heavy-1-pane-at-its-top.txt), [003-heavy-1-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/003-heavy-1-after-clicking-T0000.txt), [004-heavy-1-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/004-heavy-1-pane-at-its-end.txt), [005-heavy-1-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/005-heavy-1-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.72, "tocReadyS": 1.22, "tocLagMs": 498, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.22}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.74}, "reachedLast": true, "startWholeMs": 213.98, "idleWholeMs": 191.71, "groups": 107, "tailReadMs": [7, 15.06, 32.63], "appendModelMs": [6,…`
- 证据: [debug-heavy-2.log](pty/2.1.287/perf-heavy/debug-heavy-2.log), [007-heavy-2-after-resume.txt](pty/2.1.287/perf-heavy/screens/007-heavy-2-after-resume.txt), [008-heavy-2-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/008-heavy-2-pane-at-its-top.txt), [009-heavy-2-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/009-heavy-2-after-clicking-T0000.txt), [010-heavy-2-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/010-heavy-2-pane-at-its-end.txt), [011-heavy-2-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/011-heavy-2-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.67, "tocReadyS": 1.17, "tocLagMs": 500, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.24}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.77}, "reachedLast": true, "startWholeMs": 217.51, "idleWholeMs": 186.79, "groups": 107, "tailReadMs": [7, 19, 43], "appendModelMs": [6, 339.1…`
- 证据: [debug-heavy-3.log](pty/2.1.287/perf-heavy/debug-heavy-3.log), [013-heavy-3-after-resume.txt](pty/2.1.287/perf-heavy/screens/013-heavy-3-after-resume.txt), [014-heavy-3-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/014-heavy-3-pane-at-its-top.txt), [015-heavy-3-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/015-heavy-3-after-clicking-T0000.txt), [016-heavy-3-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/016-heavy-3-pane-at-its-end.txt), [017-heavy-3-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/017-heavy-3-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.01, "tocReadyS": 1.69, "tocLagMs": 678, "paneToTop": {"batches": 496, "ticks": 9920, "s": 103.53}, "reachedFirst": true, "paneToEnd": {"batches": 402, "ticks": 8040, "s": 84.16}, "reachedLast": true, "startWholeMs": 362.48, "idleWholeMs": 335.04, "groups": 4521, "tailReadMs": [7, 19.55, 120.15], "append…`
- 证据: [debug-many-1.log](pty/2.1.287/perf-many/debug-many-1.log), [001-many-1-after-resume.txt](pty/2.1.287/perf-many/screens/001-many-1-after-resume.txt), [002-many-1-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/002-many-1-pane-at-its-top.txt), [003-many-1-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/003-many-1-after-clicking-T0000.txt), [004-many-1-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/004-many-1-pane-at-its-end.txt), [005-many-1-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/005-many-1-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.03, "tocReadyS": 1.7, "tocLagMs": 673, "paneToTop": {"batches": 496, "ticks": 9920, "s": 103.57}, "reachedFirst": true, "paneToEnd": {"batches": 404, "ticks": 8080, "s": 84.39}, "reachedLast": true, "startWholeMs": 335.68, "idleWholeMs": 341.84, "groups": 4521, "tailReadMs": [7, 17.25, 96.45], "appendMo…`
- 证据: [debug-many-2.log](pty/2.1.287/perf-many/debug-many-2.log), [007-many-2-after-resume.txt](pty/2.1.287/perf-many/screens/007-many-2-after-resume.txt), [008-many-2-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/008-many-2-pane-at-its-top.txt), [009-many-2-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/009-many-2-after-clicking-T0000.txt), [010-many-2-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/010-many-2-pane-at-its-end.txt), [011-many-2-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/011-many-2-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.02, "tocReadyS": 1.72, "tocLagMs": 697, "paneToTop": {"batches": 495, "ticks": 9900, "s": 103.54}, "reachedFirst": true, "paneToEnd": {"batches": 404, "ticks": 8080, "s": 84.44}, "reachedLast": true, "startWholeMs": 342.08, "idleWholeMs": 358.91, "groups": 4521, "tailReadMs": [7, 17.69, 95.03], "appendM…`
- 证据: [debug-many-3.log](pty/2.1.287/perf-many/debug-many-3.log), [013-many-3-after-resume.txt](pty/2.1.287/perf-many/screens/013-many-3-after-resume.txt), [014-many-3-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/014-many-3-pane-at-its-top.txt), [015-many-3-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/015-many-3-after-clicking-T0000.txt), [016-many-3-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/016-many-3-pane-at-its-end.txt), [017-many-3-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/017-many-3-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.75, "tocReadyS": 1.28, "tocLagMs": 531, "paneToTop": {"batches": 7, "ticks": 140, "s": 1.79}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.72}, "reachedLast": true, "startWholeMs": 200.09, "idleWholeMs": 197.13, "groups": 107, "tailReadMs": [7, 14.51, 87.13], "appendModelMs": [7,…`
- 证据: [debug-heavy-1.log](pty/2.1.295/perf-heavy/debug-heavy-1.log), [001-heavy-1-after-resume.txt](pty/2.1.295/perf-heavy/screens/001-heavy-1-after-resume.txt), [002-heavy-1-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/002-heavy-1-pane-at-its-top.txt), [003-heavy-1-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/003-heavy-1-after-clicking-T0000.txt), [004-heavy-1-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/004-heavy-1-pane-at-its-end.txt), [005-heavy-1-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/005-heavy-1-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.68, "tocReadyS": 1.2, "tocLagMs": 522, "paneToTop": {"batches": 7, "ticks": 140, "s": 1.8}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.7}, "reachedLast": true, "startWholeMs": 209.45, "idleWholeMs": 202.92, "groups": 107, "tailReadMs": [7, 12.53, 93.23], "appendModelMs": [7, 32…`
- 证据: [debug-heavy-2.log](pty/2.1.295/perf-heavy/debug-heavy-2.log), [007-heavy-2-after-resume.txt](pty/2.1.295/perf-heavy/screens/007-heavy-2-after-resume.txt), [008-heavy-2-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/008-heavy-2-pane-at-its-top.txt), [009-heavy-2-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/009-heavy-2-after-clicking-T0000.txt), [010-heavy-2-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/010-heavy-2-pane-at-its-end.txt), [011-heavy-2-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/011-heavy-2-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.75, "tocReadyS": 1.22, "tocLagMs": 469, "paneToTop": {"batches": 7, "ticks": 140, "s": 1.8}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.73}, "reachedLast": true, "startWholeMs": 193.69, "idleWholeMs": 209.31, "groups": 107, "tailReadMs": [8, 17.21, 141.49], "appendModelMs": [7,…`
- 证据: [debug-heavy-3.log](pty/2.1.295/perf-heavy/debug-heavy-3.log), [013-heavy-3-after-resume.txt](pty/2.1.295/perf-heavy/screens/013-heavy-3-after-resume.txt), [014-heavy-3-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/014-heavy-3-pane-at-its-top.txt), [015-heavy-3-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/015-heavy-3-after-clicking-T0000.txt), [016-heavy-3-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/016-heavy-3-pane-at-its-end.txt), [017-heavy-3-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/017-heavy-3-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.05, "tocReadyS": 1.74, "tocLagMs": 681, "paneToTop": {"batches": 496, "ticks": 9920, "s": 103.55}, "reachedFirst": true, "paneToEnd": {"batches": 406, "ticks": 8120, "s": 84.81}, "reachedLast": true, "startWholeMs": 327.29, "idleWholeMs": 344.32, "groups": 4521, "tailReadMs": [7, 16.91, 105.75], "append…`
- 证据: [debug-many-1.log](pty/2.1.295/perf-many/debug-many-1.log), [001-many-1-after-resume.txt](pty/2.1.295/perf-many/screens/001-many-1-after-resume.txt), [002-many-1-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/002-many-1-pane-at-its-top.txt), [003-many-1-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/003-many-1-after-clicking-T0000.txt), [004-many-1-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/004-many-1-pane-at-its-end.txt), [005-many-1-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/005-many-1-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.08, "tocReadyS": 1.77, "tocLagMs": 689, "paneToTop": {"batches": 497, "ticks": 9940, "s": 104.0}, "reachedFirst": true, "paneToEnd": {"batches": 405, "ticks": 8100, "s": 84.53}, "reachedLast": true, "startWholeMs": 326.32, "idleWholeMs": 356.32, "groups": 4521, "tailReadMs": [7, 18.84, 95.63], "appendMo…`
- 证据: [debug-many-2.log](pty/2.1.295/perf-many/debug-many-2.log), [007-many-2-after-resume.txt](pty/2.1.295/perf-many/screens/007-many-2-after-resume.txt), [008-many-2-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/008-many-2-pane-at-its-top.txt), [009-many-2-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/009-many-2-after-clicking-T0000.txt), [010-many-2-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/010-many-2-pane-at-its-end.txt), [011-many-2-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/011-many-2-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.09, "tocReadyS": 1.78, "tocLagMs": 697, "paneToTop": {"batches": 495, "ticks": 9900, "s": 103.35}, "reachedFirst": true, "paneToEnd": {"batches": 377, "ticks": 7540, "s": 70.48}, "reachedLast": true, "startWholeMs": 361.48, "idleWholeMs": 359.92, "groups": 4521, "tailReadMs": [7, 17.91, 95.12], "appendM…`
- 证据: [debug-many-3.log](pty/2.1.295/perf-many/debug-many-3.log), [013-many-3-after-resume.txt](pty/2.1.295/perf-many/screens/013-many-3-after-resume.txt), [014-many-3-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/014-many-3-pane-at-its-top.txt), [015-many-3-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/015-many-3-after-clicking-T0000.txt), [016-many-3-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/016-many-3-pane-at-its-end.txt), [017-many-3-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/017-many-3-after-clicking-the-newest.txt) 等 8 个

### CT-SEC-001 · 2.1.287 · pass

- fixture: turns 6 + one submitted prompt holding a synthetic unique marker
- 预期: the marker is drawn in the Pane and appears in none of: chat-toc's $.store file (which holds only viewFilter and layout), its plugin data directory, the debug log's chat-toc lines (CHAT_TOC_PERF on, a jump, a hot reload); the release evidence is scanned for it too (release_gate.py)
- 实际: `{"markerSha256": "03f4b92660db4569", "drawnInPane": true, "storeFiles": ["plugins/store/chat-toc_inline-8255bb3c209a.json"], "storeKeys": ["layout", "viewFilter"], "pluginDataDirs": [], "leaksInStoreOrData": [], "debugLogChatTocLines": 166, "leaksInChatTocLogLines": 0, "hostLogLinesWithMarker": 0}`
- 证据: [debug-sec-001-chat-toc-lines.log](pty/2.1.287/gate/debug-sec-001-chat-toc-lines.log)

### CT-SEC-001 · 2.1.295 · pass

- fixture: turns 6 + one submitted prompt holding a synthetic unique marker
- 预期: the marker is drawn in the Pane and appears in none of: chat-toc's $.store file (which holds only viewFilter and layout), its plugin data directory, the debug log's chat-toc lines (CHAT_TOC_PERF on, a jump, a hot reload); the release evidence is scanned for it too (release_gate.py)
- 实际: `{"markerSha256": "df5b367a698b6384", "drawnInPane": true, "storeFiles": ["plugins/store/chat-toc_inline-8255bb3c209a.json"], "storeKeys": ["layout", "viewFilter"], "pluginDataDirs": [], "leaksInStoreOrData": [], "debugLogChatTocLines": 167, "leaksInChatTocLogLines": 0, "hostLogLinesWithMarker": 0}`
- 证据: [debug-sec-001-chat-toc-lines.log](pty/2.1.295/gate/debug-sec-001-chat-toc-lines.log)

### CT-COEX-001 · 2.1.287 · pass

- fixture: turns 300
- 预期: with /diff in front and chat-toc paused behind it, a move of the transcript ends the pause: back in front its first frame lights and shows the view's group, no 暂停
- 实际: `{"diffInFront": true, "pausedBefore": {"top": 290, "sitedTop": 290, "lit": [], "paused": true, "window": [283, 284, 285, 286, 287, 288], "lastWhole": false}, "tocBehind": true, "back": {"top": 285, "sitedTop": 285, "lit": [285], "paused": false, "window": [283, 284, 285, 286, 287, 288], "lastWhole": false}}`
- 证据: [023--diff-opened-in-front.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/023--diff-opened-in-front.txt), [024-chat-toc-in-front--paused.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/024-chat-toc-in-front--paused.txt), [025-Diff-in-front-again.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/025-Diff-in-front-again.txt), [026-chat-toc-tab-clicked--in-front-again.txt](pty/2.1.287/20261011-193022-CT-POS-2.1.287/screens/026-chat-toc-tab-clicked--in-front-again.txt)

### CT-COEX-001 · 2.1.295 · pass

- fixture: turns 300
- 预期: with /diff in front and chat-toc paused behind it, a move of the transcript ends the pause: back in front its first frame lights and shows the view's group, no 暂停
- 实际: `{"diffInFront": true, "pausedBefore": {"top": 290, "sitedTop": 290, "lit": [], "paused": true, "window": [283, 284, 285, 286, 287, 288], "lastWhole": false}, "tocBehind": true, "back": {"top": 285, "sitedTop": 285, "lit": [285], "paused": false, "window": [283, 284, 285, 286, 287, 288], "lastWhole": false}}`
- 证据: [023--diff-opened-in-front.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/023--diff-opened-in-front.txt), [024-chat-toc-in-front--paused.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/024-chat-toc-in-front--paused.txt), [025-Diff-in-front-again.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/025-Diff-in-front-again.txt), [026-chat-toc-tab-clicked--in-front-again.txt](pty/2.1.295/20261011-193025-CT-POS-current/screens/026-chat-toc-tab-clicked--in-front-again.txt)

