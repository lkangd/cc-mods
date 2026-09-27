# 23: 在终端限制下保持时间线可用

**What to build:** 让 Prompt Trail 在窄终端、宿主拒绝自动焦点或滚动、以及 AskUserQuestion 占用 UI 时仍有完整、可解释的键盘和鼠标使用路径。

**Blocked by:** 20「人工确认歧义父节点」、21「连续浏览 100,000 个 Timeline Events」、22「绑定和失效 Jump Target」

**Status:** claimed

- [ ] 方向键选择、Enter 激活、鼠标 hover 与点击是受支持路径，并能仅靠这些输入遍历和激活完整时间线。
- [ ] Ghostty/宿主不发送 `ui.scroll` 时功能仍完整；触控板/滚轮不写入支持承诺。
- [ ] PageUp/PageDown/Home/End 只有真实终端验收通过时才列为支持，否则保持明确不承诺。
- [ ] 展开不声称自动获得键盘；界面提示使用 `ctrl+x tab` 或鼠标取得焦点。
- [ ] Esc 只把键盘还给 composer，列表可以保持展开；标题或裸 `/prompt-history` 才可靠折叠。
- [ ] 每个 Prompt Entry 先把换行压成 `↵`，再按 terminal cell 宽度处理 CJK、emoji 与组合字符，始终只占一行。
- [ ] 低于 28 列或 6 行时只显示折叠控制与空间不足提示；恢复尺寸后展开、选择、旧位置和新条目计数保持。
- [ ] `tool.call(AskUserQuestion)` 的整个 `next(e)` 生命周期内让出 AbovePrompt，结束后恢复原展开和选择状态。
- [ ] 不宣称自动仲裁第三方插件的 AbovePrompt 槽位；检测不到的竞争被记录为兼容限制。
- [ ] plugin test 覆盖 render tree、尺寸和让出状态；真实 PTY 覆盖实际按键、鼠标、resize、AskUserQuestion、无滚动和 Pane 焦点。

## Comments

### 实现层面对齐（2026-09-27）

现状：条目已是 `Button plain`，点击、Enter 可激活，hover 反色由宿主提供；多行已压成 `↵`，按 cell 宽度截断；band 在底部时标题行有「↑ 点此向上浏览 · 底部不响应触控板」。缺的是焦点提示、窄终端降级、AskUserQuestion 让出，`hasSurvey` 也没处理。宿主事实（2.1.283 类型）：`Button` 没有 `wrap`，单行只能靠插件自己截断；树高于 band 时，宿主把方向键、页键（`by` 为 `bodyRows`）和 Home/End（`by` 为 `contentRows`）作为 `ui.scroll` 交给插件，树不超高时一个都不送；`$.ui.ask` 本身是一次 `AskUserQuestion` 的 `tool.call`。

- **焦点提示**：标题行右侧常驻暗色 `ctrl+x tab 键盘选择`，只描述操作方法，不描述焦点状态（Esc 离开时插件观察不到）。与向上翻页提示同行时，翻页是可点的 Button、提示是 Text，两者分开；宽度不够时先整段去掉焦点提示。
- **只用鼠标向上**：视图上方还有行时，标题行都显示向上翻页的 Button；不在底部时文案不带「底部不响应触控板」。向下不另加控件：点「↓ N 条新条目」，或折叠后再展开，回到最新。支持路径是方向键遍历加点击或 Enter 激活，触控板不写进承诺。
- **窄终端**：`bodyColumns < 28` 或 `maxRows < 6` 时，展开状态只画一行「▾ Prompt Trail · 空间不足」，点击折叠；折叠状态照常画「▸ Prompt Trail」。窗口、视图锚点、新条目计数和环所在条目都留在内存。尺寸恢复后，band 仍持有键盘时环回到原条目，不持有时不强求。
- **让出**：`tool.call(AskUserQuestion)` 在 `next(e)` 外面计数，用 try/finally 归还。计数大于 0 或 `hasSurvey` 为真时，band 的 render 直接 `next(e)`。插件自己的 `$.ui.ask`（对账）同样让出。结束后恢复展开状态与视图；焦点不恢复，对话框关闭后本来就回到输入框。权限确认、plan 确认等宿主对话框不在范围内，与第三方插件争用同一槽位一样，记为兼容限制。
- **宽度**：按字素簇计宽，带 FE0F 或 ZWJ 的 emoji 簇算 2 格；补全组合标记（1AB0–1AFF、1DC0–1DFF、20D0–20FF、FE20–FE2F、200D）；截断不切开簇。移到纯函数模块，单元测试覆盖。现状的主要缺口是 `❤️` 这类「文本字符加 FE0F」被算成 1 格，导致换行。
- **页键**：不改代码，不写进承诺。PTY 实测，把结果写进 Answer，注明到底时宿主不送这些键。
- **Esc**：由宿主处理，插件不做任何事；PTY 确认 Esc 后列表保持展开。
