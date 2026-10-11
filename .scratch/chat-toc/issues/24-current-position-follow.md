# 24: Current position 高亮与 TOC 跟随

**What to build:** 目录用青色高亮使用者正在看的那一轮，并自动滚到它；跳转后高亮锁在目标组直到视口再次变化；手动翻目录时暂停跟随并显示「暂停」，下一次 transcript 视口变化时恢复；在后台标签时不画，回到前台第一帧就跟上。

规格见 [chat-toc MVP](../spec.md) §6、§2（共存）。

**Blocked by:** 23（完整跳转：Agent 侧、兜底与被拒）

**Status:** resolved

- [x] 只看 `UserMessage`、`AssistantMessage`、`CommandOutput`、`ToolGroup` 的在屏上报；报 `null` 的记录直接删掉；可绘制行有序数组只在读完和新行画出时重建
- [x] 在屏行按对话顺序分段，只采信包含最近一次上报的那一段、取最靠前的行，归到所属组（不属于任何组时归前一组）；夹没夹着不在屏的可绘制行用二分查找判断
- [x] 最后一个画出的行完整可见时强制末组；跳转成功后锁定目标组，跳转引起的重绘停下后视口第一次变化就解锁（CT-POS-001）
- [x] 连续滚轮 180 格后，高亮与屏幕第 1 行所属的组一致（CT-POS-002）
- [x] transcript render hook 只在值真变时用 `$.clock.after(0, …)` 写 `$.state` atom，Pane 读它重画；不在 render hook 里直接写、不用 `Promise.then`、不无条件 invalidate
- [x] TOC 跟随高亮；手动滚动 TOC 或 Pane 聚焦时暂停，底栏显示「暂停」；Current position 下一次变化时恢复（CT-POS-003）；滚动由插件自管，不用 `$.ui.scroll({ to: "end" })`
- [x] 不在前台（`isShown === false`）时 Current position 变了就撤销暂停，回到前台第一帧即跟随（CT-COEX-001）
- [x] 热重载后映射在读完 transcript 后重建，跳转与高亮仍正确（CT-LIFE-006）
- [x] 高亮与 ↑↓ 选择光标独立绘制
- [x] 若「View filter、三种 Layout 与键盘」已完成，补上「无选择光标时 Layout 切换以 Current position 所在组为锚」
- [x] 自动化测试覆盖连续段算法；PTY 验收上述场景在两个版本上通过

## Comments

2026-10-11，分支 `chat-toc/24-position`（基于 `chat-toc/mvp` ce384e1，已合入 3f38f30）。

- **代码**：`hooks/position.ts`（纯函数）：可绘制行有序数组 `drawableRows`（读完重建）与 `addDrawable`（新画出的行二分插入）、`trustedRun`（按对话顺序切段，两行之间有不在屏的可绘制行就切开，用二分查找判断；取含最大 `seq` 的一段）、`positionOf`（锁定 > 末行完整可见强制末组 > 段首行所属组；组用开组行位置二分 `groupOfRow`，组前的行不亮）、跳转锁 `lockOn`/`viewChanged`/`quietAfter`（300 ms 静默由 `$.clock.after` 计时，测试可控）。`window.ts` 加 `topFollowing`。`register.tsx`：站点 render hook 里 `sawSite` 记录上报后 `place()` 重算，值变了才 `$.clock.after(0)` 写 `$.state` 新键 `currentGroup`（-1 表示不亮）；Pane 读它画 `litGroup`、决定跟随；`load()` 读完后重建开组表、可绘制行、最后画出的行再重算（热重载时先画后读也由此恢复）；跳转成功 `lockAfterJump`。
- **跟随与暂停**：未暂停时窗口跟随高亮组（末组或无高亮时跟随最新；高亮组首条目已在窗口内就不动，否则让它成为窗口第 2 条）。手动滚 Pane → 暂停；Pane 聚焦期间一直暂停（聚焦开始即置暂停，失焦后等 Current position 下一次变化才恢复；聚焦期间的变化在失焦后的第一帧就算「下一次变化」）。底栏「暂停」排在被拒说明、数据源说明之后。Pane 在后台标签（`$.ui.panes()` 的 `isShown === false`）时高亮变了直接撤销暂停，只在已暂停时才查 `panes()`。
- **Layout/过滤切换的锚**：有选择光标 → 光标所在组（原逻辑）；无光标且在跟随 → 不设锚（跟随本身把高亮组留在窗口里）；无光标且暂停 → Current position 所在组，在窗口外才挪窗口，暂停状态不变；没有高亮 → 窗口顶部那组（原逻辑）。
- **取舍 / 宿主事实**：
  - 可绘制行只算「宿主一定在站点上画的行」：prompt（`UserMessage`）和带文字的 assistant 行（`AssistantMessage`），再加任何被站点画出过的行。**`--resume` 打开的会话里本地命令的输出行（`system/local_command` stdout）不走 `CommandOutput` 站点**（探针实测：resume 300 轮、滚过 `/tui` 时 `CommandOutput` hook 一次也没被调用；本会话里新跑的 `/diff` 则走），如果事先把它算作可绘制行，它永远不在屏，会把它前后的在屏行切成两段，向下滚动时高亮跳到下一组（PTY 首轮 CT-POS-002 就这样失败过）。工具行同理只在画出后才算。
  - 由此的已知限制：`!cmd` 那一组（任何时候都没有站点）以及 resume 会话里本地命令那一组，屏幕最上方只露出这些行时高亮落在下一组。规格的算法只看四个站点，本来就看不到这些行；PTY 判据因此按「从第 1 行往下第一条 prompt/回复行」取组（`sitedTop`），同时记录逐字的第一行（`top`），两版各出现过一次二者不同（都在 `/tui` 组顶上）。已写进根 README 草稿「青色高亮」一条。
  - 「视口变化」= 某站点的 `onScreen` 与已记录的不同（新出现、数值变化、报 `null`）；同值重报不算变化（不解锁、不重算外的副作用），但会刷新 `seq`，因为宿主真的在画它。
  - `onScreen` 记录不随时间清理：长时间滚动后残留记录变多，每次上报的重算是 O(n log n)，留给 27 号测长会话时看。
