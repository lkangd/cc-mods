# SQLite helper 一次性原型

> THROWAWAY PROTOTYPE：只用于回答《原型验证 SQLite 档案 helper》，不得迁入正式实现。

目标版本：Claude Code `2.1.273`，当前原型二进制仅针对 macOS arm64。它验证真实 SQLite、真实 `$.process.run` 与真实 `--plugin-dir` 加载，不记录普通对话 prompt；只有 `/prompt-trail-sqlite-write` 明确给出的合成文本会进入测试档案。

## 原型先暴露出的路径边界

在 `2.1.273` 中，function hook 的 `$.env.get()` 和它启动的 `$.process.run` 子进程均拿不到 `CLAUDE_PLUGIN_ROOT`、`CLAUDE_PLUGIN_DATA` 或 `CLAUDE_PROJECT_DIR`。证据见 [`runtime-path-probe.json`](runtime-path-probe.json)。未写入声明文件的 `import.meta.url` 虽然实测存在，但不作为稳定契约。

本原型按人工选择采用 **command-hook 桥**：

1. 经典 `SessionStart` command hook 通过官方占位符启动随插件分发的 helper。
2. helper 把自己的绝对路径和 `${CLAUDE_PLUGIN_DATA}/prompt-trail.sqlite` 原子写入 `~/.claude/plugins/data/.function-hook-locators/prompt-trail-sqlite-probe.json`。
3. function hook 只依赖可用的 `HOME` 与 `$.fs.read` 读取 locator，再用 `$.process.run(argv)` 调 helper。

locator 目录权限为 `0700`、文件为 `0600`，不含 prompt，但它位于插件数据目录之外，卸载不会自动清除；正式设计必须明确校验、清理与失效策略。

## 构建与自动场景

```bash
.scratch/prompt-trail/prototypes/sqlite-helper/build.sh
.scratch/prompt-trail/prototypes/sqlite-helper/run-scenarios.py
```

自动场景使用临时 Git repo 与 worktree，覆盖：

- symlink 规范化、子目录回到 Git 根、worktree 隔离；
- 幂等 event ID、重复 prompt 保留、项目级事务 sequence；
- 24 个并发 writer、WAL、未提交进程强杀与 `integrity_check`；
- 增量范围读取；
- v1 → v2 原位 schema migration；
- `secure_delete=ON`、checkpoint、项目删除后的 `VACUUM` 与原文 byte 扫描；
- locator、数据目录和数据库权限；
- helper 架构及动态链接依赖。

机器可读结果见 [`scenario-report.json`](scenario-report.json)。

## 真人交互验证

从仓库根目录启动固定版本：

```bash
env -u CLAUDECODE CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 \
  npx -y @anthropic-ai/claude-code@2.1.273 \
  --plugin-dir .scratch/prompt-trail/prototypes/sqlite-helper/plugin
```

只输入以下合成值：

1. `/prompt-trail-sqlite-info`：应显示 locator、helper、数据库、project root、run ID，`lastError` 为空。
2. `/prompt-trail-sqlite-write PT-SQLITE-A`
3. 再次运行 `/prompt-trail-sqlite-write PT-SQLITE-A`：两次应得到不同 sequence。
4. `/prompt-trail-sqlite-read 0 20`：应按 sequence 升序看到两个同文事件。
5. `/reload-plugins`
6. 再次运行 `/prompt-trail-sqlite-info`：`moduleInstanceId` 应变化，`runId` 与数据库路径应保持，事件数应增加一个 reload 的 `run-start`。
7. `/prompt-trail-sqlite-write PT-SQLITE-AFTER-RELOAD`
8. 正常退出，再用同一启动命令重启并运行 `/prompt-trail-sqlite-info`：数据库和旧事件应保留，新进程应得到新 `runId`。

## 已验证结论

- **成立**：command hook 可使用官方 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`，桥接后 function hook 可通过 `$.process.run(argv)` 调用随插件分发的 helper；启动实测已在 `2.1.273` 生成一个持久 `run-start`。
- **成立**：macOS arm64 原型通过全部自动场景，包括并发 sequence、WAL 强杀恢复、范围读取、迁移、物理删除 byte 检查和 `0700`/`0600` 权限。
- **真人确认成立**：交互运行写入 `PT-SQLITE-A` 后执行 `/reload-plugins`，新 module instance 沿用同一 `runId` 并继续写入 `PT-SQLITE-AFTER-RELOAD`；退出重启后数据库保留且生成新 `runId`。持久证据为项目 sequence `2–6`，数据库 `integrity_check=ok`。
- **不成立**：function hook 不能直接读取或继承三个插件路径变量；不能把直接使用 `${CLAUDE_PLUGIN_DATA}` 写成 API 契约。
- **范围限制**：当前二进制是 Mach-O arm64，并动态链接 macOS `/usr/lib/libsqlite3.dylib`。正式发布需要每个受支持 OS/架构的受信任构建、选择静态或明确的系统 SQLite 基线，并验证签名/隔离属性。
- **卸载边界**：`--plugin-dir` 没有 uninstall。官方对已安装插件的契约是：从最后一个 scope 卸载时默认删除 `${CLAUDE_PLUGIN_DATA}`，`--keep-data` 才保留；本桥的 locator 不在其中。参见 [Plugins reference: Persistent data directory](https://code.claude.com/docs/en/plugins-reference#persistent-data-directory) 与 [plugin uninstall](https://code.claude.com/docs/en/plugins-reference#plugin-uninstall)。
