# chat-toc 0.1.2 发布证据

**结论：通过**（`--plugin-dir` 下 37 个 MUST 场景 × 2 个 Claude Code 版本；失败 0、缺失 0、跳过 0；证据里 CT-SEC-001 标记泄漏 0 处）

## 被测对象与环境

- commit: `4926422`
- pluginVersion: `0.1.2`
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

只用合成 prompt；transcript 都是 `tests/acceptance/transcript_fixture.py` 生成的或在隔离世界里新提交的。本机路径换成了 `<repo>`、`<home>`、`<tmp>`、`<npx>`。

## 自动化门禁

| 门禁 | 结果 | 说明 | 日志 |
| --- | --- | --- | --- |
| plugin-validate@2.1.287 | pass |  | [log](logs/plugin-validate@2.1.287.log) |
| tsc@2.1.287 | pass |  | [log](logs/tsc@2.1.287.log) |
| plugin-validate@2.1.295 | pass |  | [log](logs/plugin-validate@2.1.295.log) |
| plugin-test@2.1.295 | pass | 251 pass, 0 fail; CT-PERF position groups=4432 chain=26590 live=12 p50/p95/max=0.009/0.015/0.792 ms; CT-PERF position-residue records=3012 p50/p95/max=0.328/2.96/26.881 ms; CT-PERF entry-table entries=8864 first=111.961 ms; redraw p95=0.001 ms; last group grown p50/p95/max=0.047/0.055/0.059 ms | [log](logs/plugin-test@2.1.295.log) |
| tsc@2.1.295 | pass |  | [log](logs/tsc@2.1.295.log) |
| acceptance-unit@2.1.295 | pass | 43 tests | [log](logs/acceptance-unit@2.1.295.log) |
| privacy-scan | pass | 7 CT-SEC-001 marker(s), 0 leak(s) in the evidence |  |

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
| CT-LIFE-007 | 通过（2/2） | 通过（2/2） |
| CT-LIFE-008 | 通过（1/1） | 通过（1/1） |
| CT-UI-001 | 通过（1/1） | 通过（1/1） |
| CT-UI-002 | 通过（1/1） | 通过（1/1） |
| CT-UI-003 | 通过（1/1） | 通过（1/1） |
| CT-UI-004 | 通过（6/6） | 通过（6/6） |
| CT-UI-005 | 通过（1/1） | 通过（1/1） |
| CT-JUMP-001 | 通过（1/1） | 通过（1/1） |
| CT-JUMP-002 | 通过（2/2） | 通过（2/2） |
| CT-JUMP-003 | 通过（1/1） | 通过（1/1） |
| CT-JUMP-005 | 通过（1/1） | 通过（1/1） |
| CT-POS-001 | 通过（1/1） | 通过（1/1） |
| CT-POS-002 | 通过（1/1） | 通过（1/1） |
| CT-POS-003 | 通过（1/1） | 通过（1/1） |
| CT-PERF-001 | 通过（6/6） | 通过（6/6） |
| CT-SEC-001 | 通过（1/1） | 通过（1/1） |
| CT-COEX-001 | 通过（1/1） | 通过（1/1） |

## CT-PERF-001（20 MiB，两种 fixture × 两个版本 × 3 次，取各次 p95 中最差的）

| 项 | 阈值 | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| 首次出目录：TOC 比宿主 transcript 显示末轮晚 | ≤ 4 s | 0.79 s | 0.56 s | 0.88 s | 0.64 s |
| 启动时首次整份读取加重组（与宿主 resume 争抢，参考） | — | 370 ms | 229 ms | 410 ms | 260 ms |
| 空闲时整份读取加重组（热重载后） | ≤ 1 s | 510 ms | 209 ms | 368 ms | 226 ms |
| 增量读取，单次 | ≤ 150 ms | 123.32 ms | 49.76 ms | 127.61 ms | 105.7 ms |
| 追加一行到目录模型更新 | ≤ 1 s | 546.81 ms | 345.11 ms | 573.77 ms | 338.85 ms |
| Pane 重画，插件自身计算 | ≤ 16 ms | 0.65 ms | 0.62 ms | 0.64 ms | 0.56 ms |
| Pane 重画，含等宿主 | ≤ 100 ms | 4.73 ms | 8.08 ms | 4.49 ms | 9.03 ms |
| Current position 每次计算 | ≤ 2 ms | 0.03 ms | 0.02 ms | 0.03 ms | 0.02 ms |
| 长会话连续滚动、跳转到首组和末组 | 必须能到达，不分页 | 是 | 是 | 是 | 是 |
| 实际残留在屏记录（最多） | — | 32 | 11 | 36 | 11 |
| 运行次数（全部通过） | 3 | 3（3） | 3（3） | 3（3） | 3（3） |

## 人工目检（待使用者签字）

> 不是发布阻断项（契约 §3、§5）。实现者没有签这一项：请使用者看下面的截屏（以及在自己的终端里实际看一次），确认三种 Layout（卡片、紧凑、时间轴）的观感，以及高亮（主题的 `suggestion` 色）与反色选择光标能一眼分清，然后在本节填写。

- 本次发布门禁重新截的屏（被测提交、两个版本、36/44/56 列，每组：卡片、紧凑、时间轴、卡片+只看用户、卡片+只看 Agent）：`signoff/<版本>-<列宽>/`
- 25 号票当时的截屏：`.scratch/chat-toc/assets/25-layouts/screens/`（2.1.287 与 2.1.295，36/44/56 列）
- 高亮色与反色在文本截屏里看不出；颜色由 CT-UI-003（高亮 `▌` 是 dark 主题的 `suggestion`、不反色；选择光标反色，二者不在同一行）与 CT-UI-004（四种主题下高亮与淡化各是该主题的解析值）自动核对，观感仍需真人看。

| 项 | 结论 | 签字 | 日期 |
| --- | --- | --- | --- |
| 三种 Layout 的观感 | 待填 | 待使用者签字 | |
| 高亮与反色选择光标能分清 | 待填 | 待使用者签字 | |

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
- 预期: marketplace add + install succeed; plugin list shows chat-toc@cc-mods 0.1.2 enabled; the Pane (loaded as chat-toc@cc-mods, no --plugin-dir) docks by itself; a click on T0000's user side puts that prompt at the top
- 实际: `{"source": "<repo>", "exits": [0, 0, 0], "listed": {"version": "0.1.2", "status": "enabled"}, "installedManifests": ["plugins/cache/cc-mods/chat-toc/0.1.2/.claude-plugin/plugin.json"], "loadedAs": ["chat-toc@cc-mods"], "openedUnasked": true, "clickJumped": true}`
- 证据: [commands-local-2.1.287.txt](pty/2.1.287/ct-marketplace/commands-local-2.1.287.txt), [001-local-2-1-287-docked-by-itself.txt](pty/2.1.287/ct-marketplace/screens/001-local-2-1-287-docked-by-itself.txt), [002-local-2-1-287-after-clicking-T0000.txt](pty/2.1.287/ct-marketplace/screens/002-local-2-1-287-after-clicking-T0000.txt), [debug-local-2.1.287-chat-toc-lines.log](pty/2.1.287/ct-marketplace/debug-local-2.1.287-chat-toc-lines.log)

### CT-COMPAT-002 · 2.1.295 · pass

- fixture: turns 12
- 预期: marketplace add + install succeed; plugin list shows chat-toc@cc-mods 0.1.2 enabled; the Pane (loaded as chat-toc@cc-mods, no --plugin-dir) docks by itself; a click on T0000's user side puts that prompt at the top
- 实际: `{"source": "<repo>", "exits": [0, 0, 0], "listed": {"version": "0.1.2", "status": "enabled"}, "installedManifests": ["plugins/cache/cc-mods/chat-toc/0.1.2/.claude-plugin/plugin.json"], "loadedAs": ["chat-toc@cc-mods"], "openedUnasked": true, "clickJumped": true}`
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
- 实际: `{"before": {"entries": 0, "notes": ["本会话还没有对话"], "transcriptFiles": 0}, "filesAfterSubmit": 1, "after": {"entries": [{"row": 1, "userHead": "你 · 10月12日 17:50", "userLines": ["CT-SYN 第一条合成 prompt"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "highlighted": true}], "expected": ["CT-SYN 第一条合成 prompt"]}}`
- 证据: [debug-data-001.log](pty/2.1.287/gate/debug-data-001.log), [020-data-001-new-session--before-the-first-message.txt](pty/2.1.287/gate/screens/020-data-001-new-session--before-the-first-message.txt), [021-data-001-after-the-first-submit.txt](pty/2.1.287/gate/screens/021-data-001-after-the-first-submit.txt)

### CT-DATA-001 · 2.1.295 · pass

- fixture: new session
- 预期: before the first message no transcript file exists and the Pane's body is the one line 本会话还没有对话; after the first submit it lists the new file's chain (verifier)
- 实际: `{"before": {"entries": 0, "notes": ["本会话还没有对话"], "transcriptFiles": 0}, "filesAfterSubmit": 1, "after": {"entries": [{"row": 2, "userHead": "你 · 10月12日 18:13", "userLines": ["CT-SYN 第一条合成 prompt"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "highlighted": true}], "expected": ["CT-SYN 第一条合成 prompt"]}}`
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
- 实际: `{"fileBytes": 9455432, "linesAcrossChunkEdges": {"4000000": true, "8000000": true}, "wholeList": {"ok": true, "covered": 48, "missing": [], "windows": 24}, "readWhole": [{"ms": 130.58, "chunks": 3, "groups": 48, "size": 9455515}], "readTailAfterSubmit": [{"ms": 23.11, "chunks": 1, "size": 9511849}, {"ms": 20.99, "chunks": 1, "size": 9513538}], "wholeReadsAfterSubmit": 0, "sizeBeforeSubmit": 94555…`
- 证据: [debug-data-004.log](pty/2.1.287/gate/debug-data-004.log), [029-data-004-resumed-9-MiB.txt](pty/2.1.287/gate/screens/029-data-004-resumed-9-MiB.txt), [whole-03.json](pty/2.1.287/gate/whole-03.json), [054-data-004-after-a-submit.txt](pty/2.1.287/gate/screens/054-data-004-after-a-submit.txt)

### CT-DATA-004 · 2.1.295 · pass

- fixture: heavy 9 MiB (rows across the 4,000,000 B and 8,000,000 B chunk edges)
- 预期: the chunked first read lists what the whole file holds (verifier, every window), rows split across chunk edges included; the next submit is read incrementally: one chunk from the last offset, no whole re-read
- 实际: `{"fileBytes": 9455432, "linesAcrossChunkEdges": {"4000000": true, "8000000": true}, "wholeList": {"ok": true, "covered": 48, "missing": [], "windows": 23}, "readWhole": [{"ms": 152.72, "chunks": 3, "groups": 48, "size": 9455515}], "readTailAfterSubmit": [{"ms": 99.76, "chunks": 1, "size": 9512670}, {"ms": 42.15, "chunks": 1, "size": 9514359}], "wholeReadsAfterSubmit": 0, "sizeBeforeSubmit": 94555…`
- 证据: [debug-data-004.log](pty/2.1.295/gate/debug-data-004.log), [029-data-004-resumed-9-MiB.txt](pty/2.1.295/gate/screens/029-data-004-resumed-9-MiB.txt), [whole-03.json](pty/2.1.295/gate/whole-03.json), [053-data-004-after-a-submit.txt](pty/2.1.295/gate/screens/053-data-004-after-a-submit.txt)

