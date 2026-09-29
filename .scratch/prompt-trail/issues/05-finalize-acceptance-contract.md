# 定稿兼容与验收契约

Type: grilling
Status: resolved
Blocked by: 03, 04, 06, 10

## Question

结合最终时间线模型和交互原型，MVP 应承诺哪些 Claude Code `2.1.273` 行为、降级路径与验收场景，才能覆盖重复和多行 prompt、slash 命令、`/clear`、compaction、重载、重启、长历史、窄终端、滚动拒绝及持久化故障？

## Answer

采用“**单一支持矩阵、可观察行为契约、分层证据、所有 MUST 场景零缺失零跳过**”作为发布门禁。SQLite 物理 schema 是内部实现，不构成公开兼容面；验收可通过专用 verifier 检查事件语义，但不得让测试依赖表名或列布局。

### 1. 规范等级与通过条件

- **MUST**：受支持矩阵内的发布阻断条件。任一失败、缺失、跳过或没有可追溯证据，均不得发布。
- **明确降级**：宿主拒绝某能力时仍必须存在的替代路径；替代路径本身是 MUST。
- **不承诺**：已知宿主限制或范围外能力，必须在 README、`status` 或交互提示中预先说明，不能在验收失败后临时改列。
- 唯一受支持矩阵是 macOS 15.x arm64、Claude Code `>=2.1.273` early-access function hooks、交互式终端、可信本地目录 `--plugin-dir`。每次发布必须在最低兼容版本和当前发布验收版本完成门禁，其中所有 MUST 场景都必须通过。
- 所有验收只使用隔离的临时项目根、临时 plugin data、临时 locator 和合成 prompt；禁止读取、改写或删除现有 Prompt Trail 档案。

### 2. 分层证据

1. **自动化协议与存储测试**：覆盖 helper protocol、Timeline Event 语义、SQLite 事务、并发、迁移、删除、恢复和穷举故障注入。
2. **真实宿主验收**：在支持矩阵中执行可复现的交互脚本，验证 function/classic hook 生命周期、composer 阻止与草稿恢复、UI、Jump Target、reload、restart、resume、fork、rewind 和代表性持久化故障。
3. **静态制品检查**：验证 thin arm64 Mach-O、`minos 15.0`、PIE、允许的系统动态依赖、SHA-256、helper protocol/schema manifest、系统 SQLite 版本及能力。

每个场景使用稳定 ID。发布报告必须记录插件、Claude Code、OS、架构、helper 摘要、SQLite 版本、fixture、步骤、预期、实际、结果和证据链接；终端 trace 与报告不得含 prompt 原文。

### 3. 兼容与启动场景

- **PT-COMPAT-001 支持矩阵冷启动**：locator、制品摘要、helper protocol、SQLite 能力和只读健康握手全部成功后，才可请求 Collection consent；探针本身不创建项目数据库或 Prompt Entry。
- **PT-COMPAT-002 不受支持目标**：分别注入 OS、架构、macOS 主版本、Claude Code `<2.1.273` 或版本无法证明；不得请求 consent、创建档案或尝试联网/编译，`status` 显示 `unsupported target`。
- **PT-COMPAT-003 Helper 不可用**：覆盖缺失、非普通文件、不可执行、摘要不符、错误 protocol、SQLite 能力不足、dyld/隔离/企业策略拒绝；不得静默换 binary、SQLite 或内存时间线。
- **PT-COMPAT-004 制品检查**：发布制品必须与 manifest 完全一致；检查脚本的任一不一致均阻断发布。
- **PT-COMPAT-005 进程接入版本绑定**：helper 未变时 `/reload-plugins` 可继续；路径、内容、摘要或 protocol 改变时当前进程接入进入 Archive unavailable，只有恢复原制品或新的进程接入才可继续。（2026-09-23 Issue 32 修订。）

### 4. 采集与内容场景

