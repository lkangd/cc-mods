# 34: fork 一个 compact 过的 session 时沿用来源的 Active Branch

**What to build:** 对一个 `/compact` 过的 session 做 `/fork`，fork 出来的子 session 拿到的 transcript 也是 compact 过的，compact 之前的 user 行都不在里面。子 session 有自己的进程，又不知道这份 transcript 被 compact 过：compacted 标记记在来源 session 的键下，fork 拿不到来源 session。于是 `branch-match` 按 `whole` 匹配，链上的祖先找不齐，结果是 `none`，子 session 的第一条 prompt 静默开了无父根，时间线上也就没有「从 Run … 分出」。本票让 bridge 从子 session 的 transcript 认出 compact，并交给插件，让插件按 `truncated` 匹配。

**Blocked by:** 18「在 resume 与 fork 中重建 Conversation Branch」

**Status:** open

- [ ] bridge 在 SessionStart（source 为 `fork`；`resume` 是否也要，实现前核实）时检查本 session 的 transcript 里有没有从来源复制过来的 `compact_boundary`。有的话，在会话索引和 locator 里写一个可选字段，并在该 session 之后每次发布 locator 时都带上。`locatorVersion`/`indexVersion` 不升。
- [ ] 插件的 `parseLocator` 把这个字段当可选字段处理，值不合法时按 locator schema 错误 fail closed。`sessionCompacted` 认这个字段，命中时给本 session 的 compacted 键补写 true。
- [ ] fork 一个 compact 过的 session 后，子 session 的第一条 prompt 挂在来源的最后一条 Prompt Entry 上，时间线显示「从 Run … 分出」。
- [ ] fork 一个没 compact 过的 session，行为不变（仍按 `whole` 匹配）。
- [ ] 真实 PTY（2.1.281）：R1…Rn → `/compact` → 再提交一条 → `/fork 只回复 BG`，BG 挂在最后一条 prompt 上，并显示「从 Run … 分出」。

## Comments

### 2026-09-24 · 从 Issue 33 验收中拆出

Issue 33 的 PTY 第四步（2.1.281）：session `a5675173` 依次提交 R3 → `/compact` → R4、R5、R6 → `/fork 只回复 BG`。fork 子 session `de7e0660` 新开了 Run `fa375d9f`，这符合预期；但 BG 的 `parent_event_id` 为空。

实机取证：
- 子 session 的 transcript 以复制过来的 `compact_boundary` 和 compact 摘要开头，后面是 R4、R5、R6 的副本，没有 R1–R3。复制的行在文件里排在它自己的 `SessionStart:fork` 之前。
- 子 session 的进程是 `claude bg-spare` 预热进程，启动于来源进程接续后不久；它自己没有派发过 `session.compact`，store 里也没有子 session 的 compacted 键。
- 用档案副本重放 `branch-match`（输入截到 BG 提交前，只打印事件 id）：`whole` 得到 `none`，`truncated` 唯一匹配到 R6 `6018b339`。

与使用者对齐：用 bridge 标记（和 `continuedFrom` 的做法一致），不采用「插件在 `whole` 得到 `none` 时退回 `truncated`」。后者会放宽匹配：没 compact 过的 fork，如果尾部碰巧和别的链一致，可能被挂错父节点。

待核实：bridge 运行时，子 transcript 里复制的行是否已经全部落盘。上面「复制的行排在 SessionStart:fork 之前」只说明它们在 hook 结果写入之前就已在文件里。
