# 决定持久时间线模型

Type: grilling
Status: resolved
Blocked by: 01, 07

## Question

在已核实的生命周期与存储原语约束下，Prompt、运行期、对话段、边界、项目作用域和运行时跳转目标应如何建模、持久化、恢复与关联，才能永久保留完整时间线，同时不把失效 requestId 当作可用导航目标？

## Answer

采用由 function hook 采集、随插件分发的本地 SQLite helper 持久化的分层架构：hook 通过 `$.process.run` 调用 helper，数据库位于 `${CLAUDE_PLUGIN_DATA}/prompt-trail.sqlite`，不写入项目目录。

- **项目身份**：按 Claude Code 启动时的规范化项目根路径隔离并生成稳定 hash；不同 worktree 分离，项目移动后视为新项目。
- **档案形态**：使用不可变时间线事件。每条事件有独立 `event_id`，SQLite 事务分配项目级单调 `sequence`；时间戳只展示、不排序。
- **Prompt Entry**：保存完整原文、项目/Run/Segment/Branch 身份、sequence、事件 ID、逻辑父 prompt、提交时间、文本 hash 与捕获来源。重复文本保持独立。
- **Run**：对应一个 Claude Code 交互进程；Mod reload 不开始新 Run。异常退出会留下未闭合 Run，下次读取时解释为中断，不伪造结束事件。
- **并发**：同项目的并发进程使用不同 Run；每个 Run 独立维护活动分支，项目级 sequence 通过事务形成确定的全局发生顺序。
- **Conversation Segment**：`/clear` 在同一 Run 内开始新 Segment，并切断 prompt 父链；Clear Boundary 保持时间顺序。
- **分支**：Prompt Entry 保存逻辑父 prompt。`/rewind` 或 `/fork` 从目标 prompt 创建新分支，旧后续永久保留为非活动分支。普通新会话建立根分支；可靠识别的 resume 续接原分支；无法可靠匹配时建立新根分支，绝不猜测合并。
- **回退对齐**：能唯一重建目标时自动插入回退边界并切换活动分支；不能唯一重建时保存待确认回退并要求用户选择目标。永不猜测或删除旧事件。
- **Prompt 对齐不变量**：Prompt Trail 的 Prompt Entry 集合必须与 Claude Code 会话详情中的人类输入 prompt 集合完全一致，排除 tool-result 等内部 `user` role 流量。Prompt Event 决定档案成员资格；`ui.render` 只绑定 Jump Target。漏记、重复或额外条目均为缺陷，不是允许的降级。
- **Jump Target**：`requestId` 只存在当前运行内存中，不进入长期档案；没有有效目标的 Prompt Entry 仍保留并显示为不可跳转。
- **删除**：`clear-run` 物理删除当前 Run 的原文事件，可留下不含原文的删除边界；`clear-all` 删除当前项目全部记录且不留档案内审计事件。删除不承诺清除 Claude Code transcript、history、paste cache 或备份中的副本。

Run 跨 reload 的连续身份、Prompt Event 与会话详情的一一对应、resume/rewind/fork 重建、SQLite helper 的打包与生命周期均必须由后续原型验证；若对齐不变量在 2.1.273 中不成立，应重新打开本票据，而不是引入启发式静默降级。

## Supersession note

本答案中的单一共享数据库路径拓扑已由 [决定存储安全与故障策略](04-decide-storage-safety-policy.md) 修正；事件、Run、Segment、Branch、Prompt Entry 与 Jump Target 模型保持不变。
