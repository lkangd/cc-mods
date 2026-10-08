# 44: 裸 `/prompt-history` 应当切换展开与折叠

**What to build:** spec「AbovePrompt 默认只绘制一行 `prompt-history` 标题；标题点击和裸 `/prompt-history` 切换展开」、Issue 05 的 PH-UI-001、README（「`/prompt-history` 展开或折叠时间线」）和 Issue 23 的验收项都承诺裸命令能折叠。实际上 `command.run` 的 `args === ''` 分支从最早的实现起就固定 `expanded = true`，回复「prompt-history 已展开。」；band 已经展开时再执行，也不会折叠。只用键盘的人要折叠，只能先 `ctrl+x tab` 把焦点移到标题再按 Enter。

**Blocked by:** 23「终端回退」

**Status:** resolved

- [x] 先写 plugin test：band 已展开时执行裸 `/prompt-history`，band 折叠，回复写明已折叠；折叠时执行，行为与现在相同（展开、回到最新、回复「已展开」）。在原代码上确认变红。
- [x] 修复 `command.run` 的裸命令分支；折叠状态照旧按 Run 保存。
- [x] 本票修好后，在 PH-UI-001 里补上「裸命令折叠」这一步的断言，两个版本都跑通。

## Answer

- **修复**（`hooks/register.tsx`）：`command.run` 的裸命令分支在 band 已展开时折叠它：`expanded = false`、重画、按 Run 保存，回复「prompt-history 已折叠。」。折叠时的行为不变：展开、回到最新、回复「prompt-history 已展开。」。
- **plugin test**：`tests/run_identity.test.tsx::bare prompt-history folds an expanded band and opens a folded one, kept per Run`，在原代码上变红（第二次回复仍是「已展开」）。
- **跟着改的测试**：`project_isolation` 的 `the band folds a Run writing alongside this one and opens it on a press` 与 `quarantine_archive` 的 `a view of a replaced generation gives way to the new one`，原本用第二次裸命令「再展开一次、重新读取」，现在改为先折叠、再展开，要证明的「重新展开时读回」不变。
- **PTY**：
  - `ctx.expand` 遇到 band 已经展开时，先用命令折叠一次（等「已折叠」），再展开。同一个 Run 被接回时会恢复存储里的展开状态，BRANCH-001 的 `--resume` 终端就是这样；不先折叠，裸命令会把它折叠掉。
  - PH-UI-001 删掉「Issue 44」那句注释，末尾补上「命令再次折叠 band」的断言。
  - 两个版本上 PH-UI-001、PH-BRANCH-001、PH-JUMP-001、PH-CAPTURE-006 都通过，0 泄漏。BRANCH-001 在 2.1.273 上第一次失败于「the in-process resume to show the session」：haiku 对 D 回了一大段拒答，把 D 挤出了屏幕。重跑通过，trace 里能看到先折叠、再展开这条路径。
- **契约**：spec、README 与 PH-UI-001 的步骤文字本来就写着切换，不用改；scenarios.json 的 PH-UI-001 引用上面的 plugin test。

## Comments

### 2026-09-30 · 从 Issue 38 拆出

写 PH-UI-001 时发现：场景原计划（Issue 38 Q3）用裸 `/prompt-history` 折叠，宿主里执行后 band 仍然展开。查代码和提交历史确认，这个命令从来只会展开，现有 plugin test 也只覆盖展开。使用者决定拆新票修代码，不改契约。
