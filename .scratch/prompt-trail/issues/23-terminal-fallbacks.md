# 23: 在终端限制下保持时间线可用

**What to build:** 让 Prompt Trail 在窄终端、宿主拒绝自动焦点或滚动、以及 AskUserQuestion 占用 UI 时仍有完整、可解释的键盘和鼠标使用路径。

**Blocked by:** 20「人工确认歧义父节点」、21「连续浏览 100,000 个 Timeline Events」、22「绑定和失效 Jump Target」

**Status:** ready-for-agent

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
