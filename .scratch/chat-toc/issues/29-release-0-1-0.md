# 29: 0.1.0 发布门禁与发布

**What to build:** chat-toc 0.1.0 在两个 Claude Code 版本上通过全部 MUST，带着可追溯的证据出现在 marketplace 和根 README 里，并在发布后从 GitHub 安装验证一次。

规格见 [chat-toc MVP](../spec.md) §10 与「Testing Decisions」。

**Blocked by:** 27（长会话性能）、28（用户文档与开发文档）

**Status:** ready-for-agent

- [ ] 证据目录（按插件版本）含 `report.md`（含人工目检签字）、`report.json`（插件版本、Claude Code 版本、OS、架构、fixture、场景 ID、预期、实际、结果、证据链接、提交哈希）、`marketplace.md`
- [ ] 2.1.287 与当时的当前版本各跑一遍「定稿兼容与验收契约」全部 MUST，零失败零缺失零跳过（CT-COMPAT-001 等）
- [ ] CT-SEC-001：合成唯一标记 prompt 只出现在 Pane 绘制里，不出现在 `$.store`、插件数据目录、日志、错误文本、发布报告
- [ ] 发布前用本地目录 marketplace 在两个版本上跑 CT-COMPAT-002 冒烟
- [ ] 人工目检签字（三种 Layout 观感、高亮与光标可分清），不阻断
- [ ] marketplace 条目（`chat-toc`、`./mods/chat-toc`、英文描述、`0.1.0`、`chat-toc contributors`，无 category/tags）、根 README 那一行与那一节、证据目录在同一个发布提交里，不打 tag
- [ ] 推上去后从 `lkangd/cc-mods` 做安装级检查（添加、安装、版本、enabled、Pane 弹出），结果补进 `marketplace.md`；失败就撤回发布提交
