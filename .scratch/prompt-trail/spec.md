# Prompt Trail MVP

Status: ready-for-agent

## Problem Statement

Claude Code 终端使用者在长对话中无法获得一条只包含人类输入、可连续浏览并可返回原位置的持久时间线。重复或多行 prompt、`/clear`、compaction、plugin reload、进程重启、resume、fork 与 rewind 会进一步削弱方向感；原生 transcript 位置又不是可永久保存的身份。

使用者同时要求完整 prompt 文本永久保存在本机，因此该功能会处理可能包含凭据和机密的高敏感数据。它不能把安装视为同意，不能静默漏记、猜测分支、伪造完整性，也不能在删除时暗示 Claude Code transcript、系统快照或备份已经一并清除。

Claude Code `2.1.273` 的 early-access function-hooks 环境没有 Node、DOM 或可承担永久档案的内建存储；`$.store` 和 `$.fs` 均受 4 MiB 与整文件语义限制。function hook 也拿不到插件路径变量，部分焦点、滚动和 UI 槽位行为由宿主保留。因此 MVP 必须在这些边界内提供明确、可验收的行为和失败路径，而不是依赖未声明的宿主实现。

## Solution

Prompt Trail 将作为多-mod 仓库中位于 `mods/prompt-trail/` 的独立本地插件交付，仅面向 Claude Code `>=2.1.273` 交互式终端。它在每个 Project Timeline 获得 Collection consent 后，通过 function hook 捕获成功进入会话的 composer submission，把完整最终文本写入该项目独立的 SQLite 档案，并把 Run、Conversation Segment、Conversation Branch、Clear Boundary、Collection Boundary 与 Integrity gap 建模为不可变 Timeline Events。

插件默认只在 composer 上方显示一行折叠标题。展开后，它按旧到新连续显示 Project Timeline，以有界窗口按需读取长历史，保留重复项和失效条目；当前 transcript 中仍有效的 Prompt Entry 获得内存态 Jump Target，可通过键盘或鼠标返回原位置。无法唯一重建分支时，本次提交被阻止，使用者选择父节点后草稿被恢复但不会自动重提。

持久化由随插件分发的受信任 macOS arm64 helper 完成。经典 command hook 负责把插件路径和数据路径发布为受校验的 session locator，function hook 再通过 `$.process.run` 以 stdin 调用 helper。档案采用事务、WAL、幂等事件、项目级单调 sequence、明确迁移与物理删除流程；任何无法证明正确采集的普通故障都失败关闭，宿主级 fail-open 则留下显著且不可抹除的 Integrity gap。

MVP 只承诺 macOS 15.x arm64、Claude Code `>=2.1.273`、进程级启用 early-access function hooks，以及从独立插件根 `--plugin-dir mods/prompt-trail` 加载。不支持的环境在 consent 或建档前失败，并保持 `status` 与必要诊断可用。

## User Stories

