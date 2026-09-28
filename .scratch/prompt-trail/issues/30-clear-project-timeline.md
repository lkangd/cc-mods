# 30: 原子清除 Project Timeline

**What to build:** 让使用者通过强确认清除当前项目的全部 Prompt Trail 档案，并在线性化切点切换 Archive generation，使并发旧 writer 无法复活被删除数据。

**Blocked by:** 24「隔离项目并支持并发 Run」、28「隔离损坏的 Archive generation」

**Status:** ready-for-agent

- [ ] 当前 Project Timeline 没有任何活动、备份或隔离档案时，`/prompt-history clear-all` 返回 no-op 且不询问。
- [ ] 有数据时显示项目范围、活动/备份/隔离文件和记录数，并要求输入固定确认短语；提示不展示 prompt。
- [ ] `clear-all` 建立线性化切点和新的 Archive generation；切点前记录全部删除，切点后已接受的新提交只进入新 generation。
- [ ] 旧 generation 的并发 writer、重试或陈旧 locator 无法向新 generation 写入或复活记录。
- [ ] 删除范围覆盖活动数据库、WAL/SHM、迁移备份、Quarantined Archives 及全部 prompt 元数据，以及会话索引（`<plugin data>/sessions/`）里指向本项目档案中出现过的 Run 的记录；之后 resume 这些会话会新建 Run。（Issue 32 新增。）
- [ ] locator 生命周期保持独立；Collection consent 与当前 Run collection mode 保留，并在空的新 generation 中继续工作。
- [ ] secure delete、checkpoint/truncate、空间回收和文件删除完成后，byte marker 扫描确认所有项目 prompt 标记消失。
- [ ] 逻辑删除成功但任何敏感残留清理失败时，准确报告部分物理失败并保持 Archive unavailable，直到清理成功或使用者明确禁用。
- [ ] 确认流程重申 Claude Code transcript/history、快照、备份和 SSD 介质边界。
- [ ] 把 `clear-all` 作为强确认清除加进 `archive-integrity` 对话框，并覆盖 Issue 28 的隔离目录 `archives/quarantine/<projectId>/`。（Issue 28 转交。）
- [ ] helper generation-race tests、双 Run PTY 与故障注入覆盖取消、成功、陈旧 writer、Quarantine、残留和清除后继续采集。
