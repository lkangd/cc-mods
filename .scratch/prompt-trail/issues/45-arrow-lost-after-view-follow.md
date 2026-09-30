# 45: 2.1.273 上视图跟随焦点时偶尔丢一次方向键

**What to build:** band 的视图高于槽位时，方向键经 `ui.scroll` 交给插件，`stepRing` 把焦点移到下一个 stop。目标行在视图外时，插件设 `pendingFocus`、重画，再在 `$.clock.after(0)` 里对新帧调用 `$.ui.focus`，成功后才更新 `ringKey`。在 2.1.273 上，这次 `$.ui.focus` 偶尔被宿主拒绝，理由是 `no element of its own is drawn under that key`（新帧还没提交）。宿主按位置保留焦点环，所以屏幕上焦点已经在新行上，`ringKey` 却还停在旧行。下一次 ↑ 从旧行出发，目标正好是焦点已经在的那一行，屏幕不变：这一下按键就丢了。

**Blocked by:** 21「浏览长时间线」

**Status:** resolved

- [x] 先写 plugin test，模拟「render 路径的 `$.ui.focus` 被拒绝」：之后一次方向键仍把焦点移到下一个 stop，没有一次按键落空。在原代码上确认变红。
- [x] 修复（方向实现前与使用者对齐，例如被拒后在下一帧重试、重试有上限；或按宿主「按位置保留焦点」的规则同步 `ringKey`）。
- [x] PT-UI-002、PT-UI-004、PT-UI-006 在 2.1.273 与 2.1.283 上都通过：它们的 `walk` 要求每次按键都把焦点移到相邻的 stop，不容忍丢键。

## Answer

- **方向（与使用者对齐）**：重试，并从目标行出发。
- **修复**（`hooks/register.tsx`）：
  - render 路径把焦点送往某一行时，先把 `ringKey` 设为这一行，再调用 `$.ui.focus`，所以下一次方向键从这一行出发。`stepRing` 设 `pendingFocus` 时也同步 `ringKey`，这样两次按键之间 band 还没重画，第二次按键也照样前进。
  - 新增 `sendRing`：每次发送前（包括重试的定时器触发时）先确认 `ringKey` 仍是这一行，不是就放弃。被宿主拒绝（`deny`、同步或异步抛错）时，隔 50 ms 再送一次，最多 3 次。宿主按位置保留焦点环，重试是为了让宿主的焦点环与 `ringKey` 重新一致。
  - `ringKey` 的注释改为「最后一次移动留下的位置，或最后一次重画送去的那一行」。
- **测试回路**：测试引擎拒绝插件自己调用的 `$.ui.focus`（no implementation，Issue 21 已记），效果等同于「宿主拒绝」，所以不用改 `tests/support.tsx`。support 里的测试 hook 看不到插件自己发起的 focus，而且 `on("ui.focus")` 在测试侧只能注册一次。
- **plugin test**（`tests/long_timeline.test.tsx`，两条都在原代码上变红）：
  - `each arrow walks on from the row the view followed to, even while the engine refuses the ring there`：视图上方连按三次 ↑，视图首行依次是 584、583、582。原代码三次都停在 584。
  - `arrows pressed faster than the band draws each walk a row`：两次 ↑ 之间不重画，首行是 583。只撤掉 `stepRing` 里同步 `ringKey` 的那一行，这条就变红。
  - 重试本身没有测试覆盖：测试引擎里插件的 focus 一律失败；PTY 也没有单独撤掉重试做对照。
- **PTY**：PT-UI-002、004、006 在 2.1.273 与 2.1.283 上都通过，0 泄漏。修复前 2.1.273 三次都失败。UI-004 在两个版本上各走了 297 个 stop 上去、296 个下来；UI-006 在 2.1.273 上的 p95：展开 252 ms，跨批按键 145 ms，新条目 197 ms。
- **契约**：scenarios.json 的 PT-UI-004 引用上面两条 plugin test。

## Comments

### 2026-09-30 · 从 Issue 38 拆出

PT-UI-002/004/006 在 2.1.283 上通过：UI-006 快速连按约 1,500 次，没有一次落空。在 2.1.273 上三次运行都失败于「a up press did not move the ring」，失败位置不固定；每步之后多等 1 s 也照样失败，所以不是等待时间不够。

插件里临时加了日志（`$.store` 取出，只记 key 前 8 位），失败前的最后几条：

```
step by=-1 from=Paa8c8f76 to=Pa4d440ef shown=false
render focus to=Pa4d440ef deny=no element of its own is drawn under that key
scroll by=-1 arrow=true ring=Paa8c8f76 fits=false
step by=-1 from=Paa8c8f76 to=Pa4d440ef shown=true
focus el=Pa4d440ef origin=plugin ring=Paa8c8f76 fits=false
focus done el=Pa4d440ef deny=undefined
```

在此之前，同样的 render 路径 focus 连续成功了多次（`deny=undefined`），所以这是时序竞态，不是必现。使用者决定：拆本票先修，PT-UI 场景保持严格；本票修好之前，Issue 38 不 resolve。
