# 13: 严格匹配人类 composer 提交

**What to build:** 让 Project Timeline 只包含真正成功进入会话的人类 composer submission，并对重复、多行、宽字符和附件输入保留准确语义。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** resolved

- [x] 只有成功的 `prompt.submit` 且 origin 为 composer 才确认 Prompt Entry；成员资格不依赖 classic hook、transcript `user` row 或 `ui.render`。
- [x] 保存 `next(e)` 返回的最终文本；下游 hook 改写后的文本与 Claude Code 实际收到的文本一致。
- [x] 连续三个完全相同的 prompt 产生三个独立 Prompt Entries、sequence 和事件身份，不按文本去重。
- [x] 含空行、CJK、emoji 和组合字符的完整原文逐字保存；UI 仅把换行显示为 `↵` 并按 cell 宽度截断为一行。
- [x] 带附件提交只保存数量和宽泛类型，不保存附件内容、名称、路径或哈希；纯附件提交形成无文本 Prompt Entry。
- [x] `/cost`、`/compact`、`/clear`、`/reload-plugins`、`/rewind` 和 `/prompt-history ...` 在没有 composer-origin submission 时不创建 Prompt Entry；实现不按 `/` 文本前缀硬编码过滤。
- [x] task notification、bridge、peer、SDK、内部 `user` row、render preview 和 placeholder request ID 不创建 Prompt Entry。
- [x] 下游 hook 返回 drop 时不创建 Prompt Entry，相关 Pending Capture 幂等丢弃。
- [x] render 重放和 plugin reload 不重复归档已有 Prompt Entry。
- [x] plugin test 与真实 PTY 覆盖全部输入类型，并通过 semantic verifier 证明漏记、额外条目和重复确认均为零。

## Comments

### 2026-09-21 实现进度

自动门禁已全绿：Claude Code `2.1.273` 与 `2.1.278` 各 48 项 plugin tests
（原 39 项，新增 `tests/composer_capture.test.tsx` 的 9 项）、7 项静态制品测试、
13 项 bridge protocol tests、19 项 helper protocol tests（原 15 项）、
TypeScript 与确定性重建全部通过。

代码改动只有一处：`hooks/register.tsx` 增加 `entryLine()`，把纯附件提交渲染成
`（附件 ×N）` 而不是空行，`TimelineEntry` 随之记住 `attachmentCount`。
采集判定本身（`origin.kind === 'composer'`、`next(e)` 最终文本、pending/confirm/abort）
在 Issue 12 已经到位，本轮以测试把它钉死。

`semantic_verifier.py` 新增 `state: "set"` 形态：显式给出期望的 pending 与 entry
有序集合，逐行比对并附带 `promptEntriesDistinct`，因此漏记、额外条目和重复确认
都会失败。原有单事件形态保持不变。

测试骨架从 `consent_capture.test.tsx` 抽到 `tests/support.tsx`，两个测试文件共用。

剩余：最后一条勾选项需要真人 PTY 验收，自动门禁不覆盖。

### 2026-09-21 真人 PTY 验收

在 `/Users/liangkangda/Fe-project/cc-mods` 上以 `2.1.278` 实跑，档案落在
`~/.claude/plugins/data/prompt-history-inline/archives/<sha256(项目根)>.sqlite3`，
文件名与 `sha256` 一致，档案目录与父目录 `0700`、数据库文件 `0600`，
该目录只有这一个项目的档案。

本轮 Run 的 7 条条目与操作一一对应：三次完全相同的 prompt 形成三条独立
entry（互异 event_id、父链相接、未按文本去重）；多行 + 空行 + 中文 / emoji /
组合字符逐字保存；图片 + 文字只记下 `2 · image,image`；正文为 `/cost` 的普通
文本正常建档；`/cost`、`/prompt-history status`、`/reload-plugins` 零建档。
全档案 15 条、`sequence` 1..15 连续无缺号、`event_id` 全互异、`source` 全为
`composer`、`pending_captures` 为 0，即漏记、额外条目与重复确认均为零。

## Answer

严格采集成立：成员资格只由 `origin.kind === 'composer'` 且 `next(e)` 成功返回
文本的 `prompt.submit` 决定，与 classic hook、transcript `user` row 和
`ui.render` 无关，也不按 `/` 前缀过滤——slash 命令走的是 `command.run`，
根本不经过 `prompt.submit`，而正文恰好是 `/cost` 的文本照常建档。

实现侧本轮只加了一处：`hooks/register.tsx` 的 `entryLine()`，把无文本条目渲染成
`（附件 ×N）`；采集判定在 Issue 12 已到位，本轮以测试把它钉死。
`tests/composer_capture.test.tsx`（9 项）覆盖 15 种非 composer origin、slash 命令、
三次重复、宽字符逐字、附件只留数量与宽泛类型、纯附件、下游 drop 与 render 重放；
`tests/helper_protocol.py` 新增 4 项；`tests/semantic_verifier.py` 新增 `state: "set"`
有序集合形态与 `promptEntriesDistinct`，漏记、多记、重复确认都会失败。
测试骨架抽到 `tests/support.tsx` 供两个测试文件共用。

一项宿主限制已写进 spec 的不承诺清单：Claude Code `2.1.278` 不会产生无文本
composer submission——粘贴附件后宿主把它替换成 `[Image #N]` 占位文本再提交，
prompt-history 逐字保存该最终文本并另记 `1 · image`。空文本路径仍然实现且受测，
但不承诺在当前宿主上出现。