- **测试**：新增 `tests/current_position.test.ts`（10 个：切段、二分、可绘制行、归组、末组强制、锁定、无高亮）与 `tests/follow_position.test.ts`（10 个：亮哪组且两侧都亮、残留在屏值不误导、`null` 删除、末行完整可见强制末组、滚 Pane 暂停与恢复、同值重画不恢复、聚焦暂停与失焦后跟随、后台标签时变化撤销暂停（卸下 Pane 模拟后台不画；去掉 `isShown` 分支该测试即失败）、无光标切 Layout 以高亮组为锚）。底栏多了「暂停」一行，`focus_ring.test.ts`、`toc_window.test.ts` 各一个窗口行数的期望随之调整。跳转锁只能测纯函数：test kit 拒绝插件的 transcript 跳转（同 23 号）。`claude plugin test` 185 通过；两版 `validate`、两版 `tsc` 干净；验收单元测试 43 通过。
- **PTY**：`tests/acceptance/position_scenarios.py <版本> [pos1 pos2 pos3 coex life6]`（pyte、隔离环境、`--resume` 合成 transcript、不调用模型）。2.1.295 与 2.1.287 全部通过，run 目录 `mods/chat-toc/build/pty-runs/20261011-133127-CT-POS-current`、`20261011-133338-CT-POS-2.1.287`（gitignore）：
  - CT-POS-001：末尾时亮末组；点 `/tui`（兜底跳转居中，视口顶部是前一组）后亮 `/tui` 那组，1 秒后仍锁定；随后滚 transcript 2 格即解锁、亮顶部那组。
  - CT-POS-002：连续上滚 180 格、下滚 90 格、再 12 次各下滚 7 格、再以约 100 格/秒上滚 180 格，每一停都与第 1 行所属组一致（末行完整可见时为末组）。
  - CT-POS-003：上滚 60 格后高亮组在 Pane 窗口内；滚 Pane 后底栏「暂停」、窗口 1 秒内不动；transcript 滚到另一组后「暂停」消失、高亮回到窗口；`/chat-toc`（Pane 拿到键盘）显示「暂停」。
  - CT-COEX-001：临时项目 `git init` 一份带改动的仓库（否则 `/diff` 只回一句「不在 git 仓库」不开面板）；`/diff` 开在前台 → 点「目录」标签、滚 Pane 暂停 → 点「Diff」标签使目录到后台 → 滚 transcript → 点「目录」标签：第一帧没有「暂停」、亮的是新位置那组。
  - CT-LIFE-006：改 `--plugin-dir` 下模块触发热重载（同 `ct_life.py`）后高亮仍对、滚一下仍对；点窗口里另一条的用户侧，prompt 落在顶部、高亮跟到该组。
  - 回归：CT-JUMP-001～003、CT-COMPAT-003 五项、CT-LIFE 001/002/fork、`chain_scenarios.py` 全部两版通过，harness smoke 两版通过。CT-JUMP-003 的脚本改了一处：rewind 后 transcript 视口停在上方，目录现在跟随它，所以先滚 Pane 找到被弃的 T0011 再点（之前目录停在末尾，直接能看到）。
- **文档**：照 28 号 Comments 的清单重查了依赖本票的句子：根 README 草稿操作表的滚轮一行（改为滚动即暂停，不再「滚到底后回到跟随」）、「青色高亮」（补 `!` 命令与 resume 本地命令的限制）、「跟随与『暂停』」（恢复条件改为高亮换到别的一轮；补后台标签回前台即跟上）；`mods/chat-toc/README.md` 场景表加 `position_scenarios.py`，「还没有脚本」去掉 CT-POS、CT-COEX-001、CT-LIFE-006。「切换时……没有选择时是正在看的那一轮」一句现在属实，未改。
- **未做**：人工目检（青色高亮与反色光标能否分清）留给发布；cmux 下未跑（pyte 足以读青色与屏幕，整列表比对 harness 也建议 pyte）。