- **PT-CAPTURE-001 基本恰好一次**：一次成功的 `prompt.submit(origin=composer)` 只产生一个 Prompt Entry；使用 hook 链返回的最终文本，sequence 单调且 event ID 幂等。UI、档案和当前 transcript 的人类 prompt 顺序一致。
- **PT-CAPTURE-002 重复文本**：连续提交至少三个完全相同的 prompt；产生三个独立 Prompt Entry、独立 sequence 和可用时独立 Jump Target，不按文本去重。
- **PT-CAPTURE-003 多行与宽字符**：包含空行、CJK、emoji 和组合字符的完整原文逐字持久化；UI 仅把换行显示为 `↵`，再按终端 cell 宽度截断并加省略号，不改写档案文本且不生成第二显示行。
- **PT-CAPTURE-004 附件边界**：附件只保存数量和宽泛类型；不得保存内容、名称、路径或哈希。纯附件 composer submission 仍产生无文本 Prompt Entry。
- **PT-CAPTURE-005 Slash 与控制命令**：`/cost`、`/compact`、`/clear`、`/reload-plugins`、`/rewind` 和 `/prompt-history ...` 在没有成功 composer-origin `prompt.submit` 时均不产生 Prompt Entry。判定只依据事件语义，不硬编码过滤以 `/` 开头的文本；若未来某命令确实形成成功的 composer submission，则记录其最终文本。
- **PT-CAPTURE-006 非人类流量**：task notification、bridge、内部 `user` row、render preview 和 `requestId="placeholder"` 均不得创建 Prompt Entry。
- **PT-CAPTURE-007 Hook 链 drop**：下游返回 `drop` 时不创建 Prompt Entry；Pending Capture 必须被确认丢弃，不能遗留伪记录。
- **PT-CAPTURE-008 Pending Capture 对账**：预写成功而后置确认中断时保留 pending 并阻止后续 composer submission；唯一可证时自动确认/丢弃，歧义时只允许“已进入 / 未进入 / 新根分支”的人工选择。

### 5. 生命周期、分支与跳转场景

- **PT-LIFE-001 `/clear`**：`SessionEnd(reason=clear)` 恰好写入一个 Clear Boundary 并结束当前 Conversation Segment；`SessionStart(source=clear)` 只关联新 classic session id。Run 不变，前后 prompt 分属不同 Segment；重复事件和两事件间崩溃均不得重复或丢失边界。新进程（普通启动或 `--resume`）第一件事就执行 `/clear` 时同样恰好写入一个 Clear Boundary，不得记成 Integrity gap。（2026-09-29 Issue 42 修订。）
- **PT-LIFE-002 Compaction**：`/compact`、`source=compact`、Pre/PostCompact 和延迟 `prompt.context` 均不得创建 Clear Boundary、Prompt Entry 或新 Run；compact 前后活动分支保持连续。
- **PT-LIFE-003 Plugin reload**：同进程 reload 产生新 module instance 但沿用 Run；重放的 `ui.render` 不创建 Prompt Entry，已绑定项不重复，展开状态恢复；焦点离开 band 后不保留选中位置，reload 后与 Esc 后一样从最新条目开始。（2026-09-29 Issue 36 修订。）
- **PT-LIFE-004 正常退出与普通重启**：正常退出记录 Run 离开；普通启动的新进程获得新 Run，沿用同一 Project Timeline 和 Archive generation。旧 Prompt Entry 仍可浏览，但未在当前 transcript 重放的项无 Jump Target。
- **PT-BRANCH-001 Resume**：`claude --resume`、`--continue` 与会话内 `/resume` 续接原 Run 并记录 Run 续接，依据 source、session id 和唯一共享前缀恢复 Active Branch；共享历史只重绑 Jump Target，不重复归档；resume 节点之后不在活动路径上的条目折叠为可展开的另一分支。双终端并发 resume 同一会话时后到者新建 Run 并记录来源。（2026-09-23 Issue 32 修订。）
- **PT-BRANCH-002 Fork**：后台 `/fork` 与 `--fork-session` 均创建新 Run 和新 Conversation Branch；共享前缀不重复，fork 参数若以 composer submission 进入则产生新 Prompt Entry。
- **PT-BRANCH-003 Rewind 与 Esc Esc**：恢复到旧位置后的首次 composer submission 创建新分支，原分支永久保留；不得依赖 `command.run(rewind)` 才识别分支。
- **PT-BRANCH-004 父节点歧义**：首次歧义提交必须 drop，完整草稿只保存在内存，打开已聚焦候选 Pane；选择后关闭 Pane、用 `$.prompt.fill()` 恢复草稿且不自动重提，未选择前继续阻止提交。
- **PT-JUMP-001 有效目标**：鼠标点击或 Enter 激活有效 Jump Target，成功后折叠并把焦点还给 composer。
- **PT-JUMP-002 失效目标**：普通重启或 transcript 不可用时仍保留 Prompt Entry，显示 `×`；激活无副作用、不折叠、不猜测目标。Resume/fork 只给唯一对齐且当前重放的共享前缀重新绑定目标。

### 6. 时间线 UI 与长历史场景

