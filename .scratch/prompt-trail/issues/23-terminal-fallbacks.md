# 23: 在终端限制下保持时间线可用

**What to build:** 让 Prompt Trail 在窄终端、宿主拒绝自动焦点或滚动、以及 AskUserQuestion 占用 UI 时仍有完整、可解释的键盘和鼠标使用路径。

**Blocked by:** 20「人工确认歧义父节点」、21「连续浏览 100,000 个 Timeline Events」、22「绑定和失效 Jump Target」

**Status:** resolved

- [x] 方向键选择、Enter 激活、鼠标 hover 与点击是受支持路径，并能仅靠这些输入遍历和激活完整时间线。
- [x] Ghostty/宿主不发送 `ui.scroll` 时功能仍完整；触控板/滚轮不写入支持承诺。
- [x] PageUp/PageDown/Home/End 只有真实终端验收通过时才列为支持，否则保持明确不承诺。
- [x] 展开不声称自动获得键盘；界面提示使用 `ctrl+x tab` 或鼠标取得焦点。
- [x] Esc 只把键盘还给 composer，列表可以保持展开；标题或裸 `/prompt-history` 才可靠折叠。
- [x] 每个 Prompt Entry 先把换行压成 `↵`，再按 terminal cell 宽度处理 CJK、emoji 与组合字符，始终只占一行。
- [x] 低于 28 列或 6 行时只显示折叠控制与空间不足提示；恢复尺寸后展开、选择、旧位置和新条目计数保持。
- [x] `tool.call(AskUserQuestion)` 的整个 `next(e)` 生命周期内让出 AbovePrompt，结束后恢复原展开和选择状态。
- [x] 不宣称自动仲裁第三方插件的 AbovePrompt 槽位；检测不到的竞争被记录为兼容限制。
- [x] plugin test 覆盖 render tree、尺寸和让出状态；真实 PTY 覆盖实际按键、鼠标、resize、AskUserQuestion、无滚动和 Pane 焦点。

## Comments

### 实现层面对齐（2026-09-27）

现状：条目已是 `Button plain`，点击、Enter 可激活，hover 反色由宿主提供；多行已压成 `↵`，按 cell 宽度截断；band 在底部时标题行有「↑ 点此向上浏览 · 底部不响应触控板」。缺的是焦点提示、窄终端降级、AskUserQuestion 让出，`hasSurvey` 也没处理。宿主事实（2.1.283 类型）：`Button` 没有 `wrap`，单行只能靠插件自己截断；树高于 band 时，宿主把方向键、页键（`by` 为 `bodyRows`）和 Home/End（`by` 为 `contentRows`）作为 `ui.scroll` 交给插件，树不超高时一个都不送；`$.ui.ask` 本身是一次 `AskUserQuestion` 的 `tool.call`。

- **焦点提示**：标题行右侧常驻暗色 `ctrl+x tab 键盘选择`，只描述操作方法，不描述焦点状态（Esc 离开时插件观察不到）。与向上翻页提示同行时，翻页是可点的 Button、提示是 Text，两者分开；宽度不够时先整段去掉焦点提示。
- **只用鼠标向上**：视图上方还有行时，标题行都显示向上翻页的 Button；不在底部时文案不带「底部不响应触控板」。向下不另加控件：点「↓ N 条新条目」，或折叠后再展开，回到最新。支持路径是方向键遍历加点击或 Enter 激活，触控板不写进承诺。
  > 2026-10-07 backlog 清理后已改：视图上下都画占位行，宿主的 `n more` 显示真实的「↑ a more · ↓ b more」，到底也能用触控板；标题行的「↑ 点此向上浏览」按钮已删除，方向键可达首尾（spec #41）。
- **窄终端**：`bodyColumns < 28` 或 `maxRows < 6` 时，展开状态只画一行「▾ Prompt Trail · 空间不足」，点击折叠；折叠状态照常画「▸ Prompt Trail」。窗口、视图锚点、新条目计数和环所在条目都留在内存。尺寸恢复后，band 仍持有键盘时环回到原条目，不持有时不强求。
- **让出**：`tool.call(AskUserQuestion)` 在 `next(e)` 外面计数，用 try/finally 归还。计数大于 0 或 `hasSurvey` 为真时，band 的 render 直接 `next(e)`。插件自己的 `$.ui.ask`（对账）同样让出。结束后恢复展开状态与视图；焦点不恢复，对话框关闭后本来就回到输入框。权限确认、plan 确认等宿主对话框不在范围内，与第三方插件争用同一槽位一样，记为兼容限制。
- **宽度**：按字素簇计宽，带 FE0F 或 ZWJ 的 emoji 簇算 2 格；补全组合标记（1AB0–1AFF、1DC0–1DFF、20D0–20FF、FE20–FE2F、200D）；截断不切开簇。移到纯函数模块，单元测试覆盖。现状的主要缺口是 `❤️` 这类「文本字符加 FE0F」被算成 1 格，导致换行。
- **页键**：不改代码，不写进承诺。PTY 实测，把结果写进 Answer，注明到底时宿主不送这些键。
- **Esc**：由宿主处理，插件不做任何事；PTY 确认 Esc 后列表保持展开。

### 实现中修订（2026-09-27）

与上面「实现层面对齐」不同的地方，都经使用者确认（PTY 在 2.1.283 上发现）：

