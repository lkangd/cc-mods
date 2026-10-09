# 定稿兼容与验收契约

Type: grilling
Status: resolved
Blocked by: 04, 05, 11

## Question

chat-toc MVP 的验收契约是什么：支持矩阵（`>=2.1.287` 终端全屏布局、操作系统不限的表述与实测样本）、必须通过的 MUST 场景（自动弹出与关闭、停靠阈值与状态栏说明、三态过滤与记忆、User input 与 Agent reply 的跳转、Current position 高亮与 TOC 跟随、`/clear` 后重建、compact/rewind/resume 后与 transcript 文件对话链的一致性、长会话与超过 4 MiB 的 transcript 分块读取、新会话在第一条消息前 transcript 文件还不存在时的空状态）、PTY 验收方式，另需覆盖「原型验证停靠 TOC Pane 的外观与交互」实测出的场景：三种 Layout 的切换与记忆、跳转后锁定高亮、本地命令（`system/local_command` 行）开组与兜底跳转、虚拟化 transcript 下跳到从没画出过的行、行被卸掉后残留的在屏值不误导高亮、热重载后映射重建、跳转被拒后淡化与底部说明；以及预先声明不承诺的宿主限制（如 transcript 文件格式未公开、Windows 分块读取只能在 Windows 上验收）。

## Answer

**结论：采用「单一支持矩阵、分层证据、所有 MUST 场景零缺失零跳过」作为发布门禁。承诺与实测分开：承诺对操作系统不设限，发布门禁只在本机 macOS 上跑最低版本和当前版本。** 2026-10-09 与使用者两轮逐条确认。

### 1. 规范等级

- **MUST**：发布阻断条件。任一场景失败、缺失、跳过或没有可追溯证据，都不能发布。
- **明确降级**：宿主不给某项能力时必须存在的替代路径。替代路径本身也是 MUST。
- **不承诺**：必须事先写进 README 或界面提示，不能等验收失败后再改列。
- 场景用稳定 ID，格式为 `CT-<组>-NNN`。

### 2. 支持矩阵

- **承诺**：Claude Code `>=2.1.287`、交互式终端、全屏布局，操作系统不限。`--plugin-dir` 和 marketplace 两种加载方式都支持。
- **发布门禁**：每次发布在本机 macOS 上分别用最低版本 2.1.287 和当时的当前版本跑一遍，所有 MUST 都要通过。marketplace 安装只跑冒烟（`CT-COMPAT-002`），完整场景用 `--plugin-dir`。报告记录 OS 和架构，只作为样本。
- Linux 与 Windows 的分块读取（`tail`/`head`、Windows PowerShell 5.1）：自动化测试只用 `$.process.run` 替身核对命令构造与输出解析，不在真实系统上验收。
- 插件清单没有声明宿主最低版本的字段（`plugin.json` 的 `version` 不做校验）。低于 2.1.287 时插件多半根本不会加载，所以不做运行时版本检测，只在 README 写明。

### 3. 分层证据

1. **自动化测试**：用 `claude plugin test` 和 `claude-code/testing` test kit 触发事件、给宿主调用打桩、检查绘制结果；纯函数用同一套件的普通 `test()`。只要求在当前版本上通过。覆盖范围：开组规则、对话链取行、步数与末段、`requestId` 到行的四级匹配、Current position 的连续段算法、兜底跳转的候选顺序、分块边界（包括跨 4 MiB 块的半行）、`$.store` 记忆。
2. **真实宿主 PTY 验收**：用 cmux 驱动。覆盖弹出与关闭、停靠阈值与状态栏、点击和 Enter 跳转、高亮锁定、`/clear`、compact、rewind、resume、fork、热重载。
3. **人工目检**：只看三种 Layout 的观感，以及青色高亮和反色光标能否分清。在报告里签字，**不是 MUST**。

一致性判据统一用**独立 verifier**：它直接沿 transcript 文件的对话链算出期望的 Turn group 序列，再与 Pane 实际列出的条目比对。

### 4. MUST 场景

**兼容与加载**
- `CT-COMPAT-001`：在两个版本上用 `--plugin-dir` 冷启动全屏会话。Pane 自动停靠在右侧，validate 0 错误。
- `CT-COMPAT-002`：marketplace 安装后冒烟。Pane 自动弹出，点击一次用户侧并跳转成功。
- `CT-COMPAT-003`：非全屏布局或终端宽度不足以停靠时，不出现 inline 放置；状态栏常驻说明原因和满足条件的方法。条件满足后 Pane 自动出现，说明消失。阈值由宿主决定，测试只在 `isPlaced` 翻转的两侧取样，不写死列数。

**数据源与降级**
- `CT-DATA-001`：文件还不存在（新会话、第一条消息之前）时，Pane 正文只有一行「本会话还没有对话」。第一条 User input 落盘后出现条目。
- `CT-DATA-002`：文件读失败或没有权限时不显示任何条目，底部常驻原因，不用 `$.session.messages()` 拼一份冒充完整的目录。
- `CT-DATA-003`：遇到无法识别的行就跳过，底部说明「有 N 行无法识别，目录可能不完整」，N 是实际计数。
- `CT-DATA-004`：超过 4 MiB 的 transcript 分块读取，结果与整份读取一致，包括半行跨块边界的情况；会话继续时只增量读取新块。
- `CT-DATA-005`：子 agent（sidechain）的内容不进 TOC；一个子 agent 只算 1 步。
- `CT-DATA-006`：两个终端里同一项目的两个会话，各自只显示自己的 transcript。

