# 13: 严格匹配人类 composer 提交

**What to build:** 让 Project Timeline 只包含真正成功进入会话的人类 composer submission，并对重复、多行、宽字符和附件输入保留准确语义。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** ready-for-agent

- [ ] 只有成功的 `prompt.submit` 且 origin 为 composer 才确认 Prompt Entry；成员资格不依赖 classic hook、transcript `user` row 或 `ui.render`。
- [ ] 保存 `next(e)` 返回的最终文本；下游 hook 改写后的文本与 Claude Code 实际收到的文本一致。
- [ ] 连续三个完全相同的 prompt 产生三个独立 Prompt Entries、sequence 和事件身份，不按文本去重。
- [ ] 含空行、CJK、emoji 和组合字符的完整原文逐字保存；UI 仅把换行显示为 `↵` 并按 cell 宽度截断为一行。
- [ ] 带附件提交只保存数量和宽泛类型，不保存附件内容、名称、路径或哈希；纯附件提交形成无文本 Prompt Entry。
- [ ] `/cost`、`/compact`、`/clear`、`/reload-plugins`、`/rewind` 和 `/prompt-history ...` 在没有 composer-origin submission 时不创建 Prompt Entry；实现不按 `/` 文本前缀硬编码过滤。
- [ ] task notification、bridge、peer、SDK、内部 `user` row、render preview 和 placeholder request ID 不创建 Prompt Entry。
- [ ] 下游 hook 返回 drop 时不创建 Prompt Entry，相关 Pending Capture 幂等丢弃。
- [ ] render 重放和 plugin reload 不重复归档已有 Prompt Entry。
- [ ] plugin test 与真实 PTY 覆盖全部输入类型，并通过 semantic verifier 证明漏记、额外条目和重复确认均为零。