- **页键（修订 Q6）**：对齐时说「树不超高时宿主一个都不送」，这对页键不成立。类型原文里「宿主还有行可滚时」只限定方向键；Issue 21 实测「一个 `ui.scroll` 都不送」时，测的是方向键和触控板。实测 PageUp/PageDown（Mac 上用 fn+↑/↓）在底部与非底部都能翻页，因此列为支持。Home/End 按整棵树的高度移动视图，只能移到已加载窗口的边上并加载下一批，到不了最前或最后，不承诺。代码没有改动。

## Answer

Prompt Trail 在窄终端、宿主不送滚动、AskUserQuestion 占用槽位时，仍有一条完整的键盘和鼠标路径。实现在 `2d1d3ea`，review 修复见下；与对齐结论不同的地方见上方「实现中修订」。

- **支持路径**：方向键逐条遍历，Enter 或点击激活，鼠标 hover 时条目反色（宿主提供）；PageUp/PageDown 按页翻动。视图上方还有行时，标题行在两种状态下都有向上翻页的按钮（在底部时写明「底部不响应触控板」），所以只用鼠标也能往上翻；往下靠「↓ N 条新条目」，或折叠后再展开。触控板和 Home/End 不写进承诺。
- **焦点提示**：标题行右侧常驻暗色的 `ctrl+x tab 键盘选择`，不描述焦点当前在哪；没有可选的条目时不显示；宽度不够时整段去掉，优先保留向上翻页的按钮。Esc 由宿主处理，把键盘还给输入框，band 保持展开；折叠靠标题或裸 `/prompt-history`。
- **单行**：宽度计算移到 `hooks/cells.ts`，按字素簇计宽：组合标记、变体选择符、肤色、tag 字符并入前一个字符；ZWJ 序列和国旗算一个单位；带 FE0F 的簇算 2 格。截断不会切开一个簇。父节点确认 Pane 也用这套计宽。
- **窄终端**：`bodyColumns < 28` 或 `maxRows < 6` 时，展开的 band 只画一行「▾ Prompt Trail · 空间不足」，点它照常折叠或展开。窗口、视图锚点、新条目计数都留在内存里；尺寸恢复后，环回到原来的条目（band 不再持有键盘时，宿主会拒绝，没有副作用）。
- **让出**：`tool.call(AskUserQuestion)` 在 `next(e)` 外面计数，用 try/finally 归还。计数大于 0 或 `hasSurvey` 为真时，band 的 render 直接 `next(e)`。插件自己的 `$.ui.ask` 也会经过这个钩子。
- **兼容限制**：宿主的权限确认、plan 确认等对话框不在让出范围内；和第三方插件争用 AbovePrompt 时，插件检测不到，也不做仲裁；终端对 ZWJ 序列、国旗的画法各不相同，这里按画成一个 emoji 计宽，只在使用者的终端上实测过。
- **宿主事实**（2.1.283）：
  - `Button` 没有 `wrap`，单行只能靠插件自己截断；
  - 方向键只在树高于 band 时经 `ui.scroll` 交给插件；页键在两种状态下都送（`by` 为 `bodyRows`），Home/End 的 `by` 为 `contentRows`；
  - `hasSurvey` 仍不随 AskUserQuestion 生效；
  - band 让出期间，引擎在这个槽位里什么都不画。
- **给后续实现者**：
  - `renderBand` 新增 `bodyColumns`、`hasSurvey` 两个参数；
  - `TargetOptions.askHold` 让 AskUserQuestion 替身等到它 settle 再作答，Promise reject 就相当于对话框失败；
  - band 让出后，测试里要注册一个画空 `Box` 的宿主替身，返回 `null` 会被引擎拒绝；
  - `long_timeline` 的 `band()` 把向上翻页按钮排除在 `labels` 之外，只保留在 `keys` 里。

一轮 `/code-review` 找到 8 条（`.code-review/runs/20260927-141958/round-1/`）：
- **修了 6 条**：只认识部分组合标记，截断会拆开阿拉伯文的字母和元音符号，改用 `\p{M}`，Mc 按 wcwidth 算 1 格；survey 占着 band 时，插件仍接管 `ui.scroll`/`ui.focus`（两条合并），让出期间改为直接 `next(e)`；窄屏下新条目计数撑满标题，把向上按钮挤出屏幕（两条合并），改为放不下时标题去掉计数（计数仍在「↓ N 条新条目」行），标题与按钮都按宽度截断；截断改为只读到截断点。
- **驳回 2 条**：不带 FE0F 的键帽序列不属于 RGI emoji，宿主与 wcwidth 都按 1 格计；标题行重复计宽只是三段短字符串的成本。
- 测试引擎不把插件站点的 `ui.scroll` 交给测试替身，「让出期间放行」只能用「band 视图没被移动」间接断言。

门禁：`2.1.273`/`2.1.283` 各 **286** 项 plugin tests、8 静态、32 bridge、70 helper，TypeScript 与确定性重建全部通过。真人 PTY 在 2.1.283 上通过：焦点提示与键盘遍历、Esc 后保持展开、只用鼠标逐页上翻、40 列下含 emoji 和中日韩文字的条目保持单行、窄屏降级与恢复、AskUserQuestion 回答或 Esc 后 band 恢复原状、PageUp/PageDown 两种状态都能翻页；review 修复后复验正常。父节点 Pane 的焦点已在 Issue 20 验证。
