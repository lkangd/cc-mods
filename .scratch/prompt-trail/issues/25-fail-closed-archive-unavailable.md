# 25: Archive unavailable 时失败关闭

**What to build:** 当 Prompt Trail 无法证明新 Prompt Entry 可正确保存时，阻止当前提交、保留草稿并提供明确恢复选择，而不是静默漏记、无限等待或退化到内存时间线。

**Blocked by:** 15「对账中断的 Pending Capture」、24「隔离项目并支持并发 Run」

**Status:** ready-for-agent

- [ ] SQLite busy 使用有界退避且总自动等待不超过 10 秒；超时进入 Archive unavailable，不在后台无限重试。
- [ ] 可用空间低于 1 GiB 时每个 Run 只警告一次；实际 `ENOSPC` 完整回滚，不产生半事件或丢失 Pending Capture。
- [ ] 只读目录、权限异常、locator/helper 启动失败、运行中 helper 消失或摘要变化均形成明确、非敏感的失败状态。
- [ ] Run-local locator/helper 故障只阻止受影响 Run；共享档案故障会让使用同一 Archive generation 的所有 Run 在下一次操作时停止写入。
- [ ] 已启用 Run 在 Archive unavailable 下 drop composer submission 并原样保留草稿，不允许 Claude Code 对话静默领先于档案。
- [ ] 使用者只可选择“重试”或“明确禁用当前 Run 后继续”；禁用写 Collection Boundary，且不得声称禁用区间完整。
- [ ] 重试成功后恢复原 Run 和 Active Branch，不重复 Pending Capture 或 Prompt Entry。
- [ ] `status` 在所有失败状态下可用，只显示作用范围、错误类别、必要路径和非敏感 ID。
- [ ] 任一失败路径都不截断、轮转、自动删除、联网、热切换 helper 或启用无持久化 fallback。
- [ ] helper fault injection、plugin test 与真实 PTY 分别覆盖 busy、ENOSPC、权限、helper/locator 失效、重试和禁用后继续。

## Comments

### 实现层面对齐（2026-09-27）

现状：`markArchiveUnavailable` 把 `prompt-trail:archive-state:<projectId>` 写成 `unavailable`，代码库里没有任何地方清除它；写入点也不区分 Run 级故障和共享档案故障，连 `next(e)` 抛错也会写。其他进程只在 `prepareProject` 解析到新项目时读取它。busy 用的是 `sqlite3_busy_timeout(10000)`，按每次加锁计时，一次 helper 调用可能多次加锁；宿主的 `$.process.run` 超时也是 10 秒，到时 kill 子进程并 reject，结果是一次没有类别的失败。`SQLITE_FULL` 只报 `archive-sqlite`。`beginCapture` 和 `listPending` 丢掉了 helper 的类别，只抛扁平标签。

- **Q1 阻塞模型**：分两层。
  - **共享**：仍是 `$.store` 的 `archive-state:<projectId>`，升级为 `{version:2, state:'unavailable', category, since}`。每次提交、`enable` 和 `status` 都重新读取（与 consent 相同），其他 Run 在下一次操作时停下，不经尝试直接弹出对话框。
  - **Run 级**：只存在内存里，仅供 `status` 和 band 显示，不让下一次提交走捷径被拒：下一次提交照常真实尝试。
  - **重试**：忽略共享标记，真实重跑本次提交的完整流程，不新增 helper 健康检查命令。
  - Archive generation 要到 Issue 30 才有，目前按项目划分即等价于按 generation 划分。
- **Q2 故障范围**：
  - **Run 级**：preflight、`helper-*`、`locator-*`（含 `locator-directory`）、`home-unavailable`、`host-*`、`claude-code-version*`、`digest-mismatch`、`capture-identity`、`*-conflict`，以及 helper 被宿主超时 kill（记为 `helper-timeout`）。
  - **共享**：`archive-sqlite`、新增 `archive-busy`、新增 `archive-full`、`database-*`、`schema-version`、`project-identity`。
  - `next(e)` 抛错不写任何标记，现有的 `pendingDiscovered=false` 已保证下一次对账。
  - 所有 helper 调用透传 helper 的类别。backlog `20260927-locator-directory-failure-scope.md` 随本票关闭。