1. 作为受支持平台上的 Claude Code 终端使用者，我希望插件先完成兼容性与健康探针，以便只在能够兑现持久化承诺时启用采集。
2. 作为不在支持矩阵中的使用者，我希望看到明确的 unsupported 状态且不被请求授权，以便插件不在未经验证的环境中创建档案。
3. 作为首次使用某个 Project Timeline 的使用者，我希望在保存任何 Prompt Entry 前明确选择是否授予 Collection consent，以便安装或加载插件不会被误当作授权。
4. 作为隐私敏感的使用者，我希望 consent 告知完整文本、明文本地存储、永久且无应用配额、凭据风险、数据位置和删除边界，以便我能作出知情选择。
5. 作为在多个仓库或 worktree 中工作的使用者，我希望每个规范项目根分别授权，以便一个项目的选择不会扩散到另一个 Project Timeline。
6. 作为已授权项目的使用者，我希望在采集范围、位置、保留期、安全或删除保证实质变化时重新授权，以便旧同意不会覆盖新政策。
7. 作为当前 Run 的使用者，我希望用 `/prompt-history enable` 开启本 Run 的 Run collection mode，以便项目授权与单次进程选择彼此独立。
8. 作为当前 Run 的使用者，我希望用 `/prompt-history disable` 停止后续采集但保留旧档案，以便我能继续使用 Claude Code 而不补录禁用区间。
9. 作为使用者，我希望 `/prompt-history status` 显示 consent、Run collection mode、档案健康、历史 Gap、运行时项目路径、数据库路径和大小，以便我能理解当前状态而不会看到 prompt 原文。
10. 作为隐私敏感的使用者，我希望 Prompt Trail 不联网、不远程同步、不输出 prompt 日志，以便完整文本只停留在声明的本地边界内。
11. 作为已启用采集的使用者，我希望每个成功的 composer submission 恰好形成一个 Prompt Entry，以便时间线既不漏记也不重复。
12. 作为与其他 hook 共存的使用者，我希望保存 hook 链最终送入会话的文本，以便档案反映 Claude Code 实际收到的 prompt。
13. 作为重复输入相同 prompt 的使用者，我希望每次提交保持独立，以便我能返回每一次真实对话位置。
14. 作为提交多行 prompt 的使用者，我希望完整原文逐字持久化，以便单行 UI 截断不会破坏档案内容。
15. 作为提交带附件 prompt 的使用者，我希望只保存附件数量和宽泛类型，以便时间线可表达提交形态而不复制附件内容、名称、路径或哈希。
16. 作为提交纯附件消息的使用者，我希望它仍形成无文本 Prompt Entry，以便人类输入集合保持完整。
17. 作为运行 slash 或 Prompt Trail 控制命令的使用者，我希望没有 composer submission 的命令不生成 Prompt Entry，以便控制流量不会污染时间线。
18. 作为使用后台 agent、task notification 或 peer 消息的使用者，我希望内部 `user` 流量不生成 Prompt Entry，以便 Prompt Trail 只代表人类 composer 输入。
19. 作为 prompt 被下游 hook drop 的使用者，我希望它不进入档案，以便 Prompt Entry 只代表成功进入会话的提交。
20. 作为在提交期间遇到中断的使用者，我希望 Pending Capture 被持久保存并显式对账，以便插件不会猜测 prompt 是否已经进入会话。
21. 作为面对歧义 Pending Capture 的使用者，我希望选择“已进入 / 未进入 / 新根分支”，以便恢复结果由可见事实或人工决策确定。
22. 作为普通终端使用者，我希望 Prompt Trail 默认折叠为一行，以便它不抢占对话空间。
23. 作为想查看历史的使用者，我希望点击标题或运行 `/prompt-history` 展开或折叠，以便不依赖宿主未提供的自动焦点。
24. 作为浏览者，我希望 Timeline Events 按项目级 sequence 从旧到新显示，以便时间戳偏差不会改变发生顺序。
25. 作为跨多个 Run 浏览的使用者，我希望 Run 开始、续接、离开和未记录的离开可见，以便我能理解进程何时接入与离开一条会话谱系。
26. 作为执行 `/clear` 的使用者，我希望时间线显示恰好一个 Clear Boundary，以便清空前后的 Conversation Segment 明确分隔。
27. 作为启用、禁用或恢复采集的使用者，我希望看到 Collection Boundary，以便禁用区间不会被误认为完整历史。
28. 作为使用 rewind 或 fork 的使用者，我希望旧后续和新 Conversation Branch 都保留，以便回退不会删除历史。
29. 作为经历宿主级采集失效的使用者，我希望看到 Integrity gap 及其恢复边界，以便恢复健康不会改写历史完整性。
30. 作为拥有 100,000 个 Timeline Events 的使用者，我希望无页码地连续浏览，以便档案规模不会迫使我切换分页心智模型。
31. 作为向更早历史移动的使用者，我希望最早可见项取得焦点时自动加载前一批，以便方向键可以连续跨越批次。
32. 作为停留在时间线底部的使用者，我希望新 Prompt Entry 自动跟随，以便当前对话始终可见。
33. 作为正在查看旧历史的使用者，我希望新条目不改变当前位置并显示累计提示，以便实时更新不会打断阅读。
34. 作为使用窄终端的使用者，我希望低于 28 列或 6 行时得到明确的空间不足降级，以便内容不会破碎或挤占 composer。
35. 作为调整终端尺寸的使用者，我希望尺寸恢复后展开状态、选择项、旧位置和新条目计数保持不变，以便临时窄屏不丢失上下文。
36. 作为输入 CJK、emoji、组合字符或多行文本的使用者，我希望 UI 按终端 cell 宽度压平并截断为一行，以便条目不会错误换行。
37. 作为键盘使用者，我希望用方向键选择并用 Enter 激活，以便没有滚轮也能遍历完整时间线。
38. 作为鼠标使用者，我希望 hover 和点击条目，以便我能直接选择和跳转。
39. 作为当前 transcript 仍保留目标的使用者，我希望激活 Prompt Entry 后跳转、折叠并把焦点还给 composer，以便迅速回到对话位置。
40. 作为查看旧档案的使用者，我希望无效 Jump Target 保留并显示 `×`，以便不可跳转不等于历史被删除。
41. 作为宿主未发送 `ui.scroll` 的使用者，我希望方向键和点击仍能到达首尾，以便触控板或滚轮不是唯一导航路径。
42. 作为展开时间线的使用者，我希望界面提示 `ctrl+x tab` 或鼠标取得焦点，以便插件不虚假承诺自动聚焦。
43. 作为触发 AskUserQuestion 的使用者，我希望 Prompt Trail 在工具交互期间让出 AbovePrompt 并在结束后恢复，以便两个界面不会争抢同一槽位。
44. 作为执行 `/clear` 的使用者，我希望 Run 保持不变而新 Conversation Segment 切断父链，以便清空语义和进程语义不混淆。
45. 作为执行 `/compact` 的使用者，我希望不创建 Clear Boundary、新 Run 或 Prompt Entry，以便压缩不会伪装成清空。
46. 作为执行 `/reload-plugins` 的使用者，我希望 Run、档案、展开状态和选择位置延续且 render 重放不重复归档，以便开发期 reload 安全。
47. 作为退出并重启 Claude Code 的使用者，我希望旧 Project Timeline 延续，普通启动获得新 Run、resume 续接原 Run，以便历史持久且 Run 与会话谱系一致。
48. 作为 resume 会话的使用者，我希望续接原 Run、以唯一共享前缀续接原 Conversation Branch 且不重复 Prompt Entry，并让 resume 节点之后不在活动路径上的条目折叠为可展开的另一分支，以便时间线与会话详情一致且不丢历史。
49. 作为使用后台 `/fork` 或 `--fork-session` 的使用者，我希望新进程建立新 Run 和 Conversation Branch，以便共享前缀与新提交都被正确表示。
50. 作为通过 `/rewind` 或 Esc Esc 恢复旧位置的使用者，我希望下一次提交建立新分支，以便旧分支仍可查看。
51. 作为父节点无法唯一匹配的使用者，我希望本次提交被阻止并在聚焦 Pane 中选择候选或新根，以便插件不猜测分支。
52. 作为同一项目同时运行两个 Claude Code 进程的使用者，我希望每个 Run 有独立 Active Branch 且共享单调项目 sequence，以便并发历史具有确定顺序。
53. 作为长期使用者，我希望档案永久且无应用配额保存，直到我明确删除或底层存储不可用，以便 Prompt Trail 不自动轮转、截断或淘汰历史。
54. 作为在多个项目中工作的使用者，我希望每个 Project Timeline 使用独立数据库，以便一个项目的损坏、迁移或删除不影响另一个。
55. 作为 Git worktree 使用者，我希望不同 worktree 得到不同 Project Timeline，以便并行工作树不会混入同一档案。
56. 作为磁盘空间不足的使用者，我希望可用空间低于 1 GiB 时每个 Run 只警告一次，以便我能提前处理而不被持续打扰。
57. 作为遇到 SQLite busy 的使用者，我希望插件最多有界等待 10 秒后明确失败，以便提交不会无限挂起。
58. 作为档案无法证明可写的使用者，我希望 composer submission 被阻止且草稿保留，以便 Claude Code 对话不会领先于承诺的档案。
59. 作为遇到 Archive unavailable 的使用者，我希望能够重试，以便临时故障恢复后继续同一 Run。
60. 作为无法立即修复档案的使用者，我希望明确禁用当前 Run 后继续 Claude Code，以便放弃后续采集是知情选择而非静默降级。
61. 作为经历 plugin 崩溃或不可阻止 lifecycle 失效的使用者，我希望无法唯一恢复的区间形成 Integrity gap，以便宿主 fail-open 不会伪装成完整时间线。
62. 作为 Gap 后恢复的使用者，我希望当前健康可以回到 healthy 但历史 Gap 永久保留，以便未来浏览者仍知道完整性边界。
63. 作为遇到数据库损坏的使用者，我希望原文件保持不变并可选择重试检查、Quarantined Archive 后新 generation 或强确认清除，以便自动修复不会扩大损失。
64. 作为插件升级后的使用者，我希望只执行已知单向迁移并保留私有备份直到复检成功，以便 schema 变化可恢复。
65. 作为 helper 被移除、替换或协议不匹配的使用者，我希望当前 Run 停止采集而不热切换未知制品，以便 Run 的持久化实现保持固定。
66. 作为受企业策略或 macOS 安全策略阻止执行的使用者，我希望看到明确错误而插件不修改 xattr、权限或系统策略，以便安全边界不被自动绕过。
67. 作为只想删除当前 Run 的使用者，我希望 `clear-run` 展示范围并确认后物理删除相关原文和 Pending Captures，以便其他 Run 保持不变。
68. 作为想清空当前项目的使用者，我希望 `clear-all` 要求固定确认短语并原子切换 Archive generation，以便并发 writer 不能复活已删除记录。
69. 作为删除范围为空的使用者，我希望命令返回 no-op 而不询问，以便无效操作不制造确认噪音。
70. 作为删除后仍有 WAL、备份或残留文件的使用者，我希望看到“逻辑删除完成、物理清除未完成”并保持 Archive unavailable，以便部分成功不会被描述为彻底清除。
71. 作为执行删除的使用者，我希望再次看到 Claude Code transcript、快照、备份和 SSD 介质边界，以便我不会误判删除保证。
72. 作为隐私敏感的使用者，我希望 prompt 原文只经 stdin 进入 helper、只经专用时间线读取响应回到 hook 用于显示，且不进入 argv、locator、错误、stderr、其他子命令的 stdout、debug log、trace 或报告，以便操作元数据不会泄露内容。
73. 作为本机账户使用者，我希望数据目录为 `0700`、敏感文件为 `0600` 且异常 owner、symlink 或 ACL 被拒绝，以便其他 OS 用户和意外权限放宽不能直接暴露档案。
74. 作为准备移除本地插件目录的使用者，我希望先被告知数据不会随 `--plugin-dir` 自动卸载，以便我能在失去命令入口前清理档案。
75. 作为发布维护者，我希望每个需求都有稳定场景 ID 和可审计证据，以便所有 MUST 行为可以零缺失、零跳过地判定。
76. 作为发布维护者，我希望原型中已证伪的自动聚焦、Esc 折叠、触控板滚动和通用槽位仲裁明确列为不承诺，以便已知宿主限制不会在失败后才降级。
77. 作为使用者，我希望失败状态下 `status` 与必要诊断仍可用，以便我能修复问题而不需要读取数据库或 prompt 原文。
78. 作为维护者，我希望插件不依赖 React、Ink 或其他第三方运行时库，以便本地 `--plugin-dir` 制品保持可审计且符合 hook sandbox。
79. 作为维护者，我希望 helper 的目标、最低系统、依赖、协议、schema 范围和摘要可静态验证，以便发布制品不是构建机默认值的偶然产物。
80. 作为维护者，我希望 100,000-event 基准、隐私标记扫描和故障注入纳入发布报告，以便规模、安全和恢复承诺均有重复可查的证据。