- **PT-UI-001 折叠和展开**：启动默认只显示一行 `Prompt Trail`；标题点击或 `/prompt-history` 切换。展开不得声称自动取得键盘，必须提示 `ctrl+x tab` 或鼠标；Esc 只保证把焦点还给 composer，不保证折叠。
- **PT-UI-002 顺序与边界**：按旧到新显示 Prompt Entry、Run、Clear、Collection、分支和 Integrity Gap 边界；每项稳定 keyed，加载更早数据后当前选择不跳动。
- **PT-UI-003 新条目**：位于底部时跟随新 Prompt Entry；查看旧历史时保持位置并累加新条目提示，回到底部后清零。
- **PT-UI-004 连续浏览**：不显示页码；方向键、Enter、鼠标 hover/点击必须可遍历和激活完整时间线。最早可见项获得焦点时预载上一批并保留同一 keyed Button。
- **PT-UI-005 滚动拒绝降级**：Ghostty/宿主不发送 `ui.scroll` 时，方向键与点击仍可到达首尾；触控板/滚轮不是 MVP 支持路径。PageUp/PageDown/Home/End 只有在真实终端单独通过后才可写入承诺，否则列为不承诺。
- **PT-UI-006 长历史**：构造含 Prompt、边界和分支的 100,000 个 Timeline Events。查询与渲染均遵守实现声明的固定批次/窗口上限，不全量读取或无限累积已渲染节点，并能连续到达首尾。参考机器、硬件和版本写入报告；一次预热后重复十次，展开、加载下一批和新条目显示的 p95 各不超过 1 秒。该数字是发布证据门槛，不是所有硬件的绝对 SLA。
- **PT-UI-007 窄终端**：在 28 列和 6 行边界两侧测试；低于任一门槛只显示折叠控制和空间不足提示。尺寸恢复后保留展开状态、选择项、旧历史位置和新条目计数。30–40 列下的 CJK/emoji/multiline 条目不得换成第二行。
- **PT-UI-008 AskUserQuestion 让出**：`tool.call(AskUserQuestion)` 的整个 `next(e)` 生命周期内让出 AbovePrompt，结束后恢复展开和选择状态。第三方插件之间无通用槽位信号，自动仲裁不属于承诺。

### 7. 持久化、并发与恢复场景

- **PT-STORE-001 重启延续**：关闭并重新启动 Claude Code 后，项目 sequence、所有历史事件、Archive generation 和 consent 延续；普通启动得到新 Run，resume 续接原 Run，都不复用旧进程世代。
- **PT-STORE-002 双 Run 并发**：两个 Run 对同一项目交错提交，验证 WAL、短事务、单调唯一 sequence、幂等 event ID 和各自 Active Branch；禁用一个 Run 不影响另一个。
- **PT-STORE-003 Busy**：注入锁竞争并验证有界退避，总等待不超过 10 秒；超时后进入 Archive unavailable，不后台无限重试。
- **PT-STORE-004 空间不足**：低于 1 GiB 每个 Run 只警告一次；`ENOSPC` 完整回滚，不产生半事件、丢失 pending 或自动删减历史。
- **PT-STORE-005 权限与路径**：覆盖错误 owner、symlink、非普通文件、宽权限、异常 ACL、路径逃逸和陈旧 locator；只在对象可信时自动收紧，其他情况一律拒绝且不执行可疑 helper。
- **PT-STORE-006 损坏**：损坏检测后停止整个 Archive generation 写入；原文件不变，分别验证重试检查、Quarantined Archive 后新 generation 和强确认 `clear-all`。
- **PT-STORE-007 迁移**：完整性检查、空间检查、同目录私有备份、事务迁移、复检及下次成功打开后删备份全部通过；中断可恢复，高于支持版本直接拒绝。
- **PT-STORE-008 Generation 竞争**：`clear-all` 与至少两个并发 writer 交错；线性化切点前数据全部消失，切点后提交只进入新 generation，旧 writer 不得复活记录。
- **PT-STORE-009 项目隔离**：两个规范项目根使用两个独立数据库；一个项目的损坏、迁移、删除或 Archive unavailable 不影响另一个。不同 worktree 和路径移动后重新请求 consent。

### 8. 失败关闭与 Integrity Gap 场景

- **PT-FAIL-001 预写失败**：Pending Capture 无法持久化时 drop 本次 composer submission，原样保留草稿；不得让 prompt 进入 Claude Code 后再假装完整。
- **PT-FAIL-002 后置确认失败**：保留 pending、阻止该 Run 后续提交并进入对账；UI 和 `status` 明确说明状态，不输出 prompt 原文。
- **PT-FAIL-003 Archive unavailable 操作**：只提供“重试”和“明确禁用当前 Run 后继续”。禁用写入 Collection Boundary，不补录禁用区间，也不影响其他健康 Run。
- **PT-FAIL-004 宿主级 fail-open**：模拟 plugin 崩溃或不可阻止生命周期写入失败；优先以 transcript 和 `$.store` 恢复队列对账。无法唯一恢复时写入显著、不可变的 Integrity Gap，不得显示为完整时间线。
- **PT-FAIL-005 Gap 后恢复**：恢复成功后可把当前档案健康改回 healthy，并写入 Gap 的闭合边界；历史 Integrity Gap 永久可见，跨 Gap 的历史不得称为完整。只有删除相应范围的 `clear-run`/`clear-all` 才能移除该标记。
- **PT-FAIL-006 代表性真实宿主故障**：至少在真实 Claude Code 中端到端覆盖 locator/helper 不可用、提交失败关闭、重试、禁用后继续、busy、损坏和物理删除残留；其他底层故障可由 helper 集成测试穷举。

