# 23: 完整跳转：Agent 侧、兜底与被拒

**What to build:** 目录里每一侧都能点：Agent 侧跳到本轮最后一段文字回复；本地命令、prompt 型命令、`!cmd` 这些看得见但没有站点的行，兜底跳到紧邻的行并让原输入行留在屏上；实在跳不过去时给出一行说明并让这一侧变暗，不会点了没反应。

规格见 [chat-toc MVP](../spec.md) §5。

**Blocked by:** 18（独立 verifier 与 PTY 验收驱动）、19（完整的开组规则与 Agent reply）

**Status:** ready-for-agent

- [ ] 挂 `UserMessage`、`AssistantMessage`、`CommandOutput`、`ToolGroup`（只读 `requestId` 与 `onScreen`，不改绘制）
- [ ] `requestId` → 行按序匹配：精确 uuid → 去 `collapsed-` 前缀 → tool_use id → 前 24 位；跳转用宿主给的 id；每次读完 transcript 后重建映射，增量时只补新行、重试未解析的 id
- [ ] Agent 侧跳到末段所在行；没有末段时跳到本组最后一个可绘制行（`AssistantMessage` 或 `ToolGroup`），本组一个都没有按被拒处理
- [ ] 能跳到从没画出过的行，例如 resume 300 轮后跳到第 1 轮（CT-JUMP-001）
- [ ] 兜底跳转：往后最近的可绘制行，往后没有再往前，`block: center`，被拒换下一个候选，最多 3 个（CT-JUMP-002）
- [ ] 全部被拒时底部显示「这一条当前没有显示在对话里，无法跳转」，下一次跳转、选择移动或约 5 秒后消失；这一侧所有行 `dimColor`，直到行重新被宿主列出；无其他副作用（CT-JUMP-003）
- [ ] 不事先淡化任何条目
- [ ] 自动化测试覆盖四级匹配与候选顺序；PTY 验收 CT-JUMP-001～003 在两个版本上通过
