# 38: 以真实 PTY 证明时间线 UI 场景

**What to build:** 为 `PT-UI-001..008` 编写自动化 PTY 场景：折叠与展开、顺序与边界、新条目、连续浏览、滚动拒绝降级、长历史、窄终端（28 列与 6 行两侧）与 AskUserQuestion 让出，在两个版本上产出证据。

**Blocked by:** 31「生成零跳过发布证据」

**Status:** ready-for-agent

- [ ] 焦点、按键、鼠标 hover/点击、resize 与 AskUserQuestion 让出均由 PTY 断言，颜色从模拟屏幕读取。
- [ ] 长历史场景与 benchmark 证据共同覆盖 `PT-UI-006`。
- [ ] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。