## Implementation Decisions

1. **兼容面与交付单元**
   - `cc-mods` 是多-mod 容器；生产插件的 function-hook 模块、经典 lifecycle command-hook 桥、预构建原生 helper、制品 manifest、构建检查器、版本固定声明和验收工具全部位于独立插件根 `mods/prompt-trail/`。仓库根不得包含代表 Prompt Trail 的 `.claude-plugin` manifest。
   - 唯一支持目标是 macOS 15.x 原生 arm64、Claude Code `>=2.1.273` 交互式终端、进程级 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 和可信本地 `--plugin-dir`；版本按三段数字比较，低于最低版本或无法证明版本时失败关闭。
   - function-hook 模块使用 TypeScript/TSX 与宿主 JSX；它不得使用 Node、DOM、React、Ink、终端转义序列或第三方运行时依赖。
   - helper 是 thin arm64 Mach-O，deployment target 固定为 macOS 15.0，动态链接系统 `/usr/lib/libsqlite3.dylib`；安装与首次运行不要求编译器。
   - Linux、Windows、WSL、Intel、Rosetta、其他 macOS 主版本、Claude Code `<2.1.273`、无法证明宿主版本和非终端 surface 直接进入 unsupported，不做 best-effort fallback。

2. **领域模型**
   - Project Timeline 是一个规范项目根对应的永久时间线；不同 worktree、移动后的项目路径和不同规范根彼此隔离。
   - Archive generation 是最近一次 `clear-all` 建立的档案世代；旧 generation 的 writer 不能向新 generation 写入或复活记录。
   - Timeline Event 是不可变事件，以随机 `event_id` 幂等，并在事务中取得项目级单调 `sequence`；时间戳只用于展示。
   - Run 是一条会话谱系：普通启动创建新 Run，经 `/clear` 与 module reload 延续；`claude --resume`、`--continue` 与会话内 `/resume` 按 classic session id 找回所属 Run 并续接（档案中无该会话时新建）；后台 `/fork` 与 `--fork-session` 创建新 Run。进程只是接入或离开 Run，同一 Run 同一时刻至多一个存活进程接入；并发 resume 同一会话的后到进程新建 Run 并记录来源 Run。（2026-09-23 Issue 32 修订。）
   - Conversation Segment 是一个 Run 内由启动或 Clear Boundary 划分的连续区间。
   - Conversation Branch 以 Prompt Entry 的逻辑父关系表达；每个并发 Run 独立维护 Active Branch。
   - Prompt Entry 保存完整最终文本、项目/Run/Segment/Branch 身份、sequence、event ID、逻辑父 Prompt Entry、提交时间、捕获来源，以及附件数量和宽泛类型。相同文本不得合并。
   - Jump Target 是 Prompt Entry 到当前已渲染 transcript 位置的临时内存绑定；`requestId` 不进入长期档案。
   - Pending Capture 是已持久预写但尚未确认进入会话的 composer submission；它不是 Prompt Entry。
   - Clear Boundary、Collection Boundary、Run boundary、branch boundary、Integrity gap 与 Integrity recovery boundary 都是非 prompt Timeline Events。
   - 物理 SQLite schema、表名和列布局保持内部；helper 的语义协议而非数据库布局构成测试与兼容边界。

