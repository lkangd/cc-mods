# 35: 排队后被撤回的提交不能成为 Prompt Entry

**What to build:** 模型运行中输入的 composer 提交会进入宿主的队列。`prompt.submit` 的 `next(e)` 在排进队列时就返回（宿主类型：「resolves once the prompt entered the session and its turn started, or it was queued behind the running one」），插件随即确认采集。可是排队的提交之后可能被宿主整个撤回（transcript 里的 `queue-operation` 为 `popAll`），从未进入对话。档案里于是多出一条 transcript 里不存在的 Prompt Entry，违反 Issue 13 的「Prompt Entry 必须与会话里的人类 prompt 一一对应」。下一次提交时，插件发现 transcript 缺了这一行，按 rewind 处理，后面的 prompt 开了新分支，被撤回的那条被折叠成「另一分支」。

**Blocked by:** 13「严格匹配人类 composer 提交」、15「对账 Pending Capture」

**Status:** open

- [ ] 排队的提交（带 `turnId`）在真正进入对话之前不确认为 Prompt Entry；确认与丢弃的依据、时机和失败时的对账，实现前与使用者对齐。
- [ ] 排队后正常出队的提交，仍然恰好产生一条 Prompt Entry，父节点正确。
- [ ] 排队后被撤回的提交不产生 Prompt Entry，下一条提交不被误判为 rewind，也不开新分支。
- [ ] plugin test 覆盖出队与撤回两条路径；真实 PTY 复现下面的步骤。

## Comments

### 2026-09-27 · 从 Issue 22 验收中拆出

PTY（2.1.283，验收项目 `pt21-project`）：使用者提交 `PT-A 只回复 OK`，模型还在运行时立刻再提交一条相同的 `PT-A 只回复 OK`，接着又提交一条两行的 `PT-B`。band 里第二条 PT-A 显示为「另一分支」，transcript 里没有它。使用者没有按 ↑ 或 Esc，第二条也没有被放回输入框。

实机取证（transcript `f588213a`，只看结构）：
- 第一轮的做法相同，却是 `enqueue` → `dequeue` → 出现一行 user，正常。
- 出问题的那一轮：第二条 PT-A `enqueue`（02:32:02.226），0.56 秒后 `popAll`（02:32:02.788，content 长度 11），之后没有对应的 user 行，也没有 `queued_command` attachment；PT-B `enqueue` → `dequeue` → user 行 `9f9fcf61`。
- 插件追踪：第二条 PT-A 排队时的渲染行（`d7d1d5b0`、`fff55afa`）不在 `messages()` 里；Active Branch 的 tip 在它排队后就变了，说明已经确认采集。

待查：什么情况下宿主会 `popAll`，而且撤回的文本不回到输入框。
