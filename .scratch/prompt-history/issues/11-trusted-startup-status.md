# 11: 可信启动并报告支持状态

**What to build:** 让使用者能够从可信本地目录启动生产版 prompt-history，并在保存任何数据前获知当前环境是否受支持、helper 是否可信可用，以及失败的非敏感原因。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `cc-mods` 保持多-mod 容器：prompt-history 的 manifest、hooks、helper、源码、测试与版本固定声明全部封装在独立 `mods/prompt-history/` 插件根，仓库根不声明任何单一插件。
- [x] 插件以 Claude Code `2.1.273` 为最低兼容版本，在 `2.1.273` 与 `2.1.278`、macOS 15.x arm64、交互式终端和进程级 function-hooks 开关下通过插件校验、类型检查，并可由 `--plugin-dir mods/prompt-history` 加载。
- [x] 首次启动默认只显示折叠的 `prompt-history` 标题，`/prompt-history status` 在尚未 consent 时可用且不显示 prompt 原文。
- [x] 经典 SessionStart bridge 发布 session 隔离、私有权限的 locator；locator 绑定 helper 规范路径、数据库根、摘要、protocol、session 和宿主进程世代，且不含 prompt。
- [x] 只读 preflight 验证 OS、架构、macOS 主版本、Claude Code 版本、helper 文件类型/执行权限/摘要/protocol、动态加载和系统 SQLite 能力，且不创建项目数据库。
- [x] 不受支持或无法证明版本的环境不请求 consent、不创建档案；`status` 明确显示 `unsupported target`。
- [x] helper 缺失、非普通文件、不可执行、摘要不符、protocol 不符、SQLite 能力不足或执行被系统策略拒绝时，`status` 给出不含 prompt 的错误类别和必要路径。
- [x] 发布制品检查验证 thin arm64 Mach-O、PIE、`minos 15.0`、允许的系统动态依赖、SHA-256 和 manifest 元数据。
- [x] 任一启动失败路径都不联网、不现场编译、不替换 binary、不修改 xattr/系统策略，也不启用内存 fallback。
- [x] 正常结束清理本 session locator；只有能证明 owner、格式、世代和进程终止时才清理陈旧 locator。
- [x] plugin test、helper protocol test、静态制品检查和真实 PTY smoke 均覆盖成功与主要拒绝路径。

## Comments

- 2026-09-20：纠正插件边界。生产实现及其 `2.1.273` declarations 已整体迁入 `mods/prompt-history/`；仓库级设置、issue tracker、代理规则与研究原型保留在根目录。新增 `CONTEXT-MAP.md`，prompt-history 术语表随 mod 迁移。
- 2026-09-20：已在本仓库另一交互式会话中用 `--plugin-dir mods/prompt-history` 启动并看到 prompt-history 入口，确认相对路径从仓库根可加载。
- 自动审查后补强了可信路径链、helper/manifest 写权限与 write-ACL 拒绝、helper 类别白名单同步、删除/符号链接分类、`/clear` locator 原子轮换及中断恢复。`scripts/verify-startup.sh` 现在先从当前源码重建，再执行固定版本校验与全部测试；manifest 同时绑定两个二进制及全部编译输入摘要。
- 最新重建验证在 Claude Code `2.1.273` 与 `2.1.278` 各包含 30 项 plugin tests，并包含 7 项静态/策略制品测试、13 项 bridge protocol tests 和 10 项 helper protocol tests；同时验证确定性重建与陈旧制品门禁。完整真实 PTY 成功/拒绝场景仍待复测，因此本票继续保持 `claimed`。
- 2026-09-20：Claude Code `2.1.278` 真人验收暴露三项问题：宿主版本被精确锁定、失败状态省略 helper/database root、`/clear` 后状态停在 `locator-permissions`。修订为最低版本 `>=2.1.273`，`status` 每次执行都重新进行只读 preflight 并始终输出 helper/database root/locator 行；locator 在读取前先验证身份与权限，bridge 在 rename 后复核最终文件，等待真人复测。
- 2026-09-21：新会话首个 status 仍报告 `locator-permissions`。现场检查证明 locator 为当前 UID 所有的普通 `0600` 文件、目录为 `0700`、均无扩展 ACL，且内容正确绑定 Claude Code `2.1.278` 与 trusted helper；根因是 function hook 调用了 macOS 不存在的 `/usr/bin/realpath`，实际系统路径为 `/bin/realpath`。已修正生产路径和 mocks，并新增静态门禁，要求每个 runtime allowlist executable 在目标机真实存在且可执行；完整自动验证再次通过。
- 2026-09-21：使用者确认全部真机验收项通过，包括受支持启动与完整 status、`/clear` locator 轮换、正常退出清理、低于最低 Claude Code 版本拒绝、helper 缺失、摘要不符和 protocol 不匹配拒绝。

## Answer

prompt-history 已在独立插件根 `mods/prompt-history/` 完成可信启动闭环：支持 macOS 15.x arm64 与 Claude Code `>=2.1.273`，通过私有 session locator、摘要绑定的预构建 helper 和不建档的只读 preflight 报告支持状态。自动门禁与真实 PTY 均已覆盖成功、`/clear`、退出清理及主要拒绝路径；所有诊断保持无 prompt、失败关闭且无网络、运行时编译或隐式 fallback。
