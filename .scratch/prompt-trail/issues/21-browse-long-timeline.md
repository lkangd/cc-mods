# 21: 连续浏览 100,000 个 Timeline Events

**What to build:** 让使用者在不分页、不全量加载的前提下连续浏览大型 Project Timeline，并在新事件到达时保持可预测的位置。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** ready-for-agent

- [ ] helper range protocol 按项目 sequence 严格升序返回，并强制固定最大批次；调用方不能请求无界全表读取。
- [ ] AbovePrompt 使用有界渲染窗口和一条更早事件作为 overscan，不随遍历无限累积已渲染节点。
- [ ] 最早可见 Prompt Entry 获得焦点时加载上一批，并保留同一个 keyed Button，使上箭头连续跨批次。
- [ ] 使用者只靠方向键即可从最新事件连续到达 Project Timeline 起点，再返回末尾；UI 不显示页码。
- [ ] Timeline Events 按 sequence 从旧到新显示，时间戳不参与排序；Prompt、Run、Clear、Collection、branch 和 Gap 边界保持正确相对位置。
- [ ] 位于底部时新 Prompt Entry 自动跟随；查看旧历史时位置不变并累计新条目提示，返回底部后提示清零。
- [ ] 构造包含多种边界和分支的 100,000-event fixture，证明查询和渲染均不全量载入。
- [ ] 在记录硬件和版本的参考机器上预热一次后重复十次，展开、加载下一批和显示新条目的 p95 各不超过 1 秒。
- [ ] plugin test 验证窗口、key 和位置状态；helper benchmark 验证 range；真实 PTY 验证连续键盘体验与新条目行为。
