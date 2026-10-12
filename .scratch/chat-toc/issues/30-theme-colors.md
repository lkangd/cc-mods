# 30: Pane 颜色跟随 Claude Code 主题，发布 0.1.1

**What to build:** chat-toc 不再写死颜色，改用宿主的主题键，让 Pane 与当前主题协调；随后以 0.1.1 发布。

**Blocked by:** 无

**Status:** claimed

## 已定的决定（2026-10-12 grilling）

- 取色方式：`Text` 的 `color` 直接写主题键，由宿主按当前主题解析；不读主题名，不在插件里维护调色板。宿主类型从 2.1.271 起写明「Colors are a theme key or a raw color」。
- 当前组高亮的槽位（`▌` / `●` / `┃`，timeline 含时间）：`cyan` → `suggestion`。
- ~~原来的 `dimColor` → `color="inactive"`~~：spike 发现 `dimColor` 本来就画成主题的 `inactive`，且 `Button` 没有 `color`；使用者同意保持 `dimColor` 不动（Q6'）。
- 悬停的 `inverse` 保留；按钮选中项的 `●` 不加颜色。
- 只改 chat-toc；在 `docs/agents/mod-host-gotchas.md` 记一条「颜色用主题键」。
- 0.1.0 的人工目检不再签，并入 0.1.1 的签字（在 29 号票注明）。

## 步骤

- [x] Spike：2.1.287 与 2.1.295 实测插件 Pane 里的主题键能被解析；`/config` 换主题后 Pane 是否立刻重画。不重画才加 `config.set`（`key: "theme"`）监听来主动重画
- [x] 测试先行：`drawPane` 的颜色纯函数测试，再改实现
- [x] PTY 验收：两版 × `dark`、`light`、`dark-ansi`、`light-ansi`，读 SGR 断言高亮与暗淡元素的前景色等于该主题的解析值，不再出现 cyan 或 `999999`；`daltonized` 与 `auto` 只截屏
- [x] `mod-host-gotchas.md` 补一条
- [ ] 0.1.1 按 README 的发布清单发布（门禁、marketplace 冒烟、GitHub 安装检查），人工目检签字并入 0.1.1

## Comments

- 2026-10-12 spike（pyte，`--plugin-dir` 一份把高亮改成 `color="suggestion"` 的副本，turns fixture 12 轮，不登录）。2.1.287 与 2.1.295 结果完全相同：

  | 主题 | 高亮 `▌`（`suggestion`） | `dimColor`（槽位与 `你 ·` / `↳` 行） |
  | --- | --- | --- |
  | dark | `b1b9f9` | `999999` |
  | light | `5769f7` | `666666` |
  | dark-ansi | `brightblue` | `white` |
  | light-ansi | `blue` | `brightblack` |

  - 主题键在插件 Pane 里两版都能解析。
  - `dimColor` 本来就跟着主题的 `inactive` 走（上表即各主题的 `inactive`）；`mod-host-gotchas.md` 里「dimColor 画成 999999」只在 dark 下成立。另外 `Button` 没有 `color` 属性，条目的暗淡行只能用 `dimColor`。
  - `/theme` 从 Dark 切到 Light 后 Pane 立刻按新主题重画（两版都是），不需要监听 `config.set`。
  - `/theme` 还有「New custom theme…」：自定义主题同样经主题键解析。
- 2026-10-12 实现：`hooks/pane.tsx` 高亮 `color="cyan"` → `"suggestion"`；`follow_position.test.ts` 先改成期待 `suggestion`（6 个失败）再改实现（210 通过）。验收契约新增 MUST `CT-UI-004`（`gate_scenarios.py` 的 `ui-004`：四种主题各一条、`/theme` Dark→Light 实时重画一条、daltonized 两种与 auto 只记录一条），`CT-UI-003` 的颜色判据从「像青色」改为等于 dark 的 `suggestion`；`release_gate.py` 的 MUST 表与签字说明随之更新。`ui-003`、`ui-004` 在 2.1.287 与 2.1.295 上都通过（daltonized：dark `99ccff` / light `3366ff`；pyte 下 auto 按 dark 画）。文档：根 README 的「青色高亮」改为跟随主题的高亮，`mod-host-gotchas.md` 订正 `dimColor` 并加「颜色用主题键」。
- 2026-10-12 0.1.1 门禁第一轮（被测提交 `3777ac2`，两版并行跑）：除下面几项外全部通过（validate、test 210、单元 43、两版 tsc、ct-compat、ct-marketplace 本地、ct-life、chain、jump、position、2.1.295 的 gate、截屏）。未通过：2.1.287 的 data-004 与两种 perf 在 pyte 内部崩溃（`screens.py` 的 `render` 报 `IndexError: string index out of range`，驱动问题）；2.1.295 的 CT-PERF-001 many/heavy 超阈值（两版并行，机器负载高：`tailReadMs` p95 到 1338 ms，一次 `hostReadyS` 11 s）。本次只改了一个颜色字符串，不涉及读取与绘制路径。第一轮的运行目录挪到 scratchpad 的 `gate-attempt1/` 留存；在机器空闲时串行重跑 2.1.287 的整套 gate_scenarios 与两版 perf。
- 2026-10-12 第二轮（串行重跑）：2.1.287 gate_scenarios 21 过 1 不过——CT-DATA-004 的 4 次提交后读取里有一次 `chunks: 0`（读到时没有新字节），判据要求每次都是 1 块；整列表与跨块边界都对。CT-PERF-001：两版 heavy 通过，两版 many 不过，都卡在「增量读取，单次 ≤ 150 ms」（p95 192–405 ms；0.1.0 时是 104–111 ms，本来就贴着阈值，主要是热重载后第一次 `$.process.run`）。当时机器 load average 25–35（Chrome、WindowServer 等），不是空闲机器。插件读取路径与 0.1.0 相同。
- 2026-10-12 第三轮（使用者关掉其他程序后串行重跑，load average 6–9）：第二轮不过的运行目录挪到 scratchpad 的 `gate-attempt2/` 留存，重跑 2.1.287 的整套 gate_scenarios 与两版 perf many。结果全部通过：2.1.287 gate_scenarios 22/22（CT-DATA-004 两次提交后读取都是 1 块）；CT-PERF-001 many 增量读取最大 2.1.287 为 100–108 ms、2.1.295 为 94–102 ms，回到 0.1.0 的水平。确认第二轮的失败来自机器负载。两版的 `codes.json` 被 `--only-perf` 那次覆盖成只有 perf 两项，按各日志头的 exit 与本轮结果重建。
- 2026-10-12 侧栏背景：使用者反馈 Pane 背景与终端不协调。原因是宿主停靠侧栏写死 `backgroundColor: "composerSidebarBackground"`（dark 下 `rgb(38,38,38)`），使用者的自定义主题 cc-themes:dracula 没覆盖这个键；插件盖不住宿主画的边框列与 ✕ 行，所以不在 chat-toc 里改。在使用者的 cc-themes 仓库补了 Dracula 的 5 个键并新加 Catppuccin Mocha 主题（使用者终端用 Mocha），提交 `c6f515a`（未推送）。两版 PTY 实测（`--plugin-dir` 加载 cc-themes，`theme: custom:cc-themes:<slug>`）：Pane、边框列、✕ 行都是该主题的 `composerSidebarBackground`（Dracula `282a36`、Mocha `181825`），高亮为 `bd93f9` / `cba6f7`，淡化为 `6272a4` / `7f849c`。
