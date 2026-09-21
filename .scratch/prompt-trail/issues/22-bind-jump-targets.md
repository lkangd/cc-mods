# 22: 绑定和失效 Jump Target

**What to build:** 让当前 transcript 中仍存在的 Prompt Entry 可通过键盘或鼠标跳回原位置，同时让已失效的历史条目继续可见且不会跳错。

**Blocked by:** 13「严格匹配人类 composer 提交」、18「在 resume 与 fork 中重建 Conversation Branch」、19「rewind 后建立新 Conversation Branch」、21「连续浏览 100,000 个 Timeline Events」

**Status:** ready-for-agent

- [ ] `ui.render(UserMessage)` 只为非 placeholder、当前活动路径上唯一对齐的 Prompt Entry 绑定 Jump Target，不创建 Timeline Event。
- [ ] Jump Target request ID 只存在当前 Run 内存，不写入 SQLite、`$.store` 或 locator。
- [ ] 重复文本按完整活动路径顺序分别绑定到各自 Prompt Entry，不能使用“第一个同文本未绑定项”的启发式。
- [ ] reload、resume 和 fork 的共享历史 render 重放不会重复 Prompt Entry；只为当前重放且唯一对齐的共享前缀重新绑定目标。
- [ ] 有效条目显示可跳转标记，鼠标点击或 Enter 激活后到达正确 transcript 位置、折叠 Prompt Trail 并把焦点还给 composer。
- [ ] 普通重启、被 transcript 淘汰或无法唯一对齐的条目保留并显示 `×`；激活无副作用且不折叠。
- [ ] 无匹配的 command output、内部消息或 preview render 被忽略，绝不绑定到最近文本相同的 Prompt Entry。
- [ ] plugin test 验证绑定表和失效行为；真实 PTY 使用重复与多行 prompt 验证多个独立目标、reload/resume 重绑和重启失效。
