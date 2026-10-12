# 34: 发布 0.1.2

**What to build:** 31–33 号票合入 main 后，以 0.1.2 发布 chat-toc。

**Blocked by:** 31、32、33

**Status:** ready-for-agent

## 已定的决定（2026-10-12 grilling）

- 31–33 每张票一个分支（`chat-toc/3x-…`），测试先行，`--no-ff` 合入 main。
- 三张都合入后发 0.1.2，按 README 的「发布清单」：2.1.287 与当前版本跑完整门禁（MUST 由 33 项增至 37 项：`CT-LIFE-007`、`CT-LIFE-008`、`CT-JUMP-005`、`CT-UI-005`，另修订 `CT-LIFE-004`）、marketplace 冒烟、GitHub 安装检查。
- 推送前先问使用者。
- PTY 验收与性能测试串行跑，在机器空闲时跑。

## 步骤

- [ ] `release_gate.py` 的 MUST 表与签字说明加入新增项
- [ ] 门禁（证据目录 `mods/chat-toc/tests/evidence/0.1.2/`）
- [ ] 发布提交（marketplace 版本、根 README、证据目录）
- [ ] 经使用者同意后推送，从 GitHub 做安装级检查

## Comments
