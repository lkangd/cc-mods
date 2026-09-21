# 15: 对账中断的 Pending Capture

**What to build:** 让提交过程中的写入或宿主中断保持可恢复：不确定的提交不会被猜成 Prompt Entry，草稿不会丢失，使用者可以看见并解决歧义。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** ready-for-agent

- [ ] Pending Capture 预写失败时，本次 composer submission 被 drop，输入内容原样保留或恢复到 composer，且不产生半成品 Timeline Event。
- [ ] `next(e)` 成功后确认写入失败时，Pending Capture 保留，当前 Run 进入待对账状态并阻止后续 composer submission。
- [ ] transcript 能唯一证明提交已进入时自动确认 Prompt Entry；能唯一证明未进入时自动丢弃 pending。
- [ ] 无法唯一证明时，使用者只能选择“已进入 / 未进入 / 新根分支”，且每个选择幂等并产生对应语义结果。
- [ ] 待对账期间 `status` 清楚显示状态和非敏感事件 ID，不输出 draft 或 prompt 原文。
- [ ] disable 当前 Run 不删除 Pending Capture；再次 enable 前必须先完成对账。
- [ ] 对账 UI 关闭或取消时保持阻止状态，不会默认确认、丢弃或让原提交自动重试。
- [ ] helper/crash 重启后 Pending Capture 仍可发现和解决；重复执行恢复不会产生多个 Prompt Entries。
- [ ] plugin test 注入预写、下游、确认和重启故障；helper test 与真实 PTY 分别验证持久状态、草稿恢复和提交阻止。
