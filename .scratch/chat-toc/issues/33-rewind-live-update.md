# 33: rewind 后目录实时去掉被弃的条目

**What to build:** Esc Esc 选中一条之前的 prompt 并 restore 对话后，目录在 500 ms 内去掉被弃分支的条目（包括 rewind 到的那条），不用等下一次提交。

**Blocked by:** 无

**Status:** ready-for-agent

## 问题

使用者反馈：rewind 之后右侧目录没有更新，过一会儿才更新。这是 0.1.0 契约里接受过的窗口（`06` 号票「不承诺」第 5 条：宿主没有 rewind 事件，文件也还没有变化），使用者现在要求去掉它。

## 已定的决定（2026-10-12 grilling）

- 触发：每次 `PromptHint` 的 `ui.render` 时读 `$.session.turns()`（廉价）。
- 只有它少于目录已知的 prompt 数时，才调用 `$.session.messages()`，按条数与文本和文件对话链对齐，求出 rewind 点，隐藏其后的分组（包括 rewind 到的那条 User input，它的文字已回到输入框）。`turns()` 是否计入斜杠命令等，实现时测清后定比较口径。
- 这个检测只「减」不「加」；只隐藏，不改文件读取状态。文件下次有新行时照常读，以文件为准（那时对话链已换分支）。
- rewind 不落盘：rewind 后不提交就退出再 resume，被弃分支回来，目录跟宿主一致地显示它们。
- `messages()` 只给最新 4096 条且没有 uuid：对齐从尾部按文本做。
- 契约「不承诺」里那条接受窗口删除；「不保证能跳到 rewind 被弃的分支」改为只说 resume 前被 compact 的行。

## 步骤

- [ ] 实测 `turns()` 的计数口径（斜杠命令、`!` 命令、compact 后、resume 后）
- [ ] 测试先行：对齐的纯函数（普通 rewind、rewind 到第一条、含本地命令组、compact 之后的 rewind、`messages()` 截在 4096 条）
- [ ] 测试先行：`turns()` 未减少时不调用 `messages()`；流式输出期间不误删最新一组
- [ ] 实现
- [ ] 验收契约：修订 `CT-LIFE-004`（restore 后 500 ms 内被弃条目从目录消失，不需要再提交）；新增 `CT-LIFE-008`（rewind 后不提交、退出再 resume，被弃分支回到目录，与宿主显示一致）；删除「不承诺」里的接受窗口；README 同步
- [ ] 两版宿主 PTY 验收

## Comments

- 2026-10-12 spike（两版一致）：restore 前后 `.jsonl` 字节相同；除 `PromptHint` 的 `ui.render`（两次）外没有任何钩子触发；约 300 ms 后第一次轮询时 `$.session.messages()` 与 `turns()` 已是截短后的值。目前的 Pane 在 20 秒空闲、清空输入框、Esc、终端失焦再聚焦时都不变，下一次主循环 `session.append`（下一次提交，或 `/reload-plugins` 这类会记行的本地命令）后约 300 ms 才更新。登录状态下「过一会儿自己更新」最可能是终端失焦约 180 秒后宿主追加的 `system/away_summary` 行，未实证。「只恢复代码」不改对话（对话框原文：The conversation will be unchanged）。