### CT-DATA-005 · 2.1.287 · pass

- fixture: forms
- 预期: a subagent's rows are not listed; the subagent call is 1 step; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"subagentOneStep": true, "subagentContentNotListed": true}}`
- 证据: [055-forms-after-resume.txt](pty/2.1.287/gate/screens/055-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-DATA-005 · 2.1.295 · pass

- fixture: forms
- 预期: a subagent's rows are not listed; the subagent call is 1 step; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"subagentOneStep": true, "subagentContentNotListed": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-DATA-006 · 2.1.287 · pass

- fixture: data-006
- 预期: each terminal lists only its own session's chain, before and after a submit in one of them
- 实际: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3"]}, "B": {"ok": true, "expected": 3, "covered": 3, "missing": [], "users": ["Q00 合成问题 0", "Q01 合成问题 1", "Q02 合成问题 2"]}, "AafterSubmit": {"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3", "P 终端一里提交的合成 …`
- 证据: [016-terminal-1--session-A.txt](pty/2.1.287/chain/screens/016-terminal-1--session-A.txt), [016-terminal-1--session-A-diff.json](pty/2.1.287/chain/016-terminal-1--session-A-diff.json), [017-terminal-2--session-B.txt](pty/2.1.287/chain/screens/017-terminal-2--session-B.txt), [017-terminal-2--session-B-diff.json](pty/2.1.287/chain/017-terminal-2--session-B-diff.json), [018-terminal-1-after-its-submit.txt](pty/2.1.287/chain/screens/018-terminal-1-after-its-submit.txt), [018-terminal-1-after-its-submit-diff.json](pty/2.1.287/chain/018-terminal-1-after-its-submit-diff.json) 等 8 个

### CT-DATA-006 · 2.1.295 · pass

- fixture: data-006
- 预期: each terminal lists only its own session's chain, before and after a submit in one of them
- 实际: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3"]}, "B": {"ok": true, "expected": 3, "covered": 3, "missing": [], "users": ["Q00 合成问题 0", "Q01 合成问题 1", "Q02 合成问题 2"]}, "AafterSubmit": {"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["P00 合成问题 0", "P01 合成问题 1", "P02 合成问题 2", "P03 合成问题 3", "P 终端一里提交的合成 …`
- 证据: [016-terminal-1--session-A.txt](pty/2.1.295/chain/screens/016-terminal-1--session-A.txt), [016-terminal-1--session-A-diff.json](pty/2.1.295/chain/016-terminal-1--session-A-diff.json), [017-terminal-2--session-B.txt](pty/2.1.295/chain/screens/017-terminal-2--session-B.txt), [017-terminal-2--session-B-diff.json](pty/2.1.295/chain/017-terminal-2--session-B-diff.json), [018-terminal-1-after-its-submit.txt](pty/2.1.295/chain/screens/018-terminal-1-after-its-submit.txt), [018-terminal-1-after-its-submit-diff.json](pty/2.1.295/chain/018-terminal-1-after-its-submit-diff.json) 等 8 个

### CT-TURN-001 · 2.1.287 · pass

- fixture: forms
- 预期: prompts, slash commands (a user row, a system/local_command row), a prompt-type command, !cmd and a queued prompt each open a group; output, notices, interrupts and reminders open none; local commands and !cmd have a user side only; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"prompt": true, "slashPrompt": true, "localCommandUserRow": true, "localCommandSystemRow": true, "bang": true, "queued": true, "noOutputOrNoticeGroups": true, "localCommandsUserSideOnly": true}}`
- 证据: [055-forms-after-resume.txt](pty/2.1.287/gate/screens/055-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-001 · 2.1.295 · pass

- fixture: forms
- 预期: prompts, slash commands (a user row, a system/local_command row), a prompt-type command, !cmd and a queued prompt each open a group; output, notices, interrupts and reminders open none; local commands and !cmd have a user side only; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"prompt": true, "slashPrompt": true, "localCommandUserRow": true, "localCommandSystemRow": true, "bang": true, "queued": true, "noOutputOrNoticeGroups": true, "localCommandsUserSideOnly": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-002 · 2.1.287 · pass

- fixture: forms
- 预期: three identical prompts are three entries; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"identicalPromptEntries": 3}}`
- 证据: [055-forms-after-resume.txt](pty/2.1.287/gate/screens/055-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-002 · 2.1.295 · pass

- fixture: forms
- 预期: three identical prompts are three entries; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"identicalPromptEntries": 3}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-003 · 2.1.287 · pass

