# 29: 0.1.0 发布门禁与发布

**What to build:** chat-toc 0.1.0 在两个 Claude Code 版本上通过全部 MUST，带着可追溯的证据出现在 marketplace 和根 README 里，并在发布后从 GitHub 安装验证一次。

规格见 [chat-toc MVP](../spec.md) §10 与「Testing Decisions」。

**Blocked by:** 27（长会话性能）、28（用户文档与开发文档）

**Status:** resolved

- [ ] 证据目录（按插件版本）含 `report.md`（含人工目检签字）、`report.json`（插件版本、Claude Code 版本、OS、架构、fixture、场景 ID、预期、实际、结果、证据链接、提交哈希）、`marketplace.md`
- [x] 2.1.287 与当时的当前版本各跑一遍「定稿兼容与验收契约」全部 MUST，零失败零缺失零跳过（CT-COMPAT-001 等）
- [x] CT-SEC-001：合成唯一标记 prompt 只出现在 Pane 绘制里，不出现在 `$.store`、插件数据目录、日志、错误文本、发布报告
- [x] 发布前用本地目录 marketplace 在两个版本上跑 CT-COMPAT-002 冒烟
- [ ] 人工目检签字（三种 Layout 观感、高亮与光标可分清），不阻断
- [x] marketplace 条目（`chat-toc`、`./mods/chat-toc`、英文描述、`0.1.0`、`chat-toc contributors`，无 category/tags）、根 README 那一行与那一节、证据目录在同一个发布提交里，不打 tag
- [x] 推上去后从 `lkangd/cc-mods` 做安装级检查（添加、安装、版本、enabled、Pane 弹出），结果补进 `marketplace.md`；失败就撤回发布提交

## Comments

- 2026-10-11：被测提交 `a83f74c`（之后插件代码没有改动）。`tests/acceptance/release_gate.py` 在 2.1.287 与 2.1.295 上以 `--plugin-dir` 跑全部 32 个 MUST：各 32/32 通过，92 条记录，零失败零缺失零跳过；`claude plugin validate` 两版通过，两版 `tsc` 干净，`claude plugin test` 210 个通过；CT-PERF-001 两版两种 fixture 各 3 次都在阈值内；证据里没有 CT-SEC-001 标记。原来没有脚本的场景补在 `gate_scenarios.py`（CT-TURN-004 的「进行中 · N 步」用 `fake_api.py` 本机替身跑一轮真实的带工具步骤的 turn，不调用模型）与 `ct_marketplace.py`。
- 第一轮门禁里 2.1.287 的 CT-UI-003 失败一次，原因在检查本身（把宿主焦点环的起点写死、没算 `/tui` 只有用户一侧），改检查后（`a83f74c`）整套门禁与性能重跑。
- 本地目录 marketplace 冒烟两版通过。发布提交 `066d082` 后，从 GitHub 的安装级检查两版都失败：仓库默认分支不是 main，`marketplace add lkangd/cc-mods` 克隆到的 marketplace 里没有 chat-toc；按规则撤回（`abd2e8b`）。使用者把默认分支改成 main 后重新发布（`b3396e6`，内容相同），安装级检查两版通过，见 `mods/chat-toc/tests/evidence/0.1.0/marketplace.md`。
- 人工目检签字（三种 Layout 观感、青色高亮与反色光标可分清）未勾，证据目录那一项也因此未勾（`report.md`、`report.json`、`marketplace.md` 都已在，只差 `report.md` 里的签字）：留给使用者，在 `report.md` 的「人工目检（待使用者签字）」一节；不阻断发布。
