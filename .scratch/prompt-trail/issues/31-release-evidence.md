# 31: 生成零跳过发布证据

**What to build:** 让发布维护者用一次可重复流程证明唯一支持矩阵中的全部 MUST 场景均通过、没有 prompt 泄漏，并生成可审计的发布报告。

**Blocked by:** 23「在终端限制下保持时间线可用」、26「记录并闭合 Integrity gap」、29「物理清除当前 Run」、30「原子清除 Project Timeline」

**Status:** ready-for-agent

- [ ] 发布流程固定并记录 macOS 15.x arm64、Claude Code 最低兼容版本 `2.1.273` 与当前发布验收版本、交互式终端、function-hooks 开关、插件版本、helper 摘要和 SQLite 版本。
- [ ] 插件校验、TypeScript 检查、静态 Mach-O/manifest 检查、plugin tests、helper protocol tests、真实 PTY acceptance、100k benchmark 和隐私扫描全部纳入同一门禁。
- [ ] `PT-COMPAT`、`PT-CAPTURE`、`PT-LIFE`、`PT-BRANCH`、`PT-JUMP`、`PT-UI`、`PT-STORE`、`PT-FAIL`、`PT-CONTROL`、`PT-DELETE` 和 `PT-SEC` 的每个稳定场景 ID 都映射到步骤、预期、实际、结果和证据链接。
- [ ] 每个场景使用隔离临时项目、plugin data、locator 和 HOME；不得读取、修改或删除现有 Prompt Trail/Claude Code 用户数据。
- [ ] 每个 fixture 使用不可猜测的合成 prompt 标记；扫描 argv、locator、stdout/stderr、Claude Code/plugin 日志、错误、trace、备份清单和报告。
- [ ] 合成标记只能出现在目标 SQLite 原文字段、`timeline-read` 响应和当下允许显示的 UI；任何其他出现（包括其他子命令的 stdout）都阻断发布。
- [ ] 终端 trace 与报告在落盘前或汇总时完成脱敏，只保留非敏感 ID、sequence、错误码、计数、版本和路径。
- [ ] 100,000-event fixture 的有界读取/渲染和三个 p95 目标均在报告中记录参考硬件、运行次数和测量结果。
- [ ] README/status 明确列出不支持平台、Marketplace 边界、自动焦点/Esc/滚轮/槽位限制、删除边界及移除 `--plugin-dir` 前的数据清理说明。
- [ ] 任一 MUST 场景 failed、missing、skipped、无证据或 leaked marker 时报告整体失败；只有零缺失、零跳过、零泄漏才允许发布。