3. **项目身份与数据位置**
   - 项目身份从 Claude Code 启动时的实际工作目录推导；Git 项目从该目录执行 `git rev-parse --show-toplevel`，非 Git 项目使用启动目录，再由 helper 以 `realpath` 规范化。
   - 不使用会把 worktree 指回主工作树的仓库 root API。
   - 只持久保存规范项目根的稳定 hash；绝对路径只来自当前 Run，并仅在 `status` 中显示。
   - 每个 Project Timeline 在 plugin data 下使用独立 SQLite 数据库；prompt 数据不写入项目目录或 plugin root。
   - `$.store` 只保存小型、无 prompt 的 consent policy 版本、Run bootstrap、UI 状态和 lifecycle 恢复队列；不得承担档案或无界索引。

4. **Collection consent 与 Run collection mode**
   - 首次 composer submission 前先执行不建项目数据库的只读 preflight，再让使用者选择“启用”或“继续但不启用”。
   - consent 告知必须覆盖完整文本、明文、永久无应用配额、凭据风险、路径、同账户/root 信任边界，以及 Prompt Trail 删除不覆盖的副本。
   - Collection consent 按 Project Timeline 与 policy version 保存；普通升级不重复询问，实质政策变化暂停采集并重新授权。
   - `enable`/`disable` 只改变当前 Run，并随 Run 谱系延续：resume 回来保持原 mode。disable 不删除、不影响其他 Run、不补录；重新 enable 前先解决 Pending Capture，再写 Collection Boundary 并从新根 Conversation Branch 开始。
   - `clear-all` 不撤销 Collection consent，也不改变当前 Run collection mode。

5. **经典 command-hook locator 桥**
   - 只有经典 SessionStart command hook 使用官方插件 root/data 占位符；function hook 不依赖 `import.meta.url` 或未声明环境变量定位制品。
   - bridge 在私有、session 隔离的位置原子发布 locator，文件名同时带 session 与宿主进程世代（`<session>.<pid>-<启动秒>-<启动微秒>.json`），并发 resume 同一会话的两个进程各有自己的 locator；helper 只接受按自身宿主进程世代命名的那一个。bridge 另在 plugin data 下维护只含 session、Run 与 Archive generation 的私有会话索引，resume 据此找回 Run。（2026-09-23 Issue 32 修订。）locator 至少绑定 helper 规范路径、数据库根、helper SHA-256、plugin/helper protocol、session、宿主进程世代、Run 和 Archive generation，且不含 prompt。
   - 每次 helper 调用前校验 locator schema、session/世代、owner、权限、对象类型、规范路径、目录归属和摘要；任一不符均拒绝执行。
   - helper 只通过无 shell argv 启动，prompt 原文只放 stdin。路径与错误类别可进入诊断，原文及文本哈希不可进入诊断。
   - 正常结束删除当前 session locator；只在能证明格式、owner、世代和对应进程已终止时清理陈旧 locator。

