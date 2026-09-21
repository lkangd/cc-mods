# 原型验证 SQLite 档案 helper

Type: prototype
Status: resolved
Blocked by: 02

## Question

随插件分发的本地 SQLite helper 能否通过 `$.process.run` 在 Claude Code `2.1.273` 终端中可靠使用 `${CLAUDE_PLUGIN_DATA}`，并满足项目根路径规范化、worktree 隔离、事务 sequence、并发 Run、WAL/异常恢复、增量范围读取、物理删除、schema 迁移、插件 reload/卸载与路径权限要求？

## Comments

- 首轮路径探针发现：function hook 的 `$.env.get()` 与它启动的 `$.process.run` 子进程都拿不到 `CLAUDE_PLUGIN_ROOT`、`CLAUDE_PLUGIN_DATA` 或 `CLAUDE_PROJECT_DIR`；只有经典 command hook 获得官方占位符。人工选择采用 command-hook 桥，而不是把未声明但实测存在的 `import.meta.url` 当成契约。
- 一次性资产、复现步骤与真人脚本见 [`SQLite helper 原型`](../prototypes/sqlite-helper/README.md)；自动场景原始结果见 [`scenario-report.json`](../prototypes/sqlite-helper/scenario-report.json)。

## Answer

**有条件成立：SQLite helper 本身满足档案要求，但 function hook 不能直接使用 `${CLAUDE_PLUGIN_DATA}`；MVP 必须采用经典 command hook 发布 locator、function hook 再以 `$.process.run(argv)` 调 helper 的桥接结构。** Claude Code `2.1.273` 的真实启动、reload 与重启，以及 macOS arm64 上的 SQLite 场景均已通过。

1. **路径契约**：直接路径方案不成立。`runtime-path-probe.json` 实测 function hook 只能读到 `HOME`，其子进程也不继承三个插件路径变量；`import.meta.url` 虽在运行时存在，却不在 `2.1.273` 声明或官方 Mods 文档中，不能作为正式契约。经典 command hook 能把 `${CLAUDE_PLUGIN_ROOT}` 与 `${CLAUDE_PLUGIN_DATA}` 作为 exec-form argv 传给 bundled helper。
2. **桥接方案**：经典 `SessionStart` command hook 原子写入只含 helper 与数据库绝对路径的 locator；目录权限 `0700`、文件 `0600`。function hook 从 `HOME` 下的固定 locator 路径读取后，以无 shell 的 argv 和 stdin 调用 helper。locator 不含 prompt，但位于 `${CLAUDE_PLUGIN_DATA}` 外，可能陈旧、被同用户改写且不会随 uninstall 自动删除；《决定存储安全与故障策略》必须锁定校验、失效、清理和拒绝执行策略。
3. **项目身份**：hook 从实际 `cwd` 执行 `git rev-parse --show-toplevel`，不能使用 `$.session.repo().root`，因为声明明确说后者在 worktree 中返回主工作树。helper 再以 `realpath` 规范化；实测 symlink 与仓库子目录归并，同一 repo 的真实 Git worktree 得到不同项目 ID，路径移动按既定模型视作新项目。
4. **事务与并发**：每次 append 使用 `BEGIN IMMEDIATE`，在项目行上分配单调 sequence，并以 event ID 幂等。24 个并发 writer 全部提交、无 busy 错误，sequence 连续；相同 prompt 文本的不同 event 保持独立。同项目不同 Run 共享项目 sequence，Run ID 由上层传入；原型中的 env-only Run ID 仅用于 reload 走查，不能替代《原型验证 prompt 对齐与回退分支》要求的宿主进程世代判断。
5. **WAL 与异常恢复**：`journal_mode=WAL`、`synchronous=FULL`、10 秒 busy timeout。强制在事务 insert 后 `_exit(86)`，重开后 count 与 max sequence 均未变化、marker 不存在且 `integrity_check=ok`。
6. **读取与迁移**：`range(project, after_sequence, limit)` 返回严格升序且有界的增量事件。v1 fixture 自动在事务中升级到 v2，新增列后旧 prompt 原文保持，`user_version=2`、完整性为 `ok`；高于 helper 支持版本必须拒绝打开，不能猜测降级。
7. **删除**：连接启用 `secure_delete=ON`；`clear-run` 删除对应事件后 checkpoint/truncate WAL，`clear-all` 删除项目、checkpoint 并 `VACUUM`。隔离样本的 DB/WAL/SHM byte 扫描确认目标 marker 消失、未删除项目 marker 保留。它仍不承诺清除文件系统快照、备份或 Claude Code 自身副本。
8. **权限**：helper 在 `umask 077` 下创建目录和数据库，并强制数据目录 `0700`、数据库 `0600`；locator 同样为 `0700/0600`。容量耗尽、只读目录、权限被改坏及 busy timeout 的用户可见降级由安全策略票据决定。
9. **reload 与重启**：真人交互证据显示，同一进程 `/reload-plugins` 后 module instance 改变但 `runId` 保持，继续写入 `PT-SQLITE-AFTER-RELOAD`；退出重启后旧数据库保留并产生新 `runId`。数据库最终 sequence `2–6`、`integrity_check=ok`。
10. **卸载与分发**：首阶段 `--plugin-dir` 没有 uninstall。官方对 marketplace 安装的契约是：最后一个 scope 卸载时默认删除 `${CLAUDE_PLUGIN_DATA}`，`--keep-data` 才保留；桥 locator 不会自动删除。当前 helper 是动态链接系统 `libsqlite3` 的 Mach-O arm64 原型，不可宣称跨平台；正式实现必须先决定受支持 OS/架构、构建/签名、SQLite 链接基线、binary 选择与不支持平台的拒绝路径。

## Scope note

本原型验证的 SQLite 原语仍然成立；其单一多项目数据库拓扑已由 [决定存储安全与故障策略](04-decide-storage-safety-policy.md) 修正为每个 Project Timeline 独立数据库。
