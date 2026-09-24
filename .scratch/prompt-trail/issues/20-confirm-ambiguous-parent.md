# 20: 人工确认歧义父节点

**What to build:** 当 transcript 无法唯一映射到历史分支时，阻止本次提交并让使用者在聚焦 Pane 中选择父 Prompt Entry 或新根，然后恢复原草稿等待再次提交。

**Blocked by:** 15「对账中断的 Pending Capture」、19「rewind 后建立新 Conversation Branch」

**Status:** resolved

- [x] 多个历史分支具有相同前缀、内部 `user` row 冲突或 transcript 无法唯一映射时，插件不自动选择父节点。
- [x] 首次歧义 composer submission 被 drop，完整草稿只保存在当前进程内存，不写入日志、locator 或诊断。
- [x] 插件打开 `focus: true` 的 Pane，列出可区分的候选父 Prompt Entries 与“新根分支”，且不展示不必要的完整敏感文本。
- [x] Pane 初始取得焦点，方向键、Enter、鼠标 hover/点击都能选择候选。
- [x] 确认后先关闭 Pane，再通过 `$.prompt.fill()` 原样恢复草稿；插件绝不自动重提。
- [x] 未选择、取消或再次尝试提交时保持阻止状态，不能默认采用第一个候选。
- [x] 选择候选后，下一次人工提交使用该父节点；选择新根时建立新的根 Conversation Branch。
- [x] 确认流程与 Pending Capture 对账状态互斥且可解释，不会把被 drop 的歧义草稿误记为 Prompt Entry。
- [x] plugin test 验证候选、焦点、取消、选择与草稿恢复；真实 PTY 证明 Pane 焦点和 `isFilled` 行为。

## Comments

### 2026-09-24 · 实现层面对齐（grilling 一轮，使用者均采用）

- **范围**：只把 `alignBranch()` 的父节点确认从 `$.ui.ask` 换成 Pane；`reconcilePending()`（Issue 15 的对账）仍用 `$.ui.ask`。
- **再次提交**：待确认期间每次提交都重新对齐（`messages()` + helper）。仍歧义则 drop，用最新提交文本替换内存草稿，刷新候选并重新打开/聚焦 Pane；已能唯一确定则关闭 Pane 并正常放行。
- **取消**：Pane 以对话框方式打开（`focus`、`closeOnEscape`、`holdToasts`）。使用者关闭（Esc 或关闭标记）即取消：立即 `fill` 回草稿，阻止状态不变，下一次提交按上条重新弹出。
- **候选**：列出 settlement 的全部候选（已存父节点置首，helper 至多 8 个），末尾「新根分支」；helper 计数但未列出的候选另起一行计数。每项单行 `#序号 首行文本`，按 Pane 宽度截断；窗口外的候选显示 `#序号 事件 xxxxxxxx`。方向键/Tab 走宿主对话框焦点，Enter 或点击确认，hover 只高亮。
- **失效与互斥**：待确认状态（branch key、候选、草稿）只在模块变量里。session 变化、模块热重载（Pane 画「已失效，请重新提交」并异步关闭）、下一次提交先遇到需要问人的对账（先关 Pane、作废选择，再弹对账，之后重新对齐）都会作废它。选定时写 `$.store` 失败：Pane 不关，显示一行错误，保持阻止。
- **兜底**：`$.ui.open` 被拒或抛错 → 回填草稿并 drop「无法打开确认面板」，保持阻止；确认后 `fill` 回 `isFilled: false` → toast「草稿未能恢复，请重新输入」，不重试。
- **测试接缝**：`support.tsx` 的 `parentAnswer`/`parentQuestions` 改为 Pane 驱动（下层 hook `ui.open`/`ui.close` 记录参数，`pickParent($, label)` 经 `$.ui.render` + `$.ui.press` 选择）；现有用例改成「提交 → drop → pickParent → 重新提交」。新增 `confirm_parent.test.tsx`。helper 与 bridge 不动。真人 PTY 验证 Pane 自动聚焦、方向键/Enter/点击与 `isFilled`。

### 2026-09-24 · 实现中修订

