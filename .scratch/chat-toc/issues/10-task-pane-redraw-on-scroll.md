# 实测 Pane 随 Current position 重绘的方式

Type: task
Status: resolved
Blocked by: 

## Question

transcript 站点的 render hook 里写 `$.state` 会被拒（见「实测 requestId 与 transcript 行身份的对应」），那么 transcript 滚动、Current position 改变时，停靠 Pane 怎么重画？在 2.1.287 与本机版本上实测：在 transcript 站点的 render hook 里调 `$.ui.invalidate('ui.render')`（或在 hook 返回后再调）是否允许、会不会自我循环；它让本插件挂钩的每条 transcript 行都重跑，几百轮会话里连续滚动时的帧率和卡顿如何（每秒 30 次的上限内）；有没有更窄的办法，比如只在 Current position 真变化时才 invalidate、Pane 自己读模块变量。产出可行的重绘方式和实测数字；如果都不可行，按「决定是否做当前位置高亮」的退路拿掉高亮。

## Answer

**结论：用 `$.state` 驱动 Pane 重绘。** transcript 站点的 render hook 算出 Current position；只有它真的变了，才用 `$.clock.after(0, …)` 把新值写进一个 atom。Pane 的 render hook 读这个 atom，所以只有 Pane 重画，transcript 行不会跟着重跑。2.1.287 和 2.1.295 上 6 次运行（每个版本 3 次）都没有报错。中位延迟 6–7 ms，p95 在 51–58 ms。连续滚动时，transcript hook 的运行次数和不重绘的基线一样。高亮保留，不用退回去拿掉。

### 怎么测的

- 本机 2.1.295，加上 npm 装进会话临时目录的 2.1.287。全屏布局，170×44 伪终端，用 pyte 读屏，SGR 滚轮驱动；关掉本机全部插件。
- 合成一份 300 轮的 transcript 再 `--resume`：每轮 1 条 prompt、1 次 Bash、1 段 5 行回复，共 1200 行、1.08 MB。全程不调用模型。每次运行前重新生成，免得 `/rpd` 的行混进去。
- 探针 mod 挂在 `UserMessage`、`AssistantMessage` 上，按文本里的 `T###` 求「在屏行中最小的轮号」作为 Current position。停靠 Pane 画 300 个 Button，按 `RP_MODE` 切换重绘方式。每次运行：先空闲 5 秒，再滚轮上滚 80 格（40 格/秒）、下滚 80 格，最后上滚 150 格（约 250 格/秒），记下进程树 CPU 秒数、屏幕稳定时间、屏上顶行与 Pane 显示值。hook 侧记录每次 Current position 变化到 Pane 画出该值的延迟。
- 附件：[探针 mod 与脚本](../assets/10-redraw/)、[汇总表](../assets/10-redraw/summary.txt)、[逐次结果](../assets/10-redraw/results.jsonl)、[逐次日志](../assets/10-redraw/logs/)。

### 各方式实测（中位数；off、sync、micro-state、after-state、poll-state、loop 每版 3 次，其余只在 2.1.287 跑 1 次）

| 方式 | 是否允许 | 上滚 80 格的 CPU 秒（287 / 295） | transcript hook 运行次数 | Pane 延迟 中位 / p95 |
|---|---|---|---|---|
| off：不重绘（基线） | — | 1.30 / 1.39 | ~1750 | Pane 停在旧值 |
| sync：在 render hook 里、值变了才 `$.ui.invalidate('ui.render')` | 允许，不报错、不自循环 | 2.70 / 2.85 | ~3500（翻倍） | 6 / 26–35 ms |
| micro：同上，放进 `Promise.then` | 允许 | 2.51 | ~2960 | 6.5 / 107 ms |
| after-inv：同上，放进 `$.clock.after(0)` | 允许 | 2.74 | ~3640 | 7 / 97 ms |
| poll-inv：`$.clock.every(50)` 轮询模块变量，变了就 invalidate | 允许 | 2.79 | ~3700 | 14 / 49 ms |
| micro-state：在 `Promise.then` 里写 `$.state` | **偶发被拒**：每次运行 3–12 次 `state.set: denied: … while ui.render is being dispatched` | 2.39 / 2.43 | ~1780 | 6 / 47–50 ms |
| **after-state：在 `$.clock.after(0)` 里写 `$.state`** | **允许，0 错误** | **2.42 / 2.26** | **~1590**（不增加） | **6–7 / 51–58 ms** |
| poll-state：`$.clock.every(50)` 轮询，变了就写 `$.state` | 允许，0 错误 | 2.08 / 2.35 | ~1670（不增加） | 22–23 / 60–88 ms |
| loop：render hook 里每次都 invalidate | 允许，但**自我循环** | 11.9 / 11.8 | ~29 000 | 屏幕始终不稳定 |

- 37 次非基线运行，结束时 Pane 显示的值都等于最后一次 Current position。滚动中间的值会被合并跳过（每次运行 3–13 个），宿主声明 invalidate 每秒最多 10 次，停靠 Pane 和 band 最多 30 次，更快的调用会合并。屏上读到的 Pane 值和顶行要么一致，要么差 1：差的那一行在宿主的置顶 prompt 条底下，算法把它计入了，归组规则仍按「决定是否做当前位置高亮」。
- 三种滚动下，所有方式（loop 除外）的屏幕都在送完滚轮事件后 0.12 秒内稳定，40 格/秒和 250 格/秒都看不出跟不上。这只说明终端输出没有积压，**没有量到人眼帧率**。
- 空闲成本：基线和 after-state 是每 5 秒 0.25–0.30 CPU 秒（不是 0：基线本身就有这么多）；poll 系列每 5 秒 0.33–0.39 CPU 秒，比基线高约 2% 的一个核；loop 是 2.4 CPU 秒，接近半个核，而且一直不停。
- 两种 state 方式比基线多出的 CPU（上滚 80 格多约 1 秒）来自 Pane 自己重画：约 100 次，每次画 300 个 Button，估计每次约 10 ms。这笔开销留给「长会话的渲染与性能」：Pane 只画可见窗口，或者限制重画频率。

### 实现时要注意

- 写法：transcript render hook 里先比较新旧值，变了才调用 `$.clock.after(0, () => update($, atom, () => cp))`，然后照常 `return next(e)`。Pane 用 `read($, atom)` 订阅这个 atom。不要在 render hook 里直接写，也不要用 `Promise.then` 写：会偶发被拒，被拒的那次 Pane 会停在旧值，直到下一次变化。
- 不要无条件调用 invalidate：宿主不会拦下这个循环，它会一直占着约半个核。
- 这个 atom 只是本进程的派生值，热重载后由 transcript 行重新绘制时重新算出，不需要持久化。
- 2.1.287 的停靠 Pane 没有标题行，第 0 行就是正文；2.1.295 第 0 行是标题行。原型排版要两版都看。
- 测试残留：合成 transcript 写在 `~/.claude/projects/-private-tmp-…-scratchpad-proj/`，测完已删除。