- fixture: forms
- 预期: multi-line CJK/emoji text is cut to 2 lines by cell width with …; <pasted_content> tags removed; an image-only prompt says （只有图片）; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"multilineTwoLinesWithEllipsis": true, "multilineLines": ["F02 多行与宽字符：第一行中文 第二行 emoji", "🚀✨ 与全角，ＡＢＣ 第三行很长很长很长很…"], "pasteTagsGone": true, "imageOnly": true}}`
- 证据: [055-forms-after-resume.txt](pty/2.1.287/gate/screens/055-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-003 · 2.1.295 · pass

- fixture: forms
- 预期: multi-line CJK/emoji text is cut to 2 lines by cell width with …; <pasted_content> tags removed; an image-only prompt says （只有图片）; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"multilineTwoLinesWithEllipsis": true, "multilineLines": ["F02 多行与宽字符：第一行中文 第二行 emoji", "🚀✨ 与全角，ＡＢＣ 第三行很长很长很长很…"], "pasteTagsGone": true, "imageOnly": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-004 · 2.1.287 · pass

- fixture: forms
- 预期: the Agent side reads N 步 with the last text, N 步 · 无文字回复, 已中断 · N 步, 出错 · N 步 as the file has it (the live 进行中 · N 步: turn-004-live); the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"stepsAndLastText": true, "noTextReply": true, "interrupted": true, "error": true}}`
- 证据: [055-forms-after-resume.txt](pty/2.1.287/gate/screens/055-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

### CT-TURN-004 · 2.1.287 · pass

- fixture: turns 3 + one live turn against fake_api.py (two Read steps, 4 s apart; no model)
- 预期: while the turn runs the last entry reads 进行中, then 进行中 · 1 步, 进行中 · 2 步 as the steps land; after it, 2 步 with the closing text, as the verifier reads the file
- 实际: `{"final": {"row": 22, "userHead": "你 · 10月12日 17:51", "userLines": ["CT-TURN-004 进行中的合成一轮"], "agentHead": "2 步", "agentLines": ["完成"], "highlighted": true}, "finalMatchesVerifier": true, "requests": [{"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 0}, {"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 1}, {"m…`
- 证据: [063-turn-004-live-3-步.txt](pty/2.1.287/gate/screens/063-turn-004-live-3-步.txt), [064-turn-004-live-进行中.txt](pty/2.1.287/gate/screens/064-turn-004-live-进行中.txt), [065-turn-004-live-进行中---1-步.txt](pty/2.1.287/gate/screens/065-turn-004-live-进行中---1-步.txt), [066-turn-004-live-进行中---2-步.txt](pty/2.1.287/gate/screens/066-turn-004-live-进行中---2-步.txt), [067-turn-004-live-2-步.txt](pty/2.1.287/gate/screens/067-turn-004-live-2-步.txt), [068-turn-004-live-done.txt](pty/2.1.287/gate/screens/068-turn-004-live-done.txt)

### CT-TURN-004 · 2.1.295 · pass

- fixture: forms
- 预期: the Agent side reads N 步 with the last text, N 步 · 无文字回复, 已中断 · N 步, 出错 · N 步 as the file has it (the live 进行中 · N 步: turn-004-live); the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"stepsAndLastText": true, "noTextReply": true, "interrupted": true, "error": true}}`
- 证据: [054-forms-after-resume.txt](pty/2.1.295/gate/screens/054-forms-after-resume.txt), [whole-04.json](pty/2.1.295/gate/whole-04.json), [forms-entries.json](pty/2.1.295/gate/forms-entries.json)

### CT-TURN-004 · 2.1.295 · pass

- fixture: turns 3 + one live turn against fake_api.py (two Read steps, 4 s apart; no model)
- 预期: while the turn runs the last entry reads 进行中, then 进行中 · 1 步, 进行中 · 2 步 as the steps land; after it, 2 步 with the closing text, as the verifier reads the file
- 实际: `{"final": {"row": 23, "userHead": "你 · 10月12日 18:14", "userLines": ["CT-TURN-004 进行中的合成一轮"], "agentHead": "2 步", "agentLines": ["完成"], "highlighted": true}, "finalMatchesVerifier": true, "requests": [{"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 0}, {"method": "POST", "path": "/v1/messages?beta=true", "stream": true, "tools": 27, "scripted": 1}, {"m…`
- 证据: [062-turn-004-live-3-步.txt](pty/2.1.295/gate/screens/062-turn-004-live-3-步.txt), [063-turn-004-live-进行中.txt](pty/2.1.295/gate/screens/063-turn-004-live-进行中.txt), [064-turn-004-live-进行中---1-步.txt](pty/2.1.295/gate/screens/064-turn-004-live-进行中---1-步.txt), [065-turn-004-live-进行中---2-步.txt](pty/2.1.295/gate/screens/065-turn-004-live-进行中---2-步.txt), [066-turn-004-live-2-步.txt](pty/2.1.295/gate/screens/066-turn-004-live-2-步.txt), [067-turn-004-live-done.txt](pty/2.1.295/gate/screens/067-turn-004-live-done.txt)

### CT-TURN-005 · 2.1.287 · pass

- fixture: forms
- 预期: time from the row's timestamp; the row without one shows no time; the whole list equals the verifier's
- 实际: `{"wholeList": {"ok": true, "covered": 20, "missing": [], "windows": 7}, "checks": {"noTimestampNoTime": true, "othersTimed": true}}`
- 证据: [055-forms-after-resume.txt](pty/2.1.287/gate/screens/055-forms-after-resume.txt), [whole-04.json](pty/2.1.287/gate/whole-04.json), [forms-entries.json](pty/2.1.287/gate/forms-entries.json)

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
- 实际: `{"afterClearOpen": {"entries": [{"row": 1, "userHead": "你 · 10月12日 17:44", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "highlighted": false}], "notes": [], "file": "0bec8b44-e60a-44a7-8ee2-6390491d52c1.jsonl"}, "rebuilt": true, "afterClearClosed": {"entries": [{"row": 1, "userHead": "你 · 10月12日 17:44", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "highlighted": …`
- 证据: [debug-002.log](pty/2.1.287/ct-life/debug-002.log), [009-002-opened-by-itself.txt](pty/2.1.287/ct-life/screens/009-002-opened-by-itself.txt), [010-002-after--clear-with-the-Pane-open.txt](pty/2.1.287/ct-life/screens/010-002-after--clear-with-the-Pane-open.txt), [011-002-closed-by--.txt](pty/2.1.287/ct-life/screens/011-002-closed-by--.txt), [012-002--clear-after---opened-it-again.txt](pty/2.1.287/ct-life/screens/012-002--clear-after---opened-it-again.txt)

### CT-LIFE-002 · 2.1.295 · pass

- fixture: turns 6
- 预期: /clear lists just the new session's chain (verifier), nothing of the old and no line parting them; after ✕, /clear opens the Pane again
- 实际: `{"afterClearOpen": {"entries": [{"row": 2, "userHead": "你 · 10月12日 18:07", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "highlighted": false}], "notes": [], "file": "648a5163-bdcc-4cfb-9d74-81f7e16ce2af.jsonl"}, "rebuilt": true, "afterClearClosed": {"entries": [{"row": 2, "userHead": "你 · 10月12日 18:07", "userLines": ["/clear"], "agentHead": null, "agentLines": [], "highlighted": …`
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
- 预期: within 500 ms of the restore, with the file unchanged, the Pane lists R00-R02 only; after the next submit it equals the file's chain: R00-R02 and the new prompt
- 实际: `{"before": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "droppedAfterMs": 11, "fileUnchanged": true, "heldBeforeSubmit": true, "after": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 rewind 之后提交的合成 prompt"]}}`
- 证据: [002-before-rewind.txt](pty/2.1.287/chain/screens/002-before-rewind.txt), [002-before-rewind-diff.json](pty/2.1.287/chain/002-before-rewind-diff.json), [003-rewind-dialog-on-R03.txt](pty/2.1.287/chain/screens/003-rewind-dialog-on-R03.txt), [004-after-rewind--before-the-next-submit.txt](pty/2.1.287/chain/screens/004-after-rewind--before-the-next-submit.txt), [005-after-the-next-submit.txt](pty/2.1.287/chain/screens/005-after-the-next-submit.txt), [005-after-the-next-submit-diff.json](pty/2.1.287/chain/005-after-the-next-submit-diff.json)

### CT-LIFE-004 · 2.1.295 · pass

- fixture: life-004
- 预期: within 500 ms of the restore, with the file unchanged, the Pane lists R00-R02 only; after the next submit it equals the file's chain: R00-R02 and the new prompt
- 实际: `{"before": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "droppedAfterMs": 11, "fileUnchanged": true, "heldBeforeSubmit": true, "after": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 rewind 之后提交的合成 prompt"]}}`
- 证据: [002-before-rewind.txt](pty/2.1.295/chain/screens/002-before-rewind.txt), [002-before-rewind-diff.json](pty/2.1.295/chain/002-before-rewind-diff.json), [003-rewind-dialog-on-R03.txt](pty/2.1.295/chain/screens/003-rewind-dialog-on-R03.txt), [004-after-rewind--before-the-next-submit.txt](pty/2.1.295/chain/screens/004-after-rewind--before-the-next-submit.txt), [005-after-the-next-submit.txt](pty/2.1.295/chain/screens/005-after-the-next-submit.txt), [005-after-the-next-submit-diff.json](pty/2.1.295/chain/005-after-the-next-submit-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-continue
- 预期: --continue opens the newest session; the Pane equals its chain
- 实际: `{"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["N00 合成问题 0", "N01 合成问题 1", "N02 合成问题 2", "N03 合成问题 3", "NYY rewind 之后的一轮"]}`
- 证据: [010-after---continue.txt](pty/2.1.287/chain/screens/010-after---continue.txt), [010-after---continue-diff.json](pty/2.1.287/chain/010-after---continue-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-fork
- 预期: before the first submit the fork has no file and the Pane says it is not written yet; after it the Pane equals the fork file's chain; the original file keeps its own
- 实际: `{"atStart": {"forkFile": null, "entries": 0, "notWrittenText": true, "emptyText": false}, "forkFile": "40e603a2-2952-4c40-8f1f-e7343ca61fa1.jsonl", "afterSubmit": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["F02 合成问题 2", "F03 合成问题 3", "FYY rewind 之后的一轮", "F 分叉之后的合成 prompt"]}, "originalUntouched": true}`
- 证据: [011-after---fork-session--before-a-submit.txt](pty/2.1.287/chain/screens/011-after---fork-session--before-a-submit.txt), [012-after-the-first-submit-in-the-fork.txt](pty/2.1.287/chain/screens/012-after-the-first-submit-in-the-fork.txt), [012-after-the-first-submit-in-the-fork-diff.json](pty/2.1.287/chain/012-after-the-first-submit-in-the-fork-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: life-005-in-session
- 预期: after /resume picks B, the Pane equals B's chain
- 实际: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["A00 合成问题 0", "A01 合成问题 1", "A02 合成问题 2", "A03 合成问题 3"]}, "B": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["B00 合成问题 0", "B01 合成问题 1", "B02 合成问题 2", "BYY rewind 之后的一轮"]}}`
- 证据: [013-session-A-before--resume.txt](pty/2.1.287/chain/screens/013-session-A-before--resume.txt), [013-session-A-before--resume-diff.json](pty/2.1.287/chain/013-session-A-before--resume-diff.json), [014-resume-picker.txt](pty/2.1.287/chain/screens/014-resume-picker.txt), [015-session-B-after-in-session--resume.txt](pty/2.1.287/chain/screens/015-session-B-after-in-session--resume.txt), [015-session-B-after-in-session--resume-diff.json](pty/2.1.287/chain/015-session-B-after-in-session--resume-diff.json)

### CT-LIFE-005 · 2.1.287 · pass

- fixture: turns 6, --fork-session
- 预期: before the fork's first submit its file does not exist and the Pane says 本会话还没写进 transcript 文件，提交第一条消息后显示目录; after the submit the Pane matches the fork file's chain (verifier)
- 实际: `{"forkFileExists": false, "saysNotWritten": true, "listsForkChain": true}`
- 证据: [debug-fork.log](pty/2.1.287/ct-life/debug-fork.log), [013-fork-before-the-first-submit.txt](pty/2.1.287/ct-life/screens/013-fork-before-the-first-submit.txt), [014-fork-after-the-first-submit.txt](pty/2.1.287/ct-life/screens/014-fork-after-the-first-submit.txt)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-continue
- 预期: --continue opens the newest session; the Pane equals its chain
- 实际: `{"ok": true, "expected": 5, "covered": 5, "missing": [], "users": ["N00 合成问题 0", "N01 合成问题 1", "N02 合成问题 2", "N03 合成问题 3", "NYY rewind 之后的一轮"]}`
- 证据: [010-after---continue.txt](pty/2.1.295/chain/screens/010-after---continue.txt), [010-after---continue-diff.json](pty/2.1.295/chain/010-after---continue-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-fork
- 预期: before the first submit the fork has no file and the Pane says it is not written yet; after it the Pane equals the fork file's chain; the original file keeps its own
- 实际: `{"atStart": {"forkFile": null, "entries": 0, "notWrittenText": true, "emptyText": false}, "forkFile": "2524c567-ba67-461b-a3ae-de016efa3545.jsonl", "afterSubmit": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["F02 合成问题 2", "F03 合成问题 3", "FYY rewind 之后的一轮", "F 分叉之后的合成 prompt"]}, "originalUntouched": true}`
- 证据: [011-after---fork-session--before-a-submit.txt](pty/2.1.295/chain/screens/011-after---fork-session--before-a-submit.txt), [012-after-the-first-submit-in-the-fork.txt](pty/2.1.295/chain/screens/012-after-the-first-submit-in-the-fork.txt), [012-after-the-first-submit-in-the-fork-diff.json](pty/2.1.295/chain/012-after-the-first-submit-in-the-fork-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: life-005-in-session
- 预期: after /resume picks B, the Pane equals B's chain
- 实际: `{"A": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["A00 合成问题 0", "A01 合成问题 1", "A02 合成问题 2", "A03 合成问题 3"]}, "B": {"ok": true, "expected": 4, "covered": 4, "missing": [], "users": ["B00 合成问题 0", "B01 合成问题 1", "B02 合成问题 2", "BYY rewind 之后的一轮"]}}`
- 证据: [013-session-A-before--resume.txt](pty/2.1.295/chain/screens/013-session-A-before--resume.txt), [013-session-A-before--resume-diff.json](pty/2.1.295/chain/013-session-A-before--resume-diff.json), [014-resume-picker.txt](pty/2.1.295/chain/screens/014-resume-picker.txt), [015-session-B-after-in-session--resume.txt](pty/2.1.295/chain/screens/015-session-B-after-in-session--resume.txt), [015-session-B-after-in-session--resume-diff.json](pty/2.1.295/chain/015-session-B-after-in-session--resume-diff.json)

### CT-LIFE-005 · 2.1.295 · pass

- fixture: turns 6, --fork-session
- 预期: before the fork's first submit its file does not exist and the Pane says 本会话还没写进 transcript 文件，提交第一条消息后显示目录; after the submit the Pane matches the fork file's chain (verifier)
- 实际: `{"forkFileExists": false, "saysNotWritten": true, "listsForkChain": true}`
- 证据: [debug-fork.log](pty/2.1.295/ct-life/debug-fork.log), [013-fork-before-the-first-submit.txt](pty/2.1.295/ct-life/screens/013-fork-before-the-first-submit.txt), [014-fork-after-the-first-submit.txt](pty/2.1.295/ct-life/screens/014-fork-after-the-first-submit.txt)

### CT-LIFE-006 · 2.1.287 · pass

- fixture: turns 300
- 预期: after a hot reload the lit group is the view's (after a wheel), and a jump lands its prompt at the top and lights its group
- 实际: `{"before": {"top": 282, "sitedTop": 282, "lit": [282], "paused": false, "window": [282, 283, 284, 285, 286], "lastWhole": false}, "afterReload": {"top": 282, "sitedTop": 282, "lit": [282], "paused": false, "window": [282, 283, 284, 285, 286], "lastWhole": false}, "afterWheel": {"top": 281, "sitedTop": 281, "lit": [281], "paused": false, "window": [281, 282, 283, 284, 285], "lastWhole": false}, "j…`
- 证据: [027-after-the-hot-reload.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/027-after-the-hot-reload.txt), [028-after-a-wheel.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/028-after-a-wheel.txt), [029-after-jumping-to-T0282.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/029-after-jumping-to-T0282.txt)

### CT-LIFE-006 · 2.1.295 · pass

- fixture: turns 300
- 预期: after a hot reload the lit group is the view's (after a wheel), and a jump lands its prompt at the top and lights its group
- 实际: `{"before": {"top": 284, "sitedTop": 284, "lit": [284], "paused": false, "window": [282, 283, 284, 285, 286], "lastWhole": false}, "afterReload": {"top": 284, "sitedTop": 284, "lit": [284], "paused": false, "window": [284, 285, 286, 287, 288], "lastWhole": false}, "afterWheel": {"top": 284, "sitedTop": 284, "lit": [284], "paused": false, "window": [284, 285, 286, 287, 288], "lastWhole": false}, "j…`
- 证据: [027-after-the-hot-reload.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/027-after-the-hot-reload.txt), [028-after-a-wheel.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/028-after-a-wheel.txt), [029-after-jumping-to-T0285.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/029-after-jumping-to-T0285.txt)

### CT-LIFE-007 · 2.1.287 · pass

- fixture: fresh session in a 262-character CJK project path, 3 prompts
- 预期: after `claude plugin enable` and /reload-plugins, with nothing more submitted, the Pane opens by itself and matches the session file's chain (verifier)
- 实际: `{"way": "claude plugin enable + /reload-plugins", "projectPathLength": 262, "install": [0, 0, 0], "paneBeforeEnable": false, "enableExit": 0, "entries": [{"row": 1, "userHead": "你 · 10月12日 17:44", "userLines": ["CT-SYN alpha one"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "highlighted": false}, {"row": 6, "userHead": "你 · 10月12日 17:44", "userLines": ["CT-SYN beta tw…`
- 证据: [debug-cli-2.1.287.log](pty/2.1.287/ct-mid-session/debug-cli-2.1.287.log), [001-cli-three-prompts--chat-toc-disabled.txt](pty/2.1.287/ct-mid-session/screens/001-cli-three-prompts--chat-toc-disabled.txt), [002-cli-listed-after-enabling.txt](pty/2.1.287/ct-mid-session/screens/002-cli-listed-after-enabling.txt)

### CT-LIFE-007 · 2.1.287 · pass

- fixture: turns 6, --resume
- 预期: after enabling in /plugin and closing the menu (the host reloads by itself), with nothing submitted, the Pane opens by itself and matches the session file's chain (verifier)
- 实际: `{"way": "/plugin menu, closed with Esc", "install": [0, 0, 0], "paneBeforeEnable": false, "entries": [{"row": 5, "userHead": "你 · 10月9日 09:01", "userLines": ["T0002 用户问题：请检查第 2 个模块的状态，", "并说明下一步该做什么。"], "agentHead": "3 步", "agentLines": ["T0002 回复： 第 1 行说明：模块 2 的检查", "结果正常，没有发现需要处理的问题。 第 2…"], "highlighted": false}, {"row": 12, "userHead": "你 · 10月9日 09:02", "userLines": ["T0003 用户问题：请检查第 3 个模块的状…`
- 证据: [debug-ui-2.1.287.log](pty/2.1.287/ct-mid-session/debug-ui-2.1.287.log), [003-ui-chat-toc-toggled-in--plugin.txt](pty/2.1.287/ct-mid-session/screens/003-ui-chat-toc-toggled-in--plugin.txt), [004-ui-listed-after-enabling.txt](pty/2.1.287/ct-mid-session/screens/004-ui-listed-after-enabling.txt)

### CT-LIFE-007 · 2.1.295 · pass

- fixture: fresh session in a 262-character CJK project path, 3 prompts
- 预期: after `claude plugin enable` and /reload-plugins, with nothing more submitted, the Pane opens by itself and matches the session file's chain (verifier)
- 实际: `{"way": "claude plugin enable + /reload-plugins", "projectPathLength": 262, "install": [0, 0, 0], "paneBeforeEnable": false, "enableExit": 0, "entries": [{"row": 2, "userHead": "你 · 10月12日 18:07", "userLines": ["CT-SYN alpha one"], "agentHead": "出错", "agentLines": ["Not logged in · Please run /login"], "highlighted": false}, {"row": 7, "userHead": "你 · 10月12日 18:07", "userLines": ["CT-SYN beta tw…`
- 证据: [debug-cli-2.1.295.log](pty/2.1.295/ct-mid-session/debug-cli-2.1.295.log), [001-cli-three-prompts--chat-toc-disabled.txt](pty/2.1.295/ct-mid-session/screens/001-cli-three-prompts--chat-toc-disabled.txt), [002-cli-listed-after-enabling.txt](pty/2.1.295/ct-mid-session/screens/002-cli-listed-after-enabling.txt)

### CT-LIFE-007 · 2.1.295 · pass

- fixture: turns 6, --resume
- 预期: after enabling in /plugin and closing the menu (the host reloads by itself), with nothing submitted, the Pane opens by itself and matches the session file's chain (verifier)
- 实际: `{"way": "/plugin menu, closed with Esc", "install": [0, 0, 0], "paneBeforeEnable": false, "entries": [{"row": 6, "userHead": "你 · 10月9日 09:01", "userLines": ["T0002 用户问题：请检查第 2 个模块的状态，", "并说明下一步该做什么。"], "agentHead": "3 步", "agentLines": ["T0002 回复： 第 1 行说明：模块 2 的检查", "结果正常，没有发现需要处理的问题。 第 2…"], "highlighted": false}, {"row": 13, "userHead": "你 · 10月9日 09:02", "userLines": ["T0003 用户问题：请检查第 3 个模块的状…`
- 证据: [debug-ui-2.1.295.log](pty/2.1.295/ct-mid-session/debug-ui-2.1.295.log), [003-ui-chat-toc-toggled-in--plugin.txt](pty/2.1.295/ct-mid-session/screens/003-ui-chat-toc-toggled-in--plugin.txt), [004-ui-listed-after-enabling.txt](pty/2.1.295/ct-mid-session/screens/004-ui-listed-after-enabling.txt)

### CT-LIFE-008 · 2.1.287 · pass

- fixture: life-008
- 预期: after quitting a rewound session without a submit and resuming it, the Pane equals the file's whole chain R00-R05, and R05 shows in the transcript too
- 实际: `{"afterResume": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "paneListsR05": true, "transcriptShowsR05": true}`
- 证据: [006-rewind-dialog-on-R03.txt](pty/2.1.287/chain/screens/006-rewind-dialog-on-R03.txt), [007-008-rewound--not-submitted.txt](pty/2.1.287/chain/screens/007-008-rewound--not-submitted.txt), [008-008-resumed-after-quitting.txt](pty/2.1.287/chain/screens/008-008-resumed-after-quitting.txt), [008-008-resumed-after-quitting-diff.json](pty/2.1.287/chain/008-008-resumed-after-quitting-diff.json), [009-008-after-resume.txt](pty/2.1.287/chain/screens/009-008-after-resume.txt)

### CT-LIFE-008 · 2.1.295 · pass

- fixture: life-008
- 预期: after quitting a rewound session without a submit and resuming it, the Pane equals the file's whole chain R00-R05, and R05 shows in the transcript too
- 实际: `{"afterResume": {"ok": true, "expected": 6, "covered": 6, "missing": [], "users": ["R00 合成问题 0", "R01 合成问题 1", "R02 合成问题 2", "R03 合成问题 3", "R04 合成问题 4", "R05 合成问题 5"]}, "paneListsR05": true, "transcriptShowsR05": true}`
- 证据: [006-rewind-dialog-on-R03.txt](pty/2.1.295/chain/screens/006-rewind-dialog-on-R03.txt), [007-008-rewound--not-submitted.txt](pty/2.1.295/chain/screens/007-008-rewound--not-submitted.txt), [008-008-resumed-after-quitting.txt](pty/2.1.295/chain/screens/008-008-resumed-after-quitting.txt), [008-008-resumed-after-quitting-diff.json](pty/2.1.295/chain/008-008-resumed-after-quitting-diff.json), [009-008-after-resume.txt](pty/2.1.295/chain/screens/009-008-after-resume.txt)

### CT-UI-001 · 2.1.287 · pass

- fixture: turns 9 (a /tui group with a user side only)
- 预期: 2/3/1 switch the filter and the Pane redraws at once (≤ 1 s from the key), each whole list equal to the verifier's for that filter (Agent hides the user-only group); the choice survives a new process; an unknown stored value reads as 全部
- 实际: `{"user": {"redrawSeconds": 0.13, "wholeList": {"ok": true, "covered": 9, "missing": []}}, "agent": {"redrawSeconds": 0.12, "wholeList": {"ok": true, "covered": 8, "missing": []}}, "all": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 9, "missing": []}}, "newProcessFilterRow": "1: ○全部 2: ○用户 3: ●Agent  l: 布局:卡片  ✕", "unknownValueFilterRow": "1: ●全部 2: ○用户 3: ○Agent  l: 布局:卡片  ✕"}`
- 证据: [069-ui-001-filter-user.txt](pty/2.1.287/gate/screens/069-ui-001-filter-user.txt), [whole-05.json](pty/2.1.287/gate/whole-05.json), [071-ui-001-filter-agent.txt](pty/2.1.287/gate/screens/071-ui-001-filter-agent.txt), [whole-06.json](pty/2.1.287/gate/whole-06.json), [073-ui-001-filter-all.txt](pty/2.1.287/gate/screens/073-ui-001-filter-all.txt), [whole-07.json](pty/2.1.287/gate/whole-07.json) 等 8 个

### CT-UI-001 · 2.1.295 · pass

- fixture: turns 9 (a /tui group with a user side only)
- 预期: 2/3/1 switch the filter and the Pane redraws at once (≤ 1 s from the key), each whole list equal to the verifier's for that filter (Agent hides the user-only group); the choice survives a new process; an unknown stored value reads as 全部
- 实际: `{"user": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 9, "missing": []}}, "agent": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 8, "missing": []}}, "all": {"redrawSeconds": 0.11, "wholeList": {"ok": true, "covered": 9, "missing": []}}, "newProcessFilterRow": "1: ○全部 2: ○用户 3: ●Agent  l: 布局:卡片", "unknownValueFilterRow": "1: ●全部 2: ○用户 3: ○Agent  l: 布局:卡片"}`
- 证据: [068-ui-001-filter-user.txt](pty/2.1.295/gate/screens/068-ui-001-filter-user.txt), [whole-05.json](pty/2.1.295/gate/whole-05.json), [070-ui-001-filter-agent.txt](pty/2.1.295/gate/screens/070-ui-001-filter-agent.txt), [whole-06.json](pty/2.1.295/gate/whole-06.json), [072-ui-001-filter-all.txt](pty/2.1.295/gate/screens/072-ui-001-filter-all.txt), [whole-07.json](pty/2.1.295/gate/whole-07.json) 等 8 个

### CT-UI-002 · 2.1.287 · pass

- fixture: turns 5 (fits the window in every Layout)
- 预期: l and the 布局 button cycle 卡片 → 紧凑 → 时间轴, each listing the same 5 entries with their Agent sides; the choice survives a new process; an unknown stored value reads as 卡片
- 实际: `{"views": [{"label": "卡片", "turns": [0, 1, 2, 3, 4], "agentSides": 5}, {"label": "紧凑", "turns": [0, 1, 2, 3, 4], "agentSides": 5}, {"label": "时间轴", "turns": [0, 1, 2, 3, 4], "agentSides": 5}], "newProcessLayout": "紧凑", "unknownValueLayout": "卡片"}`
- 证据: [079-ui-002-card.txt](pty/2.1.287/gate/screens/079-ui-002-card.txt), [080-ui-002-compact-by-l.txt](pty/2.1.287/gate/screens/080-ui-002-compact-by-l.txt), [081-ui-002-timeline-by-a-click.txt](pty/2.1.287/gate/screens/081-ui-002-timeline-by-a-click.txt), [082-ui-002-new-process.txt](pty/2.1.287/gate/screens/082-ui-002-new-process.txt)

### CT-UI-002 · 2.1.295 · pass

- fixture: turns 5 (fits the window in every Layout)
- 预期: l and the 布局 button cycle 卡片 → 紧凑 → 时间轴, each listing the same 5 entries with their Agent sides; the choice survives a new process; an unknown stored value reads as 卡片
- 实际: `{"views": [{"label": "卡片", "turns": [0, 1, 2, 3, 4], "agentSides": 5}, {"label": "紧凑", "turns": [0, 1, 2, 3, 4], "agentSides": 5}, {"label": "时间轴", "turns": [0, 1, 2, 3, 4], "agentSides": 5}], "newProcessLayout": "紧凑", "unknownValueLayout": "卡片"}`
- 证据: [078-ui-002-card.txt](pty/2.1.295/gate/screens/078-ui-002-card.txt), [079-ui-002-compact-by-l.txt](pty/2.1.295/gate/screens/079-ui-002-compact-by-l.txt), [080-ui-002-timeline-by-a-click.txt](pty/2.1.295/gate/screens/080-ui-002-timeline-by-a-click.txt), [081-ui-002-new-process.txt](pty/2.1.295/gate/screens/081-ui-002-new-process.txt)

### CT-UI-003 · 2.1.287 · pass

- fixture: turns 12 compacted after T0001, --resume: T0000-T0001 dimmed from the start
- 预期: focused, ↑ walks one side at a time (agent, user, the turn before's agent, ...); Enter on T0002's user side puts that prompt at the top and lights it; one more ↑ moves the inverse ring off it onto T0001's dimmed Agent side (not skipped) while the ▌ in the theme's `suggestion` (not inverse) stays on T0002
- 实际: `{"dimmedBeforeKeys": true, "walk": [{"ring": [[35, "↳ 3 步"]], "turn": 11, "side": "agent", "dim": null, "lit": [[32, "b1b9f9"]]}, {"ring": [[32, "你 · 10月9日 09:07"]], "turn": 11, "side": "user", "dim": false, "lit": [[32, "b1b9f9"]]}, {"ring": [[28, "↳ 2 步"]], "turn": 10, "side": "agent", "dim": null, "lit": [[32, "b1b9f9"]]}, {"ring": [[25, "你 · 10月9日 09:06"]], "turn": 10, "side": "user", "dim": …`
- 证据: [083-ui-003-T0001--compacted-before-the-resume--dimmed.txt](pty/2.1.287/gate/screens/083-ui-003-T0001--compacted-before-the-resume--dimmed.txt), [084-ui-003-after-the---walk.txt](pty/2.1.287/gate/screens/084-ui-003-after-the---walk.txt), [085-ui-003-Enter-on-T0002.txt](pty/2.1.287/gate/screens/085-ui-003-Enter-on-T0002.txt), [086-ui-003-ring-moved-off-the-lit-entry.txt](pty/2.1.287/gate/screens/086-ui-003-ring-moved-off-the-lit-entry.txt)

### CT-UI-003 · 2.1.295 · pass

- fixture: turns 12 compacted after T0001, --resume: T0000-T0001 dimmed from the start
- 预期: focused, ↑ walks one side at a time (agent, user, the turn before's agent, ...); Enter on T0002's user side puts that prompt at the top and lights it; one more ↑ moves the inverse ring off it onto T0001's dimmed Agent side (not skipped) while the ▌ in the theme's `suggestion` (not inverse) stays on T0002
- 实际: `{"dimmedBeforeKeys": true, "walk": [{"ring": [[33, "↳ 3 步"]], "turn": 11, "side": "agent", "dim": null, "lit": [[30, "b1b9f9"]]}, {"ring": [[30, "你 · 10月9日 09:07"]], "turn": 11, "side": "user", "dim": false, "lit": [[30, "b1b9f9"]]}, {"ring": [[26, "↳ 2 步"]], "turn": 10, "side": "agent", "dim": null, "lit": [[30, "b1b9f9"]]}, {"ring": [[23, "你 · 10月9日 09:06"]], "turn": 10, "side": "user", "dim": …`
- 证据: [082-ui-003-T0001--compacted-before-the-resume--dimmed.txt](pty/2.1.295/gate/screens/082-ui-003-T0001--compacted-before-the-resume--dimmed.txt), [083-ui-003-after-the---walk.txt](pty/2.1.295/gate/screens/083-ui-003-after-the---walk.txt), [084-ui-003-Enter-on-T0002.txt](pty/2.1.295/gate/screens/084-ui-003-Enter-on-T0002.txt), [085-ui-003-ring-moved-off-the-lit-entry.txt](pty/2.1.295/gate/screens/085-ui-003-ring-moved-off-the-lit-entry.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme dark
- 预期: the lit ▌ is b1b9f9 (the theme's suggestion); the dimmed 你 · time / ↳ lines and the blank gutters are 999999 (its inactive)
- 实际: `{"theme": "dark", "expected": {"lit": "b1b9f9", "dimmed": "999999"}, "lit": ["b1b9f9"], "gutter": ["999999"], "dimmed": ["999999"], "text": ["default"]}`
- 证据: [087-ui-004-dark.txt](pty/2.1.287/gate/screens/087-ui-004-dark.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme light
- 预期: the lit ▌ is 5769f7 (the theme's suggestion); the dimmed 你 · time / ↳ lines and the blank gutters are 666666 (its inactive)
- 实际: `{"theme": "light", "expected": {"lit": "5769f7", "dimmed": "666666"}, "lit": ["5769f7"], "gutter": ["666666"], "dimmed": ["666666"], "text": ["default"]}`
- 证据: [088-ui-004-light.txt](pty/2.1.287/gate/screens/088-ui-004-light.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme dark-ansi
- 预期: the lit ▌ is brightblue (the theme's suggestion); the dimmed 你 · time / ↳ lines and the blank gutters are white (its inactive)
- 实际: `{"theme": "dark-ansi", "expected": {"lit": "brightblue", "dimmed": "white"}, "lit": ["brightblue"], "gutter": ["white"], "dimmed": ["white"], "text": ["default"]}`
- 证据: [089-ui-004-dark-ansi.txt](pty/2.1.287/gate/screens/089-ui-004-dark-ansi.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme light-ansi
- 预期: the lit ▌ is blue (the theme's suggestion); the dimmed 你 · time / ↳ lines and the blank gutters are brightblack (its inactive)
- 实际: `{"theme": "light-ansi", "expected": {"lit": "blue", "dimmed": "brightblack"}, "lit": ["blue"], "gutter": ["brightblack"], "dimmed": ["brightblack"], "text": ["default"]}`
- 证据: [090-ui-004-light-ansi.txt](pty/2.1.287/gate/screens/090-ui-004-light-ansi.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, theme dark, then /theme → Light mode in the same session
- 预期: the Pane redraws at once in the light theme's suggestion and inactive, with no reopen
- 实际: `{"before": {"lit": ["b1b9f9"], "gutter": ["999999"], "dimmed": ["999999"], "text": ["default"]}, "after": {"lit": ["5769f7"], "gutter": ["666666"], "dimmed": ["666666"], "text": ["default"]}}`
- 证据: [091-ui-004-after--theme-to-Light.txt](pty/2.1.287/gate/screens/091-ui-004-after--theme-to-Light.txt)

### CT-UI-004 · 2.1.287 · pass

- fixture: turns 12, themes dark-daltonized, light-daltonized and auto
- 预期: recorded for the record, not judged: the Pane draws under each
- 实际: `{"dark-daltonized": {"lit": ["99ccff"], "gutter": ["999999"], "dimmed": ["999999"], "text": ["default"]}, "light-daltonized": {"lit": ["3366ff"], "gutter": ["666666"], "dimmed": ["666666"], "text": ["default"]}, "auto": {"lit": ["b1b9f9"], "gutter": ["999999"], "dimmed": ["999999"], "text": ["default"]}}`
- 证据: [092-ui-004-dark-daltonized.txt](pty/2.1.287/gate/screens/092-ui-004-dark-daltonized.txt), [093-ui-004-light-daltonized.txt](pty/2.1.287/gate/screens/093-ui-004-light-daltonized.txt), [094-ui-004-auto.txt](pty/2.1.287/gate/screens/094-ui-004-auto.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme dark
- 预期: the lit ▌ is b1b9f9 (the theme's suggestion); the dimmed 你 · time / ↳ lines and the blank gutters are 999999 (its inactive)
- 实际: `{"theme": "dark", "expected": {"lit": "b1b9f9", "dimmed": "999999"}, "lit": ["b1b9f9"], "gutter": ["999999"], "dimmed": ["999999"], "text": ["default"]}`
- 证据: [086-ui-004-dark.txt](pty/2.1.295/gate/screens/086-ui-004-dark.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme light
- 预期: the lit ▌ is 5769f7 (the theme's suggestion); the dimmed 你 · time / ↳ lines and the blank gutters are 666666 (its inactive)
- 实际: `{"theme": "light", "expected": {"lit": "5769f7", "dimmed": "666666"}, "lit": ["5769f7"], "gutter": ["666666"], "dimmed": ["666666"], "text": ["default"]}`
- 证据: [087-ui-004-light.txt](pty/2.1.295/gate/screens/087-ui-004-light.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme dark-ansi
- 预期: the lit ▌ is brightblue (the theme's suggestion); the dimmed 你 · time / ↳ lines and the blank gutters are white (its inactive)
- 实际: `{"theme": "dark-ansi", "expected": {"lit": "brightblue", "dimmed": "white"}, "lit": ["brightblue"], "gutter": ["white"], "dimmed": ["white"], "text": ["default"]}`
- 证据: [088-ui-004-dark-ansi.txt](pty/2.1.295/gate/screens/088-ui-004-dark-ansi.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme light-ansi
- 预期: the lit ▌ is blue (the theme's suggestion); the dimmed 你 · time / ↳ lines and the blank gutters are brightblack (its inactive)
- 实际: `{"theme": "light-ansi", "expected": {"lit": "blue", "dimmed": "brightblack"}, "lit": ["blue"], "gutter": ["brightblack"], "dimmed": ["brightblack"], "text": ["default"]}`
- 证据: [089-ui-004-light-ansi.txt](pty/2.1.295/gate/screens/089-ui-004-light-ansi.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, theme dark, then /theme → Light mode in the same session
- 预期: the Pane redraws at once in the light theme's suggestion and inactive, with no reopen
- 实际: `{"before": {"lit": ["b1b9f9"], "gutter": ["999999"], "dimmed": ["999999"], "text": ["default"]}, "after": {"lit": ["5769f7"], "gutter": ["666666"], "dimmed": ["666666"], "text": ["default"]}}`
- 证据: [090-ui-004-after--theme-to-Light.txt](pty/2.1.295/gate/screens/090-ui-004-after--theme-to-Light.txt)

### CT-UI-004 · 2.1.295 · pass

- fixture: turns 12, themes dark-daltonized, light-daltonized and auto
- 预期: recorded for the record, not judged: the Pane draws under each
- 实际: `{"dark-daltonized": {"lit": ["99ccff"], "gutter": ["999999"], "dimmed": ["999999"], "text": ["default"]}, "light-daltonized": {"lit": ["3366ff"], "gutter": ["666666"], "dimmed": ["666666"], "text": ["default"]}, "auto": {"lit": ["b1b9f9"], "gutter": ["999999"], "dimmed": ["999999"], "text": ["default"]}}`
- 证据: [091-ui-004-dark-daltonized.txt](pty/2.1.295/gate/screens/091-ui-004-dark-daltonized.txt), [092-ui-004-light-daltonized.txt](pty/2.1.295/gate/screens/092-ui-004-light-daltonized.txt), [093-ui-004-auto.txt](pty/2.1.295/gate/screens/093-ui-004-auto.txt)

### CT-UI-005 · 2.1.287 · pass

- fixture: 4 turns, compacted after the second, --resume
- 预期: the ⚠ line is drawn in ffc107 (the dark theme's warning); it flashes inverse 3 times, the first at once and the last over within 1.5 s, then stays lit (not inverse) past 4 s and is gone by 6.5 s
- 实际: `{"inverseRuns": [[44, 179], [346, 466], [672, 779]], "foregrounds": ["ffc107"], "shownMs": [44, 5003], "goneBy6500": true, "samples": 169}`
- 证据: [015-005-after-resume--nothing-pressed.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/015-005-after-resume--nothing-pressed.txt), [016-005-6-5-s-after-clicking-K00.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/016-005-6-5-s-after-clicking-K00.txt), [017-005-after-clicking-K02.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/017-005-after-clicking-K02.txt)

### CT-UI-005 · 2.1.295 · pass

- fixture: 4 turns, compacted after the second, --resume
- 预期: the ⚠ line is drawn in ffc107 (the dark theme's warning); it flashes inverse 3 times, the first at once and the last over within 1.5 s, then stays lit (not inverse) past 4 s and is gone by 6.5 s
- 实际: `{"inverseRuns": [[41, 174], [381, 471], [660, 775]], "foregrounds": ["ffc107"], "shownMs": [41, 5041], "goneBy6500": true, "samples": 162}`
- 证据: [015-005-after-resume--nothing-pressed.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/015-005-after-resume--nothing-pressed.txt), [016-005-6-5-s-after-clicking-K00.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/016-005-6-5-s-after-clicking-K00.txt), [017-005-after-clicking-K02.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/017-005-after-clicking-K02.txt)

### CT-JUMP-001 · 2.1.287 · pass

- fixture: turns 300
- 预期: clicking turn 1's user side (never drawn after resume) puts its prompt at the top; its Agent side puts its last reply at the top
- 实际: `{"firstEntry": "T0000 用户问题：请检查第 0 个模块的状态， 并说明下一步该做什么。", "userJumpTopShowsT0000": true, "agentJumpTopShowsT0000Reply": true, "refusalShown": false}`
- 证据: [001-after-resume.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/001-after-resume.txt), [002-pane-at-top.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/002-pane-at-top.txt), [003-after-clicking-T0000-user-side.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/003-after-clicking-T0000-user-side.txt), [004-after-clicking-T0000-agent-side.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/004-after-clicking-T0000-agent-side.txt)

### CT-JUMP-001 · 2.1.295 · pass

- fixture: turns 300
- 预期: clicking turn 1's user side (never drawn after resume) puts its prompt at the top; its Agent side puts its last reply at the top
- 实际: `{"firstEntry": "T0000 用户问题：请检查第 0 个模块的状态， 并说明下一步该做什么。", "userJumpTopShowsT0000": true, "agentJumpTopShowsT0000Reply": true, "refusalShown": false}`
- 证据: [001-after-resume.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/001-after-resume.txt), [002-pane-at-top.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/002-pane-at-top.txt), [003-after-clicking-T0000-user-side.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/003-after-clicking-T0000-user-side.txt), [004-after-clicking-T0000-agent-side.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/004-after-clicking-T0000-agent-side.txt)

### CT-JUMP-002 · 2.1.287 · pass

- fixture: turns 40
- 预期: a local command (/tui) and a !cmd jump to a neighbouring row, centred, the typed row still in view
- 实际: `{"local command": {"shown": true, "row": 20, "refused": false}, "shell command": {"shown": true, "row": 17, "refused": false}}`
- 证据: [005-pane-shows--tui.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/005-pane-shows--tui.txt), [006-after-clicking--tui.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/006-after-clicking--tui.txt), [007-pane-shows--echo-T0012.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/007-pane-shows--echo-T0012.txt), [008-after-clicking--echo-T0012.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/008-after-clicking--echo-T0012.txt)

### CT-JUMP-002 · 2.1.287 · pass

- fixture: forms23: /review, /model as a user row, a tools-only turn
- 预期: a prompt-type command and a user-row local command jump to the neighbouring drawn rows; an Agent side without text jumps to its last tool row; nothing refused
- 实际: `{"prompt-type command": {"shown": true, "refused": false}, "local command as a user row": {"shown": true, "refused": false}, "tools-only Agent side": {"shown": true, "refused": false}}`
- 证据: [009-after-clicking-the-user-side-of--review.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/009-after-clicking-the-user-side-of--review.txt), [010-after-clicking-the-user-side-of--model.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/010-after-clicking-the-user-side-of--model.txt), [011-after-clicking-the-agent-side-of-P08.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/011-after-clicking-the-agent-side-of-P08.txt)

### CT-JUMP-002 · 2.1.295 · pass

- fixture: turns 40
- 预期: a local command (/tui) and a !cmd jump to a neighbouring row, centred, the typed row still in view
- 实际: `{"local command": {"shown": true, "row": 20, "refused": false}, "shell command": {"shown": true, "row": 17, "refused": false}}`
- 证据: [005-pane-shows--tui.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/005-pane-shows--tui.txt), [006-after-clicking--tui.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/006-after-clicking--tui.txt), [007-pane-shows--echo-T0012.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/007-pane-shows--echo-T0012.txt), [008-after-clicking--echo-T0012.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/008-after-clicking--echo-T0012.txt)

### CT-JUMP-002 · 2.1.295 · pass

- fixture: forms23: /review, /model as a user row, a tools-only turn
- 预期: a prompt-type command and a user-row local command jump to the neighbouring drawn rows; an Agent side without text jumps to its last tool row; nothing refused
- 实际: `{"prompt-type command": {"shown": true, "refused": false}, "local command as a user row": {"shown": true, "refused": false}, "tools-only Agent side": {"shown": true, "refused": false}}`
- 证据: [009-after-clicking-the-user-side-of--review.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/009-after-clicking-the-user-side-of--review.txt), [010-after-clicking-the-user-side-of--model.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/010-after-clicking-the-user-side-of--model.txt), [011-after-clicking-the-agent-side-of-P08.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/011-after-clicking-the-agent-side-of-P08.txt)

### CT-JUMP-003 · 2.1.287 · pass

- fixture: 4 turns compacted after the second, --resume, chat-toc swapped in after the start
- 预期: J00 (compacted before the resume, unknown to a chat-toc that came later) is not dim before a press; clicking it says so at the bottom, dims that side only (J01 not), moves nothing; the saying goes after ~5 s and the side stays dim
- 实际: `{"dimBeforePress": false, "dim": [true, false], "refusalShown": true, "transcriptUnmoved": true, "refusalGoneAfter6s": true, "dimAfter6s": true}`
- 证据: [012-003-chat-toc-swapped-in--nothing-pressed.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/012-003-chat-toc-swapped-in--nothing-pressed.txt), [013-003-after-clicking-J00.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/013-003-after-clicking-J00.txt), [014-003-6-s-later.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/014-003-6-s-later.txt)

### CT-JUMP-003 · 2.1.295 · pass

- fixture: 4 turns compacted after the second, --resume, chat-toc swapped in after the start
- 预期: J00 (compacted before the resume, unknown to a chat-toc that came later) is not dim before a press; clicking it says so at the bottom, dims that side only (J01 not), moves nothing; the saying goes after ~5 s and the side stays dim
- 实际: `{"dimBeforePress": false, "dim": [true, false], "refusalShown": true, "transcriptUnmoved": true, "refusalGoneAfter6s": true, "dimAfter6s": true}`
- 证据: [012-003-chat-toc-swapped-in--nothing-pressed.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/012-003-chat-toc-swapped-in--nothing-pressed.txt), [013-003-after-clicking-J00.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/013-003-after-clicking-J00.txt), [014-003-6-s-later.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/014-003-6-s-later.txt)

### CT-JUMP-005 · 2.1.287 · pass

- fixture: 4 turns, compacted after the second, --resume
- 预期: the two turns before the compaction are dim on both sides before anything is pressed, the two after not; a click on K00 says ⚠ 这一条在压缩之前，恢复会话后无法跳转; a click on K02 jumps with nothing said
- 实际: `{"dimBeforePress": {"K00": [true, true], "K01": [true, true], "K02": [false, false], "K03": [false, false]}, "noticeBeforePress": null, "saysCompacted": true, "afterCompactionRefused": false}`
- 证据: [015-005-after-resume--nothing-pressed.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/015-005-after-resume--nothing-pressed.txt), [016-005-6-5-s-after-clicking-K00.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/016-005-6-5-s-after-clicking-K00.txt), [017-005-after-clicking-K02.txt](pty/2.1.287/20261012-174543-CT-JUMP-2.1.287/screens/017-005-after-clicking-K02.txt)

### CT-JUMP-005 · 2.1.295 · pass

- fixture: 4 turns, compacted after the second, --resume
- 预期: the two turns before the compaction are dim on both sides before anything is pressed, the two after not; a click on K00 says ⚠ 这一条在压缩之前，恢复会话后无法跳转; a click on K02 jumps with nothing said
- 实际: `{"dimBeforePress": {"K00": [true, true], "K01": [true, true], "K02": [false, false], "K03": [false, false]}, "noticeBeforePress": null, "saysCompacted": true, "afterCompactionRefused": false}`
- 证据: [015-005-after-resume--nothing-pressed.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/015-005-after-resume--nothing-pressed.txt), [016-005-6-5-s-after-clicking-K00.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/016-005-6-5-s-after-clicking-K00.txt), [017-005-after-clicking-K02.txt](pty/2.1.295/20261012-180859-CT-JUMP-current/screens/017-005-after-clicking-K02.txt)

### CT-POS-001 · 2.1.287 · pass

- fixture: turns 40
- 预期: the last group lit at the end; a jump to /tui (centred) lights /tui while the view's top is the group before, still a second later; the next wheel over the transcript lights the top's group
- 实际: `{"atEnd": {"top": 35, "sitedTop": 35, "lit": [39], "paused": false, "window": [34, 35, 36, 37, 38, 39], "lastWhole": false}, "afterJump": {"top": 25, "sitedTop": 25, "lit": [27], "paused": false, "window": [23, 24, 25, 26, 27, 28], "lastWhole": false}, "aSecondLater": {"top": 25, "sitedTop": 25, "lit": [27], "paused": false, "window": [23, 24, 25, 26, 27, 28], "lastWhole": false}, "afterWheel": {…`
- 证据: [001-at-the-end.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/001-at-the-end.txt), [002-after-the-jump-to--tui.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/002-after-the-jump-to--tui.txt), [003-after-one-wheel-over-the-transcript.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/003-after-one-wheel-over-the-transcript.txt)

### CT-POS-001 · 2.1.295 · pass

- fixture: turns 40
- 预期: the last group lit at the end; a jump to /tui (centred) lights /tui while the view's top is the group before, still a second later; the next wheel over the transcript lights the top's group
- 实际: `{"atEnd": {"top": 35, "sitedTop": 35, "lit": [39], "paused": false, "window": [34, 35, 36, 37, 38, 39], "lastWhole": false}, "afterJump": {"top": 25, "sitedTop": 25, "lit": [27], "paused": false, "window": [23, 24, 25, 26, 27], "lastWhole": false}, "aSecondLater": {"top": 25, "sitedTop": 25, "lit": [27], "paused": false, "window": [23, 24, 25, 26, 27], "lastWhole": false}, "afterWheel": {"top": 2…`
- 证据: [001-at-the-end.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/001-at-the-end.txt), [002-after-the-jump-to--tui.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/002-after-the-jump-to--tui.txt), [003-after-one-wheel-over-the-transcript.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/003-after-one-wheel-over-the-transcript.txt)

### CT-POS-002 · 2.1.287 · pass

- fixture: turns 300
- 预期: after 180 wheel ticks up (and 90 down, and 180 up at 100/s) the lit group is the group of screen row 1 (the last group when its last row is wholly in view)
- 实际: `{"up 180": {"top": 223, "sitedTop": 223, "lit": [223], "paused": false, "window": [223, 224, 225, 226, 227, 228], "lastWhole": false}, "down 90": {"top": 263, "sitedTop": 263, "lit": [263], "paused": false, "window": [261, 262, 263, 264, 265, 266], "lastWhole": false}, "down 7 #0": {"top": 264, "sitedTop": 264, "lit": [264], "paused": false, "window": [261, 262, 263, 264, 265, 266], "lastWhole": …`
- 证据: [004-after-up-180.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/004-after-up-180.txt), [005-after-down-90.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/005-after-down-90.txt), [006-after-down-7--0.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/006-after-down-7--0.txt), [007-after-down-7--1.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/007-after-down-7--1.txt), [008-after-down-7--2.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/008-after-down-7--2.txt), [009-after-down-7--3.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/009-after-down-7--3.txt) 等 15 个

### CT-POS-002 · 2.1.295 · pass

- fixture: turns 300
- 预期: after 180 wheel ticks up (and 90 down, and 180 up at 100/s) the lit group is the group of screen row 1 (the last group when its last row is wholly in view)
- 实际: `{"up 180": {"top": 240, "sitedTop": 240, "lit": [240], "paused": false, "window": [240, 241, 242, 243, 244], "lastWhole": false}, "down 90": {"top": 286, "sitedTop": 286, "lit": [286], "paused": false, "window": [285, 286, 287, 288, 289], "lastWhole": false}, "down 7 #0": {"top": 287, "sitedTop": 288, "lit": [288], "paused": false, "window": [285, 286, 287, 288, 289], "lastWhole": false}, "down 7…`
- 证据: [004-after-up-180.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/004-after-up-180.txt), [005-after-down-90.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/005-after-down-90.txt), [006-after-down-7--0.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/006-after-down-7--0.txt), [007-after-down-7--1.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/007-after-down-7--1.txt), [008-after-down-7--2.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/008-after-down-7--2.txt), [009-after-down-7--3.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/009-after-down-7--3.txt) 等 15 个

### CT-POS-003 · 2.1.287 · pass

- fixture: turns 300
- 预期: the lit group is in the pane's window; wheeling the pane says 暂停 and keeps the window; the next move of the transcript follows again; the pane focused says 暂停
- 实际: `{"follows": {"top": 278, "sitedTop": 278, "lit": [278], "paused": false, "window": [278, 279, 280, 281, 282], "lastWhole": false}, "paneWheeled": {"top": 278, "sitedTop": 278, "lit": [], "paused": true, "window": [272, 273, 274, 275, 276], "lastWhole": false}, "transcriptMoved": {"top": 279, "sitedTop": 279, "lit": [279], "paused": false, "window": [279, 280, 281, 282, 283], "lastWhole": false}, …`
- 证据: [019-transcript-scrolled-up--the-pane-follows.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/019-transcript-scrolled-up--the-pane-follows.txt), [020-pane-wheeled--paused.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/020-pane-wheeled--paused.txt), [021-transcript-moved--following-again.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/021-transcript-moved--following-again.txt), [022--chat-toc--the-pane-has-the-keyboard.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/022--chat-toc--the-pane-has-the-keyboard.txt)

### CT-POS-003 · 2.1.295 · pass

- fixture: turns 300
- 预期: the lit group is in the pane's window; wheeling the pane says 暂停 and keeps the window; the next move of the transcript follows again; the pane focused says 暂停
- 实际: `{"follows": {"top": 275, "sitedTop": 275, "lit": [275], "paused": false, "window": [275, 276, 277, 278, 279], "lastWhole": false}, "paneWheeled": {"top": 275, "sitedTop": 275, "lit": [], "paused": true, "window": [269, 270, 271, 272, 273], "lastWhole": false}, "transcriptMoved": {"top": 276, "sitedTop": 276, "lit": [276], "paused": false, "window": [276, 277, 278, 279, 280], "lastWhole": false}, …`
- 证据: [019-transcript-scrolled-up--the-pane-follows.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/019-transcript-scrolled-up--the-pane-follows.txt), [020-pane-wheeled--paused.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/020-pane-wheeled--paused.txt), [021-transcript-moved--following-again.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/021-transcript-moved--following-again.txt), [022--chat-toc--the-pane-has-the-keyboard.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/022--chat-toc--the-pane-has-the-keyboard.txt)

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.71, "tocReadyS": 1.28, "tocLagMs": 563, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.24}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.76}, "reachedLast": true, "startWholeMs": 229.19, "idleWholeMs": 208.89, "groups": 107, "tailReadMs": [6, 12.31, 19.24], "appendModelMs": [6,…`
- 证据: [debug-heavy-1.log](pty/2.1.287/perf-heavy/debug-heavy-1.log), [001-heavy-1-after-resume.txt](pty/2.1.287/perf-heavy/screens/001-heavy-1-after-resume.txt), [002-heavy-1-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/002-heavy-1-pane-at-its-top.txt), [003-heavy-1-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/003-heavy-1-after-clicking-T0000.txt), [004-heavy-1-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/004-heavy-1-pane-at-its-end.txt), [005-heavy-1-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/005-heavy-1-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.74, "tocReadyS": 1.28, "tocLagMs": 539, "paneToTop": {"batches": 7, "ticks": 140, "s": 2.02}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.74}, "reachedLast": true, "startWholeMs": 209.14, "idleWholeMs": 207.93, "groups": 107, "tailReadMs": [7, 14.52, 49.76], "appendModelMs": [6,…`
- 证据: [debug-heavy-2.log](pty/2.1.287/perf-heavy/debug-heavy-2.log), [007-heavy-2-after-resume.txt](pty/2.1.287/perf-heavy/screens/007-heavy-2-after-resume.txt), [008-heavy-2-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/008-heavy-2-pane-at-its-top.txt), [009-heavy-2-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/009-heavy-2-after-clicking-T0000.txt), [010-heavy-2-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/010-heavy-2-pane-at-its-end.txt), [011-heavy-2-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/011-heavy-2-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.71, "tocReadyS": 1.26, "tocLagMs": 550, "paneToTop": {"batches": 7, "ticks": 140, "s": 2.06}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.75}, "reachedLast": true, "startWholeMs": 226.26, "idleWholeMs": 190.55, "groups": 107, "tailReadMs": [7, 13.91, 40.73], "appendModelMs": [6,…`
- 证据: [debug-heavy-3.log](pty/2.1.287/perf-heavy/debug-heavy-3.log), [013-heavy-3-after-resume.txt](pty/2.1.287/perf-heavy/screens/013-heavy-3-after-resume.txt), [014-heavy-3-pane-at-its-top.txt](pty/2.1.287/perf-heavy/screens/014-heavy-3-pane-at-its-top.txt), [015-heavy-3-after-clicking-T0000.txt](pty/2.1.287/perf-heavy/screens/015-heavy-3-after-clicking-T0000.txt), [016-heavy-3-pane-at-its-end.txt](pty/2.1.287/perf-heavy/screens/016-heavy-3-pane-at-its-end.txt), [017-heavy-3-after-clicking-the-newest.txt](pty/2.1.287/perf-heavy/screens/017-heavy-3-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.44, "tocReadyS": 2.22, "tocLagMs": 787, "paneToTop": {"batches": 506, "ticks": 10120, "s": 105.2}, "reachedFirst": true, "paneToEnd": {"batches": 399, "ticks": 7980, "s": 85.25}, "reachedLast": true, "startWholeMs": 345.9, "idleWholeMs": 374.29, "groups": 4521, "tailReadMs": [7, 19.03, 117.73], "appendM…`
- 证据: [debug-many-1.log](pty/2.1.287/perf-many/debug-many-1.log), [001-many-1-after-resume.txt](pty/2.1.287/perf-many/screens/001-many-1-after-resume.txt), [002-many-1-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/002-many-1-pane-at-its-top.txt), [003-many-1-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/003-many-1-after-clicking-T0000.txt), [004-many-1-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/004-many-1-pane-at-its-end.txt), [005-many-1-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/005-many-1-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.1, "tocReadyS": 1.77, "tocLagMs": 678, "paneToTop": {"batches": 490, "ticks": 9800, "s": 104.63}, "reachedFirst": true, "paneToEnd": {"batches": 402, "ticks": 8040, "s": 86.06}, "reachedLast": true, "startWholeMs": 335.11, "idleWholeMs": 359.13, "groups": 4521, "tailReadMs": [7, 16.68, 123.32], "appendM…`
- 证据: [debug-many-2.log](pty/2.1.287/perf-many/debug-many-2.log), [007-many-2-after-resume.txt](pty/2.1.287/perf-many/screens/007-many-2-after-resume.txt), [008-many-2-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/008-many-2-pane-at-its-top.txt), [009-many-2-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/009-many-2-after-clicking-T0000.txt), [010-many-2-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/010-many-2-pane-at-its-end.txt), [011-many-2-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/011-many-2-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.287 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.14, "tocReadyS": 1.89, "tocLagMs": 749, "paneToTop": {"batches": 491, "ticks": 9820, "s": 104.68}, "reachedFirst": true, "paneToEnd": {"batches": 399, "ticks": 7980, "s": 85.48}, "reachedLast": true, "startWholeMs": 370.06, "idleWholeMs": 510.15, "groups": 4521, "tailReadMs": [7, 26.12, 110.65], "append…`
- 证据: [debug-many-3.log](pty/2.1.287/perf-many/debug-many-3.log), [013-many-3-after-resume.txt](pty/2.1.287/perf-many/screens/013-many-3-after-resume.txt), [014-many-3-pane-at-its-top.txt](pty/2.1.287/perf-many/screens/014-many-3-pane-at-its-top.txt), [015-many-3-after-clicking-T0000.txt](pty/2.1.287/perf-many/screens/015-many-3-after-clicking-T0000.txt), [016-many-3-pane-at-its-end.txt](pty/2.1.287/perf-many/screens/016-many-3-pane-at-its-end.txt), [017-many-3-after-clicking-the-newest.txt](pty/2.1.287/perf-many/screens/017-many-3-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.68, "tocReadyS": 1.31, "tocLagMs": 635, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.2}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.76}, "reachedLast": true, "startWholeMs": 231.82, "idleWholeMs": 210.19, "groups": 107, "tailReadMs": [7, 16.29, 38.42], "appendModelMs": [6, …`
- 证据: [debug-heavy-1.log](pty/2.1.295/perf-heavy/debug-heavy-1.log), [001-heavy-1-after-resume.txt](pty/2.1.295/perf-heavy/screens/001-heavy-1-after-resume.txt), [002-heavy-1-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/002-heavy-1-pane-at-its-top.txt), [003-heavy-1-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/003-heavy-1-after-clicking-T0000.txt), [004-heavy-1-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/004-heavy-1-pane-at-its-end.txt), [005-heavy-1-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/005-heavy-1-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.73, "tocReadyS": 1.24, "tocLagMs": 510, "paneToTop": {"batches": 7, "ticks": 140, "s": 1.99}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.75}, "reachedLast": true, "startWholeMs": 260.23, "idleWholeMs": 205.66, "groups": 107, "tailReadMs": [7, 13.29, 49.13], "appendModelMs": [6,…`
- 证据: [debug-heavy-2.log](pty/2.1.295/perf-heavy/debug-heavy-2.log), [007-heavy-2-after-resume.txt](pty/2.1.295/perf-heavy/screens/007-heavy-2-after-resume.txt), [008-heavy-2-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/008-heavy-2-pane-at-its-top.txt), [009-heavy-2-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/009-heavy-2-after-clicking-T0000.txt), [010-heavy-2-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/010-heavy-2-pane-at-its-end.txt), [011-heavy-2-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/011-heavy-2-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: heavy 20 MiB (107 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "heavy", "turns": 107, "bytes": 21047585, "rows": 7704}, "hostReadyS": 0.68, "tocReadyS": 1.17, "tocLagMs": 493, "paneToTop": {"batches": 8, "ticks": 160, "s": 2.17}, "reachedFirst": true, "paneToEnd": {"batches": 1, "ticks": 20, "s": 0.78}, "reachedLast": true, "startWholeMs": 223.38, "idleWholeMs": 225.61, "groups": 107, "tailReadMs": [7, 13.18, 105.7], "appendModelMs": [6,…`
- 证据: [debug-heavy-3.log](pty/2.1.295/perf-heavy/debug-heavy-3.log), [013-heavy-3-after-resume.txt](pty/2.1.295/perf-heavy/screens/013-heavy-3-after-resume.txt), [014-heavy-3-pane-at-its-top.txt](pty/2.1.295/perf-heavy/screens/014-heavy-3-pane-at-its-top.txt), [015-heavy-3-after-clicking-T0000.txt](pty/2.1.295/perf-heavy/screens/015-heavy-3-after-clicking-T0000.txt), [016-heavy-3-pane-at-its-end.txt](pty/2.1.295/perf-heavy/screens/016-heavy-3-pane-at-its-end.txt), [017-heavy-3-after-clicking-the-newest.txt](pty/2.1.295/perf-heavy/screens/017-heavy-3-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.08, "tocReadyS": 1.96, "tocLagMs": 878, "paneToTop": {"batches": 488, "ticks": 9760, "s": 103.95}, "reachedFirst": true, "paneToEnd": {"batches": 397, "ticks": 7940, "s": 84.64}, "reachedLast": true, "startWholeMs": 409.94, "idleWholeMs": 340.96, "groups": 4521, "tailReadMs": [7, 16.17, 66.79], "appendM…`
- 证据: [debug-many-1.log](pty/2.1.295/perf-many/debug-many-1.log), [001-many-1-after-resume.txt](pty/2.1.295/perf-many/screens/001-many-1-after-resume.txt), [002-many-1-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/002-many-1-pane-at-its-top.txt), [003-many-1-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/003-many-1-after-clicking-T0000.txt), [004-many-1-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/004-many-1-pane-at-its-end.txt), [005-many-1-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/005-many-1-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.1, "tocReadyS": 1.85, "tocLagMs": 742, "paneToTop": {"batches": 487, "ticks": 9740, "s": 103.73}, "reachedFirst": true, "paneToEnd": {"batches": 401, "ticks": 8020, "s": 85.5}, "reachedLast": true, "startWholeMs": 355.47, "idleWholeMs": 367.76, "groups": 4521, "tailReadMs": [7, 16.7, 113.37], "appendMod…`
- 证据: [debug-many-2.log](pty/2.1.295/perf-many/debug-many-2.log), [007-many-2-after-resume.txt](pty/2.1.295/perf-many/screens/007-many-2-after-resume.txt), [008-many-2-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/008-many-2-pane-at-its-top.txt), [009-many-2-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/009-many-2-after-clicking-T0000.txt), [010-many-2-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/010-many-2-pane-at-its-end.txt), [011-many-2-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/011-many-2-after-clicking-the-newest.txt) 等 8 个

### CT-PERF-001 · 2.1.295 · pass

- fixture: many 20 MiB (4521 turns)
- 预期: first listing <= 4 s after the transcript's last turn; idle whole read <= 1 s; tail read <= 150 ms; append to model <= 1 s; pane own <= 16 ms, with the host <= 100 ms; Current position <= 2 ms; first and last groups reached by continuous scrolling and jumps
- 实际: `{"fixture": {"kind": "many", "turns": 4521, "bytes": 20975738, "rows": 25680}, "hostReadyS": 1.08, "tocReadyS": 1.78, "tocLagMs": 693, "paneToTop": {"batches": 490, "ticks": 9800, "s": 104.51}, "reachedFirst": true, "paneToEnd": {"batches": 396, "ticks": 7920, "s": 84.66}, "reachedLast": true, "startWholeMs": 311.23, "idleWholeMs": 348.88, "groups": 4521, "tailReadMs": [7, 18.46, 127.61], "append…`
- 证据: [debug-many-3.log](pty/2.1.295/perf-many/debug-many-3.log), [013-many-3-after-resume.txt](pty/2.1.295/perf-many/screens/013-many-3-after-resume.txt), [014-many-3-pane-at-its-top.txt](pty/2.1.295/perf-many/screens/014-many-3-pane-at-its-top.txt), [015-many-3-after-clicking-T0000.txt](pty/2.1.295/perf-many/screens/015-many-3-after-clicking-T0000.txt), [016-many-3-pane-at-its-end.txt](pty/2.1.295/perf-many/screens/016-many-3-pane-at-its-end.txt), [017-many-3-after-clicking-the-newest.txt](pty/2.1.295/perf-many/screens/017-many-3-after-clicking-the-newest.txt) 等 8 个

### CT-SEC-001 · 2.1.287 · pass

- fixture: turns 6 + one submitted prompt holding a synthetic unique marker
- 预期: the marker is drawn in the Pane and appears in none of: chat-toc's $.store file (which holds only viewFilter and layout), its plugin data directory, the debug log's chat-toc lines (CHAT_TOC_PERF on, a jump, a hot reload); the release evidence is scanned for it too (release_gate.py)
- 实际: `{"markerSha256": "10b4f6b978a08052", "drawnInPane": true, "storeFiles": ["plugins/store/chat-toc_inline-8255bb3c209a.json"], "storeKeys": ["layout", "viewFilter"], "pluginDataDirs": [], "leaksInStoreOrData": [], "debugLogChatTocLines": 168, "leaksInChatTocLogLines": 0, "hostLogLinesWithMarker": 0}`
- 证据: [debug-sec-001-chat-toc-lines.log](pty/2.1.287/gate/debug-sec-001-chat-toc-lines.log)

### CT-SEC-001 · 2.1.295 · pass

- fixture: turns 6 + one submitted prompt holding a synthetic unique marker
- 预期: the marker is drawn in the Pane and appears in none of: chat-toc's $.store file (which holds only viewFilter and layout), its plugin data directory, the debug log's chat-toc lines (CHAT_TOC_PERF on, a jump, a hot reload); the release evidence is scanned for it too (release_gate.py)
- 实际: `{"markerSha256": "77b7ad760711f024", "drawnInPane": true, "storeFiles": ["plugins/store/chat-toc_inline-8255bb3c209a.json"], "storeKeys": ["layout", "viewFilter"], "pluginDataDirs": [], "leaksInStoreOrData": [], "debugLogChatTocLines": 168, "leaksInChatTocLogLines": 0, "hostLogLinesWithMarker": 0}`
- 证据: [debug-sec-001-chat-toc-lines.log](pty/2.1.295/gate/debug-sec-001-chat-toc-lines.log)

### CT-COEX-001 · 2.1.287 · pass

- fixture: turns 300
- 预期: with /diff in front and chat-toc paused behind it, a move of the transcript ends the pause: back in front its first frame lights and shows the view's group, no 暂停
- 实际: `{"diffInFront": true, "pausedBefore": {"top": 279, "sitedTop": 279, "lit": [], "paused": true, "window": [273, 274, 275, 276, 277], "lastWhole": false}, "tocBehind": true, "back": {"top": 275, "sitedTop": 275, "lit": [275], "paused": false, "window": [273, 274, 275, 276, 277], "lastWhole": false}}`
- 证据: [023--diff-opened-in-front.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/023--diff-opened-in-front.txt), [024-chat-toc-in-front--paused.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/024-chat-toc-in-front--paused.txt), [025-Diff-in-front-again.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/025-Diff-in-front-again.txt), [026-chat-toc-tab-clicked--in-front-again.txt](pty/2.1.287/20261012-174749-CT-POS-2.1.287/screens/026-chat-toc-tab-clicked--in-front-again.txt)

### CT-COEX-001 · 2.1.295 · pass

- fixture: turns 300
- 预期: with /diff in front and chat-toc paused behind it, a move of the transcript ends the pause: back in front its first frame lights and shows the view's group, no 暂停
- 实际: `{"diffInFront": true, "pausedBefore": {"top": 279, "sitedTop": 279, "lit": [], "paused": true, "window": [271, 272, 273, 274, 275], "lastWhole": false}, "tocBehind": true, "back": {"top": 276, "sitedTop": 276, "lit": [276], "paused": false, "window": [276, 277, 278, 279, 280], "lastWhole": false}}`
- 证据: [023--diff-opened-in-front.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/023--diff-opened-in-front.txt), [024-chat-toc-in-front--paused.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/024-chat-toc-in-front--paused.txt), [025-Diff-in-front-again.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/025-Diff-in-front-again.txt), [026-chat-toc-tab-clicked--in-front-again.txt](pty/2.1.295/20261012-181105-CT-POS-current/screens/026-chat-toc-tab-clicked--in-front-again.txt)