6. **Run 身份、进程接入与 reload**
   - Run 以随机 Run UUID 标识；进程对 Run 的接入由实际宿主进程世代确定，而不是 module instance 或单独环境变量。resume 以 classic session id 找回 Run，session id 本身不充当 Run。
   - 同进程 reload 只有在进程世代一致时延续当前接入；继承环境的 fork 子进程因实际世代不同而不能沿用父进程的接入。
   - 一次进程接入固定使用启动 locator 中的 helper 路径、摘要和 protocol。reload 只在这些值不变时延续；变化要求恢复原制品或新的进程接入。同一 Run 的不同接入可以使用不同制品。
   - Run 边界：`run-started` 只在 Run 首次创建时写；`run-attached` 在进程 resume 接入已有 Run 时写；`run-detached` 在进程退出或 `/resume` 去往别的 Run 时写。会话内 `/resume` 到另一 Run 的会话时，进程改绑到该 Run。
   - 异常退出允许接入保持未闭合；下次读取显示「未记录离开」，不伪造离开。（2026-09-23 Issue 32 修订。）

7. **composer 捕获协议**
   - 只有 `prompt.submit` 且 `origin.kind === "composer"` 有资格产生 Prompt Entry；classic `UserPromptSubmit`、transcript `user` row 和 `ui.render` 都不能决定成员资格。
   - 在启用且健康的 Run 中，先完成 lifecycle 恢复队列、Pending Capture 与 Active Branch 对账，再为本次提交持久预写 Pending Capture。
   - 调用 `next(e)` 后，若结果为 `drop`，幂等丢弃 pending；若成功进入会话，以结果中的最终文本原子确认 Prompt Entry。
   - Pending Capture 预写失败时 drop 本次提交并原样保留 composer 草稿；后置确认失败时保留 pending、阻止该 Run 后续 composer submission 并进入显式对账。
   - 自动对账只在 transcript 能唯一证明结果时确认或丢弃；否则由使用者选择“已进入 / 未进入 / 新根分支”。
   - disabled Run 直接让 composer submission 继续，不创建 pending 或 Prompt Entry。
   - slash 文本不做特殊前缀过滤；是否采集只取决于是否出现成功的 composer-origin submission。

8. **transcript 对齐、分支与 Jump Target**
   - `$.session.messages()` 只用于活动路径、父节点和恢复对账，不用于判定 Prompt Entry 成员资格；实现必须处理其最多返回最新 4096 条且含内部 `user` row 的限制。
   - `ui.render(UserMessage)` 只对非 placeholder、可识别为人类 composer 的当前活动路径按有序前缀绑定 Jump Target；render 重放不创建档案事件。
   - 重复文本通过完整有序前缀、已归档 Active Branch 和事件身份区分，不能只按文本或最后一项匹配。
   - resume 在共享前缀唯一时续接；后台 fork 与 CLI fork 创建新 Run/Branch；rewind 或 Esc Esc 的恢复在下一次 composer submission 前从 transcript 差异发现。
   - 无法唯一确定父节点时，本次提交立即 drop，完整草稿仅留内存，打开 `focus: true` 的候选 Pane。选择后先关闭 Pane，再用 `$.prompt.fill()` 恢复草稿，绝不自动重提。
   - 普通新 Run 中未重放的旧 Prompt Entry 没有 Jump Target；resume/fork 只为当前重放且唯一对齐的共享前缀重新绑定。

9. **生命周期事件**
   - 仅 `classic.SessionEnd(reason=clear)` 原子写入一个 Clear Boundary、结束当前 Conversation Segment 并切断 Prompt Entry 父链；幂等键由旧 classic session id 派生。
   - `classic.SessionStart(source=clear)` 只把新 classic session id 关联到已存在的边界和新 Segment，不写第二个边界。
   - `source=compact`、Pre/PostCompact、function-hook `session.start`、plugin reload、`ui.render` 重放和非 clear SessionEnd 都不得创建 Clear Boundary。
   - 正常 SessionEnd 写进程离开 Run（`run-detached`）；进程内 `/resume` 只在新会话属于另一个 Run 时补写原 Run 的离开，回到同一 Run 则什么都不写（2026-09-23 Issue 32 修订。）。无法阻止的 lifecycle 事件写入失败时，使用不含原文的小型 `$.store` 恢复队列和幂等 ID，在下一次 composer submission 前清空。
   - 无法唯一恢复 lifecycle 事实时创建 Integrity gap，不猜测或静默忽略。

10. **SQLite helper 与档案协议**
    - helper 提供 schema-opaque 的语义操作：只读 preflight/health、创建或打开 generation、预写/确认/丢弃 Pending Capture、追加幂等 Timeline Event、有界范围读取、Run/Branch 对账、状态统计、迁移、完整性检查、隔离、`clear-run` 和 `clear-all`。
    - 写入使用短事务、WAL、`synchronous=FULL`、项目行上的单调 sequence 和唯一 event ID；同一项目多个 Run 共享 sequence。
    - busy 使用有界退避，总自动等待不超过 10 秒；不得无限后台重试。
    - range read 严格按 sequence 排序，并强制固定最大批次。调用者不能通过协议请求无界全表读取。
    - 不设置应用配额、不轮转、不截断、不自动删除；低于 1 GiB 每个 Run 警告一次，`ENOSPC` 完整回滚。
    - helper 启动时核对实际 SQLite 版本和必需能力；若保留 `UPDATE … RETURNING`，最低 SQLite 为 3.35.0。
    - helper 以 `umask 077` 工作，持续复核目录 `0700` 和敏感文件 `0600`。

