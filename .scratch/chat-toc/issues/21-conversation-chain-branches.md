# 21: 对话链：compact、rewind、resume、fork

**What to build:** 目录始终只反映当前分支：compact 之前的条目照常显示，rewind 后的下一次提交让被弃分支从目录消失，resume、fork 之后目录与该会话文件的对话链一致；两个终端里同一项目的两个会话各自只显示自己的目录。

规格见 [chat-toc MVP](../spec.md) §3（对话链）、§4（生命周期）。

**Blocked by:** 18（独立 verifier 与 PTY 验收驱动）、19（完整的开组规则与 Agent reply）

**Status:** ready-for-agent

- [ ] 沿 `parentUuid` 回溯，遇到 `system/compact_boundary` 改沿 `logicalParentUuid`；compact 前的条目照常显示（CT-LIFE-003）
- [ ] rewind（含 Esc Esc）后的下一次提交，被弃分支的条目消失（CT-LIFE-004）；提交之前的窗口里旧条目仍在，符合不承诺清单
- [ ] `--resume`、`--continue`、会话内 `/resume`、`--fork-session` 之后，verifier 比对目录与对话链一致（CT-LIFE-005）
- [ ] 两个终端里同一项目的两个会话，各自只显示自己的 transcript（CT-DATA-006）
- [ ] 判据一律是独立 verifier；以上场景在两个版本上通过
