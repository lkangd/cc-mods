# 决定存储安全与故障策略

Type: grilling
Status: resolved
Blocked by: 01, 02, 09

## Question

对于永久且无上限保存的完整 prompt 文本，应采用什么用户告知、默认启用、删除确认、command-hook locator 校验与清理、写入失败、容量耗尽、权限异常、busy timeout、数据损坏、schema 迁移与并发写入策略，才能清楚表达本地敏感数据风险并避免破坏时间线？

## Answer

采用“**项目级明确同意、Run 级采集开关、每项目物理隔离、常规故障失败关闭、宿主级失效显式留痕**”的策略。任何路径都不得静默漏记、自动删减或伪称已安全删除。

### 1. 同意、告知与控制

- Plugin 安装或 `--plugin-dir` 加载不等于同意。每个 Project Timeline 首次 composer 提交前必须选择“启用”或“继续但不启用”；不同 worktree 及规范路径移动后的项目分别同意。
- 首次告知必须说明：保存最终完整文本、明文本地存储、永久且无配额、可能包含凭据、数据库位置、同账户/root 可读取或篡改，以及删除不覆盖 Claude Code transcript、系统快照和外部备份。
- Consent 带策略版本。普通升级不重复询问；采集范围、位置、保留期、安全或删除保证实质变化时暂停采集并重新同意。
- Consent 属于项目；`enable`/`disable` 只切换当前 Run。禁用不删除旧数据、不影响其他 Run，也不补录禁用期间的 prompt；重新启用时写入 Collection Boundary 并从新根分支开始。
- 提供 `/prompt-history enable|disable|status|clear-run|clear-all`。`status` 只显示 consent、Run 模式、档案健康、当前运行时项目路径、数据库路径与大小，不显示 prompt。

### 2. 数据边界与物理隔离

- **修正《决定持久时间线模型》的共享数据库拓扑**：每个 Project Timeline 使用独立 SQLite 文件；同项目多个 Run 仍共享项目 sequence、事务和 Archive generation。这样损坏、迁移、备份与 `clear-all` 不会牵连其他项目。
- 持久项目身份只保存规范项目根的稳定 hash，不保存绝对路径；绝对路径只可在当前运行时的 `status` 中展示。
- Prompt Entry 保存经 hook 链最终进入会话的完整文本。附件只保存数量和宽泛类型，不保存内容、名称、路径或内容哈希；纯附件提交仍形成无文本 Prompt Entry。
- Prompt 原文只通过 stdin 传给 helper，不得进入 argv、locator、错误消息或 Claude Code 日志。诊断只含随机事件 ID、sequence、错误码和必要路径；文本哈希也不输出。

### 3. 采集、提交与对账

- Prompt Entry 的成员资格仍由成功的 `prompt.submit(origin=composer)` 决定；transcript 只负责活动路径、父节点及恢复对账，不能单独判定成员资格，因为它缺少可靠来源、最多返回最新 4096 条且含内部 `user` row。
- 提交前先持久化 Pending Capture；预写失败则 `drop` 并保留编辑内容。`next(e)` 返回最终已进入文本后再原子转为 Prompt Entry。若后置确认失败，保留 pending、阻止该 Run 后续 composer 提交并进入显式对账。
- Pending 在 transcript 中唯一可证时自动确认或丢弃；歧义时要求人工选择“已进入 / 未进入 / 新根分支”。Run 被禁用期间 pending 仍保留，重新启用前必须先解决。
- 已知存储错误全部捕获并失败关闭。但 Claude Code 契约会在 plugin 自身崩溃时放行 prompt，因此不能承诺跨宿主级 fail-open 的原子完整性：恢复时用 transcript 对账，无法恢复则建立显著的 Integrity Gap，绝不显示为完整时间线。
- Run/Clear 等不可阻止的生命周期事件使用不含 prompt 原文的小型 `$.store` 恢复队列和幂等 ID；下一次 composer 提交前先清空。仍无法唯一恢复时同样产生 Integrity Gap。

### 4. 并发、容量与普通故障

