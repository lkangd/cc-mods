# 研究永久本地档案后端

Type: research
Status: resolved
Blocked by: 01

## Question

在 function-hooks Mod 的官方能力和安全模型内，什么本地存储后端能支持按项目隔离、永久且无上限保存完整 prompt 文本，并提供增量写入、连续读取、并发安全、原子恢复和明确删除；若没有官方原语，直接文件系统或进程能力是否受支持，边界与兼容风险是什么？

## Answer

官方没有同时满足全部要求的内建持久化原语。

- function-hook module 明确是 “no DOM, no Node” 环境，不能直接 import `node:fs`、`node:sqlite` 或 `bun:sqlite`；2.1.273 也没有可依赖的 `$.capabilities`。
- `$.store` 是 4 MiB 插件级明文 JSON，只适合配置、小型索引和边界元数据，不适合完整 prompt 档案。
- `$.fs` 只提供 UTF-8 整文件 `read/write` 与查询，单次上限 4 MiB；没有 append、rename、fsync、lock 或 transaction，不能单独承诺增量写入、并发安全和崩溃恢复。
- `$.process.run` 可在 CLI 中以当前用户权限、argv 形式调用宿主命令。通过它调用受信任的外部 helper 是可行架构，但不是 function-hooks 内建档案能力。
- 外部 JSONL helper 能实现追加和逐行恢复，但索引、删除、锁与查询都需自行设计。
- **推荐候选是外部 SQLite helper**：function hook 只采集事件，通过 `$.process.run` 传给 helper；helper 使用事务/WAL、幂等键、索引和条件删除，并以规范化项目根目录的稳定 hash 作为 `project_id`。
- 数据应放在 `${CLAUDE_PLUGIN_DATA}` 或用户明确授权的数据目录，不放 plugin root。该目录并非“永不删除”：卸载生命周期、`--keep-data`、磁盘容量和系统策略仍可能删除或限制数据。
- helper 必须视为高信任本地代码；使用 argv/stdin 而不是 shell 拼接，限制可执行路径、cwd、环境变量与文件权限。完整 prompt 可能含凭据和机密，官方没有自动加密保证。
- “删除 Prompt Trail 档案”不等于删除 Claude Code transcript、history、paste cache、备份等其他副本。

仍需在选择 SQLite helper 后原型验证 `${CLAUDE_PLUGIN_DATA}` 可见性、helper 打包与路径、WAL/异常恢复、并发调用、项目根识别、symlink/worktree，以及插件卸载的数据保留行为。

### Sources

- [Claude Code 2.1.273 function-hook declarations](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)
- [Claude Code security](https://code.claude.com/docs/en/security.md)
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference.md)
- [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing.md)
