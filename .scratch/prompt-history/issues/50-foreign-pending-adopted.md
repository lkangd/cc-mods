# 50: 另一个仍在运行的 Run 的 pending 被当成本 Run 的对账

**What to build:** Issue 39 的 PTY 探测发现（2.1.283）：Run A 的提交在确认时碰到损坏，留下 pending。A 仍在运行、损坏对话框还开着时，同一项目的 Run B 提交，弹出的是「未决 Pending Capture：时间线无法唯一证明这条提交是否进入会话」，要 B 替 A 的 pending 选「已进入 / 未进入 / 新根分支」。

原因：待对账记录存在跨会话共享的 `$.store` 里，key 是 `prompt-history:reconcile:<project>`，只按项目区分。`prepareProject` 读到后不看记录里的 `runId`，直接当作本 Run 的 `reconcile`；B 没有 A 的 prompt 原文，只能判为无法证明。helper 的 `capture-list` 会略过仍在运行的 Run 的 pending，但这条读 `$.store` 的路径绕过了它。

后果：
- B 被不属于自己的 pending 拦下，而 spec 的约定是「阻止该 Run 后续提交」；
- B 选「未进入」会在 A 运行时丢掉 A 已进入会话的 prompt；
- 两个 Run 同时欠 pending 时，会互相覆盖记录。

**Blocked by:** —

**Status:** resolved

- [x] 先写 plugin test，在原代码上确认变红：`$.store` 里有另一个 Run 的待对账记录，`capture-list` 把它算作其他 Run 的 pending 时，本 Run 提交不询问、照常归档，那条记录保留。
- [x] 待对账记录按 Run 存放（`prompt-history:reconcile:<project>:<run>`）；只接管本 Run 的记录。旧的按项目存放的记录仍然读取，只在属于本 Run 时接管；其他 Run 的 pending 交给 archive 列表处理。
- [x] PTY：Issue 39 的 PH-STORE-006 中，第二个 Run 被损坏对话框拦下，而不是被别人的 pending 拦下。

## Answer

- **修复**（`hooks/register.tsx`）：
  - 待对账记录按 Run 存放：`prompt-history:reconcile:<project>:<run>`，key 属于正在对账的 Run。
  - `prepareProject` 只接管本 Run 的记录。旧的按项目存放的记录仍然读取，只在 `runId` 等于本 Run 时接管；本 Run 了结 pending 时，它和本 Run 的记录一起删除。
  - 其他 Run 的 pending 交给 helper 的 `capture-list`，它本来就会接管已结束的 Run 的 pending、略过仍在运行的。
  - `clear-all` 忘掉本项目所有 Run 的待对账记录（含旧 key），与它处理各 Run 的 lifecycle 队列一样。
- **plugin test**：
  - `reconcile_pending.test.tsx` 新增两项，都在原代码上变红：
    - `another live Run's reconciliation record is left to that Run`；
    - `a Run's own pending leaves another Run's record as it was`。
  - `clear_all.test.tsx::after a clear the Run goes on collecting in an empty timeline` 补上按 Run 存放的记录，并断言清除后它也被删掉。这一项原来能过，靠的正是这个缺陷：本 Run 接管了别人的记录，再当作自己的清掉。
  - 在本 Run 的 key 上断言记录的测试（`quarantine_archive`、`archive_unavailable`、`clear_segment`、`consent_capture`、`reconcile_pending`）改用按 Run 的 key；`clear_run` 仍用旧 key，覆盖旧记录的接管和保留。
- **PTY**：PH-FAIL-002 中，一个 Run 欠 pending 时，另一个 Run 照常采集；PH-STORE-006 与 PH-FAIL-003 的双 Run 也走这条路径。