11. **时间线 UI**
    - `AbovePrompt` 默认只绘制一行 `Prompt Trail` 标题；标题点击和裸 `/prompt-history` 切换展开。
    - 展开列表按 sequence 旧到新绘制 Prompt Entry 与边界。Prompt Entry 把换行显示为 `↵`，再按 cell 宽度截断并直接加省略号；每项始终一行。
    - 使用有界读取与有界渲染窗口；窗口前保留一条 overscan。最早可见 Prompt Entry 取得焦点时加载上一批并保留同一个 keyed Button，使方向键连续跨批次。
    - 位于底部时跟随新增 Prompt Entry；离开底部时固定位置并累计新条目提示。
    - 有效 Prompt Entry 显示 `↵`，激活后调用 Jump Target、折叠并回到 composer；无效项显示 `×`，激活无副作用且不折叠。
    - 方向键、Enter、鼠标 hover/点击是 MUST。触控板/滚轮不是支持路径；PageUp/PageDown/Home/End 只有真实终端验收通过后才可写入承诺。
    - 展开不调用或承诺自动焦点；显示 `ctrl+x tab`/鼠标提示。Esc 只退出焦点，不承诺自动折叠。
    - 低于 28 列或 6 行时只显示折叠控制与空间不足提示；恢复尺寸后保留展开、选择、位置和未读计数。
    - `tool.call(AskUserQuestion)` 的整个 `next(e)` 生命周期内让出 AbovePrompt，结束后恢复状态；不实现第三方插件通用槽位仲裁。

12. **控制命令**
    - 命令面为 `/prompt-history`、`enable`、`disable`、`status`、`clear-run` 和 `clear-all`。
    - 裸命令只切换展开；控制命令本身不创建 Prompt Entry。
    - `status` 在 unsupported、Helper unavailable、Archive unavailable、损坏和物理清除未完成时仍可运行，且从不显示 prompt。
    - 有数据的 `clear-run` 显示当前 Run、记录数和副本边界并要求一次确认；无数据时 no-op。
    - 有数据的 `clear-all` 显示项目、文件和记录数并要求输入固定确认短语；无数据时 no-op。

13. **Archive unavailable、Integrity gap 与 Quarantined Archive**
    - Run-local locator/helper 故障只阻止受影响 Run；共享数据库损坏、不兼容 schema 或迁移故障阻止该 Archive generation 的所有 Run。
    - 已启用 Run 在 Archive unavailable 下阻止 composer submission、保留草稿，只提供“重试”与“明确禁用当前 Run 后继续”。
    - 禁用后写 Collection Boundary 并允许 Claude Code 继续；它不伪装为连续采集。
    - plugin 自身崩溃导致宿主 fail-open 时，恢复阶段先用 transcript、pending 和 lifecycle 队列对账；无法证明的区间创建不可变 Integrity gap。
    - 健康恢复时写 Integrity recovery boundary 并允许当前状态回到 healthy；既有 Gap 永久可见且跨 Gap 历史不得称为完整。
    - 损坏时不自动修复、覆盖或重建。选择为：重试完整性检查、原样保留为 Quarantined Archive 后开启新 generation，或强确认 `clear-all`。

14. **迁移、更新与制品信任**
    - 只执行 manifest 声明的已知单向 schema 迁移；高于 helper 支持版本的数据库拒绝打开。
    - 迁移前做完整性与空间检查，在同目录创建同权限敏感备份；迁移事务完成并复检，下一次成功打开后才删备份。
      当前实现状态：schema 已到 2，manifest 声明 `1->2`（只新增非 prompt Timeline Event 表，
      在一个事务内完成），完整性检查、空间检查与备份生命周期尚未实现，由
      [Issue 27](issues/27-safe-schema-migration.md) 落实。
    - manifest 固定 target、文件名、SHA-256、helper protocol、可读写 schema 范围、最低 SQLite 能力、编译器/SDK/链接器来源与允许动态依赖。
    - 发布检查验证 Mach-O 架构、PIE、deployment target 和动态依赖；不宣称未经证实的字节级可复现。
    - 不在运行时下载、编译、替换 helper，不修改 quarantine/xattr 或系统安全策略，也不捆绑另一份 SQLite。

15. **并发与删除**
    - `clear-all` 使用线性化切点和新 Archive generation：切点前记录全部删除，切点后的新提交只写新 generation，旧 writer 被拒绝。
    - `clear-run` 删除当前 Run（整条会话谱系，跨越其所有进程接入）的 Prompt Entries、Pending Captures、相关原文和可关联的敏感元数据；其他 Run 保持不变。
    - 存在无法安全打开的 Quarantined Archive 时，`clear-run` 不得声称完整按 Run 删除，必须拒绝并引导 `clear-all`。
    - `clear-all` 删除活动数据库、WAL/SHM、迁移备份、Quarantined Archives 和 prompt 元数据，并删除会话索引里指向该项目档案中出现过的 Run 的记录（索引不记项目，只能按 Run 找回），之后 resume 这些会话会新建 Run 而不是回到旧 generation 的 Run；locator 生命周期独立，consent 与当前 Run mode 保留。（2026-09-23 Issue 32 修订。）
    - 删除使用 `secure_delete`、WAL checkpoint/truncate 和必要空间回收。事务删除成功但残留清理失败时报告“逻辑删除完成、物理清除未完成”，列出残留并保持 Archive unavailable。
    - 所有删除确认都重申 Claude Code transcript/history、文件系统快照、备份和 SSD 物理介质不在保证内。

