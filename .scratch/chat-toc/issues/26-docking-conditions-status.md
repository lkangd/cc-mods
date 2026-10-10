# 26: 停靠条件与状态栏说明

**What to build:** 终端不够宽或没用全屏布局时，使用者不会看到一个放错位置的目录，而是在状态栏看到原因与满足条件的方法；条件满足后目录自动停靠、说明消失。使用者用 `/chat-toc` 主动打开时，照宿主的放置结果接受 inline。

规格见 [chat-toc MVP](../spec.md) §2。

**Blocked by:** 18（独立 verifier 与 PTY 验收驱动）、20（Pane 生命周期）

**Status:** ready-for-agent

- [ ] 只在 `viewport.isFullscreen` 为真时自动打开
- [ ] 自动打开得到 `isPlaced:false` 时 Pane 保持等待、不画，状态栏常驻说明原因与方法；落座停靠后 `$.ui.status(undefined)` 清除
- [ ] `/chat-toc` 在不能停靠时照宿主放成 inline，不关不拦，状态栏照常说明怎样才能停靠
- [ ] 停靠着的 Pane 在终端变窄后被宿主改成 inline（`placement` 不再是 `dock`）时，插件关闭它（`origin: plugin`，不记「已关闭」）并显示状态栏说明，条件恢复后按自动打开规则再打开；`/chat-toc` 那一次 inline 例外
- [ ] 阈值由宿主决定，不写死列数；PTY 只在 `isPlaced` 翻转两侧取样（CT-COMPAT-003，按「定稿兼容与验收契约」的后续修订）
- [ ] 在验收里实测并记录宿主在停靠后变窄时的实际行为
