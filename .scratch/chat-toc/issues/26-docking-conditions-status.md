# 26: 停靠条件与状态栏说明

**What to build:** 终端不够宽或没用全屏布局时，使用者不会看到一个放错位置的目录，而是在状态栏看到原因与满足条件的方法；条件满足后目录自动停靠、说明消失。使用者用 `/chat-toc` 主动打开时，照宿主的放置结果接受 inline。

规格见 [chat-toc MVP](../spec.md) §2。

**Blocked by:** 18（独立 verifier 与 PTY 验收驱动）、20（Pane 生命周期）

**Status:** resolved

- [x] 只在 `viewport.isFullscreen` 为真时自动打开
- [x] 自动打开得到 `isPlaced:false` 时 Pane 保持等待、不画，状态栏常驻说明原因与方法；落座停靠后 `$.ui.status(undefined)` 清除
- [x] `/chat-toc` 在不能停靠时照宿主放成 inline，不关不拦，状态栏照常说明怎样才能停靠
- [x] 停靠着的 Pane 在终端变窄后被宿主改成 inline（`placement` 不再是 `dock`）时，插件关闭它（`origin: plugin`，不记「已关闭」）并显示状态栏说明，条件恢复后按自动打开规则再打开；`/chat-toc` 那一次 inline 例外
- [x] 阈值由宿主决定，不写死列数；PTY 只在 `isPlaced` 翻转两侧取样（CT-COMPAT-003，按「定稿兼容与验收契约」的后续修订）
- [x] 在验收里实测并记录宿主在停靠后变窄时的实际行为

## Comments

- 实现：`hooks/lifecycle.ts` 新增 `DOCK_STATUS`（四句状态栏文字）与 `placementFate(placement, isInlineAsked)`（`docked` / `asked-inline` / `withdraw`）。`register.tsx`：
  - 全屏与否从 `PromptHint` 的 `ui.render`（`surface: 'terminal'`）读 `e.viewport.isFullscreen`，存模块变量；启动事件拿不到 viewport，所以 `openUnasked` 在布局未知时只记「想打开」，等第一次画提示行再开（照官方 diff 的做法）。宿主在宽度变化、插件加载后都会重画提示行。
  - `openUnasked`：已被使用者关闭 → 不做事；非全屏 → 状态栏「mainScreen」；Pane 已开（热重载）且 `isPlaced:false` 或新开得到 `isPlaced:false` → 状态栏「narrow」。不写死任何列数，阈值看宿主的 `isPlaced`。
  - Pane 的 render 读 `e.props.placement` 与 `$.state` 新键 `isInlineAsked`（`/chat-toc` 置真，停靠后清掉）。停靠 → `$.ui.status(undefined)`；inline 且是 `/chat-toc` 要的 → 保留，状态栏按 `e.viewport.isFullscreen` 选「askedNarrow」或「askedMainScreen」；其他 inline → `$.ui.close`（origin `plugin`，不记「已关闭」）后立即按自动打开规则再 open，宿主让它等到够宽再自动落座。render 里不能写 state，副作用都放进 `$.clock.after(0, …)`。连续撤回两次之间没停靠过就不再重开（防宿主一直放成 inline 时来回开关）。
  - 使用者点 ✕（`isClosedByPerson`）时同时清掉状态栏：之后不会再自动出现，「拉宽后会自动出现」就不再属实。
- 状态栏实际文字（宿主显示为 `⚠ chat-toc: <文字>`）：
  - 非全屏、未打开：「目录只在全屏布局里停靠在右侧，运行 /tui fullscreen 切换」
  - 全屏但宿主让未请求的 Pane 等待（终端窄）或停靠后变窄被撤回：「终端太窄，目录没有停靠；把终端拉宽后会自动出现」
  - `/chat-toc` 在全屏但不能停靠时放成 inline：「终端太窄，目录暂时放在输入框上方；把终端拉宽后会停靠到右侧」
  - `/chat-toc` 在非全屏时放成 inline：「非全屏布局里目录放在输入框上方；运行 /tui fullscreen 切换后会停靠到右侧」
  - `/tui fullscreen` 在 2.1.287 已存在（其二进制里的提示也让人用它切换），2.1.295 文档同。
- 测试：`tests/docking.test.ts`（10 个）；`tests/host.ts` 加了 `statuses`、`unplaced`（open 返回 `isPlaced:false`）、`drawHint($, isFullscreen)`（画一次提示行），`start()` 先画提示行，`mountPane` 可指定 `placement` 与全屏与否。`claude plugin test` 111 个全过，两版 `validate`、两版 `tsc` 干净。test kit 的 `$` 触发不了使用者关闭，✕ 清状态栏没有单测，也没在 PTY 单独验。
- PTY：`tests/acceptance/ct_compat.py`（pyte，无模型调用），CT-COMPAT-003 五个场景 `waiting / narrowed / asked / main / reload` 在 2.1.287 与 2.1.295 上全部通过，run 目录 `mods/chat-toc/build/pty-runs/20261011-084040-ct-compat-2.1.287`、`20261011-084114-ct-compat-2.1.295`（gitignore）。`waiting` 从宿主 debug 行 `waits unplaced (unasked below N columns …)` 读出阈值（两版都是 144），只在 N-1（仍等待、状态栏在）与 N（停靠、状态栏清除）取样。CT-LIFE 001/002/fork 两版重跑通过（`20261011-084154-ct-life-2.1.287`、`20261011-084221-ct-life-2.1.295`）。
- 实测宿主在停靠后变窄时的行为（用本票之前的插件取样，`scratchpad/p26/probe.py`，run `20261011-082945-p26-probe-current`、`20261011-083014-p26-probe-2.1.287`、`20261011-083042-p26-probe-current`；两版一致）：
  - 自动停靠（未请求）的 Pane 在 170→130 列时**仍停靠**：已落座的 Pane 不再受 144 的未请求门槛约束。
  - 再窄到 100 列：宿主**不关、不撤回落座**，把同一个 Pane 改成 inline（输入框上方、整宽边框），`$.ui.panes()` 仍列着它；拉回 170 列时宿主又自动把它改回停靠。
  - `/chat-toc` 在 100 列时宿主放成 inline；拉宽到 170 列宿主自动改成停靠，再窄到 100 列又变 inline。
  - 所以「变窄 → inline」确实发生，插件按规格撤回：本票之后 100 列时 debug 日志是 `ui.close skipped: re-entry (… origin chat-toc)`（插件自己的 close 不再进自己的 hook）后跟 `ui.open … (unasked, 100 columns): waits unplaced`，屏幕上没有 inline 框，状态栏「终端太窄…」；拉回 170 列自动停靠、状态栏清除。
- 已知限制：撤回后重开是未请求的 open，所以要拉到未请求的门槛（144，或使用者请求过时 110）才再停靠，不是 110 就停靠；这是宿主的规则，插件不改写。