- **使用者关闭 Pane 只能在真人 PTY 验证**：2.1.273 与 2.1.281 的测试套件（`claude-code/testing`）都没有让测试引发 `ui.close` origin `person` 的入口（`$.ui` 只有 render/scroll/focus/press 等）。Esc/关闭标记 → 回填草稿 → 下次提交重新询问这条路径，改由真人 PTY 覆盖；plugin test 覆盖「未选择就再次提交仍阻止」。
- **失效判定用实时 session id**：选定时读 `$.session.id()` 与提问时的 session 比较，而不是比较 `startup` 里的 key（`startup` 要到下一次提交才会刷新）。失效时关闭 Pane、回填草稿、toast 说明，不写 `$.store`。
- **对账互斥是结构性的**：同一次提交里 `settlePending` 先于 `alignBranch`，对账未决时提交在对齐之前就返回，Pane 不会与对账对话框同时出现；Pane 等待期间没有 capture，也就不会产生新的 Pending Capture。因此没有在 `reconcilePending` 前额外关闭 Pane，只在选定时保留 `reconcile` 仍未决则作废的防御判断。
- **连按两次**：第一次按下即标记为处理中，之后的按下忽略；实际处理放在 `$.clock.after(0)` 里，在按键派发之外关闭 Pane 再回填（沿用原型实测的顺序）。
- **hover**：宿主要求 hover 样式外层有带 key 的 Box，每个候选包在各自的 keyed Box 里。

## Answer

transcript 无法唯一确定下一条 prompt 的父节点时，提交被 drop，使用者在聚焦的「确认父节点」Pane 里选择父 Prompt Entry 或新根；选定后先关 Pane，再把草稿原样放回输入框，从不自动重发。实现在 `7a2fd65`；与对齐结论不同的地方见上方「实现中修订」。

- **流程**：只改了 `alignBranch()` 的确认方式，判定规则（Issue 18/19 的 `settleBranch()`/`chooseBranch()`）不变。Pane id 为 `prompt-trail-parent`，以 `focus`、`closeOnEscape`、`holdToasts` 打开；草稿只在模块变量里。对账（Issue 15）仍用 `$.ui.ask`，与 Pane 在结构上互斥。
- **候选**：列出全部候选（至多 9 个加「新根分支」，已存父节点置首），按单元格宽度截断到一行；helper 计数但未命名的另起一行计数。原来 `$.ui.ask` 的 3 个上限已去掉。
- **取消与再次提交**：使用者关闭 Pane 即取消，草稿回到输入框，下次提交重新判断；待确认期间再次提交会重新对齐，仍歧义就用最新文本替换草稿并重新弹出，已能确定就关 Pane 放行。保存选择期间拒绝使用者关闭 Pane。
- **给后续实现者**：
  - `claude-code/testing` 在 2.1.273 与 2.1.281 上都不能引发 origin `person` 的 `ui.close`，取消路径只能靠真人 PTY；`tests/support.tsx` 的 `parentPane()`/`pickParent()` 负责渲染 Pane 并按键。
  - 渲染树里子节点在元素的 `children` 字段（与 `props` 并列），不在 `props.children`。
  - Button 的 `hover` 必须有带 key 的 Box 包着，否则整棵树被拒绝、引擎改画自己的。
  - 要在真人 PTY 里触发确认，需跨进程 resume 一个 compact 过的 session（同进程 compact 后 `messages()` 仍保留旧行）。
  - Issue 23 的 PTY 验收里要求的「Pane 焦点」已在本票验证过。

一轮 `/code-review` 找到 6 条：修了 3 条（BMP 内按 emoji 显示的符号按 2 格截断、保存期间拒绝使用者关闭 Pane、候选 id 与标签合为一条记录）；1 条进 backlog（窗口外且未被命名的已存父节点缺序号，追加到 `20260922-bounded-persisted-timeline-view.md`）；驳回 2 条（Issue 18 为已 resolved 票的历史决定；所谓重复的宽度表只在 `.scratch` 原型里）。

门禁：`2.1.273`/`2.1.281` 各 **217** 项 plugin tests、8 静态、32 bridge、57 helper，TypeScript 与确定性重建全部通过。真人 PTY 在 2.1.281 上通过（session `b27a7bce`）：Pane 自动聚焦、方向键、Esc 取消并回填两行草稿、再次提交重新询问、hover 只高亮、点击选定后草稿回填且不自动提交、重新提交后接在所选父节点之后。review 修复后未再做 PTY。