16. **安全、诊断与隐私**
    - prompt 原文只经 stdin 进入 helper，只存于目标档案及迁移/隔离所需的受控敏感副本。
    - argv、locator、stderr、错误、debug log、trace、发布报告和备份清单不得含原文或文本哈希。helper stdout 只有专用时间线读取子命令（`timeline-read`）的响应可以携带原文：它由 `$.process.run` 捕获进 hook 内存、只用于当下显示，等同“当下允许显示的 UI”；其余子命令的 stdout 一律不含原文。
    - 诊断只使用随机 event ID、sequence、错误码、必要路径和不敏感计数。
    - 路径只在 owner、类型和来源可信时自动收紧权限；错误 owner、symlink、异常 ACL 或无法证明安全的路径直接拒绝。
    - 信任模型防止其他 OS 用户、意外权限放宽和陈旧/错误 locator；不承诺抵御当前账户、root 或能同时篡改 plugin/helper 的主体，也不提供加密或恶意数据库修改证明。
    - Prompt Trail 不使用网络，不修改 Claude Code transcript，不写 prompt 日志。

## Testing Decisions

1. **测试只断言外部语义**
   - 测试面向使用者可见终端行为、hook 契约结果、helper 语义协议、Timeline Event 语义和发布制品属性。
   - 不直接断言 SQLite 表名、列名或内部模块拆分；档案检查通过 test-only semantic verifier 完成。
   - 生产 hook、生产 helper 和生产 manifest 必须直接进入测试，不能用另一套测试实现复制业务规则。

2. **主 seam：真实 Claude Code PTY**
   - 在隔离项目、plugin data、locator 和 HOME 下，以最低兼容版本 `2.1.273` 和当前发布验收版本、function-hooks 环境变量及 `--plugin-dir mods/prompt-trail` 启动真实交互式终端；不得把仓库根或 `mods/` 容器当作插件根。
   - PTY 驱动普通/重复/多行/附件 prompt、slash 命令、`/clear`、`/compact`、reload、exit/restart、resume、两种 fork、rewind、Esc Esc、终端 resize、键盘、鼠标和 AskUserQuestion。
   - 通过终端可见状态、命令结果、Jump Target 行为及 semantic verifier 断言结果；不得依赖 debug log 中的 prompt。
   - 真实宿主还必须端到端注入 locator/helper 不可用、提交失败关闭、重试、禁用后继续、busy、损坏和物理删除残留。

3. **确定性 hook seam：`claude plugin test`**
   - 使用目标版本生成声明中提供的第一方 plugin test harness，加载真实 production plugin 并分派 typed events。
   - 覆盖 consent/collection 状态机、Pending Capture、drop/confirm、lifecycle 幂等、branch ambiguity、Archive unavailable、Integrity gap、UI render tree、按钮按压、窗口切换和错误处理。
   - memory store/clock/env 只模拟宿主接口，不重写 Prompt Trail 决策逻辑。
   - 该 seam 不声称验证真实进程、经典 locator、文件权限、原生 helper、PTY 焦点或真实终端绘制；这些保留给 PTY/helper seam。

4. **存储 seam：schema-opaque helper CLI**
   - 通过 stdin/stdout/exit status 的正式 helper protocol 黑盒测试每个语义操作。
   - 使用临时目录覆盖 24 个及以上并发 writer、幂等重试、事务中崩溃、WAL 恢复、busy 超时、`ENOSPC`、只读/权限异常、symlink、损坏、迁移中断、高版本拒绝、Quarantined Archive、增量读取、`clear-run`、`clear-all` 与 generation 竞争。
   - fixture 可以生成旧 schema，但断言通过 protocol verifier 而不是查询当前生产表结构。

5. **静态制品门禁**
   - 验证 thin arm64、`minos 15.0`、PIE、允许的系统 dylib、helper SHA-256、protocol/schema manifest、构建来源和系统 SQLite 能力。
   - 注入缺失、不可执行、摘要不符、错误 protocol、能力不足和执行策略拒绝，证明不会联网、现场编译、替换制品或创建内存 fallback。

6. **覆盖矩阵**
   - `PT-COMPAT-001..005`：静态门禁与真实 PTY。
   - `PT-CAPTURE-001..008`：plugin test，并以真实 PTY覆盖成功、drop、重复、多行、slash、内部流量和 Pending Capture。
   - `PT-LIFE-001..004`、`PT-BRANCH-001..004`、`PT-JUMP-001..002`：真实 PTY为权威，plugin test 复现确定性状态转换。
   - `PT-UI-001..008`：plugin test 检查 render tree，真实 PTY检查焦点、按键、鼠标、resize、AskUserQuestion 和宿主拒绝滚动。
   - `PT-STORE-001..009`：helper CLI 为主；restart、双 Run 和 generation 竞争另做真实 PTY集成。
   - `PT-FAIL-001..006`：plugin test 与 helper fault injection 组合，并完成已指定的代表性真实宿主故障。
   - `PT-CONTROL-001..002`、`PT-DELETE-001..004`、`PT-SEC-001..004`：三层共同覆盖。
   - 任一 MUST 场景失败、缺失、跳过或没有证据都阻断发布。

