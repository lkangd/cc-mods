# 20: Pane 生命周期

**What to build:** 使用者能控制目录的去留：点 ✕ 后本会话不再弹出，`/chat-toc` 随时重新打开或提前聚焦（从不关闭），`/clear`、`/resume` 之后目录随新会话重建并再次自动弹出，热重载不重复打开，也不受其他插件 Pane 开关的影响。

规格见 [chat-toc MVP](../spec.md) §2。

**Blocked by:** 17（自动停靠的最小目录）、18（独立 verifier 与 PTY 验收驱动）

**Status:** resolved

- [x] 只有本 Pane id、`origin.kind === person` 的 `ui.close` 才在 `$.state` 记「本会话已关闭」；不设 `closeOnEscape`
- [x] `/chat-toc`（无参数、`immediate: true`）：关着就打开；开着（前台或后台标签）就提到前台并 `focus: true`；从不关闭；对已开 id 再 open 不切标签时退化为只聚焦
- [x] `classic.SessionStart` 的 `source` 为 `clear` 或 `resume` 时，按同样条件再次自动打开，并换读新的 `transcript_path`；`/clear` 后目录清空重建、不画分隔线
- [x] 热重载后 `session.start` 再触发时，先查 `$.ui.panes()` 与关闭标记，不重复打开
- [x] 其他插件（如内置 diff）的 Pane 开关不影响关闭标记；chat-toc 自动弹出时照宿主规则在前台，被挤到后台或回到前台时不做任何事
- [x] PTY 验收 CT-LIFE-001、CT-LIFE-002 在两个版本上通过

## Comments

- 实现：`hooks/lifecycle.ts`（`isClosedByPerson`、`reopensOn`、`isPaneOpen` 三个纯判断）；`register.tsx` 里 `openUnasked`/`autoOpen`（自动打开串行执行，`--resume` 启动时 `classic.SessionStart` 与 `session.start` 同时到也只开一次）、`openAsked`（`/chat-toc`：已开就带 `focus: true` 再 open，并清掉关闭标记）、`ui.close` hook（`next` 之后才记，下层拒绝关闭时不记）。关闭标记是 `$.state` 的 `isClosed`。`classic.SessionStart` 的 `source` 为 `clear`/`resume` 时显式清掉标记再按规则打开，不依赖宿主重置的先后。
- 测试：`tests/pane_lifecycle.test.ts`。test kit 的 `$` 没有 `ui.close`（也没有 `ui.open`），测试触发不了 person 关闭，所以「哪种关闭算数」在纯函数上测，标记本身的效果在 PTY 里验。
- 全屏判断、`isPlaced`、状态栏说明、inline 时由插件关闭都留给 26 号票，本票没做。
- PTY：`tests/acceptance/ct_life.py`（pyte，无模型调用）。2.1.287 与 2.1.295 上 CT-LIFE-001、CT-LIFE-002 都通过，run 目录 `mods/chat-toc/build/pty-runs/20261011-081906-ct-life-2.1.295`、`20261011-081840-ct-life-2.1.287`（gitignore，发布时再拷证据）。热重载用改动插件副本的 `register.tsx` 触发，`--debug-file` 日志里能看到 `reloaded`、`session.start settled` 和每次 `ui.open chat-toc chat-toc (unasked|asked …)`，以此确认重载后没有再 open。
- `/reload-plugins` 不会重载没改动的 hooks 模块（日志：`hooks modules unchanged, kept as loaded`），所以它不是热重载的验收手段。
- `/clear` 后新会话的文件第一行就是 `/clear` 这条本地命令，所以新目录有一组「/clear」，不是「本会话还没有对话」；CT-LIFE-002 按 verifier 对新会话文件的读法比对。
- 追加（21 号票转来）：`--fork-session` 后新会话的文件在第一次提交前不存在，transcript 却显示着原会话的历史，原来的「本会话还没有对话」会误导。`classic.SessionStart` 换路径时按 `source` 记 `$.state` 的 `isCarriedOver`（`resume` 或 `fork` 为真，`carriesHistory`），文件不存在时 Pane 改显示：「本会话还没写进 transcript 文件，提交第一条消息后显示目录」（`NOT_WRITTEN_TEXT`）。新开、`/clear` 的会话仍是「本会话还没有对话」。实测 2.1.287、2.1.295 的 `--fork-session` 都走到这句（`ct_life.py --scenario fork`，记为 CT-LIFE-005 的一部分）；在未登录的测试 world 里提交一条，宿主自己回「Not logged in」，文件写出后 Pane 与 verifier 对 fork 文件的读法一致，不调用模型。
- 已知：toc_verifier 的 `find_pane` 只认条目或「本会话还没有对话」，认不出这句新提示；`ct_life.py` 里自己读边框右侧文字判断，没改 verifier。
- 21 号票的 `chain_scenarios.py life-005-fork` 原来断言 fork 后显示「本会话还没有对话」，已改为断言新提示且不出现旧提示；两个版本重跑通过（`20261011-082047-chain-2.1.295`、`20261011-082052-chain-2.1.287`）。