**Turn group 内容**
- `CT-TURN-001`：普通 prompt、斜杠命令（user 行和 `system/local_command` 行两种形态）、`!cmd` 都开组；通知、命令输出、中断、注入提醒都不开组。
- `CT-TURN-002`：至少三个完全相同的 prompt 各自成组。
- `CT-TURN-003`：多行、CJK、emoji 按终端 cell 宽度截到 2 行并加省略号；去掉 `<pasted_content>` 标签。
- `CT-TURN-004`：Agent reply 有三种形态：「N 步」加末段 2 行；「进行中 · N 步」，步数实时增加；「N 步 · 无文字回复」。中断或出错的轮按文件实际内容显示。
- `CT-TURN-005`：时间取自 transcript 行的时间戳；去掉时间戳的 fixture 不显示时间，也不伪造。

**生命周期与分支**（判据都是 verifier 比对 transcript 对话链）
- `CT-LIFE-001`：Pane 自动弹出；点 ✕ 后本会话保持关闭；`/chat-toc` 重新打开；新进程再次自动弹出。
- `CT-LIFE-002`：`/clear` 后目录随新会话重建，不画分隔线；「已关闭」标记被重置，Pane 再次弹出。
- `CT-LIFE-003`：`/compact` 后，compact 之前的条目照常显示。
- `CT-LIFE-004`：rewind（包括 Esc Esc）之后的下一次提交，被弃分支的条目消失。
- `CT-LIFE-005`：`--resume`、`--continue`、会话内 `/resume`、`--fork-session` 之后，目录与该会话文件的对话链一致。
- `CT-LIFE-006`：热重载（`/reload-plugins`）后，映射在读完 transcript 之后重建，跳转与高亮仍然正确。

**过滤、布局与键盘**
- `CT-UI-001`：三态 View filter 切换后立即重画，选择跨进程记住。
- `CT-UI-002`：三种 Layout 通过正式入口切换（入口引用「决定 Layout 的切换入口与默认值」），选择跨进程记住；只改变绘制，不改变显示哪些条目。
- `CT-UI-003`：Pane 聚焦时 ↑↓ 选择、Enter 跳转；↑↓ 不跳过淡化的条目；选择光标与高亮分别绘制。

**跳转与 Current position**
- `CT-JUMP-001`：点击用户侧跳到该 prompt，点击 Agent 侧跳到末段文字，包括从没画出过的行（例如 resume 300 轮后跳到第 1 轮）。
- `CT-JUMP-002`：本地命令、prompt 型命令、`!cmd` 用兜底跳转：先往后、再往前找最近的可绘制行，用 `center`；被拒就换下一个候选，最多 3 个。
- `CT-JUMP-003`：候选全部被拒时（resume 前已 compact 的行、rewind 残留），只淡化这一侧并在底部说明，没有其他副作用；行重新被宿主列出后恢复。
- `CT-POS-001`：跳转后高亮锁定在目标组，视口下一次变化时解锁，之后取视口顶部所属的组；最后一个画出的行完整可见时强制末组。
- `CT-POS-002`：行被卸掉后残留的在屏值不误导高亮。连续滚轮 180 格后，高亮与屏幕第 1 行所属的组一致。
- `CT-POS-003`：TOC 跟随 Current position 滚动；手动滚动 TOC 或 Pane 聚焦时暂停，底栏显示「暂停」；Current position 下一次变化时恢复跟随。

**性能**
- `CT-PERF-001`：20 MB 级 transcript 的首次出目录、增量读取和重画，p95 都不超过阈值；长会话连续滚动能到达首尾，不分页。阈值引用「实测长会话的读取与渲染开销」。

**隐私**
- `CT-SEC-001`：用合成的唯一标记 prompt 跑一遍，标记只出现在 Pane 的绘制里，不得出现在 `$.store`、插件数据目录、日志、错误文本或发布报告中。`$.store` 只存 View filter 和 Layout。

**共存**
- `CT-COEX-001`：与 `cc-plugin-diff` 同时打开 Pane 时，按「决定与其他停靠 Pane 共存的行为」的结论执行。

### 5. 不承诺（写进 README）

- Claude Code `<2.1.287`：不检测、不提示。也不承诺 Desktop、IDE、移动端，以及非全屏布局下的 inline 放置。
- Linux 与 Windows 只经过命令构造测试，未在真实系统上验收；Windows 只用 Windows PowerShell 5.1。
- transcript 文件格式未公开，宿主改格式后 TOC 可能显示不全，由 `CT-DATA-003` 提示。
- 不保证能跳到 rewind 被弃的分支，也不保证能跳到 resume 前已被 compact 的行。
- rewind 之后、下一次提交之前，目录可能仍显示被弃的条目：宿主没有 rewind 事件，文件也还没有变化。使用者确认接受这个窗口。
- 人工目检项（Layout 观感、颜色能否分清）不是发布阻断。
- 不对所有硬件承诺固定的延迟 SLA；`CT-PERF` 的阈值只是在参考机器上采集的发布证据。

### 6. 发布报告

- 字段：插件版本、Claude Code 版本、OS、架构、fixture、场景 ID、预期、实际、结果、证据链接。
- 位置：`mods/chat-toc/tests/evidence/<插件版本>/`，提交进仓库。
- 只用合成 prompt，不含真实会话内容。
- 不从 prompt-history 抽公共库，需要的部分各写一份。

### 升格的迷雾

「长会话的渲染与性能」「Layout 切换入口」「与其他停靠 Pane 共存」三片迷雾各升格为一张票。本契约只为它们预留场景 ID，阈值和具体行为引用这三张票的结论。