### 9. 控制与删除场景

- **PT-CONTROL-001 `status`**：只显示 consent、Run collection mode、当前健康、历史 Gap 提示、运行时项目路径、数据库路径与大小；不得显示 prompt。失败状态下仍可用。
- **PT-CONTROL-002 Enable/disable**：首次 enable 先完成 preflight 和项目 consent；disable 只影响当前 Run且不删除；重新 enable 先解决 pending，再写 Collection Boundary 并从新根分支开始。
- **PT-DELETE-001 `clear-run`**：有数据时显示 Run（跨越其所有进程接入）、记录数和副本边界并确认；删除当前 Run 的 Prompt Entries、pending 及相关原文，不影响其他 Run。存在无法安全打开的 Quarantined Archive 时拒绝声称完整删除。
- **PT-DELETE-002 `clear-all`**：有数据时显示项目范围、文件和记录数并要求固定短语；删除活动 DB、WAL/SHM、迁移备份、Quarantined Archive 和全部 prompt 元数据，保留 consent 与当前 Run mode，然后建立空 generation。
- **PT-DELETE-003 无数据与残留**：无目标时 no-op 且不询问。逻辑删除完成但 WAL、备份或文件清理失败时，准确报告“逻辑删除完成、物理清除未完成”，列出残留并维持 Archive unavailable。
- **PT-DELETE-004 删除边界告知**：所有删除流程重申不删除 Claude Code transcript/history、文件系统快照和外部备份，也不保证 SSD 介质不可恢复擦除。

### 10. 原文泄漏与安全门禁

- **PT-SEC-001 唯一标记扫描**：每个 fixture 使用不可猜测的合成标记。标记只允许出现在目标 SQLite 原文字段、专用时间线读取子命令 `timeline-read` 的响应（经 `$.process.run` 捕获进 hook 内存，只用于显示）和当下允许显示的 UI；不得出现在 argv、locator、stderr、其他子命令的 stdout、Claude Code/plugin 日志、错误文本、trace、备份清单或发布报告。（2026-09-23 Issue 17 经使用者确认修订。）
- **PT-SEC-002 stdin 与诊断**：验证 helper 只从 stdin 接收原文；所有诊断只含随机事件 ID、sequence、错误码和必要路径，不含原文或文本哈希。
- **PT-SEC-003 私有权限**：目录始终为 `0700`，数据库、locator、备份和隔离文件始终为 `0600`，helper 使用 `umask 077`；创建、迁移、隔离、清除和异常恢复后都复核。
- **PT-SEC-004 无隐式副作用**：所有失败路径都不得联网、现场编译、修改 xattr/系统安全策略、自动删除数据或创建伪完整的内存 fallback。

### 11. 明确不承诺

- Linux、Windows、WSL、Intel Mac、Rosetta、macOS 14 及更早版本、Claude Code `<2.1.273`/版本无法证明、Desktop、IDE 和 Mobile。
- Marketplace 安装、更新、卸载、`--keep-data`，以及移除 `--plugin-dir` 后的自动清理。
- 展开后自动聚焦、Esc 自动折叠、触控板/滚轮；未经真人通过的 PageUp/PageDown/Home/End。
- 第三方插件 AbovePrompt 槽位的自动仲裁。
- transcript 已不可用条目的跳转、跨 Integrity Gap 的完整性、禁用区间补录。
- 加密、防当前账户/root 篡改、SSD 物理不可恢复擦除，以及所有硬件上的固定延迟 SLA。
- SQLite 表结构稳定性、运行时下载/编译、无持久化内存 fallback、网络同步或 prompt 日志。

只有上述全部 MUST 场景在发布报告中通过，Prompt Trail MVP 才满足兼容与验收契约。

## Comments

- 2026-09-20：根据 Claude Code `2.1.278` 真人验收，将宿主版本契约从精确 `2.1.273` 改为最低版本 `>=2.1.273`；发布门禁同时覆盖最低兼容版本与当前发布验收版本。
