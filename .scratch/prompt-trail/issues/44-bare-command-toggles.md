# 44: 裸 `/prompt-history` 应当切换展开与折叠

**What to build:** spec「AbovePrompt 默认只绘制一行 `Prompt Trail` 标题；标题点击和裸 `/prompt-history` 切换展开」、Issue 05 的 PT-UI-001、README（「`/prompt-history` 展开或折叠时间线」）和 Issue 23 的验收项都承诺裸命令能折叠。实际上 `command.run` 的 `args === ''` 分支从最早的实现起就固定 `expanded = true`，回复「Prompt Trail 已展开。」；band 已经展开时再执行，也不会折叠。只用键盘的人要折叠，只能先 `ctrl+x tab` 把焦点移到标题再按 Enter。

**Blocked by:** 23「终端回退」

**Status:** ready-for-agent

- [ ] 先写 plugin test：band 已展开时执行裸 `/prompt-history`，band 折叠，回复写明已折叠；折叠时执行，行为与现在相同（展开、回到最新、回复「已展开」）。在原代码上确认变红。
- [ ] 修复 `command.run` 的裸命令分支；折叠状态照旧按 Run 保存。
- [ ] 本票修好后，在 PT-UI-001 里补上「裸命令折叠」这一步的断言，两个版本都跑通。

## Comments

### 2026-09-30 · 从 Issue 38 拆出

写 PT-UI-001 时发现：场景原计划（Issue 38 Q3）用裸 `/prompt-history` 折叠，宿主里执行后 band 仍然展开。查代码和提交历史确认，这个命令从来只会展开，现有 plugin test 也只覆盖展开。使用者决定拆新票修代码，不改契约。
