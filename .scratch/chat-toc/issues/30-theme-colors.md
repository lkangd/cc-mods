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