- **Q3 busy**：自定义 busy handler，整次 helper 调用共用一个 8 秒墙钟截止时间（给宿主 10 秒超时留余量），退避从 5ms 起翻倍、封顶 250ms，超时报 `archive-busy`。「总自动等待 ≤10 秒」按每个 helper 操作理解，与 spec 第 10 节一致。一次提交会调用 2–3 个 helper，每段都有界，不在后台重试。
- **Q4 低空间**：helper 在 `capture-begin` 成功时用 `statfs` 测数据库所在卷，响应附加 `lowSpace: true|false`，不暴露字节数。插件在 `$.store` 的 `space-warned:<projectId>:<runId>` 下记录，每个 Run 只弹一次 toast「Prompt Trail 档案所在磁盘可用空间低于 1 GiB：<数据库路径>」，跨 reload/resume 也不重复；不阻止提交。`status` 新增 `disk space: low|ok|unknown`。
- **Q5 测试注入**：用真实条件，发布的 helper 里不加任何故障注入代码。
  - busy：python 持有 `BEGIN EXCLUSIVE`；
  - ENOSPC 与低空间：`hdiutil` 挂几 MB 的临时卷作为数据目录，不需要 root；
  - 权限：`chmod`；
  - helper 消失或摘要变化：重命名或改写 `bin/`。
  - `hdiutil` 不可用时先报告，不私自改用编译期注入。
- **Q6 恢复交互**：已启用的 Run 被阻止时，在这次提交里弹出 `$.ui.ask`，写明范围（本 Run / 本项目所有 Run）和类别，说明本次提交尚未进入会话，选项为「重试」「禁用当前 Run 后继续」。
  - **重试**：真实重跑；成功就正常采集并提交，不需要再按 Enter；仍失败就再弹一次，显示最新类别。每次重试都由使用者触发。
  - **禁用当前 Run 后继续**：走现有 `disableCollection` 路径，尽量写 stop boundary，写不成就记 `stopBoundaryMissing`，然后 `next(e)` 放行；提示不声称禁用区间完整。
  - **Esc 或关闭**：drop，原样恢复草稿。
  - 重试时遇到对账（`settled`）仍按现有规则 drop 并要求重新提交，不代替使用者提交。
- **Q7 接入范围**：所有「为避免漏记，本次提交已阻止」的 drop 都统一走 Q6 对话框，各自给出类别：项目身份不可证、run mode 不可读、preflight 失败、Pending Capture 不可读、lifecycle 补写失败、档案不可用、预写失败。不接入的三类：consent 未作答、父节点歧义候选 Pane、`settled` 后要求重新提交。禁用本身无法持久化时（如 run mode 不可读），沿用现有做法只在内存禁用，并在提示里说明。
- **Q8 `status`**：`archive:` 行为 `unavailable · 范围 run|archive · 类别 <category>`；共享标记来自其他 Run 时注明「由另一个 Run 报告」，不显示对方 run id；新增 `disk space:` 行；每次执行都重新读取共享标记。
- **Q9 band**：本 Run 已启用且已知处于 unavailable（任一范围）时，标题行追加 `· 档案不可用`，恢复后去掉；窄终端时排在焦点提示之后先被截掉。
- **Q10 `enable`**：不看共享标记，直接真实写 Collection Boundary；成功清除标记，失败按类别写入对应范围。
- **Q11 恢复判定**：任何 Run 的任何一次成功 helper 写入（`capture-begin`、`confirm`、`abort`、`boundary-append`，含 lifecycle 补写）都清除共享标记；读成功不算。lifecycle 写入本就无法阻止，照常尝试，不看标记，失败照旧进恢复队列。A 刚写下 `archive-busy`、B 紧接着写入成功并清除，可以接受。
- **Q12 真人 PTY**：
  1. busy：python 持锁超过 8 秒，提交弹出对话框（`archive-busy`、本项目），草稿仍在；释放后重试，正常入档且不重复。
  2. 权限：`chmod 500` archives 目录，弹出对话框；恢复后重试成功。
  3. Run 级：A 终端改名 helper 后提交，只有 A 被阻止（本 Run），B 照常采集；改回后 A 重试成功。
  4. 共享传播：A 遇到共享故障；B 下一次提交不经尝试就弹对话框，band 显示「档案不可用」；A 重试成功后 B 的标记消失。
  5. 禁用后继续：本次 prompt 进入会话但不入档，`status` 为 disabled；恢复后 `enable`，禁用区间有 stop/resume 边界。
  6. ENOSPC 与低空间：`hdiutil` 小卷挂到 archives 目录，先见每 Run 一次的低空间 toast，写满后提交被阻止，Pending Capture 不丢。宿主路径校验不允许时只在 helper 黑盒层覆盖，并记录原因。
- **Q13 协议版本**：不提升 `HELPER_PROTOCOL`。字段只是追加，插件钉死了 helper 摘要，新旧不会混用。
