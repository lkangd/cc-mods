# 17: 自动停靠的最小目录

**What to build:** 全屏会话启动时，chat-toc 的 Pane 自动停靠在 transcript 右侧，列出当前会话里每一条普通 prompt（卡片布局，只画用户侧「你 · 时间」加最多 2 行原文），点击就跳回对话里的那条 prompt。会话继续时目录跟着增长。这是贯穿「读 transcript → 组 Turn group → 画 Pane → 跳转」的第一条完整路径，后续票都在它上面扩展。

规格见 [chat-toc MVP](../spec.md) §1、§2、§3、§5、§7。

**Blocked by:** 无（可以立即开始）

**Status:** resolved

- [x] 插件根、`plugin.json`（`chat-toc`、`0.1.0`）、`/chat-toc` 命令注册齐全，在 2.1.287 与当前版本上 `claude plugin validate` 0 错误
- [x] 全屏会话启动时（`session.start`）自动打开停靠 Pane；`$.ui.panes()` 里已有时不重复打开
- [x] 从 classic 事件拿 `transcript_path`，文件 ≤4 MiB 时用 `$.fs.read` 读取，沿 `parentUuid` 取当前分支
- [x] `origin.kind: "human"` 的 user 行各自开组；完全相同的 prompt 各自成组
- [x] 卡片布局用户侧：暗色头行「你 · M月D日 HH:MM」（时间读不到就只写「你」）加最多 2 行原文，每行一个 `plain` Button、同侧共用跳转、hover scope 整侧连亮
- [x] 点击用户侧以 `block: start` 跳到该 prompt（`requestId` 精确匹配 uuid），`"placeholder"` 一律忽略
- [x] 文件还不存在时正文只有一行「本会话还没有对话」，第一条 User input 落盘后出现条目
- [x] `session.append`（无 `agentId`）与 `turn.complete` 触发重读：尾随 300 ms、读时合并、`fs.stat` 大小不变就跳过、`turn.complete` 后 +1.5 s 再查一次
- [x] `claude plugin test` 套件建立，覆盖开组与绘制；在两个版本上手动冒烟一次（CT-COMPAT-001 的雏形）

## Comments

**2026-10-10 实现说明（分支 `chat-toc/17-tracer`）**

- 模块分层（`mods/chat-toc/hooks/`）：`transcript.ts` 解析行 → `chain.ts` 当前分支 → `groups.ts` 开组规则与用户侧文字 → `model.ts` 串起来；`source.ts`/`reader.ts` 是读取结果与节流闸门；`entries.ts`/`cells.ts`/`window.ts`/`pane.tsx` 是绘制；`jump.ts` 是 Jump target。宿主的 `$` 只能交给 `register.tsx` 顶层声明的函数（引擎在加载时静态检查），所以所有 `$` 调用都留在 `register.tsx`，其余文件是纯函数。后续票在这些文件上扩展：19 改 `groups.ts`/`entries.ts`，21 改 `chain.ts`，22 改 `source.ts` 与 `register.tsx` 的 `readSource`，23/24 改 `jump.ts` 并新增 transcript 站点 hook，25 改 `entries.ts`/`pane.tsx`。
- 测试：`claude plugin test mods/chat-toc` 33 项全过（2.1.295）。2.1.287 的 test kit 没有 `session.append` 的底层实现，5 项依赖它的用例在 2.1.287 上不能跑，按规格只要求当前版本通过。`tsc` 对 2.1.287 与 2.1.295 两份声明都 0 错误；`claude plugin validate` 两版都通过。
- 跳转的测试只能落在纯函数接缝上：test kit 不把指向 transcript 行的 `$.ui.scroll` 交给测试的 hook，真实跳转由 PTY 冒烟确认。
- 「`placeholder` 一律忽略」：本票没有挂 transcript 站点的 render hook，插件不消费任何宿主给的 `requestId`，跳转直接用开组行的 uuid；挂站点、映射 `requestId` 与忽略 `placeholder` 随 23 落地。
- 本票不含的部分：只在 `viewport.isFullscreen` 为真时自动打开、`isPlaced:false` 的状态栏说明（26）；关闭标记与 `/chat-toc` 聚焦（20）；超过 4 MiB 时目前只显示一行「transcript 超过 4 MiB，目录暂时读不了」，分块读取在 22。Pane 自管窗口，默认跟随最新条目，滚轮按条目滚动；跟随高亮在 24。
- PTY 冒烟（cmux，自开 workspace，关掉本机其他插件，合成 transcript `--resume`，事后删除）：
  - 2.1.295：自动停靠、30 条合成 prompt 全部列出（重复提交的两条各自成组、时间按本地时区）、点击正文行和头行都跳到对应 prompt、滚轮上翻到首条、提交一条合成 prompt 后目录增长、新会话显示「本会话还没有对话」。
  - 2.1.287：自动停靠（✕ 画在第一行右侧，与短头行不冲突）、点击跳转、新会话先显示「本会话还没有对话」，提交一条合成 prompt 后出现条目。
  - 停靠宽度实际是 80 列：宿主保留了此前原型里调过的宽度（使用者调过的宽度优先于 `columns: 44`），符合声明。
  - 共调用 2 次 Haiku（各一条合成 prompt）。