7. **长历史与性能**
   - 构造含 Prompt Entries、Run/Clear/Collection/branch/Gap 边界的 100,000-event Project Timeline。
   - 断言每次 protocol read 和 UI render 都不超过实现声明的固定窗口，遍历可到达首尾且没有页码。
   - 在报告所列参考机器上预热一次后重复十次；展开、加载下一批和显示新条目的 p95 各不超过 1 秒。
   - 该性能数字是发布证据门槛，不是所有硬件的公共 SLA。

8. **安全 fixture 与证据**
   - 每个场景使用不可猜测的合成 prompt 标记；不接触现有 Prompt Trail 或 Claude Code 用户数据。
   - 扫描 argv、locator、stdout/stderr、Claude Code/plugin 日志、错误、trace、备份清单和发布报告；标记只能存在于目标 SQLite 原文字段、`timeline-read` 响应和当下允许显示的 UI。
   - 终端 trace 必须在落盘前或生成报告时脱敏；报告只记录非敏感状态、ID、计数和证据链接。
   - 每个稳定场景 ID 记录版本、平台、helper 摘要、fixture、步骤、预期、实际与结果。

9. **现有 prior art**
   - [`clear-lifecycle` 原型](prototypes/clear-lifecycle/README.md) 提供 `/clear`、compaction、reload 和退出的真实事件序列及摘要脚本。
   - [`prompt-alignment-rewind` 原型](prototypes/prompt-alignment-rewind/README.md) 提供 composer/internal 流量、render 重放、Run 身份、resume/fork/rewind 的真实 trace。
   - [`scrollable-timeline` 原型](prototypes/scrollable-timeline/README.md) 提供 AbovePrompt、Jump Target、窄终端、AskUserQuestion 让出和歧义 Pane 的真人证据。
   - [`sqlite-helper` 原型](prototypes/sqlite-helper/README.md) 及其 Python scenario driver 提供事务、并发、crash、migration 和删除测试种子。
   - 这些资产是证据和 harness 种子，不是生产实现。生产测试必须使用 `2.1.273` 生成声明；不得沿用 scrollable prototype 中标为 `2.1.271` 的本地声明。

10. **测试成功标准**
    - 插件校验、TypeScript 检查、helper 构建/静态检查、plugin tests、helper protocol tests、PTY acceptance、100k benchmark 和隐私扫描全部通过。
    - 发布报告必须零 skipped、零 missing、零 leaked marker，并链接每个 MUST 场景的可复核证据。

## Out of Scope

- 搜索、复制、导出或用 `$.prompt.fill()` 回填任意旧 Prompt Entry；`$.prompt.fill()` 只用于恢复被歧义确认流程阻止的当前草稿。
- Desktop、VS Code、JetBrains、Mobile 或其他非终端 surface。
- Linux、Windows、WSL、Intel Mac、Rosetta、macOS 14 及更早版本，或 Claude Code `<2.1.273`/版本无法证明。
- Marketplace 发布、更新、卸载、scope 合并和 `--keep-data` 行为。
- 网络访问、远程同步、云备份、prompt 日志或遥测。
- 修改、解析或依赖 Claude Code transcript 文件的内部格式；通过公开 `$.session.messages()` 读取当前会话除外。
- React、Ink、DOM、Node API、终端转义序列或第三方 runtime UI/storage 框架。
- 触控板/滚轮保证、展开后自动聚焦、Esc 自动折叠；PageUp/PageDown/Home/End 在真实验收通过前不承诺。
- 第三方插件之间的通用 AbovePrompt 槽位仲裁。
- 纯附件提交在 Claude Code `2.1.278` 上不会产生无文本 submission：宿主把粘贴的附件
  替换成 `[Image #N]` 占位文本再提交，Prompt Trail 逐字保存该最终文本。空文本路径
  仍然实现并受测，但不承诺在当前宿主上出现。
- 无 Jump Target 的历史条目跳转、禁用区间补录或跨 Integrity gap 的完整性声明。
- 应用配额、自动轮转、自动过期、自动截断或自动删除。
- 数据加密、抵御当前账户/root/同时篡改 plugin 与 helper 的主体、恶意数据库篡改证明或 SSD 物理不可恢复擦除。
- Developer ID 签名、公证、自动修改 quarantine/xattr 或绕过企业安全策略。
- 所有硬件上的固定延迟 SLA、SQLite 物理 schema 稳定性或运行时编译/下载 fallback。

## Further Notes

- 生产 Prompt Trail 正在 `mods/prompt-trail/` 中实现；`.scratch/prompt-trail/prototypes/` 下的 TypeScript/TSX、C、Python、shell、HTML 与 trace 仍只是一次性研究原型，不得作为生产插件根。
- 实现必须从最低兼容版本 `2.1.273` 重新生成 function-hook declarations，并以它们作为事件、EngineInterface、UI element 和 plugin testing API 的兼容基线。
- 不得直接提升以下原型做法：单一多项目数据库、持久化绝对项目路径、consent 前建档、env-only Run ID、text-first Jump Target 匹配、全量内存时间线、静态 locator 文件、自动聚焦或 Esc 自动折叠。
- function hook API 是 early access；每次发布必须在最低兼容版本和当前发布验收版本重新完成插件校验、构建检查与真实宿主代表性验收。更高版本不因版本号本身被拒绝，但任何协议、API 或运行期能力不兼容仍失败关闭。
- 完整决策索引位于 [`map.md`](map.md)，规范性验收场景详见 [`定稿兼容与验收契约`](issues/05-finalize-acceptance-contract.md)。