- append 使用短事务、WAL、`synchronous=FULL`、幂等 event ID 和项目级单调 sequence。Busy/临时 I/O 采用有界退避，总自动等待不超过 10 秒；之后进入 Archive unavailable，绝不无限后台重试。
- 不设置应用配额、不截断、不轮转、不自动删除。可用空间低于 1 GiB 时每个 Run 警告一次；实际 `ENOSPC` 必须完整回滚。
- Archive unavailable 提供“重试”与“禁用当前 Run 后继续”。后者是明确放弃该 Run 后续采集，不得伪装成连续历史。
- Locator/helper 启动等 Run-local 故障只暂停当前 Run；数据库损坏、不兼容 schema 或迁移中的共享故障作用于整个 Archive generation，所有 Run 在下一次操作时停止写入。
- `clear-all` 使用线性化切点和新 Archive generation：切点前记录全部删除，切点后提交继续采集；旧 generation 的并发 writer 不得复活记录。

### 5. Locator、权限与 helper 信任

- Locator 按 session 隔离，验证格式/schema、session 与宿主进程世代、所有权、权限、绝对规范路径、目录归属及随 function hook 固定的 helper 哈希；任一不符均拒绝执行。
- 数据目录和 locator 目录为 `0700`，数据库、locator、备份和隔离文件为 `0600`，helper 以 `umask 077` 创建并在每次调用时复核。仅当所有权和对象类型可信时才可自动收紧权限；错误 owner、symlink、异常 ACL 或无法证明安全的路径一律拒绝。
- 正常结束删除本 session 的 locator。异常遗留只有在格式和归属可信且能证明对应进程世代已终止时才清理；否则保留并给出人工路径，不执行它。
- 这些检查防止其他 OS 用户、意外权限放宽和陈旧/错误 locator，不抵御当前账户、root 或同时篡改 plugin 与 helper 的主体，也不提供加密或恶意数据库修改证明。

### 6. 损坏与迁移

- 检出损坏时绝不自动修复、覆盖或重建。停止受影响 generation 的写入，并提供：重试完整性检查、原样保留为 Quarantined Archive 后明确开始新 generation、或经强确认执行 `clear-all`。
- 仅执行已知的单向 schema 迁移。迁移前完成完整性检查，并在同目录创建相同私有权限的备份；空间不足则拒绝迁移。迁移必须在事务中完成并复检，下一次成功打开后才删除备份。
- 高于 helper 支持版本的数据库直接拒绝打开。迁移备份属于敏感档案；删除操作必须覆盖它，不能让旧原文因回滚副本继续存在。

### 7. 删除契约

- 有数据时，`clear-run` 先显示当前 Run、记录数和副本边界并要求一次确认；`clear-all` 显示项目范围、文件与记录数，并要求输入固定确认短语。无目标记录时返回 no-op，不询问。
- `clear-run` 删除当前 Run 的 Prompt Entries、Pending Captures 和相关原文。若存在无法安全打开的 Quarantined Archive，则不得宣称已完整按 Run 删除，应拒绝并引导使用 `clear-all`。
- `clear-all` 删除当前项目的活动 DB、WAL/SHM、迁移备份、隔离档案及所有 prompt 元数据；不删除 locator，也不撤销项目 consent 或当前 Run 模式，随后建立空的新 Archive generation。
- 使用 `secure_delete`、WAL checkpoint/truncate 和必要的空间回收。若事务删除已完成但 WAL、备份或残留文件清理失败，必须报告“逻辑删除完成、物理清除未完成”、列出残留并保持 Archive unavailable，直到清理成功或用户明确选择禁用后继续。（2026-09-28 Issue 30 修订：`clear-all` 删除的是整个文件，只做 `unlink` 与目录 `fsync`，不覆写；写时复制文件系统与 SSD 上不保证物理不可恢复，确认界面会声明这一边界。）
- 所有删除提示都必须重申：不删除 Claude Code 自身 transcript/history、文件系统快照、系统或第三方备份中的副本，也不保证 SSD 物理介质上的不可恢复擦除。
